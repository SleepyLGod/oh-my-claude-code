import type { Command } from '../../commands.js'

const remoteOpenClaw = {
  type: 'local-jsx',
  name: 'remote-openclaw',
  description:
    'Register the current Claude Code session for the dedicated OpenClaw Telegram bot',
  argumentHint: 'register|status|unregister|check',
  immediate: true,
  load: () => import('./remote-openclaw.js'),
} satisfies Command

export default remoteOpenClaw
