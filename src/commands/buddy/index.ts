import type { Command } from '../../commands.js'

const command = {
  name: 'buddy',
  description: 'Manage your companion pet',
  argumentHint: '[status|hatch|pet|mute|unmute]',
  supportsNonInteractive: true,
  type: 'local',
  load: () => import('./buddy.js'),
} satisfies Command

export default command
