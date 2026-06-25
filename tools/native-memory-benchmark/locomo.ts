import { readFileSync } from 'fs'
import type { BenchmarkEvent, BenchmarkQuestion, LocomoBenchmarkSample } from './types.ts'

export function loadLocomoSample(datasetPath: string, sampleIndex = 0): LocomoBenchmarkSample {
  const dataset = loadDataset(datasetPath)
  if (sampleIndex < 0 || sampleIndex >= dataset.length) {
    throw new Error(`sample_index ${sampleIndex} is out of range for ${dataset.length} LOCOMO samples`)
  }
  const sample = dataset[sampleIndex]
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new Error(`LOCOMO sample ${sampleIndex} must be a JSON object`)
  }
  return normalizeLocomoSample(sample as Record<string, unknown>, sampleIndex)
}

export function normalizeLocomoSample(sample: Record<string, unknown>, sampleIndex = 0): LocomoBenchmarkSample {
  const sampleId = stringValue(sample.sample_id) ?? `sample-${sampleIndex}`
  return {
    sample_id: sampleId,
    events: conversationEvents(sample, sampleId),
    questions: questionRows(sample, sampleId),
  }
}

export function selectEvents(
  events: readonly BenchmarkEvent[],
  params: { startRow?: number; rowLimit?: number },
): BenchmarkEvent[] {
  const startRow = params.startRow ?? 1
  const rowLimit = params.rowLimit
  if (!Number.isInteger(startRow) || startRow <= 0) {
    throw new Error('startRow must be a positive integer')
  }
  if (rowLimit !== undefined && (!Number.isInteger(rowLimit) || rowLimit < 0)) {
    throw new Error('rowLimit must be a non-negative integer')
  }
  const startIndex = startRow - 1
  return rowLimit === undefined
    ? [...events.slice(startIndex)]
    : [...events.slice(startIndex, startIndex + rowLimit)]
}

export function eligibleQuestions(
  questions: readonly BenchmarkQuestion[],
  params: { ingestedEventIds: Iterable<string>; questionLimit?: number },
): BenchmarkQuestion[] {
  const limit = params.questionLimit
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('questionLimit must be a non-negative integer')
  }
  if (limit === 0) return []

  const ingested = new Set(params.ingestedEventIds)
  const selected: BenchmarkQuestion[] = []
  for (const question of questions) {
    if (question.evidence_event_ids.every(eventId => ingested.has(eventId))) {
      selected.push(question)
      if (limit !== undefined && selected.length >= limit) break
    }
  }
  return selected
}

export function eventsJsonl(events: readonly BenchmarkEvent[]): string {
  return events.map(event => JSON.stringify(event)).join('\n') + '\n'
}

export function questionsJsonl(questions: readonly BenchmarkQuestion[]): string {
  return questions.map(question => JSON.stringify(question)).join('\n') + '\n'
}

export function eventCsvRows(events: readonly BenchmarkEvent[]): Record<string, unknown>[] {
  return events.map(event => ({
    sample_id: event.sample_id,
    event_id: event.event_id,
    speaker: event.speaker,
    session_id: event.session_id,
    timestamp: event.timestamp,
    text: event.text,
  }))
}

export function questionCsvRows(questions: readonly BenchmarkQuestion[]): Record<string, unknown>[] {
  return questions.map(question => ({
    question_id: question.question_id,
    sample_id: question.sample_id,
    question: question.question,
    gold_answer: goldAnswerCsvValue(question.gold_answer),
    evidence_event_ids: question.evidence_event_ids.join(';'),
    category: question.category,
  }))
}

export function goldAnswerCsvValue(goldAnswer: unknown): string {
  if (Array.isArray(goldAnswer)) return goldAnswer.map(item => String(item)).join('; ')
  return String(goldAnswer).replace(/\s+/g, ' ').trim()
}

function loadDataset(datasetPath: string): unknown[] {
  const raw = JSON.parse(readFileSync(datasetPath, 'utf8')) as unknown
  return Array.isArray(raw) ? raw : [raw]
}

function conversationEvents(sample: Record<string, unknown>, sampleId: string): BenchmarkEvent[] {
  const events: BenchmarkEvent[] = []
  for (const [sessionId, timestamp, turns] of iterSessions(sample.conversation)) {
    turns.forEach((turn, index) => {
      const event = turnEvent(turn, sampleId, sessionId, timestamp, index + 1)
      if (event) events.push(event)
    })
  }
  return events
}

function iterSessions(conversation: unknown): Array<[string, string, unknown[]]> {
  if (conversation && typeof conversation === 'object' && !Array.isArray(conversation)) {
    const object = conversation as Record<string, unknown>
    return Object.entries(object)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, String(object[`${key}_date_time`] ?? ''), value as unknown[]])
  }
  if (Array.isArray(conversation)) {
    return conversation.flatMap((item, index): Array<[string, string, unknown[]]> => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const object = item as Record<string, unknown>
        if (Array.isArray(object.dialogue)) {
          return [[
            stringValue(object.session_id) ?? `session_${index + 1}`,
            stringValue(object.session_date_time) ?? stringValue(object.timestamp) ?? '',
            object.dialogue,
          ]]
        }
        return [[
          stringValue(object.session_id) ?? `session_${index + 1}`,
          stringValue(object.session_date_time) ?? stringValue(object.timestamp) ?? '',
          [object],
        ]]
      }
      return []
    })
  }
  return []
}

function turnEvent(
  turn: unknown,
  sampleId: string,
  sessionId: string,
  timestamp: string,
  fallbackIndex: number,
): BenchmarkEvent | undefined {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return undefined
  const object = turn as Record<string, unknown>
  const text = (stringValue(object.text) ?? stringValue(object.message) ?? stringValue(object.content) ?? '').trim()
  if (!text) return undefined
  return {
    sample_id: sampleId,
    event_id: stringValue(object.dia_id) ?? stringValue(object.turn_id) ?? `${sessionId}:${fallbackIndex}`,
    speaker: stringValue(object.speaker) ?? '',
    text,
    session_id: sessionId,
    timestamp: stringValue(object.timestamp) ?? timestamp,
  }
}

function questionRows(sample: Record<string, unknown>, sampleId: string): BenchmarkQuestion[] {
  const qa = sample.qa
  if (!Array.isArray(qa)) return []
  const questions: BenchmarkQuestion[] = []
  qa.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    const object = row as Record<string, unknown>
    const question = stringValue(object.question) ?? ''
    if (!question) return
    const evidence = Array.isArray(object.evidence)
      ? object.evidence.map(item => String(item ?? '').trim()).filter(Boolean)
      : []
    questions.push({
      question_id: `${sampleId}:q${index + 1}`,
      sample_id: sampleId,
      question,
      gold_answer: object.answer ?? '',
      evidence_event_ids: evidence,
      category: String(object.category ?? ''),
    })
  })
  return questions
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
