import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

export const env: Command = {
  type: 'local-jsx',
  name: 'env',
  description:
    'Inspect the current runtime environment, capability state, and degraded integrations',
  immediate: true,
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./env.js'),
}

export const envNonInteractive: Command = {
  type: 'local',
  name: 'env',
  supportsNonInteractive: true,
  description:
    'Inspect the current runtime environment, capability state, and degraded integrations',
  isEnabled: () => getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./env-noninteractive.js'),
}
