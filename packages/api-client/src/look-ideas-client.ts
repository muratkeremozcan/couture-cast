import { lookIdeasResponseSchema, type LookIdeasInput } from './contracts/http/look-ideas'
import type { DefaultApi } from './generated'
import { withRequestDeadline } from './request-deadline'

export async function requestLookIdeas(
  api: DefaultApi,
  input: LookIdeasInput,
  signal: AbortSignal
) {
  const response = await withRequestDeadline(8_000, [signal], (signal) =>
    api.apiV1PersonalizationLookIdeasPost({ lookIdeasInput: input }, { signal })
  )
  return lookIdeasResponseSchema.parse(response).data
}
