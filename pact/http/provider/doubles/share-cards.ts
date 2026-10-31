import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrepareShareCardInput } from '@couture/api-client/contracts/http'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'

/** The outcome each share-card provider state configures for the next interaction. */
export type ShareCardOutcome =
  | 'prepared'
  | 'denied'
  | 'source_unavailable'
  | 'preview_changed'
/**
 * Story 6.9: the member's `share_card_native_share_enabled` answer, or `absent` for a
 * pre-6.9 server with no capabilities route (new client, old server).
 */
export type ShareCardNativeShare = boolean | 'absent'
let outcome: ShareCardOutcome = 'prepared'
let nativeShare: ShareCardNativeShare = true
export function configureShareCardOutcome(next: ShareCardOutcome) {
  outcome = next
}
export function configureShareCardNativeShare(next: ShareCardNativeShare) {
  nativeShare = next
}
export function resetShareCardOutcome() {
  outcome = 'prepared'
  nativeShare = true
}
export const shareCardServiceDouble = {
  prepare: (_member: string, input: PrepareShareCardInput) => {
    // The real service refuses a flag-off share before any source or render work.
    if (input.purpose === 'share' && nativeShare !== true)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'share_disabled',
        message: 'share_disabled',
      })
    if (outcome === 'denied')
      throw new ForbiddenException({ statusCode: 403, code: 'denied', message: 'denied' })
    if (outcome === 'source_unavailable')
      throw new NotFoundException({
        statusCode: 404,
        code: 'source_unavailable',
        message: 'source_unavailable',
      })
    if (outcome === 'preview_changed')
      throw new ConflictException({
        statusCode: 409,
        code: 'preview_changed',
        message: 'preview_changed',
      })
    return Promise.resolve(preparedShareCardFixture)
  },
  capabilities: () => {
    // Nest's own unknown-route answer, which is what a pre-6.9 server returns.
    if (nativeShare === 'absent')
      throw new NotFoundException({
        statusCode: 404,
        message: 'Cannot GET /api/v1/share-cards/capabilities',
        error: 'Not Found',
      })
    return Promise.resolve({ nativeShare })
  },
}
