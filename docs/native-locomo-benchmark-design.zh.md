# Native LOCOMO Benchmark Design

本文记录 native Claude Code memory 如何接入 LOCOMO benchmark。目标是让 native
Claude Code memory 和 `agent-memory` 在同一份 benchmark 输入、同一套 evaluator、同一套
核心 metrics 下比较，同时不修改 native memory 产品逻辑。

本文是 implementation decision record，不是 benchmark 结果报告。实际运行命令和结果解读入口见
`tools/native-memory-benchmark/README.md`。

## 1. Goal and Non-Goals

目标：

- 用同一份 LOCOMO events / questions / evaluator 对比 native Claude Code memory 和
  `agent-memory`。
- 保持 benchmark 数据层、memory maintenance、retrieval、answer generation、scoring
  的职责边界清楚。
- 让 native runner 输出和 `agent-memory` LOCOMO benchmark 同构的 artifacts，方便后续
  直接比较。

非目标：

- 不把 native Claude Code 当作 benchmark gold answer。
- 不把 full recompute 当作 correctness oracle。
- 不修改 native memory prompt、`extractMemories`、`autoDream` scheduler、
  `startRelevantMemoryPrefetch(...)` 产品路径。
- 不把 `agent-memory` 的 semantic operator trace diagnostics 迁移成 shared metric。
- 不复制 `agent-memory` Python runtime 或 LOTUS execution 逻辑。

核心原则：benchmark 可以替换 query source，但不能替换 native retrieval pipeline。
也就是说，benchmark query 来自 `BenchmarkQuestion.question`；真正的 native retrieval
仍然必须走 native 的 memory scan、manifest selector、file read / truncation 逻辑。

## 2. Hard Boundaries

这些边界是实现时的硬约束：

- Benchmark 可以把 `BenchmarkQuestion.question` 注入为 retrieval query。
- Benchmark 不得修改 `startRelevantMemoryPrefetch(...)` 产品 hook。
- Benchmark retrieval 必须标注为 component retrieval，不能声称是完整产品 prefetch。
- Answer mode 必须使用 benchmark-owned shared answerer；native 和 `agent-memory` 应使用同一个 answer prompt / model。
- Invalid LLM run 不能作为 native memory behavior evidence，必须进入 summary 并从 behavioral conclusion 中排除。
- Benchmark 可以记录 retrieval selector anomaly，但不能用 trace 结果补救 retrieval。不能为了 benchmark 修改 `readMemoriesForSurfacing(...)` 或 `startRelevantMemoryPrefetch(...)`。如果后续要兼容 array output、裸文件名、调整 selector token budget、或增强 native parser，必须作为显式 native retrieval hardening 选项记录，不能伪装成 benchmark 修复。


## 3. Benchmark Contract

native benchmark 层应对齐 `agent-memory` benchmark 的 contract，而不是复用或导入
`agent-memory` 的 Python runtime。

需要对齐 / 转写的内容：

- `BenchmarkEvent`
- `BenchmarkQuestion`
- LOCOMO JSON normalization
- event selection / row limit
- eligible question filter
- retrieval diagnostic metrics
- answer-mode metrics
- LOCOMO category-specific answer score
- summary CSV schema
- tiny fixture expected values

推荐的 normalized event schema：

```text
BenchmarkEvent
  benchmark: "locomo"
  sample_id
  event_id
  speaker
  text
  session_id
  timestamp
  metadata
```

推荐的 normalized question schema：

```text
BenchmarkQuestion
  benchmark: "locomo"
  sample_id
  question_id
  question
  gold_answer
  evidence_event_ids
  category
  metadata
```

Eligibility rule：

```text
question is eligible
  iff every non-empty evidence_event_id is present in ingested BenchmarkEvent ids
```

第一版应只评估 eligible questions。没有 evidence 或 evidence 未 ingest 的问题可以在后续
增加 eligibility report，但不应该混入正式 score。

Canonical input artifacts：

```text
input/events.jsonl
input/questions.jsonl
input/run_config.json
```

Native runner 应只读取这些 normalized artifacts，不应再次独立解释 LOCOMO row slicing。
`run_config.json` 至少记录：

```text
sample_index
start_row
row_limit
question_limit
maintenance_mode
answer_mode
model
provider
```

这样 `agent-memory` 和 native Claude Code 使用的是同一份 benchmark slice，而不是两套
各自解释后的 LOCOMO 输入。

## 4. Native Runner Architecture

native benchmark 层应隔离在新目录中，例如：

```text
tools/native-memory-benchmark/
  types.ts
  locomo.ts
  metrics.ts
  run.ts
  README.md
```

它负责 benchmark orchestration，不负责改 native memory 本体。

### Maintenance 阶段

maintenance 阶段复用现有 native component eval 能力：

```text
BenchmarkEvent JSONL / normalized events
-> synthetic native message windows
-> executeExtractMemories(...)
-> optional natural autoDream
-> optional seeded autoDream
-> optional direct dream each-window
-> native final memory markdown
```

支持的 native maintenance modes 应明确区分：

```text
extract-only
natural autoDream
seeded autoDream
direct dream each-window
```

这些模式回答的问题不同，不应混成一个 “native Claude baseline”。

### Component Retrieval 阶段

retrieval 阶段新增 explicit benchmark query harness。本文把它称为 component retrieval：它复用 native retrieval 的核心 component，但不是完整产品 prefetch。

例如：

```text
tools/native-memory-benchmark/query.ts
```

或作为 `run.ts` 的内部阶段实现。它的输入是：

```text
questions.jsonl
native final memory directory
```

它必须复用 native retrieval lower-level pipeline：

```text
BenchmarkQuestion.question
-> findRelevantMemories(question, memoryDir, signal, recentTools, alreadySurfaced)
-> native sideQuery selector prompt
-> scanMemoryFiles / formatMemoryManifest
-> selected filenames
-> readMemoriesForSurfacing(...)
-> retrieved memory content
```

约束：

- 不调用 `startRelevantMemoryPrefetch(...)` 作为 benchmark 入口。
- 不修改 `startRelevantMemoryPrefetch(...)`。
- 不自己写新的 memory selector prompt。
- 不用 benchmark 自己的 semantic top-k 替代 native selector。
- 不复制 native read / truncation 逻辑。
- 如果需要 helper，只允许加无行为变化的 wrapper / re-export。

原因是：`startRelevantMemoryPrefetch(...)` 是产品 hook，它从当前 user message 自动取 query，
并且包含产品级 prefetch timing、session already-surfaced state、attachment scheduling 等上下文。
Benchmark 需要显式使用 `BenchmarkQuestion.question`，但 retrieval 内部的 scan、manifest selector、
file surfacing 行为仍应保持 native。

`tools/native-memory-benchmark/prefetch_probe.ts` 是另一个独立诊断工具，不是 benchmark
runner 的一部分。它用已有 memory dir 和一个 query 调 native 产品路径
`startRelevantMemoryPrefetch(...)`，再调产品消费侧的
`filterDuplicateMemoryAttachments(...)`，用于确认完整产品 prefetch 是否也会产生同类空召回。
Probe 结果只能帮助解释原因，不进入 scoring，不替代 component retrieval，也不能用来补救
`retrieval/results.csv`。

### Selector Token Budget and Parser Compatibility

这里有两个问题要分开看。

第一个是 `selector_max_tokens`。Native selector 是一个很短的文件选择任务，但在
DeepSeek v4-flash 这类会输出 `thinking` block 的 backend 上，过小的 `max_tokens` 会先被
thinking 用完，最后没有 text JSON。真实 run 里，`max_tokens=256` 会表现为
`selector_max_tokens_no_text`：memory 里可能有相关内容，但 selector 没有产出可解析结果。
这不是 LOCOMO 数据问题，也不是 extract 没写 memory，而是 selector 调用没有完成。

当前默认配置是：

```text
selector_max_tokens = 8192
selector_parse_mode = strict
```

`8192` 只解决 selector 可能没有足够 token 输出最终 text JSON 的问题。它不改变 selector
看到的输入，也不让 selector 读取 topic 正文。`strict` 表示 parser 仍然只接受
`{"selected_memories":["file.md"]}`，不接受 `["file.md"]` 或裸 filename。

解读 artifact 时必须看当次 trace request 里的真实 `max_tokens`。旧 run 里如果看到
`max_tokens=256`，只能说明那次 run 是旧配置，不能说明当前源码仍然是 256。如果在当前
源码下重新跑仍然看到 256，才应该按 runner path / checkout / import cache bug 排查。

第二个是 parser compatibility。Native `findRelevantMemories(...)` 期望 selector 返回：

```json
{"selected_memories":["file.md"]}
```

但 DeepSeek / Anthropic-compatible provider 可能返回：

```json
["file.md"]
```

这种输出语义上可能选对了文件，但 schema 不符合 native parser contract。Native 当前会把
parse/schema failure catch 成 `[]`，所以 benchmark 不能把这种结果直接解释成 clean empty
retrieval。Benchmark 只能记录 anomaly，不能用 trace 推断结果去补读 memory，否则会改变
native retrieval score。

DeepSeek v4-flash 还可能返回裸文件名：

```text
file.md
```

这同样表示 selector 选中了文件，但当前 strict parser 不接受。

因此 selector parser 应明确分成两种模式：

```text
strict
  只接受 {"selected_memories":["file.md"]}。
  这是当前 native product contract。

lenient
  在 native retrieval component 内部额外接受 ["file.md"]、fenced JSON、裸文件名、多行
  filename、以及 [user] file.md / bullet list。
  这是 retrieval hardening experiment，不是 benchmark runner 自己补救 retrieval。
```

Benchmark runner 不能在 trace 里看到 `file.md` 后自己读文件。这样会绕过
`findRelevantMemories(...)`，污染 retrieval score。如果要跑 lenient 模式，兼容逻辑必须在
native retrieval component 里发生，并且只能通过显式参数开启。report / `run_config.json`
必须记录：

```text
selector_parse_mode = strict | lenient
```

第一版 `lenient` 只用于 retrieval 阶段，不传给 `tools/native-memory-component-eval`，
因此不会影响 extract / memory insertion。Strict 和 lenient 的结果不能混成一个 benchmark
结论；如果 lenient 后 retrieval 成功，只说明 provider/schema 适配是主要瓶颈，不证明
memory insertion 本身更好或更差。

`--answer` 不需要单独改。Answer 阶段只使用 retrieval 阶段返回的 `retrieved_text`。如果
strict 模式 retrieval 为空，answer 没上下文；如果 lenient 模式让 retrieval 取回了 memory，
answer 会自然使用这些 memory。

还有第三类问题是 clean empty / manifest-level miss。Native selector 的 shortlist prompt
只包含 filename、type、mtime 和 frontmatter description，不读取 topic 正文。如果 description
太粗，selector 可能会主动返回空选择，例如 `{"selected_memories":[]}`。这属于 retrieval
阶段的 manifest-level 行为，不是 memory insertion 失败，也不是 benchmark runner 丢结果。

第一版固定读取的 memory dir 是：

```text
native/final_memory/memory
```

该目录应包含 `MEMORY.md` 和 topic markdown files。第一版只评 auto/user memory scope，
不做 agent-specific memory routing。

为了严格比较 `selector_parse_mode=strict` 和 `selector_parse_mode=lenient`，benchmark 还需要
支持 frozen-memory retrieval：传入一份已有的 native `final_memory/memory`，跳过 extract /
autoDream / direct dream maintenance，只重跑 retrieval 和 optional answer。该模式应在
`run_config.json`、summary 和 report 中标记为：

```text
maintenance_mode = external-memory
existing_memory_dir = <absolute path>
```

这不是新的 native maintenance mode；它只是为了让 strict / lenient 两个 retrieval run 使用
完全相同的 memory artifact，避免 extraction nondeterminism 污染 parser A/B 结论。

## 5. What To Copy vs Not Copy

应 copy / port 的是 benchmark contract：

- types
- LOCOMO adapter / normalization
- eligibility filter
- metric formulas
- CSV schema
- tiny fixture expected values

不应 copy / port 的内容：

- `agent-memory` 的 `diagnostics.py`
- `agent-memory` semantic operator trace parser
- LOTUS usage counters
- `ClaudeMemory` table row-count assumptions
- `ClaudeMemory` policy-specific diagnosis fields
- Python answer-generation implementation本身

`agent-memory` 的 `diagnostics.py` 是基于 semantic operator trace 的调试工具，例如
`sem_flat_map`、`sem_join`、`sem_map` 的 row-flow diagnosis。native Claude Code 没有这些
operator 边界，把它迁移成 shared evaluator 会污染比较。Native 侧可以保留自己的 trace /
debugger，但它应作为 diagnosis artifact，而不是 shared benchmark metric。

## 6. Fair Comparison

核心定义：Fairness is benchmark-contract parity, not implementation parity.

公平比较来自：

- same LOCOMO sample
- same row-limit / start-row
- same normalized events
- same eligible questions
- same gold answers
- same answer scorer
- same core output schema

公平比较不要求：

- same memory maintenance algorithm
- same prompt
- same storage format
- same trace schema
- same token accounting implementation
- same internal diagnosis artifacts

如果开启 answer mode，native 和 `agent-memory` 必须使用同一个 benchmark-owned answer prompt / model，
输入统一为 `question + retrieved_text`。不能让 native main agent 自己回答，也不能让
`agent-memory` 使用另一套回答 prompt。

Answerer 配置不应写入 per-question evaluator outputs，例如 `retrieval/results.csv` 或
`metrics/questions.csv`。Debug / audit 阶段可以可选写入 run-level metadata，例如
`metadata/answerer.json` 或 `input/run_config.json`：

```text
answer_model
answer_prompt_id
answer_prompt_hash
temperature
max_tokens
```

这些字段只用于人工审计和复现实验，不参与 scoring，也不是 shared metric。Benchmark
稳定后可以删除这些 metadata，或只保留 prompt hash。

进入 evaluator 前，两边 retrieval result 应统一成类似结构：

```text
question_id
question
gold_answer
category
retrieved_text
retrieved_row_or_file_count
generated_answer
```

`agent-memory` 可以从 retrieved DataFrame 拼出 `retrieved_text`。Native 可以从 selected
memory files 的 header/content 拼出 `retrieved_text`。Evaluator 不应该关心这些内容来自
DataFrame 还是 markdown file。

## 7. Metrics

第一版应对齐这些 retrieval diagnostic metrics：

```text
retrieved_row_or_file_count
retrieved_text
proxy_answer_string_hit
retrieval_latency_sec
```

Input rendering must also be recorded in `run_config.json` and summary artifacts:

```text
input_rendering = message_with_event_context
bookkeeping_metadata_excluded_from_semantic_input = true
```

Here, bookkeeping metadata means IDs used for tracing, such as `event_id` / `turn_id`.
Those identifiers may stay in input artifacts, but they should not be rendered into the
model-visible memory extraction prompt for this benchmark contract.

Answer mode 应对齐：

```text
generated_answer
answer_exact_match
answer_contains_gold
answer_f1
locomo_answer_score
```

LOCOMO answer score 应按当前 `agent-memory` v1 公式转写：

```text
category 1:
  comma-separated multi-answer partial F1

category 2 / 4:
  Porter-stemmed token F1

category 3:
  gold answer 先取 `;` 前半段，再算 Porter-stemmed token F1

category 5:
  no-information / not-mentioned 判断
```

这些仍然只能叫 official-compatible answer score，不能叫完整 official LOCOMO score，
因为没有跑官方 `evaluate_qa.py` 的完整 workflow，也没有 strict evidence / context recall。

Summary 必须包含：

```text
maintenance_mode
retrieval_mode = component_retrieval
selector_parse_mode
invalid_llm_run_count
invalid_llm_run_reasons
retrieval_anomaly_count
selector_schema_mismatch_count
selector_no_text_output_count
selector_llm_error_count
selector_max_tokens_no_text_count
selector_invalid_json_count
selector_selected_but_rejected_count
behavioral_evidence_valid
```

如果 invalid LLM run 数量大于 0，report 必须写清楚该 run 不能作为完整 native memory
behavior evidence。

如果 `retrieval_anomaly_count > 0`，`behavioral_evidence_valid` 也必须是 `false`。这里的
anomaly 不是 memory quality score，而是说明 retrieval component 没有给出可解释的干净结果。

空 retrieval 至少要区分三种情况：

- selector 真的返回了空选择，例如 `{"selected_memories":[]}`。
- selector 选了文件，但返回形状不符合 native parser，例如 `["file.md"]`，应标记为 `selector_schema_mismatch`。
- selector LLM call 失败，应标记为 `selector_llm_error`。
- selector 因 `max_tokens` 停止且没有 text output，应标记为 `selector_max_tokens_no_text`。
- selector 没有 text output，或输出不是可解析 JSON，应分别标记为 `selector_no_text_output` / `selector_invalid_json`。

## 8. Output Artifacts

推荐输出：

```text
.memory-test/native-locomo-benchmark/<run-id>/
  input/
    events.csv
    questions.csv
    events.jsonl
    questions.jsonl
    run_config.json
  native/
    final_memory/
      memory/
    debug.log
    trace/
  retrieval/
    results.csv
  metrics/
    questions.csv
    summary.csv
  metadata/
    answerer.json            # optional debug / audit metadata, not evaluator output
  report/
    report.md
```

`report.md` 只做摘要，不作为 evaluator source of truth。真正可比较的是 CSV。

`retrieval/results.csv` 至少包含：

```text
question_id
question
gold_answer
category
evidence_event_ids
retrieved_row_or_file_count
retrieved_text
proxy_answer_string_hit
retrieval_anomaly_reason
selector_selected_from_trace
selector_raw_text
selector_trace_id
generated_answer
answer_exact_match
answer_contains_gold
answer_f1
locomo_answer_score
retrieval_latency_sec
answer_latency_sec
```

未开启 answer mode 时，不应写入 answer metrics，并且 summary 应明确：

```text
run_mode = retrieval_only_diagnostic
qa_accuracy_available = false
retrieval_mode = component_retrieval
```

开启 answer mode 时：

```text
run_mode = answer
qa_accuracy_available = true
official_score_available = false
strict_evidence_recall_available = false
retrieval_mode = component_retrieval
```

## 9. Implementation Sketch

推荐 CLI：

```bash
bun run tools/native-memory-benchmark/run.ts \
  --locomo-path <locomo10.json> \
  --sample-index 0 \
  --start-row 26 \
  --row-limit 12 \
  --question-limit 5 \
  --memory-mode extract-only \
  --output-dir .memory-test/native-locomo-benchmark/latest
```

可选 native modes：

```text
--memory-mode extract-only
--memory-mode natural-autodream
--memory-mode seeded-autodream
--memory-mode direct-dream-each-window
```

Frozen-memory retrieval A/B：

```bash
bun run tools/native-memory-benchmark/run.ts \
  --locomo-path <locomo10.json> \
  --start-row 26 \
  --row-limit 30 \
  --question-limit 999 \
  --existing-memory-dir <previous-run>/native/final_memory/memory \
  --selector-parse-mode strict \
  --trace \
  --answer \
  --output-dir .memory-test/native-locomo-benchmark/frozen-strict
```

推荐内部阶段：

```text
1. Load LOCOMO and normalize events/questions.
2. Write input/events.csv, input/questions.csv, input/events.jsonl, input/questions.jsonl, and input/run_config.json.
3. Run native maintenance mode over selected events, unless `--existing-memory-dir` is provided.
4. Run native retrieval for eligible questions using BenchmarkQuestion.question.
5. Optionally generate answers from retrieved context.
6. Compute shared metrics.
7. Write retrieval/results.csv, metrics/questions.csv, metrics/summary.csv, report.md.
```

如果复用现有 `tools/native-memory-component-eval/run.ts`，可以先增加 `--events-jsonl` 支持，
让 native memory maintenance 吃 normalized events，而不是自己重新 parse LOCOMO row range。

## 10. Parity Tests

native repo 应增加 parity tests，防止 TS evaluator 和 `agent-memory` Python evaluator 漂移。
TS metric port 必须用 golden fixture 锁定 Python / TS 一致性。

测试内容：

- LOCOMO tiny fixture normalization。
- Empty text turn 被跳过。
- Evidence eligibility filter。
- Category 1 multi-answer score。
- Category 2 / 4 Porter-stemmed F1。
- Category 3 gold answer `;` 前半段处理。
- Category 5 no-information 判断。
- Empty retrieval 不产生 answer score。
- Empty generated answer 计为 answer-mode 0 分。
- Summary aggregation。
- Invalid LLM run summary。

建议后续把 tiny fixture expected outputs 固化为 golden CSV。native 和 `agent-memory` 都对齐
同一份 golden CSV，比人工口头确认更可靠。

## 11. Boundaries

本设计不要求 native 和 `agent-memory` 在内部行为上相同。它只要求 benchmark 输入、
evaluator 和输出指标同构。

Native Claude Code 是 comparison baseline，不是 gold answer。LOCOMO gold / evaluator 才是
benchmark ground truth。
