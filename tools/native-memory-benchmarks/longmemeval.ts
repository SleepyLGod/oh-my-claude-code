import { createHash, randomUUID } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, join, resolve } from 'path'
import {
  withExecutionTraceContext,
  writeExecutionTraceEvent,
} from '../../src/utils/executionTrace.ts'
import { sideQuery } from '../../src/utils/sideQuery.ts'
import { ClaudeCodeMemorySession } from './session.ts'

const DATASET_REVISION = '98d7416c24c778c2fee6e6f3006e7a073259d48f'
const DATASET_SHA256 = 'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442'
const ANSWER_MODEL_ID = 'deepseek/deepseek-v4-flash'
const MEMORY_MODEL_ID = 'deepseek-v4-flash'
const ANSWER_PROMPT =
  'I will give you several history chats between you and a user. Please answer ' +
  'the question based on the relevant chat history.\n\n\nHistory Chats:\n\n' +
  '{context}\n\nCurrent Date: {question_date}\nQuestion: {question}\nAnswer:'
const STANDARD_JUDGE =
  'I will give you a question, a correct answer, and a response from a model. ' +
  'Please answer yes if the response contains the correct answer. Otherwise, ' +
  'answer no. If the response is equivalent to the correct answer or contains ' +
  'all the intermediate steps to get the correct answer, you should also answer ' +
  'yes. If the response only contains a subset of the information required by ' +
  'the answer, answer no. \n\nQuestion: {question}\n\nCorrect Answer: ' +
  '{answer}\n\nModel Response: {response}\n\nIs the model response correct? ' +
  'Answer yes or no only.'
const TEMPORAL_JUDGE =
  'I will give you a question, a correct answer, and a response from a model. ' +
  'Please answer yes if the response contains the correct answer. Otherwise, ' +
  'answer no. If the response is equivalent to the correct answer or contains ' +
  'all the intermediate steps to get the correct answer, you should also answer ' +
  'yes. If the response only contains a subset of the information required by ' +
  'the answer, answer no. In addition, do not penalize off-by-one errors for the ' +
  'number of days. If the question asks for the number of days/weeks/months, ' +
  "etc., and the model makes off-by-one errors (e.g., predicting 19 days when " +
  "the answer is 18), the model's response is still correct. \n\nQuestion: " +
  '{question}\n\nCorrect Answer: {answer}\n\nModel Response: {response}\n\n' +
  'Is the model response correct? Answer yes or no only.'
const UPDATE_JUDGE =
  'I will give you a question, a correct answer, and a response from a model. ' +
  'Please answer yes if the response contains the correct answer. Otherwise, ' +
  'answer no. If the response contains some previous information along with an ' +
  'updated answer, the response should be considered as correct as long as the ' +
  'updated answer is the required answer.\n\nQuestion: {question}\n\nCorrect ' +
  'Answer: {answer}\n\nModel Response: {response}\n\nIs the model response ' +
  'correct? Answer yes or no only.'
const PREFERENCE_JUDGE =
  'I will give you a question, a rubric for desired personalized response, and ' +
  'a response from a model. Please answer yes if the response satisfies the ' +
  'desired response. Otherwise, answer no. The model does not need to reflect ' +
  "all the points in the rubric. The response is correct as long as it recalls " +
  "and utilizes the user's personal information correctly.\n\nQuestion: " +
  '{question}\n\nRubric: {answer}\n\nModel Response: {response}\n\nIs the ' +
  'model response correct? Answer yes or no only.'
const ABSTENTION_JUDGE =
  'I will give you an unanswerable question, an explanation, and a response ' +
  'from a model. Please answer yes if the model correctly identifies the ' +
  'question as unanswerable. The model could say that the information is ' +
  'incomplete, or some other information is given but the asked information is ' +
  'not.\n\nQuestion: {question}\n\nExplanation: {answer}\n\nModel Response: ' +
  '{response}\n\nDoes the model correctly identify the question as unanswerable? ' +
  'Answer yes or no only.'

// Five length-stratified cases per official question type. Selection uses only
// type, event count and the abstention marker, never answer or evidence labels.
export const PILOT_30_CASE_IDS = [
  '852ce960', '2133c1b5_abs', '01493427', '830ce83f', 'cf22b7bf',
  'ba358f49', '87f22b4a', 'gpt4_372c3eed_abs', '81507db6', '37f165cf',
  '71a3fd6b', '2bf43736', '70b3e69b', 'c7cf7dfd', '5809eb10',
  'd6233ab6', '54026fce', 'caf03d32', '8a2466db', '1c0ddc50',
  '8550ddae', '86b68151', '29f2956b', '3f1e9474', '58bf7951',
  'd01c6aa8', 'gpt4_e061b84f', 'gpt4_8279ba02', 'gpt4_e414231e', '71017276',
] as const

export const LONGMEMEVAL_SMOKE_CASE_ID = '8aef76bc'
export const LONGMEMEVAL_SMOKE_SESSION_ID = 'answer_ultrachat_563222'
export const LONGMEMEVAL_SMOKE_SOURCE_EVENT_COUNT = 492
export const LONGMEMEVAL_SMOKE_EVENT_COUNT = 8

type RawTurn = { role: 'user' | 'assistant'; content: string; has_answer?: boolean }
type RawCase = {
  question_id: string
  question_type: string
  question: string
  question_date: string
  answer: unknown
  answer_session_ids: string[]
  haystack_dates: string[]
  haystack_session_ids: string[]
  haystack_sessions: RawTurn[][]
}
export type LongMemEvent = {
  sample_id: string
  event_id: string
  speaker: string
  text: string
  session_id: string
  timestamp: string
  metadata: { session_index: number; turn_index: number }
}
export type LongMemQuestion = {
  question_id: string
  sample_id: string
  question: string
  gold_answer: unknown
  evidence_event_ids: string[]
  category: string
  metadata: { question_date: string; question_type: string }
}
export type LongMemCase = {
  case_id: string
  task_id: 'longmemeval-v1'
  events: LongMemEvent[]
  questions: [LongMemQuestion]
  metadata: { source_index: number }
}
type Bundle = {
  benchmark_id: 'longmemeval-v1-cleaned-s'
  dataset_revision: string
  dataset_sha256: string
  cases: LongMemCase[]
  metadata: {
    source: 'xiaowu0162/longmemeval-cleaned'
    run_mode?: 'integration-smoke'
    source_case_event_count?: number
    included_event_count?: number
    included_session_ids?: string[]
  }
}
type Options = {
  datasetPath: string
  outputDir: string
  caseIds: string[]
  provider: string
  nativeModel: string
  answerProviderModel: string
  judgeProviderModel: string
  answerModelId: string
  judgeModelId: string
  resume: boolean
  smoke: boolean
  stopAfterMaintenance: boolean
  maxNewCases?: number
}

type CaseWorkerRequest = {
  options: Options
  bundlePath: string
  caseId: string
}

const ANSWER_PROMPT_DIGEST = sha256(ANSWER_PROMPT)
const JUDGE_PROMPT_DIGEST = sha256(canonicalJson([
  STANDARD_JUDGE,
  TEMPORAL_JUDGE,
  UPDATE_JUDGE,
  PREFERENCE_JUDGE,
  ABSTENTION_JUDGE,
]))

export function taskContractFingerprint(judgeModelId: string): string {
  return sha256(canonicalJson({
    task_id: 'longmemeval-v1',
    answer_prompt_digest: ANSWER_PROMPT_DIGEST,
    scorer_id: `longmemeval_judge:${judgeModelId}`,
    scorer_digest: JUDGE_PROMPT_DIGEST,
  }))
}

export function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>()
  const allowed = new Set([
    '--dataset-path',
    '--output-dir',
    '--case-ids',
    '--provider',
    '--native-model',
    '--answer-provider-model',
    '--judge-provider-model',
    '--answer-model-id',
    '--judge-model-id',
    '--max-new-cases',
  ])
  let resume = false
  let smoke = false
  let stopAfterMaintenance = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!
    if (name === '--resume') {
      resume = true
      continue
    }
    if (name === '--smoke') {
      smoke = true
      continue
    }
    if (name === '--stop-after-maintenance') {
      stopAfterMaintenance = true
      continue
    }
    const value = argv[index + 1]
    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${name}`)
    }
    if (!allowed.has(name)) throw new Error(`invalid argument ${name}`)
    values.set(name, value)
    index += 1
  }
  const datasetPath = values.get('--dataset-path')
  const outputDir = values.get('--output-dir')
  if (!datasetPath || !outputDir) {
    throw new Error('--dataset-path and --output-dir are required')
  }
  if (smoke && values.has('--case-ids')) {
    throw new Error('--smoke and --case-ids are mutually exclusive')
  }
  if (stopAfterMaintenance && !smoke) {
    throw new Error('--stop-after-maintenance requires --smoke')
  }
  const caseIds = smoke
    ? [LONGMEMEVAL_SMOKE_CASE_ID]
    : values.get('--case-ids')?.split(',').filter(Boolean) ?? [...PILOT_30_CASE_IDS]
  if (caseIds.length === 0 || caseIds.length !== new Set(caseIds).size) {
    throw new Error('--case-ids must contain unique comma-separated IDs')
  }
  const maxNewCasesText = values.get('--max-new-cases')
  const maxNewCases = maxNewCasesText === undefined ? undefined : Number(maxNewCasesText)
  if (maxNewCases !== undefined && (!Number.isInteger(maxNewCases) || maxNewCases < 1)) {
    throw new Error('--max-new-cases must be a positive integer')
  }
  return {
    datasetPath: resolve(datasetPath),
    outputDir: resolve(outputDir),
    caseIds,
    provider: values.get('--provider') ?? 'deepseek-anthropic',
    nativeModel: values.get('--native-model') ?? 'deepseek-v4-flash[1m]',
    answerProviderModel: values.get('--answer-provider-model') ?? 'deepseek-v4-flash[1m]',
    judgeProviderModel: values.get('--judge-provider-model') ?? 'deepseek-v4-flash[1m]',
    answerModelId: values.get('--answer-model-id') ?? ANSWER_MODEL_ID,
    judgeModelId: values.get('--judge-model-id') ?? ANSWER_MODEL_ID,
    resume,
    smoke,
    stopAfterMaintenance,
    maxNewCases,
  }
}

export function normalizeDataset(records: RawCase[], caseIds: readonly string[]): Bundle {
  if (records.length !== 500) throw new Error('pinned LongMemEval dataset must contain 500 cases')
  const selected = new Set(caseIds)
  const cases = records
    .map((record, sourceIndex) => ({ record, sourceIndex }))
    .filter(({ record }) => selected.has(record.question_id))
    .map(({ record, sourceIndex }) => normalizeCase(record, sourceIndex))
  const seen = new Set(cases.map(item => item.case_id))
  const missing = caseIds.filter(caseId => !seen.has(caseId))
  if (missing.length > 0) throw new Error(`unknown LongMemEval case IDs: ${missing.join(', ')}`)
  const byId = new Map(cases.map(item => [item.case_id, item]))
  return {
    benchmark_id: 'longmemeval-v1-cleaned-s',
    dataset_revision: DATASET_REVISION,
    dataset_sha256: DATASET_SHA256,
    cases: caseIds.map(caseId => byId.get(caseId)!),
    metadata: { source: 'xiaowu0162/longmemeval-cleaned' },
  }
}

export function normalizeSmokeDataset(records: RawCase[]): Bundle {
  const bundle = normalizeDataset(records, [LONGMEMEVAL_SMOKE_CASE_ID])
  const item = bundle.cases[0]!
  if (item.events.length !== LONGMEMEVAL_SMOKE_SOURCE_EVENT_COUNT) {
    throw new Error(
      `LongMemEval smoke source event count changed: expected ${LONGMEMEVAL_SMOKE_SOURCE_EVENT_COUNT}, got ${item.events.length}`,
    )
  }
  const prefix = item.events.slice(0, LONGMEMEVAL_SMOKE_EVENT_COUNT)
  if (
    prefix.length !== LONGMEMEVAL_SMOKE_EVENT_COUNT ||
    prefix.some(event => event.session_id !== LONGMEMEVAL_SMOKE_SESSION_ID) ||
    item.events[LONGMEMEVAL_SMOKE_EVENT_COUNT]?.session_id === LONGMEMEVAL_SMOKE_SESSION_ID
  ) {
    throw new Error('LongMemEval smoke session shape changed')
  }
  const prefixIds = new Set(prefix.map(event => event.event_id))
  const evidenceIds = item.questions[0].evidence_event_ids
  if (evidenceIds.length === 0 || evidenceIds.some(eventId => !prefixIds.has(eventId))) {
    throw new Error('LongMemEval smoke prefix no longer contains all evidence')
  }
  return {
    ...bundle,
    cases: [{ ...item, events: prefix }],
    metadata: {
      ...bundle.metadata,
      run_mode: 'integration-smoke',
      source_case_event_count: item.events.length,
      included_event_count: prefix.length,
      included_session_ids: [LONGMEMEVAL_SMOKE_SESSION_ID],
    },
  }
}

function normalizeCase(record: RawCase, sourceIndex: number): LongMemCase {
  const { question_id: questionId, question_type: questionType } = record
  if (!questionId || !questionType || !record.question || !record.question_date) {
    throw new Error('LongMemEval case requires question identity and text')
  }
  if (
    record.haystack_dates.length !== record.haystack_session_ids.length ||
    record.haystack_dates.length !== record.haystack_sessions.length
  ) {
    throw new Error(`LongMemEval case ${questionId} has misaligned sessions`)
  }
  const sessions = record.haystack_dates.map((date, originalIndex) => ({
    date,
    originalIndex,
    parsed: parseTimestamp(date),
    sessionId: record.haystack_session_ids[originalIndex]!,
    turns: record.haystack_sessions[originalIndex]!,
  })).sort((left, right) => left.parsed.localeCompare(right.parsed) || left.originalIndex - right.originalIndex)
  const answerSessions = new Set(record.answer_session_ids)
  const explicitEvidence: string[] = []
  const fallbackEvidence: string[] = []
  const events: LongMemEvent[] = []
  for (const session of sessions) {
    for (const [turnIndex, turn] of session.turns.entries()) {
      if (!['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string') {
        throw new Error('LongMemEval turns require user/assistant text')
      }
      const eventId = `${questionId}:s${session.originalIndex}:t${turnIndex}`
      events.push({
        sample_id: questionId,
        event_id: eventId,
        speaker: turn.role,
        text: turn.content,
        session_id: session.sessionId,
        timestamp: session.parsed,
        metadata: { session_index: session.originalIndex, turn_index: turnIndex },
      })
      if (turn.has_answer === true) explicitEvidence.push(eventId)
      if (answerSessions.has(session.sessionId)) fallbackEvidence.push(eventId)
    }
  }
  parseTimestamp(record.question_date)
  return {
    case_id: questionId,
    task_id: 'longmemeval-v1',
    events,
    questions: [{
      question_id: questionId,
      sample_id: questionId,
      question: record.question,
      gold_answer: record.answer,
      evidence_event_ids: explicitEvidence.length > 0 ? explicitEvidence : fallbackEvidence,
      category: questionId.endsWith('_abs') ? 'abstention' : questionType,
      metadata: { question_date: record.question_date, question_type: questionType },
    }],
    metadata: { source_index: sourceIndex },
  }
}

export function bundleFingerprint(bundle: Bundle, includeLabels: boolean): string {
  return sha256(canonicalJson({
    benchmark_id: bundle.benchmark_id,
    dataset_revision: bundle.dataset_revision,
    dataset_sha256: bundle.dataset_sha256,
    cases: bundle.cases.map(item => ({
      case_id: item.case_id,
      task_id: item.task_id,
      events: item.events,
      ...(includeLabels ? { questions: item.questions, metadata: item.metadata } : {}),
    })),
    metadata: includeLabels ? bundle.metadata : {},
  }))
}

function parseTimestamp(value: string): string {
  const normalized = value.trim().replace(/\s*\([^)]*\)\s*/g, ' ')
  const numeric = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?:\s*(am|pm))?)?$/i)
  const named = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?)?$/i)
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
  let year: number
  let month: number
  let day: number
  let hourText: string | undefined
  let minuteText: string | undefined
  let meridiem: string | undefined
  if (numeric) {
    year = Number(numeric[1]); month = Number(numeric[2]); day = Number(numeric[3])
    hourText = numeric[4]; minuteText = numeric[5]; meridiem = numeric[6]
  } else if (named) {
    year = Number(named[3]); month = months.indexOf(named[1]!.toLowerCase()) + 1; day = Number(named[2])
    hourText = named[4]; minuteText = named[5]; meridiem = named[6]
    if (month === 0) throw new Error(`invalid LongMemEval timestamp ${value}`)
  } else {
    throw new Error(`invalid LongMemEval timestamp ${value}`)
  }
  let hour = Number(hourText ?? 0)
  const minute = Number(minuteText ?? 0)
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error(`invalid LongMemEval timestamp ${value}`)
    hour %= 12
    if (meridiem.toLowerCase() === 'pm') hour += 12
  }
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`
}

function renderAnswer(question: LongMemQuestion, context: string): string {
  return ANSWER_PROMPT
    .replace('{context}', context)
    .replace('{question_date}', question.metadata.question_date)
    .replace('{question}', question.question)
}

function renderJudge(question: LongMemQuestion, response: string): string {
  const values = { question: question.question, answer: String(question.gold_answer ?? ''), response }
  let template: string
  if (question.category === 'abstention' || question.question_id.endsWith('_abs')) template = ABSTENTION_JUDGE
  else if (['single-session-user', 'single-session-assistant', 'multi-session'].includes(question.metadata.question_type)) template = STANDARD_JUDGE
  else if (question.metadata.question_type === 'temporal-reasoning') template = TEMPORAL_JUDGE
  else if (question.metadata.question_type === 'knowledge-update') template = UPDATE_JUDGE
  else if (question.metadata.question_type === 'single-session-preference') template = PREFERENCE_JUDGE
  else throw new Error(`unsupported LongMemEval question type ${question.metadata.question_type}`)
  return template.replace('{question}', values.question).replace('{answer}', values.answer).replace('{response}', values.response)
}

async function completeText(params: {
  prompt: string
  model: string
  maxTokens: number
  phase: 'answering' | 'grading'
  caseId: string
  questionId: string
  promptName: string
}): Promise<string> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await withExecutionTraceContext({
        caseId: params.caseId,
        questionId: params.questionId,
        phase: params.phase,
        querySource: params.promptName,
        attempt,
      }, async () => await sideQuery({
        model: params.model,
        messages: [{ role: 'user', content: params.prompt }],
        max_tokens: params.maxTokens,
        temperature: 0,
        thinking: false,
        skipSystemPromptPrefix: true,
        signal: new AbortController().signal,
        querySource: params.promptName as never,
      }))
      const text = response.content.find(block => block.type === 'text')
      const value = text?.type === 'text' ? text.text.trim() : ''
      if (!value) throw new Error(`${params.promptName} returned empty text`)
      return value
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      writeExecutionTraceEvent('benchmark_parse_retry', {
        phase: params.phase,
        case_id: params.caseId,
        question_id: params.questionId,
        prompt_name: params.promptName,
        attempt,
        error: lastError.message,
      })
    }
  }
  throw lastError ?? new Error(`${params.promptName} failed`)
}

async function runCase(options: Options, bundle: Bundle, item: LongMemCase): Promise<void> {
  const caseDir = join(options.outputDir, 'cases', safeName(item.case_id))
  const statusPath = join(caseDir, 'status.json')
  if (existsSync(statusPath) && readJson(statusPath).status === 'completed') return
  mkdirSync(caseDir, { recursive: true })
  const attempt = Number((existsSync(statusPath) ? readJson(statusPath).attempt : 0) ?? 0) + 1
  writeJson(statusPath, { status: 'running', case_id: item.case_id, attempt })
  const stateDir = join(caseDir, 'state', `attempt-${String(attempt).padStart(4, '0')}`)
  const traceDir = join(options.outputDir, 'trace')
  const session = await ClaudeCodeMemorySession.create({
    stateDir,
    traceDir,
    provider: options.provider,
    model: options.nativeModel,
    selectorParseMode: 'lenient',
    caseId: item.case_id,
    attempt,
  })
  try {
    const checkpoint = loadCheckpoint(options, bundle, item)
    let completedCount = 0
    if (checkpoint) {
      const restoreStarted = performance.now()
      await session.restoreState(join(checkpoint.directory, 'driver'), checkpoint.events)
      completedCount = checkpoint.events.length
      appendJsonl(join(options.outputDir, 'metrics', 'checkpoint_metrics.jsonl'), {
        case_id: item.case_id,
        operation: 'restore',
        completed_event_count: completedCount,
        checkpoint_id: basename(checkpoint.directory),
        checkpoint_bytes: directoryBytes(checkpoint.directory),
        wall_latency_ms: round3(performance.now() - restoreStarted),
      })
    }
    const priorEventIds = new Set(
      readJsonl(join(options.outputDir, 'metrics', 'per_event.jsonl'))
        .filter(row => row.case_id === item.case_id)
        .map(row => String(row.event_id ?? '')),
    )
    for (let index = completedCount; index < item.events.length; index += 1) {
      const event = item.events[index]!
      const started = performance.now()
      const metrics = await session.add(event)
      appendJsonl(join(options.outputDir, 'metrics', 'per_event.jsonl'), {
        case_id: item.case_id,
        event_id: event.event_id,
        session_id: event.session_id,
        attempt,
        replayed: priorEventIds.has(event.event_id),
        wall_latency_ms: round3(performance.now() - started),
        ...metrics,
      })
      const next = item.events[index + 1]
      if (!next || next.session_id !== event.session_id) {
        const finishStarted = performance.now()
        const finishMetrics = await session.finishSession(event.session_id)
        appendJsonl(join(options.outputDir, 'metrics', 'per_session.jsonl'), {
          case_id: item.case_id,
          session_id: event.session_id,
          attempt,
          completed_event_count: index + 1,
          wall_latency_ms: round3(performance.now() - finishStarted),
          ...finishMetrics,
        })
        await saveCheckpoint(options, bundle, item, session, index + 1)
      }
    }
    if (options.stopAfterMaintenance) {
      writeJson(statusPath, {
        status: 'maintenance_completed',
        case_id: item.case_id,
        attempt,
        completed_event_count: item.events.length,
      })
      return
    }
    const question = item.questions[0]
    const retrievalStarted = performance.now()
    const retrieval = await session.retrieve({
      question_id: question.question_id,
      query_text: `Current Date: ${question.metadata.question_date}\nQuestion: ${question.question}`,
    })
    const retrievalLatency = round3(performance.now() - retrievalStarted)
    writeJsonl(join(caseDir, 'retrieval.jsonl'), [{
      question_id: question.question_id,
      query: `Current Date: ${question.metadata.question_date}\nQuestion: ${question.question}`,
      context: retrieval.context,
      channels: retrieval.channels,
      metrics: retrieval.metrics,
      latency_ms: retrievalLatency,
    }])
    const answerStarted = performance.now()
    const answer = await completeText({
      prompt: renderAnswer(question, retrieval.context),
      model: options.answerProviderModel,
      maxTokens: 8192,
      phase: 'answering',
      caseId: item.case_id,
      questionId: question.question_id,
      promptName: 'longmemeval.answer',
    })
    const answerLatency = round3(performance.now() - answerStarted)
    writeJsonl(join(caseDir, 'answers.jsonl'), [{ question_id: question.question_id, answer, latency_ms: answerLatency }])
    const judgeStarted = performance.now()
    const judge = await completeText({
      prompt: renderJudge(question, answer),
      model: options.judgeProviderModel,
      maxTokens: 10,
      phase: 'grading',
      caseId: item.case_id,
      questionId: question.question_id,
      promptName: 'longmemeval.judge',
    })
    const correct = judge.trim().toLowerCase().includes('yes')
    writeJsonl(join(caseDir, 'grades.jsonl'), [{
      question_id: question.question_id,
      scorer_id: `longmemeval_judge:${options.judgeModelId}`,
      score: correct ? 1 : 0,
      label: correct ? 'yes' : 'no',
      latency_ms: round3(performance.now() - judgeStarted),
      details: {
        judge_model_id: options.judgeModelId,
        official_evaluator_contract: true,
        official_metric_model: ['gpt-4o', 'gpt-4o-2024-08-06', 'openai/gpt-4o-2024-08-06'].includes(options.judgeModelId),
      },
    }])
    writeJson(statusPath, { status: 'completed', case_id: item.case_id, attempt })
  } catch (error) {
    writeJson(statusPath, {
      status: 'failed',
      case_id: item.case_id,
      attempt,
      error_type: error instanceof Error ? error.name : 'Error',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    await session.close()
  }
}

type Checkpoint = { directory: string; events: LongMemEvent[] }

function loadCheckpoint(options: Options, bundle: Bundle, item: LongMemCase): Checkpoint | undefined {
  const root = join(options.outputDir, 'cases', safeName(item.case_id), 'checkpoints')
  const pointerPath = join(root, 'current.json')
  if (!existsSync(pointerPath)) return undefined
  const pointer = readJson(pointerPath)
  const checkpointId = String(pointer.checkpoint_id ?? '')
  const directory = join(root, 'snapshots', checkpointId)
  const manifest = readJson(join(directory, 'manifest.json'))
  const expected = {
    case_id: item.case_id,
    policy_input_fingerprint: bundleFingerprint(bundle, false),
    system_id: 'native-claude',
    maintenance_rule: 'native-extraction-session-consolidation',
    parser_mode: 'lenient',
    thinking_enabled: false,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) throw new Error(`checkpoint mismatch for ${key}`)
  }
  const eventIds = manifest.completed_event_ids
  if (!Array.isArray(eventIds)) throw new Error('checkpoint is missing completed_event_ids')
  const events = item.events.slice(0, eventIds.length)
  if (canonicalJson(events.map(event => event.event_id)) !== canonicalJson(eventIds)) {
    throw new Error('checkpoint event prefix does not match LongMemEval input')
  }
  return { directory, events }
}

async function saveCheckpoint(
  options: Options,
  bundle: Bundle,
  item: LongMemCase,
  session: ClaudeCodeMemorySession,
  completedCount: number,
): Promise<void> {
  const started = performance.now()
  const root = join(options.outputDir, 'cases', safeName(item.case_id), 'checkpoints')
  const last = item.events[completedCount - 1]!
  const checkpointId = [
    `events-${String(completedCount).padStart(6, '0')}`,
    sha256(canonicalJson(last)).slice(0, 12),
    randomUUID().slice(0, 8),
  ].join('-')
  const snapshot = join(root, 'snapshots', checkpointId)
  const staging = join(root, 'staging', `${checkpointId}-${randomUUID()}`)
  const driverState = await session.saveState(join(staging, 'driver'))
  writeJson(join(staging, 'manifest.json'), {
    schema_version: 1,
    checkpoint_id: checkpointId,
    case_id: item.case_id,
    policy_input_fingerprint: bundleFingerprint(bundle, false),
    system_id: 'native-claude',
    maintenance_rule: 'native-extraction-session-consolidation',
    parser_mode: 'lenient',
    thinking_enabled: false,
    completed_session_id: last.session_id,
    completed_event_ids: item.events.slice(0, completedCount).map(event => event.event_id),
    driver_state: driverState,
  })
  mkdirSync(dirname(snapshot), { recursive: true })
  renameSync(staging, snapshot)
  const pointerTemp = join(root, `current-${randomUUID()}.json`)
  writeJson(pointerTemp, { schema_version: 1, checkpoint_id: checkpointId })
  renameSync(pointerTemp, join(root, 'current.json'))
  appendJsonl(join(options.outputDir, 'metrics', 'checkpoint_metrics.jsonl'), {
    case_id: item.case_id,
    operation: 'save',
    checkpoint_id: checkpointId,
    completed_event_count: completedCount,
    checkpoint_bytes: directoryBytes(snapshot),
    wall_latency_ms: round3(performance.now() - started),
  })
}

function initializeRun(options: Options, bundle: Bundle): void {
  if (existsSync(options.outputDir) && !options.resume) {
    throw new Error(`--output-dir already exists; use --resume: ${options.outputDir}`)
  }
  mkdirSync(options.outputDir, { recursive: true })
  const scorerId = `longmemeval_judge:${options.judgeModelId}`
  const contractFingerprint = taskContractFingerprint(options.judgeModelId)
  const manifest = {
    schema_version: 3,
    benchmark_id: bundle.benchmark_id,
    dataset_revision: bundle.dataset_revision,
    dataset_sha256: bundle.dataset_sha256,
    bundle_fingerprint: bundleFingerprint(bundle, true),
    policy_input_fingerprint: bundleFingerprint(bundle, false),
    case_ids: bundle.cases.map(item => item.case_id),
    question_ids: bundle.cases.map(item => item.questions[0].question_id),
    system_id: 'native-claude',
    condition_id: 'native',
    memory_model_id: MEMORY_MODEL_ID,
    memory_provider_model_id: options.nativeModel,
    input_adapter_id: 'native-claude-benchmark-event-wrapper:v1',
    input_adapter_digest: sha256('native-claude-benchmark-event-wrapper:v1'),
    retrieval_recipe_id: 'native-claude-find-relevant-memories-lenient:v1',
    retrieval_recipe_digest: sha256('native-claude-find-relevant-memories-lenient:v1'),
    maintenance_rule: 'native-extraction-session-consolidation',
    maintenance_fingerprint: sha256(canonicalJson({
      maintenance_rule: 'native-extraction-session-consolidation',
      memory_model_id: MEMORY_MODEL_ID,
      thinking_enabled: false,
      consolidation_mode: 'direct-dream-each-session',
    })),
    thinking_enabled: false,
    consolidation_mode: 'direct-dream-each-session',
    parser_mode: 'lenient',
    framework_cache_mode: 'product-default',
    checkpoint_enabled: true,
    answer_model_id: options.answerModelId,
    answer_provider_model_id: options.answerProviderModel,
    judge_model_id: options.judgeModelId,
    judge_provider_model_id: options.judgeProviderModel,
    contract_fingerprints: { 'longmemeval-v1': contractFingerprint },
    answer_prompt_digests: { 'longmemeval-v1': ANSWER_PROMPT_DIGEST },
    scorer_contracts: { 'longmemeval-v1': { scorer_id: scorerId, scorer_digest: JUDGE_PROMPT_DIGEST } },
    run_mode: bundle.metadata.run_mode ?? 'full',
    maintenance_checkpoint_source: null,
  }
  const manifestPath = join(options.outputDir, 'manifest.json')
  if (existsSync(manifestPath)) {
    if (canonicalJson(readJson(manifestPath)) !== canonicalJson(manifest)) {
      throw new Error('existing output has a different LongMemEval run contract')
    }
  } else {
    writeJson(manifestPath, manifest)
    writeInputs(options.outputDir, bundle)
  }
  mkdirSync(join(options.outputDir, 'metrics'), { recursive: true })
  mkdirSync(join(options.outputDir, 'trace'), { recursive: true })
}

function writeInputs(outputDir: string, bundle: Bundle): void {
  const input = join(outputDir, 'input')
  mkdirSync(input, { recursive: true })
  writeJson(join(input, 'manifest.json'), {
    schema_version: 1,
    benchmark_id: bundle.benchmark_id,
    dataset_revision: bundle.dataset_revision,
    dataset_sha256: bundle.dataset_sha256,
    case_count: bundle.cases.length,
    event_count: bundle.cases.reduce((sum, item) => sum + item.events.length, 0),
    question_count: bundle.cases.length,
    fingerprint: bundleFingerprint(bundle, true),
    policy_input_fingerprint: bundleFingerprint(bundle, false),
    metadata: bundle.metadata,
  })
  writeJsonl(join(input, 'cases.jsonl'), bundle.cases.map(item => ({
    case_id: item.case_id,
    task_id: item.task_id,
    event_ids: item.events.map(event => event.event_id),
    question_ids: item.questions.map(question => question.question_id),
    metadata: item.metadata,
  })))
  writeJsonl(join(input, 'events.jsonl'), bundle.cases.flatMap(item => item.events.map(event => ({ ...event, case_id: item.case_id }))))
  writeJsonl(join(input, 'questions.jsonl'), bundle.cases.flatMap(item => item.questions.map(question => ({ ...question, case_id: item.case_id }))))
  // Case workers read the already-normalized selection so product-global state
  // is isolated without re-reading the full 500-case source dataset.
  writeJson(join(input, 'native_bundle.json'), bundle)
}

function finalizeMetrics(options: Options, bundle: Bundle): void {
  const questionRows: Array<Record<string, unknown>> = []
  const hypotheses: Array<Record<string, unknown>> = []
  let completedCases = 0
  let failedCases = 0
  for (const item of bundle.cases) {
    const caseDir = join(options.outputDir, 'cases', safeName(item.case_id))
    const status = existsSync(join(caseDir, 'status.json')) ? readJson(join(caseDir, 'status.json')) : {}
    if (status.status === 'completed') completedCases += 1
    else if (status.status === 'failed') failedCases += 1
    if (status.status !== 'completed') continue
    const retrieval = readJsonl(join(caseDir, 'retrieval.jsonl'))[0] ?? {}
    const answer = readJsonl(join(caseDir, 'answers.jsonl'))[0] ?? {}
    const grade = readJsonl(join(caseDir, 'grades.jsonl'))[0] ?? {}
    const answerText = String(answer.answer ?? '')
    const goldAnswer = item.questions[0].gold_answer
    const channels = isRecord(retrieval.channels) ? retrieval.channels : {}
    const retrievalReturnedCount = Object.values(channels).reduce(
      (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
      0,
    )
    questionRows.push({
      case_id: item.case_id,
      question_id: item.questions[0].question_id,
      retrieval_latency_ms: retrieval.latency_ms ?? '',
      retrieval_returned_count: retrievalReturnedCount,
      answer_latency_ms: answer.latency_ms ?? '',
      scorer_id: grade.scorer_id ?? '',
      score: grade.score ?? '',
      grading_latency_ms: grade.latency_ms ?? '',
      answer: answerText,
      exact_match: Number(normalizedText(answerText) === normalizedText(goldAnswer)),
      contains_match: Number(
        normalizedText(goldAnswer).length > 0 &&
          normalizedText(answerText).includes(normalizedText(goldAnswer)),
      ),
      token_f1: tokenF1(answerText, goldAnswer),
      empty_retrieval: Number(!String(retrieval.context ?? '').trim()),
    })
    hypotheses.push({ question_id: item.questions[0].question_id, hypothesis: answer.answer ?? '' })
  }
  writeCsv(join(options.outputDir, 'metrics', 'per_question.csv'), questionRows)
  writeJsonl(join(options.outputDir, 'official_hypotheses.jsonl'), hypotheses)
  const providerRows = normalizeProviderTrace(join(options.outputDir, 'trace', 'events.jsonl'))
  writeCsv(join(options.outputDir, 'metrics', 'provider_usage.csv'), providerRows)
  const previousMemoryBytes = new Map<string, number>()
  const eventRows = readJsonl(join(options.outputDir, 'metrics', 'per_event.jsonl')).map(row => {
    const caseId = String(row.case_id ?? '')
    const memoryBytes = optionalNumber(row.memory_total_bytes)
    const deltaMemoryBytes = memoryBytes === null
      ? null
      : memoryBytes - (previousMemoryBytes.get(caseId) ?? 0)
    if (memoryBytes !== null) previousMemoryBytes.set(caseId, memoryBytes)
    return {
      ...row,
      delta_memory_total_bytes: deltaMemoryBytes,
      ...providerRollup(providerRows.filter(call =>
        call.case_id === row.case_id &&
          call.event_id === row.event_id &&
          call.attempt === row.attempt
      )),
    }
  })
  const sessionRows = readJsonl(join(options.outputDir, 'metrics', 'per_session.jsonl')).map(row => {
    const sessionEvents = eventRows.filter(event =>
      event.case_id === row.case_id &&
        event.session_id === row.session_id &&
        event.attempt === row.attempt
    )
    return {
      ...row,
      event_count: sessionEvents.length,
      insertion_wall_latency_ms: round3(
        sessionEvents.reduce(
          (sum, event) => sum + Number(event.wall_latency_ms ?? 0),
          0,
        ),
      ),
      consolidation_wall_latency_ms: row.wall_latency_ms,
      ...providerRollup(providerRows.filter(call =>
        call.case_id === row.case_id &&
          call.session_id === row.session_id &&
          call.attempt === row.attempt
      )),
    }
  })
  const scores = questionRows.map(row => Number(row.score)).filter(Number.isFinite)
  const totalCost = providerRows.every(row => row.estimated_cost_usd !== null)
    ? providerRows.reduce((sum, row) => sum + Number(row.estimated_cost_usd), 0)
    : null
  const phaseRows = new Map<string, Array<Record<string, unknown>>>()
  for (const row of providerRows) {
    const phase = String(row.phase ?? 'unknown')
    phaseRows.set(phase, [...(phaseRows.get(phase) ?? []), row])
  }
  const summary = {
    completed_cases: completedCases,
    failed_cases: failedCases,
    question_count: questionRows.length,
    mean_score: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    provider_call_count: providerRows.length,
    provider_error_count: providerRows.filter(row => row.status === 'error').length,
    usage_complete: providerRows.every(row => row.usage_available === true),
    prompt_tokens: sumKnown(providerRows, 'prompt_tokens'),
    cache_hit_tokens: sumKnown(providerRows, 'cache_hit_tokens'),
    cache_miss_tokens: sumKnown(providerRows, 'cache_miss_tokens'),
    completion_tokens: sumKnown(providerRows, 'completion_tokens'),
    estimated_cost_usd: totalCost,
    phases: Object.fromEntries(
      [...phaseRows.entries()].map(([phase, rows]) => [phase, providerRollup(rows)]),
    ),
    insertion_wall_latency: latencyStats(
      eventRows
        .map(row => optionalNumber(row.wall_latency_ms))
        .filter((value): value is number => value !== null),
    ),
    retrieval_wall_latency: latencyStats(
      questionRows
        .map(row => optionalNumber(row.retrieval_latency_ms))
        .filter((value): value is number => value !== null),
    ),
    answering_wall_latency: latencyStats(
      questionRows
        .map(row => optionalNumber(row.answer_latency_ms))
        .filter((value): value is number => value !== null),
    ),
    grading_wall_latency: latencyStats(
      questionRows
        .map(row => optionalNumber(row.grading_latency_ms))
        .filter((value): value is number => value !== null),
    ),
    consolidation_wall_latency: latencyStats(
      sessionRows
        .map(row => optionalNumber(row.wall_latency_ms))
        .filter((value): value is number => value !== null),
    ),
    checkpoint_wall_latency: latencyStats(
      readJsonl(join(options.outputDir, 'metrics', 'checkpoint_metrics.jsonl'))
        .map(row => optionalNumber(row.wall_latency_ms))
        .filter((value): value is number => value !== null),
    ),
  }
  writeJson(join(options.outputDir, 'metrics', 'summary.json'), summary)
  writeCsv(join(options.outputDir, 'metrics', 'overview.csv'), [{
    condition_id: 'native',
    completed_cases: completedCases,
    failed_cases: failedCases,
    question_count: questionRows.length,
    mean_score: summary.mean_score,
    provider_call_count: summary.provider_call_count,
    provider_error_count: summary.provider_error_count,
    usage_complete: summary.usage_complete,
    prompt_tokens: summary.prompt_tokens,
    cache_hit_tokens: summary.cache_hit_tokens,
    cache_miss_tokens: summary.cache_miss_tokens,
    provider_cache_hit_ratio: summary.cache_hit_tokens + summary.cache_miss_tokens > 0
      ? summary.cache_hit_tokens / (summary.cache_hit_tokens + summary.cache_miss_tokens)
      : null,
    framework_cache_mode: 'product-default',
    completion_tokens: summary.completion_tokens,
    estimated_cost_usd: summary.estimated_cost_usd,
    insertion_mean_latency_ms: summary.insertion_wall_latency.mean_ms,
    insertion_p95_latency_ms: summary.insertion_wall_latency.p95_ms,
    insertion_median_latency_ms: summary.insertion_wall_latency.median_ms,
    retrieval_mean_latency_ms: summary.retrieval_wall_latency.mean_ms,
    retrieval_median_latency_ms: summary.retrieval_wall_latency.median_ms,
    retrieval_p95_latency_ms: summary.retrieval_wall_latency.p95_ms,
    answering_mean_latency_ms: summary.answering_wall_latency.mean_ms,
    answering_median_latency_ms: summary.answering_wall_latency.median_ms,
    answering_p95_latency_ms: summary.answering_wall_latency.p95_ms,
    grading_mean_latency_ms: summary.grading_wall_latency.mean_ms,
    grading_median_latency_ms: summary.grading_wall_latency.median_ms,
    grading_p95_latency_ms: summary.grading_wall_latency.p95_ms,
  }])
  writeCsv(join(options.outputDir, 'metrics', 'per_event.csv'), eventRows)
  writeCsv(join(options.outputDir, 'metrics', 'per_session.csv'), sessionRows)
  const checkpointRows = readJsonl(join(options.outputDir, 'metrics', 'checkpoint_metrics.jsonl'))
  writeCsv(join(options.outputDir, 'metrics', 'checkpoint_metrics.csv'), checkpointRows)
  const traceEvents = readJsonl(join(options.outputDir, 'trace', 'events.jsonl'))
  writeCsv(join(options.outputDir, 'metrics', 'reliability.csv'), [{
    condition_id: 'native', completed_cases: completedCases, failed_cases: failedCases,
    empty_retrieval_count: questionRows.filter(row => row.empty_retrieval === 1).length,
    restore_count: checkpointRows.filter(row => row.operation === 'restore').length,
    parse_retry_count: traceEvents.filter(row => row.event_type === 'benchmark_parse_retry').length,
    replay_event_count: eventRows.filter(row => row.replayed === true).length,
    provider_error_count: providerRows.filter(row => row.status === 'error').length,
    usage_complete: providerRows.every(row => row.usage_available === true),
  }])
  const latestByCase = new Map<string, Record<string, unknown>>()
  for (const row of eventRows) latestByCase.set(String(row.case_id), row)
  writeCsv(join(options.outputDir, 'metrics', 'state_shape.csv'), [...latestByCase.values()].map(row => ({
    case_id: row.case_id,
    memory_file_count: row.memory_file_count ?? '',
    memory_total_bytes: row.memory_total_bytes ?? '',
  })))
  const callsByPhase = new Map<string, Array<Record<string, unknown>>>()
  for (const row of providerRows) {
    const key = `${String(row.phase || 'unknown')}\u0000${String(row.operator || '')}`
    callsByPhase.set(key, [...(callsByPhase.get(key) ?? []), row])
  }
  const operatorRows = [...callsByPhase.entries()].map(([key, rows]) => ({
    phase: key.split('\u0000', 1)[0],
    operator: key.slice(key.indexOf('\u0000') + 1),
    logical_call_count: new Set(rows.map(row => String(row.trace_id ?? ''))).size,
    physical_call_count: rows.length,
    retry_count: null,
    provider_latency_sum_ms: rows.reduce((sum, row) => sum + Number(row.latency_ms ?? 0), 0),
    prompt_tokens: sumKnown(rows, 'prompt_tokens'),
    cache_hit_tokens: sumKnown(rows, 'cache_hit_tokens'),
    cache_miss_tokens: sumKnown(rows, 'cache_miss_tokens'),
    completion_tokens: sumKnown(rows, 'completion_tokens'),
    estimated_cost_usd: rows.every(row => row.estimated_cost_usd !== null)
      ? rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd), 0)
      : null,
  }))
  writeCsv(join(options.outputDir, 'metrics', 'operator_usage.csv'), operatorRows)
}

function normalizeProviderTrace(path: string): Array<Record<string, unknown>> {
  return readJsonl(path)
    .filter(event => ['llm_call_finish', 'llm_call_error'].includes(String(event.event_type)))
    .map(event => {
      const usage = typeof event.usage === 'object' && event.usage ? event.usage as Record<string, unknown> : {}
      const hit = optionalNumber(usage.cache_read_input_tokens)
      const input = optionalNumber(usage.input_tokens)
      const creation = optionalNumber(usage.cache_creation_input_tokens)
      const miss = input === null || creation === null ? null : input + creation
      const prompt = hit === null || miss === null ? null : hit + miss
      const completion = optionalNumber(usage.output_tokens)
      const cost = hit === null || miss === null || completion === null
        ? null
        : (hit * 0.0028 + miss * 0.14 + completion * 0.28) / 1_000_000
      return {
        trace_id: event.trace_id ?? '',
        case_id: event.caseId ?? '',
        event_id: event.eventId ?? '',
        session_id: event.sessionId ?? '',
        question_id: event.questionId ?? '',
        phase: event.phase ?? 'unknown',
        operator: event.querySource ?? '',
        attempt: event.attempt ?? null,
        source: 'native-claude',
        status: event.event_type === 'llm_call_error' ? 'error' : 'success',
        model: event.model ?? '',
        latency_ms: event.latency_ms ?? null,
        prompt_tokens: prompt,
        cache_hit_tokens: hit,
        cache_miss_tokens: miss,
        completion_tokens: completion,
        reasoning_tokens: null,
        total_tokens: prompt === null || completion === null ? null : prompt + completion,
        usage_available: prompt !== null && completion !== null,
        estimated_cost_usd: cost,
      }
    })
}

export function buildCaseWorkerCommand(requestPath: string): string[] {
  return [process.execPath, import.meta.path, '--case-worker', resolve(requestPath)]
}

async function runCaseWorker(requestPath: string): Promise<void> {
  const request = readJson(requestPath) as CaseWorkerRequest
  const bundle = readJson(request.bundlePath) as Bundle
  const item = bundle.cases.find(candidate => candidate.case_id === request.caseId)
  if (!item) throw new Error(`case worker cannot find ${JSON.stringify(request.caseId)}`)
  await runCase(request.options, bundle, item)
}

async function spawnCaseWorker(options: Options, item: LongMemCase): Promise<void> {
  const requestPath = join(
    options.outputDir,
    'cases',
    safeName(item.case_id),
    'worker-request.json',
  )
  writeJson(requestPath, {
    options,
    bundlePath: join(options.outputDir, 'input', 'native_bundle.json'),
    caseId: item.case_id,
  } satisfies CaseWorkerRequest)
  const child = Bun.spawn(buildCaseWorkerCommand(requestPath), {
    cwd: dirname(import.meta.path),
    env: process.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`native LongMemEval case worker failed for ${item.case_id}`)
  }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === '--case-worker') {
    const requestPath = argv[1]
    if (!requestPath || argv.length !== 2) {
      throw new Error('--case-worker requires exactly one request path')
    }
    await runCaseWorker(requestPath)
    return
  }
  const options = parseArgs(argv)
  const actualHash = sha256(readFileSync(options.datasetPath))
  if (actualHash !== DATASET_SHA256) throw new Error(`LongMemEval dataset checksum mismatch: ${actualHash}`)
  const records = JSON.parse(readFileSync(options.datasetPath, 'utf8')) as RawCase[]
  const bundle = options.smoke
    ? normalizeSmokeDataset(records)
    : normalizeDataset(records, options.caseIds)
  initializeRun(options, bundle)
  let completed = 0
  for (const item of bundle.cases) {
    const statusPath = join(options.outputDir, 'cases', safeName(item.case_id), 'status.json')
    if (existsSync(statusPath) && readJson(statusPath).status === 'completed') continue
    if (options.maxNewCases !== undefined && completed >= options.maxNewCases) break
    try {
      await spawnCaseWorker(options, item)
      completed += 1
    } catch (error) {
      finalizeMetrics(options, bundle)
      throw error
    }
  }
  finalizeMetrics(options, bundle)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-')
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeJsonl(path: string, rows: readonly Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''))
}

function appendJsonl(path: string, row: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(row)}\n`)
}

function writeCsv(path: string, rows: readonly Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const fields = [...new Set(rows.flatMap(row => Object.keys(row)))].sort()
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  writeFileSync(path, fields.length === 0 ? '' : `${fields.join(',')}\n${rows.map(row => fields.map(field => escape(row[field])).join(',')).join('\n')}\n`)
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.toLocaleLowerCase('en-US').trim().split(/\s+/).filter(Boolean).join(' ')
}

function tokenF1(prediction: unknown, reference: unknown): number {
  const predicted = normalizedText(prediction).split(' ').filter(Boolean)
  const expected = normalizedText(reference).split(' ').filter(Boolean)
  if (predicted.length === 0 || expected.length === 0) {
    return Number(predicted.length === expected.length)
  }
  const remaining = [...expected]
  let overlap = 0
  for (const token of predicted) {
    const index = remaining.indexOf(token)
    if (index >= 0) {
      overlap += 1
      remaining.splice(index, 1)
    }
  }
  if (overlap === 0) return 0
  const precision = overlap / predicted.length
  const recall = overlap / expected.length
  return Math.round((2 * precision * recall / (precision + recall)) * 1_000_000) / 1_000_000
}

function latencyStats(values: number[]): { mean_ms: number | null; median_ms: number | null; p95_ms: number | null } {
  if (values.length === 0) return { mean_ms: null, median_ms: null, p95_ms: null }
  const ordered = [...values].sort((left, right) => left - right)
  const average = ordered.reduce((sum, value) => sum + value, 0) / ordered.length
  const middle = Math.floor(ordered.length / 2)
  const medianValue = ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2
  const position = (ordered.length - 1) * 0.95
  const lower = Math.floor(position)
  const upper = Math.min(lower + 1, ordered.length - 1)
  const percentile = ordered[lower]! * (1 - (position - lower)) + ordered[upper]! * (position - lower)
  return {
    mean_ms: round3(average),
    median_ms: round3(medianValue),
    p95_ms: round3(percentile),
  }
}

function sumKnown(rows: readonly Record<string, unknown>[], field: string): number {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0)
}

function providerRollup(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const costs = rows.map(row => row.estimated_cost_usd)
  return {
    provider_call_count: rows.length,
    provider_error_count: rows.filter(row => row.status === 'error').length,
    usage_complete: rows.every(row => row.usage_available === true),
    provider_latency_sum_ms: rows.reduce(
      (sum, row) => sum + Number(row.latency_ms ?? 0),
      0,
    ),
    prompt_tokens: sumKnown(rows, 'prompt_tokens'),
    cache_hit_tokens: sumKnown(rows, 'cache_hit_tokens'),
    cache_miss_tokens: sumKnown(rows, 'cache_miss_tokens'),
    completion_tokens: sumKnown(rows, 'completion_tokens'),
    reasoning_tokens: null,
    estimated_cost_usd: costs.length === 0
      ? 0
      : costs.every(cost => cost !== null)
        ? costs.reduce((sum, cost) => sum + Number(cost), 0)
        : null,
  }
}

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0
  const proc = Bun.spawnSync(['du', '-sk', path])
  if (proc.exitCode !== 0) return statSync(path).size
  return Number(new TextDecoder().decode(proc.stdout).trim().split(/\s+/)[0] ?? 0) * 1024
}

export const LONGMEMEVAL_CONTRACT = {
  answerPromptDigest: ANSWER_PROMPT_DIGEST,
  judgePromptDigest: JUDGE_PROMPT_DIGEST,
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
