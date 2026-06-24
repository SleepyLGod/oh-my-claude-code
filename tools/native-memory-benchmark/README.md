# Native LOCOMO Memory Benchmark

This tool runs an isolated LOCOMO benchmark against native Claude Code memory components.
It is a component benchmark, not the product prefetch path.

## What It Measures

- Maintenance: native component eval modes from `tools/native-memory-component-eval`.
- Retrieval: `BenchmarkQuestion.question` is injected into native component retrieval:
  `findRelevantMemories(...)` followed by `readMemoriesForSurfacing(...)`.
- Optional answer mode: a benchmark-owned answer prompt/model answers from `question + retrieved_text`.

The benchmark does not call or modify `startRelevantMemoryPrefetch(...)`, native memory prompts,
`extractMemories`, `autoDream`, or scheduler logic.

Retrieval defaults to `--selector-parse-mode strict`, which preserves the native parser contract.
`--selector-parse-mode lenient` is an explicit retrieval hardening experiment for provider schema
compatibility; it is not the native baseline and should be reported separately.

Use `--existing-memory-dir <path>` for frozen-memory retrieval A/B runs. In that mode the tool
skips component maintenance and runs retrieval/answer directly against the provided native
`final_memory/memory` directory, so strict and lenient parser runs can share exactly the same memory.

## Example

```bash
bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 12 \
  --question-limit 5 \
  --memory-mode direct-dream-each-window \
  --selector-parse-mode strict \
  --output-dir .memory-test/native-locomo-benchmark-12-direct
```

Frozen-memory strict/lenient comparison:

```bash
bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --existing-memory-dir .memory-test/<maintenance-run>/native/final_memory/memory \
  --selector-parse-mode strict \
  --trace \
  --answer \
  --output-dir .memory-test/native-locomo-benchmark-30-frozen-strict
```

## Artifacts

```text
input/
  events.csv
  events.jsonl
  questions.csv
  questions.jsonl
  run_config.json
native/
  component_eval/
  final_memory/
retrieval/
  results.csv
metrics/
  questions.csv
  summary.csv
report/
  report.md
```

`native/final_memory/memory` is the fixed first-version memory directory used for retrieval.
Invalid component LLM runs are carried into `metrics/summary.csv`; runs with invalid LLM fingerprints
should not be treated as native memory behavior evidence.

## Parity Check

```bash
bun run tools/native-memory-benchmark/parity_check.ts
```

This checks the LOCOMO normalization and deterministic metric formulas against the shared tiny fixture.
