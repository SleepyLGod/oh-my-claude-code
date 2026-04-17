import { getLLMClient } from 'src/services/llm/factory.js'
import type {
  LLMSideQueryRequest as SideQueryOptions,
  LLMSideQueryResponse,
} from 'src/services/llm/types.js'

export type { SideQueryOptions, LLMSideQueryResponse }

export async function sideQuery(
  opts: SideQueryOptions,
): Promise<LLMSideQueryResponse> {
  return getLLMClient().sideQuery(opts)
}
