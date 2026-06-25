import type { BenchmarkQuestion, RetrievalResultRow } from './types.ts'
import { goldAnswerCsvValue } from './locomo.ts'

type QuestionMetricParams = {
  question: BenchmarkQuestion
  retrievedText: string
  retrievedRowCount: number
  generatedAnswer?: string
}

const ARTICLES = new Set(['a', 'an', 'the'])
const PUNCTUATION = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/g

export function normalizeText(value: unknown): string {
  return String(value)
    .toLowerCase()
    .replace(PUNCTUATION, '')
    .split(/\s+/)
    .filter(token => token && !ARTICLES.has(token))
    .join(' ')
}

export function answerTexts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [String(value)]
}

export function exactMatch(prediction: string, goldAnswer: unknown): boolean {
  const predictionTokens = new Set(normalizeText(prediction).split(/\s+/).filter(Boolean))
  return answerTexts(goldAnswer).some(answer => {
    const answerTokens = new Set(normalizeText(answer).split(/\s+/).filter(Boolean))
    return setEquals(predictionTokens, answerTokens)
  })
}

export function containsAnswer(text: string, goldAnswer: unknown): boolean {
  const normalizedText = normalizeText(text)
  if (!normalizedText) return false
  return answerTexts(goldAnswer)
    .map(answer => normalizeText(answer))
    .some(answer => Boolean(answer) && normalizedText.includes(answer))
}

export function tokenF1(prediction: string, goldAnswer: unknown): number {
  return Math.max(0, ...answerTexts(goldAnswer).map(answer => locomoF1Score(prediction, answer)))
}

export function locomoAnswerScore(prediction: string, goldAnswer: unknown, category: string | number): number {
  const categoryId = Number(category)
  let answer = goldAnswerCsvValue(goldAnswer)
  if (categoryId === 3) answer = answer.split(';')[0].trim()
  if (categoryId === 2 || categoryId === 3 || categoryId === 4) {
    return locomoF1Score(prediction, answer)
  }
  if (categoryId === 1) return locomoMultiAnswerF1(prediction, answer)
  if (categoryId === 5) {
    const output = prediction.toLowerCase()
    return output.includes('no information available') || output.includes('not mentioned') ? 1.0 : 0.0
  }
  throw new Error(`Unsupported LOCOMO question category ${category}`)
}

export function locomoF1Score(prediction: string, goldAnswer: unknown): number {
  const predictionTokens = stemmedTokens(prediction)
  const goldTokens = stemmedTokens(goldAnswer)
  if (predictionTokens.length === 0 || goldTokens.length === 0) {
    return predictionTokens.length === goldTokens.length ? 1.0 : 0.0
  }
  const common = multisetOverlap(predictionTokens, goldTokens)
  if (common === 0) return 0.0
  const precision = common / predictionTokens.length
  const recall = common / goldTokens.length
  return (2 * precision * recall) / (precision + recall)
}

export function locomoMultiAnswerF1(prediction: string, goldAnswer: string): number {
  const predictions = prediction.split(',').map(part => part.trim())
  const goldAnswers = goldAnswer.split(',').map(part => part.trim())
  if (goldAnswers.length === 0) return 0.0
  return mean(goldAnswers.map(gold => Math.max(...predictions.map(predicted => locomoF1Score(predicted, gold)))))
}

export function retrievalHit(retrievedText: string, goldAnswer: unknown): boolean {
  return containsAnswer(retrievedText, goldAnswer)
}

export function questionMetricRow(params: QuestionMetricParams): RetrievalResultRow {
  const { question, retrievedText, retrievedRowCount, generatedAnswer } = params
  const row: RetrievalResultRow = {
    question_id: question.question_id,
    sample_id: question.sample_id,
    question: question.question,
    gold_answer: goldAnswerCsvValue(question.gold_answer),
    evidence_event_ids: question.evidence_event_ids.join(';'),
    category: question.category,
    retrieval_mode: 'component_retrieval',
    retrieved_row_count: retrievedRowCount,
    retrieved_paths: '',
    retrieved_text: retrievedText,
    proxy_answer_string_hit: retrievalHit(retrievedText, question.gold_answer),
    retrieval_latency_sec: 0,
  }
  if (generatedAnswer !== undefined) {
    row.generated_answer = generatedAnswer
    row.answer_exact_match = exactMatch(generatedAnswer, question.gold_answer)
    row.answer_contains_gold = containsAnswer(generatedAnswer, question.gold_answer)
    row.answer_f1 = round6(tokenF1(generatedAnswer, question.gold_answer))
    row.locomo_answer_score = round6(locomoAnswerScore(generatedAnswer, question.gold_answer, question.category))
  }
  return row
}

export function summarizeQuestionMetrics(rows: readonly RetrievalResultRow[]): Record<string, unknown> {
  const total = rows.length
  if (total === 0) {
    return {
      questions_evaluated: 0,
      proxy_answer_string_hit_rate: '',
      answer_exact_match_rate: '',
      answer_contains_rate: '',
      answer_f1_mean: '',
      locomo_answer_score_mean: '',
    }
  }
  const answerRows = rows.filter(row => row.generated_answer !== undefined)
  const summary: Record<string, unknown> = {
    questions_evaluated: total,
    proxy_answer_string_hit_rate: round6(rows.filter(row => row.proxy_answer_string_hit).length / total),
  }
  if (answerRows.length === 0) {
    return {
      ...summary,
      answer_exact_match_rate: '',
      answer_contains_rate: '',
      answer_f1_mean: '',
      locomo_answer_score_mean: '',
    }
  }
  Object.assign(summary, {
    answer_exact_match_rate: round6(answerRows.filter(row => row.answer_exact_match).length / answerRows.length),
    answer_contains_rate: round6(answerRows.filter(row => row.answer_contains_gold).length / answerRows.length),
    answer_f1_mean: meanAvailable(answerRows, 'answer_f1'),
    locomo_answer_score_mean: meanAvailable(answerRows, 'locomo_answer_score'),
  })
  for (const category of [...new Set(answerRows.map(row => row.category).filter(Boolean))].sort()) {
    const selected = answerRows.filter(row => row.category === category)
    summary[`category_${category}_count`] = selected.length
    summary[`category_${category}_locomo_answer_score_mean`] = meanAvailable(selected, 'locomo_answer_score')
  }
  return summary
}

function stemmedTokens(value: unknown): string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean).map(porterStem)
}

function porterStem(token: string): string {
  let word = token
  if (word.length <= 2) return word
  if (word.endsWith('sses')) word = word.slice(0, -2)
  else if (word.endsWith('ies')) word = `${word.slice(0, -3)}i`
  else if (word.endsWith('ss')) word = word
  else if (word.endsWith('s')) word = word.slice(0, -1)

  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3)
    if (measure(stem) > 0) word = `${stem}ee`
  } else if (word.endsWith('ed') && containsVowel(word.slice(0, -2))) {
    word = step1bPostprocess(word.slice(0, -2))
  } else if (word.endsWith('ing') && containsVowel(word.slice(0, -3))) {
    word = step1bPostprocess(word.slice(0, -3))
  }

  if (word.endsWith('y') && containsVowel(word.slice(0, -1))) {
    word = `${word.slice(0, -1)}i`
  }

  const step2 = [
    ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'],
    ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'],
    ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'],
    ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
  ] as const
  for (const [suffix, replacement] of step2) {
    if (word.endsWith(suffix) && measure(word.slice(0, -suffix.length)) > 0) {
      word = `${word.slice(0, -suffix.length)}${replacement}`
      break
    }
  }

  const step3 = [
    ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', ''],
  ] as const
  for (const [suffix, replacement] of step3) {
    if (word.endsWith(suffix) && measure(word.slice(0, -suffix.length)) > 0) {
      word = `${word.slice(0, -suffix.length)}${replacement}`
      break
    }
  }

  const step4Suffixes = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']
  for (const suffix of step4Suffixes) {
    if (word.endsWith(suffix) && measure(word.slice(0, -suffix.length)) > 1) {
      word = word.slice(0, -suffix.length)
      break
    }
  }
  if ((word.endsWith('ion') && /[st]$/.test(word.slice(0, -3))) && measure(word.slice(0, -3)) > 1) {
    word = word.slice(0, -3)
  }

  if (word.endsWith('e')) {
    const stem = word.slice(0, -1)
    if (measure(stem) > 1 || (measure(stem) === 1 && !cvc(stem))) word = stem
  }
  if (measure(word) > 1 && doubleConsonant(word) && word.endsWith('l')) {
    word = word.slice(0, -1)
  }
  return word
}

function step1bPostprocess(word: string): string {
  if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) return `${word}e`
  if (doubleConsonant(word) && !/[lsz]$/.test(word)) return word.slice(0, -1)
  if (measure(word) === 1 && cvc(word)) return `${word}e`
  return word
}

function containsVowel(word: string): boolean {
  return [...word].some((char, index) => !isConsonant(word, index))
}

function isConsonant(word: string, index: number): boolean {
  const char = word[index]
  if ('aeiou'.includes(char)) return false
  if (char === 'y') return index === 0 ? true : !isConsonant(word, index - 1)
  return true
}

function measure(word: string): number {
  let count = 0
  let inVowelSeq = false
  for (let index = 0; index < word.length; index += 1) {
    if (isConsonant(word, index)) {
      if (inVowelSeq) count += 1
      inVowelSeq = false
    } else {
      inVowelSeq = true
    }
  }
  return count
}

function doubleConsonant(word: string): boolean {
  if (word.length < 2) return false
  const last = word.length - 1
  return word[last] === word[last - 1] && isConsonant(word, last)
}

function cvc(word: string): boolean {
  if (word.length < 3) return false
  const last = word.length - 1
  return (
    isConsonant(word, last) &&
    !isConsonant(word, last - 1) &&
    isConsonant(word, last - 2) &&
    !/[wxy]/.test(word[last])
  )
}

function multisetOverlap(left: string[], right: string[]): number {
  const counts = new Map<string, number>()
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1)
  let overlap = 0
  for (const token of right) {
    const count = counts.get(token) ?? 0
    if (count > 0) {
      overlap += 1
      counts.set(token, count - 1)
    }
  }
  return overlap
}

function setEquals(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function meanAvailable(rows: readonly RetrievalResultRow[], key: keyof RetrievalResultRow): number | '' {
  const values = rows
    .map(row => row[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return values.length ? round6(mean(values)) : ''
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
