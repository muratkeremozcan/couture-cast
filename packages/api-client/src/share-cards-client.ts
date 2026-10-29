import type { DefaultApi } from './generated'
import { abortError, withRequestDeadline } from './request-deadline'
import {
  prepareShareCardInputSchema,
  prepareShareCardResponseSchema,
  type PrepareShareCardInput,
} from './contracts/http/share-cards'

export function shareCardsClient(api: Pick<DefaultApi, 'prepareShareCard'>) {
  return {
    prepare: (input: PrepareShareCardInput, signal?: AbortSignal) =>
      withRequestDeadline(16000, [signal], async (combined) => {
        const result = prepareShareCardResponseSchema.parse(
          await api.prepareShareCard(
            {
              prepareShareCardRequest: prepareShareCardInputSchema.parse(input),
            },
            { signal: combined }
          )
        )
        if (combined.aborted) throw abortError('Preparation cancelled')
        return result.data
      }),
  }
}
