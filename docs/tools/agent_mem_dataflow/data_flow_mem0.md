# Data Flow Diagrams for Mem0

## Memory Update

```mermaid
sequenceDiagram
    participant Client
    participant Server as Mem0 Server
    participant LLM
    participant VecDB as Vector DB
    participant GraphDB as Graph DB (Neo4j)

    Client->>Server: add(messages)
    
    par Basic Mem0 Flow
        Server->>LLM: Extraction Prompt (InputMsg) | 👍 sem_map
        LLM-->>Server: List[Facts]
        
        loop For each Fact
            Server->>VecDB: Embed(fact) -> Search similar memories (limit=5) | 👍 topk
            VecDB-->>Server: Related Old Memories
        end

        Note right of Server: Dedup old memories by ID<br/>(different facts may retrieve same memory)
        Note right of Server: Map UUID → integer ID<br/>(prevent LLM hallucinating UUIDs)

        Server->>LLM: Update Prompt (OldMemories + NewFacts) | 👍 sem_join
        LLM-->>Server: Operations [ADD, UPDATE, DELETE, NONE]
        
        Server->>VecDB: Execute CRUD Operations
    and Graph Mem0 Flow (if enabled)
        Server->>LLM: Entity Extraction Prompt (InputMsg) | 👍 sem_map
        LLM-->>Server: Dict[entity_name → entity_type]
        
        Server->>LLM: Relation Extraction Prompt (InputMsg + Entities) | 👍 sem_map
        LLM-->>Server: List[Relations] (Source, Rel, Dest)
        
        Note right of Server: Search uses entity_names from Step 1 (not Relations from Step 2)
        loop For each entity_name in Dict
            Server->>GraphDB: Single Cypher: Vector Sim + 1-hop Traversal | 👍 topk
            GraphDB-->>Server: Existing Triplets
        end
        
        Server->>LLM: Judge Outdated/Inaccurate/Contradictory => <br/> Delete Decision Prompt (Existing + Input) | 👍 sem_filter
        LLM-->>Server: Delete Ops
        Server->>GraphDB: Execute DELETE
        
        loop For each Relation (Src, Rel, Dest)
            Server->>GraphDB: Vector Search existing Src & Dest nodes (threshold=0.7) | 👍 topk
            GraphDB-->>Server: Matching Candidates (or empty)
            Note right of Server: 4 branches:<br/>Both found → MERGE rel<br/>Only Src → MERGE Src + CREATE Dest<br/>Only Dest → CREATE Src + MERGE Dest<br/>Neither → CREATE both + CREATE rel
            Server->>GraphDB: Execute MERGE / CREATE (Nodes + Relation)
        end
    end
    
    Server-->>Client: Success
```

## High-level SQL (LOTUS-style, SQL-pure; Conceptual) for Mem0 Insertion (`add(messages)`)

> Notes
> - This is **conceptual SQL** (not runnable) to capture Mem0’s **logical intent**.
> - Semantic operators (LLM-powered): `sem_map`, `sem_join`, `sem_filter`, `sem_agg`, `sem_topk`.
> - Non-semantic retrieval: `topk(...)` means **pure DB vector similarity top-k** (no LLM).

### A) Basic Mem0 Flow (Vector Store)

```sql
-- func: Memories(memory_id, memory_text, user_id, agent_id, run_id, embedding, created_at, ...)

-- input: CurrentMessage: (text, user_id, agent_id, run_id)

with CurrentFacts as (
    select fact from sem_map(CurrentMessage, 'Extract standalone, self-contained facts from the conversation')
),
FactResolution as (
    select
        CurrentFacts.fact,
        SelectedHistoryFacts.id, -- one-to-many
        SelectedHistoryFacts.fact,
        sem_map(
            CurrentFacts.fact, SelectedHistoryFacts.fact, ['ADD', 'UPDATE', 'DELETE', 'NOOP'],
            "Evaluate the relationship: if contradictory return DELETE, if adding details return UPDATE, if redundant return NOOP, else ADD"
        ) as fact_mem_action,
        sem_map(
            CurrentFacts.fact, SelectedHistoryFacts.fact,
            "If action is UPDATE, merge them into a comprehensive fact. Else return new_content"
        ) as enriched_fact
        -- in real workflow, fact_mem_action and enriched_fact are computed together in one LLM call
    from CurrentFacts
    cross join lateral ( -- or left join in high level
        select * from HistoryFacts where id 
        in sem_topk(CurrentFacts.fact, HistoryFacts.fact, k=5, "find top k similar facts") 
        -- here they use vector anns search, i.e. topk
    ) as SelectedHistoryFacts
)

delete from HistoryFacts where id in (
    select id from FactResolution where fact_mem_action = 'DELETE'
)

upsert into HistoryFacts (id, fact)
select
    case when fact_mem_action = 'UPDATE' then id else generate_uuid() end as id,
    enriched_fact
from FactResolution
where fact_mem_action in ('ADD', 'UPDATE', 'DELETE') -- 'delete' row also has new fact

```

### B) Graph Mem0 Flow (if enabled)

```sql
-- func: Memories(memory_id, memory_text, user_id, agent_id, run_id, embedding, created_at, ...)

-- input: CurrentMessage: (text, user_id, agent_id, run_id)
-- current entity extraction
with CurrentEntities as (
    select entity_name, entity_type 
    from sem_map(CurrentMessage, 'Extract entities from the conversation')
),
-- current relation extraction
CurrentRelations as (
    select src_entity_name, relation_description, dest_entity_name 
    from sem_map(CurrentMessage, CurrentEntities, 'Extract relationship triplets (Source, Relation, Destination)')
),
-- current entity alignment: checking existing entities
CurrentEntityAligned as (
    select
        CurrentEntities.entity_name ,
        CurrentEntities.entity_type,
        coalesce(SelectedHistoryEntities.id, generate_uuid()) as id
    from CurrentEntities
    -- Vector Search (Recall)
    left sem_join lateral (
        select * from HistoryEntities where id 
        in sem_topk(
            CurrentEntities.entity_name, HistoryEntities, k=1, threshold=0.8, "find top k similar entities"
        ) 
    ) as SelectedHistoryEntities
    -- LLM Judge (Precision)
    on sem_map(
        CurrentEntities.entity_name, SelectedHistoryEntities.entity_name, 
        ['SAME', 'DIFFERENT'], "Are these the exact same entity?"
    ) = 'SAME'
),
-- i.e. vector search + llm filter = 
-- left sem_join HistoryEntities
-- on "Do ENTITY and DATABASE ENTITY refer to the same real-world object?"

-- current relation/fact resolution
FactResolution as (
    select
        CurrentRelations.relation_description,
        SrcCurrenEntityAligned.id as src_id,
        DestCurrenEntityAligned.id as dest_id,
        HistoryRelations.id as history_id,
        sem_map(
            CurrentRelations.relation_description,
            HistoryRelations.relation_description,
            ['CONTRADICTS', 'AUGMENTS', 'NEW'], 
            "Does the new relation contradict the old one (CONTRADICTS), add detail (AUGMENTS), or is it unrelated (NEW)?"
        ) as relation_mem_action
    from CurrentRelations
    join CurrentEntityAligned as SrcCurrenEntityAligned on CurrentRelations.src_entity_name = SrcCurrenEntityAligned.entity_name
    join CurrentEntityAligned as DestCurrenEntityAligned on CurrentRelations.dest_entity_name = DestCurrenEntityAligned.entity_name
    left join HistoryRelations
    on SrcCurrenEntityAligned.id = HistoryRelations.src_id 
    or DestCurrenEntityAligned.id = HistoryRelations.dest_id -- 1-hop traversal
)

upsert into HistoryEntities (id, entity_name, entity_type)
select id, entity_name, entity_type from CurrentEntityAligned;

delete from HistoryRelations where id in (
    select id from FactResolution where relation_mem_action = 'CONTRADICTS'
);

upsert into HistoryRelations (id, src_id, dest_id, relation_description)
select 
    case when relation_mem_action = 'AUGMENTS' then id else generate_uuid() end as id,
    src_id, dest_id, relation_description
from FactResolution
where relation_mem_action in ('AUGMENTS', 'NEW', 'CONTRADICTS');

```

## Memory Search

```mermaid
sequenceDiagram
    participant Client
    participant Server as Mem0 Server
    participant LLM
    participant VecDB as Vector DB
    participant GraphDB as Graph DB (Neo4j)

    Client->>Server: search(query)

    par Basic Mem0 Retrieval
        Server->>VecDB: Embed(query) -> ANN Search | 👍 topk
        VecDB-->>Server: Top-K Facts
        opt If Reranker configured (e.g. Cohere, HuggingFace, LLM)
            Server->>Server: Rerank Top-K Facts | 👍 topk / sem_topk
        end
    and Graph Mem0 Retrieval (if enabled)
        Server->>LLM: Entity Extraction Prompt (query) | 👍 sem_map
        LLM-->>Server: Dict[entity_name → entity_type]
        
        loop For each entity_name in Dict
            Server->>GraphDB: Single Cypher: Vector Sim (≥threshold) + 1-hop Traversal | 👍 topk
            GraphDB-->>Server: Triplets (source, rel, dest) sorted by similarity
        end
        
        Server->>Server: Rerank (BM25) on Triplets (hardcoded n=5) | 👍 topk
    end
    
    Server-->>Client: Aggregated Results
```
