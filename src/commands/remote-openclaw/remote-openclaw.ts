import { access, constants, mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { createSystemMessage } from '../../utils/messages.js'
import { getTranscriptPath } from '../../utils/sessionStorage.js'
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js'
import { which } from '../../utils/which.js'
import {
  getRemoteOpenClawRegistryPath,
  OPENCLAW_REMOTE_AGENT_ID,
  OPENCLAW_TASK_AGENT_ID,
} from './config.js'
import {
  clearRemoteOpenClawLock,
  clearRemoteOpenClawState,
  readRemoteOpenClawLock,
  readRemoteOpenClawState,
  type RemoteOpenClawLockState,
  type RemoteOpenClawState,
  writeRemoteOpenClawState,
} from './state.js'

type RemoteOpenClawAction = 'register' | 'status' | 'unregister' | 'check'

type CheckReport = {
  repoRoot: string
  openclawPath: string | null
  bunPath: string | null
  registryPath: string
  registryExists: boolean
}

function parseAction(args: string): RemoteOpenClawAction {
  const trimmed = args.trim()
  if (!trimmed) return 'status'

  const [action] = trimmed.split(/\s+/, 1)
  switch (action) {
    case 'register':
    case 'status':
    case 'unregister':
    case 'check':
      return action
    default:
      return 'status'
  }
}

let unregisterRemoteOpenClawCleanup: (() => void) | null = null

function clearRemoteOpenClawCleanupRegistration(): void {
  unregisterRemoteOpenClawCleanup?.()
  unregisterRemoteOpenClawCleanup = null
}

function registerRemoteOpenClawCleanup(
  repoRoot: string,
  sessionId: string,
): void {
  clearRemoteOpenClawCleanupRegistration()
  unregisterRemoteOpenClawCleanup = registerCleanup(async () => {
    const current = await readRemoteOpenClawState(repoRoot)
    if (!current || current.sessionId !== sessionId) {
      return
    }
    await clearRemoteOpenClawState(repoRoot)
    await clearRemoteOpenClawLock(repoRoot, { sessionId })
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureCurrentSessionTranscript(): Promise<void> {
  const transcriptPath = getTranscriptPath()
  const exists = await pathExists(transcriptPath)
  if (exists) {
    return
  }

  await mkdir(dirname(transcriptPath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    transcriptPath,
    JSON.stringify({
      ...createSystemMessage(
        'OpenClaw remote target initialized for this session.',
        'info',
      ),
      sessionId: getSessionId(),
      parentUuid: null,
      isSidechain: false,
    }) + '\n',
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a',
    },
  )
}

async function runChecks(repoRoot: string): Promise<CheckReport> {
  const [openclawPath, bunPath] = await Promise.all([
    which('openclaw'),
    which('bun'),
  ])

  const registryPath = getRemoteOpenClawRegistryPath()
  return {
    repoRoot,
    openclawPath,
    bunPath,
    registryPath,
    registryExists: await pathExists(registryPath),
  }
}

function formatCheck(report: CheckReport): string {
  return [
    'OpenClaw remote target readiness',
    `repo: ${report.repoRoot}`,
    `openclaw: ${report.openclawPath ?? 'missing'}`,
    `bun: ${report.bunPath ?? 'missing'}`,
    `registry: ${report.registryExists ? 'present' : 'missing'} (${report.registryPath})`,
    '',
    `This command only registers the current Claude Code session for the dedicated \`${OPENCLAW_REMOTE_AGENT_ID}\` Telegram bot.`,
    `The separate \`${OPENCLAW_TASK_AGENT_ID}\` task agent is independent and unaffected.`,
  ].join('\n')
}

function formatState(
  state: RemoteOpenClawState,
  lock: RemoteOpenClawLockState | null,
  currentSessionId: string,
  repoRoot: string,
): string {
  const currentRole =
    currentSessionId === state.sessionId ? 'registered' : 'other'
  const attachedLabel = state.attached
    ? `${state.attached.channel}:${state.attached.peerId} (${state.attached.attachedAt})`
    : 'idle'

  return [
    'Remote OpenClaw target',
    `repo: ${repoRoot}`,
    `current session: ${currentSessionId} (${currentRole})`,
    `registered session: ${state.sessionId}`,
    `session name: ${state.sessionName ?? 'unnamed'}`,
    `registered at: ${state.registeredAt}`,
    `agent: ${state.agentId}`,
    `channel: ${state.channel}`,
    `remote attach: ${attachedLabel}`,
    `lock: ${lock ? `${lock.owner} (${lock.sessionId})` : 'idle'}`,
    '',
    `Use \`/claude sessions\` and \`/claude attach ${state.sessionId}\` from the dedicated Telegram bot to take control of this session.`,
  ].join('\n')
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const action = parseAction(args)
  const repoRoot = getOriginalCwd()
  const currentSessionId = getSessionId()

  try {
    switch (action) {
      case 'register': {
        const existing = await readRemoteOpenClawState(repoRoot)
        if (existing) {
          const lock = await readRemoteOpenClawLock(repoRoot)
          onDone(
            [
              existing.sessionId === currentSessionId
                ? 'This session is already registered for dedicated OpenClaw remote control.'
                : 'A different session is already registered for dedicated OpenClaw remote control in this project.',
              '',
              formatState(existing, lock, currentSessionId, repoRoot),
              '',
              'Use /remote-openclaw unregister to unregister it before registering another session in this project.',
            ].join('\n'),
            { display: 'system' },
          )
          return null
        }

        await ensureCurrentSessionTranscript()
        const state = await writeRemoteOpenClawState(
          currentSessionId,
          getCurrentSessionTitle(currentSessionId) ?? null,
          repoRoot,
        )
        registerRemoteOpenClawCleanup(repoRoot, currentSessionId)

        onDone(
          [
            'Claude Code remote target registered.',
            '',
            formatState(state, null, currentSessionId, repoRoot),
          ].join('\n'),
          { display: 'system' },
        )
        return null
      }

      case 'unregister': {
        const existing = await readRemoteOpenClawState(repoRoot)
        if (!existing) {
          onDone('No project-local remote-openclaw target is registered.', {
            display: 'system',
          })
          return null
        }

        const lock = await readRemoteOpenClawLock(repoRoot)
        clearRemoteOpenClawCleanupRegistration()
        await clearRemoteOpenClawState(repoRoot)
        await clearRemoteOpenClawLock(repoRoot)
        onDone(
          [
            `Unregistered remote-openclaw target ${existing.sessionId}.`,
            lock
              ? `Removed ${lock.owner} lock for session ${lock.sessionId}.`
              : 'No active lock remained.',
          ].join('\n'),
          { display: 'system' },
        )
        return null
      }

      case 'check': {
        const report = await runChecks(repoRoot)
        onDone(formatCheck(report), { display: 'system' })
        return null
      }

      case 'status':
      default: {
        const state = await readRemoteOpenClawState(repoRoot)
        const lock = await readRemoteOpenClawLock(repoRoot)
        if (!state) {
          clearRemoteOpenClawCleanupRegistration()
          const report = await runChecks(repoRoot)
          onDone(
            [
              'No project-local remote-openclaw target is registered.',
              '',
              formatCheck(report),
            ].join('\n'),
            { display: 'system' },
          )
          return null
        }
        if (state.sessionId === currentSessionId) {
          registerRemoteOpenClawCleanup(repoRoot, currentSessionId)
        }

        onDone(formatState(state, lock, currentSessionId, repoRoot), {
          display: 'system',
        })
        return null
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onDone(`remote-openclaw failed: ${message}`, { display: 'system' })
    return null
  }
}
