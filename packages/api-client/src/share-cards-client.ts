import type { DefaultApi } from './generated'
import { abortError, withRequestDeadline } from './request-deadline'
import {
  prepareShareCardInputSchema,
  prepareShareCardResponseSchema,
  shareCardCapabilitiesResponseSchema,
  type PrepareShareCardInput,
  type ShareCardCapabilities,
} from './contracts/http/share-cards'

/** Story 6.9 D4: the capabilities read gives up after 5 s and then reads as off. */
export const SHARE_CARD_CAPABILITIES_DEADLINE_MS = 5000
const off = (): ShareCardCapabilities => ({ nativeShare: false })

export function shareCardsClient(
  api: Pick<DefaultApi, 'prepareShareCard' | 'getShareCardCapabilities'>
) {
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
    // Never rejects. An error, a 404 from a pre-6.9 server, the deadline, a cancelled
    // caller, a malformed body or a missing field all resolve as off, so Share never
    // appears on a guess. The abort race also settles a transport that ignores its
    // signal. Callers bind the answer to the member they asked for.
    capabilities: async (signal?: AbortSignal): Promise<ShareCardCapabilities> => {
      try {
        return await withRequestDeadline(
          SHARE_CARD_CAPABILITIES_DEADLINE_MS,
          [signal],
          (combined) => {
            if (combined.aborted) return Promise.resolve(off())
            const abandoned = new Promise<ShareCardCapabilities>((resolve) => {
              combined.addEventListener('abort', () => resolve(off()), { once: true })
            })
            const read = api
              .getShareCardCapabilities({ signal: combined })
              .then((body) => {
                const result = shareCardCapabilitiesResponseSchema.safeParse(body)
                return result.success && !combined.aborted
                  ? { nativeShare: result.data.data.nativeShare }
                  : off()
              })
              .catch(off)
            return Promise.race([read, abandoned])
          }
        )
      } catch {
        return off()
      }
    },
  }
}
