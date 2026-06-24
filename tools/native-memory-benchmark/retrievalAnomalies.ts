export type SelectorOutputInspection = {
  reason: string
  selectedFromTrace: string
  rawText: string
}

export function inspectSelectorArtifacts(params: {
  rawText: string
  response?: unknown
  error?: unknown
  selectorParseMode?: 'strict' | 'lenient'
}): SelectorOutputInspection {
  const errorText = errorPreview(params.error)
  if (errorText) {
    return {
      reason: 'selector_llm_error',
      selectedFromTrace: '',
      rawText: errorText,
    }
  }
  if (!params.rawText.trim() && stopReason(params.response) === 'max_tokens') {
    return {
      reason: 'selector_max_tokens_no_text',
      selectedFromTrace: '',
      rawText: '',
    }
  }
  return inspectSelectorOutput(params.rawText, params.selectorParseMode)
}

export function inspectSelectorOutput(
  rawText: string,
  selectorParseMode: 'strict' | 'lenient' = 'strict',
): SelectorOutputInspection {
  const filenameHints = extractFilenameHints(rawText)
  if (!rawText.trim()) {
    return {
      reason: 'selector_no_text_output',
      selectedFromTrace: '',
      rawText,
    }
  }
  const parsed = parseJsonOrFencedJson(rawText)
  if (parsed.ok) {
    const parsedValue = parsed.value
    if (Array.isArray(parsedValue)) {
      if (selectorParseMode === 'lenient') {
        return {
          reason: '',
          selectedFromTrace: parsedValue.filter((item): item is string => typeof item === 'string').join(';'),
          rawText,
        }
      }
      return {
        reason: 'selector_schema_mismatch',
        selectedFromTrace: parsedValue.filter((item): item is string => typeof item === 'string').join(';'),
        rawText,
      }
    }
    if (isRecord(parsedValue) && Array.isArray(parsedValue.selected_memories)) {
      return {
        reason: '',
        selectedFromTrace: parsedValue.selected_memories.filter((item): item is string => typeof item === 'string').join(';'),
        rawText,
      }
    }
    return {
      reason: 'selector_schema_mismatch',
      selectedFromTrace: '',
      rawText,
    }
  }

  if (selectorParseMode === 'lenient' && filenameHints) {
    return {
      reason: '',
      selectedFromTrace: filenameHints,
      rawText,
    }
  }

  return {
    reason: 'selector_invalid_json',
    selectedFromTrace: filenameHints,
    rawText,
  }
}

function parseJsonOrFencedJson(rawText: string): { ok: true; value: unknown } | { ok: false } {
  for (const candidate of [rawText, extractFencedJson(rawText)]) {
    if (!candidate) continue
    try {
      return {
        ok: true,
        value: JSON.parse(candidate),
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { ok: false }
}

function extractFencedJson(rawText: string): string {
  const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match?.[1]?.trim() ?? ''
}

function extractFilenameHints(rawText: string): string {
  const matches = rawText.match(/[A-Za-z0-9][A-Za-z0-9._-]*\.md/g) ?? []
  return [...new Set(matches)].join(';')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stopReason(value: unknown): string {
  if (!isRecord(value)) return ''
  return typeof value.stop_reason === 'string' ? value.stop_reason : ''
}

function errorPreview(value: unknown): string {
  if (value === undefined) return ''
  if (!isRecord(value)) return String(value).slice(0, 500)
  const message = typeof value.message === 'string' ? value.message : ''
  const name = typeof value.name === 'string' ? value.name : ''
  const preview = [name, message].filter(Boolean).join(': ')
  if (preview) return preview.slice(0, 500)
  try {
    return JSON.stringify(value).slice(0, 500)
  } catch {
    return String(value).slice(0, 500)
  }
}
