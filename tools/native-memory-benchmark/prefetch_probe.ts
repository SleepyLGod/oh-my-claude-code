import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import type { ToolUseContext } from '../../src/Tool.ts'

type CliOptions = {
  memoryDir?: string
  query?: string
  outputDir?: string
  trace: boolean
  provider: string
  model: string
}

type ProbeMemory = {
  path: string
  mtimeMs?: number
  header?: string
  content_preview: string
}

const DEFAULT_PROVIDER = 'deepseek-anthropic'
const DEFAULT_MODEL = 'deepseek-v4-flash[1m]'
const DEFAULT_OUTPUT_DIR = '.memory-test/native-memory-benchmark/prefetch-probe'
const PREFETCH_FEATURE_OVERRIDES = {
  tengu_moth_copse: true,
} as const

function usage(): string {
  return [
    'Probe native startRelevantMemoryPrefetch(...) against an existing memory directory.',
    '',
    'Usage:',
    '  bun run tools/native-memory-benchmark/prefetch_probe.ts --memory-dir <dir> --query <text> [options]',
    '',
    'Options:',
    '  --memory-dir <dir>      Existing native memory dir containing MEMORY.md and topic markdown files.',
    '  --query <text>          Query text to place in the synthetic last user message.',
    `  --output-dir <dir>      Output dir. Default: ${DEFAULT_OUTPUT_DIR}/<timestamp>`,
    `  --provider <name>       LLM profile. Default: ${DEFAULT_PROVIDER}`,
    `  --model <id>            Main-loop model for synthetic context. Default: ${DEFAULT_MODEL}`,
    '  --trace                 Enable CLAUDE_CODE_TRACE_DIR under <output-dir>/trace.',
    '  --help                  Show this help.',
    '',
    'This is a removable diagnostic probe. It does not modify product retrieval, benchmark scoring, or memory files.',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    trace: false,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--trace') {
      options.trace = true
      continue
    }
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    if (arg === '--memory-dir') {
      options.memoryDir = next
      index += 1
      continue
    }
    if (arg === '--query') {
      options.query = next
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
    throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.memoryDir) throw new Error('--memory-dir is required')
  if (!options.query) throw new Error('--query is required')
  validateProviderEnvironment(options.provider)
  return options
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

function mergeFeatureOverrides(overrides: Record<string, unknown>): string {
  const existing = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  if (!existing) return JSON.stringify(overrides)
  const parsed = JSON.parse(existing) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CLAUDE_INTERNAL_FC_OVERRIDES must be a JSON object')
  }
  return JSON.stringify({ ...(parsed as Record<string, unknown>), ...overrides })
}

async function configureNative(params: {
  outputDir: string
  memoryDir: string
  provider: string
  trace: boolean
}): Promise<void> {
  const configDir = join(params.outputDir, 'config')
  mkdirSync(configDir, { recursive: true })
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
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = params.memoryDir
  process.env.CLAUDE_CODE_LLM_PROFILE = params.provider
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  process.env.CLAUDE_CODE_SIMPLE = '0'
  process.env.CLAUDE_CODE_REMOTE = '0'
  process.env.DISABLE_TELEMETRY = '1'
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  process.env.FORCE_COLOR = '0'
  process.env.CLAUDE_INTERNAL_FC_OVERRIDES = mergeFeatureOverrides(PREFETCH_FEATURE_OVERRIDES)
  if (params.trace) process.env.CLAUDE_CODE_TRACE_DIR = join(params.outputDir, 'trace')

  const { ensureBootstrapMacro } = await import('../../src/bootstrapMacro.ts')
  ensureBootstrapMacro()
  const previousUserType = process.env.USER_TYPE
  process.env.USER_TYPE = 'ant'
  const growthbookModule = await import('../../src/services/analytics/growthbook.ts')
  if (!growthbookModule.hasGrowthBookEnvOverride('tengu_moth_copse')) {
    throw new Error('Failed to configure memory prefetch GrowthBook env override')
  }
  if (previousUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = previousUserType
  }
  const configModule = await import('../../src/utils/config.ts')
  configModule.enableConfigs()
}

function preview(value: string, maxChars = 1200): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}

function extractMemories(attachments: unknown[]): ProbeMemory[] {
  const memories: ProbeMemory[] = []
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue
    const maybeMemories = (attachment as { memories?: unknown }).memories
    if (!Array.isArray(maybeMemories)) continue
    for (const memory of maybeMemories) {
      if (!memory || typeof memory !== 'object') continue
      const row = memory as {
        path?: unknown
        content?: unknown
        mtimeMs?: unknown
        header?: unknown
      }
      memories.push({
        path: typeof row.path === 'string' ? row.path : '',
        mtimeMs: typeof row.mtimeMs === 'number' ? row.mtimeMs : undefined,
        header: typeof row.header === 'string' ? row.header : undefined,
        content_preview: typeof row.content === 'string' ? preview(row.content) : '',
      })
    }
  }
  return memories
}

async function runProbe(options: CliOptions): Promise<void> {
  const memoryDir = resolve(options.memoryDir ?? '')
  if (!existsSync(memoryDir)) throw new Error(`memory dir does not exist: ${memoryDir}`)
  const outputDir = resolve(options.outputDir ?? join(DEFAULT_OUTPUT_DIR, timestampForPath()))
  mkdirSync(outputDir, { recursive: true })

  await configureNative({
    outputDir,
    memoryDir,
    provider: options.provider,
    trace: options.trace,
  })

  const [
    { startRelevantMemoryPrefetch, filterDuplicateMemoryAttachments },
    { createUserMessage },
    { createFileStateCacheWithSizeLimit },
  ] = await Promise.all([
    import('../../src/utils/attachments.ts'),
    import('../../src/utils/messages.ts'),
    import('../../src/utils/fileStateCache.ts'),
  ])

  const messages = [createUserMessage({ content: options.query ?? '' })]
  const readFileState = createFileStateCacheWithSizeLimit(1000)
  const toolUseContext = {
    options: {
      commands: [],
      debug: true,
      mainLoopModel: options.model,
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState,
    getAppState: () => ({
      agentDefinitions: { activeAgents: [], allAgents: [] },
      mcp: { clients: [], tools: [], commands: [], resources: {}, pluginReconnectKey: 0 },
    }),
    setAppState: () => {},
    setAppStateForTasks: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages,
    queryTracking: { chainId: randomUUID(), depth: 0 },
  } as unknown as ToolUseContext

  const startedAt = performance.now()
  const handle = startRelevantMemoryPrefetch(messages, toolUseContext)
  const rawAttachments = handle ? await handle.promise : []
  const filteredAttachments = filterDuplicateMemoryAttachments(rawAttachments, readFileState)
  if (handle) {
    handle.consumedOnIteration = 0
    handle[Symbol.dispose]()
  }
  const latencyMs = Math.round((performance.now() - startedAt) * 1000) / 1000

  const result = {
    query: options.query,
    memory_dir: memoryDir,
    output_dir: outputDir,
    provider: options.provider,
    model: options.model,
    trace_enabled: options.trace,
    prefetch_started: handle !== undefined,
    settled_at_ms: handle?.settledAt,
    latency_ms: latencyMs,
    raw_attachment_count: rawAttachments.length,
    filtered_attachment_count: filteredAttachments.length,
    raw_memories: extractMemories(rawAttachments),
    filtered_memories: extractMemories(filteredAttachments),
    notes: [
      'This probe calls native startRelevantMemoryPrefetch(...) and then product filterDuplicateMemoryAttachments(...).',
      'It is diagnostic only and does not affect benchmark scoring or product retrieval.',
    ],
  }

  writeFileSync(join(outputDir, 'prefetch_result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(`wrote ${join(outputDir, 'prefetch_result.json')}`)
}

try {
  await runProbe(parseArgs(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
