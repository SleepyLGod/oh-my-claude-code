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

We can treat the Claude-style memory part as sth that should be wrapped into a real library, not left as scattered prompting logic. The target shape is simple on the outside and structured on the inside: 

- a Python-facing memory module with only two calls, `append` and `retrieve`
- backed by a Rust/Cpp core that can later handle concurrency, caching, and lower-level optimizations without forcing a redesign.

Internally, the system is a multi-layer, file-native tree:

- Leaves are append-only memory files.
- Parent nodes are derived nodes created from leaves or lower-level groups.
- The whole layout stays on the local filesystem: files, directories, subdirectories, and a `metadata.md` at each directory level.
- The point is not to implement a textbook B+ tree or LSM-tree, but to borrow the discipline of a storage engine while keeping the actual memory structure closer to Claude-style semantic organization.

The tree can be controlled by a `policy.md`:

- That policy decides how leaves are grouped and when upper layers are updated.
- A policy may be purely structural, such as “every 10 msgs create one parent,” or semantic, such as “group msgs under the same topic and create a new parent when a new topic appears.”
- The same policy can also decide whether updates happen online (zep/mem0 style) or in the background (claude code style). If online, an `append` can trigger an immediate LLM-based parent update. If offline, the leaf is written first and the upper layers are refreshed later.

In this design, the program owns the structure and the update schedule, while the LLM is used as a semantic operator when the policy requires semantic grouping or summarization. The main idea is to formalize Claude-style memory as a policy-driven multi-layer index with a very small API surface, a fully file-based implementation, and enough internal structure to support later work on cache reuse, LLM cost reduction, batching, and smarter update strategies.

### What already seems settled

Several design directions already appear stable enough to treat as the working shape of the system.

- The external interface should remain minimal: `append` and `retrieve`.
- The artifact should be a reusable library, not a full agent framework.
- A Python-facing API with a Rust-backed core is a reasonable engineering split.
- The physical substrate should remain file-native: files, directories, and subdirectories.
- Each directory level may carry its own `metadata.md`.
- The system should be multi-layer rather than a flat memory folder.
- Leaves should be append-oriented, and likely append-only in the first design.
- Upper-level nodes should be derived structures rather than simple aliases of leaves.
- A policy layer should act as the control plane for grouping, update mode, and refresh behavior.
- Online versus offline update should be an explicit design dimension, not an accidental implementation detail.
- Once online/offline is made explicit, a maintenance layer becomes unavoidable: some appends only write leaves, some trigger immediate parent refresh, some mark nodes dirty, and some require later rebuild or consolidation.
- The LLM should not be treated as the controller of the system. It should be treated as a semantic operator invoked by the program when semantic grouping, summarization, or parent refresh is required.

### What still needs to be pinned down

The harder questions are no longer about performance class or textbook tree identity. They are about object model and system semantics.

**Policy abstraction vs. user-facing policy**  
A policy layer appears necessary, but that does not automatically imply that version 0 must expose `policy.md` as a user-authored interface. The more fundamental requirement is that grouping rules, layer construction rules, refresh triggers, and online/offline behavior become explicit and program-interpretable rather than remaining scattered across prompts and hardcoded logic. A practical first version may ship with a small set of built-in policies and only later externalize them as `policy.md`.

**What the leaf actually stores**  
There are two plausible scopes. One option is that a leaf stores raw or normalized events, which makes the tree cover the full path from interaction capture to higher-level memory. Another option is that raw transcripts remain outside the library, and the leaf stores Claude-style durable memory objects, closer to today’s topic files. The second option is likely more realistic for version 0 if the goal is to formalize Claude Code’s current memory layer rather than replace its transcript substrate.

**What a parent node actually is**  
A parent may act as routing metadata, as a semantic summary, or as a higher-level memory object. These are not the same thing. Updating routing metadata, updating a summary, and updating authoritative semantic memory are different operations. This distinction has to be made explicit before the tree model can be stabilized.

**Whether the tree is primarily a memory tree or an index tree**  
One interpretation is that leaves hold the real memory content while internal nodes mainly organize and route retrieval. Another interpretation is that all levels of the tree carry memory at different abstraction levels. A hybrid interpretation may be the most realistic: lower layers hold more concrete memory objects, while upper layers carry both routing structure and derived semantic memory.

**What online/offline consistency actually guarantees**  
If leaves are written first and parents may lag, the system needs an explicit consistency model. The important question is not just whether updates are online or offline, but what `append` guarantees on return, which layers are authoritative at each point, and what `retrieve` is allowed to read when upper layers are stale.

**What retrieval means once the tree exists**  
Claude Code today is still closer to flat shortlist retrieval: scan memory files, read metadata, shortlist with an LLM, then load content. A multi-layer tree will require a more formal retrieval semantics: which layers are consulted first, when traversal goes downward, whether parent summaries can satisfy retrieval directly, and whether mixed retrieval across summaries and leaves is allowed.

---

p.s. sth about B+ tree and LSM tree

- B+ tree thinking emphasizes immediate structural correctness. (like the 'online' policy)
- LSM thinking emphasizes cheap writes and deferred reconciliation.  (like the 'offline' policy)
- **Zep and Mem0 are closer to B+ tree thinking, while Claude Code today is much closer in spirit to the LSM tree thinking**.
