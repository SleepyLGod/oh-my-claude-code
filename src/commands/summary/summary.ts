import type { LocalCommandCall } from '../../types/command.js'
import {
  generateSessionSummary,
  parseSummaryMode,
} from './shared.js'

export const call: LocalCommandCall = async (args, context) => {
  const { mode, error } = parseSummaryMode(args)
  if (error) {
    return {
      type: 'text',
      value: error,
    }
  }

  const previousSpinnerTip = context.getAppState().spinnerTip
  context.setAppState(prev => ({
    ...prev,
    spinnerTip: 'Generating session summary…',
  }))

  try {
    const value = await generateSessionSummary(
      context.messages,
      context.abortController.signal,
      mode,
    )

    return {
      type: 'text',
      value,
    }
  } finally {
    context.setAppState(prev => ({
      ...prev,
      spinnerTip: previousSpinnerTip,
    }))
  }
}
