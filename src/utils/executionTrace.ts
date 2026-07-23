import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type ExecutionTraceContext = {
  runId?: string
  caseId?: string
  windowId?: string
  eventId?: string
  sessionId?: string
  questionId?: string
  attempt?: number
  phase?: string
  forkLabel?: string
  querySource?: string
}

export type LlmCallTrace = {
  traceId: string
  startedAt: number
}

type TraceWriteResult = {
  path: string
  traceWriteMs: number
}

const traceContext = new AsyncLocalStorage<ExecutionTraceContext>()

export function isExecutionTraceEnabled(): boolean {
  return Boolean(process.env.CLAUDE_CODE_TRACE_DIR?.trim())
}

export function getExecutionTraceContext(): ExecutionTraceContext {
  return traceContext.getStore() ?? {}
}

export async function withExecutionTraceContext<T>(
  context: ExecutionTraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = getExecutionTraceContext()
  return await traceContext.run({ ...parent, ...context }, fn)
}

export function createExecutionTraceId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export function startExecutionTraceLlmCall(fields: {
  provider: string
  profileName: string
  model?: unknown
  endpoint: string
  streaming: boolean
  request: unknown
}): LlmCallTrace | undefined {
  if (!isExecutionTraceEnabled()) return undefined

  const traceId = createExecutionTraceId('llm-call')
  const startedAt = performance.now()
  const requestArtifact = writeExecutionTraceArtifact(
    'llm-call',
    traceId,
    'request',
    fields.request,
  )
  writeExecutionTraceEvent('llm_call_start', {
    trace_id: traceId,
    provider: fields.provider,
    profile_name: fields.profileName,
    model: fields.model,
    endpoint: fields.endpoint,
    streaming: fields.streaming,
    request_artifact_path: requestArtifact?.path,
  })
  return { traceId, startedAt }
}

export function finishExecutionTraceLlmCall(
  trace: LlmCallTrace | undefined,
  fields: {
    response: unknown
    requestId?: string
    model?: unknown
    usage?: unknown
    stopReason?: unknown
  },
): void {
  if (!trace) return

  const responseArtifact = writeExecutionTraceArtifact(
    'llm-call',
    trace.traceId,
    'response',
    fields.response,
  )
  writeExecutionTraceEvent('llm_call_finish', {
    trace_id: trace.traceId,
    request_id: fields.requestId,
    model: fields.model,
    usage: fields.usage,
    stop_reason: fields.stopReason,
    latency_ms: Math.round((performance.now() - trace.startedAt) * 1000) / 1000,
    response_artifact_path: responseArtifact?.path,
  })
}

export function errorExecutionTraceLlmCall(
  trace: LlmCallTrace | undefined,
  error: unknown,
): void {
  if (!trace) return

  const errorArtifact = writeExecutionTraceArtifact(
    'llm-call',
    trace.traceId,
    'error',
    error,
  )
  writeExecutionTraceEvent('llm_call_error', {
    trace_id: trace.traceId,
    latency_ms: Math.round((performance.now() - trace.startedAt) * 1000) / 1000,
    error_artifact_path: errorArtifact?.path,
    error_message: error instanceof Error ? error.message : String(error),
  })
}

export function writeExecutionTraceArtifact(
  kind: string,
  traceId: string,
  suffix: string,
  data: unknown,
): TraceWriteResult | undefined {
  const root = traceRoot()
  if (!root) return undefined

  try {
    const start = performance.now()
    const dir = join(root, 'artifacts', kind)
    mkdirSync(dir, { recursive: true })
    const relativePath = `artifacts/${kind}/${traceId}-${suffix}.json`
    writeFileSync(join(root, relativePath), `${safeJsonStringify(data, 2)}\n`)
    return {
      path: relativePath,
      traceWriteMs: Math.round((performance.now() - start) * 1000) / 1000,
    }
  } catch (error) {
    console.error(
      'Failed to write execution trace artifact',
      { kind, traceId, suffix, error },
    )
    return undefined
  }
}

export function writeExecutionTraceEvent(
  eventType: string,
  fields: Record<string, unknown>,
): void {
  const root = traceRoot()
  if (!root) return

  try {
    const start = performance.now()
    mkdirSync(root, { recursive: true })
    const event = {
      timestamp: new Date().toISOString(),
      event_type: eventType,
      ...getExecutionTraceContext(),
      ...fields,
    }
    appendFileSync(join(root, 'events.jsonl'), `${safeJsonStringify(event)}\n`)
    const traceWriteMs = Math.round((performance.now() - start) * 1000) / 1000
    if (eventType !== 'trace_write') {
      appendFileSync(
        join(root, 'events.jsonl'),
        `${safeJsonStringify({
          timestamp: new Date().toISOString(),
          event_type: 'trace_write',
          trace_id: fields.trace_id,
          trace_write_ms: traceWriteMs,
        })}\n`,
      )
    }
  } catch (error) {
    console.error(
      'Failed to write execution trace event',
      { eventType, traceId: fields.trace_id, error },
    )
  }
}

function traceRoot(): string | undefined {
  const root = process.env.CLAUDE_CODE_TRACE_DIR?.trim()
  return root || undefined
}

function safeJsonStringify(data: unknown, space?: number): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(
    data,
    (_key, value: unknown) => {
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        }
      }
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    },
    space,
  )
}
