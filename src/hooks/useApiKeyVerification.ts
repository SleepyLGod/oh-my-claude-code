import { useCallback, useEffect, useMemo, useState } from 'react'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { verifyApiKey } from '../services/api/claude.js'
import {
  getActiveLLMProfileName,
  getConfiguredLLMProfileApiKeyEnv,
  getLLMProfileApiKeyEnvNames,
  getResolvedLLMProfileByName,
  isThirdPartyLLMProfile,
} from '../services/llm/config.js'
import { useSettings } from './useSettings.js'
import {
  getAnthropicApiKeyWithSource,
  getApiKeyFromApiKeyHelper,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
} from '../utils/auth.js'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}

function getVerificationStatusForProfile(
  settings: ReturnType<typeof useSettings>,
): VerificationStatus {
  const profileName = getActiveLLMProfileName(settings)
  const profile = getResolvedLLMProfileByName(profileName, settings)

  if (profile.type === 'mock') {
    return 'valid'
  }

  if (isThirdPartyLLMProfile(profile)) {
    if (profile.requiresApiKey === false) return 'valid'
    if (getLLMProfileApiKeyEnvNames(profile).length === 0) return 'missing'
    return getConfiguredLLMProfileApiKeyEnv(profile) ? 'valid' : 'missing'
  }

  if (!isAnthropicAuthEnabled() || isClaudeAISubscriber()) {
    return 'valid'
  }

  // Use skipRetrievingKeyFromApiKeyHelper to avoid executing apiKeyHelper
  // before trust dialog is shown (security: prevents RCE via settings.json)
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })

  // If apiKeyHelper is configured, we have a key source even though we
  // haven't executed it yet - return 'loading' to indicate we'll verify later
  if (key || source === 'apiKeyHelper') {
    return 'loading'
  }

  return 'missing'
}

export function useApiKeyVerification(): ApiKeyVerificationResult {
  const settings = useSettings()
  const activeProfileName = getActiveLLMProfileName(settings)
  const activeProfile = useMemo(
    () => getResolvedLLMProfileByName(activeProfileName, settings),
    [activeProfileName, settings],
  )
  const [status, setStatus] = useState<VerificationStatus>(() =>
    getVerificationStatusForProfile(settings),
  )
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setStatus(getVerificationStatusForProfile(settings))
    setError(null)
  }, [settings, activeProfileName])

  const verify = useCallback(async (): Promise<void> => {
    if (activeProfile.type === 'mock') {
      setError(null)
      setStatus('valid')
      return
    }

    if (isThirdPartyLLMProfile(activeProfile)) {
      setError(null)
      setStatus(getVerificationStatusForProfile(settings))
      return
    }

    if (!isAnthropicAuthEnabled() || isClaudeAISubscriber()) {
      setError(null)
      setStatus('valid')
      return
    }
    // Warm the apiKeyHelper cache (no-op if not configured), then read from
    // all sources. getAnthropicApiKeyWithSource() reads the now-warm cache.
    await getApiKeyFromApiKeyHelper(getIsNonInteractiveSession())
    const { key: apiKey, source } = getAnthropicApiKeyWithSource()
    if (!apiKey) {
      if (source === 'apiKeyHelper') {
        setStatus('error')
        setError(new Error('API key helper did not return a valid key'))
        return
      }
      setError(null)
      const newStatus = 'missing'
      setStatus(newStatus)
      return
    }

    try {
      const isValid = await verifyApiKey(apiKey, false)
      const newStatus = isValid ? 'valid' : 'invalid'
      setStatus(newStatus)
      return
    } catch (error) {
      // This happens when there an error response from the API but it's not an invalid API key error
      // In this case, we still mark the API key as invalid - but we also log the error so we can
      // display it to the user to be more helpful
      setError(error as Error)
      const newStatus = 'error'
      setStatus(newStatus)
      return
    }
  }, [activeProfile, settings])

  return {
    status,
    reverify: verify,
    error,
  }
}
