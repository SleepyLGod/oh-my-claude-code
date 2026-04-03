# Research Notes on the Claude Code Memory Index

## 0. Goal

This document addresses one question only:

> If we want to stay as close as possible to Claude Code’s current memory design, how should we understand its existing index, and how should we formalize it into a more standard, reusable library abstraction?

This note does **not** repeat the full memory overview. It focuses specifically on:

- the high-level mechanisms of memory insertion, maintenance, and retrieval in Claude Code;
- what its current index *is*, and what it *is not*;
- why a purely semantic B+ tree is conceptually unnatural here; and
- what kind of formalization is most faithful to Claude Code’s current design.

---

## 1. Conclusion First

If the goal is to remain **as close as possible to Claude Code’s current design**, then the most natural formalization is **not** a “pure semantic B+ tree.” It is instead:

> a file-backed, append-friendly, LLM-assisted, background-maintained **hybrid semantic memory store**, whose read path may be exposed as a tree-like routing index, while whose write path is much closer to the LSM / compaction family.

The reason is straightforward:

- Claude Code’s current memory object is **not** an atomic fact; it is a **topic-level Markdown file**.
- Its current write path is lightweight, softly constrained, and largely prompt-governed.
- Much of the semantic organization work is deferred to **background extraction** and **background consolidation**.
- Its retrieval path is **not** canonical tree descent; it is a **flat manifest scan plus side-model selection**.

So its current spirit is much closer to:

- an append log,
- topic files,
- lightweight recall, and
- background maintenance

than to:

- deterministic tree insertion,
- page splitting,
- canonical paths, and
- strong structural invariants.

---

## 2. Comparison Table

Let us first settle the four designs that matter most.

| Dimension | Claude Code Current Implementation | Pure Semantic B+ Tree | Pure Semantic LSM | Hybrid: LSM Write Path + Routing-Tree Read Path |
| --- | --- | --- | --- | --- |
| Primary memory object | Topic Markdown file | Node/leaf record with canonical placement | Semantic records or topic groups inside segments/runs | Topic file / segment plus tree-shaped routing metadata |
| Write cost | Low to moderate; most semantic maintenance is deferred | High; insertion must immediately route semantically, possibly split, and propagate upward | Low; write into append-friendly structures first | Moderate; write lightly first, then asynchronously build or refresh the tree view |
| Maintenance style | Prompt constraints + extractor + autoDream | Structure maintained at write time | Compaction / consolidation | Lightweight write-time maintenance + background tree refresh |
| Query path | Flat scan + frontmatter manifest + side model selects files | Root -> internal -> leaf via canonical descent | Search multiple runs / segments and merge | Search routing tree first, then consult recent delta if needed |
| Structural invariants | Very weak | Strong | Medium | Medium-to-strong |
| Multi-home support | Natural but not formalized | Unnatural; requires secondary references | More natural; compaction can partially resolve it | Canonical home + secondary references are possible |
| Cache friendliness | Medium; manifest and selected files are cacheable | High; naturally supports prefix/path caching | Medium; reads merge multiple layers | High; upper tree paths can be cached, recent delta cached separately |
| Faithfulness to Claude Code | Yes | No; a substantial mismatch | Fairly close | The closest formalized variant |
| Main risk | Black-box behavior, weak schema, no canonical path | Write path is too heavy; semantic splits are hard to formalize | Read amplification; more complex query planning | Higher implementation complexity, but best engineering balance |

The core takeaway is simple:

- If you want to stay as close as possible to Claude Code’s native design, a **pure B+ tree is not the nearest point**.
- The nearest point is a **hybrid design: LSM-style write path + tree-like routing index**.

---

## 3. Claude Code’s Current Implementation, From First Principles

## 3.1 What Is the Current Memory Object in Claude Code?

We should separate three layers.

### A. Raw substrate

At the lowest level sits an append-only transcript JSONL:

- the main session transcript,
- subagent transcripts, and
- session-related metadata.

This layer is the raw stream of experience. It is **not** the durable memory object defined by Claude Code itself.

Sources:

- `sessionStorage.ts`

### B. Durable memory object

The actual memory object intended for reuse in future sessions is typically:

- a **topic Markdown file**.

It contains:

- frontmatter
  - `name`
  - `description`
  - `type`
- body
  - free-form text

The `type` field comes from a fixed taxonomy:

- `user`
- `feedback`
- `project`
- `reference`

Sources:

- `memoryTypes.ts`
- `memdir.ts`

### C. Display index

`MEMORY.md` is **not** itself a memory object. It is a **display index**:

- one pointer per line,
- typically in the form `- [Title](file.md) — one-line hook`,
- with no frontmatter,
- and loaded directly into context.

Its role is to provide a directory page for humans and models. It is **not** a strict machine index for programmatic traversal.

Source:

- `memdir.ts`

---

## 3.2 Insertion: How Claude Code “Inserts” Memory

There is currently no formal `APPEND` API, but abstractly there are two insertion modes.

### A. Explicit save by the main model

The memory prompt instructs the model to:

- determine the memory type,
- write a topic file,
- add a pointer to `MEMORY.md`,
- avoid duplication, and
- update or delete incorrect entries when necessary.

This is **explicit insertion**.

Source:

- `memdir.ts`

### B. Background extraction

At the end of a turn, if the relevant gate is enabled, Claude Code launches a forked extraction subagent that:

- analyzes recently added messages,
- inspects the current memory manifest,
- decides whether to update an existing topic file or create a new one,
- and updates `MEMORY.md` when needed.

This is effectively **implicit insertion**.

Sources:

- `extractMemories.ts`
- `extractMemories/prompts.ts`
- `stopHooks.ts`

### The real characteristics of insertion

From a research perspective, Claude Code’s insertion path has three defining properties:

1. **The memory object is topic-sized, not fact-sized.**
2. **Insertion is semantic insertion, not key-based put.**
3. **Insertion correctness depends primarily on prompt constraints, not on machine-enforced invariants.**

---

## 3.3 Maintenance: How Claude Code Maintains Memory

Claude Code’s maintenance logic has three layers.

### A. Lightweight maintenance at write time

Prompt-level constraints require the model to:

- organize by topic, not by chronology,
- avoid duplication,
- update or remove incorrect or stale memory,
- and delete memory when the user explicitly asks to forget it.

This is a soft constraint layer, not a structured maintenance engine.

Sources:

- `memdir.ts`
- `extractMemories/prompts.ts`

### B. Query-time freshness control

At retrieval time, older memory may be accompanied by freshness / staleness caveats:

- reminding the system that the memory reflects a point-in-time observation rather than live state,
- and that it should be validated against the current codebase or resources.

Source:

- `memoryAge.ts`

### C. Background consolidation

`autoDream` is responsible for:

- merging new signals into existing topic files,
- correcting memories invalidated by later evidence,
- removing stale or superseded pointers,
- and keeping `MEMORY.md` concise.

This is the part of Claude Code that comes closest to a real consolidation engine.

Sources:

- `autoDream.ts`
- `consolidationPrompt.ts`

### The real characteristics of maintenance

Claude Code’s maintenance is **not**:

- a record-level deterministic update engine,
- a graph invalidation engine, or
- a versioned fact store.

It is instead:

- prompt-governed lightweight maintenance, plus
- background maintenance that behaves much like compaction.

This point is crucial, because it determines that the system is conceptually closer to the **LSM / compaction family** than to the **B+ tree / page-maintained family**.

---

## 3.4 Retrieval: How Claude Code Retrieves Memory

Current retrieval has two layers, not one.

### A. `MEMORY.md` enters the prompt

`MEMORY.md` is injected into context to give the main model a directory page.

But this is **not** the primary query-time retrieval router today.

Sources:

- `memdir.ts`
- `claudemd.ts`

### B. Query-time relevant memory retrieval

The actual runtime retrieval path is:

1. scan all `.md` files in the memory directory except `MEMORY.md`;
2. read only roughly the first `30` lines of each file;
3. parse the frontmatter `description` and `type`;
4. build a manifest;
5. use `sideQuery()` plus the default Sonnet model to select up to `5` filenames;
6. read the full bodies of those selected files;
7. inject them as `<system-reminder>`.

Sources:

- `memoryScan.ts`
- `findRelevantMemories.ts`
- `sideQuery.ts`
- `attachments.ts`
- `messages.ts`

### The real characteristics of retrieval

Claude Code’s current retrieval is **not**:

- a descent that begins at `MEMORY.md`,
- nor a root -> internal -> leaf tree traversal.

It is instead:

- flat manifest construction,
- side-model shortlist selection,
- and final file loading.

So the current system is a **flat semantic shortlist retriever**, not a tree retriever.

---

## 4. Structural Problems and Limitations in the Current Design

This section is not product criticism. It is structural analysis.

## 4.1 `MEMORY.md` is a display index, not a machine index

It is useful for the model, but too weak for programmatic indexing:

- no formal schema,
- no machine-enforced invariants,
- no stable child metadata,
- no canonical path.

It behaves more like:

- a semantic table of contents

than like:

- an executable index structure.

---

## 4.2 The memory object is too coarse; a topic is not an atomic memory

A single topic file may contain:

- multiple related feedback items,
- multiple project facts, or
- a cluster of related references.

This is practical, but it also makes the system:

- hard to invalidate at fine granularity,
- hard to place canonically,
- hard to formalize for updates,
- and hard to manage under multi-home conflicts.

---

## 4.3 There is no machine-enforced structural invariant

This is the deepest structural gap in the current design.

The system does not strongly guarantee that:

- the directory structure remains stable,
- every memory object has a unique canonical home,
- pointers in `MEMORY.md` cover all valid topic files, or
- parent summaries actually cover their children.

That means:

- the memory store may become “somewhat dirty but still usable,”
- but it is not a solid foundation for a strict indexing library.

---

## 4.4 The query path is not canonical

The retrieval path for the same query is not guaranteed to be identical:

- the manifest is constructed dynamically,
- side-model selection introduces semantic uncertainty,
- and there is no unique root-to-leaf path.

Consequences include:

- weaker caching opportunities,
- difficulty formalizing correctness,
- and the inability to provide tree-style complexity guarantees.

---

## 4.5 Background maintenance is feature-gated and optional

Much of Claude Code’s maintenance logic is not structurally mandatory. It is:

- feature-gated,
- main-thread-only,
- and unavailable in certain simplified modes.

So this is not an index engine that maintains structural correctness under all circumstances.

Sources:

- `backgroundHousekeeping.ts`
- `stopHooks.ts`
- `sessionMemory.ts`

---

## 4.6 Retrieval is overly flat

The main weakness of current recall is that:

- the candidate set comes from a full-directory scan,
- there is no multi-level pruning,
- there is no real hierarchical routing,
- and the system behaves more like a semantic shortlist than a semantic index.

This means:

- it works well enough for small memory corpora,
- but the structural advantage does not scale cleanly as the corpus grows.

---

## 4.7 Multi-home has no formal solution

Semantic memory naturally admits multiple homes:

- one memory may simultaneously look like `user`, `feedback`, and `project`,
- or one memory may belong to two topic clusters at once.

Claude Code currently has no formal treatment of:

- canonical home,
- secondary references,
- duplicate materialization,
- or update propagation.

This must be addressed if one wants to move from “topic files” to a true “formal index.”

---

## 5. Your Advisor’s Question: If We Formalize This as `APPEND` / `QUERY`, What Is Wrong with the B+ Tree Intuition?

To be precise, the part of your advisor’s proposal worth preserving is the **API abstraction**, not necessarily the phrase “B+ tree.”

The parts worth preserving are:

- a minimal public API,
- `APPEND` as semantic insertion that hides internal complexity,
- `QUERY` as semantic retrieval,
- configurable policy,
- and future room for LLM cost reduction, request merging, and caching.

The part that should be challenged is:

- **Should the underlying structure really be a B+ tree?**

---

## 5.1 `APPEND` / `QUERY` is the right interface

Compressing the external API into:

- `append(event, policy?)`
- `query(request, policy?)`

is a good idea.

A library user should not need to care about:

- how topic files are partitioned,
- how the index is rewritten,
- how summaries are propagated upward,
- or how maintenance tasks are scheduled.

All of that should remain internal.

So from the standpoint of API design:

- the minimal interface is correct,
- and the library abstraction is correct.

---

## 5.2 Conceptual Problem #1 with a Pure B+ Tree: There Is No Total Order

A classical B+ tree relies on a total order.

You must be able to answer questions like:

- is `key_a < key_b`?
- what is the separator key?
- after a split, what is the boundary between the left and right pages?

Semantic memory does not come with a natural total order.

The real questions are:

- which topic is this new memory closest to?
- if it fits two topics, where is the primary home?
- what constitutes a meaningful semantic split boundary?

These are not ordering problems. They are semantic clustering and routing problems.

So:

> a semantic index has no natural key order; it has only semantic placement.

That is the first conceptual mismatch.

---

## 5.3 Conceptual Problem #2 with a Pure B+ Tree: Deterministic Descent Does Not Hold

In a classical B+ tree, descent is:

- driven by the key,
- path-unique,
- independent of an LLM,
- and independent of semantic judgment.

In your system, if every layer requires an LLM to decide which branch to take, then it is no longer a classical B+ tree with deterministic descent.

A more accurate name would be:

- **hierarchical semantic routing**

This is not mere terminology. It is an ontological difference.

If descent itself depends on semantic judgment, then:

- query cost is no longer simple page I/O,
- write cost is no longer simple insertion,
- and the path is no longer naturally cacheable as a fixed comparison chain.

---

## 5.4 Conceptual Problem #3 with a Pure B+ Tree: Multi-home Breaks Canonical Placement

One of the strong properties of a classical B+ tree is that:

- each record has exactly one canonical place.

Semantic memory does not naturally satisfy that property.

If the same memory belongs naturally to multiple conceptual clusters, then you must choose between:

- single-home plus secondary references,
- multiple copies,
- or an object store plus multiple postings.

Once true multi-home is allowed, many classical tree assumptions weaken.

So this is not a small implementation issue. It is a deeper mismatch between:

- the semantics of the memory object, and
- the semantics of the tree index.

---

## 5.5 Conceptual Problem #4 with a Pure B+ Tree: The Write Path Becomes Much Heavier than Claude Code’s Current Design

Claude Code’s current write path is relatively light:

- the main model writes a topic file,
- or an extractor writes asynchronously,
- and heavy reorganization is deferred to background maintenance.

If the system is turned into a semantic B+ tree, then `APPEND` immediately has to bear:

- semantic placement,
- duplicate / update checks,
- possible splitting,
- summary propagation,
- and possibly rebalancing.

That moves semantic work from background maintenance into the write path itself.

This directly conflicts with Claude Code’s current design philosophy.

So if the goal is to stay close to Claude Code, there is clear tension here.

---

## 5.6 Conceptual Problem #5 with a Pure B+ Tree: Separator Keys / Parent Summaries Are Hard to Formalize

Internal nodes in a B+ tree need clear separators.

A semantic tree instead needs:

- parent summaries,
- child routing synopses,
- and perhaps disambiguation hints.

But the correctness of these summaries is difficult to machine-enforce.

You can ask an LLM to generate them, but then:

- parent metadata itself may drift,
- the separator after a split is no longer a strict boundary,
- and internal nodes are not logical truths but semantic approximations.

That makes the structure much closer to a **learned or summarized routing tree** than to a strict B+ tree.

---

## 6. What Conflicts Arise If We Force Claude Code into a B+ Tree Without Further Optimizations?

This section discusses only the conceptual conflict, not later optimizations such as caching, request merging, or window strategies.

If you directly refactor Claude Code’s current style into a pure B+ tree, three conflicts appear immediately.

### Conflict A: Light writes vs. heavy inserts

Claude Code:

- prefers lightweight writes,
- and defers heavy reorganization to the background.

A pure semantic B+ tree:

- makes insertion itself heavy.

That changes the center of gravity of the system.

### Conflict B: Flat topic memory vs. canonical tree placement

Claude Code’s topic files are coarse-grained, malleable, and easy to manually consolidate.  
A tree structure, by contrast, requires placement to be stable and recursively maintainable.

These two object models are not the same.

### Conflict C: Background consolidation is first-class in Claude Code, but B+ trees prefer online consistency

The part of Claude Code that behaves most like a real maintenance engine is `autoDream`.  
That is much closer to LSM-style maintenance than to page-maintained tree discipline.

So if the goal is to stay close to the current design, one should acknowledge:

> Claude Code’s core is not an online balanced tree; it is append + maintenance + lightweight retrieval.

---

## 7. A More Faithful Formalization: The Hybrid Design

If the real goal is to stay close to Claude Code’s native design while still turning it into a reusable library, I would define it as follows.

## 7.1 External API

Expose only:

- `append(event, policy?)`
- `query(request, policy?)`

This part is consistent with your advisor’s proposal.

---

## 7.2 Internal structure

Internally, do **not** force all data to “live in a B+ tree.”  
A more reasonable design has three layers.

### Layer 0: append substrate

- append-only event log,
- low-cost persistence,
- conceptually closest to Claude Code’s transcript substrate.

### Layer 1: durable semantic objects

- topic files / semantic buckets,
- with stable metadata,
- maintained jointly by append and consolidation.

### Layer 2: routing index

- a tree-like hierarchy,
- internal nodes containing child synopses or routing metadata,
- used by the read path.

In this design, the tree is:

- a **read accelerator**,
- a **routing index**,

rather than:

- the unique system-wide truth store.

---

## 7.3 A Reasonable Semantics for `APPEND`

`APPEND` should **not** be understood as:

- “insert directly into a leaf page in place.”

A more appropriate semantics is:

- append the raw event;
- optionally perform a lightweight online semantic update;
- possibly update one or a few semantic buckets;
- mark affected routing nodes as dirty;
- let a background task decide whether to split, rewrite, or rebuild summaries.

This remains faithful to Claude Code’s design philosophy:

- light writes,
- background maintenance.

---

## 7.4 A Reasonable Semantics for `QUERY`

`QUERY` should **not** require:

- an LLM invocation at every tree level.

A more practical design is:

- cheap prefiltering first,
- semantic routing only when needed,
- leaf assembly last,
- recent delta consulted as an additional query layer.

That is:

- a tree-like read path,
- but not necessarily one LLM call per level.

---

## 8. How Should We Interpret `policy`?

`policy` is not a first-class Claude Code object today.  
But if we turn this into a library, it can be defined as:

> a configurable set of behavioral constraints and cost budgets governing append and query behavior.

For example, `policy` may decide:

- which model to use,
- what token budget is allowed,
- how wide duplicate checking may be,
- whether online updates are allowed,
- whether consolidation is background-only,
- the split threshold,
- the query candidate budget,
- and cache TTL.

A sensible default policy could be:

- cloud LLM,
- lightweight online maintenance,
- background consolidation enabled,
- read path using cheap prefiltering before semantic routing.

This is much more stable than treating “policy” as a vague placeholder for future ideas.

---

## 9. Conceptual Conclusion on the “B+ Tree” Proposal

The core judgment is as follows.

### What can be preserved

- the minimal `APPEND` / `QUERY` API,
- a routing hierarchy,
- the engineering intuition behind split / propagate,
- prefix/path caching intuition,
- and the library abstraction.

### What should not be copied literally

- the total-order assumption,
- deterministic key descent,
- certainty of a single path,
- the classical semantics of page split,
- and the idea that all semantic correctness must be completed during the write path.

### Better naming

If you are writing a proposal, I would recommend names such as:

- **B+-tree-inspired semantic index**
- **file-backed hierarchical semantic routing index**
- **hybrid semantic memory store with append/query APIs**

I would **not** call it simply:

- **B+ tree for memory**

because that causes readers to assume:

- a total order,
- deterministic separators,
- and strict online balancing,

none of which is actually present.

---

## 10. Final Judgment: B+ Tree or LSM Tree?

If the criterion is “stay as close as possible to Claude Code,” then my judgment is clear.

### Pure B+ tree

This is unnatural because:

- the write path becomes too heavy,
- semantic placement is too expensive,
- multi-home is awkward,
- and it conflicts with the philosophy of background consolidation.

### Pure LSM tree

This is more natural because:

- it is append-friendly,
- it is compaction-friendly,
- and it better matches the rhythm of transcript + extractor + autoDream.

Its weaknesses are:

- reads may need to merge multiple layers,
- and it does not naturally provide a good hierarchical routing view.

### Most reasonable: Hybrid

**LSM-style write path + routing-tree read path**

This is the design that is both closest to Claude Code and easiest to formalize.

In one sentence:

> Keep semantic maintenance in the compaction / consolidation family, and treat the tree primarily as a read-time routing/index structure, rather than forcing the whole system into the write-time discipline of a classical B+ tree.

---

## 11. One-Sentence Version

Claude Code’s current `MEMORY.md` is not a strict machine-executable index; it is a semantic directory page for the model. Its actual runtime retrieval depends on a frontmatter manifest built by directory scanning plus side-model selection.  
Therefore, if we want a formalization that remains faithful to Claude Code, the more natural direction is not a pure semantic B+ tree but rather:

**a hybrid semantic memory store with `APPEND` / `QUERY` APIs, whose write path resembles LSM / compaction and whose read path resembles a routing tree.**
