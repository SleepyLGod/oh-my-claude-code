import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, join, relative, resolve } from 'path'

type MemoryFileRow = {
  snapshot_id: string
  path: string
  name: string
  description: string
  type: string
  body_preview: string
  body_hash: string
  mtime: string
}

type IndexEntryRow = {
  snapshot_id: string
  title: string
  path: string
  hook: string
  line: number
}

type DuplicateRow = {
  snapshot_id: string
  duplicate_type: string
  key: string
  paths: string
  preview: string
}

type TurnMetricRow = Record<string, string>

function usage(): string {
  return [
    'Analyze native Claude Code memory eval artifacts.',
    '',
    'Usage:',
    '  bun run tools/native-memory-turn-eval/analyze.ts <run-dir>',
    '',
    'Outputs:',
    '  metrics/memory_files.csv',
    '  metrics/index_entries.csv',
    '  metrics/duplicates.csv',
    '  report/report.md',
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

function listSnapshotDirs(runDir: string): string[] {
  const snapshotsDir = join(runDir, 'native', 'memory_snapshots')
  if (!existsSync(snapshotsDir)) return []
  return readdirSync(snapshotsDir)
    .map(name => join(snapshotsDir, name))
    .filter(path => statSync(path).isDirectory())
    .sort()
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...listMarkdownFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(path)
    }
  }
  return result.sort()
}

function parseFrontmatter(content: string): {
  fields: Record<string, string>
  body: string
} {
  const normalizedContent = content.replace(/\r\n/g, '\n')
  if (!normalizedContent.startsWith('---\n')) {
    return { fields: {}, body: normalizedContent }
  }
  const end = normalizedContent.indexOf('\n---', 4)
  if (end < 0) {
    return { fields: {}, body: normalizedContent }
  }
  const raw = normalizedContent.slice(4, end)
  const fields: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    fields[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return { fields, body: normalizedContent.slice(end + 4).trim() }
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim()
}

function snapshotId(snapshotDir: string): string {
  return basename(snapshotDir)
}

function collectMemoryRows(runDir: string): MemoryFileRow[] {
  const rows: MemoryFileRow[] = []
  for (const snapshotDir of listSnapshotDirs(runDir)) {
    const id = snapshotId(snapshotDir)
    for (const file of listMarkdownFiles(snapshotDir)) {
      if (basename(file) === 'MEMORY.md') continue
      const content = readFileSync(file, 'utf8')
      const parsed = parseFrontmatter(content)
      const bodyHash = createHash('sha256').update(parsed.body).digest('hex')
      rows.push({
        snapshot_id: id,
        path: relative(runDir, file),
        name: parsed.fields.name ?? '',
        description: parsed.fields.description ?? '',
        type: parsed.fields.type ?? '',
        body_preview: preview(parsed.body),
        body_hash: bodyHash,
        mtime: statSync(file).mtime.toISOString(),
      })
    }
  }
  return rows
}

function collectIndexRows(runDir: string): IndexEntryRow[] {
  const rows: IndexEntryRow[] = []
  for (const snapshotDir of listSnapshotDirs(runDir)) {
    const id = snapshotId(snapshotDir)
    for (const file of listMarkdownFiles(snapshotDir)) {
      if (basename(file) !== 'MEMORY.md') continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        const match = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—-]\s*)?(.*)$/)
        if (!match) return
        rows.push({
          snapshot_id: id,
          title: match[1].trim(),
          path: match[2].trim(),
          hook: match[3].trim(),
          line: index + 1,
        })
      })
    }
  }
  return rows
}

function addDuplicateGroups(
  rows: DuplicateRow[],
  snapshotIdValue: string,
  duplicateType: string,
  groups: Map<string, string[]>,
  previewByKey: Map<string, string>,
): void {
  for (const [key, paths] of groups.entries()) {
    if (!key || paths.length < 2) continue
    rows.push({
      snapshot_id: snapshotIdValue,
      duplicate_type: duplicateType,
      key,
      paths: paths.join('|'),
      preview: previewByKey.get(key) ?? '',
    })
  }
}

function collectDuplicates(memoryRows: MemoryFileRow[], indexRows: IndexEntryRow[]): DuplicateRow[] {
  const duplicates: DuplicateRow[] = []
  const snapshotIds = Array.from(
    new Set([...memoryRows.map(row => row.snapshot_id), ...indexRows.map(row => row.snapshot_id)]),
  ).sort()

  for (const id of snapshotIds) {
    const memoryForSnapshot = memoryRows.filter(row => row.snapshot_id === id)
    const indexForSnapshot = indexRows.filter(row => row.snapshot_id === id)
    const nameGroups = new Map<string, string[]>()
    const namePreview = new Map<string, string>()
    const bodyGroups = new Map<string, string[]>()
    const bodyPreview = new Map<string, string>()
    const indexGroups = new Map<string, string[]>()
    const indexPreview = new Map<string, string>()

    for (const row of memoryForSnapshot) {
      const nameKey = normalizeKey(row.name)
      if (nameKey) {
        nameGroups.set(nameKey, [...(nameGroups.get(nameKey) ?? []), row.path])
        namePreview.set(nameKey, row.body_preview)
      }
      if (row.body_hash) {
        bodyGroups.set(row.body_hash, [...(bodyGroups.get(row.body_hash) ?? []), row.path])
        bodyPreview.set(row.body_hash, row.body_preview)
      }
    }

    for (const row of indexForSnapshot) {
      const key = normalizeKey(row.title)
      if (!key) continue
      indexGroups.set(key, [...(indexGroups.get(key) ?? []), row.path])
      indexPreview.set(key, row.hook)
    }

    addDuplicateGroups(duplicates, id, 'same_name', nameGroups, namePreview)
    addDuplicateGroups(duplicates, id, 'same_body_hash', bodyGroups, bodyPreview)
    addDuplicateGroups(duplicates, id, 'same_index_title', indexGroups, indexPreview)
  }

  return duplicates
}

function readRunJson(runDir: string): Record<string, unknown> {
  const path = join(runDir, 'run.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function parseCsv(content: string): TurnMetricRow[] {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    const row: TurnMetricRow = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    return row
  })
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

function readTurnMetrics(runDir: string): TurnMetricRow[] {
  const path = join(runDir, 'metrics', 'turns.csv')
  if (!existsSync(path)) return []
  return parseCsv(readFileSync(path, 'utf8'))
}

function boolValue(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

function numericValue(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasDebugSignal(runDir: string, pattern: RegExp): boolean {
  const debugPath = join(runDir, 'native', 'debug.log')
  if (!existsSync(debugPath)) return false
  return pattern.test(readFileSync(debugPath, 'utf8'))
}

function writeReport(params: {
  runDir: string
  memoryRows: MemoryFileRow[]
  indexRows: IndexEntryRow[]
  duplicates: DuplicateRow[]
}): void {
  const { runDir, memoryRows, indexRows, duplicates } = params
  const reportDir = join(runDir, 'report')
  ensureDir(reportDir)
  const run = readRunJson(runDir)
  const snapshotIds = listSnapshotDirs(runDir).map(snapshotId)
  const finalSnapshot = snapshotIds.at(-1)
  const finalMemoryRows = finalSnapshot
    ? memoryRows.filter(row => row.snapshot_id === finalSnapshot)
    : []
  const finalIndexRows = finalSnapshot
    ? indexRows.filter(row => row.snapshot_id === finalSnapshot)
    : []
  const finalDuplicates = finalSnapshot
    ? duplicates.filter(row => row.snapshot_id === finalSnapshot)
    : []
  const extractSignal = hasDebugSignal(runDir, /\[extractMemories\]/)
  const autoDreamSignal = hasDebugSignal(runDir, /\[autoDream\]/)
  const mainAgentMemoryWriteEvidence = hasDebugSignal(
    runDir,
    /Memory updated|memory updated|memoryWriteCount|memory write/i,
  )
  const turnMetrics = readTurnMetrics(runDir)
  const cliSuccess =
    turnMetrics.length > 0 && turnMetrics.every(row => row.status === '0')
  const finalTurnMetric = turnMetrics.at(-1)
  const memoryDirExists = turnMetrics.some(row => boolValue(row.memory_copied))
  const finalMarkdownCount = numericValue(finalTurnMetric?.markdown_file_count)
  const finalMemoryFileCount = numericValue(finalTurnMetric?.memory_file_count)
  const finalHasMemoryEntrypoint = boolValue(finalTurnMetric?.has_memory_entrypoint)
  const nativeMarkdownGenerated =
    finalMarkdownCount > 0 || finalMemoryRows.length > 0 || finalIndexRows.length > 0
  const memoryTriggered = nativeMarkdownGenerated

  const lines = [
    '# Native Claude Code Memory Eval Report',
    '',
    `- run_dir: ${runDir}`,
    `- provider: ${run.provider ?? ''}`,
    `- model: ${run.model ?? ''}`,
    `- smoke_mode: ${run.smoke_mode ?? ''}`,
    `- row_limit: ${run.row_limit ?? ''}`,
    `- turn_count: ${run.turn_count ?? ''}`,
    `- project_dir: ${run.project_dir ?? ''}`,
    `- memory_base_dir: ${run.memory_base_dir ?? ''}`,
    `- config_dir: ${run.config_dir ?? ''}`,
    '',
    '## Execution Signals',
    '',
    `- cli_success: ${cliSuccess}`,
    `- memory_dir_exists: ${memoryDirExists}`,
    `- native_memory_markdown_generated: ${nativeMarkdownGenerated}`,
    `- memory_entrypoint_exists: ${finalHasMemoryEntrypoint}`,
    `- topic_markdown_files: ${finalMemoryFileCount}`,
    `- memory_triggered: ${memoryTriggered}`,
    `- extract_debug_signal: ${extractSignal}`,
    `- auto_dream_debug_signal: ${autoDreamSignal}`,
    `- main_agent_memory_write_debug_signal: ${mainAgentMemoryWriteEvidence}`,
    '',
    '## Final Snapshot',
    '',
    `- snapshot: ${finalSnapshot ?? 'none'}`,
    `- topic_files: ${finalMemoryRows.length}`,
    `- index_entries: ${finalIndexRows.length}`,
    `- markdown_files_from_turn_metrics: ${finalMarkdownCount}`,
    `- duplicate_groups: ${finalDuplicates.length}`,
    '',
    '## Duplicate Groups',
    '',
    finalDuplicates.length === 0
      ? '- none'
      : finalDuplicates
          .map(
            row =>
              `- ${row.duplicate_type}: ${row.key} -> ${row.paths}`,
          )
          .join('\n'),
    '',
    '## Interpretation Boundary',
    '',
    '- This report only describes native Claude Code artifacts produced in the isolated run directory.',
    '- CLI success only means the restored CLI exited successfully; it does not imply native memory wrote files.',
    '- memory_dir_exists only means Claude Code created a memory directory; it may still be empty.',
    '- native_memory_markdown_generated is the primary write-path signal for this harness.',
    '- In smoke_mode=locomo, an empty memory result can be native behavior for that natural prompt.',
    '- In smoke_mode=explicit-remember, an empty memory result means the write path was not proven.',
    '- Fragmentation is not treated as a failure by itself.',
    '- Duplicate topic/index evidence is reported as an audit signal for manual review.',
    '- If memory_triggered is false, this run should not be used as native-memory evidence.',
    '',
  ]
  writeFileSync(join(reportDir, 'report.md'), `${lines.join('\n')}\n`)
}

function main(): void {
  const arg = process.argv[2]
  if (!arg || arg === '--help' || arg === '-h') {
    console.log(usage())
    process.exit(arg ? 0 : 1)
  }
  const runDir = resolve(arg)
  if (!existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`)
  }

  const metricsDir = join(runDir, 'metrics')
  ensureDir(metricsDir)
  const memoryRows = collectMemoryRows(runDir)
  const indexRows = collectIndexRows(runDir)
  const duplicateRows = collectDuplicates(memoryRows, indexRows)

  writeCsv(
    join(metricsDir, 'memory_files.csv'),
    ['snapshot_id', 'path', 'name', 'description', 'type', 'body_preview', 'body_hash', 'mtime'],
    memoryRows,
  )
  writeCsv(
    join(metricsDir, 'index_entries.csv'),
    ['snapshot_id', 'title', 'path', 'hook', 'line'],
    indexRows,
  )
  writeCsv(
    join(metricsDir, 'duplicates.csv'),
    ['snapshot_id', 'duplicate_type', 'key', 'paths', 'preview'],
    duplicateRows,
  )
  writeReport({ runDir, memoryRows, indexRows, duplicates: duplicateRows })
  console.log(`analyzed: ${runDir}`)
  console.log(`memory files: ${memoryRows.length}`)
  console.log(`index entries: ${indexRows.length}`)
  console.log(`duplicate groups: ${duplicateRows.length}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
