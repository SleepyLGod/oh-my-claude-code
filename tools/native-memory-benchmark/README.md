# Native LOCOMO Memory Benchmark

This is the runbook for running LOCOMO against native Claude Code memory components.
For the design rationale, see `docs/native-locomo-benchmark-design.zh.md`.

This benchmark is not the product prefetch path. It uses the same native memory
maintenance and retrieval components, but the benchmark provides the query from
`BenchmarkQuestion.question`.

## What this runs

- Maintenance: native component eval modes from `tools/native-memory-component-eval`.
- Retrieval: `findRelevantMemories(...)` followed by `readMemoriesForSurfacing(...)`.
- Optional answer mode: a benchmark-owned answer prompt/model answers from
  `question + retrieved_text`.

The benchmark does not call or modify `startRelevantMemoryPrefetch(...)`, native memory prompts,
`extractMemories`, `autoDream`, or scheduler logic.

## Prerequisites

- Run commands from the repository root.
- Set the provider API key used by your selected model, for example `DEEPSEEK_API_KEY`.
- Make sure the LOCOMO file exists at `.cache/native-memory-component-eval/locomo10.json`,
  or pass another path with `--locomo-path`.
- Outputs are written under `.memory-test/...`.

## Run a 30-message frozen-memory A/B

Use this flow when comparing `strict` and `lenient` retrieval. It builds native memory once,
then runs strict and lenient retrieval against the same frozen memory directory.

### 1. Build frozen memory

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)
BASE_DIR=".memory-test/native-locomo-benchmark-30-frozen-memory-$RUN_ID"

bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --messages-per-window 1 \
  --memory-mode extract-only \
  --selector-parse-mode strict \
  --trace \
  --output-dir "$BASE_DIR"
```

If the run stops because of a network or provider failure, run the same command again with
`--resume` and the same `--output-dir`:

```bash
bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --messages-per-window 1 \
  --memory-mode extract-only \
  --selector-parse-mode strict \
  --trace \
  --resume \
  --output-dir "$BASE_DIR"
```

### 2. Run strict retrieval and answer

```bash
STRICT_DIR=".memory-test/native-locomo-benchmark-30-strict-frozen-$RUN_ID"

bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --messages-per-window 1 \
  --existing-memory-dir "$BASE_DIR/native/final_memory/memory" \
  --selector-parse-mode strict \
  --trace \
  --answer \
  --output-dir "$STRICT_DIR"
```

Use the same command with `--resume --output-dir "$STRICT_DIR"` if retrieval or answer generation
stops partway through.

### 3. Run lenient retrieval and answer

```bash
LENIENT_DIR=".memory-test/native-locomo-benchmark-30-lenient-frozen-$RUN_ID"

bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --messages-per-window 1 \
  --existing-memory-dir "$BASE_DIR/native/final_memory/memory" \
  --selector-parse-mode lenient \
  --trace \
  --answer \
  --output-dir "$LENIENT_DIR"
```

Use the same command with `--resume --output-dir "$LENIENT_DIR"` if retrieval or answer generation
stops partway through.

`strict` preserves the native parser contract and is the baseline. `lenient` is a retrieval
hardening experiment for provider schema compatibility. Do not average or merge strict and
lenient results into one score.

## Optional 16-message smoke

Use this when you only want a smaller end-to-end check.

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)

bun run tools/native-memory-benchmark/run.ts \
  --locomo-path .cache/native-memory-component-eval/locomo10.json \
  --start-row 26 \
  --row-limit 16 \
  --question-limit 999 \
  --messages-per-window 1 \
  --memory-mode extract-only \
  --selector-parse-mode strict \
  --trace \
  --answer \
  --output-dir ".memory-test/native-locomo-benchmark-16-strict-answer-trace-$RUN_ID"
```

## Read the output

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
diagnostics/
  retrieval_anomalies.csv
metrics/
  questions.csv
  summary.csv
report/
  report.md
```

- Start with `report/report.md`.
- Use `metrics/summary.csv` for overall score, proxy hit rate, selector mode, and validity flags.
- Use `retrieval/results.csv` for per-question retrieved text, answer, and score.
- Use `diagnostics/retrieval_anomalies.csv` when retrieval is empty or suspicious.
- Use `native/final_memory/memory` to inspect the markdown memory produced by native maintenance.
- Use `input/run_config.json` to confirm `memory_mode`, `selector_parse_mode`,
  `selector_max_tokens`, `model`, and `input_rendering`.
- Use `checkpoint/manifest.json` to see how many windows or questions were completed before
  a resumable failure.

## Interpretation rules

- `behavioral_evidence_valid=false` means the run should not be used as a clean native memory
  behavior conclusion.
- `selector_schema_mismatch` means the selector produced a plausible filename, but not the
  strict schema expected by native retrieval.
- `selector_max_tokens_no_text` means the selector stopped before producing text output.
- `selector_llm_error` means the selector call itself failed.
- A clean empty retrieval means the selector returned an empty selection without one of the
  anomaly reasons above.
- A frozen-memory A/B run compares retrieval parser behavior only. It does not compare memory
  insertion quality, because both runs use the same `--existing-memory-dir`.
- `--resume` resumes from the last fully completed window or question. It does not resume a
  half-finished LLM call.

## Parity check

```bash
bun run tools/native-memory-benchmark/parity_check.ts
```

This checks LOCOMO normalization and deterministic metric formulas against the shared tiny fixture.
