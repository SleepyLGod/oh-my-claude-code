import { APIUserAbortError } from '@anthropic-ai/sdk'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  LOCAL_COMMAND_CAVEAT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  COMMAND_MESSAGE_TAG,
} from '../../constants/xml.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import { getSessionMemoryContent } from '../../services/SessionMemory/sessionMemoryUtils.js'
import type { Message, UserMessage } from '../../types/message.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'
import { logForDebugging } from '../../utils/debug.js'
import { isHumanTurn } from '../../utils/messagePredicates.js'
import {
  createUserMessage,
  extractTag,
  getAssistantMessageText,
  NO_RESPONSE_REQUESTED,
  textForResubmit,
} from '../../utils/messages.js'
import { getSmallFastModel } from '../../utils/model/model.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

const RECENT_MESSAGE_WINDOW = 40
const SUMMARY_MODEL_TIMEOUT_MS = 20_000
const COMPACT_CONTINUATION_PREFIX =
  'This session is being continued from a previous conversation that ran out of context.'

export type SummaryMode = 'short' | 'long'
type SummarySource = 'model' | 'fallback'

type SessionSnapshot = {
  firstUserPrompt: string | null
  latestUserPrompt: string | null
  latestAssistantText: string | null
  memoryHint: string | null
  compactTask: string | null
  compactProgress: string | null
  compactNext: string | null
}

export function parseSummaryMode(args: string): {
  mode: SummaryMode
  error?: string
} {
  const value = args.trim().toLowerCase()
  if (!value || value === 'short') {
    return { mode: 'short' }
  }
  if (value === 'long') {
    return { mode: 'long' }
  }
  return {
    mode: 'short',
    error: 'Usage: /summary [short|long]',
  }
}

export async function generateSessionSummary(
  messages: readonly Message[],
  signal: AbortSignal,
  mode: SummaryMode,
): Promise<string> {
  const generatedSummary = await generateModelSummary(messages, signal, mode)
  const nextSummary = generatedSummary
    ? withSummarySource(generatedSummary, 'model', mode)
    : withSummarySource(buildFallbackSummary(messages, mode), 'fallback', mode)

  const previousSummary = getPreviousSummaryOutput(messages)
  if (
    previousSummary &&
    normalizeForComparison(previousSummary) === normalizeForComparison(nextSummary)
  ) {
    return markSummaryAsUnchanged(nextSummary, mode)
  }

  return nextSummary
}

async function generateModelSummary(
  messages: readonly Message[],
  signal: AbortSignal,
  mode: SummaryMode,
): Promise<string | null> {
  if (messages.length === 0) {
    return null
  }

  try {
    const {
      signal: summarySignal,
      cleanup: cleanupSummarySignal,
    } = createCombinedAbortSignal(signal, {
      timeoutMs: SUMMARY_MODEL_TIMEOUT_MS,
    })
    const memory = await getSessionMemoryContent().catch(() => null)
    const recentMessages = messages.slice(-RECENT_MESSAGE_WINDOW)
    try {
      const response = await queryModelWithoutStreaming({
        messages: [
          ...recentMessages,
          createUserMessage({
            content: buildSummaryPrompt(mode, memory),
          }),
        ],
        systemPrompt: asSystemPrompt([]),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: summarySignal,
        options: {
          getToolPermissionContext: async () => getEmptyToolPermissionContext(),
          model: getSmallFastModel(),
          toolChoice: undefined,
          isNonInteractiveSession: false,
          hasAppendSystemPrompt: false,
          agents: [],
          querySource: 'session_summary',
          mcpTools: [],
          skipCacheWrite: true,
        },
      })

      if (response.isApiErrorMessage) {
        logForDebugging(
          `[summary] API error: ${getAssistantMessageText(response) ?? 'unknown'}`,
        )
        return null
      }

      return normalizeGeneratedSummary(getAssistantMessageText(response), mode)
    } finally {
      cleanupSummarySignal()
    }
  } catch (error) {
    if (error instanceof APIUserAbortError || signal.aborted) {
      return null
    }
    logForDebugging(
      `[summary] generation failed or timed out after ${SUMMARY_MODEL_TIMEOUT_MS}ms: ${String(error)}`,
    )
    return null
  }
}

function buildSummaryPrompt(mode: SummaryMode, memory: string | null): string {
  const memoryBlock = memory
    ? `Session memory (broader context):\n${memory}\n\n`
    : ''

  if (mode === 'long') {
    return `${memoryBlock}Summarize only the current session. Write exactly these three sections and nothing else:

Task:
1-2 sentences on the high-level task the user is working on.

Progress:
2-4 sentences on what has already been figured out, changed, or decided.

Next:
1-2 sentences on the concrete next step.

Do not mention costs, account state, or git unless they are central to the task.`
  }

  return `${memoryBlock}Summarize only the current session. Write exactly these three lines and nothing else:
Task: ...
Progress: ...
Next: ...

Keep each line concise and action-oriented. Focus on the high-level task, the current state, and the next concrete step.`
}

function buildFallbackSummary(
  messages: readonly Message[],
  mode: SummaryMode,
): string {
  const snapshot = snapshotSession(messages)
  const task =
    snapshot.firstUserPrompt ??
    snapshot.compactTask ??
    snapshot.memoryHint ??
    'No active task has been established in this session yet.'
  const progress = buildFallbackProgress(snapshot)
  const next = buildFallbackNext(snapshot)

  if (mode === 'long') {
    return `Task:\n${task}\n\nProgress:\n${progress}\n\nNext:\n${next}`
  }

  return `Task: ${task}\nProgress: ${progress}\nNext: ${next}`
}

function snapshotSession(messages: readonly Message[]): SessionSnapshot {
  let firstUserPrompt: string | null = null
  let latestUserPrompt: string | null = null
  let latestAssistantText: string | null = null
  let compactTask: string | null = null
  let compactProgress: string | null = null
  let compactNext: string | null = null

  for (const message of messages) {
    if (message.type === 'user' && message.isCompactSummary) {
      const compactSummary = parseCompactSummary(message)
      compactTask = compactSummary.task ?? compactTask
      compactProgress = compactSummary.progress ?? compactProgress
      compactNext = compactSummary.next ?? compactNext
      continue
    }

    if (isHumanTurn(message)) {
      const text = extractUserPrompt(message)
      if (!text) continue
      if (!firstUserPrompt) {
        firstUserPrompt = text
      }
      latestUserPrompt = text
      continue
    }

    const assistantText = normalizeAssistantSummaryText(
      getAssistantMessageText(message),
    )
    if (assistantText) {
      latestAssistantText = assistantText
    }
  }

  return {
    firstUserPrompt,
    latestUserPrompt,
    latestAssistantText,
    memoryHint: null,
    compactTask,
    compactProgress,
    compactNext,
  }
}

function getPreviousSummaryOutput(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 1; index--) {
    const outputMessage = messages[index]
    const commandMessage = messages[index - 1]

    if (
      outputMessage?.type !== 'system' ||
      outputMessage.subtype !== 'local_command' ||
      typeof outputMessage.content !== 'string'
    ) {
      continue
    }

    if (
      commandMessage?.type !== 'system' ||
      commandMessage.subtype !== 'local_command' ||
      typeof commandMessage.content !== 'string'
    ) {
      continue
    }

    const commandName = extractTag(commandMessage.content, COMMAND_MESSAGE_TAG)
    if (commandName !== 'summary') {
      continue
    }

    const summaryOutput = extractTag(
      outputMessage.content,
      LOCAL_COMMAND_STDOUT_TAG,
    )
    return summaryOutput?.trim() ?? null
  }

  return null
}

function extractUserPrompt(message: UserMessage): string | null {
  const prompt = textForResubmit(message)
  if (!prompt) return null

  const text = normalizeText(prompt.text)
  if (!text) return null
  if (text.startsWith('/')) return null
  if (text.startsWith(COMPACT_CONTINUATION_PREFIX)) return null
  if (text.startsWith('Unknown skill: ')) return null
  if (text.startsWith('Args from unknown skill: ')) return null
  if (text.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) return null
  if (text.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`)) return null
  if (text.includes(`<${LOCAL_COMMAND_STDERR_TAG}>`)) return null
  if (text.includes('<command-name>')) return null
  if (text.includes('<command-message>')) return null

  return text
}

function buildFallbackProgress(snapshot: SessionSnapshot): string {
  if (snapshot.latestAssistantText) {
    return truncate(snapshot.latestAssistantText, 280)
  }

  if (snapshot.compactProgress) {
    return truncate(snapshot.compactProgress, 280)
  }

  if (snapshot.latestUserPrompt) {
    return `The latest request is "${truncate(snapshot.latestUserPrompt, 180)}", but there is no assistant reply yet.`
  }

  return 'This session does not have enough assistant output to summarize yet.'
}

function buildFallbackNext(snapshot: SessionSnapshot): string {
  if (snapshot.latestUserPrompt) {
    return `Continue from the latest request: ${truncate(snapshot.latestUserPrompt, 180)}`
  }

  if (snapshot.compactNext) {
    return truncate(snapshot.compactNext, 220)
  }

  return 'Send a prompt or resume a conversation, then run /summary again.'
}

function normalizeText(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeAssistantSummaryText(value: string | null): string | null {
  const normalized = normalizeText(value)
  if (!normalized || normalized === NO_RESPONSE_REQUESTED) {
    return null
  }
  return normalized
}

function parseCompactSummary(
  message: UserMessage,
): { task: string | null; progress: string | null; next: string | null } {
  const content =
    typeof message.message.content === 'string' ? message.message.content : null
  if (!content) {
    return { task: null, progress: null, next: null }
  }

  const summaryStart = content.indexOf('Summary:')
  const summaryBody =
    summaryStart >= 0 ? content.slice(summaryStart + 'Summary:'.length) : content

  const sections = new Map<string, string>()
  const sectionRegex =
    /^\s*(\d+)\.\s+([^\n:]+):\s*([\s\S]*?)(?=^\s*\d+\.\s+[^\n:]+:\s*|\s*$)/gm

  for (const match of summaryBody.matchAll(sectionRegex)) {
    const title = normalizeText(match[2] ?? '')?.toLowerCase()
    const body = normalizeText(match[3] ?? '')
    if (title && body) {
      sections.set(title, body)
    }
  }

  return {
    task:
      sections.get('primary request and intent') ??
      sections.get('current work') ??
      null,
    progress:
      sections.get('current work') ??
      sections.get('problem solving') ??
      sections.get('errors and fixes') ??
      null,
    next:
      sections.get('optional next step') ??
      sections.get('pending tasks') ??
      null,
  }
}

function normalizeGeneratedSummary(
  value: string | null,
  mode: SummaryMode,
): string | null {
  if (!value) return null

  if (mode === 'short') {
    const lines = value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 3)
    return lines.length > 0 ? lines.join('\n') : null
  }

  const normalized = value
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized.length > 0 ? normalized : null
}

function normalizeForComparison(value: string): string {
  return value
    .replace(/\nSource: (model|fallback)\s*$/m, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function withSummarySource(
  summary: string,
  source: SummarySource,
  mode: SummaryMode,
): string {
  const sourceLine = `Source: ${source}`
  if (mode === 'long') {
    return `${summary}\n\n${sourceLine}`
  }
  return `${summary}\n${sourceLine}`
}

function markSummaryAsUnchanged(
  summary: string,
  mode: SummaryMode,
): string {
  if (mode === 'short') {
    const lines = summary.split('\n')
    return lines
      .map(line =>
        line.startsWith('Progress:')
          ? 'Progress: No material change since the last /summary.'
          : line,
      )
      .join('\n')
  }

  return summary.replace(
    /Progress:\n/,
    'Progress:\nNo material change since the last /summary.\n',
  )
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
