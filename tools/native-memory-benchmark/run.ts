import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, join, relative, resolve } from 'path'
import { eligibleQuestions, eventCsvRows, eventsJsonl, goldAnswerCsvValue, loadLocomoSample, questionCsvRows, questionsJsonl, selectEvents } from './locomo.ts'
import { questionMetricRow, summarizeQuestionMetrics } from './metrics.ts'
import { firstModelText, inspectSelectorArtifacts, selectorSystemText } from './retrievalAnomalies.ts'
import type { BenchmarkEvent, BenchmarkQuestion, BenchmarkRunConfig, RetrievalResultRow } from './types.ts'

type MaintenanceMode = 'extract-only' | 'natural-autodream' | 'seeded-autodream' | 'direct-dream-each-window'
type AnswerMode = 'none' | 'shared_answerer'
type SelectorParseMode = 'strict' | 'lenient'

type CliOptions = {
  locomoPath?: string
  sampleIndex: number
  startRow: number
  rowLimit: number
  questionLimit: number
  messagesPerWindow: number
  memoryMode: MaintenanceMode
  existingMemoryDir?: string
  outputDir?: string
  provider: string
  model: string
  answer: boolean
  answerModel?: string
  answerMaxTokens: number
  selectorParseMode: SelectorParseMode
  trace: boolean
  keepGoing: boolean
  resume: boolean
}

type ComponentSummary = Record<string, string>

type SelectorTraceObservation = {
  reason: string
  selectedFromTrace: string
  rawText: string
  traceId: string
}

type BenchmarkCheckpointManifest = {
  schema_version: number
  config_hash: string
  question_ids: string[]
  completed_questions: number
  last_question_id: string
  maintenance_complete: boolean
  final_memory_path: string
}

type BenchmarkCheckpoint = {
  manifest: BenchmarkCheckpointManifest
  results: RetrievalResultRow[]
}

const DEFAULT_SAMPLE_INDEX = 0
const DEFAULT_START_ROW = 1
const DEFAULT_ROW_LIMIT = 12
const DEFAULT_QUESTION_LIMIT = 5
const DEFAULT_MESSAGES_PER_WINDOW = 1
const DEFAULT_MEMORY_MODE: MaintenanceMode = 'extract-only'
const DEFAULT_PROVIDER = 'deepseek-anthropic'
const DEFAULT_MODEL = 'deepseek-v4-flash[1m]'
const DEFAULT_ANSWER_MAX_TOKENS = 256
const SELECTOR_MAX_TOKENS = 8192
const DEFAULT_SELECTOR_PARSE_MODE: SelectorParseMode = 'strict'
const CHECKPOINT_SCHEMA_VERSION = 1
const ANSWER_SYSTEM_PROMPT = "Answer the benchmark question using only the retrieved memory context. If the context is insufficient, answer 'No information available.'."
const ANSWER_USER_PROMPT_TEMPLATE = 'Question:\n{question}\n\nRetrieved memory context:\n{retrieved_text}\n\nAnswer with a short factual phrase or sentence.'

function usage(): string {
  return [
    'Native Claude Code LOCOMO component-memory benchmark.',
    '',
    'Usage:',
    '  bun run tools/native-memory-benchmark/run.ts --locomo-path <locomo10.json> [options]',
    '',
    'Options:',
    '  --locomo-path <path>         Required LOCOMO JSON dataset path.',
    `  --sample-index <n>           LOCOMO sample index. Default: ${DEFAULT_SAMPLE_INDEX}`,
    `  --start-row <n>              1-based normalized event start row. Default: ${DEFAULT_START_ROW}`,
    `  --row-limit <n>              Number of normalized events to ingest. Default: ${DEFAULT_ROW_LIMIT}`,
    `  --question-limit <n>         Eligible questions to evaluate. Default: ${DEFAULT_QUESTION_LIMIT}`,
    `  --messages-per-window <n>    Events per native extractor window. Default: ${DEFAULT_MESSAGES_PER_WINDOW}`,
    `  --memory-mode <mode>         extract-only|natural-autodream|seeded-autodream|direct-dream-each-window. Default: ${DEFAULT_MEMORY_MODE}`,
    '  --existing-memory-dir <path> Skip maintenance and run retrieval against an existing native memory dir.',
    '  --output-dir <path>          Run output dir. Default: .memory-test/native-locomo-benchmark/<timestamp>',
    `  --provider <name>            Native LLM profile. Default: ${DEFAULT_PROVIDER}`,
    `  --model <id>                 Native model id. Default: ${DEFAULT_MODEL}`,
    '  --answer                     Generate benchmark-owned answers from retrieved memory text.',
    '  --answer-model <id>          Answer model. Default: --model value.',
    `  --answer-max-tokens <n>      Answer max tokens. Default: ${DEFAULT_ANSWER_MAX_TOKENS}`,
    `  --selector-parse-mode <mode> strict|lenient. Default: ${DEFAULT_SELECTOR_PARSE_MODE}`,
    '  --trace                      Enable native trace in component eval and retrieval.',
    '  --keep-going                 Continue component maintenance after failed windows.',
    '  --resume                     Resume from <output-dir>/checkpoint. Requires --output-dir.',
    '  --help                       Show this help.',
    '',
    'Notes:',
    '  Retrieval is component retrieval: BenchmarkQuestion.question -> findRelevantMemories -> readMemoriesForSurfacing.',
    '  This tool does not call or modify startRelevantMemoryPrefetch(...).',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sampleIndex: DEFAULT_SAMPLE_INDEX,
    startRow: DEFAULT_START_ROW,
    rowLimit: DEFAULT_ROW_LIMIT,
    questionLimit: DEFAULT_QUESTION_LIMIT,
    messagesPerWindow: DEFAULT_MESSAGES_PER_WINDOW,
    memoryMode: DEFAULT_MEMORY_MODE,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    answer: false,
    answerMaxTokens: DEFAULT_ANSWER_MAX_TOKENS,
    selectorParseMode: DEFAULT_SELECTOR_PARSE_MODE,
    trace: false,
    keepGoing: false,
    resume: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--answer') {
      options.answer = true
      continue
    }
    if (arg === '--trace') {
      options.trace = true
      continue
    }
    if (arg === '--keep-going') {
      options.keepGoing = true
      continue
    }
    if (arg === '--resume') {
      options.resume = true
      continue
    }
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    if (arg === '--locomo-path') {
      options.locomoPath = next
      index += 1
      continue
    }
    if (arg === '--sample-index') {
      options.sampleIndex = parseNonNegativeInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--start-row') {
      options.startRow = parsePositiveInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--row-limit') {
      options.rowLimit = parseNonNegativeInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--question-limit') {
      options.questionLimit = parseNonNegativeInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--messages-per-window') {
      options.messagesPerWindow = parsePositiveInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--memory-mode') {
      if (!isMaintenanceMode(next)) throw new Error('--memory-mode must be one of: extract-only, natural-autodream, seeded-autodream, direct-dream-each-window')
      options.memoryMode = next
      index += 1
      continue
    }
    if (arg === '--existing-memory-dir') {
      options.existingMemoryDir = next
      index += 1
      continue
    }
    if (arg === '--output-dir') {
      options.outputDir = next
      index += 1
      continue
    }
    if (arg === '--provider') {
      options.provider = next
      index += 1
      continue
    }
    if (arg === '--model') {
      options.model = next
      index += 1
      continue
    }
    if (arg === '--answer-model') {
      options.answerModel = next
      index += 1
      continue
    }
    if (arg === '--answer-max-tokens') {
      options.answerMaxTokens = parsePositiveInt(next, arg)
      index += 1
      continue
    }
    if (arg === '--selector-parse-mode') {
      options.selectorParseMode = parseSelectorParseMode(next)
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.locomoPath) throw new Error('--locomo-path is required')
  if (options.resume && !options.outputDir) throw new Error('--resume requires --output-dir')
  validateProviderEnvironment(options.provider)
  return options
}

function isMaintenanceMode(value: string): value is MaintenanceMode {
  return value === 'extract-only' || value === 'natural-autodream' || value === 'seeded-autodream' || value === 'direct-dream-each-window'
}

function parseSelectorParseMode(value: string): SelectorParseMode {
  if (value === 'strict' || value === 'lenient') return value
  throw new Error('--selector-parse-mode must be strict or lenient')
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function parseNonNegativeInt(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function validateProviderEnvironment(provider: string): void {
  if (!provider.startsWith('deepseek')) return
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required for DeepSeek provider profiles')
  if (apiKey === '...') throw new Error('DEEPSEEK_API_KEY appears to be the placeholder "..."')
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function safeRemove(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

function copyDirIfExists(from: string, to: string): boolean {
  if (!existsSync(from)) return false
  safeRemove(to)
  ensureDir(dirname(to))
  cpSync(from, to, { recursive: true })
  return true
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function writeCsv(path: string, headers: string[], rows: readonly Record<string, unknown>[]): void {
  ensureDir(dirname(path))
  const lines = [headers.join(','), ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))]
  writeFileSync(path, `${lines.join('\n')}\n`)
}

function readCsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').trim()
  if (!text) return []
  const [headerLine, ...lines] = text.split(/\r?\n/)
  const headers = parseCsvLine(headerLine ?? '')
  return lines.map(line => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
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

function writeBenchmarkInputs(params: {
  inputDir: string
  config: BenchmarkRunConfig
  events: BenchmarkEvent[]
  questions: BenchmarkQuestion[]
}): void {
  const { inputDir, config, events, questions } = params
  ensureDir(inputDir)
  writeCsv(join(inputDir, 'events.csv'), ['sample_id', 'event_id', 'speaker', 'session_id', 'timestamp', 'text'], eventCsvRows(events))
  writeCsv(join(inputDir, 'questions.csv'), ['question_id', 'sample_id', 'question', 'gold_answer', 'evidence_event_ids', 'category'], questionCsvRows(questions))
  writeFileSync(join(inputDir, 'events.jsonl'), eventsJsonl(events))
  writeFileSync(join(inputDir, 'questions.jsonl'), questionsJsonl(questions))
  writeFileSync(join(inputDir, 'run_config.json'), `${JSON.stringify(config, null, 2)}\n`)
}

function checkpointDir(runDir: string): string {
  return join(runDir, 'checkpoint')
}

function checkpointManifestPath(runDir: string): string {
  return join(checkpointDir(runDir), 'manifest.json')
}

function checkpointResultsPath(runDir: string): string {
  return join(checkpointDir(runDir), 'retrieval_results.jsonl')
}

function checkpointResumeEventsPath(runDir: string): string {
  return join(checkpointDir(runDir), 'resume_events.jsonl')
}

function configHash(config: BenchmarkRunConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
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

function benchmarkCheckpointManifest(params: {
  config: BenchmarkRunConfig
  questions: readonly BenchmarkQuestion[]
  results: readonly RetrievalResultRow[]
  maintenanceComplete: boolean
  finalMemoryPath: string
}): BenchmarkCheckpointManifest {
  const completedQuestions = params.results.length
  return {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    config_hash: configHash(params.config),
    question_ids: params.questions.map(question => question.question_id),
    completed_questions: completedQuestions,
    last_question_id: completedQuestions === 0 ? '' : params.results[completedQuestions - 1]?.question_id ?? '',
    maintenance_complete: params.maintenanceComplete,
    final_memory_path: params.finalMemoryPath,
  }
}

function saveBenchmarkCheckpoint(params: {
  runDir: string
  config: BenchmarkRunConfig
  questions: readonly BenchmarkQuestion[]
  results: readonly RetrievalResultRow[]
  maintenanceComplete: boolean
  finalMemoryPath: string
}): void {
  ensureDir(checkpointDir(params.runDir))
  writeJsonl(checkpointResultsPath(params.runDir), params.results as unknown as Record<string, unknown>[])
  writeFileSync(
    checkpointManifestPath(params.runDir),
    JSON.stringify(
      benchmarkCheckpointManifest({
        config: params.config,
        questions: params.questions,
        results: params.results,
        maintenanceComplete: params.maintenanceComplete,
        finalMemoryPath: params.finalMemoryPath,
      }),
      null,
      2,
    ) + '\n',
  )
}

function loadBenchmarkCheckpoint(params: {
  runDir: string
  config: BenchmarkRunConfig
  questions: readonly BenchmarkQuestion[]
}): BenchmarkCheckpoint {
  const manifestPath = checkpointManifestPath(params.runDir)
  if (!existsSync(manifestPath)) {
    throw new Error(`--resume requires an existing checkpoint: ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BenchmarkCheckpointManifest
  const expectedConfigHash = configHash(params.config)
  const expectedQuestionIds = params.questions.map(question => question.question_id)
  const mismatches: string[] = []
  if (manifest.schema_version !== CHECKPOINT_SCHEMA_VERSION) mismatches.push('schema_version')
  if (manifest.config_hash !== expectedConfigHash) mismatches.push('config_hash')
  if (JSON.stringify(manifest.question_ids) !== JSON.stringify(expectedQuestionIds)) mismatches.push('question_ids')
  if (manifest.completed_questions < 0 || manifest.completed_questions > expectedQuestionIds.length) mismatches.push('completed_questions')
  if (mismatches.length > 0) {
    throw new Error(`Checkpoint does not match current arguments: ${mismatches.join(', ')}`)
  }
  const results = readJsonl(checkpointResultsPath(params.runDir)) as unknown as RetrievalResultRow[]
  if (results.length !== manifest.completed_questions) {
    throw new Error('Checkpoint retrieval_results.jsonl does not match completed_questions')
  }
  for (let index = 0; index < results.length; index += 1) {
    if (results[index]?.question_id !== expectedQuestionIds[index]) {
      throw new Error(`Checkpoint result row ${index + 1} has unexpected question_id`)
    }
  }
  return { manifest, results }
}

function componentArgs(params: { options: CliOptions; eventsPath: string; componentDir: string }): string[] {
  const { options, eventsPath, componentDir } = params
  const args = [
    'run',
    'tools/native-memory-component-eval/run.ts',
    '--events-jsonl',
    eventsPath,
    '--messages-per-window',
    String(options.messagesPerWindow),
    '--provider',
    options.provider,
    '--model',
    options.model,
    '--output-dir',
    componentDir,
  ]
  if (options.memoryMode === 'natural-autodream') args.push('--run-autodream', 'natural')
  if (options.memoryMode === 'seeded-autodream') args.push('--run-autodream', 'seeded')
  if (options.memoryMode === 'direct-dream-each-window') args.push('--run-direct-dream', 'each-window')
  if (options.trace) args.push('--trace')
  if (options.keepGoing) args.push('--keep-going')
  if (options.resume) args.push('--resume')
  return args
}

function runMaintenance(params: { repoRoot: string; options: CliOptions; eventsPath: string; componentDir: string }): void {
  const args = componentArgs({ options: params.options, eventsPath: params.eventsPath, componentDir: params.componentDir })
  const proc = Bun.spawnSync({
    cmd: ['bun', ...args],
    cwd: params.repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  ensureDir(params.componentDir)
  writeFileSync(join(params.componentDir, 'benchmark_subprocess.stdout.log'), stdout)
  writeFileSync(join(params.componentDir, 'benchmark_subprocess.stderr.log'), stderr)
  if (proc.exitCode !== 0) {
    throw new Error(`component maintenance failed with exit code ${proc.exitCode}\n${stderr || stdout}`)
  }
}

function readComponentSummary(componentDir: string): ComponentSummary {
  return readCsv(join(componentDir, 'metrics', 'summary.csv'))[0] ?? {}
}

function invalidRunCount(componentSummary: ComponentSummary): number {
  return Number(componentSummary.invalidExtractorWindows || 0) + Number(componentSummary.invalidDirectDreamRuns || 0)
}

function externalMemorySummary(memoryDir: string): ComponentSummary {
  const topicFiles = existsSync(memoryDir)
    ? readdirSync(memoryDir).filter(name => name.endsWith('.md') && name !== 'MEMORY.md')
    : []
  const names = topicFiles
    .map(name => frontmatterName(join(memoryDir, name)))
    .filter(Boolean)
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const duplicateGroups = [...counts.values()].filter(count => count > 1).length
  return {
    finalTopicFiles: String(topicFiles.length),
    duplicateGroups: String(duplicateGroups),
  }
}

function frontmatterName(path: string): string {
  const text = readFileSync(path, 'utf8')
  const match = text.match(/^---\n[\s\S]*?\nname:\s*(.+)\n[\s\S]*?\n---/)
  return match?.[1]?.trim() ?? ''
}

async function setupNativeRetrieval(params: { runDir: string; provider: string; trace: boolean }): Promise<void> {
  const configDir = join(params.runDir, 'retrieval', 'config')
  ensureDir(configDir)
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify(
      {
        autoMemoryEnabled: true,
        autoDreamEnabled: false,
        llm: { providerProfile: params.provider },
        permissions: { defaultMode: 'acceptEdits' },
      },
      null,
      2,
    ) + '\n',
  )
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CODE_LLM_PROFILE = params.provider
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  process.env.CLAUDE_CODE_SIMPLE = '0'
  process.env.CLAUDE_CODE_REMOTE = '0'
  process.env.DISABLE_TELEMETRY = '1'
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  process.env.FORCE_COLOR = '0'
  if (params.trace) process.env.CLAUDE_CODE_TRACE_DIR = join(params.runDir, 'trace')

  const { ensureBootstrapMacro } = await import('../../src/bootstrapMacro.ts')
  ensureBootstrapMacro()
  const configModule = await import('../../src/utils/config.ts')
  configModule.enableConfigs()
}

async function runRetrieval(params: {
  runDir: string
  memoryDir: string
  questions: BenchmarkQuestion[]
  initialRows: RetrievalResultRow[]
  answer: boolean
  answerModel: string
  answerMaxTokens: number
  selectorParseMode: SelectorParseMode
  checkpoint: (rows: readonly RetrievalResultRow[]) => void
}): Promise<RetrievalResultRow[]> {
  ensureDir(params.memoryDir)
  const [{ findRelevantMemories }, { readMemoriesForSurfacing }] = await Promise.all([
    import('../../src/memdir/findRelevantMemories.ts'),
    import('../../src/utils/attachments.ts'),
  ])
  const rows: RetrievalResultRow[] = [...params.initialRows]
  for (const question of params.questions.slice(rows.length)) {
    const controller = new AbortController()
    const start = performance.now()
    const traceBefore = listLlmRequestArtifacts(params.runDir)
    const selected = await findRelevantMemories(
      question.question,
      params.memoryDir,
      controller.signal,
      [],
      new Set(),
      { selectorParseMode: params.selectorParseMode },
    )
    const selectorTrace = inspectSelectorTrace({
      runDir: params.runDir,
      before: traceBefore,
      nativeSelectedCount: selected.length,
      selectorParseMode: params.selectorParseMode,
    })
    const surfaced = await readMemoriesForSurfacing(selected, controller.signal)
    const retrievedText = surfaced.map(memory => `${memory.header}\n${memory.content}`).join('\n\n')
    const retrievalLatency = (performance.now() - start) / 1000
    let generatedAnswer: string | undefined
    let answerLatency = 0
    if (params.answer) {
      const answerStart = performance.now()
      generatedAnswer = await generateAnswer({
        question: question.question,
        retrievedText,
        model: params.answerModel,
        maxTokens: params.answerMaxTokens,
        signal: controller.signal,
      })
      answerLatency = (performance.now() - answerStart) / 1000
    }
    const metric = questionMetricRow({
      question,
      retrievedText,
      retrievedRowCount: surfaced.length,
      generatedAnswer,
    })
    rows.push({
      ...metric,
      retrieved_paths: surfaced.map(memory => relative(params.memoryDir, memory.path)).join(';'),
      retrieval_anomaly_reason: selectorTrace.reason,
      selector_selected_from_trace: selectorTrace.selectedFromTrace,
      selector_raw_text: selectorTrace.rawText,
      selector_trace_id: selectorTrace.traceId,
      retrieval_latency_sec: round4(retrievalLatency),
      ...(params.answer ? { answer_latency_sec: round4(answerLatency) } : {}),
    })
    params.checkpoint(rows)
  }
  return rows
}

function listLlmRequestArtifacts(runDir: string): Set<string> {
  const dir = join(runDir, 'trace', 'artifacts', 'llm-call')
  if (!existsSync(dir)) return new Set()
  return new Set(
    readdirSync(dir)
      .filter(name => name.endsWith('-request.json'))
      .map(name => join(dir, name)),
  )
}

function inspectSelectorTrace(params: {
  runDir: string
  before: ReadonlySet<string>
  nativeSelectedCount: number
  selectorParseMode: SelectorParseMode
}): SelectorTraceObservation {
  const empty = {
    reason: '',
    selectedFromTrace: '',
    rawText: '',
    traceId: '',
  }
  const requestPaths = [...listLlmRequestArtifacts(params.runDir)]
    .filter(path => !params.before.has(path))
  const selectorRequests = requestPaths
    .map(path => selectorRequestTrace(params.runDir, path, params.selectorParseMode))
    .filter((trace): trace is SelectorTraceObservation => trace !== undefined)
  const latest = selectorRequests.at(-1)
  if (!latest) return empty
  if (params.nativeSelectedCount > 0) {
    return {
      ...latest,
      reason: '',
    }
  }
  return latest
}

function selectorRequestTrace(runDir: string, requestPath: string, selectorParseMode: SelectorParseMode): SelectorTraceObservation | undefined {
  const request = readJson(requestPath)
  const payload = requestPayload(request)
  const system = selectorSystemText(payload)
  if (!system.includes('You are selecting memories that will be useful to Claude Code')) return undefined

  const traceId = basename(requestPath).replace(/-request\.json$/, '')
  const response = readJson(join(runDir, 'trace', 'artifacts', 'llm-call', `${traceId}-response.json`))
  const error = readJson(join(runDir, 'trace', 'artifacts', 'llm-call', `${traceId}-error.json`))
  const rawText = firstModelText(response)
  const selected = inspectSelectorArtifacts({ rawText, response, error, selectorParseMode })
  return {
    reason: selected.reason,
    selectedFromTrace: selected.selectedFromTrace,
    rawText: selected.rawText,
    traceId,
  }
}

function requestPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  if (isRecord(value.request)) return value.request
  return value
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function generateAnswer(params: { question: string; retrievedText: string; model: string; maxTokens: number; signal: AbortSignal }): Promise<string> {
  const { sideQuery } = await import('../../src/utils/sideQuery.ts')
  const response = await sideQuery({
    model: params.model,
    system: ANSWER_SYSTEM_PROMPT,
    skipSystemPromptPrefix: true,
    messages: [
      {
        role: 'user',
        content: renderAnswerUserPrompt(params.question, params.retrievedText),
      },
    ],
    max_tokens: params.maxTokens,
    signal: params.signal,
    querySource: 'native_locomo_benchmark_answer',
  })
  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text.trim() : ''
}

function renderAnswerUserPrompt(question: string, retrievedText: string): string {
  return ANSWER_USER_PROMPT_TEMPLATE
    .replace('{question}', question)
    .replace('{retrieved_text}', retrievedText || '(empty)')
}

function answerPromptHash(): string {
  const payload = JSON.stringify({
    system_prompt: ANSWER_SYSTEM_PROMPT,
    user_prompt_template: ANSWER_USER_PROMPT_TEMPLATE,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function writeAnswererMetadata(params: { runDir: string; answerModel: string; answerMaxTokens: number }): void {
  ensureDir(join(params.runDir, 'metadata'))
  writeFileSync(
    join(params.runDir, 'metadata', 'answerer.json'),
    JSON.stringify(
      {
        answer_mode: 'shared_answerer',
        answer_model: params.answerModel,
        answer_max_tokens: params.answerMaxTokens,
        system_prompt: ANSWER_SYSTEM_PROMPT,
        user_prompt_template: ANSWER_USER_PROMPT_TEMPLATE,
        prompt_hash: answerPromptHash(),
      },
      null,
      2,
    ) + '\n',
  )
}

function summaryRow(params: {
  options: CliOptions
  events: BenchmarkEvent[]
  questions: BenchmarkQuestion[]
  results: RetrievalResultRow[]
  componentSummary: ComponentSummary
  finalMemoryPath: string
}): Record<string, unknown> {
  const questionSummary = summarizeQuestionMetrics(params.results)
  const retrievalLatency = params.results.reduce((sum, row) => sum + Number(row.retrieval_latency_sec || 0), 0)
  const answerLatency = params.results.reduce((sum, row) => sum + Number(row.answer_latency_sec || 0), 0)
  const invalidCount = invalidRunCount(params.componentSummary)
  const retrievalAnomalyCount = params.results.filter(row => row.retrieval_anomaly_reason).length
  const selectorSchemaMismatchCount = params.results.filter(row => row.retrieval_anomaly_reason === 'selector_schema_mismatch').length
  const selectorNoTextOutputCount = params.results.filter(row => row.retrieval_anomaly_reason === 'selector_no_text_output').length
  const selectorLlmErrorCount = params.results.filter(row => row.retrieval_anomaly_reason === 'selector_llm_error').length
  const selectorMaxTokensNoTextCount = params.results.filter(row => row.retrieval_anomaly_reason === 'selector_max_tokens_no_text').length
  const selectorInvalidJsonCount = params.results.filter(row => row.retrieval_anomaly_reason === 'selector_invalid_json').length
  const emptyRetrievalCount = params.results.filter(row => row.retrieved_row_count === 0).length
  const selectorSelectedButRejectedCount = params.results.filter(row => row.retrieval_anomaly_reason && row.selector_selected_from_trace).length
  const cleanEmptyRetrievalCount = params.results.filter(row => row.retrieved_row_count === 0 && !row.retrieval_anomaly_reason).length
  const retrievalAnomalyDetectionAvailable = params.options.trace
  return {
    run_mode: params.options.answer ? 'answer' : 'retrieval_only_diagnostic',
    input_rendering: 'message_with_event_context',
    bookkeeping_metadata_excluded_from_semantic_input: true,
    qa_accuracy_available: params.options.answer,
    official_score_available: false,
    strict_evidence_recall_available: false,
    maintenance_mode: params.options.existingMemoryDir ? 'external-memory' : params.options.memoryMode,
    existing_memory_dir: params.options.existingMemoryDir ? resolve(params.options.existingMemoryDir) : '',
    retrieval_mode: 'component_retrieval',
    answer_mode: params.options.answer ? 'shared_answerer' : 'none',
    answer_max_tokens: params.options.answer ? params.options.answerMaxTokens : '',
    selector_max_tokens: SELECTOR_MAX_TOKENS,
    selector_parse_mode: params.options.selectorParseMode,
    trace_enabled: params.options.trace,
    provider: params.options.provider,
    model: params.options.model,
    answer_model: params.options.answer ? params.options.answerModel ?? params.options.model : '',
    sample_index: params.options.sampleIndex,
    start_row: params.options.startRow,
    row_limit: params.options.rowLimit,
    events_ingested: params.events.length,
    eligible_questions: params.questions.length,
    final_memory_path: params.finalMemoryPath,
    final_topic_files: params.componentSummary.finalTopicFiles ?? '',
    duplicate_groups: params.componentSummary.duplicateGroups ?? '',
    component_run_dir: params.componentSummary.runDir ?? '',
    invalid_llm_run_count: invalidCount,
    invalid_extractor_windows: params.componentSummary.invalidExtractorWindows ?? '0',
    invalid_direct_dream_runs: params.componentSummary.invalidDirectDreamRuns ?? '0',
    retrieval_anomaly_detection_available: retrievalAnomalyDetectionAvailable,
    retrieval_anomaly_count: retrievalAnomalyCount,
    selector_schema_mismatch_count: selectorSchemaMismatchCount,
    selector_no_text_output_count: selectorNoTextOutputCount,
    selector_llm_error_count: selectorLlmErrorCount,
    selector_max_tokens_no_text_count: selectorMaxTokensNoTextCount,
    selector_invalid_json_count: selectorInvalidJsonCount,
    empty_retrieval_count: emptyRetrievalCount,
    selector_selected_but_rejected_count: selectorSelectedButRejectedCount,
    clean_empty_retrieval_count: cleanEmptyRetrievalCount,
    behavioral_evidence_valid: invalidCount === 0 && retrievalAnomalyCount === 0 && retrievalAnomalyDetectionAvailable,
    retrieval_latency_sec: round4(retrievalLatency),
    answer_latency_sec: round4(answerLatency),
    latency_sec: round4(retrievalLatency + answerLatency),
    ...questionSummary,
  }
}

function retrievalAnomalyRows(results: readonly RetrievalResultRow[]): Record<string, unknown>[] {
  return results
    .filter(row => row.retrieval_anomaly_reason)
    .map(row => ({
      question_id: row.question_id,
      sample_id: row.sample_id,
      question: row.question,
      retrieval_anomaly_reason: row.retrieval_anomaly_reason ?? '',
      selector_selected_from_trace: row.selector_selected_from_trace ?? '',
      selector_raw_text: row.selector_raw_text ?? '',
      selector_trace_id: row.selector_trace_id ?? '',
      retrieved_row_count: row.retrieved_row_count,
      retrieved_paths: row.retrieved_paths,
    }))
}

function writeReport(params: { runDir: string; summary: Record<string, unknown> }): void {
  const report = [
    '# Native LOCOMO Benchmark Report',
    '',
    '## Run Status',
    '',
    `- maintenance_mode: ${params.summary.maintenance_mode}`,
    `- input_rendering: ${params.summary.input_rendering}`,
    `- bookkeeping_metadata_excluded_from_semantic_input: ${params.summary.bookkeeping_metadata_excluded_from_semantic_input}`,
    `- retrieval_mode: ${params.summary.retrieval_mode}`,
    `- answer_mode: ${params.summary.answer_mode}`,
    `- selector_max_tokens: ${params.summary.selector_max_tokens}`,
    `- selector_parse_mode: ${params.summary.selector_parse_mode}`,
    params.summary.selector_parse_mode === 'lenient'
      ? '- selector_parse_mode_note: lenient is a retrieval hardening experiment, not the strict native baseline.'
      : '- selector_parse_mode_note: strict is the native baseline parser contract.',
    `- events_ingested: ${params.summary.events_ingested}`,
    `- eligible_questions: ${params.summary.eligible_questions}`,
    `- invalid_llm_run_count: ${params.summary.invalid_llm_run_count}`,
    `- retrieval_anomaly_detection_available: ${params.summary.retrieval_anomaly_detection_available}`,
    `- retrieval_anomaly_count: ${params.summary.retrieval_anomaly_count}`,
    `- behavioral_evidence_valid: ${params.summary.behavioral_evidence_valid}`,
    '',
    '## Memory',
    '',
    `- final_memory_path: ${params.summary.final_memory_path}`,
    ...(params.summary.existing_memory_dir ? [`- existing_memory_dir: ${params.summary.existing_memory_dir}`] : []),
    `- final_topic_files: ${params.summary.final_topic_files}`,
    `- duplicate_groups: ${params.summary.duplicate_groups}`,
    '',
    '## Retrieval',
    '',
    `- proxy_answer_string_hit_rate: ${params.summary.proxy_answer_string_hit_rate}`,
    `- retrieval_latency_sec: ${params.summary.retrieval_latency_sec}`,
    `- empty_retrieval_count: ${params.summary.empty_retrieval_count}`,
    `- selector_schema_mismatch_count: ${params.summary.selector_schema_mismatch_count}`,
    `- selector_no_text_output_count: ${params.summary.selector_no_text_output_count}`,
    `- selector_llm_error_count: ${params.summary.selector_llm_error_count}`,
    `- selector_max_tokens_no_text_count: ${params.summary.selector_max_tokens_no_text_count}`,
    `- selector_invalid_json_count: ${params.summary.selector_invalid_json_count}`,
    `- selector_selected_but_rejected_count: ${params.summary.selector_selected_but_rejected_count}`,
    `- clean_empty_retrieval_count: ${params.summary.clean_empty_retrieval_count}`,
    '- anomaly interpretation: `selector_schema_mismatch` means the selector LLM chose a non-native schema; native retrieval rows remain unchanged.',
    '- anomaly interpretation: `selector_llm_error` means the selector LLM call failed; native retrieval rows remain unchanged.',
    '- anomaly interpretation: `selector_max_tokens_no_text` means the selector stopped before emitting final text; native retrieval rows remain unchanged.',
    '- trace note: if `retrieval_anomaly_detection_available=false`, empty retrieval cannot distinguish clean empty selection from selector failures.',
    '',
    '## Answer',
    '',
    `- locomo_answer_score_mean: ${params.summary.locomo_answer_score_mean}`,
    `- answer_f1_mean: ${params.summary.answer_f1_mean}`,
    '',
    '## Artifacts',
    '',
    '- input: input/events.jsonl, input/questions.jsonl, input/run_config.json',
    params.summary.maintenance_mode === 'external-memory'
      ? '- maintenance: skipped; using existing_memory_dir'
      : '- maintenance: native/component_eval/',
    '- retrieval: retrieval/results.csv',
    '- diagnostics: diagnostics/retrieval_anomalies.csv',
    ...(params.summary.answer_mode === 'shared_answerer' ? ['- metadata: metadata/answerer.json'] : []),
    '- metrics: metrics/questions.csv, metrics/summary.csv',
  ].join('\n')
  ensureDir(join(params.runDir, 'report'))
  writeFileSync(join(params.runDir, 'report', 'report.md'), `${report}\n`)
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const repoRoot = resolve(join(import.meta.dir, '..', '..'))
  const defaultRunRoot = join(repoRoot, '.memory-test', 'native-locomo-benchmark')
  const runDir = resolve(options.outputDir ?? join(defaultRunRoot, timestampForPath()))
  if (existsSync(runDir)) {
    if (options.resume) {
      // Keep the existing run directory intact; checkpoint validation happens after inputs are selected.
    } else if (options.outputDir) {
      throw new Error(`--output-dir already exists; refusing to delete user-provided path: ${runDir}`)
    } else {
      safeRemove(runDir)
    }
  } else if (options.resume) {
    throw new Error(`--resume output dir does not exist: ${runDir}`)
  }
  ensureDir(runDir)

  const sample = loadLocomoSample(resolve(options.locomoPath!), options.sampleIndex)
  const events = selectEvents(sample.events, { startRow: options.startRow, rowLimit: options.rowLimit })
  if (events.length === 0) throw new Error('No LOCOMO events selected; check --start-row and --row-limit')
  const questions = eligibleQuestions(sample.questions, {
    ingestedEventIds: events.map(event => event.event_id),
    questionLimit: options.questionLimit,
  })
  const answerMode: AnswerMode = options.answer ? 'shared_answerer' : 'none'
  const existingMemoryDir = options.existingMemoryDir ? resolve(options.existingMemoryDir) : ''
  if (existingMemoryDir && !existsSync(existingMemoryDir)) {
    throw new Error(`--existing-memory-dir does not exist: ${existingMemoryDir}`)
  }
  const config: BenchmarkRunConfig = {
    benchmark: 'locomo',
    input_rendering: 'message_with_event_context',
    bookkeeping_metadata_excluded_from_semantic_input: true,
    sample_index: options.sampleIndex,
    start_row: options.startRow,
    row_limit: options.rowLimit,
    question_limit: options.questionLimit,
    messages_per_window: options.messagesPerWindow,
    maintenance_mode: existingMemoryDir ? 'external-memory' : options.memoryMode,
    ...(existingMemoryDir ? { existing_memory_dir: existingMemoryDir } : {}),
    retrieval_mode: 'component_retrieval',
    answer_mode: answerMode,
    selector_max_tokens: SELECTOR_MAX_TOKENS,
    selector_parse_mode: options.selectorParseMode,
    provider: options.provider,
    model: options.model,
    answer_model: options.answerModel ?? options.model,
    answer_max_tokens: options.answerMaxTokens,
    trace_enabled: options.trace,
    keep_going: options.keepGoing,
  }
  const checkpoint = options.resume
    ? loadBenchmarkCheckpoint({ runDir, config, questions })
    : undefined
  if (checkpoint) {
    appendJsonl(checkpointResumeEventsPath(runDir), {
      event: 'resume',
      resumed_at: new Date().toISOString(),
      completed_questions: checkpoint.manifest.completed_questions,
      last_question_id: checkpoint.manifest.last_question_id,
      maintenance_complete: checkpoint.manifest.maintenance_complete,
    })
  }

  const inputDir = join(runDir, 'input')
  writeBenchmarkInputs({ inputDir, config, events, questions })
  if (options.answer) {
    writeAnswererMetadata({
      runDir,
      answerModel: options.answerModel ?? options.model,
      answerMaxTokens: options.answerMaxTokens,
    })
  }

  const componentDir = join(runDir, 'native', 'component_eval')
  let componentSummary: ComponentSummary
  let finalMemoryPath: string
  if (existingMemoryDir) {
    componentSummary = externalMemorySummary(existingMemoryDir)
    finalMemoryPath = existingMemoryDir
  } else if (checkpoint?.manifest.maintenance_complete && existsSync(checkpoint.manifest.final_memory_path)) {
    componentSummary = readComponentSummary(componentDir)
    finalMemoryPath = checkpoint.manifest.final_memory_path
  } else {
    runMaintenance({ repoRoot, options, eventsPath: join(inputDir, 'events.jsonl'), componentDir })
    componentSummary = readComponentSummary(componentDir)
    const componentFinalMemory = join(componentDir, 'native', 'final_memory')
    const finalMemoryRoot = join(runDir, 'native', 'final_memory')
    if (!copyDirIfExists(componentFinalMemory, finalMemoryRoot)) {
      throw new Error(`Component maintenance did not produce final memory: ${componentFinalMemory}`)
    }
    finalMemoryPath = join(finalMemoryRoot, 'memory')
    if (!existsSync(finalMemoryPath)) {
      throw new Error(`Copied final memory is missing expected memory directory: ${finalMemoryPath}`)
    }
  }
  saveBenchmarkCheckpoint({
    runDir,
    config,
    questions,
    results: checkpoint?.results ?? [],
    maintenanceComplete: true,
    finalMemoryPath,
  })

  await setupNativeRetrieval({ runDir, provider: options.provider, trace: options.trace })
  const results = await runRetrieval({
    runDir,
    memoryDir: finalMemoryPath,
    questions,
    initialRows: checkpoint?.results ?? [],
    answer: options.answer,
    answerModel: options.answerModel ?? options.model,
    answerMaxTokens: options.answerMaxTokens,
    selectorParseMode: options.selectorParseMode,
    checkpoint: rows =>
      saveBenchmarkCheckpoint({
        runDir,
        config,
        questions,
        results: rows,
        maintenanceComplete: true,
        finalMemoryPath,
      }),
  })
  const summary = summaryRow({ options, events, questions, results, componentSummary, finalMemoryPath })
  const anomalyRows = retrievalAnomalyRows(results)

  writeCsv(join(runDir, 'retrieval', 'results.csv'), Object.keys(results[0] ?? {
    question_id: '',
    sample_id: '',
    question: '',
    gold_answer: '',
    evidence_event_ids: '',
    category: '',
    retrieval_mode: '',
    retrieved_row_count: '',
    retrieved_paths: '',
    retrieved_text: '',
    proxy_answer_string_hit: '',
    retrieval_anomaly_reason: '',
    selector_selected_from_trace: '',
    selector_raw_text: '',
    selector_trace_id: '',
    retrieval_latency_sec: '',
  }), results as unknown as Record<string, unknown>[])
  writeCsv(join(runDir, 'diagnostics', 'retrieval_anomalies.csv'), [
    'question_id',
    'sample_id',
    'question',
    'retrieval_anomaly_reason',
    'selector_selected_from_trace',
    'selector_raw_text',
    'selector_trace_id',
    'retrieved_row_count',
    'retrieved_paths',
  ], anomalyRows)
  writeCsv(join(runDir, 'metrics', 'questions.csv'), Object.keys(results[0] ?? {}), results as unknown as Record<string, unknown>[])
  writeCsv(join(runDir, 'metrics', 'summary.csv'), Object.keys(summary), [summary])
  writeReport({ runDir, summary })

  console.log(`run: ${runDir}`)
  console.log(`events: ${events.length}`)
  console.log(`eligible questions: ${questions.length}`)
  console.log(`invalid LLM runs: ${summary.invalid_llm_run_count}`)
  console.log(`final memory: ${finalMemoryPath}`)
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
