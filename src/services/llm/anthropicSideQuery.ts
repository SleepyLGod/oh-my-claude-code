import type Anthropic from '@anthropic-ai/sdk'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js'
import {
  getLastApiCompletionTimestamp,
  setLastApiCompletionTimestamp,
} from 'src/bootstrap/state.js'
import { STRUCTURED_OUTPUTS_BETA_HEADER } from 'src/constants/betas.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from 'src/constants/system.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getAPIMetadata } from 'src/services/api/claude.js'
import { getAnthropicClient } from 'src/services/api/client.js'
import { getModelBetas, modelSupportsStructuredOutputs } from 'src/utils/betas.js'
import { computeFingerprint } from 'src/utils/fingerprint.js'
import { normalizeModelStringForAPI } from 'src/utils/model/model.js'
import type {
  LLMSideQueryRequest,
  LLMSideQueryResponse,
  LLMSideQueryTool,
} from './types.js'

type MessageParam = Anthropic.MessageParam
type TextBlockParam = Anthropic.TextBlockParam
type Tool = Anthropic.Tool
type ToolChoice = Anthropic.ToolChoice
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat
type BetaThinkingConfigParam = Anthropic.Beta.Messages.BetaThinkingConfigParam

function extractFirstUserMessageText(messages: MessageParam[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) return ''

  const content = firstUserMessage.content
  if (typeof content === 'string') return content

  const textBlock = content.find(block => block.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

function toAnthropicTools(
  tools: LLMSideQueryTool[] | undefined,
): Array<Tool | BetaToolUnion> | undefined {
  return tools as unknown as Array<Tool | BetaToolUnion> | undefined
}

function toAnthropicMessages(
  messages: LLMSideQueryRequest['messages'],
): MessageParam[] {
  return messages as MessageParam[]
}

function toAnthropicSystem(
  system: LLMSideQueryRequest['system'],
): string | TextBlockParam[] | undefined {
  return system as string | TextBlockParam[] | undefined
}

function toAnthropicResponse(response: BetaMessage): LLMSideQueryResponse {
  return {
    id: response.id,
    model: response.model,
    content: response.content as LLMSideQueryResponse['content'],
    stop_reason: response.stop_reason,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    },
    _request_id:
      (response as { _request_id?: string | null })._request_id ?? undefined,
  }
}

export async function anthropicSideQuery(
  opts: LLMSideQueryRequest,
): Promise<LLMSideQueryResponse> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    output_format,
    max_tokens = 1024,
    maxRetries = 2,
    signal,
    skipSystemPromptPrefix,
    temperature,
    thinking,
    stop_sequences,
  } = opts

  const client = await getAnthropicClient({
    maxRetries,
    model,
    source: 'side_query',
  })
  const betas = [...getModelBetas(model)]
  if (
    output_format &&
    modelSupportsStructuredOutputs(model) &&
    !betas.includes(STRUCTURED_OUTPUTS_BETA_HEADER)
  ) {
    betas.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }

  const anthropicMessages = toAnthropicMessages(messages)
  const messageText = extractFirstUserMessageText(anthropicMessages)
  const fingerprint = computeFingerprint(messageText, MACRO.VERSION)
  const attributionHeader = getAttributionHeader(fingerprint)

  const systemBlocks: TextBlockParam[] = [
    attributionHeader ? { type: 'text', text: attributionHeader } : null,
    ...(skipSystemPromptPrefix
      ? []
      : [
          {
            type: 'text' as const,
            text: getCLISyspromptPrefix({
              isNonInteractive: false,
              hasAppendSystemPrompt: false,
            }),
          },
        ]),
    ...(Array.isArray(system)
      ? (toAnthropicSystem(system) ?? [])
      : system
        ? [{ type: 'text' as const, text: String(system) }]
        : []),
  ].filter((block): block is TextBlockParam => block !== null)

  let thinkingConfig: BetaThinkingConfigParam | undefined
  if (thinking === false) {
    thinkingConfig = { type: 'disabled' }
  } else if (thinking !== undefined) {
    thinkingConfig = {
      type: 'enabled',
      budget_tokens: Math.min(thinking, max_tokens - 1),
    }
  }

  const normalizedModel = normalizeModelStringForAPI(model)
  const start = Date.now()
  const response = await client.beta.messages.create(
    {
      model: normalizedModel,
      max_tokens,
      system: systemBlocks,
      messages: anthropicMessages,
      ...(tools && { tools: toAnthropicTools(tools) }),
      ...(tool_choice && { tool_choice: tool_choice as ToolChoice }),
      ...(output_format && {
        output_config: { format: output_format as BetaJSONOutputFormat },
      }),
      ...(temperature !== undefined && { temperature }),
      ...(stop_sequences && { stop_sequences }),
      ...(thinkingConfig && { thinking: thinkingConfig }),
      ...(betas.length > 0 && { betas }),
      metadata: getAPIMetadata(),
    },
    { signal },
  )

  const requestId =
    (response as { _request_id?: string | null })._request_id ?? undefined
  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('tengu_api_success', {
    requestId:
      requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      normalizedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  return toAnthropicResponse(response)
}
