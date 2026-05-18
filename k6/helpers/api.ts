// Couture Cast API flow helpers: response types and reusable request wrappers.
// Mirrors the pattern from k6/helpers/mcp-client.ts in the seon-mcp-server reference.
// Only API mechanics live here — assertions stay in the test file.

import { fail } from 'k6'
import type { ApiResponse } from '@couture/k6-utils'
import { apiUrl } from './config'
import { postJson } from './http'

export type SignupResponse = {
  userId: string
  accountStatus: 'active' | 'pending_guardian_consent'
  guardianConsentRequired: boolean
}

export type GuardianInvitationResponse = {
  invitationLink: string
  teenId: string
  deliveryQueued: boolean
}

export type GuardianInvitationAcceptResponse = {
  teenId: string
  guardianId: string
  consentLevel: 'read_only' | 'full_access'
}

export type QueueHealthResponse = {
  status: string
  queues: string[]
}

/**
 * Signs up a new user via POST /api/v1/auth/signup.
 * Caller owns all assertions — this just wraps the request.
 */
export function signUp(email: string, birthdate: string): ApiResponse<SignupResponse> {
  return postJson<SignupResponse>(
    apiUrl('/api/v1/auth/signup'),
    { email, birthdate },
    { tags: { name: 'auth/signup' } }
  )
}

/**
 * Extracts the `?token=` query param from a guardian invitation link.
 * Calls k6's `fail()` (which halts the VU) if the token is absent.
 */
export function extractInvitationToken(invitationLink: string): string {
  const match = /[?&]token=([^&]+)/.exec(invitationLink)
  const encodedToken = match?.[1]

  if (!encodedToken) {
    fail('guardian invitation link did not include a token query parameter')
  }

  return decodeURIComponent(encodedToken)
}
