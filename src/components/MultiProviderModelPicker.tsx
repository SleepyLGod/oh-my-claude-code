import * as React from 'react'
import { Box, Text } from '../ink.js'
import type { EffortLevel } from '../utils/effort.js'
import {
  getActiveLLMProfileName,
  getConfiguredLLMProfileApiKeyEnv,
  getLLMProfileDisplayName,
  getLLMProfileApiKeyEnvNames,
  getLLMProfileProtocolLabel,
  getLLMProfileNames,
  getResolvedLLMProfileByName,
  getSuggestedModelsForProfile,
} from '../services/llm/config.js'
import { Select, type OptionWithDescription } from './CustomSelect/index.js'
import { ModelPicker } from './ModelPicker.js'

const DEFAULT_MODEL_VALUE = '__DEFAULT_MODEL__'
const CUSTOM_MODEL_VALUE = '__CUSTOM_MODEL__'

type Props = {
  initialModel: string | null
  currentProfileName?: string
  sessionModel?: string | null
  onSelect: (
    profileName: string,
    model: string | null,
    effort: EffortLevel | undefined,
  ) => void
  onCancel?: () => void
  showFastModeNotice?: boolean
  defaultStep?: 'profile' | 'model'
}

export function MultiProviderModelPicker({
  initialModel,
  currentProfileName = getActiveLLMProfileName(),
  sessionModel,
  onSelect,
  onCancel,
  showFastModeNotice,
  defaultStep = 'profile',
}: Props): React.ReactNode {
  const [step, setStep] = React.useState<'profile' | 'model'>(defaultStep)
  const [selectedProfileName, setSelectedProfileName] =
    React.useState(currentProfileName)

  const profileOptions = React.useMemo<OptionWithDescription<string>[]>(() => {
    return getLLMProfileNames().map(profileName => {
      const profile = getResolvedLLMProfileByName(profileName)
      const isCurrent = profileName === currentProfileName
      const apiKeyEnvNames = getLLMProfileApiKeyEnvNames(profile)
      const configuredApiKeyEnv = getConfiguredLLMProfileApiKeyEnv(profile)
      const protocol = getLLMProfileProtocolLabel(profile)
      const apiKeyStatus =
        profile.requiresApiKey === false
          ? 'No API key required'
          : apiKeyEnvNames.length > 0
            ? configuredApiKeyEnv
              ? `${configuredApiKeyEnv} configured`
              : `Missing ${apiKeyEnvNames.join(' or ')}`
            : protocol

      return {
        value: profileName,
        label: getLLMProfileDisplayName(profileName),
        description: [
          isCurrent ? 'Current' : null,
          protocol,
          apiKeyStatus !== protocol ? apiKeyStatus : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    })
  }, [currentProfileName])

  const selectedProfile = getResolvedLLMProfileByName(selectedProfileName)
  const anthropicInitialModel =
    selectedProfileName === currentProfileName ? initialModel : null
  const effectiveDefaultModel = selectedProfile.defaultModel ?? 'default'

  const nonAnthropicOptions = React.useMemo<OptionWithDescription<string>[]>(() => {
    const suggestedModels = getSuggestedModelsForProfile(selectedProfileName)
    const currentValue =
      selectedProfileName === currentProfileName ? initialModel : null
    const hasCustomCurrentModel =
      !!currentValue && !suggestedModels.includes(currentValue)
    const options: OptionWithDescription<string>[] = [
      {
        value: DEFAULT_MODEL_VALUE,
        label: 'Default (recommended)',
        description: `Use ${effectiveDefaultModel}`,
      },
      ...suggestedModels.map(model => ({
        value: model,
        label: model,
        description:
          model === effectiveDefaultModel ? 'Suggested default model' : undefined,
      })),
    ]

    options.push({
      value: CUSTOM_MODEL_VALUE,
      label: 'Custom model',
      type: 'input',
      placeholder: 'enter model id',
      initialValue: hasCustomCurrentModel ? currentValue : '',
      onChange: value => onSelect(selectedProfileName, value.trim(), undefined),
    })

    return options
  }, [
    currentProfileName,
    effectiveDefaultModel,
    initialModel,
    onSelect,
    selectedProfileName,
  ])

  if (step === 'profile') {
    return (
      <Box flexDirection="column">
        <Text dimColor>Select provider profile</Text>
        <Select
          options={profileOptions}
          defaultValue={selectedProfileName}
          visibleOptionCount={Math.min(8, profileOptions.length)}
          onChange={profileName => {
            setSelectedProfileName(profileName)
            setStep('model')
          }}
          onCancel={onCancel}
        />
      </Box>
    )
  }

  if (selectedProfile.type === 'anthropic') {
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {getLLMProfileDisplayName(selectedProfileName)} provider
        </Text>
        <ModelPicker
          initial={anthropicInitialModel}
          sessionModel={
            selectedProfileName === currentProfileName ? sessionModel : undefined
          }
          onSelect={(model, effort) => onSelect(selectedProfileName, model, effort)}
          onCancel={() => setStep('profile')}
          showFastModeNotice={
            selectedProfileName === currentProfileName && showFastModeNotice
          }
        />
      </Box>
    )
  }

  const currentValue =
    selectedProfileName === currentProfileName ? initialModel : null
  const suggestedModels = getSuggestedModelsForProfile(selectedProfileName)
  const defaultValue =
    currentValue === null
      ? DEFAULT_MODEL_VALUE
      : suggestedModels.includes(currentValue)
        ? currentValue
        : CUSTOM_MODEL_VALUE

  return (
    <Box flexDirection="column">
      <Text dimColor>{getLLMProfileDisplayName(selectedProfileName)} models</Text>
      <Select
        options={nonAnthropicOptions}
        defaultValue={defaultValue}
        visibleOptionCount={Math.min(8, nonAnthropicOptions.length)}
        onChange={value => {
          if (value === CUSTOM_MODEL_VALUE) {
            return
          }
          onSelect(
            selectedProfileName,
            value === DEFAULT_MODEL_VALUE ? null : value,
            undefined,
          )
        }}
        onCancel={() => setStep('profile')}
      />
    </Box>
  )
}
