import type { Command } from '../../commands.js'

const summary = {
  type: 'local',
  name: 'summary',
  description: 'Summarize the current session and the next step',
  argumentHint: '[short|long]',
  supportsNonInteractive: true,
  load: () => import('./summary.js'),
} satisfies Command

export default summary
