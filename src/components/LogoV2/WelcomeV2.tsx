import React from 'react'
import { Box, Text } from 'src/ink.js'
import { PRODUCT_DISPLAY_NAME } from '../../utils/branding.js'
import { Clawd } from './Clawd.js'

const WELCOME_V2_WIDTH = 58

export function WelcomeV2() {
  const version = process.env.DEMO_VERSION ?? MACRO.VERSION

  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column">
      <Text>
        <Text color="claude">{`Welcome to ${PRODUCT_DISPLAY_NAME}`}</Text>{' '}
        <Text dimColor>v{version}</Text>
      </Text>
      <Box marginTop={1} marginBottom={1}>
        <Clawd />
      </Box>
      <Text dimColor>Robot-assisted coding from the terminal.</Text>
    </Box>
  )
}
