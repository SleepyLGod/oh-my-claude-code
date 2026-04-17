// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { MODEL_ALIASES } from './aliases.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getResolvedLLMProfile,
  getResolvedLLMProfileByName,
} from '../../services/llm/config.js'
import { getLLMClient } from '../../services/llm/factory.js'

// Cache valid models to avoid repeated API calls
const validModelCache = new Map<string, boolean>()

/**
 * Validates a model by attempting an actual API call.
 */
export async function validateModel(
  model: string,
  profileName?: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()

  // Empty model is invalid
  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  // Check against availableModels allowlist before any API call
  if (!isModelAllowed(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  // Check if it's a known alias (these are always valid)
  const lowerModel = normalizedModel.toLowerCase()
  const resolvedProfile = profileName
    ? getResolvedLLMProfileByName(profileName)
    : getResolvedLLMProfile()

  if (
    resolvedProfile.type === 'anthropic' &&
    (MODEL_ALIASES as readonly string[]).includes(lowerModel)
  ) {
    return { valid: true }
  }

  if (
    resolvedProfile.type === 'anthropic' &&
    normalizedModel === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  ) {
    return { valid: true }
  }

  const cacheKey = `${resolvedProfile.name}:${normalizedModel}`

  // Check cache first
  if (validModelCache.has(cacheKey)) {
    return { valid: true }
  }
  const result = await getLLMClient(profileName).validateModel(normalizedModel)
  if (result.valid) {
    validModelCache.set(cacheKey, true)
  }
  return result
}
