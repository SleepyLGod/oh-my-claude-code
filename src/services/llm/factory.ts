import { getResolvedLLMProfile, getResolvedLLMProfileByName } from './config.js'
import { AnthropicClient } from './AnthropicClient.js'
import { MockClient } from './MockClient.js'
import { OpenAICompatibleClient } from './OpenAICompatibleClient.js'
import type { LLMClient } from './types.js'

export function getLLMClient(profileName?: string): LLMClient {
  const profile = profileName
    ? getResolvedLLMProfileByName(profileName)
    : getResolvedLLMProfile()

  switch (profile.type) {
    case 'openai_compat':
      return new OpenAICompatibleClient(profile.name, profile)
    case 'mock':
      return new MockClient(profile.name)
    case 'anthropic':
    default:
      return new AnthropicClient(profile.name)
  }
}
