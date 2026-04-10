I am still thinking…

## **Memory-Related Workflow of Claude Code**

a brief review of the implementation only (kinda engineering angle):
**One sentence: light write path, heavy background maintenance, new index design**

### **Insertion**

- Claude Code’s memory is not only the raw msg transcript (JSON files), but also typically topic-level md files.
- Memory insertion is semantically light at write time. The system does not enforce a strict path for structural updates.
- New memory can be created in two ways: **\[details, you can skip\]**
  - explicit writes by the main agent
  - background extraction from recent conversation turns by a forked sub-agent

In practice, insertion is “topic-oriented semantic summary into files,” not record-level insertion into a formal data structure.

### **Maintenance**

- Maintenance is **heavier** than insertion and is largely deferred.
- The system relies on soft semantic rules such as: **\[details, you can skip\]**
  - update existing memory instead of duplicating it
  - remove or revise stale or incorrect memory
  - organize memory by topic rather than chronology
- Most real maintenance work is pushed into background processes:
  - extraction passes
  - periodic consolidation / pruning
- This makes maintenance partly optional and gate-dependent rather than structurally mandatory.

So the current design is best described as: light write path, heavier deferred maintenance path, and maintenance is not always-on in the strongest sense.

### **Retrieval**

- Retrieval is not a formal index traversal.
- There are two distinct retrieval layers:
  - an LLM-facing directory page (MEMORY.md) that acts as a semantic table of contents
  - a runtime retrieval path that scans memory files, reads lightweight metadata, and uses LLM to select a small shortlist of relevant files
- The runtime path is therefore:
  - metadata scan (directory file & metadata of all the files)
  - model-based shortlist selection
  - file loading as context

More like a flat semantic shortlist mechanism, not a canonical hierarchical retrieval path.

---

## My View of Claude Code’s current memory design

may not be limitations, maybe engineering trade-offs

- **The memory unit is coarse, with weak formal semantics**
  - A “memory” is usually a topic file, not an atomic fact /  entity  / etc.
  - Practical ofc, but will it weaken precision?
  - No schema, no strict canonical memory object model.
  - Relies only on LLM judgment for topic formation/updating/reuse.
- **Mem operations are not formal**
  - Insertion and maintenance are not governed by hard structural invariants.
  - Update and invalidation are weakly specified:
    - no strong fact-level invalidation model, no explicit temporal validity model.
    - Contradictions are handled heuristically and often retrospectively.
- **Retrieval is flat rather than structurally routed.**
  - No canonical path in runtime recall
  - may limit formal guarantees around correctness, reuse, and caching?
- **No formal treatment of multi-membership.**
  - A memory may naturally belong to multiple conceptual clusters.
  - The current design does not make that explicit.
- **Maintenance is load-bearing but not foundationally guaranteed.**
  - Background consolidation does important semantic cleanup.
  - But because it is deferred and gated, the system can remain in a partially messy state.
- **Display structure and machine retrieval structure are not the same thing.**
  - MEMORY.md is useful as a semantic directory for the model and the human.But it is not the true machine index.
  - This creates conceptual ambiguity about what the “index” actually is.

---

## Idea Statement

### Fundamental intent

Turn the raw conversation and work process into a reusable, organizable, queryable, and maintainable multi-layer memory structure, whose behavior is controlled by an explicit policy rather than scattered across prompts and ad-hoc background logic.

That intent decomposes into four things:

1. **Capture** — new input must first be stably recorded; otherwise later memory construction has no reliable substrate.
2. **Structure** — raw input is not reusable memory; the system must organize it into higher-level semantic form.
3. **Control** — the organization scheme must not be hard-coded; users or system designers must be able to specify structure and update strategy through a policy file.
4. **Lifecycle** — memory is not write-once; it needs update, merge, rewrite, invalidation, and reorganization over time.

The core idea is to turn the Claude-style local memory behavior into a real library with a small developer-facing API and a more explicit runtime contract. The intent is not to build a general agent framework or a textbook data structure first. The intent is to package a local memory runtime that can be reused, inspected, and gradually extended across different memory styles.

### Why move from mixed-prompt mode to policy-driven mode

Claude Code today already contains many policy-like rules, but they live in three separate places that never see each other:

| Source | Examples | Problem |
|---|---|---|
| Hard-coded runtime logic | `MAX_ENTRYPOINT_LINES = 200`; extractor skip conditions; autoDream trigger thresholds (24 h + 5 sessions) | Invisible and non-adjustable to users; changing behavior requires changing code |
| Prompt-embedded semantic rules | “organize by topic not chronology”; four-type taxonomy; `WHAT_NOT_TO_SAVE_SECTION` | Rules are coupled with execution logic; different stages’ prompts are unaware of each other’s constraints |
| Feature-gate branches | `tengu_moth_copse`; KAIROS mode; TEAMMEM gating | System behavior depends on the combinatorial state of a set of external switches, lacking overall semantic consistency |

The fundamental problem: no one — including the system itself — can see the complete definition of memory behavior in one place. To answer “what happens when a user appends a message?”, you would need to read `memdir.ts`, `extractMemories/prompts.ts`, `stopHooks.ts`, `backgroundHousekeeping.ts`, `findRelevantMemories.ts`, and the state of several feature gates simultaneously, to reconstruct the full path.

The purpose of moving to policy-driven mode: **converge the complete definition of memory behavior onto a single artifact that is user-editable, program-parseable, and LLM-interpretable.**

### Public API and formalization scope

At the outer boundary, the library should stay minimal:

- `append(raw_message)` records new interaction into the memory runtime
- `retrieve(query)` asks the runtime for relevant memory given a current task or question

The point of formalization is limited but important. The proposal is not trying to fully formalize semantic memory reasoning. It is trying to formalize:

- **Public API contract** — `append` means “advance the memory runtime,” not “immediately write a topic file.” `retrieve` means “return useful memory materials under the current policy,” not “do a DB query.”
- **Local storage contract** — which file families exist, what roles they play (index vs. body vs. raw log), and what invariants the runtime enforces.
- **Lifecycle** — the complete path from raw capture → durable memory formation → maintenance → retrieval, no longer defined implicitly by scattered stopHooks + backgroundHousekeeping + gated extractors, but defined explicitly by ordered steps in `stages`.
- **Runtime / LLM boundary** — every step has an explicit `kind: runtime | semantic`. Semantic steps receive controlled text assembled from `llm_policy_text`, not free-form prompts.
- **Policy surface** — the set of behavioral dimensions that users can configure without touching code.

The runtime is file-native. Developers should be able to inspect what happened by looking at local files rather than an opaque service. The current reference shape is aligned with Claude Code’s existing local memory behavior:

- raw interaction is recorded in local append-log form (`jsonl`-like session transcripts)
- memory is materialized into local Markdown files
- lightweight index-like files are also maintained locally

This current shape is only one policy instantiation, not the permanent identity of the system. Future policies may move toward Zep-like schemas, Mem0-like organization, or more explicit multi-layer trees without changing the public API.

### Policy as control surface

The central control surface is a **single constrained policy file** rather than unconstrained prompt text. That file should remain human-editable, but it should not collapse into free-form prose or a full DSL. A practical target is one policy artifact with two kinds of sections:

- structured sections interpreted by the runtime
- bounded behavioral sections interpreted by the LLM

The structured sections can carry things like storage layout, maintenance mode, triggers, or retrieval style. The behavioral sections can carry things like what should be remembered, how to organize notes, when to merge versus create, and how retrieval should prioritize different local artifacts.

Within this framing, online and offline behavior are best treated as maintenance modes under policy rather than as different system identities. A policy may choose to:

- update memory files immediately on append
- defer some updates to extraction or consolidation passes
- buffer messages and flush on semantic boundary detection
- mix synchronous and asynchronous maintenance depending on the memory style

The implementation split still makes sense:

- Python for the library surface that developers call directly
- Rust/C++ for the runtime core that owns file I/O discipline, append logs, maintenance scheduling, dirty tracking, caching, and future concurrency

That low-level core is still valuable even when some behavioral policy is interpreted by the LLM, because the system still needs a robust local runtime: file updates, scheduling, tracing, recovery, and later optimization should not depend on prompt glue alone.

### What already seems settled

- The artifact should be a reusable library, not a full agent framework.
- The public API should stay minimal: `append(raw_message)` and `retrieve(query)`.
- The runtime should remain local-file-native and inspectable.
- A Python-facing surface with a lower-level systems core remains a reasonable split.
- Policy should be explicit and configurable rather than hidden across prompts and hardcoded paths.
- A single constrained policy file is a better target than either unconstrained markdown or a heavy standalone DSL.
- The current Claude-Code-aligned local file layout is the right initial runtime shape, but it should be treated as one policy family rather than the only future organization.

### What still needs to be pinned down

**What belongs in the constrained policy file**  
The key question is not whether policy exists, but how much of it should be structured and how much should remain behavioral. The file needs enough structure that the runtime can depend on it, but enough flexibility that different memory styles can still be expressed without turning the policy into a heavyweight DSL.

> A likely split is: deterministic runtime/config fields for things like storage layout, maintenance triggers, update mode, and retrieval style; bounded natural-language sections for LLM-facing memory behavior. The exact boundary between those two parts still needs to be fixed.

**How closely the runtime should align with Claude Code**  
The current implementation target is Claude-Code-compatible local output and lifecycle, but the broader goal is to support other policy families later. The open question is how much of Claude Code should be treated as the default runtime shape versus how much should be factored out as policy-dependent behavior from the start.

> This is the main architectural tradeoff. A closer Claude-Code alignment makes version 0 easier to define and validate. A more abstract policy model makes later Zep/Mem0-style variants easier, but risks over-generalizing before the current runtime is stable.

**How append and retrieve should interact with policy**  
Because `append` takes raw message data, the library owns memory formation. That means policy is not just a retrieval concern: it affects when files are created, when they are updated, what maintenance runs inline, and what may be deferred.

> This is where online/offline really matters. Once append is raw-input-facing, policy influences both write-time behavior and later maintenance. The exact lifecycle needs to be made explicit so developers know what `append` guarantees and what `retrieve` is allowed to depend on.

**How general the policy model should be in version 0**  
If the long-term goal is to support multiple agent-memory styles, the policy model should not be overfit to Claude Code alone. At the same time, version 0 should not become a pseudo-general framework that is too abstract to reproduce any concrete system well.

> The practical goal is not “generic at all costs.” The practical goal is “Claude-Code-aligned first, but with a policy shape that can later host other families such as Zep-like, Mem0-like, or tree-oriented memory layouts without redesigning the library surface.”
