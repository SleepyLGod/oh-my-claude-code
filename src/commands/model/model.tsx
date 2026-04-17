import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { MultiProviderModelPicker } from '../../components/MultiProviderModelPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  getActiveLLMProfileName,
  getLLMProfileDisplayName,
  getLLMProfileNames,
  getResolvedLLMProfileByName,
} from '../../services/llm/config.js'
import { buildLLMSelectionSettingsPatch } from '../../services/llm/selection.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { EffortLevel } from '../../utils/effort.js'
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js'
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import {
  checkOpus1mAccess,
  checkSonnet1mAccess,
} from '../../utils/model/check1mAccess.js'
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js'
import { validateModel } from '../../utils/model/validateModel.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

type ParsedModelArgs = {
  profileName: string
  model: string | null
  isProfileSwitchOnly: boolean
}

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const isFastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const currentProfileName = getActiveLLMProfileName()

  return (
    <MultiProviderModelPicker
      initialModel={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      currentProfileName={currentProfileName}
      showFastModeNotice={
        isFastModeEnabled() &&
        !!isFastMode &&
        isFastModeSupportedByModel(mainLoopModel) &&
        isFastModeAvailable()
      }
      onSelect={(profileName, model, effort) =>
        commitSelection({
          profileName,
          model,
          effort,
          isFastMode: !!isFastMode,
          setAppState,
          onDone,
          previousModel: mainLoopModel,
          currentProfileName,
        })
      }
      onCancel={() => {
        logEvent('tengu_model_command_menu', {
          action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        onDone(
          `Kept ${chalk.bold(getSelectionLabel(currentProfileName, mainLoopModel))}`,
          {
            display: 'system',
          },
        )
      }}
    />
  )
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const isFastMode = useAppState(s => s.fastMode)
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const setAppState = useSetAppState()

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      const parsed = parseModelArgs(args)
      if (!parsed) {
        onDone(
          `Unknown provider profile or model '${args}'. Use /model for the picker.`,
          {
            display: 'system',
          },
        )
        return
      }

      if (parsed.model) {
        if (isAnthropic1mUnavailable(parsed.profileName, parsed.model)) {
          onDone(
            `Selected Anthropic model is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
            { display: 'system' },
          )
          return
        }

        try {
          const { valid, error } = await validateModel(
            parsed.model,
            parsed.profileName,
          )
          if (!valid) {
            onDone(error || `Model '${parsed.model}' not found`, {
              display: 'system',
            })
            return
          }
        } catch (error) {
          onDone(`Failed to validate model: ${(error as Error).message}`, {
            display: 'system',
          })
          return
        }
      }

      commitSelection({
        profileName: parsed.profileName,
        model: parsed.model,
        effort: undefined,
        isFastMode: !!isFastMode,
        setAppState,
        onDone,
        previousModel: mainLoopModel,
        currentProfileName: getActiveLLMProfileName(),
        isProfileSwitchOnly: parsed.isProfileSwitchOnly,
      })
    }

    void handleModelChange()
  }, [args, isFastMode, mainLoopModel, onDone, setAppState])

  return null
}

function parseModelArgs(args: string): ParsedModelArgs | null {
  const trimmed = args.trim()
  const activeProfileName = getActiveLLMProfileName()
  const knownProfiles = new Set(getLLMProfileNames())

  if (!trimmed) {
    return null
  }

  if (trimmed.includes(':')) {
    const [rawProfileName, ...rest] = trimmed.split(':')
    const profileName = rawProfileName?.trim() || ''
    const model = rest.join(':').trim()
    if (!knownProfiles.has(profileName)) {
      return null
    }
    return {
      profileName,
      model: model === '' || model === 'default' ? null : model,
      isProfileSwitchOnly: model === '' || model === 'default',
    }
  }

  if (knownProfiles.has(trimmed)) {
    return {
      profileName: trimmed,
      model: null,
      isProfileSwitchOnly: true,
    }
  }

  return {
    profileName: activeProfileName,
    model: trimmed === 'default' ? null : trimmed,
    isProfileSwitchOnly: false,
  }
}

function commitSelection({
  profileName,
  model,
  effort,
  isFastMode,
  setAppState,
  onDone,
  previousModel,
  currentProfileName,
  isProfileSwitchOnly = false,
}: {
  profileName: string
  model: string | null
  effort: EffortLevel | undefined
  isFastMode: boolean
  setAppState: ReturnType<typeof useSetAppState>
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  previousModel: string | null
  currentProfileName: string
  isProfileSwitchOnly?: boolean
}): void {
  const currentSettings = getSettings_DEPRECATED() || {}
  updateSettingsForSource(
    'userSettings',
    buildLLMSelectionSettingsPatch(currentSettings, {
      profileName,
      model,
    }),
  )

  const selectedProfile = getResolvedLLMProfileByName(profileName)
  const supportsFastMode =
    selectedProfile.type === 'anthropic' && isFastModeSupportedByModel(model)
  const wasFastModeToggledOff = isFastModeEnabled() && isFastMode && !supportsFastMode

  if (isFastModeEnabled()) {
    clearFastModeCooldown()
  }

  setAppState(prev => ({
    ...prev,
    mainLoopModel: model,
    mainLoopModelForSession: null,
    ...(wasFastModeToggledOff ? { fastMode: false } : {}),
  }))

  const selectionLabel = getSelectionLabel(profileName, model)
  let message = isProfileSwitchOnly
    ? `Set provider to ${chalk.bold(selectionLabel)}`
    : `Set ${chalk.bold(selectionLabel)}`

  if (effort !== undefined) {
    message += ` with ${chalk.bold(effort)} effort`
  }

  if (
    isBilledAsExtraUsage(
      model,
      isFastModeEnabled() && isFastMode && !wasFastModeToggledOff,
      isOpus1mMergeEnabled(),
    )
  ) {
    message += ' · Billed as extra usage'
  }

  if (wasFastModeToggledOff) {
    message += ' · Fast mode OFF'
  }

  logEvent('tengu_model_command_menu', {
    action: selectionLabel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    from_model: previousModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    to_model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  if (profileName !== currentProfileName) {
    logEvent('tengu_provider_profile_changed', {
      profile: profileName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  onDone(message)
}

function isAnthropic1mUnavailable(profileName: string, model: string): boolean {
  if (getResolvedLLMProfileByName(profileName).type !== 'anthropic') {
    return false
  }

  const normalized = model.toLowerCase().trim()
  if (
    !checkOpus1mAccess() &&
    !isOpus1mMergeEnabled() &&
    normalized.includes('opus') &&
    normalized.includes('[1m]')
  ) {
    return true
  }

  return (
    !checkSonnet1mAccess() &&
    (normalized.includes('sonnet[1m]') ||
      normalized.includes('sonnet-4-6[1m]'))
  )
}

function ShowModelAndClose({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const effortValue = useAppState(s => s.effortValue)
  const profileName = getActiveLLMProfileName()
  const effortInfo =
    effortValue !== undefined ? ` (effort: ${effortValue})` : ''

  if (mainLoopModelForSession) {
    onDone(
      `Current selection: ${chalk.bold(getSelectionLabel(profileName, mainLoopModelForSession))} (session override from plan mode)\nBase selection: ${getSelectionLabel(profileName, mainLoopModel)}${effortInfo}`,
    )
  } else {
    onDone(
      `Current selection: ${getSelectionLabel(profileName, mainLoopModel)}${effortInfo}`,
    )
  }

  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <ShowModelAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /model to pick a provider and model, /model <profile> to switch provider, or /model <profile>:<model> to switch both.',
      { display: 'system' },
    )
    return
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <SetModelAndClose args={args} onDone={onDone} />
  }

  return <ModelPickerWrapper onDone={onDone} />
}

function getSelectionLabel(profileName: string, model: string | null): string {
  const profileDisplayName = getLLMProfileDisplayName(profileName)
  const profile = getResolvedLLMProfileByName(profileName)

  if (profile.type === 'anthropic') {
    const rendered = renderDefaultModelSetting(
      model ?? getDefaultMainLoopModelSetting(),
    )
    return `${profileDisplayName} · ${model === null ? `${rendered} (default)` : rendered}`
  }

  const modelLabel = model ?? `${profile.defaultModel ?? 'default'} (default)`
  return `${profileDisplayName} · ${modelLabel}`
}
