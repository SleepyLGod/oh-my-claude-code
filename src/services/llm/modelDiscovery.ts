import { getLLMClient } from './factory.js'
import {
  getResolvedLLMProfileByName,
  getSuggestedModelsForProfile,
} from './config.js'
import type { LLMModelInfo } from './types.js'

const cache = new Map<string, Promise<LLMModelInfo[]>>()

export async function discoverModelsForProfile(
  profileName: string,
): Promise<LLMModelInfo[]> {
  const profile = getResolvedLLMProfileByName(profileName)
  if (profile.supportsModelList === false) {
    return []
  }

  let promise = cache.get(profileName)
  if (!promise) {
    promise = getLLMClient(profileName).listModels().catch(error => {
      cache.delete(profileName)
      throw error
    })
    cache.set(profileName, promise)
  }
  return promise
}

export function clearModelDiscoveryCache(profileName?: string): void {
  if (profileName) {
    cache.delete(profileName)
    return
  }
  cache.clear()
}

export function mergeModelSuggestions(
  profileName: string,
  discovered: LLMModelInfo[],
): LLMModelInfo[] {
  const profile = getResolvedLLMProfileByName(profileName)
  const seen = new Set<string>()
  const merged: LLMModelInfo[] = []

  for (const id of getSuggestedModelsForProfile(profileName)) {
    addModel(merged, seen, { id })
  }
  for (const model of discovered) {
    addModel(merged, seen, model)
  }

  if (profile.type === 'anthropic_compat' && profile.supportsThinking !== false) {
    const withVariants: LLMModelInfo[] = []
    const variantSeen = new Set<string>()
    for (const model of merged) {
      addModel(withVariants, variantSeen, model)
      if (model.supportsThinking !== false) {
        addModel(withVariants, variantSeen, {
          id: `${model.id}[no-thinking]`,
          displayName: `${model.displayName ?? model.id} (no thinking)`,
          supportsThinking: false,
        })
      }
    }
    return withVariants
  }

  return merged
}

function addModel(
  target: LLMModelInfo[],
  seen: Set<string>,
  model: LLMModelInfo,
): void {
  const id = model.id.trim()
  if (!id || seen.has(id)) return
  seen.add(id)
  target.push({ ...model, id })
}
