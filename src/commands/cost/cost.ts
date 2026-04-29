import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import { getResolvedLLMProfile } from '../../services/llm/config.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export const call: LocalCommandCall = async () => {
  const activeProfile = getResolvedLLMProfile()

  if (activeProfile.type === 'anthropic' && isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Claude Code usage'
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  const cost = formatTotalCost()
  if (activeProfile.billingMode === 'subscription') {
    return {
      type: 'text',
      value: `${cost}\n\nActive provider uses subscription/quota billing; token usage is shown, but dollar cost may be n/a for this profile.`,
    }
  }
  return { type: 'text', value: cost }
}
