import { getModelMaxOutputTokens } from 'src/utils/context.js'
import { validateBoundedIntEnvVar } from 'src/utils/envValidation.js'

export function getDefaultMaxOutputTokensForLLM(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)
  return validateBoundedIntEnvVar(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    maxOutputTokens.default,
    maxOutputTokens.upperLimit,
  ).effective
}
