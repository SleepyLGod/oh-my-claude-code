import type { LocalCommandCall } from '../../types/command.js'
import { collectEnvReport, formatEnvReportAsText } from './shared.js'

export const call: LocalCommandCall = async (_args, context) => {
  const report = await collectEnvReport(context)
  return {
    type: 'text',
    value: formatEnvReportAsText(report),
  }
}
