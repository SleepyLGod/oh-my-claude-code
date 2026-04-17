import type { LocalCommandCall } from '../../types/command.js'
import { companionUserId, getCompanion, roll } from '../../buddy/companion.js'
import type { StoredCompanion } from '../../buddy/types.js'
import { RARITY_STARS } from '../../buddy/types.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

const NAME_PREFIXES = [
  'Pixel',
  'Nova',
  'Orbit',
  'Maple',
  'Pico',
  'Comet',
  'Clover',
  'Tango',
  'Rusty',
  'Miso',
] as const

const NAME_SUFFIXES = [
  'Spark',
  'Scout',
  'Gizmo',
  'Pebble',
  'Patch',
  'Wisp',
  'Sprout',
  'Bloop',
  'Noodle',
  'Buddy',
] as const

const PERSONALITIES = [
  'Curious, patient, and slightly overdramatic.',
  'Quietly observant until something interesting happens.',
  'Cheerful, nosy, and always ready to react.',
  'Calm under pressure with a suspicious love of tiny adventures.',
  'Polite, alert, and prone to theatrical side commentary.',
  'Gentle, weirdly confident, and delighted by progress bars.',
  'Soft-spoken, stubborn, and very proud of small wins.',
  'Playful, tidy, and convinced every bug is a puzzle.',
] as const

function pickFromSeed<T>(seed: number, values: readonly T[], shift: number): T {
  return values[Math.floor(seed / shift) % values.length]!
}

function createStoredCompanion(): StoredCompanion {
  const {
    inspirationSeed,
  } = roll(companionUserId())

  const prefix = pickFromSeed(inspirationSeed, NAME_PREFIXES, 1)
  const suffix = pickFromSeed(inspirationSeed, NAME_SUFFIXES, 11)
  const personality = pickFromSeed(inspirationSeed, PERSONALITIES, 97)

  return {
    name: `${prefix} ${suffix}`,
    personality,
    hatchedAt: Date.now(),
  }
}

function describeCompanion(): string {
  const companion = getCompanion()
  if (!companion) {
    return 'No companion hatched yet. Run /buddy hatch to create one.'
  }

  const muted = getGlobalConfig().companionMuted ? 'muted' : 'active'
  return [
    `${companion.name} is your ${companion.rarity} ${companion.species} companion ${RARITY_STARS[companion.rarity]}.`,
    `Status: ${muted}.`,
    `Personality: ${companion.personality}`,
  ].join(' ')
}

function usageText(): string {
  return 'Usage: /buddy [status|hatch|pet|mute|unmute]'
}

export const call: LocalCommandCall = async (args, context) => {
  const subcommand = args.trim().toLowerCase() || 'status'

  switch (subcommand) {
    case 'status':
      return {
        type: 'text',
        value: describeCompanion(),
      }

    case 'hatch': {
      const existing = getCompanion()
      if (existing) {
        return {
          type: 'text',
          value: `${existing.name} is already hatched. ${describeCompanion()}`,
        }
      }

      const storedCompanion = createStoredCompanion()
      saveGlobalConfig(current => ({
        ...current,
        companion: storedCompanion,
      }))

      return {
        type: 'text',
        value: `Companion hatched: ${describeCompanion()}`,
      }
    }

    case 'pet': {
      const companion = getCompanion()
      if (!companion) {
        return {
          type: 'text',
          value: 'No companion hatched yet. Run /buddy hatch first.',
        }
      }

      context.setAppState(prev => ({
        ...prev,
        companionPetAt: Date.now(),
      }))

      return {
        type: 'text',
        value: `You pet ${companion.name}.`,
      }
    }

    case 'mute':
      saveGlobalConfig(current => ({
        ...current,
        companionMuted: true,
      }))
      return {
        type: 'text',
        value: 'Companion reactions muted.',
      }

    case 'unmute':
      saveGlobalConfig(current => ({
        ...current,
        companionMuted: false,
      }))
      return {
        type: 'text',
        value: 'Companion reactions enabled.',
      }

    default:
      return {
        type: 'text',
        value: usageText(),
      }
  }
}
