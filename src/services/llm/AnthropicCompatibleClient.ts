import { randomUUID } from 'crypto'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId } from 'src/bootstrap/state.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { getUserAgent } from 'src/utils/http.js'
import { safeParseJSON } from 'src/utils/json.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  normalizeMessagesForAPI,
} from 'src/utils/messages.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import {
  hasNoThinkingModelTag,
  normalizeModelStringForAPI,
} from 'src/utils/model/model.js'
import { toolToAPISchema } from 'src/utils/api.js'
import type { Tool } from 'src/Tool.js'
import type { AssistantMessage, StreamEvent } from 'src/types/message.js'
import type { LLMProfileConfig } from './config.js'
import {
  getLLMProfileApiKeyEnvNames,
  shouldTrackLLMProfileDollarCost,
} from './config.js'
import { API_ERROR_MESSAGE_PREFIX } from '../api/errors.js'
import { getDefaultMaxOutputTokensForLLM } from './maxTokens.js'
import type {
  LLMClient,
  LLMClientCapabilities,
  LLMModelInfo,
  LLMMainQueryRequest,
  LLMSideQueryRequest,
  LLMSideQueryResponse,
  LLMSideQueryTool,
} from './types.js'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicResponse = {
  id?: string
  model?: string
  role?: 'assistant'
  content?: AnthropicContentBlock[]
  stop_reason?: string | null
  usage?: Usage
  _request_id?: string
}

type AnthropicStreamEvent = {
  type?: string
  index?: number
  message?: AnthropicResponse
  content_block?: AnthropicContentBlock
  delta?: Record<string, unknown>
  usage?: Usage
}

type StreamingBlock = {
  type: string
  text?: string
  thinking?: string
  signature?: string
  id?: string
  name?: string
  input?: unknown
  inputJson?: string
}

export class AnthropicCompatibleClient implements LLMClient {
  constructor(
    public readonly profileName: string,
    private readonly profile: LLMProfileConfig,
  ) {}

  getCapabilities(): LLMClientCapabilities {
    return {
      providerType: 'anthropic_compat',
      supportsStreaming: this.profile.streaming !== 'disabled',
      supportsToolCalling: this.profile.supportsToolCalls !== false,
      supportsThinking: this.profile.supportsThinking !== false,
    }
  }

  async *streamMainQuery(
    request: LLMMainQueryRequest,
  ): AsyncGenerator<AssistantMessage | StreamEvent, void> {
    const maxTokens =
      request.options.maxOutputTokensOverride ??
      getDefaultMaxOutputTokensForLLM(request.options.model)
    const payload = {
      model: this.toProviderModel(request.options.model),
      max_tokens: maxTokens,
      system: request.systemPrompt.join('\n\n'),
      messages: this.buildMainQueryMessages(request),
      temperature: request.options.temperatureOverride,
      tools: await this.buildToolsFromRuntime(request),
      tool_choice: request.options.toolChoice,
      thinking: this.buildThinkingPayload(
        request.options.model,
        request.thinkingConfig,
        maxTokens,
      ),
    }

    if (this.profile.streaming !== 'disabled') {
      yield* this.streamMessages(request, payload)
      return
    }

    const response = await this.createMessage(payload, request.signal)
    this.trackUsage(response.model || request.options.model, response.usage)
    yield this.toAssistantMessage(response)
    const maxTokensMessage = this.createMaxTokensMessage(
      response.stop_reason,
      maxTokens,
    )
    if (maxTokensMessage) {
      yield maxTokensMessage
    }
  }

  async sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse> {
    const response = await this.createMessage({
      model: this.toProviderModel(request.model),
      max_tokens: request.max_tokens ?? 1024,
      system: request.system,
      messages: this.buildSideQueryMessages(request),
      temperature: request.temperature,
      tools: this.buildSideQueryTools(request.tools),
      tool_choice: request.tool_choice,
      stop_sequences: request.stop_sequences,
      ...(request.thinking !== undefined
        ? {
            thinking:
              request.thinking === false
                ? { type: 'disabled' }
                : {
                    type: 'enabled',
                    budget_tokens: Math.max(
                      1,
                      Math.min(request.thinking, (request.max_tokens ?? 1024) - 1),
                    ),
                  },
          }
        : {}),
      ...(request.output_format
        ? { output_config: { format: request.output_format } }
        : {}),
    }, request.signal)

    this.trackUsage(response.model || request.model, response.usage)
    return this.toSideQueryResponse(response, request.model)
  }

  async validateModel(
    model: string,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!model.trim()) {
      return { valid: false, error: 'Model name cannot be empty' }
    }

    try {
      await this.sideQuery({
        model,
        max_tokens: 1,
        maxRetries: 0,
        querySource: 'model_validation',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { valid: false, error: message }
    }
  }

  async listModels(): Promise<LLMModelInfo[]> {
    if (this.profile.supportsModelList === false) {
      return []
    }

    const response = await fetch(`${this.getBaseURL()}/v1/models`, {
      method: 'GET',
      headers: this.buildHeaders(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(this.formatHttpError(response.status, text))
    }

    return this.parseModelsList(await response.json())
  }

  private async buildToolsFromRuntime(
    request: LLMMainQueryRequest,
  ): Promise<Array<Record<string, unknown>> | undefined> {
    const runtimeTools = await Promise.all(
      request.tools.map(async tool => {
        return toolToAPISchema(tool as Tool, {
          getToolPermissionContext: request.options.getToolPermissionContext,
          tools: request.tools,
          agents: request.options.agents,
          allowedAgentTypes: request.options.allowedAgentTypes,
          model: request.options.model,
        }) as unknown as Record<string, unknown>
      }),
    )
    const extra = (request.options.extraToolSchemas ?? []).flatMap(schema =>
      schema && typeof schema === 'object'
        ? [schema as Record<string, unknown>]
        : [],
    )
    const tools = [...runtimeTools, ...extra]
    return tools.length > 0 ? tools : undefined
  }

  private buildMainQueryMessages(
    request: LLMMainQueryRequest,
  ): AnthropicMessage[] {
    return normalizeMessagesForAPI(request.messages, request.tools).map(
      normalized => normalized.message as AnthropicMessage,
    )
  }

  private buildSideQueryMessages(
    request: LLMSideQueryRequest,
  ): AnthropicMessage[] {
    return request.messages.map(message => ({
      role: message.role,
      content: message.content as string | AnthropicContentBlock[],
    }))
  }

  private buildSideQueryTools(
    tools: LLMSideQueryTool[] | undefined,
  ): Array<Record<string, unknown>> | undefined {
    if (!tools?.length) return undefined
    return tools
      .filter(tool => tool.input_schema && typeof tool.name === 'string')
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      }))
  }

  private async createMessage(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AnthropicResponse> {
    const response = await fetch(`${this.getBaseURL()}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.compactPayload(payload)),
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(this.formatHttpError(response.status, text))
    }

    return (await response.json()) as AnthropicResponse
  }

  private async createMessageStream(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(`${this.getBaseURL()}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.compactPayload({ ...payload, stream: true })),
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(this.formatHttpError(response.status, text))
    }
    if (!response.body) {
      throw new Error('Streaming response did not include a response body.')
    }
    return response.body
  }

  private getBaseURL(): string {
    if (!this.profile.baseURL) {
      throw new Error(
        `LLM profile '${this.profileName}' requires llm.profiles.${this.profileName}.baseURL`,
      )
    }
    return this.profile.baseURL.replace(/\/$/, '')
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': getUserAgent(),
      'anthropic-version': '2023-06-01',
      'x-claude-code-session-id': getSessionId(),
      ...(this.profile.headers ?? {}),
    }

    if (this.profile.requiresApiKey === false) {
      return headers
    }

    const apiKeyEnvNames = getLLMProfileApiKeyEnvNames(this.profile)
    const effectiveEnvNames =
      apiKeyEnvNames.length > 0 ? apiKeyEnvNames : ['ANTHROPIC_API_KEY']
    const resolved = effectiveEnvNames
      .map(envName => ({ envName, apiKey: process.env[envName] }))
      .find(entry => !!entry.apiKey)
    if (!resolved?.apiKey) {
      throw new Error(
        `Missing API key. Set ${effectiveEnvNames.join(' or ')} for LLM profile '${this.profileName}'.`,
      )
    }

    if (this.profile.apiKeyHeader === 'authorization-bearer') {
      return { ...headers, authorization: `Bearer ${resolved.apiKey}` }
    }
    return { ...headers, 'x-api-key': resolved.apiKey }
  }

  private async *streamMessages(
    request: LLMMainQueryRequest,
    payload: Record<string, unknown>,
  ): AsyncGenerator<AssistantMessage | StreamEvent, void> {
    yield { type: 'stream_request_start' }
    const stream = await this.createMessageStream(payload, request.signal)
    const blocks = new Map<number, StreamingBlock>()
    let model = String(payload.model || request.options.model)
    let usage: Usage | undefined
    let stopReason: string | null = null

    for await (const event of this.iterSSEEvents(stream)) {
      if (event.message?.model) model = event.message.model
      usage = this.mergeUsage(usage, event.message?.usage)
      usage = this.mergeUsage(usage, event.usage)
      if (
        event.type === 'message_delta' &&
        typeof event.delta?.stop_reason === 'string'
      ) {
        stopReason = event.delta.stop_reason
      }
      this.updateStreamingBlocks(blocks, event)
      yield { type: 'stream_event', event: event as unknown as Record<string, unknown> }
    }

    this.trackUsage(model, usage)
    yield createAssistantMessage({
      content: this.buildAssistantContentFromStreaming(blocks) as never,
      usage: usage as never,
    })
    const maxTokensMessage = this.createMaxTokensMessage(
      stopReason,
      Number(payload.max_tokens),
    )
    if (maxTokensMessage) {
      yield maxTokensMessage
    }
  }

  private updateStreamingBlocks(
    blocks: Map<number, StreamingBlock>,
    event: AnthropicStreamEvent,
  ): void {
    if (event.type === 'content_block_start' && event.index !== undefined) {
      const block = event.content_block ?? { type: 'text', text: '' }
      blocks.set(event.index, {
        type: block.type,
        text: block.type === 'text' ? String(block.text ?? '') : undefined,
        thinking:
          block.type === 'thinking' ? String(block.thinking ?? '') : undefined,
        signature:
          block.type === 'thinking' ? String(block.signature ?? '') : undefined,
        id: block.type === 'tool_use' ? String(block.id ?? '') : undefined,
        name: block.type === 'tool_use' ? String(block.name ?? '') : undefined,
        input: block.type === 'tool_use' ? block.input : undefined,
        inputJson: block.type === 'tool_use' ? '' : undefined,
      })
      return
    }

    if (event.type !== 'content_block_delta' || event.index === undefined) {
      return
    }
    const block = blocks.get(event.index)
    if (!block || !event.delta) return
    if (event.delta.type === 'text_delta') {
      block.text = (block.text ?? '') + String(event.delta.text ?? '')
    } else if (event.delta.type === 'thinking_delta') {
      block.thinking =
        (block.thinking ?? '') + String(event.delta.thinking ?? '')
    } else if (event.delta.type === 'signature_delta') {
      block.signature =
        (block.signature ?? '') + String(event.delta.signature ?? '')
    } else if (event.delta.type === 'input_json_delta') {
      block.inputJson =
        (block.inputJson ?? '') + String(event.delta.partial_json ?? '')
    }
  }

  private async *iterSSEEvents(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<AnthropicStreamEvent, void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let separatorIndex = buffer.indexOf('\n\n')
        while (separatorIndex !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)
          const event = this.parseSSEEvent(rawEvent)
          if (event) yield event
          separatorIndex = buffer.indexOf('\n\n')
        }
      }
      buffer += decoder.decode()
      const trailing = this.parseSSEEvent(buffer)
      if (trailing) yield trailing
    } finally {
      reader.releaseLock()
    }
  }

  private parseSSEEvent(rawEvent: string): AnthropicStreamEvent | undefined {
    const data = rawEvent
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') return undefined
    return safeParseJSON(data) as AnthropicStreamEvent | undefined
  }

  private toAssistantMessage(response: AnthropicResponse): AssistantMessage {
    return createAssistantMessage({
      content: (response.content?.length ? response.content : '') as never,
      usage: response.usage as never,
    })
  }

  private toSideQueryResponse(
    response: AnthropicResponse,
    requestedModel: string,
  ): LLMSideQueryResponse {
    return {
      id: response.id || randomUUID(),
      model: response.model || requestedModel,
      content: (response.content ?? []) as LLMSideQueryResponse['content'],
      stop_reason: response.stop_reason,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens:
          response.usage?.cache_creation_input_tokens ?? 0,
      },
      _request_id: response._request_id,
    }
  }

  private buildAssistantContentFromStreaming(
    blocks: Map<number, StreamingBlock>,
  ): unknown {
    const content: AnthropicContentBlock[] = []
    for (const [, block] of Array.from(blocks.entries()).sort(
      ([left], [right]) => left - right,
    )) {
      if (block.type === 'text' && block.text) {
        content.push({ type: 'text', text: block.text })
        continue
      }
      if (block.type === 'thinking' && block.thinking) {
        content.push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature ?? '',
        })
        continue
      }
      if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id || randomUUID(),
          name: block.name || 'unknown_tool',
          input: block.inputJson
            ? this.parseToolInput(block.inputJson)
            : (block.input ?? {}),
        })
      }
    }
    return content.length > 0 ? content : ''
  }

  private parseToolInput(inputJson: string): unknown {
    try {
      return JSON.parse(inputJson)
    } catch {
      return { raw: inputJson }
    }
  }

  private mergeUsage(
    current: Usage | undefined,
    next: Usage | undefined,
  ): Usage | undefined {
    if (!next) return current
    return {
      ...current,
      ...next,
      input_tokens: next.input_tokens ?? current?.input_tokens ?? 0,
      output_tokens: next.output_tokens ?? current?.output_tokens ?? 0,
      cache_read_input_tokens:
        next.cache_read_input_tokens ??
        current?.cache_read_input_tokens ??
        0,
      cache_creation_input_tokens:
        next.cache_creation_input_tokens ??
        current?.cache_creation_input_tokens ??
        0,
    } as Usage
  }

  private trackUsage(model: string, usage: Usage | undefined): void {
    if (!usage) return
    const cost = shouldTrackLLMProfileDollarCost(this.profile)
      ? calculateUSDCost(model, usage)
      : 0
    addToTotalSessionCost(cost, usage, model)
  }

  private compactPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    )
  }

  private formatHttpError(status: number, bodyText: string): string {
    if (status === 401 || status === 403) {
      return 'Authentication failed. Please check your API credentials.'
    }
    if (status === 404) {
      return 'Model or endpoint not found.'
    }
    const parsed = safeParseJSON(bodyText)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      parsed.error &&
      typeof parsed.error === 'object' &&
      'message' in parsed.error &&
      typeof parsed.error.message === 'string'
    ) {
      return `API error: ${parsed.error.message}`
    }
    return `API error (${status}): ${bodyText || 'Unknown error'}`
  }

  private toProviderModel(model: string): string {
    return normalizeModelStringForAPI(model)
  }

  private createMaxTokensMessage(
    stopReason: string | null | undefined,
    maxTokens: number,
  ): AssistantMessage | undefined {
    if (
      stopReason !== 'max_tokens' &&
      stopReason !== 'model_context_window_exceeded'
    ) {
      return undefined
    }

    const content =
      stopReason === 'model_context_window_exceeded'
        ? `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`
        : `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${maxTokens} output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`

    return createAssistantAPIErrorMessage({
      content,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    })
  }

  private buildThinkingPayload(
    model: string,
    thinkingConfig: LLMMainQueryRequest['thinkingConfig'],
    maxTokens: number,
  ): Record<string, unknown> | undefined {
    if (
      hasNoThinkingModelTag(model) ||
      thinkingConfig.type === 'disabled' ||
      this.profile.supportsThinking === false
    ) {
      return undefined
    }

    if (thinkingConfig.type === 'adaptive') {
      return undefined
    }

    return {
      type: 'enabled',
      budget_tokens: Math.max(
        1,
        Math.min(thinkingConfig.budgetTokens, maxTokens - 1),
      ),
    }
  }

  private parseModelsList(value: unknown): LLMModelInfo[] {
    if (!value || typeof value !== 'object') return []
    const data = (value as { data?: unknown }).data
    if (!Array.isArray(data)) return []
    return data.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const id = record.id
      if (typeof id !== 'string' || !id.trim()) return []
      const displayName = record.display_name
      return [
        {
          id: id.trim(),
          ...(typeof displayName === 'string' && displayName.trim()
            ? { displayName: displayName.trim() }
            : {}),
        },
      ]
    })
  }
}
