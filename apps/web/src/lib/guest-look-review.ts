'use client'

import { requestStyleProfile } from '@couture/api-client'
import type { GuestLookReviewClient } from '@couture/utils'
import { createWebApiClient } from './api-client'
import { createSavedLookFromWeb } from './saved-looks'
import { saveWebStyleProfileForMember } from './style-profile'
import { currentWebStyleScope, captureWebStyleBearer } from './use-web-session'
import { resolveWebSessionToken, webSessionIdentity } from './web-session'

export async function verifiedGuestLookClient(
  memberId: string
): Promise<GuestLookReviewClient & { isCurrent: () => boolean }> {
  await resolveWebSessionToken()
  const scope = currentWebStyleScope()
  if (!scope || webSessionIdentity() !== memberId)
    throw new Error('Guest review session changed')
  const isCurrent = () => currentWebStyleScope() === scope
  const verifiedToken = async () => {
    await resolveWebSessionToken()
    const token = captureWebStyleBearer(scope)
    if (!token) throw new Error('Guest review session changed')
    return token
  }
  return {
    isCurrent,
    readStyle: async () =>
      requestStyleProfile(createWebApiClient({ accessToken: await verifiedToken() }), {
        method: 'GET',
      }),
    writeStyle: (input) => saveWebStyleProfileForMember(memberId, input),
    save: async (look, idempotencyKey) =>
      createSavedLookFromWeb(look, {
        accessToken: await verifiedToken(),
        idempotencyKey,
      }),
  }
}
