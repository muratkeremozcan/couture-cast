import {
  guardianInvitationAcceptInputSchema,
  guardianInvitationAcceptResponseSchema,
  guardianConsentRevokeInputSchema,
  guardianConsentRevokeResponseSchema,
  guardianInvitationInputSchema,
  guardianInvitationResponseSchema,
  type GuardianConsentRevokeInput,
  type GuardianConsentRevokeResponse,
  type GuardianInvitationAcceptInput,
  type GuardianInvitationAcceptResponse,
  type GuardianInvitationInput,
  type GuardianInvitationResponse,
} from '@couture/api-client/contracts/http'
import { resolveWebApiBaseUrl } from './api-client'

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? `Guardian request failed with status ${response.status}`
  } catch {
    return `Guardian request failed with status ${response.status}`
  }
}

export async function inviteGuardianFromWeb(
  input: GuardianInvitationInput,
  fetchImpl: typeof fetch = fetch
): Promise<GuardianInvitationResponse> {
  const payload = guardianInvitationInputSchema.parse(input)
  const response = await fetchImpl(
    `${resolveWebApiBaseUrl()}/api/v1/guardian/invitations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return guardianInvitationResponseSchema.parse(await response.json())
}

export async function acceptGuardianInvitationFromWeb(
  input: GuardianInvitationAcceptInput,
  fetchImpl: typeof fetch = fetch
): Promise<GuardianInvitationAcceptResponse> {
  const payload = guardianInvitationAcceptInputSchema.parse(input)
  const response = await fetchImpl(`${resolveWebApiBaseUrl()}/api/v1/guardian/accept`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return guardianInvitationAcceptResponseSchema.parse(await response.json())
}

export async function revokeGuardianConsentFromWeb(
  input: GuardianConsentRevokeInput,
  fetchImpl: typeof fetch = fetch
): Promise<GuardianConsentRevokeResponse> {
  const payload = guardianConsentRevokeInputSchema.parse(input)
  const response = await fetchImpl(`${resolveWebApiBaseUrl()}/api/v1/guardian/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return guardianConsentRevokeResponseSchema.parse(await response.json())
}
