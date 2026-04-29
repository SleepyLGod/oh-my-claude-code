import type { Notification } from 'src/context/notifications.js'
import type { AgentDefinition } from 'src/tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from 'src/types/ids.js'
import type { ToolPermissionContext, Tools } from 'src/Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from 'src/types/message.js'
import type { QuerySource } from 'src/constants/querySource.js'
import type { EffortValue } from 'src/utils/effort.js'
import type { SystemPrompt } from 'src/utils/systemPromptType.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'

export type LLMProfileType =
  | 'anthropic'
  | 'anthropic_compat'
  | 'openai_compat'
  | 'mock'

export type LLMToolChoice =
  | { type: 'auto' | 'any' }
  | { type: 'tool'; name: string }

export type LLMOutputFormat =
  | {
      type: 'json_schema'
      schema: Record<string, unknown>
    }
  | Record<string, unknown>

export type LLMSideQueryTextBlock = {
  type: 'text'
  text: string
  [key: string]: unknown
}

export type LLMSideQueryToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  [key: string]: unknown
}

export type LLMSideQueryContentBlock =
  | LLMSideQueryTextBlock
  | LLMSideQueryToolUseBlock
  | {
      type: string
      [key: string]: unknown
    }

export type LLMSideQueryMessage = {
  role: 'user' | 'assistant'
  content: string | LLMSideQueryContentBlock[]
}

export type LLMSideQueryTool = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  [key: string]: unknown
}

export type LLMSideQueryUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type LLMSideQueryResponse = {
  id: string
  model: string
  content: LLMSideQueryContentBlock[]
  stop_reason?: string | null
  usage: LLMSideQueryUsage
  _request_id?: string
}

export type LLMMainQueryOptions = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: LLMToolChoice
  isNonInteractiveSession: boolean
  extraToolSchemas?: unknown[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: typeof fetch
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: { chainId: string; depth: number }
  agentId?: AgentId
  outputFormat?: LLMOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: Notification) => void
  taskBudget?: { total: number; remaining?: number }
}

export type LLMMainQueryRequest = {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: LLMMainQueryOptions
}

export type LLMSideQueryRequest = {
  model: string
  system?: string | Array<{ type: 'text'; text: string; [key: string]: unknown }>
  messages: LLMSideQueryMessage[]
  tools?: LLMSideQueryTool[]
  tool_choice?: LLMToolChoice
  output_format?: LLMOutputFormat
  max_tokens?: number
  maxRetries?: number
  signal?: AbortSignal
  skipSystemPromptPrefix?: boolean
  temperature?: number
  thinking?: number | false
  stop_sequences?: string[]
  querySource: QuerySource
}

export type LLMClientCapabilities = {
  providerType: LLMProfileType
  supportsStreaming: boolean
  supportsToolCalling: boolean
  supportsThinking: boolean
}

export interface LLMClient {
  readonly profileName: string

  getCapabilities(): LLMClientCapabilities
  streamMainQuery(
    request: LLMMainQueryRequest,
  ): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void>
  sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse>
  validateModel(model: string): Promise<{ valid: boolean; error?: string }>
}
