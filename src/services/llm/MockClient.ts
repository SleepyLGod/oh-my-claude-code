import { createAssistantMessage } from 'src/utils/messages.js'
import type {
  LLMClient,
  LLMClientCapabilities,
  LLMModelInfo,
  LLMMainQueryRequest,
  LLMSideQueryRequest,
  LLMSideQueryResponse,
} from './types.js'

export class MockClient implements LLMClient {
  constructor(public readonly profileName: string) {}

  getCapabilities(): LLMClientCapabilities {
    return {
      providerType: 'mock',
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsThinking: false,
    }
  }

  async *streamMainQuery(
    request: LLMMainQueryRequest,
  ): AsyncGenerator<ReturnType<typeof createAssistantMessage>, void> {
    const model = request.options.model || 'mock-model'
    yield createAssistantMessage({
      content: `Mock response from ${model}`,
      usage: { input_tokens: 0, output_tokens: 0 } as never,
    })
  }

  async sideQuery(request: LLMSideQueryRequest): Promise<LLMSideQueryResponse> {
    return {
      id: 'mock-side-query',
      model: request.model,
      content: [{ type: 'text', text: 'Mock side query response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    }
  }

  async validateModel(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true }
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return [{ id: 'mock-model' }]
  }
}
