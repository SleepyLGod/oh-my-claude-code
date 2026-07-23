import { describe, expect, test } from 'bun:test'
import {
  canonicalBenchmarkEvent,
  formatBenchmarkEvent,
  nativeRetrievalSelectorOptions,
} from './session.ts'

describe('native benchmark session input', () => {
  test('renders only canonical event evidence for the native extractor', () => {
    expect(
      formatBenchmarkEvent({
        sample_id: 'case-1',
        event_id: 'event-1',
        speaker: 'Alice',
        text: 'I moved to Paris.',
        session_id: 'session-1',
        timestamp: '2025-01-02T03:04:05',
        metadata: { gold_answer: 'must not leak' },
      }),
    ).toBe(
      [
        'Benchmark dialogue utterance for memory extraction.',
        'speaker: Alice',
        'message: I moved to Paris.',
        'session_id: session-1',
        'timestamp: 2025-01-02T03:04:05',
      ].join('\n'),
    )
  })

  test('rejects events without model-visible text', () => {
    expect(() =>
      formatBenchmarkEvent({
        event_id: 'event-1',
        speaker: 'Alice',
        text: '',
      }),
    ).toThrow('non-empty string')
  })

  test('normalizes transcript objects independently of JSON key order', () => {
    expect(
      canonicalBenchmarkEvent({
        timestamp: '2025-01-02T03:04:05',
        text: 'I moved to Paris.',
        speaker: 'Alice',
        session_id: 'session-1',
        event_id: 'event-1',
        sample_id: 'ignored',
      }),
    ).toEqual({
      event_id: 'event-1',
      speaker: 'Alice',
      text: 'I moved to Paris.',
      session_id: 'session-1',
      timestamp: '2025-01-02T03:04:05',
    })
  })

  test('disables thinking only for benchmark retrieval selection', () => {
    expect(nativeRetrievalSelectorOptions('strict')).toEqual({
      selectorParseMode: 'strict',
      thinking: false,
    })
    expect(nativeRetrievalSelectorOptions('lenient')).toEqual({
      selectorParseMode: 'lenient',
      thinking: false,
    })
  })
})
