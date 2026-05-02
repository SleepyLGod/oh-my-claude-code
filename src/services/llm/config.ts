import { getInitialSettings } from 'src/utils/settings/settings.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import type { LLMProfileType } from './types.js'

export type LLMProfileStreamingMode = 'auto' | 'enabled' | 'disabled'

export type LLMProfileConfig = {
  type: LLMProfileType
  baseURL?: string
  apiKeyEnv?: string
  apiKeyEnvFallbacks?: string[]
  apiKeyHeader?: 'x-api-key' | 'authorization-bearer'
  requiresApiKey?: boolean
  billingMode?: 'token' | 'subscription' | 'local' | 'unknown'
  defaultModel?: string
  headers?: Record<string, string>
  displayName?: string
  suggestedModels?: string[]
  streaming?: LLMProfileStreamingMode
  includeUsageInStream?: boolean
  supportsModelList?: boolean
  supportsThinking?: boolean
  supportsToolCalls?: boolean
  supportsUsage?: boolean
  localServer?: boolean
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
    includeUsageInStream: true,
    supportsModelList: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  deepseek: {
    type: 'openai_compat',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-pro[1m]',
    displayName: 'DeepSeek',
    suggestedModels: [
      'deepseek-v4-flash[1m]',
      'deepseek-v4-pro[1m]',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
    streaming: 'enabled',
    includeUsageInStream: true,
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  'deepseek-anthropic': {
    type: 'anthropic_compat',
    baseURL: 'https://api.deepseek.com/anthropic',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKeyHeader: 'x-api-key',
    defaultModel: 'deepseek-v4-pro[1m]',
    displayName: 'DeepSeek (Anthropic)',
    suggestedModels: [
      'deepseek-v4-flash[1m]',
      'deepseek-v4-pro[1m]',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
    streaming: 'enabled',
    supportsModelList: false,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  qwen: {
    type: 'openai_compat',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    apiKeyEnvFallbacks: ['DASHSCOPE_API_KEY'],
    defaultModel: 'qwen-plus',
    displayName: 'Qwen',
    suggestedModels: [
      'qwen-plus',
      'qwen-plus-latest',
      'qwen-flash',
      'qwen-turbo',
      'qwen-max',
      'qwen-max-latest',
      'qwen3-max',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    streaming: 'enabled',
    includeUsageInStream: true,
    supportsModelList: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  'qwen-anthropic': {
    type: 'anthropic_compat',
    baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnv: 'QWEN_API_KEY',
    apiKeyEnvFallbacks: ['DASHSCOPE_API_KEY'],
    apiKeyHeader: 'x-api-key',
    defaultModel: 'qwen3.5-plus',
    displayName: 'Qwen (Anthropic)',
    suggestedModels: [
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-max',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    streaming: 'enabled',
    supportsModelList: false,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  'qwen-coding-openai': {
    type: 'openai_compat',
    baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
    apiKeyEnv: 'BAILIAN_CODING_PLAN_API_KEY',
    apiKeyEnvFallbacks: ['DASHSCOPE_CODING_API_KEY', 'QWEN_CODING_API_KEY'],
    defaultModel: 'qwen3.6-plus',
    displayName: 'Qwen Coding (OpenAI)',
    suggestedModels: [
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    streaming: 'enabled',
    includeUsageInStream: true,
    billingMode: 'subscription',
    supportsModelList: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  'qwen-coding-anthropic': {
    type: 'anthropic_compat',
    baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnv: 'BAILIAN_CODING_PLAN_API_KEY',
    apiKeyEnvFallbacks: ['DASHSCOPE_CODING_API_KEY', 'QWEN_CODING_API_KEY'],
    apiKeyHeader: 'authorization-bearer',
    defaultModel: 'qwen3.6-plus',
    displayName: 'Qwen Coding (Anthropic)',
    suggestedModels: [
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
    streaming: 'enabled',
    billingMode: 'subscription',
    supportsModelList: false,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  openrouter: {
    type: 'openai_compat',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/auto',
    displayName: 'OpenRouter',
    headers: {
      'HTTP-Referer': 'https://github.com/anthropics/claude-code',
      'X-Title': 'Von Claude Code',
    },
    suggestedModels: [
      'openrouter/auto',
      'deepseek/deepseek-chat',
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-4.1',
    ],
    streaming: 'enabled',
    includeUsageInStream: true,
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  nvidia_nim: {
    type: 'openai_compat',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    apiKeyEnvFallbacks: ['NVIDIA_NIM_API_KEY'],
    defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    displayName: 'NVIDIA NIM',
    suggestedModels: [
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
    ],
    streaming: 'enabled',
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
  },
  ollama: {
    type: 'openai_compat',
    baseURL: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    defaultModel: 'llama3.1',
    displayName: 'Ollama',
    suggestedModels: ['llama3.1', 'qwen2.5-coder', 'mistral'],
    streaming: 'enabled',
    includeUsageInStream: true,
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: true,
    localServer: true,
  },
  lmstudio: {
    type: 'openai_compat',
    baseURL: 'http://127.0.0.1:1234/v1',
    requiresApiKey: false,
    defaultModel: 'local-model',
    displayName: 'LM Studio',
    suggestedModels: ['local-model'],
    streaming: 'enabled',
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: false,
    localServer: true,
  },
  llamacpp: {
    type: 'openai_compat',
    baseURL: 'http://127.0.0.1:8080/v1',
    requiresApiKey: false,
    defaultModel: 'local-model',
    displayName: 'llama.cpp',
    suggestedModels: ['local-model'],
    streaming: 'enabled',
    supportsModelList: true,
    supportsThinking: true,
    supportsToolCalls: true,
    supportsUsage: false,
    localServer: true,
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

export function isThirdPartyLLMProfile(profile: LLMProfileConfig): boolean {
  return profile.type === 'openai_compat' || profile.type === 'anthropic_compat'
}

export function getLLMProfileProtocolLabel(profile: LLMProfileConfig): string {
  if (profile.type === 'openai_compat') return 'OpenAI-compatible'
  if (profile.type === 'anthropic_compat') return 'Anthropic-compatible'
  if (profile.type === 'anthropic') return 'Claude-native'
  return profile.type
}

export function getLLMProfileApiKeyEnvNames(
  profile: LLMProfileConfig,
): string[] {
  return [profile.apiKeyEnv, ...(profile.apiKeyEnvFallbacks ?? [])].filter(
    (envName): envName is string => !!envName,
  )
}

export function getConfiguredLLMProfileApiKeyEnv(
  profile: LLMProfileConfig,
): string | undefined {
  return getLLMProfileApiKeyEnvNames(profile).find(
    envName => !!process.env[envName],
  )
}

export function shouldTrackLLMProfileDollarCost(
  profile: LLMProfileConfig,
): boolean {
  return (profile.billingMode ?? 'token') === 'token'
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
