# Semantic Queries Extracted from Data Flows

---

## 1. Zep / Graphiti

```sql
-- Q1: Entity Extraction
RECENT_ENTITIES = sem_map(
    RECENT_EPISODES.content,
    "Extract entity nodes mentioned explicitly or implicitly in CURRENT MESSAGE"
)   -- returns: (name, summary) / (name) only

-- Q2: Attach a column of “Historical Summary” for each entity appeared in RECENT_ENTITIES, if any
RECENT_ENTITIES left sem_join HISTORY_ENTITIES
on (RECENT_ENTITIES.name, HISTORY_ENTITIES.name, RECENT_EPISODES.content,
    "Do ENTITY and DATABASE ENTITY refer to the same real-world object?")

-- Q3: Update the summary of recent entities based on recent messages and retrieved history summaries
sem_map(
    HISTORY_ENTITIES.summary, RECENT_ENTITIES.summary, RECENT_EPISODES.content,
    "Update summary with new info"
)   -- column-wise fuse of old summary + new summary + episode context

-- Q4: Edge/Fact extraction based on msgs and updated recent entities
RECENT_FACTS = sem_map(
    RECENT_EPISODES.content, RECENT_ENTITIES.name,
    "Extract all factual relationships between ENTITIES based on CURRENT MESSAGE"
)

-- Q5: Duplicate fact detection between RECENT_FACTS and HISTORY_FACTS
DUPLICATE_FACTS = RECENT_FACTS inner sem_join HISTORY_FACTS
on (RECENT_FACTS.src_id = HISTORY_FACTS.src_id and RECENT_FACTS.tgt_id = HISTORY_FACTS.tgt_id)
and "Does NEW FACT represent identical factual information as EXISTING FACT?"

-- Q6: Contradictory fact detection between RECENT_FACTS and HISTORY_FACTS
CONTRADICTORY_FACTS = RECENT_FACTS inner sem_join HISTORY_FACTS
on "Does NEW FACT contradict EXISTING FACT?"

-- Q7: Community summary fusion for each entity
sem_map(
    HISTORY_COMMUNITIES.summary, RECENT_ENTITIES.summary,
    "Synthesize information from two summaries into a single succinct summary"
)   -- column-wise fuse in a joined table of recent entities (likely) and history communities

-- Q8: Generate new comminity name based on the new generated summary
sem_map(
    HISTORY_COMMUNITIES.summary,
    "Create short one-sentence description explaining what kind of information is summarized"
)
```

---

## 2. Mem0

### Basic Flow (Vector Store)

```sql
-- Q1: Fact extraction from single incoming message
CURRENT_FACTS = sem_map(
    CURRENT_MESSAGE,
    "Extract standalone, self-contained facts from the conversation"
)

-- Q2: Retrieve facts from history that are similar to current facts
SELECTED_HISTORY_FACTS = CURRENT_FACTS left sem_sim_join lateral HISTORY_FACTS
on (
    CURRENT_FACTS.fact, HISTORY_FACTS.fact,
    K=5, "find top k similar facts"
) -- per-left-row top-k vector similarity retrieval (kNN join)

-- Q3: Fact resolution: give the memory action for each fact 'row' in a joint table
-- of current facts and selected history facts (cross join lateral)
sem_map(
    CURRENT_FACTS.fact,
    SELECTED_HISTORY_FACTS.fact,
    ['ADD', 'UPDATE', 'DELETE', 'NOOP'],
    "Evaluate the relationship: if contradictory return DELETE, if adding details return UPDATE, 
     if redundant return NOOP, else ADD"
)

-- Q4: Merge related history fact contents with current fact contents when the fact need to be updated
-- actually Q3 and Q4 are computed together in one LLM call in the real workflow
sem_map(
    CURRENT_FACTS.fact, SELECTED_HISTORY_FACTS.fact,
    "If action is UPDATE, merge them into a comprehensive fact. Else return new_content"
)
```

### Graph Flow (if enabled)

```sql
-- Q5: Entity Extraction
CURRENT_ENTITIES = sem_map(
    CURRENT_MESSAGE,
    "Extract entities from the conversation"
)   -- returns: (entity_name, entity_type)

-- Q6: Relation Extraction
CURRENT_RELATIONS = sem_map(
    CURRENT_MESSAGE, CURRENT_ENTITIES,
    "Extract relationship triplets (Source, Relation, Destination)"
)   -- returns: (src_entity_name, relation_description, dest_entity_name)

-- Q7: Retrieve entities from history that are similar to current entities
SELECTED_HISTORY_ENTITIES = CURRENT_ENTITIES left sem_sim_join lateral HISTORY_ENTITIES
on (
    CURRENT_ENTITIES.entity_name, HISTORY_ENTITIES.entity_name,
    K=1, "find top k similar entities"
) -- per-left-row top1 vector similarity retrieval

-- Q8: Add a column of 'resolved id' for each entity in CURRENT_ENTITIES: reuse the id of the history entity if it is the same, otherwise generate a new id
CURRENT_ENTITIES left sem_join lateral SELECTED_HISTORY_ENTITIES
on sem_map(
    CURRENT_ENTITIES.entity_name, SelectedHistoryEntities.entity_name,
    ['SAME', 'DIFFERENT'], "Are these the exact same entity?"
) = 'SAME'
-- Q7+Q8 equivalent to:
-- left sem_join HistoryEntities
-- on "Do ENTITY and DATABASE ENTITY refer to the same real-world object?"

-- Q9: Fact resolution: give the relation action for each relation 'row' in a joint table of current relations and selected history relations (cross join lateral)
sem_map(
    CURRENT_RELATIONS.relation_description,
    HISTORY_RELATIONS.relation_description,
    ['CONTRADICTS', 'AUGMENTS', 'NEW'],
    "Does the new relation contradict the old one (CONTRADICTS), add detail (AUGMENTS), or is it unrelated (NEW)?"
)
```

---

## 3. EverMemOS

### Insertion Flow (`memorize`)

```sql
-- Q1: Boundary Detection (Tumbling Window), then execute 'fire' if the boundary is reached
sem_filter(
    RECENT_MESSAGE_TUMBLING_WINDOW.content,
    "Has the conversation reached a natural boundary 
     (topic shift, long time gap, or logical conclusion)?"
)
-- also gated by: token_count(content) >= 8192 or message_count(content) >= 50

-- Q2: Episode synthesis (narrative) of the messages in the tumbling window 
sem_map(
    RECENT_MESSAGE_TUMBLING_WINDOW.content,
    "Synthesize this conversation into a concise third-person 
     episodic narrative capturing the key events and context"
) as episode

-- Q3: Subject extracted from the messages in the tumbling window
sem_map(
    RECENT_MESSAGE_TUMBLING_WINDOW.content,
    "What is the central subject of this conversation?"
) as subject

-- Q4: Foresight extraction from the messages in the tumbling window
sem_extract(
    RECENT_MESSAGE_TUMBLING_WINDOW.content,
    "Extract time-bounded future predictions or planned actions"
) as foresights

-- Q5: Detailed fact/eventLog extraction from the messages in the tumbling window
sem_extract(
    RECENT_MESSAGE_TUMBLING_WINDOW.content,
    "Extract discrete atomic factual events 
     (who did what, when, with specific details)"
) as facts

-- Q6: Topic / Thematic clustering of the recent memory segment deriving from its related tumbling windows
-- each topic is a centroid of multiple memory segments
-- each memory segment has episode, subject, foresights, facts
RECENT_MEMORIES left sem_sim_join TOPICS
on (
    RECENT_MEMORIES.episode, TOPIC.centroid,
    "Does this episode belong to the same thematic storyline?"
) -- vector similarity evaluation

-- Q6 (alternative conceptual form): semantic grouping with dynamic topic creation
TOPIC_ASSIGNMENT = sem_group_by(
    RECENT_MEMORIES.episode, TOPIC.centroid,
    "Assign this episode to the most suitable thematic storyline; "
    "if no existing topic matches, create a new topic"
)
-- equivalent intent: Q6 retrieval + topic-state upsert (topic_id/centroid/count/timestamp)

-- Q7: Profile distillation: When a topic has accumulated enough memory segments, aggregate those segments from a topic with the existing user profile, in a joint table of segments and profile traits.
sem_agg(
    HISTORY_SEGMENTS.episode,
    HISTORY_PROFILES.traits,
    "Given the existing user profile and these conversational episodes, 
     distill updated stable user traits"
)
```

---

## Summary: Operator Inventory

| Operator | Zep | Mem0 | EverMemOS | Total | Remarks |         
|----------|-----|------|-----------|-------|---------|
| `sem_map` | Q1, Q3, Q4, Q7, Q8 | Q1, Q3, Q4, Q5, Q6, Q9 | Q2, Q3 | 13 | |
| `sem_join` | Q2, Q5, Q6 | Q8 | — | 4 | |
| `sem_filter` | — | — | Q1 | 1 | |
| `sem_agg` | — | — | Q7 | 1 | |
| `sem_extract` | — | — | Q4, Q5 | 2 | `sem_map` with structured output |
| `sem_sim_join` | — | Q2, Q7 | Q6 | 3 | `sem_join` with vector index |
| `sem_group_by` | — | — | Q6 (alt) | 1 | not relation-like operator |

---

## 4. LOTUS Pseudocode

> Rewriting the above queries in LOTUS's Pandas-like API.
> LOTUS langex uses `{column_name}` for single-table operators
> and `{column_name:left}` / `{column_name:right}` for joins.
> Where an operator cannot be directly expressed in LOTUS, it is noted.

### 4.1 Zep / Graphiti

```python
# --- Q1: Entity Extraction ---
recent_entities = recent_episodes.sem_map(
    "Extract entity nodes mentioned explicitly or implicitly in {content}"
)
# or equivalently using sem_extract for structured multi-column output:
recent_entities = recent_episodes.sem_extract(
    input_cols=["content"],
    output_cols={"name": "entity name", "summary": "brief entity description"}
)

# --- Q2: Entity Resolution (left sem_join) ---
resolved = recent_entities.sem_join(
    history_entities,
    "The entity {name:left} and the entity {name:right} refer to the same real-world object",
    how="left"
)

# --- Q3: Entity Summary Update ---
# operates on the joined table from Q2
resolved = resolved.sem_map(
    "Given old summary {history_summary} and new summary {recent_summary} "
    "and message context {content}, produce an updated summary"
)

# --- Q4: Edge/Fact Extraction ---
recent_facts = resolved.sem_extract(
    input_cols=["content", "entity_names"],
    output_cols={
        "src_name": "source entity",
        "tgt_name": "target entity",
        "fact": "factual relationship description"
    }
)

# --- Q5: Duplicate Fact Detection (inner sem_join with structural pre-filter) ---
duplicate = recent_facts.sem_join(
    history_facts,
    "{fact:left} represents identical factual information as {fact:right}",
    how="inner"
)
# note: Zep also pre-filters on src_id = src_id AND tgt_id = tgt_id (structural),
# which would be a standard pandas merge before the sem_join

# --- Q6: Contradictory Fact Detection ---
contradiction = recent_facts.sem_join(
    history_facts,
    "{fact:left} contradicts {fact:right}",
    how="inner"
)

# --- Q7: Community Summary Fusion ---
# on a joined table of recent entities × history communities
community_update = entity_community.sem_map(
    "Synthesize {community_summary} and {entity_summary} "
    "into a single succinct summary"
)

# --- Q8: Community Naming ---
community_update = community_update.sem_map(
    "Create a short one-sentence description explaining "
    "what kind of information is summarized in {fused_summary}"
)
```

### 4.2 Mem0

```python
# --- Q1: Fact Extraction ---
current_facts = current_message.sem_extract(
    input_cols=["text"],
    output_cols={"fact": "standalone, self-contained fact from the conversation"}
)

# --- Q2: Retrieve similar history facts ---
# LOTUS sem_sim_join or sem_search (embedding-based, no LLM)
selected_history = current_facts.sem_sim_join(
    history_facts,
    left_on="fact", right_on="fact",
    K=5
)
# alternatively: history_facts.sem_search("fact", current_facts["fact"], K=5)

# --- Q3 + Q4: Fact Resolution + Enrichment (fused in one LLM call) ---
fact_resolution = selected_history.sem_map(
    "Given new fact {current_fact} and existing fact {history_fact}, "
    "return action (ADD/UPDATE/DELETE/NOOP) and merged content if UPDATE. "
    "If contradictory: DELETE. If adding details: UPDATE. If redundant: NOOP. Else: ADD."
)
# LOTUS limitation: sem_map produces one output column; producing two (action + enriched_fact)
# would require sem_extract:
# fact_resolution = selected_history.sem_extract(
#     input_cols=["current_fact", "history_fact"],
#     output_cols={"action": "ADD/UPDATE/DELETE/NOOP", "enriched_fact": "merged content"}
# )

# --- Q5: Entity Extraction ---
current_entities = current_message.sem_extract(
    input_cols=["text"],
    output_cols={"entity_name": "entity name", "entity_type": "entity type"}
)

# --- Q6: Relation Extraction ---
current_relations = current_entities.sem_extract(
    input_cols=["text", "entity_name"],
    output_cols={
        "src_entity_name": "source entity",
        "relation_description": "relationship",
        "dest_entity_name": "destination entity"
    }
)

# --- Q7 + Q8: Entity Alignment (vector recall + LLM precision) ---
# Step 1: Vector recall
candidates = current_entities.sem_sim_join(
    history_entities,
    left_on="entity_name", right_on="entity_name",
    K=1
)
# Step 2: LLM precision judge
aligned = candidates.sem_filter(
    "{current_entity_name} and {history_entity_name} are the exact same entity"
)
# LOTUS note: sem_join could also be used directly:
# aligned = current_entities.sem_join(
#     history_entities,
#     "{entity_name:left} and {entity_name:right} refer to the same real-world object",
#     how="left"
# )

# --- Q9: Relation/Fact Resolution ---
relation_resolution = joined_relations.sem_map(
    "Does new relation {current_relation} contradict ({history_relation})? "
    "Return CONTRADICTS, AUGMENTS, or NEW."
)
# or using sem_extract for structured output:
# relation_resolution = joined_relations.sem_extract(
#     input_cols=["current_relation", "history_relation"],
#     output_cols={"action": "CONTRADICTS/AUGMENTS/NEW"}
# )
```

### 4.3 EverMemOS

```python
# --- Q1: Boundary Detection ---
ready_segments = tumbling_window.sem_filter(
    "The conversation in {content} has reached a natural boundary "
    "(topic shift, long time gap, or logical conclusion)"
)
# also gated by: len(content) >= 8192 tokens or message_count >= 50

# --- Q2 + Q3: Episode Synthesis + Subject (fusible into one sem_extract) ---
memories = ready_segments.sem_extract(
    input_cols=["content"],
    output_cols={
        "episode": "concise third-person episodic narrative capturing key events and context",
        "subject": "central subject of this conversation"
    }
)

# --- Q4: Foresight Extraction ---
foresights = ready_segments.sem_extract(
    input_cols=["content"],
    output_cols={
        "prediction": "time-bounded future prediction or planned action",
        "start_time": "when this becomes relevant",
        "end_time": "when this expires"
    }
)

# --- Q5: Fact/EventLog Extraction ---
facts = ready_segments.sem_extract(
    input_cols=["content"],
    output_cols={
        "atomic_fact": "discrete atomic factual event (who did what, when, with specific details)",
        "timestamp": "when the event happened"
    }
)

# --- Q6: Topic/Thematic Clustering (embedding-based) ---
topic_assignment = memories.sem_sim_join(
    topics,
    left_on="episode", right_on="centroid",
    K=1, threshold=similarity_threshold
)
# ⚠ LOTUS sem_sim_join finds the best match by embedding similarity.
# EverMemOS also applies a time_gap constraint — not expressible in LOTUS sem_sim_join.

# --- Q7: Profile Distillation ---
# operates on HistorySegments grouped by topic, cross-referenced with existing profiles
updated_profiles = topic_segments.sem_agg(
    "Given the existing user profile traits {traits} and these conversational episodes "
    "{episode}, distill updated stable user traits",
    group_by="topic_id"
)
# LOTUS sem_agg reduces all rows to one summary per group.
# ⚠ The existing profile (HISTORY_PROFILES.traits) needs to be joined in first;
# LOTUS sem_agg doesn't natively support a "seed state" argument.
```
