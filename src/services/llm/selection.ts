import type { SettingsJson } from 'src/utils/settings/types.js'
import {
  getBuiltinLLMProfile,
  getLLMProfileDisplayName,
  getResolvedLLMProfileByName,
} from './config.js'

export type LLMSelection = {
  profileName: string
  model: string | null
}

export function buildLLMSelectionSettingsPatch(
  settings: SettingsJson,
  selection: LLMSelection,
): Pick<SettingsJson, 'llm' | 'model'> {
  const resolved = getResolvedLLMProfileByName(selection.profileName, settings)
  const currentLlm = settings.llm
  const nextProfiles = { ...(currentLlm?.profiles ?? {}) }

  if (resolved.type === 'anthropic') {
    return {
      model: selection.model ?? undefined,
      llm: {
        ...currentLlm,
        providerProfile: selection.profileName,
        profiles: nextProfiles,
      },
    }
  }

  const builtin = getBuiltinLLMProfile(selection.profileName)
  const existingProfile = nextProfiles[selection.profileName]
    ? { ...nextProfiles[selection.profileName] }
    : undefined

  if (selection.model === null) {
    if (!existingProfile) {
      delete nextProfiles[selection.profileName]
    } else {
      delete existingProfile.defaultModel
      if (builtin && isBuiltinProfileConfig(existingProfile, builtin)) {
        delete nextProfiles[selection.profileName]
      } else {
        nextProfiles[selection.profileName] = existingProfile
      }
    }
  } else {
    nextProfiles[selection.profileName] = {
      ...(existingProfile ?? { type: resolved.type }),
      defaultModel: selection.model,
    }
  }

  return {
    model: undefined,
    llm: {
      ...currentLlm,
      providerProfile: selection.profileName,
      profiles: nextProfiles,
    },
  }
}

function isBuiltinProfileConfig(
  profile: Record<string, unknown>,
  builtin: Record<string, unknown>,
): boolean {
  const profileKeys = Object.keys(profile)
  return (
    profileKeys.length > 0 &&
    profileKeys.every(key => profile[key] === builtin[key])
  )
}

export function getLLMSelectionDisplayValue(
  settings: SettingsJson,
  model: string | null,
): string {
  const resolved = getResolvedLLMProfileByName(
    settings.llm?.providerProfile || 'anthropic',
    settings,
  )
  const profileName = getLLMProfileDisplayName(resolved.name, settings)
  const modelName = model ?? resolved.defaultModel ?? 'default'
  return `${profileName} · ${modelName}`
}
