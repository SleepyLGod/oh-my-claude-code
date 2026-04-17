import type { Command } from '../../commands.js'
import {
  getActiveLLMProfileName,
  getLLMProfileDisplayName,
} from '../../services/llm/config.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI provider/model for Claude Code (currently ${getLLMProfileDisplayName(getActiveLLMProfileName())} · ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[profile[:model]|model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command
