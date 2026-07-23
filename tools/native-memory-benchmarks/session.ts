import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { basename, join, relative, resolve } from 'path'
import { withExecutionTraceContext } from '../../src/utils/executionTrace.ts'
import type { MemorySelectorParseMode } from '../../src/memdir/memorySelectorParser.ts'
import {
  loadNativeRuntime,
  setupIsolatedEnvironment,
  writeSettings,
  type NativeRuntime,
} from '../native-memory-component-eval/run.ts'
export type SessionOptions = {
  stateDir: string
  traceDir: string
  provider: string
  model: string
  selectorParseMode: MemorySelectorParseMode
  caseId: string
  attempt: number
}

export type CanonicalEvent = {
  event_id: string
  speaker: string
  text: string
  session_id?: string
  timestamp?: string
}

type MemorySnapshot = {
  files: Map<string, string>
  totalBytes: number
}

function inspectMemory(directory: string, relativeDir = ''): MemorySnapshot {
  const files = new Map<string, string>()
  let totalBytes = 0
  if (!existsSync(directory)) return { files, totalBytes }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = join(relativeDir, entry.name)
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = inspectMemory(absolutePath, relativePath)
      totalBytes += nested.totalBytes
      for (const [path, digest] of nested.files) files.set(path, digest)
      continue
    }
    if (!entry.isFile()) continue
    const content = readFileSync(absolutePath)
    totalBytes += content.byteLength
    files.set(relativePath, createHash('sha256').update(content).digest('hex'))
  }
  return { files, totalBytes }
}

function memoryDiff(before: MemorySnapshot, after: MemorySnapshot): {
  added: number
  changed: number
  removed: number
} {
  return {
    added: [...after.files.keys()].filter(path => !before.files.has(path)).length,
    changed: [...after.files].filter(
      ([path, digest]) => before.files.has(path) && before.files.get(path) !== digest,
    ).length,
    removed: [...before.files.keys()].filter(path => !after.files.has(path)).length,
  }
}

function requiredString(
  value: unknown,
  name: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

export function formatBenchmarkEvent(event: Record<string, unknown>): string {
  const canonical = canonicalBenchmarkEvent(event)
  return [
    'Benchmark dialogue utterance for memory extraction.',
    `speaker: ${canonical.speaker}`,
    `message: ${canonical.text}`,
    `session_id: ${canonical.session_id}`,
    `timestamp: ${canonical.timestamp}`,
  ].join('\n')
}

export function canonicalBenchmarkEvent(
  event: Record<string, unknown>,
): CanonicalEvent {
  return {
    event_id: requiredString(event.event_id, 'event_id'),
    speaker: requiredString(event.speaker ?? '', 'speaker', { allowEmpty: true }),
    text: requiredString(event.text, 'text'),
    session_id: requiredString(event.session_id ?? '', 'session_id', {
      allowEmpty: true,
    }),
    timestamp: requiredString(event.timestamp ?? '', 'timestamp', {
      allowEmpty: true,
    }),
  }
}

export function nativeRetrievalSelectorOptions(
  selectorParseMode: MemorySelectorParseMode,
): {
  selectorParseMode: MemorySelectorParseMode
  thinking: false
} {
  return { selectorParseMode, thinking: false }
}

export type RetrievalPayload = {
  context: string
  channels: Record<string, Array<Record<string, unknown>>>
  metrics: Record<string, unknown>
}

export class ClaudeCodeMemorySession {
  readonly #runId: string
  readonly #caseId: string
  readonly #memoryDir: string
  readonly #transcriptDir: string
  readonly #runtime: NativeRuntime
  readonly #selectorParseMode: MemorySelectorParseMode
  readonly #attempt: number
  readonly #messages: unknown[] = []
  readonly #events: CanonicalEvent[] = []
  #lastFinishedSessionId = ''
  #closed = false

  private constructor(options: {
    runId: string
    caseId: string
    memoryDir: string
    transcriptDir: string
    runtime: NativeRuntime
    selectorParseMode: MemorySelectorParseMode
    attempt: number
  }) {
    this.#runId = options.runId
    this.#caseId = options.caseId
    this.#memoryDir = options.memoryDir
    this.#transcriptDir = options.transcriptDir
    this.#runtime = options.runtime
    this.#selectorParseMode = options.selectorParseMode
    this.#attempt = options.attempt
  }

  static async create(options: SessionOptions): Promise<ClaudeCodeMemorySession> {
    if (!Number.isInteger(options.attempt) || options.attempt < 1) {
      throw new Error('native benchmark attempt must be a positive integer')
    }
    const stateDir = resolve(options.stateDir)
    const configDir = join(stateDir, 'config')
    const memoryBaseDir = join(stateDir, 'memory-base')
    const projectDir = join(stateDir, 'project')
    const debugPath = join(stateDir, 'debug.log')
    const transcriptDir = join(stateDir, 'transcripts')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(transcriptDir, { recursive: true })
    writeSettings(configDir, options.provider, 'none')
    setupIsolatedEnvironment({
      runDir: stateDir,
      configDir,
      memoryBaseDir,
      debugPath,
      provider: options.provider,
      trace: Boolean(options.traceDir),
    })
    if (options.traceDir) process.env.CLAUDE_CODE_TRACE_DIR = resolve(options.traceDir)
    process.chdir(projectDir)
    const runtime = await loadNativeRuntime({
      model: options.model,
      runAutoDream: 'none',
      runDirectDream: 'each-window',
    })
    return new ClaudeCodeMemorySession({
      runId: basename(stateDir),
      caseId: options.caseId,
      memoryDir: runtime.memoryDir,
      transcriptDir,
      runtime,
      selectorParseMode: options.selectorParseMode,
      attempt: options.attempt,
    })
  }

  async add(event: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.#requireOpen()
    const canonical = canonicalBenchmarkEvent(event)
    const started = performance.now()
    await withExecutionTraceContext(
      {
        runId: this.#runId,
        caseId: this.#caseId,
        windowId: canonical.event_id,
        eventId: canonical.event_id,
        sessionId: canonical.session_id,
        phase: 'insertion',
        attempt: this.#attempt,
        querySource: 'native_memory_benchmark_insertion',
      },
      async () => {
        this.#messages.push(
          this.#runtime.createUserMessage({ content: formatBenchmarkEvent(canonical) }),
        )
        const context = await this.#runtime.buildContext([...this.#messages])
        await this.#runtime.executeExtractMemories(context)
        await this.#runtime.drainPendingExtraction(120_000)
      },
    )
    this.#events.push(canonical)
    const shape = inspectMemory(this.#memoryDir)
    return {
      latency_ms: Math.round((performance.now() - started) * 1000) / 1000,
      transcript_event_count: this.#messages.length,
      memory_file_count: shape.files.size,
      memory_total_bytes: shape.totalBytes,
    }
  }

  async finishSession(sessionId: string): Promise<Record<string, unknown>> {
    this.#requireOpen()
    const latest = this.#events.at(-1)
    if (!latest || latest.session_id !== sessionId) {
      throw new Error('finishSession must follow the final event in that session')
    }
    if (this.#lastFinishedSessionId === sessionId) {
      throw new Error(`native session ${sessionId} was already consolidated`)
    }
    if (!this.#runtime.directDream) {
      throw new Error('native consolidation runtime was not loaded')
    }

    const before = inspectMemory(this.#memoryDir)
    await withExecutionTraceContext(
      {
        runId: this.#runId,
        caseId: this.#caseId,
        sessionId,
        phase: 'consolidation',
        attempt: this.#attempt,
        querySource: 'native_memory_benchmark_consolidation',
      },
      async () => {
        const prompt = this.#runtime.directDream!.buildConsolidationPrompt(
          this.#memoryDir,
          this.#transcriptDir,
          [
            `LongMemEval session ${sessionId} has completed.`,
            'Run the native Claude memory consolidation component once.',
            'This benchmark schedule is explicit and does not claim to be the product autoDream cadence.',
          ].join('\n'),
        )
        const context = await this.#runtime.buildContext([...this.#messages])
        await this.#runtime.directDream!.runForkedAgent({
          promptMessages: [this.#runtime.createUserMessage({ content: prompt })],
          cacheSafeParams: this.#runtime.directDream!.createCacheSafeParams(context),
          canUseTool: this.#runtime.directDream!.createAutoMemCanUseTool(
            this.#memoryDir,
          ),
          querySource: 'native_memory_benchmark_consolidation',
          forkLabel: 'native_memory_benchmark_consolidation',
          skipTranscript: true,
        })
      },
    )
    this.#lastFinishedSessionId = sessionId
    const after = inspectMemory(this.#memoryDir)
    const diff = memoryDiff(before, after)
    return {
      consolidation_mode: 'direct-dream-each-session',
      memory_file_count: after.files.size,
      memory_total_bytes: after.totalBytes,
      added_memory_files: diff.added,
      changed_memory_files: diff.changed,
      removed_memory_files: diff.removed,
    }
  }

  async saveState(directory: string): Promise<Record<string, unknown>> {
    this.#requireOpen()
    const checkpointDir = resolve(directory)
    if (existsSync(checkpointDir)) {
      throw new Error(`native checkpoint directory already exists: ${checkpointDir}`)
    }
    mkdirSync(checkpointDir, { recursive: true })
    const memorySnapshot = join(checkpointDir, 'memory')
    mkdirSync(memorySnapshot, { recursive: true })
    if (existsSync(this.#memoryDir)) {
      for (const entry of readdirSync(this.#memoryDir)) {
        cpSync(join(this.#memoryDir, entry), join(memorySnapshot, entry), {
          recursive: true,
        })
      }
    }
    writeFileSync(
      join(checkpointDir, 'transcript.json'),
      `${JSON.stringify(this.#events, null, 2)}\n`,
    )
    return {
      format: 'native-claude-memory:v1',
      event_count: this.#events.length,
      completed_session_id: this.#lastFinishedSessionId,
    }
  }

  async restoreState(
    directory: string,
    completedEvents: Array<Record<string, unknown>>,
  ): Promise<void> {
    this.#requireOpen()
    const checkpointDir = resolve(directory)
    const savedTranscript = JSON.parse(
      readFileSync(join(checkpointDir, 'transcript.json'), 'utf8'),
    ) as Array<Record<string, unknown>>
    const savedEvents = savedTranscript.map(canonicalBenchmarkEvent)
    const canonicalEvents = completedEvents.map(canonicalBenchmarkEvent)
    if (JSON.stringify(savedEvents) !== JSON.stringify(canonicalEvents)) {
      throw new Error('native checkpoint transcript does not match completed events')
    }
    mkdirSync(this.#memoryDir, { recursive: true })
    if (readdirSync(this.#memoryDir).length > 0) {
      throw new Error('native restore requires an empty canonical memory directory')
    }
    const memorySnapshot = join(checkpointDir, 'memory')
    for (const entry of readdirSync(memorySnapshot)) {
      cpSync(join(memorySnapshot, entry), join(this.#memoryDir, entry), {
        recursive: true,
      })
    }
    this.#events.push(...canonicalEvents)
    this.#lastFinishedSessionId = canonicalEvents.at(-1)?.session_id ?? ''
    this.#messages.push(
      ...canonicalEvents.map(event =>
        this.#runtime.createUserMessage({ content: formatBenchmarkEvent(event) }),
      ),
    )
  }

  async retrieve(request: Record<string, unknown>): Promise<RetrievalPayload> {
    this.#requireOpen()
    const queryText = requiredString(request.query_text, 'query_text')
    const questionId = requiredString(request.question_id, 'question_id')
    const started = performance.now()
    const result = await withExecutionTraceContext(
      {
        runId: this.#runId,
        caseId: this.#caseId,
        questionId,
        phase: 'retrieval',
        attempt: this.#attempt,
        querySource: 'native_memory_benchmark_retrieval',
      },
      async () => {
        const [{ findRelevantMemories }, { readMemoriesForSurfacing }] =
          await Promise.all([
            import('../../src/memdir/findRelevantMemories.ts'),
            import('../../src/utils/attachments.ts'),
          ])
        const controller = new AbortController()
        const selected = await findRelevantMemories(
          queryText,
          this.#memoryDir,
          controller.signal,
          [],
          new Set(),
          nativeRetrievalSelectorOptions(this.#selectorParseMode),
        )
        return await readMemoriesForSurfacing(selected, controller.signal)
      },
    )
    const rows = result.map(memory => ({
      record_id: relative(this.#memoryDir, memory.path),
      path: memory.path,
      header: memory.header,
      content: memory.content,
      mtime_ms: memory.mtimeMs,
    }))
    return {
      context: result
        .map(memory => `${memory.header}\n${memory.content}`)
        .join('\n\n'),
      channels: { memory: rows },
      metrics: {
        question_id: questionId,
        row_count: rows.length,
        parser_mode: this.#selectorParseMode,
        latency_ms: Math.round((performance.now() - started) * 1000) / 1000,
      },
    }
  }

  async close(): Promise<void> {
    this.#closed = true
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error('native Claude memory session is closed')
  }
}
