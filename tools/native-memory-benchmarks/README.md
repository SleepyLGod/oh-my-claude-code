# Native Claude LongMemEval

This runner lives entirely in the Claude Code checkout. It reads the pinned
LongMemEval dataset, runs native extraction, per-session consolidation and
lenient native retrieval, then writes its own answer, judge, trace, metrics and
checkpoint artifacts. It does not import or launch agent-memory.

```bash
bun run tools/native-memory-benchmarks/longmemeval.ts \
  --dataset-path /path/to/longmemeval_s_cleaned.json \
  --output-dir .memory-test/longmemeval-native-30
```

The default selection is the fixed 30-case Claude pilot. For a single-case
acceptance run, pass `--case-ids 852ce960`. Resume only from a published
session boundary:

```bash
bun run tools/native-memory-benchmarks/longmemeval.ts \
  --dataset-path /path/to/longmemeval_s_cleaned.json \
  --output-dir .memory-test/longmemeval-native-30 \
  --resume
```

Use the fixed 8-event integration smoke before starting the paid pilot. The
first command runs one complete session, consolidates it once, publishes a
checkpoint, and stops before retrieval:

```bash
bun run tools/native-memory-benchmarks/longmemeval.ts \
  --dataset-path /path/to/longmemeval_s_cleaned.json \
  --output-dir .memory-test/longmemeval-native-smoke \
  --smoke \
  --stop-after-maintenance

bun run tools/native-memory-benchmarks/longmemeval.ts \
  --dataset-path /path/to/longmemeval_s_cleaned.json \
  --output-dir .memory-test/longmemeval-native-smoke \
  --smoke \
  --resume
```

The second command restores without repeating extraction or consolidation,
then performs lenient retrieval, answering, and grading. This prefix contains
the selected question's evidence but not the case's later distractors, so its
grade is an integration-smoke result rather than benchmark accuracy.

Native output is compared with agent-memory only after both runs finish. The
comparison checks dataset, normalized input, case selection, answer prompt,
judge prompt and model fingerprints before reporting scores or costs.
