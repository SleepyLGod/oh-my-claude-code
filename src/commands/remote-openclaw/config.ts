import { homedir } from 'os'
import { join } from 'path'

export const OPENCLAW_REMOTE_AGENT_ID = 'claude-code-remote'
export const OPENCLAW_TASK_AGENT_ID = 'claude-code'

export function getAcpxConfigPath(): string {
  return join(homedir(), '.acpx', 'config.json')
}

export function getOpenClawShimPath(repoRoot: string): string {
  return join(repoRoot, 'tools', 'openclaw', 'claude')
}

export function getOpenClawAcpWrapperPath(repoRoot: string): string {
  return join(repoRoot, 'tools', 'openclaw', 'claude-code-acp.sh')
}

export function getOpenClawRemoteAcpWrapperPath(repoRoot: string): string {
  return join(repoRoot, 'tools', 'openclaw', 'claude-code-remote-acp.sh')
}

export function getRemoteOpenClawStatePath(repoRoot: string): string {
  return join(repoRoot, '.claude', 'openclaw', 'remote-openclaw.json')
}

export function getRemoteOpenClawLockPath(repoRoot: string): string {
  return join(repoRoot, '.claude', 'openclaw', 'remote-openclaw.lock')
}

export function getRemoteOpenClawRegistryPath(): string {
  return join(homedir(), '.claude', 'openclaw', 'remote-targets.json')
}

export function buildAcpxAgentCommand(repoRoot: string): string {
  return `/bin/bash ${getOpenClawAcpWrapperPath(repoRoot)}`
}

export function buildRemoteAcpxAgentCommand(repoRoot: string): string {
  return `/bin/bash ${getOpenClawRemoteAcpWrapperPath(repoRoot)}`
}

export function buildAcpxConfigSnippet(repoRoot: string): string {
  return JSON.stringify(
    {
      agents: {
        [OPENCLAW_REMOTE_AGENT_ID]: {
          command: buildRemoteAcpxAgentCommand(repoRoot),
        },
        [OPENCLAW_TASK_AGENT_ID]: {
          command: buildAcpxAgentCommand(repoRoot),
        },
      },
    },
    null,
    2,
  )
}
