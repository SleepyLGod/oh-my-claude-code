import { getInitialSettings } from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import type { LLMProfileType } from './types.js'

export type LLMProfileStreamingMode = 'auto' | 'enabled' | 'disabled'

export type LLMProfileConfig = {
  type: LLMProfileType
  baseURL?: string
  apiKeyEnv?: string
  defaultModel?: string
  headers?: Record<string, string>
  displayName?: string
  suggestedModels?: string[]
  streaming?: LLMProfileStreamingMode
}

export type ResolvedLLMProfile = LLMProfileConfig & {
  name: string
}

const DEFAULT_PROFILE_NAME = 'anthropic'

const BUILTIN_PROFILES: Record<string, LLMProfileConfig> = {
  anthropic: {
    type: 'anthropic',
    displayName: 'Anthropic',
    suggestedModels: ['sonnet', 'opus', 'haiku'],
    streaming: 'enabled',
  },
  mock: {
    type: 'mock',
    defaultModel: 'mock-model',
    displayName: 'Mock',
    suggestedModels: ['mock-model'],
    streaming: 'enabled',
  },
  openai: {
    type: 'openai_compat',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4.1',
    displayName: 'OpenAI',
    suggestedModels: ['gpt-4.1', 'gpt-4.1-mini', 'o3'],
    streaming: 'enabled',
  },
  deepseek: {
    type: 'openai_compat',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-pro',
    displayName: 'DeepSeek',
    suggestedModels: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
    streaming: 'enabled',
  },
  qwen: {
    type: 'openai_compat',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    defaultModel: 'qwen-plus',
    displayName: 'Qwen',
    suggestedModels: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    streaming: 'enabled',
  },
}

function getSettingsProfiles(
  settings: SettingsJson,
): Record<string, LLMProfileConfig> {
  return settings.llm?.profiles ?? {}
}

export function getActiveLLMProfileName(settings = getInitialSettings()): string {
  return (
    process.env.CLAUDE_CODE_LLM_PROFILE ||
    settings.llm?.providerProfile ||
    DEFAULT_PROFILE_NAME
  )
}

export function getResolvedLLMProfileByName(
  profileName: string,
  settings = getInitialSettings(),
): ResolvedLLMProfile {
  const profiles = getSettingsProfiles(settings)
  const configured = profiles[profileName]
  const builtin = BUILTIN_PROFILES[profileName]

  if (configured) {
    return {
      name: profileName,
      ...(builtin ?? {}),
      ...configured,
    }
  }

  if (builtin) {
    return {
      name: profileName,
      ...builtin,
    }
  }

  return {
    name: DEFAULT_PROFILE_NAME,
    ...BUILTIN_PROFILES[DEFAULT_PROFILE_NAME],
  }
}

export function getResolvedLLMProfile(
  settings = getInitialSettings(),
): ResolvedLLMProfile {
  return getResolvedLLMProfileByName(getActiveLLMProfileName(settings), settings)
}

export function getLLMProfileNames(settings = getInitialSettings()): string[] {
  const configuredNames = Object.keys(getSettingsProfiles(settings))
  return Array.from(
    new Set([
      ...Object.keys(BUILTIN_PROFILES),
      DEFAULT_PROFILE_NAME,
      ...configuredNames,
    ]),
  )
}

export function getDefaultModelForActiveProfile(
  settings = getInitialSettings(),
): string | undefined {
  return getResolvedLLMProfile(settings).defaultModel
}

export function getBuiltinLLMProfile(
  profileName: string,
): LLMProfileConfig | undefined {
  return BUILTIN_PROFILES[profileName]
}

export function getLLMProfileDisplayName(
  profileName: string,
  settings = getInitialSettings(),
): string {
  const profile = getResolvedLLMProfileByName(profileName, settings)
  return profile.displayName || profile.name
}

export function getSuggestedModelsForProfile(
  profileName: string,
  settings = getInitialSettings(),
): string[] {
  return getResolvedLLMProfileByName(profileName, settings).suggestedModels ?? []
}
