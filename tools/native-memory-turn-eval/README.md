# Native Claude Code Turn-Level Memory Eval

This tool runs an isolated native Claude Code memory experiment.

It does not change Claude Code runtime behavior. It launches the restored CLI
with an isolated config directory and memory base, feeds LOCOMO-derived turns,
copies native memory snapshots after each turn, and writes simple metrics.

## Defaults

- Provider profile: `deepseek-anthropic`
- Model: `deepseek-v4-flash[1m]`
- Required API key: `DEEPSEEK_API_KEY`
- Output root: `.memory-test/native-cc/<run-id>/`
- Native project cwd: `<system-temp>/claude-code-native-memory-projects/<run-id>/project`
- `--bare`: never used, because it disables auto-memory and background work.

The actual system temp directory is platform-specific: macOS usually uses
`/private/tmp`, Linux usually uses `/tmp`, and Windows uses `%TEMP%`.

## Run

```bash
DEEPSEEK_API_KEY=... bun run tools/native-memory-turn-eval/run.ts --row-limit 2
```

Prove the native memory write path with an explicit memory request:

```bash
DEEPSEEK_API_KEY=... bun run tools/native-memory-turn-eval/run.ts --row-limit 1 --turn-size 1 --smoke-mode explicit-remember
```

Compare flash and pro:

```bash
DEEPSEEK_API_KEY=... bun run tools/native-memory-turn-eval/run.ts --row-limit 12 --model 'deepseek-v4-flash[1m]'
DEEPSEEK_API_KEY=... bun run tools/native-memory-turn-eval/run.ts --row-limit 12 --model 'deepseek-v4-pro[1m]'
```

Analyze an existing run:

```bash
bun run tools/native-memory-turn-eval/analyze.ts .memory-test/native-cc/<run-id>
```

## Output

```text
.memory-test/native-cc/<run-id>/
  input/
    locomo_rows.csv
    turns.csv
    turns.jsonl
  native/
    config/
    debug.log
    memory-base/
    memory_snapshots/
    final_memory/
    turn_outputs/
  metrics/
    turns.csv
    memory_files.csv
    index_entries.csv
    duplicates.csv
  report/
    report.md
```

## Interpretation

This is a native Claude Code memory audit, not a differential-query benchmark.

Use `report/report.md` to confirm whether native memory actually triggered. If
no memory files or debug signals appear, treat the run as blocked by feature
gates or runtime configuration, not as evidence that native memory produced an
empty result.

`smoke-mode=locomo` observes native behavior on a natural LOCOMO prompt and may
produce no memory files. `smoke-mode=explicit-remember` is the write-path smoke:
if it exits successfully but produces no `MEMORY.md` or topic markdown, the
write path has not been proven.

Fragmentation is not automatically a failure. Duplicates are audit signals,
because the native memory prompt asks Claude to check existing memories and
update them rather than creating redundant topic files.
