import * as React from 'react'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { EnvPanel } from './env-panel.js'
import { collectEnvReport } from './shared.js'

export const call: LocalJSXCommandCall = async (onDone, context, _args) => {
  const report = await collectEnvReport(context)
  return (
    <EnvPanel
      report={report}
      onClose={() => onDone('Environment dialog dismissed', { display: 'system' })}
    />
  )
}
