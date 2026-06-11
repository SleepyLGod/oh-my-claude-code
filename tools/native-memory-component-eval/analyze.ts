import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, join, relative, resolve } from 'path'

type MemoryRow = {
  snapshot: string
  path: string
  name: string
  description: string
  type: string
  body_preview: string
  body_hash: string
}

type IndexRow = {
  snapshot: string
  path: string
  title: string
  target: string
  hook: string
}

type DuplicateRow = {
  kind: string
  key: string
  count: number
  paths: string
}

type AutoDreamFileDiffRow = {
  path: string
  status: string
  pre_hash: string
  post_hash: string
  pre_name: string
  post_name: string
  pre_preview: string
  post_preview: string
}

type FinalMemoryConsistencyRow = {
  kind: string
  path: string
  detail: string
}

type DirectDreamWindowRow = {
  window_id: string
  status: string
  duration_ms: string
  pre_memory_file_count: string
  post_memory_file_count: string
  pre_markdown_file_count: string
  post_markdown_file_count: string
  added_topic_files: string
  changed_topic_files: string
  removed_topic_files: string
  message_count: string
  message_types: string
  input_tokens: string
  output_tokens: string
  cache_read_input_tokens: string
  cache_creation_input_tokens: string
  invalid_reason: string
  error: string
}

type RunSummary = {
  runDir: string
  runId: string
  windowCount: number
  windowsWithExtractorStart: number
  windowsWithExtractorFinish: number
  windowsWithExtractorMemoryWrites: number
  windowsWithExtractorNoMemorySaved: number
  invalidExtractorWindows: number
  windowsWithMemoryFiles: number
  finalMemoryPath: string
  finalTopicPaths: string
  finalTopicNames: string
  finalTopicFiles: number
  finalHasMemoryEntrypoint: boolean
  missingIndexTargets: number
  unlinkedTopicFiles: number
  finalMemoryConsistent: boolean
  duplicateGroups: number
  autoDreamMode: string
  autoDreamStatus: string
  autoDreamFired: boolean
  autoDreamCompleted: boolean
  autoDreamSkipped: boolean
  autoDreamFailed: boolean
  autoDreamAddedTopicFiles: number
  autoDreamChangedTopicFiles: number
  autoDreamRemovedTopicFiles: number
  directDreamRuns: number
  directDreamFailedRuns: number
  invalidDirectDreamRuns: number
  directDreamAddedTopicFiles: number
  directDreamChangedTopicFiles: number
  directDreamRemovedTopicFiles: number
  traceForkedAgentRuns: number
  traceLlmCalls: number
  traceToolCalls: number
  traceLlmErrorCalls: number
  traceLlmInputTokens: number
  traceLlmOutputTokens: number
  traceLlmCacheReadInputTokens: number
  traceLlmCacheCreationInputTokens: number
  traceLlmLatencyMs: number
  traceMissingArtifacts: number
  traceUnclosedLlmCalls: number
  traceWriteEvents: number
  traceAvgWriteMs: number
}

type TraceDerivedSummary = {
  forkedAgentRuns: number
  llmCalls: number
  toolCalls: number
  llmErrorCalls: number
  llmInputTokens: number
  llmOutputTokens: number
  llmCacheReadInputTokens: number
  llmCacheCreationInputTokens: number
  llmLatencyMs: number
  missingArtifacts: number
  unclosedLlmCalls: number
  traceWriteEvents: number
  avgTraceWriteMs: number
}

function usage(): string {
  return [
    'Analyze native Claude Code component memory eval output.',
    '',
    'Usage:',
    '  bun run tools/native-memory-component-eval/analyze.ts <run-dir>',
    '  bun run tools/native-memory-component-eval/analyze.ts --help',
  ].join('\n')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

function writeCsv(path: string, headers: string[], rows: Record<string, unknown>[]): void {
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ]
  writeFileSync(path, `${lines.join('\n')}\n`)
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...listFiles(path))
    } else if (entry.isFile()) {
      result.push(path)
    }
  }
  return result.sort()
}

function simpleHash(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) {
    return { frontmatter: {}, body: text }
  }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) {
    return { frontmatter: {}, body: text }
  }
  const frontmatterText = text.slice(4, end)
  const body = text.slice(end + '\n---\n'.length)
  const frontmatter: Record<string, string> = {}
  for (const line of frontmatterText.split('\n')) {
    const split = line.indexOf(':')
    if (split === -1) continue
    const key = line.slice(0, split).trim()
    const value = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) frontmatter[key] = value
  }
  return { frontmatter, body }
}

function collectSnapshotLabels(runDir: string): string[] {
  const snapshotRoot = join(runDir, 'native', 'memory_snapshots')
  if (!existsSync(snapshotRoot)) return []
  return readdirSync(snapshotRoot)
    .filter(name => statSync(join(snapshotRoot, name)).isDirectory())
    .sort()
}

function collectMemoryRows(runDir: string): MemoryRow[] {
  const rows: MemoryRow[] = []
  const snapshotRoot = join(runDir, 'native', 'memory_snapshots')
  const finalRoot = join(runDir, 'native', 'final_memory')
  const sources = [
    ...collectSnapshotLabels(runDir).map(label => ({ label, dir: join(snapshotRoot, label) })),
    { label: 'final', dir: finalRoot },
  ]

  for (const source of sources) {
    for (const file of listFiles(source.dir).filter(path => path.endsWith('.md'))) {
      if (basename(file) === 'MEMORY.md') continue
      const text = readFileSync(file, 'utf8')
      const { frontmatter, body } = parseFrontmatter(text)
      rows.push({
        snapshot: source.label,
        path: relative(runDir, file),
        name: frontmatter.name ?? basename(file, '.md'),
        description: frontmatter.description ?? '',
        type: frontmatter.type ?? '',
        body_preview: body.replace(/\s+/g, ' ').trim().slice(0, 240),
        body_hash: simpleHash(body),
      })
    }
  }
  return rows
}

function collectTopicRowsFromDir(runDir: string, dir: string): Map<string, MemoryRow> {
  const rows = new Map<string, MemoryRow>()
  for (const file of listFiles(dir).filter(path => path.endsWith('.md'))) {
    if (basename(file) === 'MEMORY.md') continue
    const text = readFileSync(file, 'utf8')
    const { frontmatter, body } = parseFrontmatter(text)
    const path = relative(dir, file)
    rows.set(path, {
      snapshot: basename(dir),
      path,
      name: frontmatter.name ?? basename(file, '.md'),
      description: frontmatter.description ?? '',
      type: frontmatter.type ?? '',
      body_preview: body.replace(/\s+/g, ' ').trim().slice(0, 240),
      body_hash: simpleHash(body),
    })
  }
  return rows
}

function collectAutoDreamFileDiffs(runDir: string): AutoDreamFileDiffRow[] {
  const preDir = join(runDir, 'native', 'pre_autodream_memory')
  const postDir = join(runDir, 'native', 'post_autodream_memory')
  if (!existsSync(preDir) && !existsSync(postDir)) return []

  const preRows = collectTopicRowsFromDir(runDir, preDir)
  const postRows = collectTopicRowsFromDir(runDir, postDir)
  const paths = [...new Set([...preRows.keys(), ...postRows.keys()])].sort()
  const rows: AutoDreamFileDiffRow[] = []

  for (const path of paths) {
    const pre = preRows.get(path)
    const post = postRows.get(path)
    const status =
      pre && post
        ? pre.body_hash === post.body_hash && pre.name === post.name
          ? 'unchanged'
          : 'changed'
        : pre
          ? 'removed'
          : 'added'
    rows.push({
      path,
      status,
      pre_hash: pre?.body_hash ?? '',
      post_hash: post?.body_hash ?? '',
      pre_name: pre?.name ?? '',
      post_name: post?.name ?? '',
      pre_preview: pre?.body_preview ?? '',
      post_preview: post?.body_preview ?? '',
    })
  }
  return rows
}

function collectIndexRows(runDir: string): IndexRow[] {
  const rows: IndexRow[] = []
  const snapshotRoot = join(runDir, 'native', 'memory_snapshots')
  const finalRoot = join(runDir, 'native', 'final_memory')
  const sources = [
    ...collectSnapshotLabels(runDir).map(label => ({ label, dir: join(snapshotRoot, label) })),
    { label: 'final', dir: finalRoot },
  ]

  for (const source of sources) {
    for (const file of listFiles(source.dir).filter(path => basename(path) === 'MEMORY.md')) {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—-]\s*)?(.*)$/)
        if (!match) continue
        rows.push({
          snapshot: source.label,
          path: relative(runDir, file),
          title: match[1] ?? '',
          target: match[2] ?? '',
          hook: match[3] ?? '',
        })
      }
    }
  }
  return rows
}

function collectFinalMemoryConsistency(
  runDir: string,
  memoryRows: MemoryRow[],
  indexRows: IndexRow[],
): FinalMemoryConsistencyRow[] {
  const rows: FinalMemoryConsistencyRow[] = []
  const finalMemoryPath = join(runDir, 'native', 'final_memory', 'memory')
  const finalRows = memoryRows.filter(row => row.snapshot === 'final')
  const finalIndexRows = indexRows.filter(row => row.snapshot === 'final')

  const topicPaths = new Set(
    finalRows.map(row => normalizeMemoryRelativePath(relative(finalMemoryPath, resolve(runDir, row.path)))),
  )
  const linkedTargets = new Set<string>()

  for (const row of finalIndexRows) {
    const target = normalizeMemoryRelativePath(row.target)
    if (!target) continue
    linkedTargets.add(target)
    if (!existsSync(resolve(finalMemoryPath, target))) {
      rows.push({
        kind: 'missing_index_target',
        path: target,
        detail: `Linked from ${row.path} but no topic file exists at this target.`,
      })
    }
  }

  for (const path of topicPaths) {
    if (linkedTargets.has(path)) continue
    rows.push({
      kind: 'unlinked_topic_file',
      path,
      detail: 'Topic markdown file exists in final memory but is not linked by MEMORY.md.',
    })
  }

  return rows
}

function normalizeMemoryRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function duplicateRows(rows: MemoryRow[], indexRows: IndexRow[]): DuplicateRow[] {
  const result: DuplicateRow[] = []
  const finalRows = rows.filter(row => row.snapshot === 'final')
  const finalIndexRows = indexRows.filter(row => row.snapshot === 'final')
  addDuplicateGroups(result, 'topic_name', finalRows, row => row.name, row => row.path)
  addDuplicateGroups(result, 'topic_body_hash', finalRows, row => row.body_hash, row => row.path)
  addDuplicateGroups(result, 'index_title', finalIndexRows, row => row.title, row => row.path)
  return result
}

function addDuplicateGroups<T>(
  out: DuplicateRow[],
  kind: string,
  rows: T[],
  keyFn: (row: T) => string,
  pathFn: (row: T) => string,
): void {
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const key = keyFn(row).trim()
    if (!key) continue
    const paths = groups.get(key) ?? []
    paths.push(pathFn(row))
    groups.set(key, paths)
  }
  for (const [key, paths] of groups) {
    if (paths.length <= 1) continue
    out.push({ kind, key, count: paths.length, paths: paths.join('|') })
  }
}

function readWindows(runDir: string): Record<string, string>[] {
  const csvPath = join(runDir, 'metrics', 'windows.csv')
  if (!existsSync(csvPath)) return []
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
  if (lines.length <= 1) return []
  const headers = splitCsvLine(lines[0]!)
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function readAutoDreamMetric(runDir: string): Record<string, string> {
  const csvPath = join(runDir, 'metrics', 'autodream.csv')
  if (!existsSync(csvPath)) return {}
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
  if (lines.length <= 1) return {}
  const headers = splitCsvLine(lines[0]!)
  const values = splitCsvLine(lines[1]!)
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
}

function readDirectDreamRows(runDir: string): DirectDreamWindowRow[] {
  const csvPath = join(runDir, 'metrics', 'direct_dream_windows.csv')
  if (!existsSync(csvPath)) return []
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
  if (lines.length <= 1) return []
  const headers = splitCsvLine(lines[0]!)
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as DirectDreamWindowRow
  })
}

function readTraceEvents(runDir: string): Record<string, unknown>[] {
  const path = join(runDir, 'trace', 'events.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function collectTraceDerived(runDir: string): TraceDerivedSummary {
  const events = readTraceEvents(runDir)
  const traceDir = join(runDir, 'trace')
  const derivedDir = join(traceDir, 'derived')
  if (events.length === 0) {
    return {
      forkedAgentRuns: 0,
      llmCalls: 0,
      toolCalls: 0,
      llmErrorCalls: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCacheReadInputTokens: 0,
      llmCacheCreationInputTokens: 0,
      llmLatencyMs: 0,
      missingArtifacts: 0,
      unclosedLlmCalls: 0,
      traceWriteEvents: 0,
      avgTraceWriteMs: 0,
    }
  }
  ensureDir(derivedDir)

  const forkedAgentRows = events
    .filter(event => event.event_type === 'forked_agent_finish')
    .map(event => ({
      trace_id: event.trace_id ?? '',
      run_id: event.runId ?? '',
      window_id: event.windowId ?? '',
      phase: event.phase ?? '',
      fork_label: event.fork_label ?? '',
      query_source: event.query_source ?? '',
      message_count: event.message_count ?? '',
      message_types: event.message_types ?? '',
      input_tokens: traceUsageValue(event, 'input_tokens'),
      output_tokens: traceUsageValue(event, 'output_tokens'),
      cache_read_input_tokens: traceUsageValue(event, 'cache_read_input_tokens'),
      cache_creation_input_tokens: traceUsageValue(event, 'cache_creation_input_tokens'),
      duration_ms: event.duration_ms ?? '',
      output_artifact_path: event.output_artifact_path ?? '',
    }))

  const llmStarts = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    if (event.event_type === 'llm_call_start' && typeof event.trace_id === 'string') {
      llmStarts.set(event.trace_id, event)
    }
  }
  const llmRows = events
    .filter(event => event.event_type === 'llm_call_finish' || event.event_type === 'llm_call_error')
    .map(event => {
      const traceId = String(event.trace_id ?? '')
      const start = llmStarts.get(traceId) ?? {}
      return {
        trace_id: traceId,
        run_id: event.runId ?? start.runId ?? '',
        window_id: event.windowId ?? start.windowId ?? '',
        phase: event.phase ?? start.phase ?? '',
        fork_label: event.forkLabel ?? start.forkLabel ?? '',
        query_source: event.querySource ?? start.querySource ?? '',
        model: event.model ?? start.model ?? '',
        request_id: event.request_id ?? '',
        status: event.event_type === 'llm_call_finish' ? 'ok' : 'error',
        error_name: event.error_name ?? '',
        error_message: event.error_message ?? '',
        input_tokens: traceUsageValue(event, 'input_tokens'),
        output_tokens: traceUsageValue(event, 'output_tokens'),
        cache_read_input_tokens: traceUsageValue(event, 'cache_read_input_tokens'),
        cache_creation_input_tokens: traceUsageValue(event, 'cache_creation_input_tokens'),
        duration_ms: event.latency_ms ?? event.duration_ms ?? '',
        request_artifact_path: start.request_artifact_path ?? '',
        response_artifact_path: event.response_artifact_path ?? '',
        error_artifact_path: event.error_artifact_path ?? '',
      }
    })

  const toolRows = collectToolCallRows(runDir, forkedAgentRows)
  const llmFinishedTraceIds = new Set(
    events
      .filter(event => event.event_type === 'llm_call_finish' || event.event_type === 'llm_call_error')
      .map(event => String(event.trace_id ?? ''))
      .filter(Boolean),
  )
  const unclosedLlmCalls = [...llmStarts.keys()].filter(traceId => !llmFinishedTraceIds.has(traceId)).length
  const traceWriteEvents = events.filter(event => event.event_type === 'trace_write')
  const traceWriteDurations = traceWriteEvents.map(event => numericValue(event.trace_write_ms))
  const missingArtifacts = countMissingLlmArtifacts(runDir, llmRows)

  writeCsv(
    join(derivedDir, 'forked_agents.csv'),
    [
      'trace_id',
      'run_id',
      'window_id',
      'phase',
      'fork_label',
      'query_source',
      'message_count',
      'message_types',
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
      'duration_ms',
      'output_artifact_path',
    ],
    forkedAgentRows,
  )
  writeCsv(
    join(derivedDir, 'llm_requests.csv'),
    [
      'trace_id',
      'run_id',
      'window_id',
      'phase',
      'fork_label',
      'query_source',
      'model',
      'request_id',
      'status',
      'error_name',
      'error_message',
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
      'duration_ms',
      'request_artifact_path',
      'response_artifact_path',
      'error_artifact_path',
    ],
    llmRows,
  )
  writeCsv(
    join(derivedDir, 'tool_calls.csv'),
    [
      'fork_trace_id',
      'run_id',
      'window_id',
      'phase',
      'fork_label',
      'message_index',
      'tool_use_id',
      'tool_name',
      'file_path',
      'input_preview',
      'result_preview',
      'is_error',
    ],
    toolRows,
  )
  return {
    forkedAgentRuns: forkedAgentRows.length,
    llmCalls: llmRows.length,
    toolCalls: toolRows.length,
    llmErrorCalls: llmRows.filter(row => row.status === 'error').length,
    llmInputTokens: sumRows(llmRows, 'input_tokens'),
    llmOutputTokens: sumRows(llmRows, 'output_tokens'),
    llmCacheReadInputTokens: sumRows(llmRows, 'cache_read_input_tokens'),
    llmCacheCreationInputTokens: sumRows(llmRows, 'cache_creation_input_tokens'),
    llmLatencyMs: sumRows(llmRows, 'duration_ms'),
    missingArtifacts,
    unclosedLlmCalls,
    traceWriteEvents: traceWriteEvents.length,
    avgTraceWriteMs: traceWriteDurations.length === 0 ? 0 : sumNumbers(traceWriteDurations) / traceWriteDurations.length,
  }
}

function countMissingLlmArtifacts(runDir: string, llmRows: Record<string, unknown>[]): number {
  let missing = 0
  for (const row of llmRows) {
    const status = String(row.status ?? '')
    const requestPath = String(row.request_artifact_path ?? '')
    const responsePath = String(row.response_artifact_path ?? '')
    const errorPath = String(row.error_artifact_path ?? '')
    if (!artifactExists(runDir, requestPath)) missing += 1
    if (status === 'ok' && !artifactExists(runDir, responsePath)) missing += 1
    if (status === 'error' && !artifactExists(runDir, errorPath)) missing += 1
  }
  return missing
}

function artifactExists(runDir: string, artifactPath: string): boolean {
  return artifactPath !== '' && existsSync(join(runDir, 'trace', artifactPath))
}

function sumRows(rows: Record<string, unknown>[], key: string): number {
  return sumNumbers(rows.map(row => numericValue(row[key])))
}

function sumNumbers(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function traceUsageValue(
  event: Record<string, unknown>,
  key: string,
): unknown {
  if (event[key] !== undefined) return event[key]
  const usage = event.usage
  if (usage && typeof usage === 'object' && key in usage) {
    return (usage as Record<string, unknown>)[key]
  }
  return ''
}

function collectToolCallRows(
  runDir: string,
  forkedAgentRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const fork of forkedAgentRows) {
    const artifactPath = String(fork.output_artifact_path ?? '')
    if (!artifactPath) continue
    const fullPath = join(runDir, 'trace', artifactPath)
    if (!existsSync(fullPath)) continue
    const artifact = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>
    const messages = Array.isArray(artifact.messages) ? artifact.messages : []
    const results = collectToolResults(messages)
    messages.forEach((message, messageIndex) => {
      for (const block of messageContentBlocks(message)) {
        if (!block || typeof block !== 'object') continue
        const object = block as Record<string, unknown>
        if (object.type !== 'tool_use') continue
        const input = object.input && typeof object.input === 'object' ? (object.input as Record<string, unknown>) : {}
        const id = String(object.id ?? '')
        const result = results.get(id)
        rows.push({
          fork_trace_id: fork.trace_id ?? '',
          run_id: fork.run_id ?? '',
          window_id: fork.window_id ?? '',
          phase: fork.phase ?? '',
          fork_label: fork.fork_label ?? '',
          message_index: messageIndex,
          tool_use_id: id,
          tool_name: object.name ?? '',
          file_path: input.file_path ?? '',
          input_preview: JSON.stringify(input).slice(0, 500),
          result_preview: result?.preview ?? '',
          is_error: result?.isError ?? '',
        })
      }
    })
  }
  return rows
}

function collectToolResults(messages: unknown[]): Map<string, { preview: string; isError: boolean }> {
  const results = new Map<string, { preview: string; isError: boolean }>()
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (!block || typeof block !== 'object') continue
      const object = block as Record<string, unknown>
      if (object.type !== 'tool_result') continue
      const id = String(object.tool_use_id ?? '')
      if (!id) continue
      results.set(id, {
        preview: JSON.stringify(object.content ?? '').slice(0, 500),
        isError: object.is_error === true,
      })
    }
  }
  return results
}

function messageContentBlocks(message: unknown): unknown[] {
  if (!message || typeof message !== 'object') return []
  const object = message as Record<string, unknown>
  const inner = object.message && typeof object.message === 'object' ? (object.message as Record<string, unknown>) : object
  return Array.isArray(inner.content) ? inner.content : []
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && inQuotes && line[i + 1] === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

function writeReport(params: {
  runDir: string
  memoryRows: MemoryRow[]
  indexRows: IndexRow[]
  duplicates: DuplicateRow[]
  autoDreamFileDiffs: AutoDreamFileDiffRow[]
  finalMemoryConsistencyRows: FinalMemoryConsistencyRow[]
  traceSummary: TraceDerivedSummary
}): RunSummary {
  const { runDir, memoryRows, indexRows, duplicates, autoDreamFileDiffs, finalMemoryConsistencyRows, traceSummary } = params
  const windows = readWindows(runDir)
  const autoDream = readAutoDreamMetric(runDir)
  const directDreamRows = readDirectDreamRows(runDir)
  const invalidExtractorWindows = windows.filter(
    row => row.status === 'invalid_llm_run' || row.extractor_invalid_reason,
  )
  const validExtractorWindows = windows.filter(
    row => row.status !== 'invalid_llm_run' && !row.extractor_invalid_reason,
  )
  const invalidDirectDreamRows = directDreamRows.filter(
    row => row.status === 'invalid_llm_run' || row.invalid_reason,
  )
  const finalRows = memoryRows.filter(row => row.snapshot === 'final')
  const finalIndexRows = indexRows.filter(row => row.snapshot === 'final')
  const finalMemoryPath = join(runDir, 'native', 'final_memory', 'memory')
  const missingIndexTargets = finalMemoryConsistencyRows.filter(row => row.kind === 'missing_index_target').length
  const unlinkedTopicFiles = finalMemoryConsistencyRows.filter(row => row.kind === 'unlinked_topic_file').length
  const summary: RunSummary = {
    runDir,
    runId: basename(runDir),
    windowCount: windows.length,
    windowsWithExtractorStart: windows.filter(row => row.extractor_started === 'true').length,
    windowsWithExtractorFinish: windows.filter(row => row.extractor_finished === 'true').length,
    windowsWithExtractorMemoryWrites: validExtractorWindows.filter(row => row.extractor_memories_saved === 'true').length,
    windowsWithExtractorNoMemorySaved: validExtractorWindows.filter(row => row.extractor_no_memories_saved === 'true').length,
    invalidExtractorWindows: invalidExtractorWindows.length,
    windowsWithMemoryFiles: windows.filter(row => Number(row.memory_file_count || 0) > 0).length,
    finalMemoryPath,
    finalTopicPaths: finalRows.map(row => row.path).join('|'),
    finalTopicNames: finalRows.map(row => row.name).join('|'),
    finalTopicFiles: finalRows.length,
    finalHasMemoryEntrypoint: finalIndexRows.length > 0 || listFiles(join(runDir, 'native', 'final_memory')).some(path => basename(path) === 'MEMORY.md'),
    missingIndexTargets,
    unlinkedTopicFiles,
    finalMemoryConsistent: missingIndexTargets === 0 && unlinkedTopicFiles === 0,
    duplicateGroups: duplicates.length,
    autoDreamMode: autoDream.mode ?? 'unknown',
    autoDreamStatus: autoDream.status ?? 'unknown',
    autoDreamFired: autoDream.autodream_fired === 'true',
    autoDreamCompleted: autoDream.autodream_completed === 'true',
    autoDreamSkipped: autoDream.autodream_skipped === 'true',
    autoDreamFailed: autoDream.autodream_failed === 'true',
    autoDreamAddedTopicFiles: autoDreamFileDiffs.filter(row => row.status === 'added').length,
    autoDreamChangedTopicFiles: autoDreamFileDiffs.filter(row => row.status === 'changed').length,
    autoDreamRemovedTopicFiles: autoDreamFileDiffs.filter(row => row.status === 'removed').length,
    directDreamRuns: directDreamRows.length,
    directDreamFailedRuns: directDreamRows.filter(row => row.status === 'error').length,
    invalidDirectDreamRuns: invalidDirectDreamRows.length,
    directDreamAddedTopicFiles: directDreamRows.reduce((sum, row) => sum + Number(row.added_topic_files || 0), 0),
    directDreamChangedTopicFiles: directDreamRows.reduce((sum, row) => sum + Number(row.changed_topic_files || 0), 0),
    directDreamRemovedTopicFiles: directDreamRows.reduce((sum, row) => sum + Number(row.removed_topic_files || 0), 0),
    traceForkedAgentRuns: traceSummary.forkedAgentRuns,
    traceLlmCalls: traceSummary.llmCalls,
    traceToolCalls: traceSummary.toolCalls,
    traceLlmErrorCalls: traceSummary.llmErrorCalls,
    traceLlmInputTokens: traceSummary.llmInputTokens,
    traceLlmOutputTokens: traceSummary.llmOutputTokens,
    traceLlmCacheReadInputTokens: traceSummary.llmCacheReadInputTokens,
    traceLlmCacheCreationInputTokens: traceSummary.llmCacheCreationInputTokens,
    traceLlmLatencyMs: traceSummary.llmLatencyMs,
    traceMissingArtifacts: traceSummary.missingArtifacts,
    traceUnclosedLlmCalls: traceSummary.unclosedLlmCalls,
    traceWriteEvents: traceSummary.traceWriteEvents,
    traceAvgWriteMs: traceSummary.avgTraceWriteMs,
  }
  const autoDreamChangedPaths = autoDreamFileDiffs
    .filter(row => row.status !== 'unchanged')
    .map(row => `${row.status}:${row.path}`)
    .join('|')

  const report = [
    '# Native Component Memory Eval Report',
    '',
    '## Run Status',
    '',
    `- run_dir: ${runDir}`,
    `- windows: ${summary.windowCount}`,
    `- extractor_started_windows: ${summary.windowsWithExtractorStart}`,
    `- extractor_finished_windows: ${summary.windowsWithExtractorFinish}`,
    `- extractor_memory_write_windows: ${summary.windowsWithExtractorMemoryWrites}`,
    `- extractor_no_memory_saved_windows: ${summary.windowsWithExtractorNoMemorySaved}`,
    `- invalid_extractor_windows: ${summary.invalidExtractorWindows}`,
    `- windows_with_topic_files: ${summary.windowsWithMemoryFiles}`,
    ...(summary.invalidExtractorWindows > 0 || summary.invalidDirectDreamRuns > 0
      ? [
          '',
          `- invalid_llm_run_warning: this run cannot be used as native memory behavior evidence until invalid LLM runs are resolved.`,
        ]
      : []),
    '',
    '## Final Memory',
    '',
    `- final_memory_path: ${summary.finalMemoryPath}`,
    `- topic_markdown_files: ${summary.finalTopicFiles}`,
    `- final_topic_paths: ${summary.finalTopicPaths || '(none)'}`,
    `- final_topic_names: ${summary.finalTopicNames || '(none)'}`,
    `- memory_entrypoint_exists: ${summary.finalHasMemoryEntrypoint}`,
    `- final_memory_consistent: ${summary.finalMemoryConsistent}`,
    `- missing_index_targets: ${summary.missingIndexTargets}`,
    `- unlinked_topic_files: ${summary.unlinkedTopicFiles}`,
    ...(summary.finalMemoryConsistent
      ? []
      : ['- consistency_path: metrics/final_memory_consistency.csv']),
    `- duplicate_groups: ${summary.duplicateGroups}`,
    '',
    '## autoDream',
    '',
    `- mode: ${summary.autoDreamMode}`,
    `- status: ${summary.autoDreamStatus}`,
    `- fired: ${summary.autoDreamFired}`,
    `- completed: ${summary.autoDreamCompleted}`,
    `- skipped: ${summary.autoDreamSkipped}`,
    `- failed: ${summary.autoDreamFailed}`,
    `- seeded_sessions: ${autoDream.seeded_session_count ?? ''}`,
    `- pre_topic_files: ${autoDream.pre_memory_file_count ?? ''}`,
    `- post_topic_files: ${autoDream.post_memory_file_count ?? ''}`,
    `- added_topic_files: ${summary.autoDreamAddedTopicFiles}`,
    `- changed_topic_files: ${summary.autoDreamChangedTopicFiles}`,
    `- removed_topic_files: ${summary.autoDreamRemovedTopicFiles}`,
    `- changed_paths: ${autoDreamChangedPaths || '(none)'}`,
    `- append_system_messages: ${autoDream.append_system_messages ?? ''}`,
    `- error: ${autoDream.error || '(none)'}`,
    '',
    '## Direct Dream',
    '',
    '- mode: component each-window' + (summary.directDreamRuns > 0 ? '' : ' (not run)'),
    `- runs: ${summary.directDreamRuns}`,
    `- failed_runs: ${summary.directDreamFailedRuns}`,
    `- invalid_runs: ${summary.invalidDirectDreamRuns}`,
    `- added_topic_files_total: ${summary.directDreamAddedTopicFiles}`,
    `- changed_topic_files_total: ${summary.directDreamChangedTopicFiles}`,
    `- removed_topic_files_total: ${summary.directDreamRemovedTopicFiles}`,
    '- note: direct dream is component diagnostic evidence, not native autoDream scheduler evidence.',
    '',
    '## Trace',
    '',
    `- forked_agent_runs: ${summary.traceForkedAgentRuns}`,
    `- llm_calls: ${summary.traceLlmCalls}`,
    `- llm_error_calls: ${summary.traceLlmErrorCalls}`,
    `- input_tokens: ${summary.traceLlmInputTokens}`,
    `- output_tokens: ${summary.traceLlmOutputTokens}`,
    `- cache_read_input_tokens: ${summary.traceLlmCacheReadInputTokens}`,
    `- cache_creation_input_tokens: ${summary.traceLlmCacheCreationInputTokens}`,
    `- llm_latency_ms: ${Math.round(summary.traceLlmLatencyMs)}`,
    `- missing_artifacts: ${summary.traceMissingArtifacts}`,
    `- unclosed_llm_calls: ${summary.traceUnclosedLlmCalls}`,
    `- trace_write_events: ${summary.traceWriteEvents}`,
    `- avg_trace_write_ms: ${summary.traceAvgWriteMs.toFixed(3)}`,
    `- tool_calls: ${summary.traceToolCalls}`,
    `- derived_path: ${summary.traceForkedAgentRuns > 0 || summary.traceLlmCalls > 0 ? 'trace/derived' : '(not enabled)'}`,
    '',
    '## Metric Notes',
    '',
    '- windows_with_topic_files means the window snapshot contains topic files; it is not a per-window write count.',
    '- extractor_memory_write_windows and extractor_no_memory_saved_windows count only valid LLM runs.',
    '- invalid_llm_run means the forked agent returned a single assistant message with zero usage; this usually indicates API/provider failure rather than memory behavior.',
    '',
    '## Interpretation',
    '',
    '- If extractor_started_windows is 0, this run did not prove the native extractor path.',
    '- If extractor started and finished but produced no files, that is a valid extractor observation, not a harness failure.',
    '- This is extract-only component evidence, not CLI main-agent behavior evidence.',
  ].join('\n')
  const reportDir = join(runDir, 'report')
  ensureDir(reportDir)
  writeFileSync(join(reportDir, 'report.md'), `${report}\n`)
  return summary
}

export function analyzeRun(runDirInput: string): RunSummary {
  const runDir = resolve(runDirInput)
  const metricsDir = join(runDir, 'metrics')
  ensureDir(metricsDir)
  const memoryRows = collectMemoryRows(runDir)
  const indexRows = collectIndexRows(runDir)
  const duplicates = duplicateRows(memoryRows, indexRows)
  const autoDreamFileDiffs = collectAutoDreamFileDiffs(runDir)
  const finalMemoryConsistencyRows = collectFinalMemoryConsistency(runDir, memoryRows, indexRows)
  const traceSummary = collectTraceDerived(runDir)
  writeCsv(join(metricsDir, 'memory_files.csv'), ['snapshot', 'path', 'name', 'description', 'type', 'body_preview', 'body_hash'], memoryRows)
  writeCsv(join(metricsDir, 'index_entries.csv'), ['snapshot', 'path', 'title', 'target', 'hook'], indexRows)
  writeCsv(join(metricsDir, 'duplicates.csv'), ['kind', 'key', 'count', 'paths'], duplicates)
  writeCsv(join(metricsDir, 'autodream_file_diffs.csv'), ['path', 'status', 'pre_hash', 'post_hash', 'pre_name', 'post_name', 'pre_preview', 'post_preview'], autoDreamFileDiffs)
  writeCsv(join(metricsDir, 'final_memory_consistency.csv'), ['kind', 'path', 'detail'], finalMemoryConsistencyRows)
  const summary = writeReport({ runDir, memoryRows, indexRows, duplicates, autoDreamFileDiffs, finalMemoryConsistencyRows, traceSummary })
  writeCsv(join(metricsDir, 'summary.csv'), Object.keys(summary), [summary as unknown as Record<string, unknown>])
  return summary
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage())
    return
  }
  const runDir = args[0]
  if (!runDir) {
    throw new Error('Missing run dir. Use --help for usage.')
  }
  const summary = analyzeRun(runDir)
  console.log(`wrote report: ${join(resolve(runDir), 'report', 'report.md')}`)
  console.log(`final topic files: ${summary.finalTopicFiles}`)
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
