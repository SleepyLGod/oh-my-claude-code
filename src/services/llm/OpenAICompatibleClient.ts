import { randomUUID } from 'crypto'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId } from 'src/bootstrap/state.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { getUserAgent } from 'src/utils/http.js'
import { createAssistantMessage } from 'src/utils/messages.js'
import { normalizeMessagesForAPI } from 'src/utils/messages.js'
import { safeParseJSON } from 'src/utils/json.js'
import { toolToAPISchema } from 'src/utils/api.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { normalizeModelStringForAPI } from 'src/utils/model/model.js'
import type { Tool } from 'src/Tool.js'
import type { AssistantMessage, StreamEvent } from 'src/types/message.js'
import type { LLMProfileConfig } from './config.js'
import {
  getLLMProfileApiKeyEnvNames,
  shouldTrackLLMProfileDollarCost,
} from './config.js'
import type {
  LLMClient,
  LLMClientCapabilities,
  LLMMainQueryRequest,
  LLMSideQueryRequest,
  LLMSideQueryResponse,
  LLMSideQueryTool,
  LLMSideQueryUsage,
} from './types.js'

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

type OpenAIResponse = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
}

type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  usage?: OpenAIResponse['usage']
}

type StreamingToolCall = {
  id?: string
  name?: string
  argumentsText: string
  blockIndex?: number
  started?: boolean
}

export class OpenAICompatibleClient implements LLMClient {
  constructor(
    public readonly profileName: string,
    private readonly profile: LLMProfileConfig,
  ) {}

  getCapabilities(): LLMClientCapabilities {
    return {
      providerType: 'openai_compat',
      supportsStreaming: this.profile.streaming !== 'disabled',
      supportsToolCalling: true,
      supportsThinking: false,
    }
  }

  async *streamMainQuery(
    request: LLMMainQueryRequest,
  ): AsyncGenerator<AssistantMessage | StreamEvent, void> {
    const tools = await this.buildToolsFromRuntime(request)
    const payload = {
      model: this.toProviderModel(request.options.model),
      messages: this.buildMainQueryMessages(request),
      max_tokens: request.options.maxOutputTokensOverride,
      temperature: request.options.temperatureOverride,
      ...(tools.length > 0
        ? {
            tools,
            tool_choice: this.buildToolChoice(
              request.options.toolChoice,
              true,
            ),
          }
        : {}),
    }

    if (this.profile.streaming !== 'disabled') {
      yield* this.streamChatCompletion(request, payload)
      return
    }

    const response = await this.createChatCompletion(payload, request.signal)

    const usage = this.toAnthropicUsage(response.usage)
    const resolvedModel = response.model || request.options.model
    if (usage) {
      addToTotalSessionCost(
        this.calculateCost(resolvedModel, usage),
        usage,
        resolvedModel,
      )
    }

    yield this.toAssistantMessage(response, usage)
  }

  async sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse> {
    const response = await this.createChatCompletion({
      model: this.toProviderModel(request.model),
      messages: this.buildSideQueryMessages(request),
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      tools: this.buildSideQueryTools(request.tools),
      tool_choice: this.buildToolChoice(
        request.tool_choice,
        (request.tools?.length ?? 0) > 0,
      ),
      response_format: this.buildResponseFormat(request.output_format),
      stop: request.stop_sequences,
    }, request.signal)

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
        querySource: 'model_validation',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { valid: false, error: message }
    }
  }

  private async buildToolsFromRuntime(
    request: LLMMainQueryRequest,
  ): Promise<Array<Record<string, unknown>>> {
    const runtimeTools = await Promise.all(
      request.tools.map(async tool => {
        const schema = await toolToAPISchema(tool as Tool, {
          getToolPermissionContext: request.options.getToolPermissionContext,
          tools: request.tools,
          agents: request.options.agents,
          allowedAgentTypes: request.options.allowedAgentTypes,
          model: request.options.model,
        })
        const typedSchema = schema as unknown as Record<string, unknown>
        return {
          type: 'function',
          function: {
            name: String(typedSchema.name),
            description:
              typeof typedSchema.description === 'string'
                ? typedSchema.description
                : undefined,
            parameters:
              (typedSchema.input_schema as Record<string, unknown> | undefined) ??
              {},
          },
        }
      }),
    )

    const extra = (request.options.extraToolSchemas ?? []).flatMap(schema => {
      if (!schema || typeof schema !== 'object') return []
      const typed = schema as Record<string, unknown>
      if (
        typeof typed.name !== 'string' ||
        typeof typed.description !== 'string' ||
        !typed.input_schema
      ) {
        return []
      }
      return [
        {
          type: 'function',
          function: {
            name: typed.name,
            description: typed.description,
            parameters: typed.input_schema,
          },
        },
      ]
    })

    return [...runtimeTools, ...extra]
  }

  private buildMainQueryMessages(
    request: LLMMainQueryRequest,
  ): OpenAIChatMessage[] {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'system',
        content: request.systemPrompt.join('\n\n'),
      },
    ]
    return [...messages, ...this.convertNormalizedMessages(request.messages, request.tools)]
  }

  private buildSideQueryMessages(
    request: LLMSideQueryRequest,
  ): OpenAIChatMessage[] {
    const messages: OpenAIChatMessage[] = []
    if (request.system) {
      const systemText = Array.isArray(request.system)
        ? request.system.map(block => block.text).join('\n\n')
        : request.system
      messages.push({ role: 'system', content: systemText })
    }

    for (const message of request.messages) {
      messages.push({
        role: message.role,
        content: this.flattenContent(message.content),
      })
    }

    return messages
  }

  private convertNormalizedMessages(
    messages: LLMMainQueryRequest['messages'],
    tools: LLMMainQueryRequest['tools'],
  ): OpenAIChatMessage[] {
    const normalized = normalizeMessagesForAPI(messages, tools)
    const result: OpenAIChatMessage[] = []

    for (const message of normalized) {
      const content = Array.isArray(message.message.content)
        ? message.message.content
        : [{ type: 'text', text: String(message.message.content ?? '') }]

      if (message.type === 'assistant') {
        const toolCalls = content
          .filter(block => block.type === 'tool_use')
          .map(block => ({
            id: String(block.id),
            type: 'function' as const,
            function: {
              name: String(block.name),
              arguments: JSON.stringify(block.input ?? {}),
            },
          }))
        const text = content
          .filter(block => block.type === 'text')
          .map(block => String(block.text ?? ''))
          .join('\n')
        result.push({
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        })
        continue
      }

      const toolResults = content.filter(block => block.type === 'tool_result')
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: String(block.tool_use_id),
            content: this.flattenContent(block.content),
          })
        }
        const remainingText = content.filter(block => block.type !== 'tool_result')
        if (remainingText.length > 0) {
          result.push({
            role: 'user',
            content: this.flattenContent(remainingText),
          })
        }
        continue
      }

      result.push({
        role: 'user',
        content: this.flattenContent(content),
      })
    }

    return result
  }

  private buildSideQueryTools(
    tools: LLMSideQueryTool[] | undefined,
  ): Array<Record<string, unknown>> | undefined {
    if (!tools?.length) return undefined
    return tools
      .filter(tool => tool.input_schema && typeof tool.name === 'string')
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }))
  }

  private buildToolChoice(
    toolChoice: LLMSideQueryRequest['tool_choice'] | LLMMainQueryRequest['options']['toolChoice'],
    hasTools: boolean,
  ): unknown {
    if (!hasTools) return undefined
    if (!toolChoice || toolChoice.type === 'auto') return 'auto'
    if (toolChoice.type === 'any') return 'required'
    return {
      type: 'function',
      function: { name: ('name' in toolChoice ? toolChoice.name : '') || '' },
    }
  }

  private buildResponseFormat(
    outputFormat: LLMSideQueryRequest['output_format'],
  ): Record<string, unknown> | undefined {
    if (!outputFormat || outputFormat.type !== 'json_schema') {
      return undefined
    }
    return {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        schema: outputFormat.schema,
        strict: true,
      },
    }
  }

  private async createChatCompletion(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OpenAIResponse> {
    const response = await fetch(`${this.getBaseURL()}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(this.formatHttpError(response.status, text))
    }

    return (await response.json()) as OpenAIResponse
  }

  private async createChatCompletionStream(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const streamPayload = {
      ...payload,
      stream: true,
      ...(this.profile.includeUsageInStream
        ? { stream_options: { include_usage: true } }
        : {}),
    }
    const response = await fetch(`${this.getBaseURL()}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(streamPayload),
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
    const baseURL = this.profile.baseURL
    if (!baseURL) {
      throw new Error(
        `LLM profile '${this.profileName}' requires llm.profiles.${this.profileName}.baseURL`,
      )
    }

    return baseURL.replace(/\/$/, '')
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': getUserAgent(),
      'x-claude-code-session-id': getSessionId(),
      ...(this.profile.headers ?? {}),
    }

    if (this.profile.requiresApiKey === false) {
      return headers
    }

    const configuredEnvNames = getLLMProfileApiKeyEnvNames(this.profile)
    const apiKeyEnvNames =
      configuredEnvNames.length > 0 ? configuredEnvNames : ['OPENAI_API_KEY']
    const resolvedApiKey = apiKeyEnvNames
      .map(envName => ({ envName, apiKey: process.env[envName] }))
      .find(entry => !!entry.apiKey)
    const apiKey = resolvedApiKey?.apiKey
    if (!apiKey) {
      throw new Error(
        `Missing API key. Set ${apiKeyEnvNames.join(' or ')} for LLM profile '${this.profileName}'.`,
      )
    }

    return {
      ...headers,
      authorization: `Bearer ${apiKey}`,
    }
  }

  private async *streamChatCompletion(
    request: LLMMainQueryRequest,
    payload: Record<string, unknown>,
  ): AsyncGenerator<AssistantMessage | StreamEvent, void> {
    yield { type: 'stream_request_start' }

    const stream = await this.createChatCompletionStream(
      payload,
      request.signal,
    )
    const messageId = randomUUID()
    const model = String(payload.model || request.options.model)
    const startedAt = Date.now()
    let text = ''
    let reasoning = ''
    let usage: OpenAIResponse['usage'] | undefined
    let stopReason: string | null = null
    let textIndex: number | undefined
    let reasoningIndex: number | undefined
    let textClosed = false
    let reasoningClosed = false
    let nextBlockIndex = 0
    const toolCalls = new Map<number, StreamingToolCall>()

    yield this.streamEvent({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }, Date.now() - startedAt)

    for await (const chunk of this.iterSSEChunks(stream)) {
      usage = chunk.usage ?? usage
      for (const choice of chunk.choices ?? []) {
        stopReason = choice.finish_reason ?? stopReason
        const delta = choice.delta
        if (!delta) continue

        if (delta.reasoning_content) {
          if (reasoningIndex === undefined || reasoningClosed) {
            reasoningIndex = nextBlockIndex++
            reasoningClosed = false
            yield this.streamEvent({
              type: 'content_block_start',
              index: reasoningIndex,
              content_block: {
                type: 'thinking',
                thinking: '',
                signature: '',
              },
            })
          }
          reasoning += delta.reasoning_content
          yield this.streamEvent({
            type: 'content_block_delta',
            index: reasoningIndex,
            delta: {
              type: 'thinking_delta',
              thinking: delta.reasoning_content,
            },
          })
        }

        if (delta.content) {
          if (textIndex === undefined || textClosed) {
            textIndex = nextBlockIndex++
            textClosed = false
            yield this.streamEvent({
              type: 'content_block_start',
              index: textIndex,
              content_block: {
                type: 'text',
                text: '',
              },
            })
          }
          text += delta.content
          yield this.streamEvent({
            type: 'content_block_delta',
            index: textIndex,
            delta: {
              type: 'text_delta',
              text: delta.content,
            },
          })
        }

        for (const toolCallDelta of delta.tool_calls ?? []) {
          const index = toolCallDelta.index ?? toolCalls.size
          const existing = toolCalls.get(index) ?? {
            argumentsText: '',
            started: false,
          }
          const nextToolCall = {
            id: toolCallDelta.id ?? existing.id,
            name: toolCallDelta.function?.name ?? existing.name,
            argumentsText:
              existing.argumentsText + (toolCallDelta.function?.arguments ?? ''),
            blockIndex: existing.blockIndex,
            started: existing.started,
          }
          toolCalls.set(index, nextToolCall)

          if (!nextToolCall.started && nextToolCall.name) {
            if (reasoningIndex !== undefined && !reasoningClosed) {
              yield this.streamEvent({
                type: 'content_block_stop',
                index: reasoningIndex,
              })
              reasoningClosed = true
            }
            if (textIndex !== undefined && !textClosed) {
              yield this.streamEvent({
                type: 'content_block_stop',
                index: textIndex,
              })
              textClosed = true
            }
            nextToolCall.blockIndex = nextBlockIndex++
            nextToolCall.started = true
            yield this.streamEvent({
              type: 'content_block_start',
              index: nextToolCall.blockIndex,
              content_block: {
                type: 'tool_use',
                id: nextToolCall.id || `tool_${index}`,
                name: nextToolCall.name,
                input: {},
              },
            })
          }

          const argumentsDelta = toolCallDelta.function?.arguments ?? ''
          if (
            nextToolCall.started &&
            nextToolCall.blockIndex !== undefined &&
            argumentsDelta
          ) {
            yield this.streamEvent({
              type: 'content_block_delta',
              index: nextToolCall.blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: argumentsDelta,
              },
            })
          }
        }
      }
    }

    if (reasoningIndex !== undefined && !reasoningClosed) {
      yield this.streamEvent({
        type: 'content_block_stop',
        index: reasoningIndex,
      })
      reasoningClosed = true
    }
    if (textIndex !== undefined && !textClosed) {
      yield this.streamEvent({
        type: 'content_block_stop',
        index: textIndex,
      })
      textClosed = true
    }
    for (const toolCall of toolCalls.values()) {
      if (toolCall.started && toolCall.blockIndex !== undefined) {
        yield this.streamEvent({
          type: 'content_block_stop',
          index: toolCall.blockIndex,
        })
      }
    }

    const anthropicUsage = this.toAnthropicUsage(usage)
    if (anthropicUsage) {
      addToTotalSessionCost(
        this.calculateCost(model, anthropicUsage),
        anthropicUsage,
        model,
      )
    }

    yield this.streamEvent({
      type: 'message_delta',
      delta: {
        stop_reason: this.mapFinishReason(stopReason),
        stop_sequence: null,
      },
      usage:
        anthropicUsage ?? {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
    })
    yield this.streamEvent({ type: 'message_stop' })

    yield createAssistantMessage({
      content: this.buildAssistantContentBlocks({
        text,
        reasoning,
        toolCalls: Array.from(toolCalls.values()),
      }) as never,
      usage: anthropicUsage as never,
    })
  }

  private async *iterSSEChunks(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<OpenAIStreamChunk, void> {
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
          const chunk = this.parseSSEEvent(rawEvent)
          if (chunk) {
            yield chunk
          }
          separatorIndex = buffer.indexOf('\n\n')
        }
      }

      buffer += decoder.decode()
      const trailing = this.parseSSEEvent(buffer)
      if (trailing) {
        yield trailing
      }
    } finally {
      reader.releaseLock()
    }
  }

  private parseSSEEvent(rawEvent: string): OpenAIStreamChunk | undefined {
    const data = rawEvent
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim()

    if (!data || data === '[DONE]') {
      return undefined
    }

    return safeParseJSON(data) as OpenAIStreamChunk | undefined
  }

  private streamEvent(event: Record<string, unknown>, ttftMs?: number): StreamEvent {
    return {
      type: 'stream_event',
      event,
      ...(ttftMs !== undefined ? { ttftMs } : {}),
    }
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

  private toAssistantMessage(
    response: OpenAIResponse,
    usage = this.toAnthropicUsage(response.usage),
  ): AssistantMessage {
    const choice = response.choices?.[0]
    const message = choice?.message

    return createAssistantMessage({
      content: this.buildAssistantContentBlocks({
        text: message?.content ?? '',
        reasoning: message?.reasoning_content ?? '',
        toolCalls: (message?.tool_calls ?? []).map(toolCall => ({
          id: toolCall.id,
          name: toolCall.function?.name,
          argumentsText: toolCall.function?.arguments ?? '',
        })),
      }) as never,
      usage: usage as never,
    })
  }

  private toSideQueryResponse(
    response: OpenAIResponse,
    requestedModel: string,
  ): LLMSideQueryResponse {
    const choice = response.choices?.[0]
    const toolBlocks = (choice?.message?.tool_calls ?? []).map(toolCall => ({
      type: 'tool_use' as const,
      id: toolCall.id || randomUUID(),
      name: toolCall.function?.name || 'unknown_tool',
      input: this.parseToolArguments(toolCall.function?.arguments),
    }))
    const textBlock = choice?.message?.content
      ? [{ type: 'text' as const, text: choice.message.content }]
      : []
    const thinkingBlock = choice?.message?.reasoning_content
      ? [
          {
            type: 'thinking' as const,
            thinking: choice.message.reasoning_content,
            signature: '',
          },
        ]
      : []

    return {
      id: response.id || randomUUID(),
      model: response.model || requestedModel,
      content: [...thinkingBlock, ...textBlock, ...toolBlocks],
      stop_reason: this.mapFinishReason(choice?.finish_reason ?? null),
      usage: this.toSideQueryUsage(response.usage),
    }
  }

  private buildAssistantContentBlocks({
    text,
    reasoning,
    toolCalls,
  }: {
    text: string
    reasoning: string
    toolCalls: StreamingToolCall[]
  }): unknown {
    const contentBlocks = [
      ...(reasoning
        ? [
            {
              type: 'thinking' as const,
              thinking: reasoning,
              signature: '',
            },
          ]
        : []),
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map(toolCall => ({
        type: 'tool_use' as const,
        id: toolCall.id || randomUUID(),
        name: toolCall.name || 'unknown_tool',
        input: this.parseToolArguments(toolCall.argumentsText),
      })),
    ]

    return contentBlocks.length > 0 ? contentBlocks : ''
  }

  private mapFinishReason(finishReason: string | null | undefined): string | null {
    if (finishReason === 'tool_calls') return 'tool_use'
    if (finishReason === 'length') return 'max_tokens'
    if (finishReason === 'stop') return 'end_turn'
    return finishReason ?? null
  }

  private toSideQueryUsage(
    usage: OpenAIResponse['usage'],
  ): LLMSideQueryUsage {
    const promptCacheHitTokens = usage?.prompt_cache_hit_tokens ?? 0
    const promptCacheMissTokens =
      usage?.prompt_cache_miss_tokens ??
      Math.max((usage?.prompt_tokens ?? 0) - promptCacheHitTokens, 0)

    return {
      input_tokens: promptCacheMissTokens,
      output_tokens: usage?.completion_tokens ?? 0,
      cache_read_input_tokens: promptCacheHitTokens,
    }
  }

  private toAnthropicUsage(
    usage: OpenAIResponse['usage'],
  ): Usage | undefined {
    if (!usage) {
      return undefined
    }
    const promptCacheHitTokens = usage.prompt_cache_hit_tokens ?? 0
    const promptCacheMissTokens =
      usage.prompt_cache_miss_tokens ??
      Math.max((usage.prompt_tokens ?? 0) - promptCacheHitTokens, 0)
    return {
      input_tokens: promptCacheMissTokens,
      output_tokens: usage.completion_tokens ?? 0,
      cache_read_input_tokens: promptCacheHitTokens,
    }
  }

  private parseToolArguments(argumentsText: string | undefined): unknown {
    if (!argumentsText) return {}
    try {
      return JSON.parse(argumentsText)
    } catch {
      return { raw: argumentsText }
    }
  }

  private calculateCost(model: string, usage: Usage): number {
    if (!shouldTrackLLMProfileDollarCost(this.profile)) return 0
    return calculateUSDCost(model, usage)
  }

  private toProviderModel(model: string): string {
    return normalizeModelStringForAPI(model)
  }

  private flattenContent(content: unknown): string {
    if (typeof content === 'string') {
      return content
    }
    if (!Array.isArray(content)) {
      return ''
    }
    return content
      .map(block => {
        if (!block || typeof block !== 'object') return ''
        if ('text' in block && typeof block.text === 'string') {
          return block.text
        }
        if ('type' in block && block.type === 'tool_result' && 'content' in block) {
          return this.flattenContent(block.content)
        }
        if ('type' in block && typeof block.type === 'string') {
          return `[${block.type}]`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
}
