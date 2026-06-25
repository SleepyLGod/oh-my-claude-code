export type MemorySelectorParseMode = 'strict' | 'lenient'

const MAX_SELECTED_MEMORIES = 5

export function parseSelectedMemoryFilenames(
  rawText: string,
  validFilenames: ReadonlySet<string>,
  selectorParseMode: MemorySelectorParseMode,
): string[] {
  if (selectorParseMode === 'strict') {
    return parseStrictSelection(rawText, validFilenames)
  }

  const strictSelection = parseStrictSelection(rawText, validFilenames)
  if (strictSelection.length > 0) return strictSelection

  const parsed = parseJsonOrFencedJson(rawText)
  if (Array.isArray(parsed)) {
    return validUniqueFilenames(parsed, validFilenames)
  }
  if (parsed && typeof parsed === 'object') {
    const selected = (parsed as { selected_memories?: unknown }).selected_memories
    if (Array.isArray(selected)) return validUniqueFilenames(selected, validFilenames)
  }

  return validUniqueFilenames(extractFilenameHints(rawText), validFilenames)
}

function parseStrictSelection(
  rawText: string,
  validFilenames: ReadonlySet<string>,
): string[] {
  try {
    const parsed = JSON.parse(rawText) as { selected_memories?: unknown }
    return Array.isArray(parsed.selected_memories)
      ? validUniqueFilenames(parsed.selected_memories, validFilenames)
      : []
  } catch {
    return []
  }
}

function parseJsonOrFencedJson(rawText: string): unknown {
  const candidates = [rawText, ...extractFencedJson(rawText)]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

function extractFencedJson(rawText: string): string[] {
  return [...rawText.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(match => match[1] ?? '')
}

function extractFilenameHints(rawText: string): string[] {
  return rawText.match(/[A-Za-z0-9][A-Za-z0-9._-]*\.md/g) ?? []
}

function validUniqueFilenames(
  filenames: readonly unknown[],
  validFilenames: ReadonlySet<string>,
): string[] {
  const selected: string[] = []
  const seen = new Set<string>()
  for (const filename of filenames) {
    if (typeof filename !== 'string' || !validFilenames.has(filename) || seen.has(filename)) {
      continue
    }
    selected.push(filename)
    seen.add(filename)
    if (selected.length >= MAX_SELECTED_MEMORIES) break
  }
  return selected
}
