import { createHash, randomUUID } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { withExecutionTraceContext } from '../../src/utils/executionTrace.ts'

export type AutoDreamMode = 'none' | 'natural' | 'seeded'
export type DirectDreamMode = 'none' | 'each-window'

export type NativeRuntimeOptions = {
  model: string
  runAutoDream: AutoDreamMode
  runDirectDream: DirectDreamMode
}

type CliOptions = {
  rowLimit: number
  startRow: number
  messagesPerWindow: number
  outputDir?: string
  provider: string
  model: string
  locomoPath?: string
  eventsJsonl?: string
  keepGoing: boolean
  resume: boolean
  runAutoDream: AutoDreamMode
  runDirectDream: DirectDreamMode
  trace: boolean
}

type LocomoRow = {
  row_index: number
  sample_index: number
  session_id: string
  turn_id: string
  speaker: string
  message: string
  timestamp: string
}

type WindowInput = {
  window_id: string
  source_rows: number[]
  model_visible_message_count: number
  content: string
}

type WindowMetric = {
  window_id: string
  source_rows: string
  model_visible_message_count: number
  status: string
  duration_ms: number
  extractor_started: boolean
  extractor_finished: boolean
  extractor_no_memories_saved: boolean
  extractor_memories_saved: boolean
  memory_file_count: number
  markdown_file_count: number
  has_memory_entrypoint: boolean
  append_system_messages: number
  extractor_message_count: number
  extractor_message_types: string
  extractor_input_tokens: number
  extractor_output_tokens: number
  extractor_cache_read_input_tokens: number
  extractor_cache_creation_input_tokens: number
  extractor_invalid_reason: string
  error: string
}

type MemorySnapshotStats = {
  copied: boolean
  memoryDirs: string[]
  memoryFileCount: number
  markdownFileCount: number
  hasMemoryEntrypoint: boolean
}

type AutoDreamMetric = {
  mode: AutoDreamMode
  status: string
  duration_ms: number
  seeded_session_count: number
  pre_memory_file_count: number
  post_memory_file_count: number
  pre_markdown_file_count: number
  post_markdown_file_count: number
  append_system_messages: number
  autodream_fired: boolean
  autodream_completed: boolean
  autodream_skipped: boolean
  autodream_failed: boolean
  error: string
}

type DirectDreamMetric = {
  window_id: string
  status: string
  duration_ms: number
  pre_memory_file_count: number
  post_memory_file_count: number
  pre_markdown_file_count: number
  post_markdown_file_count: number
  added_topic_files: number
  changed_topic_files: number
  removed_topic_files: number
  message_count: number
  message_types: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  invalid_reason: string
  error: string
}

type ForkedAgentFinish = {
  messageCount: number
  messageTypes: string[]
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  invalidReason: string
}

type ComponentCheckpointManifest = {
  schema_version: number
  provider: string
  model: string
  messages_per_window: number
  run_autodream: AutoDreamMode
  run_direct_dream: DirectDreamMode
  keep_going: boolean
  trace: boolean
  windows_hash: string
  completed_windows: number
  last_window_id: string
}

type ComponentCheckpoint = {
  manifest: ComponentCheckpointManifest
  metrics: WindowMetric[]
  directDreamMetrics: DirectDreamMetric[]
}

type LocomoTurnGroup = {
  session_key: string
  timestamp: string
  turns: unknown[]
}

const DEFAULT_PROVIDER = 'deepseek-anthropic'
const DEFAULT_MODEL = 'deepseek-v4-flash[1m]'
const DEFAULT_START_ROW = 26
const DEFAULT_ROW_LIMIT = 12
const DEFAULT_MESSAGES_PER_WINDOW = 1
const DEFAULT_AUTODREAM_MODE = 'none'
const DEFAULT_DIRECT_DREAM_MODE = 'none'
const SEEDED_AUTODREAM_SESSION_COUNT = 6
const SEEDED_AUTODREAM_LOCK_AGE_HOURS = 48
const CHECKPOINT_SCHEMA_VERSION = 1
const TMP_PROJECT_ROOT = join(tmpdir(), 'claude-code-native-memory-component-projects')
const LOCOMO_URL =
  'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json'
const EXTRACT_FEATURE_OVERRIDES = {
  tengu_passport_quail: true,
  tengu_slate_thimble: true,
  tengu_bramble_lintel: 1,
  tengu_moth_copse: false,
} as const

function usage(): string {
  return [
    'Native Claude Code extract-only component memory eval.',
    '',
    'Usage:',
    '  bun run tools/native-memory-component-eval/run.ts [options]',
    '',
    'Options:',
    `  --row-limit <n>              LOCOMO rows to use. Default: ${DEFAULT_ROW_LIMIT}`,
    `  --start-row <n>              1-based LOCOMO row start. Default: ${DEFAULT_START_ROW}`,
    `  --messages-per-window <n>    LOCOMO-derived model-visible messages per extractor window. Default: ${DEFAULT_MESSAGES_PER_WINDOW}`,
    '  --output-dir <path>          Run output dir. Default: .memory-test/native-cc-component/<timestamp>',
    `  --provider <name>            LLM profile. Default: ${DEFAULT_PROVIDER}`,
    `  --model <id>                 Model id. Default: ${DEFAULT_MODEL}`,
    '  --locomo-path <path>         Use local locomo10.json instead of downloading/caching.',
    '  --events-jsonl <path>        Use pre-normalized BenchmarkEvent JSONL instead of LOCOMO slicing.',
    `  --run-autodream <mode>        Run autoDream after extraction: none|natural|seeded. Default: ${DEFAULT_AUTODREAM_MODE}`,
    `  --run-direct-dream <mode>     Run direct dream component after each window: none|each-window. Default: ${DEFAULT_DIRECT_DREAM_MODE}`,
    '  --trace                      Write detailed forked-agent and LLM trace artifacts under <output-dir>/trace.',
    '  --keep-going                 Continue after a failed window and mark failed rows.',
    '  --resume                     Resume from <output-dir>/checkpoint. Requires --output-dir.',
    '  --help                       Show this help.',
    '',
    'Environment:',
    '  DEEPSEEK_API_KEY must be set for the default provider.',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    rowLimit: DEFAULT_ROW_LIMIT,
    startRow: DEFAULT_START_ROW,
    messagesPerWindow: DEFAULT_MESSAGES_PER_WINDOW,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    keepGoing: false,
    resume: false,
    runAutoDream: DEFAULT_AUTODREAM_MODE,
    runDirectDream: DEFAULT_DIRECT_DREAM_MODE,
    trace: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--keep-going') {
      options.keepGoing = true
      continue
    }
    if (arg === '--resume') {
      options.resume = true
      continue
    }
    if (arg === '--trace') {
      options.trace = true
      continue
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`)
    }
    if (arg === '--row-limit') {
      options.rowLimit = parsePositiveInt(next, arg)
      i += 1
      continue
    }
    if (arg === '--start-row') {
      options.startRow = parsePositiveInt(next, arg)
      i += 1
      continue
    }
    if (arg === '--messages-per-window') {
      options.messagesPerWindow = parsePositiveInt(next, arg)
      i += 1
      continue
    }
    if (arg === '--output-dir') {
      options.outputDir = next
      i += 1
      continue
    }
    if (arg === '--provider') {
      options.provider = next
      i += 1
      continue
    }
    if (arg === '--model') {
      options.model = next
      i += 1
      continue
    }
    if (arg === '--locomo-path') {
      options.locomoPath = next
      i += 1
      continue
    }
    if (arg === '--events-jsonl') {
      options.eventsJsonl = next
      i += 1
      continue
    }
    if (arg === '--run-autodream') {
      if (next !== 'none' && next !== 'natural' && next !== 'seeded') {
        throw new Error('--run-autodream must be one of: none, natural, seeded')
      }
      options.runAutoDream = next
      i += 1
      continue
    }
    if (arg === '--run-direct-dream') {
      if (next !== 'none' && next !== 'each-window') {
        throw new Error('--run-direct-dream must be one of: none, each-window')
      }
      options.runDirectDream = next
      i += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (options.runDirectDream !== 'none' && options.runAutoDream !== 'none') {
    throw new Error('--run-direct-dream cannot be combined with --run-autodream natural|seeded')
  }
  if (options.eventsJsonl && options.locomoPath) {
    throw new Error('--events-jsonl and --locomo-path are mutually exclusive')
  }
  if (options.eventsJsonl) options.eventsJsonl = resolve(options.eventsJsonl)
  if (options.locomoPath) options.locomoPath = resolve(options.locomoPath)
  if (options.resume && !options.outputDir) {
    throw new Error('--resume requires --output-dir')
  }

  return options
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function validateProviderEnvironment(options: CliOptions): void {
  if (!options.provider.startsWith('deepseek')) return
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required for DeepSeek provider profiles')
  }
  if (apiKey === '...') {
    throw new Error('DEEPSEEK_API_KEY appears to be the placeholder "..."')
  }
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
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

async function ensureLocomoDataset(options: CliOptions, cacheDir: string): Promise<string> {
  if (options.locomoPath) {
    return resolve(options.locomoPath)
  }
  ensureDir(cacheDir)
  const cachePath = join(cacheDir, 'locomo10.json')
  if (existsSync(cachePath)) {
    return cachePath
  }
  const response = await fetch(LOCOMO_URL)
  if (!response.ok) {
    throw new Error(`Failed to download LOCOMO: HTTP ${response.status}`)
  }
  writeFileSync(cachePath, await response.text())
  return cachePath
}

function loadRowsFromEventsJsonl(path: string): LocomoRow[] {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  return lines.map((line, index) => {
    const event = JSON.parse(line) as Record<string, unknown>
    const message = stringValue(event.text) ?? stringValue(event.message) ?? ''
    if (!message.trim()) {
      throw new Error(`BenchmarkEvent JSONL row ${index + 1} is missing text`)
    }
    const sampleIndexValue = Number(event.sample_index ?? 1)
    return {
      row_index: index + 1,
      sample_index: Number.isFinite(sampleIndexValue) ? sampleIndexValue : 1,
      session_id: stringValue(event.session_id) ?? '',
      turn_id: stringValue(event.event_id) ?? stringValue(event.turn_id) ?? `${index + 1}`,
      speaker: stringValue(event.speaker) ?? '',
      message: message.trim(),
      timestamp: stringValue(event.timestamp) ?? '',
    }
  })
}

function loadLocomoRows(path: string): LocomoRow[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const samples = Array.isArray(raw) ? raw : [raw]
  const rows: LocomoRow[] = []

  samples.forEach((sample, sampleIndex) => {
    const sampleObject = sample as Record<string, unknown>
    const sampleId =
      stringValue(sampleObject.session_id) ??
      stringValue(sampleObject.conversation_id) ??
      stringValue(sampleObject.sample_id) ??
      stringValue(sampleObject.id) ??
      `sample_${sampleIndex + 1}`
    const groups = findTurnGroups(sampleObject)
    groups.forEach(group => {
      group.turns.forEach((turn, turnIndex) => {
        const turnObject = turn as Record<string, unknown>
        const message =
          stringValue(turnObject.message) ??
          stringValue(turnObject.text) ??
          stringValue(turnObject.content) ??
          stringValue(turnObject.utterance) ??
          ''
        const trimmed = message.trim()
        if (!trimmed) return
        rows.push({
          row_index: rows.length + 1,
          sample_index: sampleIndex + 1,
          session_id: `${sampleId}:${group.session_key}`,
          turn_id:
            stringValue(turnObject.turn_id) ??
            stringValue(turnObject.dia_id) ??
            stringValue(turnObject.id) ??
            `${turnIndex + 1}`,
          speaker:
            stringValue(turnObject.speaker) ??
            stringValue(turnObject.role) ??
            stringValue(turnObject.name) ??
            'unknown',
          message: trimmed,
          timestamp:
            stringValue(turnObject.timestamp) ??
            stringValue(turnObject.time) ??
            stringValue(turnObject.date) ??
            group.timestamp,
        })
      })
    })
  })

  return rows
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function findTurnGroups(sample: Record<string, unknown>): LocomoTurnGroup[] {
  const conversation = sample.conversation
  if (conversation && typeof conversation === 'object' && !Array.isArray(conversation)) {
    const conversationObject = conversation as Record<string, unknown>
    const groups = Object.keys(conversationObject)
      .filter(key => /^session_\d+$/.test(key) && Array.isArray(conversationObject[key]))
      .sort((left, right) => sessionNumber(left) - sessionNumber(right))
      .map(key => ({
        session_key: key,
        timestamp: stringValue(conversationObject[`${key}_date_time`]) ?? '',
        turns: conversationObject[key] as unknown[],
      }))
    if (groups.length > 0) return groups
  }

  const turns = findTurnArray(sample)
  if (turns.length > 0) {
    return [{ session_key: 'conversation', timestamp: '', turns }]
  }
  return []
}

function sessionNumber(key: string): number {
  const match = key.match(/^session_(\d+)$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function findTurnArray(sample: Record<string, unknown>): unknown[] {
  for (const key of ['conversation', 'dialogue', 'dialog', 'messages', 'turns']) {
    const value = sample[key]
    if (Array.isArray(value)) return value
  }
  for (const value of Object.values(sample)) {
    if (
      Array.isArray(value) &&
      value.some(item => {
        if (!item || typeof item !== 'object') return false
        const object = item as Record<string, unknown>
        return (
          typeof object.message === 'string' ||
          typeof object.text === 'string' ||
          typeof object.content === 'string' ||
          typeof object.utterance === 'string'
        )
      })
    ) {
      return value
    }
  }
  return []
}

function buildWindows(rows: LocomoRow[], options: CliOptions): WindowInput[] {
  const startIndex = options.startRow - 1
  const selected = rows.slice(startIndex, startIndex + options.rowLimit)
  if (selected.length === 0) {
    throw new Error('No LOCOMO rows selected; check --start-row and --row-limit')
  }
  return buildWindowsFromSelectedRows(selected, options.messagesPerWindow)
}

function buildWindowsFromSelectedRows(selected: LocomoRow[], messagesPerWindow: number): WindowInput[] {
  if (selected.length === 0) {
    throw new Error('No benchmark events selected')
  }
  const windows: WindowInput[] = []
  for (let i = 0; i < selected.length; i += messagesPerWindow) {
    const chunk = selected.slice(i, i + messagesPerWindow)
    const windowNumber = windows.length + 1
    windows.push({
      window_id: `window_${String(windowNumber).padStart(3, '0')}`,
      source_rows: chunk.map(row => row.row_index),
      model_visible_message_count: chunk.length,
      content: chunk.map(formatLocomoMessage).join('\n\n'),
    })
  }
  return windows
}

function formatLocomoMessage(row: LocomoRow): string {
  return [
    'LOCOMO dialogue utterance for memory extraction.',
    `speaker: ${row.speaker}`,
    `message: ${row.message}`,
    `session_id: ${row.session_id}`,
    `timestamp: ${row.timestamp}`,
  ].join('\n')
}

function writeInputs(inputDir: string, rows: LocomoRow[], windows: WindowInput[]): void {
  ensureDir(inputDir)
  writeCsv(
    join(inputDir, 'locomo_rows.csv'),
    ['row_index', 'sample_index', 'session_id', 'turn_id', 'speaker', 'message', 'timestamp'],
    rows,
  )
  writeCsv(
    join(inputDir, 'windows.csv'),
    ['window_id', 'source_rows', 'model_visible_message_count', 'content'],
    windows.map(window => ({
      window_id: window.window_id,
      source_rows: window.source_rows.join('|'),
      model_visible_message_count: window.model_visible_message_count,
      content: window.content,
    })),
  )
  writeFileSync(
    join(inputDir, 'windows.jsonl'),
    windows.map(window => JSON.stringify(window)).join('\n') + '\n',
  )
}

function safeRemove(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

function copyDirIfExists(from: string, to: string): boolean {
  if (!existsSync(from)) return false
  safeRemove(to)
  ensureDir(to)
  cpSync(from, to, { recursive: true })
  return true
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function writeJsonl(path: string, rows: readonly Record<string, unknown>[]): void {
  ensureDir(dirname(path))
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}

function appendJsonl(path: string, row: Record<string, unknown>): void {
  ensureDir(dirname(path))
  writeFileSync(path, `${JSON.stringify(row)}\n`, { flag: 'a' })
}

function checkpointDir(runDir: string): string {
  return join(runDir, 'checkpoint')
}

function checkpointMemoryBaseDir(runDir: string): string {
  return join(checkpointDir(runDir), 'memory-base')
}

function checkpointManifestPath(runDir: string): string {
  return join(checkpointDir(runDir), 'manifest.json')
}

function checkpointResumeEventsPath(runDir: string): string {
  return join(checkpointDir(runDir), 'resume_events.jsonl')
}

function windowsHash(windows: readonly WindowInput[]): string {
  const payload = JSON.stringify(
    windows.map(window => ({
      window_id: window.window_id,
      source_rows: window.source_rows,
      model_visible_message_count: window.model_visible_message_count,
      content: window.content,
    })),
  )
  return createHash('sha256').update(payload).digest('hex')
}

function componentCheckpointManifest(params: {
  options: CliOptions
  windows: readonly WindowInput[]
  metrics: readonly WindowMetric[]
}): ComponentCheckpointManifest {
  const completedWindows = params.metrics.length
  return {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    provider: params.options.provider,
    model: params.options.model,
    messages_per_window: params.options.messagesPerWindow,
    run_autodream: params.options.runAutoDream,
    run_direct_dream: params.options.runDirectDream,
    keep_going: params.options.keepGoing,
    trace: params.options.trace,
    windows_hash: windowsHash(params.windows),
    completed_windows: completedWindows,
    last_window_id: completedWindows === 0 ? '' : params.windows[completedWindows - 1]?.window_id ?? '',
  }
}

function saveComponentCheckpoint(params: {
  runDir: string
  memoryBaseDir: string
  options: CliOptions
  windows: readonly WindowInput[]
  metrics: readonly WindowMetric[]
  directDreamMetrics: readonly DirectDreamMetric[]
}): void {
  const directory = checkpointDir(params.runDir)
  ensureDir(directory)
  copyDirIfExists(params.memoryBaseDir, checkpointMemoryBaseDir(params.runDir))
  writeJsonl(join(directory, 'windows.jsonl'), params.metrics as unknown as Record<string, unknown>[])
  writeJsonl(join(directory, 'direct_dream_windows.jsonl'), params.directDreamMetrics as unknown as Record<string, unknown>[])
  writeFileSync(
    checkpointManifestPath(params.runDir),
    JSON.stringify(
      componentCheckpointManifest({
        options: params.options,
        windows: params.windows,
        metrics: params.metrics,
      }),
      null,
      2,
    ) + '\n',
  )
}

function loadComponentCheckpoint(params: {
  runDir: string
  options: CliOptions
  windows: readonly WindowInput[]
}): ComponentCheckpoint {
  const manifestPath = checkpointManifestPath(params.runDir)
  if (!existsSync(manifestPath)) {
    throw new Error(`--resume requires an existing checkpoint: ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ComponentCheckpointManifest
  const expected = componentCheckpointManifest({
    options: params.options,
    windows: params.windows,
    metrics: [],
  })
  const keys: (keyof ComponentCheckpointManifest)[] = [
    'schema_version',
    'provider',
    'model',
    'messages_per_window',
    'run_autodream',
    'run_direct_dream',
    'keep_going',
    'trace',
    'windows_hash',
  ]
  const mismatches = keys.filter(key => manifest[key] !== expected[key])
  if (mismatches.length > 0) {
    throw new Error(`Checkpoint does not match current arguments: ${mismatches.join(', ')}`)
  }
  if (manifest.completed_windows < 0 || manifest.completed_windows > params.windows.length) {
    throw new Error('Checkpoint completed_windows is out of range')
  }
  const metrics = readJsonl(join(checkpointDir(params.runDir), 'windows.jsonl')) as unknown as WindowMetric[]
  const directDreamMetrics = readJsonl(join(checkpointDir(params.runDir), 'direct_dream_windows.jsonl')) as unknown as DirectDreamMetric[]
  if (metrics.length !== manifest.completed_windows) {
    throw new Error('Checkpoint windows.jsonl does not match completed_windows')
  }
  if (metrics.some(metric => metric.status !== 'ok')) {
    throw new Error('Checkpoint windows.jsonl contains non-successful windows')
  }
  if (params.options.runDirectDream === 'each-window' && directDreamMetrics.length > manifest.completed_windows) {
    throw new Error('Checkpoint direct_dream_windows.jsonl has more rows than completed windows')
  }
  if (directDreamMetrics.some(metric => metric.status !== 'ok')) {
    throw new Error('Checkpoint direct_dream_windows.jsonl contains non-successful runs')
  }
  return { manifest, metrics, directDreamMetrics }
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

function findMemoryDirs(memoryBaseDir: string): string[] {
  const projectsDir = join(memoryBaseDir, 'projects')
  if (!existsSync(projectsDir)) return []
  const result: string[] = []
  for (const projectName of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, projectName, 'memory')
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      result.push(candidate)
    }
  }
  return result.sort()
}

function copyCurrentMemoryState(memoryBaseDir: string, snapshotDir: string): MemorySnapshotStats {
  const memoryDirs = findMemoryDirs(memoryBaseDir)
  safeRemove(snapshotDir)
  ensureDir(snapshotDir)
  memoryDirs.forEach((dir, index) => {
    const label =
      memoryDirs.length === 1
        ? 'memory'
        : `memory_${String(index + 1).padStart(2, '0')}_${basename(dir)}`
    copyDirIfExists(dir, join(snapshotDir, label))
  })
  return inspectMemorySnapshot(snapshotDir, memoryDirs)
}

function simpleHash(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function collectTopicFileHashes(snapshotDir: string): Map<string, string> {
  const rows = new Map<string, string>()
  for (const file of listFiles(snapshotDir).filter(path => path.endsWith('.md'))) {
    if (basename(file) === 'MEMORY.md') continue
    rows.set(file.slice(snapshotDir.length + 1), simpleHash(readFileSync(file, 'utf8')))
  }
  return rows
}

function countTopicFileDiffs(preDir: string, postDir: string): {
  added: number
  changed: number
  removed: number
} {
  const pre = collectTopicFileHashes(preDir)
  const post = collectTopicFileHashes(postDir)
  const paths = new Set([...pre.keys(), ...post.keys()])
  let added = 0
  let changed = 0
  let removed = 0
  for (const path of paths) {
    const preHash = pre.get(path)
    const postHash = post.get(path)
    if (preHash === undefined && postHash !== undefined) {
      added += 1
    } else if (preHash !== undefined && postHash === undefined) {
      removed += 1
    } else if (preHash !== postHash) {
      changed += 1
    }
  }
  return { added, changed, removed }
}

function safePathComponent(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

function projectTranscriptDir(configDir: string, projectDir: string): string {
  return join(configDir, 'projects', safePathComponent(projectDir))
}

function projectMemoryDir(memoryBaseDir: string, projectDir: string): string {
  return join(memoryBaseDir, 'projects', safePathComponent(projectDir), 'memory')
}

function seedAutoDreamGate(params: {
  configDir: string
  memoryBaseDir: string
  projectDir: string
  sessionCount: number
}): void {
  const { configDir, memoryBaseDir, projectDir, sessionCount } = params
  const transcriptDir = projectTranscriptDir(configDir, projectDir)
  ensureDir(transcriptDir)

  const now = Date.now()
  for (let index = 0; index < sessionCount; index += 1) {
    const sessionId = randomUUID()
    const timestamp = new Date(now - (sessionCount - index) * 60_000).toISOString()
    const line = JSON.stringify({
      type: 'user',
      uuid: randomUUID(),
      parentUuid: null,
      isSidechain: false,
      sessionId,
      timestamp,
      cwd: projectDir,
      message: {
        content: `Synthetic seeded autoDream session ${index + 1}.`,
      },
    })
    const path = join(transcriptDir, `${sessionId}.jsonl`)
    writeFileSync(path, `${line}\n`)
  }

  const memoryDir = projectMemoryDir(memoryBaseDir, projectDir)
  ensureDir(memoryDir)
  const lockPath = join(memoryDir, '.consolidate-lock')
  writeFileSync(lockPath, String(process.pid))
  const oldTime = new Date(Date.now() - SEEDED_AUTODREAM_LOCK_AGE_HOURS * 3_600_000)
  utimesSync(lockPath, oldTime, oldTime)
}

function inspectMemorySnapshot(snapshotDir: string, memoryDirs: string[]): MemorySnapshotStats {
  const markdownFiles = listFiles(snapshotDir).filter(path => path.endsWith('.md'))
  const memoryEntrypoints = markdownFiles.filter(path => basename(path) === 'MEMORY.md')
  const topicMarkdownFiles = markdownFiles.filter(path => basename(path) !== 'MEMORY.md')
  return {
    copied: memoryDirs.length > 0,
    memoryDirs,
    memoryFileCount: topicMarkdownFiles.length,
    markdownFileCount: markdownFiles.length,
    hasMemoryEntrypoint: memoryEntrypoints.length > 0,
  }
}

export function writeSettings(configDir: string, provider: string, runAutoDream: AutoDreamMode): void {
  ensureDir(configDir)
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify(
      {
        autoMemoryEnabled: true,
        autoDreamEnabled: runAutoDream !== 'none',
        llm: {
          providerProfile: provider,
        },
        permissions: {
          defaultMode: 'acceptEdits',
        },
      },
      null,
      2,
    ) + '\n',
  )
}

function mergeFeatureOverrides(overrides: Record<string, unknown>): string {
  const existing = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  if (!existing) {
    return JSON.stringify(overrides)
  }
  try {
    const parsed = JSON.parse(existing) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('CLAUDE_INTERNAL_FC_OVERRIDES must be a JSON object')
    }
    return JSON.stringify({ ...(parsed as Record<string, unknown>), ...overrides })
  } catch (error) {
    throw new Error(
      `Failed to parse existing CLAUDE_INTERNAL_FC_OVERRIDES: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function setupIsolatedEnvironment(params: {
  runDir: string
  configDir: string
  memoryBaseDir: string
  debugPath: string
  provider: string
  trace: boolean
}): void {
  const { runDir, configDir, memoryBaseDir, debugPath, provider, trace } = params
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = memoryBaseDir
  process.env.CLAUDE_CODE_LLM_PROFILE = provider
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  process.env.CLAUDE_CODE_SIMPLE = '0'
  process.env.CLAUDE_CODE_REMOTE = '0'
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = ''
  process.env.DISABLE_TELEMETRY = '1'
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  process.env.FORCE_COLOR = '0'
  if (trace) {
    process.env.CLAUDE_CODE_TRACE_DIR = join(runDir, 'trace')
  }
  if (!process.argv.includes('--debug-file')) {
    process.argv.push('--debug-file', debugPath)
  }
}

function configureExtractFeatureGateEnvironment(growthbook: {
  hasGrowthBookEnvOverride: (feature: string) => boolean
}): void {
  const previousUserType = process.env.USER_TYPE
  process.env.USER_TYPE = 'ant'
  process.env.CLAUDE_INTERNAL_FC_OVERRIDES = mergeFeatureOverrides(EXTRACT_FEATURE_OVERRIDES)

  if (!growthbook.hasGrowthBookEnvOverride('tengu_passport_quail')) {
    throw new Error('Failed to configure extractMemories GrowthBook env overrides')
  }

  if (previousUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = previousUserType
  }
}

export type NativeRuntime = {
  memoryDir: string
  createUserMessage: (args: { content: string }) => unknown
  executeExtractMemories: (context: unknown, appendSystemMessage?: (message: unknown) => void) => Promise<void>
  drainPendingExtraction: (timeoutMs?: number) => Promise<void>
  executeAutoDream?: (context: unknown, appendSystemMessage?: (message: unknown) => void) => Promise<void>
  directDream?: {
    buildConsolidationPrompt: (memoryRoot: string, transcriptDir: string, extra: string) => string
    createAutoMemCanUseTool: (memoryDir: string) => unknown
    createCacheSafeParams: (context: unknown) => unknown
    runForkedAgent: (params: Record<string, unknown>) => Promise<unknown>
  }
  buildContext: (messages: unknown[]) => Promise<unknown>
}

export async function loadNativeRuntime(options: NativeRuntimeOptions): Promise<NativeRuntime> {
  const { ensureBootstrapMacro } = await import('../../src/bootstrapMacro.ts')
  ensureBootstrapMacro()

  const [{ getEmptyToolPermissionContext }, toolsModule, growthbookModule] = await Promise.all([
    import('../../src/Tool.ts'),
    import('../../src/tools.ts'),
    import('../../src/services/analytics/growthbook.ts'),
  ])

  configureExtractFeatureGateEnvironment(growthbookModule)

  const imports = await Promise.all([
      import('../../src/state/AppStateStore.ts'),
      import('../../src/utils/fileStateCache.ts'),
      import('../../src/constants/prompts.ts'),
      import('../../src/utils/systemPromptType.ts'),
      import('../../src/utils/messages.ts'),
      import('../../src/services/extractMemories/extractMemories.ts'),
      import('../../src/utils/config.ts'),
      import('../../src/memdir/paths.ts'),
    ])
  const [
    appStateModule,
    fileState,
    promptModule,
    systemPromptModule,
    messagesModule,
    extractModule,
    configModule,
    memoryPathsModule,
  ] = imports
  const autoDreamModule =
    options.runAutoDream !== 'none'
      ? await import('../../src/services/autoDream/autoDream.ts')
      : undefined
  const directDreamModules =
    options.runDirectDream === 'each-window'
      ? await Promise.all([
          import('../../src/services/autoDream/consolidationPrompt.ts'),
          import('../../src/utils/forkedAgent.ts'),
        ])
      : undefined

  configModule.enableConfigs()
  extractModule.initExtractMemories()
  autoDreamModule?.initAutoDream()

  const permissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: 'acceptEdits' as const,
    additionalWorkingDirectories: new Map<string, unknown>(),
    shouldAvoidPermissionPrompts: true,
  }
  const tools = toolsModule.getTools(permissionContext)
  const appState = {
    ...appStateModule.getDefaultAppState(),
    toolPermissionContext: permissionContext,
    agentDefinitions: { activeAgents: [], allAgents: [] },
    mcp: { clients: [], tools: [], commands: [], resources: {}, pluginReconnectKey: 0 },
  }
  const systemPrompt = systemPromptModule.asSystemPrompt(
    await promptModule.getSystemPrompt(tools, options.model),
  )

  const buildContext = async (messages: unknown[]): Promise<unknown> => {
    const toolUseContext = {
      options: {
        commands: [],
        debug: true,
        mainLoopModel: options.model,
        tools,
        verbose: false,
        thinkingConfig: { type: 'disabled' as const },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      abortController: new AbortController(),
      readFileState: fileState.createFileStateCacheWithSizeLimit(1000),
      getAppState: () => appState,
      setAppState: () => {},
      setAppStateForTasks: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages,
      queryTracking: { chainId: randomUUID(), depth: 0 },
    }
    return {
      messages,
      systemPrompt,
      userContext: {},
      systemContext: {},
      toolUseContext,
      querySource: 'extract_memories',
    }
  }

  return {
    memoryDir: memoryPathsModule.getAutoMemPath(),
    createUserMessage: messagesModule.createUserMessage,
    executeExtractMemories: extractModule.executeExtractMemories,
    drainPendingExtraction: extractModule.drainPendingExtraction,
    executeAutoDream: autoDreamModule?.executeAutoDream,
    directDream: directDreamModules
      ? {
          buildConsolidationPrompt: directDreamModules[0].buildConsolidationPrompt,
          createAutoMemCanUseTool: extractModule.createAutoMemCanUseTool,
          createCacheSafeParams: directDreamModules[1].createCacheSafeParams,
          runForkedAgent: directDreamModules[1].runForkedAgent,
        }
      : undefined,
    buildContext,
  }
}

function writeRunMetadata(params: {
  runDir: string
  projectDir: string
  memoryBaseDir: string
  configDir: string
  options: CliOptions
  windows: WindowInput[]
}): void {
  const { runDir, projectDir, memoryBaseDir, configDir, options, windows } = params
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        mode:
          options.runDirectDream === 'each-window'
            ? 'extract-only+direct-dream-each-window'
            : options.runAutoDream === 'none'
            ? 'extract-only'
            : `extract-only+${options.runAutoDream}-autodream`,
        provider: options.provider,
        model: options.model,
        row_limit: options.rowLimit,
        start_row: options.startRow,
        events_jsonl: options.eventsJsonl ? resolve(options.eventsJsonl) : '',
        messages_per_window: options.messagesPerWindow,
        run_autodream: options.runAutoDream,
        run_direct_dream: options.runDirectDream,
        trace: options.trace,
        window_count: windows.length,
        user_type_for_eval: 'ant-temporary-growthbook-env-parse',
        feature_override_source: 'CLAUDE_INTERNAL_FC_OVERRIDES',
        feature_overrides: EXTRACT_FEATURE_OVERRIDES,
        project_dir: projectDir,
        memory_base_dir: memoryBaseDir,
        config_dir: configDir,
      },
      null,
      2,
    ) + '\n',
  )
}

function appendDebugMarker(debugPath: string, marker: string): void {
  writeFileSync(debugPath, `\n\n===== ${marker} =====\n`, { flag: 'a' })
}

function debugSlice(debugPath: string, startOffset: number): string {
  if (!existsSync(debugPath)) return ''
  return readFileSync(debugPath, 'utf8').slice(startOffset)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseForkedAgentFinish(slice: string, label: string): ForkedAgentFinish {
  const pattern = new RegExp(
    `Forked agent \\[${escapeRegExp(label)}\\] finished: (\\d+) messages, types=\\[([^\\]]*)\\], totalUsage: input=(\\d+) output=(\\d+) cacheRead=(\\d+) cacheCreate=(\\d+)`,
    'g',
  )
  const matches = [...slice.matchAll(pattern)]
  const match = matches.at(-1)
  if (!match) {
    return {
      messageCount: 0,
      messageTypes: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      invalidReason: '',
    }
  }

  const messageTypes = (match[2] ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const result = {
    messageCount: Number(match[1] ?? 0),
    messageTypes,
    inputTokens: Number(match[3] ?? 0),
    outputTokens: Number(match[4] ?? 0),
    cacheReadInputTokens: Number(match[5] ?? 0),
    cacheCreationInputTokens: Number(match[6] ?? 0),
    invalidReason: '',
  }
  if (
    result.messageCount === 1 &&
    result.messageTypes.length === 1 &&
    result.messageTypes[0] === 'assistant' &&
    result.inputTokens === 0 &&
    result.outputTokens === 0 &&
    result.cacheReadInputTokens === 0 &&
    result.cacheCreationInputTokens === 0
  ) {
    result.invalidReason = 'zero_usage_single_assistant'
  }
  return result
}

async function runAutoDream(params: {
  runtime: NativeRuntime
  transcriptMessages: unknown[]
  memoryBaseDir: string
  configDir: string
  projectDir: string
  debugPath: string
  preAutoDreamDir: string
  postAutoDreamDir: string
  mode: Exclude<AutoDreamMode, 'none'>
}): Promise<AutoDreamMetric> {
  const {
    runtime,
    transcriptMessages,
    memoryBaseDir,
    configDir,
    projectDir,
    debugPath,
    preAutoDreamDir,
    postAutoDreamDir,
    mode,
  } = params
  return await withExecutionTraceContext(
    { phase: `autodream_${mode}` },
    async () => {
  const preStats = copyCurrentMemoryState(memoryBaseDir, preAutoDreamDir)
  const start = Date.now()
  const debugStart = existsSync(debugPath) ? readFileSync(debugPath, 'utf8').length : 0
  const appendMessages: unknown[] = []
  let status = 'ok'
  let error = ''

  appendDebugMarker(debugPath, `autodream ${mode} start`)
  try {
    if (!runtime.executeAutoDream) {
      throw new Error('autoDream runtime was not loaded')
    }
    if (mode === 'seeded') {
      seedAutoDreamGate({
        configDir,
        memoryBaseDir,
        projectDir,
        sessionCount: SEEDED_AUTODREAM_SESSION_COUNT,
      })
    }
    const context = await runtime.buildContext([...transcriptMessages])
    await runtime.executeAutoDream(context, message => appendMessages.push(message))
  } catch (caught) {
    status = 'error'
    error = caught instanceof Error ? caught.message : String(caught)
  }
  appendDebugMarker(debugPath, `autodream ${mode} end status=${status}`)

  const postStats = copyCurrentMemoryState(memoryBaseDir, postAutoDreamDir)
  const slice = debugSlice(debugPath, debugStart)
  const fired = slice.includes('[autoDream] firing')
  const completed = slice.includes('[autoDream] completed')
  const failed = slice.includes('[autoDream] fork failed') || slice.includes('[autoDream] failed')
  const skipped =
    !fired &&
    (slice.includes('[autoDream] skip') ||
      slice.includes('[autoDream] scan throttle') ||
      status === 'ok')

  return {
    mode,
    status,
    duration_ms: Date.now() - start,
    seeded_session_count: mode === 'seeded' ? SEEDED_AUTODREAM_SESSION_COUNT : 0,
    pre_memory_file_count: preStats.memoryFileCount,
    post_memory_file_count: postStats.memoryFileCount,
    pre_markdown_file_count: preStats.markdownFileCount,
    post_markdown_file_count: postStats.markdownFileCount,
    append_system_messages: appendMessages.length,
    autodream_fired: fired,
    autodream_completed: completed,
    autodream_skipped: skipped,
    autodream_failed: failed || status === 'error',
    error,
  }
    },
  )
}

async function runDirectDreamForWindow(params: {
  runtime: NativeRuntime
  transcriptMessages: unknown[]
  memoryBaseDir: string
  configDir: string
  projectDir: string
  debugPath: string
  window: WindowInput
  snapshotRoot: string
}): Promise<DirectDreamMetric> {
  const {
    runtime,
    transcriptMessages,
    memoryBaseDir,
    configDir,
    projectDir,
    debugPath,
    window,
    snapshotRoot,
  } = params
  return await withExecutionTraceContext(
    { windowId: window.window_id, phase: 'direct_dream' },
    async () => {
  const preDir = join(snapshotRoot, window.window_id, 'pre')
  const postDir = join(snapshotRoot, window.window_id, 'post')
  const preStats = copyCurrentMemoryState(memoryBaseDir, preDir)
  const start = Date.now()
  const debugStart = existsSync(debugPath) ? readFileSync(debugPath, 'utf8').length : 0
  let status = 'ok'
  let error = ''

  appendDebugMarker(debugPath, `direct dream ${window.window_id} start`)
  try {
    if (!runtime.directDream) {
      throw new Error('direct dream runtime was not loaded')
    }
    const memoryRoot = projectMemoryDir(memoryBaseDir, projectDir)
    const transcriptDir = projectTranscriptDir(configDir, projectDir)
    ensureDir(transcriptDir)
    const extra = [
      `Direct component eval after extraction window ${window.window_id}.`,
      'This bypasses native autoDream scheduler gates and is not lifecycle evidence.',
      'The current synthetic transcript is already present in the fork context.',
      `Source LOCOMO rows for this window: ${window.source_rows.join('|')}.`,
    ].join('\n')
    const prompt = runtime.directDream.buildConsolidationPrompt(memoryRoot, transcriptDir, extra)
    const context = await runtime.buildContext([...transcriptMessages])
    await runtime.directDream.runForkedAgent({
      promptMessages: [runtime.createUserMessage({ content: prompt })],
      cacheSafeParams: runtime.directDream.createCacheSafeParams(context),
      canUseTool: runtime.directDream.createAutoMemCanUseTool(memoryRoot),
      querySource: 'direct_dream_component_eval',
      forkLabel: 'direct_dream_component_eval',
      skipTranscript: true,
    })
  } catch (caught) {
    status = 'error'
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const postStats = copyCurrentMemoryState(memoryBaseDir, postDir)
  const diff = countTopicFileDiffs(preDir, postDir)
  const finish = parseForkedAgentFinish(debugSlice(debugPath, debugStart), 'direct_dream_component_eval')
  if (status === 'ok' && finish.invalidReason) {
    status = 'invalid_llm_run'
    error = finish.invalidReason
  }
  appendDebugMarker(debugPath, `direct dream ${window.window_id} end status=${status}`)
  return {
    window_id: window.window_id,
    status,
    duration_ms: Date.now() - start,
    pre_memory_file_count: preStats.memoryFileCount,
    post_memory_file_count: postStats.memoryFileCount,
    pre_markdown_file_count: preStats.markdownFileCount,
    post_markdown_file_count: postStats.markdownFileCount,
    added_topic_files: diff.added,
    changed_topic_files: diff.changed,
    removed_topic_files: diff.removed,
    message_count: finish.messageCount,
    message_types: finish.messageTypes.join('|'),
    input_tokens: finish.inputTokens,
    output_tokens: finish.outputTokens,
    cache_read_input_tokens: finish.cacheReadInputTokens,
    cache_creation_input_tokens: finish.cacheCreationInputTokens,
    invalid_reason: finish.invalidReason,
    error,
  }
    },
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  validateProviderEnvironment(options)
  const repoRoot = resolve(join(import.meta.dir, '..', '..'))
  const runDir = resolve(options.outputDir ?? join(repoRoot, '.memory-test', 'native-cc-component', timestampForPath()))
  const inputDir = join(runDir, 'input')
  const nativeDir = join(runDir, 'native')
  const metricsDir = join(runDir, 'metrics')
  const cacheDir = join(repoRoot, '.cache', 'native-memory-component-eval')
  const configDir = join(nativeDir, 'config')
  const memoryBaseDir = join(nativeDir, 'memory-base')
  const snapshotRoot = join(nativeDir, 'memory_snapshots')
  const directDreamSnapshotRoot = join(nativeDir, 'direct_dream_snapshots')
  const preAutoDreamDir = join(nativeDir, 'pre_autodream_memory')
  const postAutoDreamDir = join(nativeDir, 'post_autodream_memory')
  const finalMemoryDir = join(nativeDir, 'final_memory')
  const debugPath = join(nativeDir, 'debug.log')
  const projectDir = join(TMP_PROJECT_ROOT, basename(runDir), 'project')

  if (options.resume) {
    if (!existsSync(runDir)) {
      throw new Error(`--resume output dir does not exist: ${runDir}`)
    }
  } else {
    safeRemove(runDir)
  }
  let selectedRows: LocomoRow[]
  let windows: WindowInput[]
  if (options.eventsJsonl) {
    selectedRows = loadRowsFromEventsJsonl(resolve(options.eventsJsonl))
    windows = buildWindowsFromSelectedRows(selectedRows, options.messagesPerWindow)
  } else {
    const locomoPath = await ensureLocomoDataset(options, cacheDir)
    const rows = loadLocomoRows(locomoPath)
    const startIndex = options.startRow - 1
    selectedRows = rows.slice(startIndex, startIndex + options.rowLimit)
    windows = buildWindows(rows, options)
  }
  const checkpoint = options.resume
    ? loadComponentCheckpoint({ runDir, options, windows })
    : undefined

  ensureDir(inputDir)
  ensureDir(nativeDir)
  ensureDir(metricsDir)
  ensureDir(projectDir)
  writeSettings(configDir, options.provider, options.runAutoDream)
  setupIsolatedEnvironment({
    runDir,
    configDir,
    memoryBaseDir,
    debugPath,
    provider: options.provider,
    trace: options.trace,
  })
  process.chdir(projectDir)
  writeInputs(inputDir, selectedRows, windows)
  writeRunMetadata({ runDir, projectDir, memoryBaseDir, configDir, options, windows })

  if (checkpoint) {
    appendJsonl(checkpointResumeEventsPath(runDir), {
      event: 'resume',
      resumed_at: new Date().toISOString(),
      completed_windows: checkpoint.manifest.completed_windows,
      last_window_id: checkpoint.manifest.last_window_id,
    })
    safeRemove(memoryBaseDir)
    copyDirIfExists(checkpointMemoryBaseDir(runDir), memoryBaseDir)
  }

  const runtime = await loadNativeRuntime(options)
  const transcriptMessages: unknown[] = []
  const metrics: WindowMetric[] = checkpoint ? [...checkpoint.metrics] : []
  const directDreamMetrics: DirectDreamMetric[] = checkpoint ? [...checkpoint.directDreamMetrics] : []
  const runId = basename(runDir)
  const completedWindows = checkpoint?.manifest.completed_windows ?? 0
  for (const window of windows.slice(0, completedWindows)) {
    transcriptMessages.push(runtime.createUserMessage({ content: window.content }))
  }

  for (const window of windows.slice(completedWindows)) {
    const start = Date.now()
    const debugStart = existsSync(debugPath) ? readFileSync(debugPath, 'utf8').length : 0
    const appendMessages: unknown[] = []
    let status = 'ok'
    let error = ''
    appendDebugMarker(debugPath, `${window.window_id} start rows=${window.source_rows.join('|')}`)
    try {
      await withExecutionTraceContext(
        { runId, windowId: window.window_id, phase: 'extract' },
        async () => {
          transcriptMessages.push(runtime.createUserMessage({ content: window.content }))
          const context = await runtime.buildContext([...transcriptMessages])
          await runtime.executeExtractMemories(context, message => appendMessages.push(message))
          await runtime.drainPendingExtraction(120_000)
        },
      )
      if (options.runDirectDream === 'each-window') {
        const directDreamMetric = await withExecutionTraceContext(
          { runId, windowId: window.window_id, phase: 'direct_dream' },
          async () =>
            await runDirectDreamForWindow({
              runtime,
              transcriptMessages,
              memoryBaseDir,
              configDir,
              projectDir,
              debugPath,
              window,
              snapshotRoot: directDreamSnapshotRoot,
            }),
        )
        directDreamMetrics.push(directDreamMetric)
        if (directDreamMetric.status === 'error' || directDreamMetric.status === 'invalid_llm_run') {
          status = directDreamMetric.status
          error = directDreamMetric.error
        }
      }
    } catch (caught) {
      status = 'error'
      error = caught instanceof Error ? caught.message : String(caught)
      if (!options.keepGoing) {
        throw caught
      }
    }
    const stats = copyCurrentMemoryState(memoryBaseDir, join(snapshotRoot, window.window_id))
    const slice = debugSlice(debugPath, debugStart)
    const extractorFinish = parseForkedAgentFinish(slice, 'extract_memories')
    const extractorInvalidReason = extractorFinish.invalidReason
    if (status === 'ok' && extractorInvalidReason) {
      status = 'invalid_llm_run'
      error = extractorInvalidReason
    }
    appendDebugMarker(debugPath, `${window.window_id} end status=${status}`)
    metrics.push({
      window_id: window.window_id,
      source_rows: window.source_rows.join('|'),
      model_visible_message_count: window.model_visible_message_count,
      status,
      duration_ms: Date.now() - start,
      extractor_started: slice.includes('[extractMemories] starting'),
      extractor_finished: slice.includes('[extractMemories] finished'),
      extractor_no_memories_saved: slice.includes('[extractMemories] no memories saved this run'),
      extractor_memories_saved: slice.includes('[extractMemories] memories saved:'),
      memory_file_count: stats.memoryFileCount,
      markdown_file_count: stats.markdownFileCount,
      has_memory_entrypoint: stats.hasMemoryEntrypoint,
      append_system_messages: appendMessages.length,
      extractor_message_count: extractorFinish.messageCount,
      extractor_message_types: extractorFinish.messageTypes.join('|'),
      extractor_input_tokens: extractorFinish.inputTokens,
      extractor_output_tokens: extractorFinish.outputTokens,
      extractor_cache_read_input_tokens: extractorFinish.cacheReadInputTokens,
      extractor_cache_creation_input_tokens: extractorFinish.cacheCreationInputTokens,
      extractor_invalid_reason: extractorInvalidReason,
      error,
    })
    if (status === 'ok' && metrics.every(metric => metric.status === 'ok')) {
      saveComponentCheckpoint({
        runDir,
        memoryBaseDir,
        options,
        windows,
        metrics,
        directDreamMetrics,
      })
    }
    if (status !== 'ok' && !options.keepGoing) {
      throw new Error(error || `${window.window_id} failed with status=${status}`)
    }
  }

  let autoDreamMetric: AutoDreamMetric = {
    mode: options.runAutoDream,
    status: options.runAutoDream === 'none' ? 'not_run' : 'not_started',
    duration_ms: 0,
    seeded_session_count: 0,
    pre_memory_file_count: 0,
    post_memory_file_count: 0,
    pre_markdown_file_count: 0,
    post_markdown_file_count: 0,
    append_system_messages: 0,
    autodream_fired: false,
    autodream_completed: false,
    autodream_skipped: false,
    autodream_failed: false,
    error: '',
  }
  if (options.runAutoDream !== 'none') {
    autoDreamMetric = await withExecutionTraceContext({ runId }, async () =>
      await runAutoDream({
        runtime,
        transcriptMessages,
        memoryBaseDir,
        configDir,
        projectDir,
        debugPath,
        preAutoDreamDir,
        postAutoDreamDir,
        mode: options.runAutoDream,
      }),
    )
    copyCurrentMemoryState(memoryBaseDir, finalMemoryDir)
  } else {
    copyCurrentMemoryState(memoryBaseDir, finalMemoryDir)
  }
  writeCsv(
    join(metricsDir, 'windows.csv'),
    [
      'window_id',
      'source_rows',
      'model_visible_message_count',
      'status',
      'duration_ms',
      'extractor_started',
      'extractor_finished',
      'extractor_no_memories_saved',
      'extractor_memories_saved',
      'memory_file_count',
      'markdown_file_count',
      'has_memory_entrypoint',
      'append_system_messages',
      'extractor_message_count',
      'extractor_message_types',
      'extractor_input_tokens',
      'extractor_output_tokens',
      'extractor_cache_read_input_tokens',
      'extractor_cache_creation_input_tokens',
      'extractor_invalid_reason',
      'error',
    ],
    metrics as unknown as Record<string, unknown>[],
  )
  writeCsv(
    join(metricsDir, 'direct_dream_windows.csv'),
    [
      'window_id',
      'status',
      'duration_ms',
      'pre_memory_file_count',
      'post_memory_file_count',
      'pre_markdown_file_count',
      'post_markdown_file_count',
      'added_topic_files',
      'changed_topic_files',
      'removed_topic_files',
      'message_count',
      'message_types',
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
      'invalid_reason',
      'error',
    ],
    directDreamMetrics as unknown as Record<string, unknown>[],
  )
  writeCsv(
    join(metricsDir, 'autodream.csv'),
    [
      'mode',
      'status',
      'duration_ms',
      'seeded_session_count',
      'pre_memory_file_count',
      'post_memory_file_count',
      'pre_markdown_file_count',
      'post_markdown_file_count',
      'append_system_messages',
      'autodream_fired',
      'autodream_completed',
      'autodream_skipped',
      'autodream_failed',
      'error',
    ],
    [autoDreamMetric as unknown as Record<string, unknown>],
  )

  const { analyzeRun } = await import('./analyze.ts')
  const summary = analyzeRun(runDir)
  console.log(`run: ${runDir}`)
  console.log(`windows: ${summary.windowCount}`)
  console.log(`extractor started windows: ${summary.windowsWithExtractorStart}`)
  console.log(`final topic files: ${summary.finalTopicFiles}`)
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
