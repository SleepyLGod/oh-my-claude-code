import { feature } from 'bun:bundle'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { getDefaultSonnetModel } from '../utils/model/model.js'
import { sideQuery } from '../utils/sideQuery.js'
import { jsonParse } from '../utils/slowOperations.js'
import {
  formatMemoryManifest,
  type MemoryHeader,
  scanMemoryFiles,
} from './memoryScan.js'

export type RelevantMemory = {
  path: string
  mtimeMs: number
}

export type MemorySelectorParseMode = 'strict' | 'lenient'

type FindRelevantMemoriesOptions = {
  selectorParseMode?: MemorySelectorParseMode
}

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.
`
const SELECT_MEMORIES_MAX_TOKENS = 8192
const MAX_SELECTED_MEMORIES = 5

/**
 * Find memory files relevant to a query by scanning memory file headers
 * and asking Sonnet to select the most relevant ones.
 *
 * Returns absolute file paths + mtime of the most relevant memories
 * (up to 5). Excludes MEMORY.md (already loaded in system prompt).
 * mtime is threaded through so callers can surface freshness to the
 * main model without a second stat.
 *
 * `alreadySurfaced` filters paths shown in prior turns before the
 * Sonnet call, so the selector spends its 5-slot budget on fresh
 * candidates instead of re-picking files the caller will discard.
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  recentTools: readonly string[] = [],
  alreadySurfaced: ReadonlySet<string> = new Set(),
  options: FindRelevantMemoriesOptions = {},
): Promise<RelevantMemory[]> {
  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    m => !alreadySurfaced.has(m.filePath),
  )
  if (memories.length === 0) {
    return []
  }

  const selectedFilenames = await selectRelevantMemories(
    query,
    memories,
    signal,
    recentTools,
    options.selectorParseMode ?? 'strict',
  )
  const byFilename = new Map(memories.map(m => [m.filename, m]))
  const selected = selectedFilenames
    .map(filename => byFilename.get(filename))
    .filter((m): m is MemoryHeader => m !== undefined)

  // Fires even on empty selection: selection-rate needs the denominator,
  // and -1 ages distinguish "ran, picked nothing" from "never ran".
  if (feature('MEMORY_SHAPE_TELEMETRY')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { logMemoryRecallShape } =
      require('./memoryShapeTelemetry.js') as typeof import('./memoryShapeTelemetry.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    logMemoryRecallShape(memories, selected)
  }

  return selected.map(m => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}

async function selectRelevantMemories(
  query: string,
  memories: MemoryHeader[],
  signal: AbortSignal,
  recentTools: readonly string[],
  selectorParseMode: MemorySelectorParseMode,
): Promise<string[]> {
  const validFilenames = new Set(memories.map(m => m.filename))

  const manifest = formatMemoryManifest(memories)

  // When Claude Code is actively using a tool (e.g. mcp__X__spawn),
  // surfacing that tool's reference docs is noise — the conversation
  // already contains working usage.  The selector otherwise matches
  // on keyword overlap ("spawn" in query + "spawn" in a memory
  // description → false positive).
  const toolsSection =
    recentTools.length > 0
      ? `\n\nRecently used tools: ${recentTools.join(', ')}`
      : ''

  try {
    const result = await sideQuery({
      model: getDefaultSonnetModel(),
      system: SELECT_MEMORIES_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [
        {
          role: 'user',
          content: `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`,
        },
      ],
      max_tokens: SELECT_MEMORIES_MAX_TOKENS,
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            selected_memories: { type: 'array', items: { type: 'string' } },
          },
          required: ['selected_memories'],
          additionalProperties: false,
        },
      },
      signal,
      querySource: 'memdir_relevance',
    })

    const textBlock = result.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return []
    }

    return parseSelectedMemoryFilenames(textBlock.text, validFilenames, selectorParseMode)
  } catch (e) {
    if (signal.aborted) {
      return []
    }
    logForDebugging(
      `[memdir] selectRelevantMemories failed: ${errorMessage(e)}`,
      { level: 'warn' },
    )
    return []
  }
}

export function parseSelectedMemoryFilenames(
  rawText: string,
  validFilenames: ReadonlySet<string>,
  selectorParseMode: MemorySelectorParseMode,
): string[] {
  if (selectorParseMode === 'strict') {
    const parsed: { selected_memories?: unknown } = jsonParse(rawText)
    return Array.isArray(parsed.selected_memories)
      ? validUniqueFilenames(parsed.selected_memories, validFilenames)
      : []
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
    const parsed: { selected_memories?: unknown } = jsonParse(rawText)
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
      return jsonParse(candidate)
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
