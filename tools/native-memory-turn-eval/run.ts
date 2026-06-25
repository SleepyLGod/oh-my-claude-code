import { spawnSync } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'

type SmokeMode = 'locomo' | 'explicit-remember'

type CliOptions = {
  rowLimit: number
  startRow: number
  turnSize: number
  outputDir?: string
  smokeMode: SmokeMode
  provider: string
  model: string
  locomoPath?: string
  prompt?: string
  keepGoing: boolean
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

type Turn = {
  turn_id: string
  source_rows: number[]
  prompt: string
  speaker_summary: string
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
const DEFAULT_TURN_SIZE = 3
const DEFAULT_SMOKE_MODE: SmokeMode = 'locomo'
const TMP_PROJECT_ROOT = join(tmpdir(), 'claude-code-native-memory-projects')
const LOCOMO_URL =
  'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json'
const LOCOMO_DOWNLOAD_TIMEOUT_MS = 30_000

function usage(): string {
  return [
    'Native Claude Code turn-level memory eval.',
    '',
    'Usage:',
    '  bun run tools/native-memory-turn-eval/run.ts [options]',
    '',
    'Options:',
    `  --row-limit <n>       LOCOMO rows to use. Default: ${DEFAULT_ROW_LIMIT}`,
    `  --start-row <n>       1-based LOCOMO row start. Default: ${DEFAULT_START_ROW}`,
    `  --turn-size <n>       LOCOMO rows per native turn. Default: ${DEFAULT_TURN_SIZE}`,
    '  --output-dir <path>   Run output dir. Default: .memory-test/native-cc/<timestamp>',
    `  --smoke-mode <mode>   locomo or explicit-remember. Default: ${DEFAULT_SMOKE_MODE}`,
    `  --provider <name>     LLM profile. Default: ${DEFAULT_PROVIDER}`,
    `  --model <id>          Model id. Default: ${DEFAULT_MODEL}`,
    '  --locomo-path <path>  Use local locomo10.json instead of downloading/caching.',
    '  --prompt <text>       Extra instruction appended to every turn.',
    '  --keep-going          Continue after a failed turn and mark the run failed.',
    '  --help                Show this help.',
    '',
    'Environment:',
    '  DEEPSEEK_API_KEY must be set for the default provider.',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    rowLimit: DEFAULT_ROW_LIMIT,
    startRow: DEFAULT_START_ROW,
    turnSize: DEFAULT_TURN_SIZE,
    smokeMode: DEFAULT_SMOKE_MODE,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    keepGoing: false,
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
    if (arg === '--turn-size') {
      options.turnSize = parsePositiveInt(next, arg)
      i += 1
      continue
    }
    if (arg === '--output-dir') {
      options.outputDir = next
      i += 1
      continue
    }
    if (arg === '--smoke-mode') {
      options.smokeMode = parseSmokeMode(next)
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
    if (arg === '--prompt') {
      options.prompt = next
      i += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function parseSmokeMode(value: string): SmokeMode {
  if (value === 'locomo' || value === 'explicit-remember') {
    return value
  }
  throw new Error('--smoke-mode must be one of: locomo, explicit-remember')
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
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
  let response: Response
  try {
    response = await fetch(LOCOMO_URL, {
      signal: AbortSignal.timeout(LOCOMO_DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : ''
    if (errorName === 'AbortError' || errorName === 'TimeoutError') {
      throw new Error(
        `Failed to download LOCOMO: request timed out after ${LOCOMO_DOWNLOAD_TIMEOUT_MS}ms`,
      )
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`Failed to download LOCOMO: HTTP ${response.status}`)
  }
  writeFileSync(cachePath, await response.text())
  return cachePath
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
    if (groups.length > 0) {
      return groups
    }
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

function buildTurns(rows: LocomoRow[], options: CliOptions): Turn[] {
  const startIndex = options.startRow - 1
  const selected = rows.slice(startIndex, startIndex + options.rowLimit)
  if (selected.length === 0) {
    throw new Error('No LOCOMO rows selected; check --start-row and --row-limit')
  }
  const turns: Turn[] = []
  for (let i = 0; i < selected.length; i += options.turnSize) {
    const chunk = selected.slice(i, i + options.turnSize)
    const turnNumber = turns.length + 1
    const conversation = chunk
      .map(row => `${row.speaker}: ${row.message}`)
      .join('\n')
    const prompt = buildTurnPrompt(conversation, options)
    turns.push({
      turn_id: `turn_${String(turnNumber).padStart(3, '0')}`,
      source_rows: chunk.map(row => row.row_index),
      prompt,
      speaker_summary: Array.from(new Set(chunk.map(row => row.speaker))).join('; '),
    })
  }
  return turns
}

function buildTurnPrompt(conversation: string, options: CliOptions): string {
  if (options.smokeMode === 'explicit-remember') {
    return [
      'This is a native Claude Code memory write-path smoke test.',
      'Please save any durable user-relevant memory from the dialogue excerpt using Claude Code native memory behavior if the runtime supports it.',
      'After saving, briefly acknowledge what was remembered.',
      '',
      conversation,
      options.prompt ? `\nAdditional instruction: ${options.prompt}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    'Read the following dialogue excerpt and continue normally.',
    'If the excerpt contains durable user-relevant memory, use Claude Code native memory behavior.',
    '',
    conversation,
    options.prompt ? `\nAdditional instruction: ${options.prompt}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function sanitizeForCsvList(values: number[]): string {
  return values.join('|')
}

function writeInputs(inputDir: string, rows: LocomoRow[], turns: Turn[]): void {
  ensureDir(inputDir)
  writeFileSync(
    join(inputDir, 'turns.jsonl'),
    turns.map(turn => JSON.stringify(turn)).join('\n') + '\n',
  )
  writeCsv(
    join(inputDir, 'turns.csv'),
    ['turn_id', 'source_rows', 'speaker_summary', 'prompt'],
    turns.map(turn => ({
      turn_id: turn.turn_id,
      source_rows: sanitizeForCsvList(turn.source_rows),
      speaker_summary: turn.speaker_summary,
      prompt: turn.prompt,
    })),
  )
  writeCsv(
    join(inputDir, 'locomo_rows.csv'),
    ['row_index', 'sample_index', 'session_id', 'turn_id', 'speaker', 'message', 'timestamp'],
    rows,
  )
}

function writeSettings(configDir: string, provider: string): void {
  ensureDir(configDir)
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify(
      {
        autoMemoryEnabled: true,
        autoDreamEnabled: true,
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

function safeRemove(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
  }
}

function copyDirIfExists(from: string, to: string): boolean {
  if (!existsSync(from)) {
    return false
  }
  safeRemove(to)
  ensureDir(to)
  cpSync(from, to, { recursive: true })
  return true
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

function copyCurrentMemoryState(
  memoryBaseDir: string,
  snapshotDir: string,
): MemorySnapshotStats {
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

type MemorySnapshotStats = {
  copied: boolean
  memoryDirs: string[]
  memoryFileCount: number
  markdownFileCount: number
  hasMemoryEntrypoint: boolean
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

function writeRunMetadata(params: {
  runDir: string
  projectDir: string
  memoryBaseDir: string
  configDir: string
  options: CliOptions
  turns: Turn[]
}): void {
  const { runDir, projectDir, memoryBaseDir, configDir, options, turns } = params
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        provider: options.provider,
        model: options.model,
        row_limit: options.rowLimit,
        start_row: options.startRow,
        turn_size: options.turnSize,
        smoke_mode: options.smokeMode,
        turn_count: turns.length,
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

function runTurn(params: {
  repoRoot: string
  projectDir: string
  runDir: string
  configDir: string
  memoryBaseDir: string
  debugPath: string
  options: CliOptions
  turn: Turn
}): { status: number | null; stdoutPath: string; stderrPath: string; durationMs: number } {
  const { repoRoot, projectDir, runDir, configDir, memoryBaseDir, debugPath, options, turn } =
    params
  const outputDir = join(runDir, 'native', 'turn_outputs')
  ensureDir(outputDir)
  const stdoutPath = join(outputDir, `${turn.turn_id}.stdout.txt`)
  const stderrPath = join(outputDir, `${turn.turn_id}.stderr.txt`)
  appendDebugMarker(debugPath, `${turn.turn_id} start`)
  const started = Date.now()
  const result = spawnSync(
    'bun',
    [
      'run',
      join(repoRoot, 'src/bootstrap-entry.ts'),
      '-p',
      turn.prompt,
      '--model',
      options.model,
      '--permission-mode',
      'acceptEdits',
      '--debug-file',
      debugPath,
      '--setting-sources',
      'user',
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_REMOTE_MEMORY_DIR: memoryBaseDir,
        CLAUDE_CODE_LLM_PROFILE: options.provider,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        CLAUDE_CODE_SIMPLE: '0',
        CLAUDE_COWORK_MEMORY_PATH_OVERRIDE: '',
        CLAUDE_CODE_REMOTE: '0',
        DISABLE_TELEMETRY: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        FORCE_COLOR: '0',
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    },
  )
  const durationMs = Date.now() - started
  writeFileSync(stdoutPath, result.stdout ?? '')
  writeFileSync(stderrPath, result.stderr ?? '')
  appendDebugMarker(debugPath, `${turn.turn_id} end status=${result.status}`)
  if (result.error) {
    writeFileSync(
      stderrPath,
      `\n[spawn error]\n${result.error.stack ?? result.error.message}\n`,
      { flag: 'a' },
    )
  }
  return { status: result.status, stdoutPath, stderrPath, durationMs }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.provider.startsWith('deepseek') && !process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required for DeepSeek provider profiles')
  }

  const repoRoot = process.cwd()
  const requiredFiles = [join(repoRoot, 'src', 'bootstrap-entry.ts')]
  const missingFiles = requiredFiles.filter(path => !existsSync(path))
  if (missingFiles.length > 0) {
    console.error(
      `Native memory turn eval must be run from the restored Claude Code repo root. Missing: ${missingFiles.join(', ')}`,
    )
    process.exit(1)
  }

  const runDir = resolve(
    options.outputDir ??
      join('.memory-test', 'native-cc', `native-cc-${timestampForPath()}-${randomUUID().slice(0, 8)}`),
  )
  const nativeDir = join(runDir, 'native')
  const configDir = join(nativeDir, 'config')
  const memoryBaseDir = join(nativeDir, 'memory-base')
  const projectDir = join(TMP_PROJECT_ROOT, basename(runDir), 'project')
  const debugPath = join(nativeDir, 'debug.log')

  safeRemove(runDir)
  safeRemove(projectDir)
  ensureDir(runDir)
  ensureDir(nativeDir)
  ensureDir(memoryBaseDir)
  ensureDir(projectDir)
  writeSettings(configDir, options.provider)

  const locomoPath = await ensureLocomoDataset(options, join(repoRoot, '.cache', 'native-memory-turn-eval'))
  const rows = loadLocomoRows(locomoPath)
  const turns = buildTurns(rows, options)
  const selectedRows = rows.slice(options.startRow - 1, options.startRow - 1 + options.rowLimit)
  writeInputs(join(runDir, 'input'), selectedRows, turns)
  writeRunMetadata({ runDir, projectDir, memoryBaseDir, configDir, options, turns })

  const turnMetrics: Record<string, unknown>[] = []
  let failed = false
  for (const turn of turns) {
    console.log(`running ${turn.turn_id} rows=${turn.source_rows.join(',')}`)
    const result = runTurn({
      repoRoot,
      projectDir,
      runDir,
      configDir,
      memoryBaseDir,
      debugPath,
      options,
      turn,
    })
    const snapshotDir = join(nativeDir, 'memory_snapshots', turn.turn_id)
    const snapshot = copyCurrentMemoryState(memoryBaseDir, snapshotDir)
    const debugSize = existsSync(debugPath) ? statSync(debugPath).size : 0
    const memoryFingerprint = snapshot.memoryDirs
      .map(dir => `${dir}:${existsSync(dir) ? countFiles(dir) : 0}`)
      .join('|')
    turnMetrics.push({
      turn_id: turn.turn_id,
      source_rows: sanitizeForCsvList(turn.source_rows),
      status: result.status,
      duration_ms: result.durationMs,
      stdout_path: result.stdoutPath,
      stderr_path: result.stderrPath,
      snapshot_path: snapshotDir,
      memory_dirs: snapshot.memoryDirs.join('|'),
      memory_copied: snapshot.copied,
      memory_file_count: snapshot.memoryFileCount,
      markdown_file_count: snapshot.markdownFileCount,
      has_memory_entrypoint: snapshot.hasMemoryEntrypoint,
      memory_fingerprint: createHash('sha256').update(memoryFingerprint).digest('hex'),
      debug_log_bytes: debugSize,
    })
    if (result.status !== 0) {
      failed = true
      if (!options.keepGoing) {
        break
      }
    }
  }

  copyCurrentMemoryState(memoryBaseDir, join(nativeDir, 'final_memory'))
  ensureDir(join(runDir, 'metrics'))
  writeCsv(
    join(runDir, 'metrics', 'turns.csv'),
    [
      'turn_id',
      'source_rows',
      'status',
      'duration_ms',
      'stdout_path',
      'stderr_path',
      'snapshot_path',
      'memory_dirs',
      'memory_copied',
      'memory_file_count',
      'markdown_file_count',
      'has_memory_entrypoint',
      'memory_fingerprint',
      'debug_log_bytes',
    ],
    turnMetrics,
  )

  const analyze = spawnSync('bun', ['run', join(repoRoot, 'tools/native-memory-turn-eval/analyze.ts'), runDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  })
  if (analyze.stdout) process.stdout.write(analyze.stdout)
  if (analyze.stderr) process.stderr.write(analyze.stderr)

  console.log(`run dir: ${runDir}`)
  if (failed) {
    process.exitCode = 1
  }
}

function countFiles(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      count += countFiles(path)
    } else {
      count += 1
    }
  }
  return count
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
