import { requestStyleProfile } from '@couture/api-client'
import type { GuestLookReviewClient } from '@couture/utils'
import { createMobileApiClient } from './api-client'
import { mobileApplicationUserId, resolveMobileAccessToken } from './mobile-auth'
import { createSavedLookFromMobile } from './saved-looks'
import { currentMobileStyleScope, saveMobileStyleProfileForScope } from './style-profile'

export async function verifiedGuestLookClient(
  memberId: string
): Promise<GuestLookReviewClient & { isCurrent: () => boolean }> {
  if (!(await resolveMobileAccessToken()) || mobileApplicationUserId() !== memberId)
    throw new Error('Guest review session changed')
  const scope = currentMobileStyleScope()
  if (!scope) throw new Error('Guest review session changed')
  const isCurrent = () => currentMobileStyleScope() === scope
  const verifiedToken = async () => {
    const token = await resolveMobileAccessToken()
    if (!token || !isCurrent()) throw new Error('Guest review session changed')
    return token
  }
  return {
    isCurrent,
    readStyle: async () =>
      requestStyleProfile(createMobileApiClient({ accessToken: await verifiedToken() }), {
        method: 'GET',
      }),
    writeStyle: (input) => saveMobileStyleProfileForScope(scope, input),
    save: async (look, idempotencyKey) =>
      createSavedLookFromMobile(look, {
        accessToken: await verifiedToken(),
        idempotencyKey,
      }),
  }
}
