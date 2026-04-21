import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { isFsInaccessible } from '../../utils/errors.js'
import {
  getRemoteOpenClawLockPath,
  getRemoteOpenClawRegistryPath,
  getRemoteOpenClawStatePath,
  OPENCLAW_REMOTE_AGENT_ID,
} from './config.js'

export type RemoteOpenClawAttachment = {
  channel: 'telegram'
  peerId: string
  attachedAt: string
}

export type RemoteOpenClawState = {
  version: 2
  projectRoot: string
  sessionId: string
  sessionName: string | null
  registeredAt: string
  agentId: typeof OPENCLAW_REMOTE_AGENT_ID
  channel: 'telegram'
  attached: RemoteOpenClawAttachment | null
}

type RemoteOpenClawRegistryEntry = {
  projectRoot: string
  statePath: string
}

type RemoteOpenClawRegistry = {
  version: 1
  targets: RemoteOpenClawRegistryEntry[]
}

export type RemoteOpenClawLockOwner = 'local' | 'remote'

export type RemoteOpenClawLockState = {
  version: 1
  owner: RemoteOpenClawLockOwner
  sessionId: string
  peerId: string | null
  acquiredAt: string
  pid: number | null
}

function defaultRegistry(): RemoteOpenClawRegistry {
  return {
    version: 1,
    targets: [],
  }
}

function serializeLock(state: RemoteOpenClawLockState): string {
  return [
    `version=${state.version}`,
    `owner=${state.owner}`,
    `sessionId=${state.sessionId}`,
    `peerId=${state.peerId ?? ''}`,
    `acquiredAt=${state.acquiredAt}`,
    `pid=${state.pid ?? ''}`,
    '',
  ].join('\n')
}

function parseLock(raw: string): RemoteOpenClawLockState | null {
  const values = Object.fromEntries(
    raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const index = line.indexOf('=')
        if (index === -1) {
          return [line, '']
        }
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )

  const owner = values.owner
  const sessionId = values.sessionId
  if (
    values.version !== '1' ||
    (owner !== 'local' && owner !== 'remote') ||
    !sessionId
  ) {
    return null
  }

  return {
    version: 1,
    owner,
    sessionId,
    peerId: values.peerId || null,
    acquiredAt: values.acquiredAt || '',
    pid: values.pid ? Number(values.pid) : null,
  }
}

async function readRegistry(): Promise<RemoteOpenClawRegistry> {
  try {
    const raw = await readFile(getRemoteOpenClawRegistryPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RemoteOpenClawRegistry>
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.targets)) {
      return defaultRegistry()
    }
    return {
      version: 1,
      targets: parsed.targets.filter(
        entry =>
          Boolean(entry) &&
          typeof entry.projectRoot === 'string' &&
          typeof entry.statePath === 'string',
      ),
    }
  } catch (error) {
    if (isFsInaccessible(error)) {
      return defaultRegistry()
    }
    throw error
  }
}

async function writeRegistry(registry: RemoteOpenClawRegistry): Promise<void> {
  const registryPath = getRemoteOpenClawRegistryPath()
  await mkdir(dirname(registryPath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function upsertRemoteOpenClawRegistryEntry(
  repoRoot: string,
): Promise<void> {
  const registry = await readRegistry()
  const statePath = getRemoteOpenClawStatePath(repoRoot)
  const nextTargets = registry.targets.filter(entry => entry.projectRoot !== repoRoot)
  nextTargets.push({
    projectRoot: repoRoot,
    statePath,
  })
  await writeRegistry({
    version: 1,
    targets: nextTargets.sort((left, right) =>
      left.projectRoot.localeCompare(right.projectRoot),
    ),
  })
}

export async function removeRemoteOpenClawRegistryEntry(
  repoRoot: string,
): Promise<void> {
  const registry = await readRegistry()
  const nextTargets = registry.targets.filter(entry => entry.projectRoot !== repoRoot)
  if (nextTargets.length === registry.targets.length) {
    return
  }
  if (nextTargets.length === 0) {
    try {
      await rm(getRemoteOpenClawRegistryPath())
      return
    } catch (error) {
      if (isFsInaccessible(error)) {
        return
      }
      throw error
    }
  }
  await writeRegistry({
    version: 1,
    targets: nextTargets,
  })
}

export async function listRemoteOpenClawStates(): Promise<
  RemoteOpenClawState[]
> {
  const registry = await readRegistry()
  const states = await Promise.all(
    registry.targets.map(async entry => {
      const state = await readRemoteOpenClawState(entry.projectRoot)
      return state
    }),
  )
  return states.filter((state): state is RemoteOpenClawState => Boolean(state))
}

export async function readRemoteOpenClawState(
  repoRoot: string = getOriginalCwd(),
): Promise<RemoteOpenClawState | null> {
  try {
    const raw = await readFile(getRemoteOpenClawStatePath(repoRoot), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RemoteOpenClawState>
    if (
      !parsed ||
      parsed.version !== 2 ||
      typeof parsed.projectRoot !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.registeredAt !== 'string' ||
      parsed.agentId !== OPENCLAW_REMOTE_AGENT_ID ||
      parsed.channel !== 'telegram'
    ) {
      return null
    }
    return {
      version: 2,
      projectRoot: parsed.projectRoot,
      sessionId: parsed.sessionId,
      sessionName:
        typeof parsed.sessionName === 'string' && parsed.sessionName.trim().length > 0
          ? parsed.sessionName
          : null,
      registeredAt: parsed.registeredAt,
      agentId: OPENCLAW_REMOTE_AGENT_ID,
      channel: 'telegram',
      attached:
        parsed.attached &&
        parsed.attached.channel === 'telegram' &&
        typeof parsed.attached.peerId === 'string' &&
        typeof parsed.attached.attachedAt === 'string'
          ? {
              channel: 'telegram',
              peerId: parsed.attached.peerId,
              attachedAt: parsed.attached.attachedAt,
            }
          : null,
    }
  } catch (error) {
    if (isFsInaccessible(error)) {
      return null
    }
    throw error
  }
}

export async function writeRemoteOpenClawState(
  sessionId: string,
  sessionName: string | null,
  repoRoot: string = getOriginalCwd(),
): Promise<RemoteOpenClawState> {
  const state: RemoteOpenClawState = {
    version: 2,
    projectRoot: repoRoot,
    sessionId,
    sessionName: sessionName?.trim() || null,
    registeredAt: new Date().toISOString(),
    agentId: OPENCLAW_REMOTE_AGENT_ID,
    channel: 'telegram',
    attached: null,
  }

  const statePath = getRemoteOpenClawStatePath(repoRoot)
  await mkdir(dirname(statePath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  await upsertRemoteOpenClawRegistryEntry(repoRoot)
  return state
}

export async function updateRemoteOpenClawAttachment(
  attachment: RemoteOpenClawAttachment | null,
  repoRoot: string = getOriginalCwd(),
): Promise<RemoteOpenClawState | null> {
  const current = await readRemoteOpenClawState(repoRoot)
  if (!current) {
    return null
  }
  const next: RemoteOpenClawState = {
    ...current,
    attached: attachment,
  }
  const statePath = getRemoteOpenClawStatePath(repoRoot)
  await mkdir(dirname(statePath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(statePath, JSON.stringify(next, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  await upsertRemoteOpenClawRegistryEntry(repoRoot)
  return next
}

export async function clearRemoteOpenClawState(
  repoRoot: string = getOriginalCwd(),
): Promise<void> {
  const statePath = getRemoteOpenClawStatePath(repoRoot)
  try {
    await rm(statePath)
  } catch (error) {
    if (!isFsInaccessible(error)) {
      throw error
    }
  }
  await removeRemoteOpenClawRegistryEntry(repoRoot)
}

export async function readRemoteOpenClawLock(
  repoRoot: string = getOriginalCwd(),
): Promise<RemoteOpenClawLockState | null> {
  try {
    const raw = await readFile(getRemoteOpenClawLockPath(repoRoot), 'utf8')
    return parseLock(raw)
  } catch (error) {
    if (isFsInaccessible(error)) {
      return null
    }
    throw error
  }
}

export async function writeRemoteOpenClawLock(
  owner: RemoteOpenClawLockOwner,
  sessionId: string,
  repoRoot: string = getOriginalCwd(),
  pid: number | null = process.pid,
  peerId: string | null = null,
): Promise<RemoteOpenClawLockState> {
  const lock: RemoteOpenClawLockState = {
    version: 1,
    owner,
    sessionId,
    peerId,
    acquiredAt: new Date().toISOString(),
    pid,
  }

  const lockPath = getRemoteOpenClawLockPath(repoRoot)
  await mkdir(dirname(lockPath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(lockPath, serializeLock(lock), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return lock
}

export async function clearRemoteOpenClawLock(
  repoRoot: string = getOriginalCwd(),
  expected?:
    | {
        owner?: RemoteOpenClawLockOwner
        sessionId?: string
      }
    | undefined,
): Promise<void> {
  const lockPath = getRemoteOpenClawLockPath(repoRoot)

  if (expected) {
    const current = await readRemoteOpenClawLock(repoRoot)
    if (!current) {
      return
    }
    if (expected.owner && current.owner !== expected.owner) {
      return
    }
    if (expected.sessionId && current.sessionId !== expected.sessionId) {
      return
    }
  }

  try {
    await rm(lockPath)
  } catch (error) {
    if (isFsInaccessible(error)) {
      return
    }
    throw error
  }
}
