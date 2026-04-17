import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { getUserAgent } from 'src/utils/http.js'
import { createAssistantMessage } from 'src/utils/messages.js'
import { normalizeMessagesForAPI } from 'src/utils/messages.js'
import { safeParseJSON } from 'src/utils/json.js'
import { toolToAPISchema } from 'src/utils/api.js'
import type { Tool } from 'src/Tool.js'
import type { AssistantMessage } from 'src/types/message.js'
import type { LLMProfileConfig } from './config.js'
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
  }
}

export class OpenAICompatibleClient implements LLMClient {
  constructor(
    public readonly profileName: string,
    private readonly profile: LLMProfileConfig,
  ) {}

  getCapabilities(): LLMClientCapabilities {
    return {
      providerType: 'openai_compat',
      supportsStreaming: false,
      supportsToolCalling: true,
      supportsThinking: false,
    }
  }

  async *streamMainQuery(
    request: LLMMainQueryRequest,
  ): AsyncGenerator<AssistantMessage, void> {
    const tools = await this.buildToolsFromRuntime(request)
    const response = await this.createChatCompletion({
      model: request.options.model,
      messages: this.buildMainQueryMessages(request),
      max_tokens: request.options.maxOutputTokensOverride,
      temperature: request.options.temperatureOverride,
      tools,
      tool_choice: this.buildToolChoice(
        request.options.toolChoice,
        tools.length > 0,
      ),
    })

    yield this.toAssistantMessage(response)
  }

  async sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse> {
    const response = await this.createChatCompletion({
      model: request.model,
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
    })

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
  ): Promise<OpenAIResponse> {
    const baseURL = this.profile.baseURL
    if (!baseURL) {
      throw new Error(
        `LLM profile '${this.profileName}' requires llm.profiles.${this.profileName}.baseURL`,
      )
    }

    const apiKeyEnv = this.profile.apiKeyEnv || 'OPENAI_API_KEY'
    const apiKey = process.env[apiKeyEnv]
    if (!apiKey) {
      throw new Error(
        `Missing API key. Set ${apiKeyEnv} for LLM profile '${this.profileName}'.`,
      )
    }

    const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': getUserAgent(),
        'x-claude-code-session-id': getSessionId(),
        ...(this.profile.headers ?? {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(this.formatHttpError(response.status, text))
    }

    return (await response.json()) as OpenAIResponse
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

  private toAssistantMessage(response: OpenAIResponse): AssistantMessage {
    const choice = response.choices?.[0]
    const message = choice?.message
    const contentBlocks = [
      ...(message?.content
        ? [{ type: 'text' as const, text: message.content }]
        : []),
      ...((message?.tool_calls ?? []).map(toolCall => ({
        type: 'tool_use' as const,
        id: toolCall.id || randomUUID(),
        name: toolCall.function?.name || 'unknown_tool',
        input: this.parseToolArguments(toolCall.function?.arguments),
      })) ?? []),
    ]

    return createAssistantMessage({
      content: (contentBlocks.length > 0 ? contentBlocks : '') as string,
      usage: this.toAnthropicUsage(response.usage) as never,
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

    return {
      id: response.id || randomUUID(),
      model: response.model || requestedModel,
      content: [...textBlock, ...toolBlocks],
      stop_reason: choice?.finish_reason,
      usage: this.toSideQueryUsage(response.usage),
    }
  }

  private toSideQueryUsage(
    usage: OpenAIResponse['usage'],
  ): LLMSideQueryUsage {
    return {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    }
  }

  private toAnthropicUsage(
    usage: OpenAIResponse['usage'],
  ): { input_tokens: number; output_tokens: number } | undefined {
    if (!usage) {
      return undefined
    }
    return {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
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
