import chalk, { Chalk } from 'chalk'
import { env } from './env.js'

export type Theme = {
  autoAccept: string
  bashBorder: string
  claude: string
  claudeShimmer: string // Lighter version of claude color for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: string
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: string
  permission: string
  permissionShimmer: string // Lighter version of permission color for shimmer effect
  planMode: string
  ide: string
  promptBorder: string
  promptBorderShimmer: string // Lighter version of promptBorder color for shimmer effect
  text: string
  inverseText: string
  inactive: string
  inactiveShimmer: string // Lighter version of inactive color for shimmer effect
  subtle: string
  suggestion: string
  remember: string
  background: string
  // Semantic colors
  success: string
  error: string
  warning: string
  merged: string
  warningShimmer: string // Lighter version of warning color for shimmer effect
  // Diff colors
  diffAdded: string
  diffRemoved: string
  diffAddedDimmed: string
  diffRemovedDimmed: string
  // Word-level diff highlighting
  diffAddedWord: string
  diffRemovedWord: string
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: string
  blue_FOR_SUBAGENTS_ONLY: string
  green_FOR_SUBAGENTS_ONLY: string
  yellow_FOR_SUBAGENTS_ONLY: string
  purple_FOR_SUBAGENTS_ONLY: string
  orange_FOR_SUBAGENTS_ONLY: string
  pink_FOR_SUBAGENTS_ONLY: string
  cyan_FOR_SUBAGENTS_ONLY: string
  // Grove colors
  professionalBlue: string
  // Chrome colors
  chromeYellow: string
  // TUI V2 colors
  clawd_body: string
  clawd_background: string
  userMessageBackground: string
  userMessageBackgroundHover: string
  /** Message-actions selection. Cool shift toward `suggestion` blue; distinct from default AND userMessageBackground. */
  messageActionsBackground: string
  /** Text-selection highlight background (alt-screen mouse selection). Solid
   *  bg that REPLACES the cell's bg while preserving its fg — matches native
   *  terminal selection. Previously SGR-7 inverse (swapped fg/bg per cell),
   *  which fragmented badly over syntax highlighting. */
  selectionBg: string
  bashMessageBackgroundColor: string

  memoryBackgroundColor: string
  rate_limit_fill: string
  rate_limit_empty: string
  fastMode: string
  fastModeShimmer: string
  // Brief/assistant mode label colors
  briefLabelYou: string
  briefLabelClaude: string
  // Rainbow colors for ultrathink keyword highlighting
  rainbow_red: string
  rainbow_orange: string
  rainbow_yellow: string
  rainbow_green: string
  rainbow_blue: string
  rainbow_indigo: string
  rainbow_violet: string
  rainbow_red_shimmer: string
  rainbow_orange_shimmer: string
  rainbow_yellow_shimmer: string
  rainbow_green_shimmer: string
  rainbow_blue_shimmer: string
  rainbow_indigo_shimmer: string
  rainbow_violet_shimmer: string
}

export const THEME_NAMES = [
  'dark',
  'light',
  'light-daltonized',
  'dark-daltonized',
  'light-ansi',
  'dark-ansi',
  'catppuccin-mocha',
  'catppuccin-latte',
  'catppuccin-macchiato',
  'catppuccin-frappe',
  'tokyo-night',
  'high-contrast-dark',
  'high-contrast-light',
  'rose-pine',
  'rose-pine-dawn',
] as const

/** A renderable theme. Always resolvable to a concrete color palette. */
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_SETTINGS = ['auto', ...THEME_NAMES] as const

/**
 * A theme preference as stored in user config. `'auto'` follows the system
 * dark/light mode and is resolved to a ThemeName at runtime.
 */
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

/**
 * Light theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const lightTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(255,0,135)', // Vibrant pink
  claude: 'rgb(215,119,87)', // Claude orange
  claudeShimmer: 'rgb(245,149,117)', // Lighter claude orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(87,105,247)', // Medium blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(117,135,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(87,105,247)', // Medium blue
  permissionShimmer: 'rgb(137,155,255)', // Lighter blue for shimmer effect
  planMode: 'rgb(0,102,102)', // Muted teal
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer effect
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(87,105,247)', // Medium blue
  remember: 'rgb(0,0,255)', // Blue
  background: 'rgb(0,153,153)', // Cyan
  success: 'rgb(44,122,57)', // Green
  error: 'rgb(171,43,63)', // Red
  warning: 'rgb(150,108,30)', // Amber
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(200,158,80)', // Lighter amber for shimmer effect
  diffAdded: 'rgb(105,219,124)', // Light green
  diffRemoved: 'rgb(255,168,180)', // Light red
  diffAddedDimmed: 'rgb(199,225,203)', // Very light green
  diffRemovedDimmed: 'rgb(253,210,216)', // Very light red
  diffAddedWord: 'rgb(47,157,68)', // Medium green
  diffRemovedWord: 'rgb(209,69,75)', // Medium red
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(215,119,87)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(240, 240, 240)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(252, 252, 252)', // ≥250 to quantize distinct from base at 256-color level
  messageActionsBackground: 'rgb(232, 236, 244)', // cool gray — darker than userMsg 240 (visible on white), slight blue toward `suggestion`
  selectionBg: 'rgb(180, 213, 255)', // classic light-mode selection blue (macOS/VS Code-ish); dark fgs stay readable
  bashMessageBackgroundColor: 'rgb(250, 245, 250)',

  memoryBackgroundColor: 'rgb(230, 245, 250)',
  rate_limit_fill: 'rgb(87,105,247)', // Medium blue
  rate_limit_empty: 'rgb(39,47,111)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  // Brief/assistant mode
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(215,119,87)', // Brand orange
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
}

/**
 * Light ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const lightAnsiTheme: Theme = {
  autoAccept: 'ansi:magenta',
  bashBorder: 'ansi:magenta',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blue',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blue',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyan',
  ide: 'ansi:blueBright',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:black',
  inverseText: 'ansi:white',
  inactive: 'ansi:blackBright',
  inactiveShimmer: 'ansi:white',
  subtle: 'ansi:blackBright',
  suggestion: 'ansi:blue',
  remember: 'ansi:blue',
  background: 'ansi:cyan',
  success: 'ansi:green',
  error: 'ansi:red',
  warning: 'ansi:yellow',
  merged: 'ansi:magenta',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:red',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blue',
  green_FOR_SUBAGENTS_ONLY: 'ansi:green',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellow',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magenta',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyan',
  // Grove colors
  professionalBlue: 'ansi:blueBright',
  // Chrome colors
  chromeYellow: 'ansi:yellow', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'ansi:redBright',
  clawd_background: 'ansi:black',
  userMessageBackground: 'ansi:white',
  userMessageBackgroundHover: 'ansi:whiteBright',
  messageActionsBackground: 'ansi:white',
  selectionBg: 'ansi:cyan', // lighter named bg for light-ansi; dark fgs stay readable
  bashMessageBackgroundColor: 'ansi:whiteBright',

  memoryBackgroundColor: 'ansi:white',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:black',
  fastMode: 'ansi:red',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blue',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
}

/**
 * Dark ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const darkAnsiTheme: Theme = {
  autoAccept: 'ansi:magentaBright',
  bashBorder: 'ansi:magentaBright',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blueBright',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyanBright',
  ide: 'ansi:blue',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:whiteBright',
  inverseText: 'ansi:black',
  inactive: 'ansi:white',
  inactiveShimmer: 'ansi:whiteBright',
  subtle: 'ansi:white',
  suggestion: 'ansi:blueBright',
  remember: 'ansi:blueBright',
  background: 'ansi:cyanBright',
  success: 'ansi:greenBright',
  error: 'ansi:redBright',
  warning: 'ansi:yellowBright',
  merged: 'ansi:magentaBright',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blueBright',
  green_FOR_SUBAGENTS_ONLY: 'ansi:greenBright',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellowBright',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyanBright',
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'ansi:yellowBright', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'ansi:redBright',
  clawd_background: 'ansi:black',
  userMessageBackground: 'ansi:blackBright',
  userMessageBackgroundHover: 'ansi:white',
  messageActionsBackground: 'ansi:blackBright',
  selectionBg: 'ansi:blue', // darker named bg for dark-ansi; bright fgs stay readable
  bashMessageBackgroundColor: 'ansi:black',

  memoryBackgroundColor: 'ansi:blackBright',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:white',
  fastMode: 'ansi:redBright',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blueBright',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
}

/**
 * Light daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const lightDaltonizedTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(0,102,204)', // Blue instead of pink
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(51,102,255)', // Bright blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(101,152,255)', // Lighter bright blue for system spinner shimmer
  permission: 'rgb(51,102,255)', // Bright blue
  permissionShimmer: 'rgb(101,152,255)', // Lighter bright blue for shimmer
  planMode: 'rgb(51,102,102)', // Muted blue-gray (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(51,102,255)', // Bright blue
  remember: 'rgb(51,102,255)', // Bright blue
  background: 'rgb(0,153,153)', // Cyan (color-blind friendly)
  success: 'rgb(0,102,153)', // Blue instead of green for deuteranopia
  error: 'rgb(204,0,0)', // Pure red for better distinction
  warning: 'rgb(255,153,0)', // Orange adjusted for deuteranopia
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,183,50)', // Lighter orange for shimmer
  diffAdded: 'rgb(153,204,255)', // Light blue instead of green
  diffRemoved: 'rgb(255,204,204)', // Light red
  diffAddedDimmed: 'rgb(209,231,253)', // Very light blue
  diffRemovedDimmed: 'rgb(255,233,233)', // Very light red
  diffAddedWord: 'rgb(51,102,204)', // Medium blue (less intense than deep blue)
  diffRemovedWord: 'rgb(153,51,51)', // Softer red (less intense than deep red)
  // Agent colors (daltonism-friendly)
  red_FOR_SUBAGENTS_ONLY: 'rgb(204,0,0)', // Pure red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(0,102,204)', // Pure blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(0,204,0)', // Pure green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,204,0)', // Golden yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(128,0,128)', // True purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,128,0)', // True orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,102,178)', // Adjusted pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(0,178,178)', // Adjusted cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(215,119,87)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(220, 220, 220)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(232, 232, 232)', // ≥230 to quantize distinct from base at 256-color level
  messageActionsBackground: 'rgb(210, 216, 226)', // cool gray — darker than userMsg 220, slight blue
  selectionBg: 'rgb(180, 213, 255)', // light selection blue; daltonized fgs are yellows/blues, both readable on light blue
  bashMessageBackgroundColor: 'rgb(250, 245, 250)',

  memoryBackgroundColor: 'rgb(230, 245, 250)',
  rate_limit_fill: 'rgb(51,102,255)', // Bright blue
  rate_limit_empty: 'rgb(23,46,114)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange (color-blind safe)
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
}

/**
 * Dark theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const darkTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(253,93,177)', // Bright pink
  claude: 'rgb(215,119,87)', // Claude orange
  claudeShimmer: 'rgb(235,159,127)', // Lighter claude orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(147,165,255)', // Blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(177,195,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(177,185,249)', // Light blue-purple
  permissionShimmer: 'rgb(207,215,255)', // Lighter blue-purple for shimmer
  planMode: 'rgb(72,150,140)', // Muted sage green
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(177,185,249)', // Light blue-purple
  remember: 'rgb(177,185,249)', // Light blue-purple
  background: 'rgb(0,204,204)', // Bright cyan
  success: 'rgb(78,186,101)', // Bright green
  error: 'rgb(255,107,128)', // Bright red
  warning: 'rgb(255,193,7)', // Bright amber
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,223,57)', // Lighter amber for shimmer
  diffAdded: 'rgb(34,92,43)', // Dark green
  diffRemoved: 'rgb(122,41,54)', // Dark red
  diffAddedDimmed: 'rgb(71,88,74)', // Very dark green
  diffRemovedDimmed: 'rgb(105,72,77)', // Very dark red
  diffAddedWord: 'rgb(56,166,96)', // Medium green
  diffRemovedWord: 'rgb(179,89,107)', // Softer red (less intense than bright red)
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(215,119,87)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'rgb(65, 60, 65)',

  memoryBackgroundColor: 'rgb(55, 65, 70)',
  rate_limit_fill: 'rgb(177,185,249)', // Light blue-purple
  rate_limit_empty: 'rgb(80,83,112)', // Medium blue-purple
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(215,119,87)', // Brand orange
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
}

/**
 * Dark daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const darkDaltonizedTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(51,153,255)', // Bright blue
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(153,204,255)', // Light blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(183,224,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(153,204,255)', // Light blue
  permissionShimmer: 'rgb(183,224,255)', // Lighter blue for shimmer
  planMode: 'rgb(102,153,153)', // Muted gray-teal (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(153,204,255)', // Light blue
  remember: 'rgb(153,204,255)', // Light blue
  background: 'rgb(0,204,204)', // Bright cyan (color-blind friendly)
  success: 'rgb(51,153,255)', // Blue instead of green
  error: 'rgb(255,102,102)', // Bright red
  warning: 'rgb(255,204,0)', // Yellow-orange for deuteranopia
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,234,50)', // Lighter yellow-orange for shimmer
  diffAdded: 'rgb(0,68,102)', // Dark blue
  diffRemoved: 'rgb(102,0,0)', // Dark red
  diffAddedDimmed: 'rgb(62,81,91)', // Dimmed blue
  diffRemovedDimmed: 'rgb(62,44,44)', // Dimmed red
  diffAddedWord: 'rgb(0,119,179)', // Medium blue
  diffRemovedWord: 'rgb(179,0,0)', // Medium red
  // Agent colors (daltonism-friendly, dark mode)
  red_FOR_SUBAGENTS_ONLY: 'rgb(255,102,102)', // Bright red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(102,178,255)', // Bright blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(102,255,102)', // Bright green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,255,102)', // Bright yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(178,102,255)', // Bright purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,178,102)', // Bright orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,153,204)', // Bright pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(102,204,204)', // Bright cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(215,119,87)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'rgb(65, 60, 65)',

  memoryBackgroundColor: 'rgb(55, 65, 70)',
  rate_limit_fill: 'rgb(153,204,255)', // Light blue
  rate_limit_empty: 'rgb(69,92,115)', // Dark blue
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg (color-blind safe)
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
}

const catppuccinMochaTheme: Theme = {
  ...darkTheme,
  autoAccept: 'rgb(203,166,247)',
  bashBorder: 'rgb(245,194,231)',
  claude: 'rgb(250,179,135)',
  claudeShimmer: 'rgb(250,205,170)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(137,180,250)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(180,190,254)',
  permission: 'rgb(137,180,250)',
  permissionShimmer: 'rgb(180,190,254)',
  planMode: 'rgb(148,226,213)',
  promptBorder: 'rgb(88,91,112)',
  promptBorderShimmer: 'rgb(127,132,156)',
  text: 'rgb(205,214,244)',
  inverseText: 'rgb(30,30,46)',
  inactive: 'rgb(147,153,178)',
  inactiveShimmer: 'rgb(186,194,222)',
  subtle: 'rgb(69,71,90)',
  suggestion: 'rgb(137,180,250)',
  remember: 'rgb(137,180,250)',
  background: 'rgb(137,220,235)',
  success: 'rgb(166,227,161)',
  error: 'rgb(243,139,168)',
  warning: 'rgb(249,226,175)',
  merged: 'rgb(203,166,247)',
  warningShimmer: 'rgb(250,236,196)',
  diffAdded: 'rgb(40,72,52)',
  diffRemoved: 'rgb(88,47,64)',
  diffAddedDimmed: 'rgb(51,63,58)',
  diffRemovedDimmed: 'rgb(74,56,66)',
  diffAddedWord: 'rgb(115,199,121)',
  diffRemovedWord: 'rgb(214,112,144)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(243,139,168)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(137,180,250)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(166,227,161)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(249,226,175)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(203,166,247)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(250,179,135)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(245,194,231)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(148,226,213)',
  clawd_body: 'rgb(250,179,135)',
  userMessageBackground: 'rgb(36,39,58)',
  userMessageBackgroundHover: 'rgb(49,50,68)',
  messageActionsBackground: 'rgb(30,32,48)',
  selectionBg: 'rgb(52,63,99)',
  bashMessageBackgroundColor: 'rgb(28,30,44)',
  memoryBackgroundColor: 'rgb(29,33,50)',
  rate_limit_fill: 'rgb(137,180,250)',
  rate_limit_empty: 'rgb(69,71,90)',
  fastMode: 'rgb(250,179,135)',
  fastModeShimmer: 'rgb(250,205,170)',
  briefLabelYou: 'rgb(137,180,250)',
  briefLabelClaude: 'rgb(250,179,135)',
}

const catppuccinLatteTheme: Theme = {
  ...lightTheme,
  autoAccept: 'rgb(136,57,239)',
  bashBorder: 'rgb(234,118,203)',
  claude: 'rgb(254,100,11)',
  claudeShimmer: 'rgb(254,132,62)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(30,102,245)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(114,135,253)',
  permission: 'rgb(30,102,245)',
  permissionShimmer: 'rgb(114,135,253)',
  planMode: 'rgb(23,146,153)',
  promptBorder: 'rgb(124,127,147)',
  promptBorderShimmer: 'rgb(156,160,176)',
  text: 'rgb(76,79,105)',
  inverseText: 'rgb(239,241,245)',
  inactive: 'rgb(108,111,133)',
  inactiveShimmer: 'rgb(140,143,161)',
  subtle: 'rgb(172,176,190)',
  suggestion: 'rgb(30,102,245)',
  remember: 'rgb(30,102,245)',
  background: 'rgb(4,165,229)',
  success: 'rgb(64,160,43)',
  error: 'rgb(210,15,57)',
  warning: 'rgb(223,142,29)',
  merged: 'rgb(136,57,239)',
  warningShimmer: 'rgb(236,174,84)',
  diffAdded: 'rgb(209,242,199)',
  diffRemoved: 'rgb(247,204,213)',
  diffAddedDimmed: 'rgb(225,244,219)',
  diffRemovedDimmed: 'rgb(249,224,229)',
  diffAddedWord: 'rgb(64,160,43)',
  diffRemovedWord: 'rgb(210,15,57)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(210,15,57)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(30,102,245)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(64,160,43)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(223,142,29)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(136,57,239)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(254,100,11)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(234,118,203)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(23,146,153)',
  clawd_body: 'rgb(254,100,11)',
  userMessageBackground: 'rgb(230,233,239)',
  userMessageBackgroundHover: 'rgb(220,224,232)',
  messageActionsBackground: 'rgb(220,226,236)',
  selectionBg: 'rgb(180,206,255)',
  bashMessageBackgroundColor: 'rgb(236,239,244)',
  memoryBackgroundColor: 'rgb(225,235,241)',
  rate_limit_fill: 'rgb(30,102,245)',
  rate_limit_empty: 'rgb(114,135,253)',
  fastMode: 'rgb(254,100,11)',
  fastModeShimmer: 'rgb(254,132,62)',
  briefLabelYou: 'rgb(30,102,245)',
  briefLabelClaude: 'rgb(254,100,11)',
}

const catppuccinMacchiatoTheme: Theme = {
  ...catppuccinMochaTheme,
  autoAccept: 'rgb(198,160,246)',
  bashBorder: 'rgb(245,189,230)',
  claude: 'rgb(245,169,127)',
  claudeShimmer: 'rgb(247,196,167)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(138,173,244)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(166,199,255)',
  permission: 'rgb(138,173,244)',
  permissionShimmer: 'rgb(166,199,255)',
  planMode: 'rgb(139,213,202)',
  promptBorder: 'rgb(91,96,120)',
  promptBorderShimmer: 'rgb(128,135,162)',
  text: 'rgb(202,211,245)',
  inverseText: 'rgb(36,39,58)',
  inactive: 'rgb(165,173,203)',
  subtle: 'rgb(73,77,100)',
  suggestion: 'rgb(138,173,244)',
  remember: 'rgb(138,173,244)',
  background: 'rgb(145,215,227)',
  success: 'rgb(166,218,149)',
  error: 'rgb(237,135,150)',
  warning: 'rgb(238,212,159)',
  merged: 'rgb(198,160,246)',
  diffAdded: 'rgb(45,73,52)',
  diffRemoved: 'rgb(87,49,63)',
  diffAddedDimmed: 'rgb(54,67,59)',
  diffRemovedDimmed: 'rgb(73,58,65)',
  diffAddedWord: 'rgb(166,218,149)',
  diffRemovedWord: 'rgb(237,135,150)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(237,135,150)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(138,173,244)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(166,218,149)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(238,212,159)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(198,160,246)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(245,169,127)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(245,189,230)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(139,213,202)',
  clawd_body: 'rgb(245,169,127)',
  userMessageBackground: 'rgb(42,46,66)',
  userMessageBackgroundHover: 'rgb(54,58,79)',
  messageActionsBackground: 'rgb(35,39,57)',
  selectionBg: 'rgb(57,70,106)',
  bashMessageBackgroundColor: 'rgb(32,35,51)',
  memoryBackgroundColor: 'rgb(34,38,56)',
  rate_limit_fill: 'rgb(138,173,244)',
  rate_limit_empty: 'rgb(73,77,100)',
  fastMode: 'rgb(245,169,127)',
  fastModeShimmer: 'rgb(247,196,167)',
  briefLabelYou: 'rgb(138,173,244)',
  briefLabelClaude: 'rgb(245,169,127)',
}

const catppuccinFrappeTheme: Theme = {
  ...catppuccinMochaTheme,
  autoAccept: 'rgb(202,158,230)',
  bashBorder: 'rgb(244,184,228)',
  claude: 'rgb(239,159,118)',
  claudeShimmer: 'rgb(244,188,154)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(140,170,238)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(171,196,255)',
  permission: 'rgb(140,170,238)',
  permissionShimmer: 'rgb(171,196,255)',
  planMode: 'rgb(129,200,190)',
  promptBorder: 'rgb(98,104,128)',
  promptBorderShimmer: 'rgb(140,148,173)',
  text: 'rgb(198,208,245)',
  inverseText: 'rgb(48,52,70)',
  inactive: 'rgb(165,173,206)',
  subtle: 'rgb(81,87,109)',
  suggestion: 'rgb(140,170,238)',
  remember: 'rgb(140,170,238)',
  background: 'rgb(133,193,220)',
  success: 'rgb(166,209,137)',
  error: 'rgb(231,130,132)',
  warning: 'rgb(229,200,144)',
  merged: 'rgb(202,158,230)',
  diffAdded: 'rgb(49,74,52)',
  diffRemoved: 'rgb(90,52,60)',
  diffAddedDimmed: 'rgb(59,69,62)',
  diffRemovedDimmed: 'rgb(76,60,66)',
  diffAddedWord: 'rgb(166,209,137)',
  diffRemovedWord: 'rgb(231,130,132)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(231,130,132)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(140,170,238)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(166,209,137)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(229,200,144)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(202,158,230)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(239,159,118)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(244,184,228)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(129,200,190)',
  clawd_body: 'rgb(239,159,118)',
  userMessageBackground: 'rgb(48,52,70)',
  userMessageBackgroundHover: 'rgb(60,64,84)',
  messageActionsBackground: 'rgb(40,44,61)',
  selectionBg: 'rgb(60,72,104)',
  bashMessageBackgroundColor: 'rgb(39,42,58)',
  memoryBackgroundColor: 'rgb(41,45,62)',
  rate_limit_fill: 'rgb(140,170,238)',
  rate_limit_empty: 'rgb(81,87,109)',
  fastMode: 'rgb(239,159,118)',
  fastModeShimmer: 'rgb(244,188,154)',
  briefLabelYou: 'rgb(140,170,238)',
  briefLabelClaude: 'rgb(239,159,118)',
}

const tokyoNightTheme: Theme = {
  ...darkTheme,
  autoAccept: 'rgb(187,154,247)',
  bashBorder: 'rgb(247,118,142)',
  claude: 'rgb(255,158,100)',
  claudeShimmer: 'rgb(255,186,139)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(122,162,247)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(144,190,255)',
  permission: 'rgb(122,162,247)',
  permissionShimmer: 'rgb(144,190,255)',
  planMode: 'rgb(125,207,255)',
  promptBorder: 'rgb(70,77,109)',
  promptBorderShimmer: 'rgb(105,116,162)',
  text: 'rgb(192,202,245)',
  inverseText: 'rgb(26,27,38)',
  inactive: 'rgb(136,146,186)',
  inactiveShimmer: 'rgb(192,202,245)',
  subtle: 'rgb(49,56,84)',
  suggestion: 'rgb(122,162,247)',
  remember: 'rgb(122,162,247)',
  background: 'rgb(125,207,255)',
  success: 'rgb(158,206,106)',
  error: 'rgb(247,118,142)',
  warning: 'rgb(224,175,104)',
  merged: 'rgb(187,154,247)',
  warningShimmer: 'rgb(239,198,136)',
  diffAdded: 'rgb(37,65,44)',
  diffRemoved: 'rgb(89,42,62)',
  diffAddedDimmed: 'rgb(53,66,58)',
  diffRemovedDimmed: 'rgb(72,56,66)',
  diffAddedWord: 'rgb(158,206,106)',
  diffRemovedWord: 'rgb(247,118,142)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(247,118,142)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(122,162,247)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(158,206,106)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(224,175,104)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(187,154,247)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,158,100)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(187,154,247)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(125,207,255)',
  clawd_body: 'rgb(255,158,100)',
  userMessageBackground: 'rgb(28,32,48)',
  userMessageBackgroundHover: 'rgb(38,43,64)',
  messageActionsBackground: 'rgb(25,31,49)',
  selectionBg: 'rgb(34,52,88)',
  bashMessageBackgroundColor: 'rgb(25,28,43)',
  memoryBackgroundColor: 'rgb(24,31,49)',
  rate_limit_fill: 'rgb(122,162,247)',
  rate_limit_empty: 'rgb(65,72,104)',
  fastMode: 'rgb(255,158,100)',
  fastModeShimmer: 'rgb(255,186,139)',
  briefLabelYou: 'rgb(122,162,247)',
  briefLabelClaude: 'rgb(255,158,100)',
}

const highContrastDarkTheme: Theme = {
  ...darkTheme,
  autoAccept: 'rgb(255,0,255)',
  bashBorder: 'rgb(255,85,170)',
  claude: 'rgb(255,170,0)',
  claudeShimmer: 'rgb(255,205,90)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(110,180,255)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(175,220,255)',
  permission: 'rgb(110,180,255)',
  permissionShimmer: 'rgb(175,220,255)',
  planMode: 'rgb(0,255,230)',
  promptBorder: 'rgb(210,210,210)',
  promptBorderShimmer: 'rgb(255,255,255)',
  text: 'rgb(255,255,255)',
  inverseText: 'rgb(0,0,0)',
  inactive: 'rgb(210,210,210)',
  inactiveShimmer: 'rgb(255,255,255)',
  subtle: 'rgb(120,120,120)',
  suggestion: 'rgb(110,180,255)',
  remember: 'rgb(110,180,255)',
  background: 'rgb(0,255,255)',
  success: 'rgb(80,255,80)',
  error: 'rgb(255,90,120)',
  warning: 'rgb(255,215,0)',
  merged: 'rgb(255,0,255)',
  warningShimmer: 'rgb(255,240,120)',
  diffAdded: 'rgb(15,90,30)',
  diffRemoved: 'rgb(110,25,45)',
  diffAddedDimmed: 'rgb(42,88,50)',
  diffRemovedDimmed: 'rgb(98,48,60)',
  diffAddedWord: 'rgb(80,255,80)',
  diffRemovedWord: 'rgb(255,90,120)',
  userMessageBackground: 'rgb(35,35,35)',
  userMessageBackgroundHover: 'rgb(55,55,55)',
  messageActionsBackground: 'rgb(28,36,52)',
  selectionBg: 'rgb(25,85,145)',
  bashMessageBackgroundColor: 'rgb(28,28,28)',
  memoryBackgroundColor: 'rgb(30,38,48)',
  rate_limit_fill: 'rgb(110,180,255)',
  rate_limit_empty: 'rgb(92,92,92)',
  fastMode: 'rgb(255,140,0)',
  fastModeShimmer: 'rgb(255,190,90)',
}

const highContrastLightTheme: Theme = {
  ...lightTheme,
  autoAccept: 'rgb(120,0,220)',
  bashBorder: 'rgb(220,0,120)',
  claude: 'rgb(210,85,0)',
  claudeShimmer: 'rgb(240,140,60)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(0,90,220)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(80,140,255)',
  permission: 'rgb(0,90,220)',
  permissionShimmer: 'rgb(80,140,255)',
  planMode: 'rgb(0,120,120)',
  promptBorder: 'rgb(70,70,70)',
  promptBorderShimmer: 'rgb(110,110,110)',
  text: 'rgb(0,0,0)',
  inverseText: 'rgb(255,255,255)',
  inactive: 'rgb(60,60,60)',
  inactiveShimmer: 'rgb(110,110,110)',
  subtle: 'rgb(135,135,135)',
  suggestion: 'rgb(0,90,220)',
  remember: 'rgb(0,90,220)',
  background: 'rgb(0,140,170)',
  success: 'rgb(0,128,32)',
  error: 'rgb(190,0,40)',
  warning: 'rgb(170,105,0)',
  merged: 'rgb(120,0,220)',
  warningShimmer: 'rgb(210,150,40)',
  diffAdded: 'rgb(175,240,185)',
  diffRemoved: 'rgb(255,190,205)',
  diffAddedDimmed: 'rgb(205,245,212)',
  diffRemovedDimmed: 'rgb(255,220,228)',
  diffAddedWord: 'rgb(0,128,32)',
  diffRemovedWord: 'rgb(190,0,40)',
  userMessageBackground: 'rgb(232,232,232)',
  userMessageBackgroundHover: 'rgb(244,244,244)',
  messageActionsBackground: 'rgb(223,230,241)',
  selectionBg: 'rgb(160,205,255)',
  bashMessageBackgroundColor: 'rgb(245,245,245)',
  memoryBackgroundColor: 'rgb(228,240,247)',
  rate_limit_fill: 'rgb(0,90,220)',
  rate_limit_empty: 'rgb(110,110,110)',
  fastMode: 'rgb(220,100,0)',
  fastModeShimmer: 'rgb(240,150,70)',
}

const rosePineTheme: Theme = {
  ...darkTheme,
  autoAccept: 'rgb(196,167,231)',
  bashBorder: 'rgb(235,188,186)',
  claude: 'rgb(246,193,119)',
  claudeShimmer: 'rgb(250,214,156)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(156,207,216)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(188,228,234)',
  permission: 'rgb(156,207,216)',
  permissionShimmer: 'rgb(188,228,234)',
  planMode: 'rgb(131,193,190)',
  promptBorder: 'rgb(82,79,103)',
  promptBorderShimmer: 'rgb(110,106,134)',
  text: 'rgb(224,222,244)',
  inverseText: 'rgb(25,23,36)',
  inactive: 'rgb(144,140,170)',
  inactiveShimmer: 'rgb(173,169,204)',
  subtle: 'rgb(57,53,74)',
  suggestion: 'rgb(156,207,216)',
  remember: 'rgb(156,207,216)',
  background: 'rgb(156,207,216)',
  success: 'rgb(49,116,143)',
  error: 'rgb(235,111,146)',
  warning: 'rgb(246,193,119)',
  merged: 'rgb(196,167,231)',
  warningShimmer: 'rgb(249,216,162)',
  diffAdded: 'rgb(38,59,74)',
  diffRemoved: 'rgb(80,40,58)',
  diffAddedDimmed: 'rgb(49,57,69)',
  diffRemovedDimmed: 'rgb(66,49,61)',
  diffAddedWord: 'rgb(156,207,216)',
  diffRemovedWord: 'rgb(235,111,146)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(235,111,146)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(49,116,143)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(131,193,190)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(246,193,119)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(196,167,231)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,154,151)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(235,188,186)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(156,207,216)',
  clawd_body: 'rgb(246,193,119)',
  userMessageBackground: 'rgb(35,33,48)',
  userMessageBackgroundHover: 'rgb(47,44,62)',
  messageActionsBackground: 'rgb(30,28,42)',
  selectionBg: 'rgb(63,69,98)',
  bashMessageBackgroundColor: 'rgb(30,28,41)',
  memoryBackgroundColor: 'rgb(32,30,45)',
  rate_limit_fill: 'rgb(156,207,216)',
  rate_limit_empty: 'rgb(57,53,74)',
  fastMode: 'rgb(246,193,119)',
  fastModeShimmer: 'rgb(249,216,162)',
  briefLabelYou: 'rgb(156,207,216)',
  briefLabelClaude: 'rgb(246,193,119)',
}

const rosePineDawnTheme: Theme = {
  ...lightTheme,
  autoAccept: 'rgb(144,122,169)',
  bashBorder: 'rgb(215,130,126)',
  claude: 'rgb(234,157,52)',
  claudeShimmer: 'rgb(240,186,112)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(86,148,159)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(130,178,188)',
  permission: 'rgb(86,148,159)',
  permissionShimmer: 'rgb(130,178,188)',
  planMode: 'rgb(87,132,121)',
  promptBorder: 'rgb(121,117,147)',
  promptBorderShimmer: 'rgb(151,147,174)',
  text: 'rgb(87,82,121)',
  inverseText: 'rgb(250,244,237)',
  inactive: 'rgb(110,105,135)',
  inactiveShimmer: 'rgb(145,140,168)',
  subtle: 'rgb(190,186,218)',
  suggestion: 'rgb(86,148,159)',
  remember: 'rgb(86,148,159)',
  background: 'rgb(86,148,159)',
  success: 'rgb(40,105,131)',
  error: 'rgb(181,99,122)',
  warning: 'rgb(234,157,52)',
  merged: 'rgb(144,122,169)',
  warningShimmer: 'rgb(241,186,112)',
  diffAdded: 'rgb(201,232,239)',
  diffRemoved: 'rgb(242,212,222)',
  diffAddedDimmed: 'rgb(220,238,242)',
  diffRemovedDimmed: 'rgb(246,228,233)',
  diffAddedWord: 'rgb(86,148,159)',
  diffRemovedWord: 'rgb(181,99,122)',
  red_FOR_SUBAGENTS_ONLY: 'rgb(181,99,122)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(40,105,131)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(87,132,121)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(234,157,52)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(144,122,169)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(215,130,126)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(221,162,169)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(86,148,159)',
  clawd_body: 'rgb(234,157,52)',
  userMessageBackground: 'rgb(242,236,231)',
  userMessageBackgroundHover: 'rgb(248,241,235)',
  messageActionsBackground: 'rgb(232,226,222)',
  selectionBg: 'rgb(196,216,226)',
  bashMessageBackgroundColor: 'rgb(246,241,236)',
  memoryBackgroundColor: 'rgb(235,231,227)',
  rate_limit_fill: 'rgb(86,148,159)',
  rate_limit_empty: 'rgb(151,147,174)',
  fastMode: 'rgb(234,157,52)',
  fastModeShimmer: 'rgb(241,186,112)',
  briefLabelYou: 'rgb(86,148,159)',
  briefLabelClaude: 'rgb(234,157,52)',
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case 'light':
      return lightTheme
    case 'light-ansi':
      return lightAnsiTheme
    case 'dark-ansi':
      return darkAnsiTheme
    case 'light-daltonized':
      return lightDaltonizedTheme
    case 'dark-daltonized':
      return darkDaltonizedTheme
    case 'catppuccin-mocha':
      return catppuccinMochaTheme
    case 'catppuccin-latte':
      return catppuccinLatteTheme
    case 'catppuccin-macchiato':
      return catppuccinMacchiatoTheme
    case 'catppuccin-frappe':
      return catppuccinFrappeTheme
    case 'tokyo-night':
      return tokyoNightTheme
    case 'high-contrast-dark':
      return highContrastDarkTheme
    case 'high-contrast-light':
      return highContrastLightTheme
    case 'rose-pine':
      return rosePineTheme
    case 'rose-pine-dawn':
      return rosePineDawnTheme
    default:
      return darkTheme
  }
}

// Create a chalk instance with 256-color level for Apple Terminal
// Apple Terminal doesn't handle 24-bit color escape sequences well
const chalkForChart =
  env.terminal === 'Apple_Terminal'
    ? new Chalk({ level: 2 }) // 256 colors
    : chalk

/**
 * Converts a theme color to an ANSI escape sequence for use with asciichart.
 * Uses chalk to generate the escape codes, with 256-color mode for Apple Terminal.
 */
export function themeColorToAnsi(themeColor: string): string {
  const rgbMatch = themeColor.match(/rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10)
    const g = parseInt(rgbMatch[2]!, 10)
    const b = parseInt(rgbMatch[3]!, 10)
    // Use chalk.rgb which auto-converts to 256 colors when level is 2
    // Extract just the opening escape sequence by using a marker
    const colored = chalkForChart.rgb(r, g, b)('X')
    return colored.slice(0, colored.indexOf('X'))
  }
  // Fallback to magenta if parsing fails
  return '\x1b[35m'
}
