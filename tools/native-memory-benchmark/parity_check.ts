import { readFileSync } from 'fs'
import { join } from 'path'
import { eligibleQuestions, loadLocomoSample, normalizeLocomoSample, selectEvents } from './locomo.ts'
import {
  containsAnswer,
  exactMatch,
  locomoAnswerScore,
  locomoF1Score,
  locomoMultiAnswerF1,
  questionMetricRow,
  summarizeQuestionMetrics,
  tokenF1,
} from './metrics.ts'
import { firstModelText, inspectSelectorArtifacts, inspectSelectorOutput, selectorSystemText } from './retrievalAnomalies.ts'
import { parseSelectedMemoryFilenames } from '../../src/memdir/findRelevantMemories.ts'

type MetricParityCase = {
  name: string
  prediction: string
  gold_answer: string
  category: string
  expected: {
    exact_match: boolean
    contains_answer: boolean
    token_f1: number
    locomo_answer_score: number
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`)
}

function assertAlmostEqual(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

const fixturePath = join(import.meta.dir, 'fixtures', 'tiny-locomo.json')
const sample = loadLocomoSample(fixturePath, 0)
assertEqual(sample.sample_id, 'conv-test', 'sample id')
assertEqual(sample.events.length, 2, 'empty events are skipped')
assertEqual(sample.events[0]?.event_id, 'D1:1', 'event id')
assertEqual(sample.events[0]?.timestamp, '2026-01-01', 'timestamp')
assertEqual(sample.questions[0]?.question_id, 'conv-test:q1', 'question id')

const fallback = normalizeLocomoSample({ conversation: { session_1: [] }, qa: [] }, 4)
assertEqual(fallback.sample_id, 'sample-4', 'fallback sample id')
const arrayFallback = normalizeLocomoSample({
  conversation: [
    { speaker: 'Caroline', text: 'first' },
    { speaker: 'Melanie', text: 'second' },
  ],
  qa: [],
})
assertEqual(arrayFallback.events[0]?.event_id, 'session_1:1', 'array fallback first event id')
assertEqual(arrayFallback.events[1]?.event_id, 'session_2:1', 'array fallback second event id')

const selectedQuestions = eligibleQuestions(sample.questions, { ingestedEventIds: ['D1:1'], questionLimit: undefined })
assertEqual(selectedQuestions.length, 1, 'eligible question count')
assertEqual(selectedQuestions[0]?.question, 'What did Caroline research?', 'eligible question')
assertEqual(eligibleQuestions(sample.questions, { ingestedEventIds: ['D1:1'], questionLimit: 0 }).length, 0, 'zero question limit')
let invalidQuestionLimit = false
try {
  eligibleQuestions(sample.questions, { ingestedEventIds: ['D1:1'], questionLimit: -1 })
} catch {
  invalidQuestionLimit = true
}
assert(invalidQuestionLimit, 'negative question limit is rejected')
assertEqual(selectEvents(sample.events, { rowLimit: 1 })[0]?.event_id, 'D1:1', 'row limit')

assert(exactMatch('The adoption agencies', 'adoption agencies'), 'exact match')
assert(containsAnswer('Caroline researched adoption agencies yesterday.', 'adoption agencies'), 'contains answer')
assertEqual(tokenF1('adoption agencies', 'adoption agencies'), 1.0, 'token f1 exact')
assert(tokenF1('adoption', 'adoption agencies') > 0, 'partial token f1')

const categoryOne = locomoAnswerScore('Psychology, counseling', 'psychology, counseling certification', 1)
assert(categoryOne > 0.8 && categoryOne < 1.0, 'category 1 partial f1')
assertEqual(categoryOne, locomoMultiAnswerF1('Psychology, counseling', 'psychology, counseling certification'), 'category 1 formula')
assertEqual(locomoAnswerScore('running', 'runs', 2), 1.0, 'porter running/runs')
assert(locomoAnswerScore('helped with childcare', 'help with child care', 4) > 0, 'category 4 stemmed f1')
assertEqual(locomoAnswerScore('psychology', 'psychology; counseling certification', 3), 1.0, 'category 3 semicolon')
assertEqual(locomoAnswerScore('No information available in the memory.', 'anything', 5), 1.0, 'category 5 no info')
assertEqual(locomoAnswerScore("I don't know.", 'anything', 5), 0.0, "category 5 does not treat I don't know as official no-info")
assertEqual(locomoAnswerScore('Caroline went yesterday.', 'anything', 5), 0.0, 'category 5 non no-info')
assertEqual(locomoF1Score('8 May 2023.', '7 May 2023'), 2 / 3, 'date f1')

const emptyRetrieval = questionMetricRow({
  question: sample.questions[0]!,
  retrievedText: '',
  retrievedRowCount: 0,
})
assertEqual(emptyRetrieval.retrieved_row_count, 0, 'empty retrieval row count')
assertEqual(emptyRetrieval.proxy_answer_string_hit, false, 'empty retrieval hit')
assert(!('generated_answer' in emptyRetrieval), 'no answer metric in retrieval-only row')

const answered = questionMetricRow({
  question: { ...sample.questions[0]!, category: '2', gold_answer: '7 May 2023' },
  retrievedText: '',
  retrievedRowCount: 0,
  generatedAnswer: '8 May 2023.',
})
assertEqual(answered.locomo_answer_score, Math.round((2 / 3) * 1_000_000) / 1_000_000, 'answered locomo score')

const zeroScoreAnswer = questionMetricRow({
  question: { ...sample.questions[0]!, category: '2', gold_answer: '7 May 2023' },
  retrievedText: '',
  retrievedRowCount: 0,
  generatedAnswer: '',
})
const summary = summarizeQuestionMetrics([
  { ...zeroScoreAnswer, category: '2' },
  questionMetricRow({
    question: { ...sample.questions[0]!, category: '5', gold_answer: 'anything' },
    retrievedText: '',
    retrievedRowCount: 0,
    generatedAnswer: 'No information available.',
  }),
])
assertEqual(summary.locomo_answer_score_mean, 0.5, 'summary answer score mean')
assertEqual(summary.category_2_count, 1, 'category count')

const arraySelector = inspectSelectorOutput('["file.md"]')
assertEqual(arraySelector.reason, 'selector_schema_mismatch', 'array selector schema mismatch')
assertEqual(arraySelector.selectedFromTrace, 'file.md', 'array selector selected file')
const lenientArraySelector = inspectSelectorOutput('["file.md"]', 'lenient')
assertEqual(lenientArraySelector.reason, '', 'lenient array selector has no anomaly')
assertEqual(lenientArraySelector.selectedFromTrace, 'file.md', 'lenient array selector selected file')

assert(
  selectorSystemText({ system: 'You are selecting memories that will be useful to Claude Code.' }).includes('selecting memories'),
  'anthropic selector system text',
)
assert(
  selectorSystemText({
    messages: [
      { role: 'system', content: 'You are selecting memories that will be useful to Claude Code.' },
      { role: 'user', content: 'Query: adoption' },
    ],
  }).includes('selecting memories'),
  'openai-compatible selector system text',
)
assertEqual(
  firstModelText({ content: [{ type: 'text', text: '["file.md"]' }] }),
  '["file.md"]',
  'anthropic selector text block',
)
assertEqual(
  firstModelText({ choices: [{ message: { content: '["file.md"]' } }] }),
  '["file.md"]',
  'openai-compatible selector choice text',
)

const validSelector = inspectSelectorOutput('{"selected_memories":["file.md"]}')
assertEqual(validSelector.reason, '', 'valid selector object has no anomaly')
assertEqual(validSelector.selectedFromTrace, 'file.md', 'valid selector selected file')

assertEqual(inspectSelectorOutput('').reason, 'selector_no_text_output', 'selector no text output')
assertEqual(inspectSelectorOutput('{bad json').reason, 'selector_invalid_json', 'selector invalid json')
const bareFilenameSelector = inspectSelectorOutput('caroline_adoption_dream.md')
assertEqual(bareFilenameSelector.reason, 'selector_invalid_json', 'bare filename selector invalid json')
assertEqual(bareFilenameSelector.selectedFromTrace, 'caroline_adoption_dream.md', 'bare filename selector selected file')
assertEqual(inspectSelectorOutput('caroline_adoption_dream.md', 'lenient').reason, '', 'lenient bare filename has no anomaly')
const fencedSelector = inspectSelectorOutput('```json\n["caroline_adoption_dream.md", "melanie_support_system.md"]\n```')
assertEqual(fencedSelector.reason, 'selector_schema_mismatch', 'fenced selector schema mismatch')
assertEqual(fencedSelector.selectedFromTrace, 'caroline_adoption_dream.md;melanie_support_system.md', 'fenced selector selected files')
assertEqual(inspectSelectorOutput('```json\n["caroline_adoption_dream.md"]\n```', 'lenient').reason, '', 'lenient fenced json has no anomaly')
const bulletSelector = inspectSelectorOutput('- [user] caroline_adoption_dream.md')
assertEqual(bulletSelector.reason, 'selector_invalid_json', 'bullet selector invalid json')
assertEqual(bulletSelector.selectedFromTrace, 'caroline_adoption_dream.md', 'bullet selector selected file')
assertEqual(inspectSelectorOutput('- [user] caroline_adoption_dream.md', 'lenient').reason, '', 'lenient bullet filename has no anomaly')
assertEqual(inspectSelectorOutput('not a filename').selectedFromTrace, '', 'invalid text without filename hint')

const validFilenames = new Set(['caroline_adoption_dream.md', 'melanie_support_system.md'])
const manyValidFilenames = new Set(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'])
assertEqual(
  parseSelectedMemoryFilenames('{"selected_memories":["caroline_adoption_dream.md"]}', validFilenames, 'strict').join(';'),
  'caroline_adoption_dream.md',
  'strict parser accepts native object',
)
assertEqual(
  parseSelectedMemoryFilenames('["caroline_adoption_dream.md"]', validFilenames, 'strict').join(';'),
  '',
  'strict parser rejects array',
)
assertEqual(
  parseSelectedMemoryFilenames('["caroline_adoption_dream.md"]', validFilenames, 'lenient').join(';'),
  'caroline_adoption_dream.md',
  'lenient parser accepts array',
)
assertEqual(
  parseSelectedMemoryFilenames('```json\n["caroline_adoption_dream.md"]\n```', validFilenames, 'lenient').join(';'),
  'caroline_adoption_dream.md',
  'lenient parser accepts fenced json',
)
assertEqual(
  parseSelectedMemoryFilenames('- [user] caroline_adoption_dream.md', validFilenames, 'lenient').join(';'),
  'caroline_adoption_dream.md',
  'lenient parser accepts bullet filename',
)
assertEqual(
  parseSelectedMemoryFilenames('caroline_adoption_dream.md\nmissing.md\ncaroline_adoption_dream.md', validFilenames, 'lenient').join(';'),
  'caroline_adoption_dream.md',
  'lenient parser filters invalid and duplicate filenames',
)
assertEqual(
  parseSelectedMemoryFilenames('["a.md","b.md","c.md","d.md","e.md","f.md"]', manyValidFilenames, 'lenient').join(';'),
  'a.md;b.md;c.md;d.md;e.md',
  'lenient parser caps selected filenames at five',
)
assertEqual(
  inspectSelectorArtifacts({ rawText: '', error: { name: 'Error', message: 'unknown certificate verification error' } }).reason,
  'selector_llm_error',
  'selector llm error',
)
const circularError: Record<string, unknown> = {}
circularError.self = circularError
assertEqual(
  inspectSelectorArtifacts({ rawText: '', error: circularError }).reason,
  'selector_llm_error',
  'selector circular llm error',
)
assertEqual(
  inspectSelectorArtifacts({ rawText: '', response: { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '...' }] } }).reason,
  'selector_max_tokens_no_text',
  'selector max tokens without text',
)

const metricParityCases = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'metric-parity-cases.json'), 'utf8'),
) as MetricParityCase[]
for (const testCase of metricParityCases) {
  assertEqual(
    exactMatch(testCase.prediction, testCase.gold_answer),
    testCase.expected.exact_match,
    `${testCase.name} exact_match`,
  )
  assertEqual(
    containsAnswer(testCase.prediction, testCase.gold_answer),
    testCase.expected.contains_answer,
    `${testCase.name} contains_answer`,
  )
  assertAlmostEqual(
    tokenF1(testCase.prediction, testCase.gold_answer),
    testCase.expected.token_f1,
    `${testCase.name} token_f1`,
  )
  assertAlmostEqual(
    locomoAnswerScore(testCase.prediction, testCase.gold_answer, testCase.category),
    testCase.expected.locomo_answer_score,
    `${testCase.name} locomo_answer_score`,
  )
}

console.log('native-memory-benchmark parity checks passed')
