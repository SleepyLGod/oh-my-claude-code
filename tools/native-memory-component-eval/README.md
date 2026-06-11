# Native Claude Code Component Memory Eval

This tool runs an isolated extract-only native Claude Code memory experiment. It
is intentionally separate from `tools/native-memory-turn-eval`, which launches
the CLI main-agent path.

## What It Measures

```text
LOCOMO row/window
-> synthetic native message context
-> executeExtractMemories(...)
-> native memory markdown artifacts
```

It does not run the main Claude CLI turn, does not ask the main agent to answer a
LOCOMO prompt, and only runs `autoDream` when explicitly requested.

`--messages-per-window 1` means each extractor call sees one LOCOMO-derived
model-visible message in the synthetic context. This is not the same thing as
CLI `--turn-size 1`.

`--run-autodream natural` calls native `autoDream` after extraction without
seeding scheduler inputs; small runs commonly skip, and that is a valid result.

`--run-autodream seeded` runs native `autoDream` after extraction by seeding the
isolated scheduler inputs that native autoDream already expects: an old
`.consolidate-lock` mtime and enough synthetic session transcript files. This is
a component eval mode, not proof of the natural production schedule.

`--run-direct-dream each-window` runs the dream/consolidation component directly
after each extraction window. It does not call native `executeAutoDream`, does
not seed scheduler inputs, and is component diagnostic evidence rather than
native scheduler evidence. It is slower and more expensive than extract-only
runs.

The runner enables the required GrowthBook gates in the current process with
`CLAUDE_INTERNAL_FC_OVERRIDES`. This is an eval-only environment override; it
does not modify the native memory implementation, prompts, scheduler, or global
Claude Code config.

## Run

```bash
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 1 --messages-per-window 1
```

Larger runs:

```bash
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 12 --messages-per-window 1
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 12 --messages-per-window 3
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 12 --messages-per-window 1 --run-autodream natural
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 12 --messages-per-window 1 --run-autodream seeded
DEEPSEEK_API_KEY=... bun run tools/native-memory-component-eval/run.ts --row-limit 3 --messages-per-window 1 --run-direct-dream each-window
```

Analyze an existing run:

```bash
bun run tools/native-memory-component-eval/analyze.ts .memory-test/native-cc-component/<run-id>
```

## Output

```text
.memory-test/native-cc-component/<run-id>/
  input/
    locomo_rows.csv
    windows.csv
    windows.jsonl
  native/
    config/
    debug.log
    memory-base/
    memory_snapshots/
    direct_dream_snapshots/
    pre_autodream_memory/
    post_autodream_memory/
    final_memory/
  metrics/
    windows.csv
    autodream.csv
    direct_dream_windows.csv
    memory_files.csv
    index_entries.csv
    duplicates.csv
    summary.csv
  report/
    report.md
```

## Interpretation

Use `metrics/windows.csv` to confirm the extractor actually started and
finished. If the extractor started and finished but wrote no files, that is a
valid native extraction observation. If it did not start, the run did not prove
the extract-only path.

Default runs are extract-only. The `natural` mode calls native `autoDream` with
the current isolated scheduler state, so it may skip. The `seeded` mode runs
native `autoDream` itself but constructs the scheduler preconditions inside the
isolated eval directory. Direct-dream mode bypasses the scheduler and should be
used only to study the dream component after each extraction window.
