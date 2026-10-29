import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'

/** The outcome each share-card provider state configures for the next interaction. */
export type ShareCardOutcome =
  | 'prepared'
  | 'denied'
  | 'source_unavailable'
  | 'preview_changed'
let outcome: ShareCardOutcome = 'prepared'
export function configureShareCardOutcome(next: ShareCardOutcome) {
  outcome = next
}
export function resetShareCardOutcome() {
  outcome = 'prepared'
}
export const shareCardServiceDouble = {
  prepare: () => {
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
}
