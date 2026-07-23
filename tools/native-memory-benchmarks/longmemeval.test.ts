import { describe, expect, test } from 'bun:test'
import {
  LONGMEMEVAL_SMOKE_CASE_ID,
  LONGMEMEVAL_SMOKE_EVENT_COUNT,
  LONGMEMEVAL_SMOKE_SESSION_ID,
  LONGMEMEVAL_CONTRACT,
  PILOT_30_CASE_IDS,
  buildCaseWorkerCommand,
  bundleFingerprint,
  normalizeDataset,
  normalizeSmokeDataset,
  parseArgs,
  taskContractFingerprint,
} from './longmemeval.ts'

function record(questionId: string): Record<string, unknown> {
  return {
    question_id: questionId,
    question_type: 'knowledge-update',
    question: 'What changed?',
    question_date: '2024/01/03 (Wed) 08:00',
    answer: 'The new value.',
    answer_session_ids: ['session-1'],
    haystack_dates: ['January 2, 2024 09:30 pm'],
    haystack_session_ids: ['session-1'],
    haystack_sessions: [[
      { role: 'user', content: 'Remember the old value.' },
      { role: 'assistant', content: 'I will remember it.', has_answer: true },
    ]],
  }
}

describe('independent native LongMemEval runner', () => {
  test('does not accept an agent-memory checkout or external harness', () => {
    expect(() => parseArgs([
      '--dataset-path', '/tmp/data.json',
      '--output-dir', '/tmp/output',
      '--agent-memory-root', '/tmp/agent-memory',
    ])).toThrow('invalid argument')
  })

  test('isolates each case in a native-owned worker process', () => {
    const command = buildCaseWorkerCommand('/tmp/native-case.json')

    expect(command[0]).toBe(process.execPath)
    expect(command[1]).toEndWith('/tools/native-memory-benchmarks/longmemeval.ts')
    expect(command.slice(2)).toEqual(['--case-worker', '/tmp/native-case.json'])
    expect(command.join(' ')).not.toContain('agent-memory')
  })

  test('uses the same fixed 30-case and prompt contracts as agent-memory', () => {
    expect(PILOT_30_CASE_IDS).toHaveLength(30)
    expect(new Set(PILOT_30_CASE_IDS).size).toBe(30)
    expect(PILOT_30_CASE_IDS.filter(caseId => caseId.endsWith('_abs'))).toHaveLength(2)
    expect(LONGMEMEVAL_CONTRACT).toEqual({
      answerPromptDigest: '7d2c9fe1fabda9454e5c356418be367aabf2243d9f7809f49b3f7417d61907a9',
      judgePromptDigest: '345353a502dcc3ffe6b8651770bbfac76a4f2a12590bcf74cac0b33f5ceadd8a',
    })
    expect(taskContractFingerprint('deepseek/deepseek-v4-flash')).toBe(
      '974f09c6a57d59da1665c2a62534778781020165047e6f3857863c6da974c751',
    )
  })

  test('normalizes only model-visible evidence into policy input', () => {
    const records = Array.from({ length: 500 }, (_, index) => record(`case-${index}`))
    const bundle = normalizeDataset(records as never, ['case-0'])

    expect(bundle.cases[0]?.events).toEqual([
      {
        sample_id: 'case-0',
        event_id: 'case-0:s0:t0',
        speaker: 'user',
        text: 'Remember the old value.',
        session_id: 'session-1',
        timestamp: '2024-01-02T21:30:00',
        metadata: { session_index: 0, turn_index: 0 },
      },
      {
        sample_id: 'case-0',
        event_id: 'case-0:s0:t1',
        speaker: 'assistant',
        text: 'I will remember it.',
        session_id: 'session-1',
        timestamp: '2024-01-02T21:30:00',
        metadata: { session_index: 0, turn_index: 1 },
      },
    ])
    expect(bundleFingerprint(bundle, false)).not.toContain('The new value.')
  })

  test('builds the fixed evidence-complete integration smoke prefix', () => {
    const records = Array.from({ length: 500 }, (_, index) => record(`case-${index}`))
    records[0] = {
      ...record(LONGMEMEVAL_SMOKE_CASE_ID),
      answer_session_ids: [LONGMEMEVAL_SMOKE_SESSION_ID],
      haystack_dates: [
        'January 2, 2024 09:30 pm',
        'January 3, 2024 09:30 pm',
      ],
      haystack_session_ids: [LONGMEMEVAL_SMOKE_SESSION_ID, 'later'],
      haystack_sessions: [
        Array.from({ length: LONGMEMEVAL_SMOKE_EVENT_COUNT }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `turn ${index}`,
          ...(index === 1 ? { has_answer: true } : {}),
        })),
        Array.from({ length: 484 }, (_, index) => ({
          role: 'user',
          content: `later distractor ${index}`,
        })),
      ],
    }

    const bundle = normalizeSmokeDataset(records as never)

    expect(bundle.cases).toHaveLength(1)
    expect(bundle.cases[0]?.case_id).toBe(LONGMEMEVAL_SMOKE_CASE_ID)
    expect(bundle.cases[0]?.events).toHaveLength(LONGMEMEVAL_SMOKE_EVENT_COUNT)
    expect(new Set(bundle.cases[0]?.events.map(event => event.session_id))).toEqual(
      new Set([LONGMEMEVAL_SMOKE_SESSION_ID]),
    )
    expect(bundle.metadata).toEqual({
      source: 'xiaowu0162/longmemeval-cleaned',
      run_mode: 'integration-smoke',
      source_case_event_count: 492,
      included_event_count: LONGMEMEVAL_SMOKE_EVENT_COUNT,
      included_session_ids: [LONGMEMEVAL_SMOKE_SESSION_ID],
    })
    expect(bundleFingerprint(bundle, false)).not.toContain('The new value.')
  })

  test('parses smoke and controlled maintenance-stop execution flags', () => {
    const options = parseArgs([
      '--dataset-path', '/tmp/data.json',
      '--output-dir', '/tmp/output',
      '--smoke',
      '--stop-after-maintenance',
    ])

    expect(options.smoke).toBe(true)
    expect(options.stopAfterMaintenance).toBe(true)
    expect(options.caseIds).toEqual([LONGMEMEVAL_SMOKE_CASE_ID])
  })
})
