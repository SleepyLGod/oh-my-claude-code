import type { LocalJSXCommandContext } from '../../commands.js'
import { getSessionId } from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import { getModelDisplayLabel } from '../../utils/status.js'
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js'
import {
  getConfiguredLLMProfileApiKeyEnv,
  getActiveLLMProfileName,
  getLLMProfileApiKeyEnvNames,
  getLLMProfileProtocolLabel,
  getResolvedLLMProfile,
} from '../../services/llm/config.js'
import { checkRecordingAvailability } from '../../services/voice.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { buildSettingSourcesProperties } from '../../utils/status.js'
import {
  readRemoteOpenClawLock,
  readRemoteOpenClawState,
} from '../remote-openclaw/state.js'

type EnvEntry = {
  label: string
  value: string | string[]
}

export type EnvSection = {
  title: string
  entries: EnvEntry[]
}

export type EnvReport = {
  sections: EnvSection[]
}

function formatMcpStatus(
  clients: LocalJSXCommandContext['options']['mcpClients'],
): string {
  const ideClients = clients.filter(client => client.name === 'ide')
  const servers = clients.filter(client => client.name !== 'ide')

  const states = {
    connected: 0,
    pending: 0,
    needsAuth: 0,
    failed: 0,
  }

  for (const client of servers) {
    if (client.type === 'connected') {
      states.connected += 1
    } else if (client.type === 'pending') {
      states.pending += 1
    } else if (client.type === 'needs-auth') {
      states.needsAuth += 1
    } else {
      states.failed += 1
    }
  }

  const parts = [
    `${servers.length} server${servers.length === 1 ? '' : 's'}`,
    `${states.connected} connected`,
  ]

  if (states.needsAuth > 0) {
    parts.push(`${states.needsAuth} need auth`)
  }
  if (states.pending > 0) {
    parts.push(`${states.pending} pending`)
  }
  if (states.failed > 0) {
    parts.push(`${states.failed} failed`)
  }
  if (ideClients.length > 0) {
    parts.push(`${ideClients.length} IDE client${ideClients.length === 1 ? '' : 's'}`)
  }

  return parts.join(' · ')
}

function formatSandboxStatus(): string {
  const unavailableReason = SandboxManager.getSandboxUnavailableReason()
  if (unavailableReason) {
    return `unavailable · ${unavailableReason}`
  }

  if (SandboxManager.isSandboxingEnabled()) {
    return 'enabled'
  }

  if (!SandboxManager.isSupportedPlatform()) {
    return 'disabled · unsupported platform'
  }

  const dependencyErrors = SandboxManager.checkDependencies().errors
  if (dependencyErrors.length > 0) {
    return `disabled · missing dependencies: ${dependencyErrors.join(', ')}`
  }

  if (!SandboxManager.isPlatformInEnabledList()) {
    return 'disabled · excluded by sandbox.enabledPlatforms'
  }

  if (SandboxManager.isSandboxEnabledInSettings()) {
    return 'disabled'
  }

  return 'disabled in settings'
}

function formatModifierStatus(): string {
  if (process.platform !== 'darwin') {
    return 'unavailable · macOS-only native module'
  }

  try {
    require('modifiers-napi')
    return 'available'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `unavailable · ${message}`
  }
}

async function formatDeepLinkStatus(): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      await import('url-handler-napi')
      return 'available'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `degraded · url-handler-napi unavailable (${message})`
    }
  }

  if (process.platform === 'linux' || process.platform === 'win32') {
    return 'available via platform handler'
  }

  return 'unavailable on this platform'
}

async function formatVoiceStatus(): Promise<string> {
  try {
    const availability = await checkRecordingAvailability()
    if (availability.available) {
      return 'available'
    }

    const reason = availability.reason?.replace(/\s+/g, ' ').trim()
    return reason ? `unavailable · ${reason}` : 'unavailable'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `degraded · ${message}`
  }
}

function formatSettingSources(): string[] {
  const [sources] = buildSettingSourcesProperties()
  if (!sources) {
    return []
  }
  return Array.isArray(sources.value) ? sources.value : [String(sources.value)]
}

async function formatRemoteStatus(
  repoRoot: string,
): Promise<{ registration: string; lock: string }> {
  const [state, lock] = await Promise.all([
    readRemoteOpenClawState(repoRoot),
    readRemoteOpenClawLock(repoRoot),
  ])

  const registration = !state
    ? 'inactive'
    : state.attached
      ? `attached · telegram:${state.attached.peerId}`
      : `registered · ${state.sessionId}`

  const lockLabel = !lock
    ? 'idle'
    : `${lock.owner} · ${lock.sessionId}${lock.peerId ? ` · peer ${lock.peerId}` : ''}`

  return {
    registration,
    lock: lockLabel,
  }
}

export async function collectEnvReport(
  context: LocalJSXCommandContext,
): Promise<EnvReport> {
  const appState = context.getAppState()
  const sessionId = getSessionId()
  const sessionName = getCurrentSessionTitle(sessionId) ?? 'unnamed'
  const repoRoot = getCwd()
  const profileName = getActiveLLMProfileName()
  const profile = getResolvedLLMProfile()
  const apiKeyEnvNames = getLLMProfileApiKeyEnvNames(profile)
  const configuredApiKeyEnv = getConfiguredLLMProfileApiKeyEnv(profile)
  const remote = await formatRemoteStatus(repoRoot)
  const [voiceStatus, deepLinkStatus] = await Promise.all([
    formatVoiceStatus(),
    formatDeepLinkStatus(),
  ])

  return {
    sections: [
      {
        title: 'Session',
        entries: [
          { label: 'Session ID', value: sessionId },
          { label: 'Session name', value: sessionName },
          { label: 'cwd', value: repoRoot },
        ],
      },
      {
        title: 'Runtime',
        entries: [
          {
            label: 'Provider profile',
            value: `${profileName} (${profile.displayName ?? profile.name} · ${getLLMProfileProtocolLabel(profile)})`,
          },
          {
            label: 'Provider credentials',
            value:
              profile.requiresApiKey === false
                ? 'not required'
                : configuredApiKeyEnv
                  ? `${configuredApiKeyEnv} configured`
                  : apiKeyEnvNames.length > 0
                    ? `missing ${apiKeyEnvNames.join(' or ')}`
                    : 'not configured',
          },
          {
            label: 'Model',
            value: getModelDisplayLabel(appState.mainLoopModel),
          },
          {
            label: 'Permission mode',
            value: appState.toolPermissionContext.mode,
          },
          {
            label: 'MCP',
            value: formatMcpStatus(appState.mcp.clients),
          },
          {
            label: 'Setting sources',
            value: formatSettingSources(),
          },
        ],
      },
      {
        title: 'Capabilities',
        entries: [
          { label: 'Sandbox', value: formatSandboxStatus() },
          { label: 'Voice', value: voiceStatus },
          { label: 'Modifier keys', value: formatModifierStatus() },
          { label: 'Deep links', value: deepLinkStatus },
          {
            label: 'Chrome integration',
            value: 'partial · restored compatibility shim (browser actions unavailable)',
          },
          {
            label: 'Computer-use',
            value:
              'partial · restored compatibility shim (native desktop actions unavailable)',
          },
        ],
      },
      {
        title: 'Remote Control',
        entries: [
          { label: 'OpenClaw target', value: remote.registration },
          { label: 'OpenClaw lock', value: remote.lock },
        ],
      },
    ],
  }
}

export function formatEnvReportAsText(report: EnvReport): string {
  const lines: string[] = ['# Environment']

  for (const section of report.sections) {
    lines.push('', `## ${section.title}`)
    for (const entry of section.entries) {
      const value = Array.isArray(entry.value)
        ? entry.value.join(', ')
        : entry.value
      lines.push(`- ${entry.label}: ${value}`)
    }
  }

  return lines.join('\n')
}

export function getEnvSessionLabel(report: EnvReport): string | null {
  const sessionSection = report.sections.find(section => section.title === 'Session')
  const sessionName = sessionSection?.entries.find(entry => entry.label === 'Session name')
  return sessionName && !Array.isArray(sessionName.value)
    ? String(sessionName.value)
    : null
}
