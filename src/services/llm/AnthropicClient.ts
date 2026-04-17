import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
} from '@anthropic-ai/sdk'
import {
  queryModelWithStreaming,
  type Options as AnthropicOptions,
} from 'src/services/api/claude.js'
import { MODEL_ALIASES } from 'src/utils/model/aliases.js'
import { isModelAllowed } from 'src/utils/model/modelAllowlist.js'
import { get3PFallbackSuggestion } from 'src/utils/model/validateModelShared.js'
import { anthropicSideQuery } from './anthropicSideQuery.js'
import type {
  LLMClient,
  LLMClientCapabilities,
  LLMMainQueryRequest,
  LLMSideQueryRequest,
  LLMSideQueryResponse,
} from './types.js'

export class AnthropicClient implements LLMClient {
  constructor(public readonly profileName: string) {}

  getCapabilities(): LLMClientCapabilities {
    return {
      providerType: 'anthropic',
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsThinking: true,
    }
  }

  streamMainQuery(
    request: LLMMainQueryRequest,
  ): ReturnType<typeof queryModelWithStreaming> {
    return queryModelWithStreaming({
      ...request,
      options: request.options as AnthropicOptions,
    })
  }

  sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse> {
    return anthropicSideQuery(request)
  }

  async validateModel(
    model: string,
  ): Promise<{ valid: boolean; error?: string }> {
    const normalizedModel = model.trim()

    if (!normalizedModel) {
      return { valid: false, error: 'Model name cannot be empty' }
    }

    if (!isModelAllowed(normalizedModel)) {
      return {
        valid: false,
        error: `Model '${normalizedModel}' is not in the list of available models`,
      }
    }

    const lowerModel = normalizedModel.toLowerCase()
    if ((MODEL_ALIASES as readonly string[]).includes(lowerModel)) {
      return { valid: true }
    }

    if (normalizedModel === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION) {
      return { valid: true }
    }

    try {
      await this.sideQuery({
        model: normalizedModel,
        max_tokens: 1,
        maxRetries: 0,
        querySource: 'model_validation',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Hi',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      })

      return { valid: true }
    } catch (error) {
      return handleAnthropicValidationError(error, normalizedModel)
    }
  }
}

function handleAnthropicValidationError(
  error: unknown,
  modelName: string,
): { valid: boolean; error: string } {
  if (error instanceof NotFoundError) {
    const fallback = get3PFallbackSuggestion(modelName)
    const suggestion = fallback ? `. Try '${fallback}' instead` : ''
    return {
      valid: false,
      error: `Model '${modelName}' not found${suggestion}`,
    }
  }

  if (error instanceof APIError) {
    if (error instanceof AuthenticationError) {
      return {
        valid: false,
        error: 'Authentication failed. Please check your API credentials.',
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
      }
    }

    const errorBody = error.error as unknown
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'type' in errorBody &&
      errorBody.type === 'not_found_error' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string' &&
      errorBody.message.includes('model:')
    ) {
      return { valid: false, error: `Model '${modelName}' not found` }
    }

    return { valid: false, error: `API error: ${error.message}` }
  }

  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}
