import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right'

type Props = {
  pose?: ClawdPose
}

const ROBOT_FRAMES: Record<ClawdPose, [string, string, string]> = {
  default: ['  .---.  ', ' [|o o|] ', ' /|___|\\ '],
  'look-left': ['  .---.  ', ' [|oo |] ', ' /|___|\\ '],
  'look-right': ['  .---.  ', ' [| oo|] ', ' /|___|\\ '],
  'arms-up': [' \\ .-. / ', '  [o o]  ', '   /_\\   '],
}

export function Clawd({ pose = 'default' }: Props): React.ReactNode {
  const [top, middle, bottom] = ROBOT_FRAMES[pose]

  return (
    <Box flexDirection="column">
      <Text color="clawd_body">{top}</Text>
      <Text color="clawd_body">{middle}</Text>
      <Text color="clawd_body">{bottom}</Text>
    </Box>
  )
}
