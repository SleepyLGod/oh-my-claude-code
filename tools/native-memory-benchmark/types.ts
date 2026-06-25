export type BenchmarkEvent = {
  sample_id: string
  event_id: string
  speaker: string
  text: string
  session_id: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export type BenchmarkQuestion = {
  question_id: string
  sample_id: string
  question: string
  gold_answer: unknown
  evidence_event_ids: string[]
  category: string
}

export type LocomoBenchmarkSample = {
  sample_id: string
  events: BenchmarkEvent[]
  questions: BenchmarkQuestion[]
}

export type BenchmarkRunConfig = {
  benchmark: 'locomo'
  input_rendering: 'message_with_event_context'
  bookkeeping_metadata_excluded_from_semantic_input: boolean
  sample_index: number
  start_row: number
  row_limit: number
  question_limit: number
  messages_per_window: number
  maintenance_mode: string
  existing_memory_dir?: string
  retrieval_mode: 'component_retrieval'
  answer_mode: 'none' | 'shared_answerer'
  selector_max_tokens: number
  selector_parse_mode: 'strict' | 'lenient'
  provider: string
  model: string
  answer_model: string
  answer_max_tokens: number
  trace_enabled: boolean
  keep_going: boolean
}

export type RetrievalResultRow = {
  question_id: string
  sample_id: string
  question: string
  gold_answer: string
  evidence_event_ids: string
  category: string
  retrieval_mode: 'component_retrieval'
  retrieved_row_count: number
  retrieved_paths: string
  retrieved_text: string
  proxy_answer_string_hit: boolean
  retrieval_anomaly_reason?: string
  selector_selected_from_trace?: string
  selector_raw_text?: string
  selector_trace_id?: string
  retrieval_latency_sec: number
  generated_answer?: string
  answer_latency_sec?: number
  answer_exact_match?: boolean
  answer_contains_gold?: boolean
  answer_f1?: number
  locomo_answer_score?: number
}
