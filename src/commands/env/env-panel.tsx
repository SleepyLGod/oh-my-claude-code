import * as React from 'react'
import { useCallback } from 'react'
import { Box, Text } from '../../ink.js'
import { useIsInsideModal } from '../../context/modalContext.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { Pane } from '../../components/design-system/Pane.js'
import { useInput } from '../../ink.js'
import type { EnvReport } from './shared.js'

function PropertyValue({
  value,
}: {
  value: string | string[]
}): React.ReactNode {
  if (Array.isArray(value)) {
    return (
      <Box flexWrap="wrap" columnGap={1} flexShrink={99}>
        {value.map((item, index) => (
          <Text key={`${item}-${index}`}>
            {item}
            {index < value.length - 1 ? ',' : ''}
          </Text>
        ))}
      </Box>
    )
  }

  return <Text wrap="wrap">{value}</Text>
}

export function EnvPanel({
  report,
  onClose,
}: {
  report: EnvReport
  onClose: () => void
}): React.ReactNode {
  const grow = useIsInsideModal() ? 1 : undefined
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useKeybinding('confirm:no', handleClose, {
    context: 'Confirmation',
  })

  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) {
      handleClose()
    }
  })

  return (
    <Pane color="permission">
      <Box
        flexDirection="column"
        flexGrow={grow}
        tabIndex={0}
        autoFocus
      >
        <Box flexDirection="column" gap={1} flexGrow={grow}>
          {report.sections.map(section => (
            <Box key={section.title} flexDirection="column">
              <Text bold>{section.title}</Text>
              {section.entries.map(entry => (
                <Box
                  key={`${section.title}-${entry.label}`}
                  flexDirection="row"
                  gap={1}
                  flexShrink={0}
                >
                  <Text bold>{entry.label}:</Text>
                  <PropertyValue value={entry.value} />
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        <Text dimColor>
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="close"
          />
          {' · Ctrl+C/Ctrl+D to close'}
        </Text>
      </Box>
    </Pane>
  )
}
