# Native Claude Code Memory Audit

## 1. 结论

Claude Code 的 native memory 不是一个固定的 semantic operator pipeline。它更接近：

```text
filesystem-backed topic memory
+ prompt-governed write/update/delete
+ background extraction agent
+ periodic consolidation agent
+ query-time relevant-memory surfacing
```

这和 `agent-memory` 里现在尝试的 `sem_flat_map -> sem_groupby -> sem_agg -> sem_join -> sem_map` 不是同一种实现形态。native Claude Code 的去重和合并主要发生在“读已有 topic files 后直接编辑文件”的 agent 行为里，而不是一个 deterministic `join/map` 规则里。

因此，后续比较 baseline 时，不应该把 `full recompute view` 当成唯一正确答案。更合适的 native baseline 是：同一批输入在 Claude Code 的 memdir/extract/dream 机制下，最终产生了哪些 topic files、`MEMORY.md` index、以及 query-time recalled memories。

## 2. Memory Layer Taxonomy

### 2.1 `CLAUDE.md` instruction memory

入口：

- `src/utils/claudemd.ts`
- `src/context.ts`

作用：

- 加载 managed/user/project/local instructions。
- 支持 `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md`、`CLAUDE.local.md`。
- 通过 `getUserContext()` 注入 conversation context。

这层不是 durable topic memory。它是 instruction/context layer。

### 2.2 Persistent auto-memory / memdir

入口：

- `src/memdir/paths.ts`
- `src/memdir/memdir.ts`
- `src/memdir/memoryTypes.ts`
- `src/memdir/memoryScan.ts`

物理结构：

```text
<memoryBase>/projects/<sanitized-git-root>/memory/
  MEMORY.md
  <topic>.md
  ...
```

`MEMORY.md` 是 index，不是 memory body。topic files 才是 durable memory object。

topic file frontmatter 使用固定字段：

```markdown
---
name: ...
description: ...
type: user | feedback | project | reference
---
```

prompt 明确要求：

- 按 topic 组织，不按时间组织。
- 写入前检查是否已有 memory。
- 优先 update existing file，而不是 create duplicate。
- 发现 stale/wrong/outdated memory 时 update 或 remove。
- 用户要求 forget 时，找到并移除相关 entry。

### 2.3 Background extraction

入口：

- `src/services/extractMemories/extractMemories.ts`
- `src/services/extractMemories/prompts.ts`
- `src/query/stopHooks.ts`

行为：

- 每个完整 query loop 结束后触发，受 feature gate 和 auto-memory gate 控制。
- 用 forked agent 读取最近新增 messages。
- 预先扫描 existing memory manifest，避免 subagent 花 turn 去 `ls`。
- 如果主 agent 已经写了 memory，background extraction 会 skip。
- 只允许 read/search，以及在 memory dir 内 Edit/Write。

关键点：

这不是 structured extraction API。它是一个拥有文件工具权限的 subagent，prompt 要求它“update existing rather than creating duplicates”。

### 2.4 Query-time relevant memory recall

入口：

- `src/memdir/findRelevantMemories.ts`
- `src/utils/attachments.ts`
- `src/query.ts`

流程：

```text
user query
-> scan topic file headers
-> build filename/description/type manifest
-> sideQuery selects up to 5 files
-> read selected files with line/byte caps
-> inject as relevant_memories attachment
```

重要边界：

- 它不是 vector DB。
- 它不是 `MEMORY.md` tree descent。
- 它是 flat manifest scan + LLM shortlist。
- 每 turn 最多 surfacing 5 个 memory files。
- 已经 surface 或已经被 Read/Edit/Write 过的文件会去重。

### 2.5 Auto Dream / consolidation

入口：

- `src/services/autoDream/autoDream.ts`
- `src/services/autoDream/consolidationPrompt.ts`
- `src/services/autoDream/consolidationLock.ts`

触发条件：

- auto memory enabled。
- auto dream enabled。
- 非 remote mode。
- 非 KAIROS daily-log mode。
- 距上次 consolidation 足够久，默认 24 小时。
- 最近 touched sessions 数量达到阈值，默认 5。
- 成功获取 `.consolidate-lock`。

行为：

- forked agent 读取 memory directory。
- 读取 `MEMORY.md`。
- skim existing topic files。
- grep recent transcripts。
- merge new signal into existing topic files。
- 删除 contradicted/stale/superseded facts 或 index pointers。
- 维护 `MEMORY.md` 简洁。

这是 native Claude Code 最接近“全局 consolidation”的机制。它不是 operator rule，而是一个 tool-using maintenance agent。

### 2.6 SessionMemory

入口：

- `src/services/SessionMemory/sessionMemory.ts`
- `src/services/SessionMemory/prompts.ts`
- `src/services/SessionMemory/sessionMemoryUtils.ts`

作用：

- 当前 session continuity。
- 到达 token/tool-call 阈值后，用 forked agent 更新 session notes markdown。
- 主要服务 compaction/resume。

它不应该作为 persistent Claude memory baseline。它解决的是 session continuity，不是 cross-session durable topic memory。

### 2.7 Agent memory

入口：

- `src/tools/AgentTool/agentMemory.ts`
- `src/tools/AgentTool/agentMemorySnapshot.ts`

作用：

- agent-type scoped memory。
- 复用 `buildMemoryPrompt()` 这套 `MEMORY.md + topic files` contract。
- 路径按 `user/project/local` scope 分开。

这说明 Claude Code 的 memory prompt contract 被复用到 agent memory，但它仍然是 file-backed topic memory，不是 relational table。

## 3. Write / Update / Delete Lifecycle

### 3.1 Main agent direct write

主模型的 system prompt 里包含完整 memory mechanics。它可以直接使用 Write/Edit 工具写 memory files。

如果主模型已经写了 memory，`extractMemories` 会通过 `hasMemoryWritesSince()` 检测到，并跳过同一段消息的 background extraction。这避免主 agent 和 background agent 对同一 turn 做重复写入。

### 3.2 Background extraction write

如果主模型没有写 memory，turn-end extraction subagent 会处理最近新增 messages。

它拿到的 prompt 中包括 existing memory files manifest，并被明确要求：

```text
Check this list before writing — update an existing file rather than creating a duplicate.
```

所以 native 的 duplicate avoidance 不是靠 `sem_join` 返回一对一 match，而是靠 agent 在读 existing manifest/topic files 后决定 edit existing 还是 write new。

### 3.3 Forget / remove

prompt 明确说：

```text
If they ask you to forget something, find and remove the relevant entry.
```

这也是 tool behavior。它不是一个 `delete action` schema，也不是 table delta semantics。模型需要定位 topic file 和 `MEMORY.md` pointer，然后修改文件。

### 3.4 Periodic consolidation

`autoDream` 做的是后验整理：

- 读现有 index。
- 读已有 topic files。
- 查看 recent session signal。
- 合并 near-duplicates。
- 删除 stale/superseded pointers。

因此 native Claude Code 允许 write path 不是完美的。后续通过 dream consolidation 修正结构。

## 4. Duplicate / Fragmentation Implications

### 4.1 Native duplicate control 的关键不是 pairwise join

`agent-memory` 当前 duplicate 问题大概率来自：

```text
sem_join 允许一个 new topic 匹配多个 existing topics
-> sem_map 对每个 pair 独立 merge
-> 多个 pair 被 canonicalize 成同一个 name
-> view 没有 identity/upsert/global dedup
```

native Claude Code 没有这个固定 many-to-many `sem_join -> row-local sem_map` boundary。

native 的合并行为更像：

```text
read MEMORY.md
read relevant topic files
decide which existing file to update
edit that file
update index
```

这里的核心能力是 file-level stateful update，不是 pairwise join result。

### 4.2 Fragmentation 不是天然 fault

native Claude Code 也可能阶段性 fragmented：

- extraction 可能先写多个 topic files。
- dream 后续再合并。
- recall 只选最多 5 个 relevant files。

所以 `IVM vs full recompute` 的 fragmentation 差异不能直接等价为 correctness bug。对 streaming memory 来说，更合理的问题是：

- 和 native Claude Code 相比，最终 topic files 是否更有用？
- query-time recall 是否能找回需要的信息？
- duplicated names 是否导致用户可见混乱或 retrieval degradation？
- dream/consolidation 后是否能收敛？

### 4.3 Duplicate 是更明确的 engine/policy risk

重复 name 比 fragmentation 更值得优先 debug，因为它会破坏 topic identity：

- `MEMORY.md` index 可能出现多个相同或近似 title。
- retrieval 可能 surface 两个同名 memory。
- 后续 merge/update 不知道哪一个是 canonical target。

native Claude Code 通过 “read existing + edit existing file” 降低这个问题；`agent-memory` 目前需要在 join/rule/apply 层给出更清楚的 identity semantics，或者至少先用 audit 精确定位 first duplicate boundary。

## 5. Native Baseline Experiment Boundaries

后续 native 对比必须先区分三条路径：

1. **main-agent inline write**：主 Claude agent 在正常用户 turn 中带着 memory prompt 工作，可能直接 `Read` / `Write` / `Edit` memory files。
2. **`extractMemories` background extraction**：turn 结束后 forked extraction subagent 处理最近新增 messages；如果 main agent 已经写过 memory，这条路径会 skip。
3. **`autoDream` consolidation**：受时间、session 数量、lock 等 gate 控制的 periodic consolidation agent，不是每次 extract 后必然运行。

这三条路径共享 durable memory contract，但它们不是同一个 pipeline。实验报告必须明确当前观测的是哪一条路径。

### 5.1 CLI turn-level audit 的能力边界

`tools/native-memory-turn-eval` 当前是 **turn-level native CLI audit**。它的作用是：

- 用 isolated config dir 和 isolated memory base 运行 restored Claude Code CLI。
- 把 LOCOMO-derived row(s) 包成 native CLI user prompt。
- 观察 native CLI 主流程是否触发 memory write、是否生成 `MEMORY.md` 和 topic files。
- 做 native main-agent / CLI behavior smoke，尤其是 explicit remember write-path smoke。

它不能证明 `extractMemories` 或 `autoDream` 一定运行了。即使 `debug.log` 或 artifacts 中出现 memory file，也需要根据 debug signal 区分：

```text
main inline write
extractMemories started/finished
autoDream fired/completed
none
```

因此，CLI audit 的结论应写成 “native CLI behavior” 或 “one-row-per-turn native behavior”，不能写成 “extract-only baseline”。

### 5.2 LOCOMO replay limitations

LOCOMO 本身已经是 multi-turn dialogue transcript。直接把 LOCOMO row(s) 放进 `claude -p` / CLI prompt 会引入额外上下文：

```text
LOCOMO speaker/message
+ harness 包装出来的 user prompt
+ main agent 新生成的 assistant response
+ 可能发生的 main-agent inline memory write
+ 可能发生或不发生的 background extract
```

这不是纯粹的 transcript replay，也不是 pure `extractMemories` input。它适合观察 native CLI 在一个 synthetic user turn 中如何处理 memory，但不适合作为 `agent-memory` `sem_flat_map -> sem_groupby.sem_agg` 的严格 baseline。

如果目标是对齐 `agent-memory` 的 declarative Claude policy，更干净的 native 输入应该是 component-level harness：

```text
LOCOMO speaker/message rows
-> Claude Code internal Message[] / transcript context
-> executeExtractMemories(...)
-> memory markdown artifacts
```

这样 DeepSeek/LLM 仍会被用于 background extraction subagent，但不会先让 main assistant 额外生成一轮正常回答。

### 5.3 One-row-per-turn is not one-message extractor testing

`--turn-size 1` 仍然有价值，但命名必须准确。它表示：

```text
one LOCOMO row wrapped as one native CLI user turn
```

它不等于：

```text
native extractMemories applied to exactly one raw message
```

因为 CLI 主流程仍会创建 user prompt、assistant response、tool context 和 stop-hook context。报告中应称它为 **one-row-per-turn native behavior**。只有当 trace/debug 证明 `extractMemories` 真正 started/finished，并且 main inline write 没有抢先写 memory，才能把该 turn 的 output 归因给 background extraction。

### 5.4 Native extract-only baseline

如果要和 `agent-memory` 的 extraction/consolidation query 做更直接对比，后续应新增 extract-only component harness，而不是继续扩展 CLI `-p` smoke：

```text
LOCOMO transcript window
-> construct native Message[] / REPLHookContext-like input
-> executeExtractMemories(...)
-> collect memory files and MEMORY.md
```

这个 harness 的实验对象是 native background extractor，不是 main conversational agent。它更接近：

```text
sem_flat_map(recent transcript chunk -> zero_or_more memory updates)
```

但仍需标注：native extractor 是 tool-using subagent，会 read/edit/write files；它不是 structured JSON extraction API。

## 6. Native Extract / Dream Experiment Options

native baseline 应分清 extract、scheduler-gated autoDream、direct dream component 三类证据。它们回答的问题不同，不能混为一个实验。

### A. extract-only + natural autoDream gate

流程：

```text
LOCOMO transcript windows
-> executeExtractMemories(...) for each window
-> call executeAutoDream(...) once after extraction
-> let native time/session/lock gate decide whether dream runs
```

这个模式不 seed `.consolidate-lock`，不生成 synthetic sessions，也不绕过 native gate。它最贴近 native lifecycle，适合回答：

```text
按 native 自己的 scheduler 条件，这次会不会 dream？
```

已验证状态：12/16/20 message 的 natural autoDream gate 都没有 fire，debug reason 都是 `0 sessions since last consolidation, need 5`。这不是失败，而是 native scheduler 在 isolated component eval 中的真实 skip 行为。

### B. extract-only + seeded autoDream gate

流程：

```text
LOCOMO transcript windows
-> executeExtractMemories(...) for each window
-> after all windows finish, seed time/session gate once
-> executeAutoDream(...) once
-> collect before/after dream snapshots
```

seeded 模式不是“每个 message extract 后 dream 一次”。它是在一次实验的所有 extract windows 结束后，只构造一次 native scheduler 所需的时间/session 证据，然后调用 native `executeAutoDream(...)` 一次。

这个模式仍运行 native `autoDream` 本体和 prompt；差别只是实验上构造 scheduler 条件，避免小样本永远不 dream。它适合回答：

```text
如果 native autoDream 的 scheduler 条件满足，它会怎么整理 memory？
```

已验证状态：12/16/20 message 的 seeded autoDream 都 fired/completed。12 message 是 in-place rewrite；16 message 是 no-op；20 message 新增了 Melanie supportive friend topic。报告必须标注它是 seeded gate，不是 natural schedule。

### C. extract-only + direct dream each-window

流程：

```text
for each LOCOMO transcript window:
  executeExtractMemories(...)
  directly run dream/consolidation component once
```

这个模式不调用 native `executeAutoDream(...)`，不测试 native scheduler、lock、time/session gates，也不应写成 autoDream fired。它直接使用 native dream prompt/component after each extraction window，是 component diagnostic evidence, not native scheduler evidence。

它更贴近 `agent-memory` 的 streaming update cadence：

```text
memory.add(row/window)
-> update maintained memory state
```

但它仍不是 native lifecycle baseline。它适合研究：

```text
如果 extract 后立即 consolidation，dream component 会怎么改写 memory？
```

已验证状态：C 已跑 3-message smoke，3 次 direct dream runs 全部成功，最终 2 个 topic，未出现 duplicate。12/16/20 的 direct dream each-window 尚未运行；因为该模式是 `N extract + N dream`，成本和耗时明显高于 A/B。

### Recommended next baseline

如果目标是和 `agent-memory` 当前 `ClaudeMemory` 比较，建议顺序是：

1. 保留 CLI turn-level audit，只作为 native CLI/main-agent behavior smoke。
2. 使用 extract-only component harness，证明 native background extraction 对 LOCOMO transcript window 的输出。
3. 使用 natural autoDream gate 记录 native lifecycle 是否自然 fire。
4. 使用 seeded autoDream gate 观察 native autoDream 本体在 gate 满足时如何改写 memory。
5. 只在需要研究“每次 extract 后立即 consolidation”时使用 direct dream each-window，并明确它是 component diagnostic，不是 native scheduler baseline。
6. 再比较：
   - `agent-memory` topics/catalog；
   - native extract-only memory；
   - native after seeded autoDream memory；
   - direct dream each-window component behavior；
   - query-time recalled native memories。

## 7. What This Means For `agent-memory`

### 7.1 Debug trace 应该看 operator boundary，但不要假设 full view 是真值

对 `agent-memory` 来说，当前 audit 需要回答：

```text
duplicate name 首次出现在哪里？
```

优先 trace：

- `sem_flat_map` candidate names。
- `sem_groupby` group assignment。
- `sem_agg` aggregated topic names。
- `sem_join` pairwise match cardinality。
- merge `sem_map` output names。

但 diagnosis wording 应该是 neutral observation，而不是默认说 fragmentation 是 bad。native Claude Code 本身也可能先 fragmented，再由 dream 后续整理。

### 7.2 如果要贴近 native，重点不是 prompt 一句两句

native 的优势来自 stateful file update：

- 它能读多个 existing files。
- 它能直接 edit canonical target。
- 它能维护 `MEMORY.md` index。
- 它有 periodic dream cleanup。

如果 `agent-memory` 只保持 row-local `sem_map`，即使 prompt 更强，也很难完全复刻 native 的 global consolidation 行为。

### 7.3 后续可能的研究方向

更贴近 native 的设计可能需要至少一个：

- join 后的一对一 matching / assignment 约束。
- identity-aware apply/upsert。
- merge action schema：create / update / keep / delete / skip。
- view-level consolidation operator，允许读取当前 view 的多个 rows 后产生 canonical next view。
- periodic dream-like maintenance query，而不是只靠 per-add IVM。

这些不是简单工程修补；它们是 memory semantics 的研究边界。

## 8. Source Map

主要源码入口：

- `src/memdir/paths.ts`: auto memory enable/path/entrypoint。
- `src/memdir/memdir.ts`: memory prompt、`MEMORY.md` contract、daily-log KAIROS branch。
- `src/memdir/memoryTypes.ts`: durable memory taxonomy 和 what-not-to-save。
- `src/memdir/memoryScan.ts`: topic header scanning。
- `src/memdir/findRelevantMemories.ts`: query-time memory selection。
- `src/utils/attachments.ts`: relevant memory prefetch、surfacing、dedupe。
- `src/query.ts`: query loop 中启动和消费 memory prefetch。
- `src/services/extractMemories/extractMemories.ts`: turn-end background extraction。
- `src/services/extractMemories/prompts.ts`: extraction prompt。
- `src/services/autoDream/autoDream.ts`: periodic consolidation orchestration。
- `src/services/autoDream/consolidationPrompt.ts`: dream prompt。
- `src/services/autoDream/consolidationLock.ts`: consolidation lock and scheduling state。
- `src/services/SessionMemory/*`: session continuity memory，不是 persistent baseline。
- `src/tools/AgentTool/agentMemory.ts`: per-agent persistent memory。
