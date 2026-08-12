import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { fail, sleep } from 'k6'
import { apiUrl, authHeaders, uniqueEmail } from '../helpers/config'
import {
  extractInvitationToken,
  type GuardianInvitationAcceptResponse,
  type GuardianInvitationResponse,
  signUp,
} from '../helpers/api'
import { getJson, postJson, putJson } from '../helpers/http'

// ── Scenario: Guardian write path ───────────────────────────────────────────

export function testGuardianWritePath() {
  // Sign up teen — data flows downstream so the call is outside the describe block
  const { status: teenStatus, body: teen } = signUp(uniqueEmail('teen'), '2012-05-18')
  describe('POST /api/v1/auth/signup (teen)', () => {
    expect(teenStatus, 'status is 201').to.equal(201)
    expect(teen?.guardianConsentRequired, 'requires guardian consent').to.equal(true)
  })
  if (teenStatus !== 201) fail(`teen signup failed: ${teenStatus}`)
  if (!teen) fail('signup returned empty body')

  const { status: inviteStatus, body: invitation } = postJson<GuardianInvitationResponse>(
    apiUrl('/api/v1/guardian/invitations'),
    {
      teenId: teen.userId,
      guardianEmail: uniqueEmail('guardian'),
      consentLevel: 'read_only',
    },
    { tags: { name: 'guardian/invitations' } }
  )
  describe('POST /api/v1/guardian/invitations', () => {
    expect(inviteStatus, 'status is 201').to.equal(201)
    expect(invitation?.teenId, 'targets teen').to.equal(teen.userId)
    expect(invitation?.deliveryQueued, 'queues delivery').to.equal(true)
  })
  if (inviteStatus !== 201) fail(`guardian invitation failed: ${inviteStatus}`)
  if (!invitation) fail('invitation returned empty body')

  const token = extractInvitationToken(invitation.invitationLink)
  const { status: acceptStatus, body: accepted } =
    postJson<GuardianInvitationAcceptResponse>(
      apiUrl('/api/v1/guardian/accept'),
      { token },
      { tags: { name: 'guardian/accept' } }
    )
  describe('POST /api/v1/guardian/accept', () => {
    expect(acceptStatus, 'status is 200').to.equal(200)
    expect(accepted?.teenId, 'links teen').to.equal(teen.userId)
    expect(accepted?.guardianId.length, 'creates guardian').to.be.at.least(1)
  })
  if (acceptStatus !== 200) fail(`guardian accept failed: ${acceptStatus}`)
  if (!accepted) fail('accept returned empty body')

  const { status: revokeStatus, body: revoked } = postJson<{
    teenId: string
    guardianId: string
  }>(
    apiUrl('/api/v1/guardian/revoke'),
    { guardianId: accepted.guardianId, teenId: teen.userId },
    {
      headers: authHeaders(accepted.guardianId, 'guardian'),
      tags: { name: 'guardian/revoke' },
    }
  )
  describe('POST /api/v1/guardian/revoke', () => {
    expect(revokeStatus, 'status is 200').to.equal(200)
    expect(revoked?.teenId, 'targets teen').to.equal(teen.userId)
    expect(revoked?.guardianId, 'targets guardian').to.equal(accepted.guardianId)
  })

  sleep(0.2)
}

// ── Scenario: Profile read + moderation write ────────────────────────────────

export function testProfileAndModeration() {
  // Sign up adult — userId needed for both subsequent requests
  const { status: signupStatus, body: adult } = signUp(uniqueEmail('adult'), '1990-05-18')
  describe('POST /api/v1/auth/signup (adult)', () => {
    expect(signupStatus, 'status is 201').to.equal(201)
  })
  if (signupStatus !== 201) fail(`adult signup failed: ${signupStatus}`)
  if (!adult) fail('signup returned empty body')

  describe('GET /api/v1/user/profile', () => {
    const { status, body } = getJson<{ user: { id: string; role: string } }>(
      apiUrl('/api/v1/user/profile'),
      { headers: authHeaders(adult.userId, 'admin'), tags: { name: 'user/profile' } }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.user.id, 'returns authenticated user').to.equal(adult.userId)
    expect(body?.user.role, 'returns requested role').to.equal('admin')
  })

  describe('POST /api/v1/moderation/actions', () => {
    const { status, body } = postJson<{ tracked: boolean }>(
      apiUrl('/api/v1/moderation/actions'),
      {
        moderatorId: adult.userId,
        targetId: `wardrobe-item-${__VU}-${__ITER}`,
        action: 'hide',
        reason: 'k6 baseline moderation smoke',
        contentType: 'wardrobe_item',
        timestamp: new Date().toISOString(),
      },
      {
        headers: authHeaders(adult.userId, 'admin'),
        tags: { name: 'moderation/actions' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.tracked, 'action is tracked').to.equal(true)
  })

  sleep(0.2)
}

// ── Scenario: Comfort preferences ───────────────────────────────────────────

export function testComfortPreferences() {
  const { status: signupStatus, body: user } = signUp(
    uniqueEmail('comfort-user'),
    '1990-05-18'
  )
  if (signupStatus !== 201 || !user) {
    fail(`comfort-user signup failed: ${signupStatus}`)
  }

  describe('GET /api/v1/personalization/comfort', () => {
    const { status, body } = getJson<{
      data: { runsColdWarm: string; windTolerance: string; precipPreparedness: string }
    }>(apiUrl('/api/v1/personalization/comfort'), {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/comfort-get' },
    })
    expect(status, 'status is 200').to.equal(200)
    expect(body?.data?.runsColdWarm, 'default runsColdWarm is neutral').to.equal(
      'neutral'
    )
  })

  describe('PUT /api/v1/personalization/comfort', () => {
    const { status, body } = putJson<{
      data: { runsColdWarm: string; windTolerance: string; precipPreparedness: string }
    }>(
      apiUrl('/api/v1/personalization/comfort'),
      {
        runsColdWarm: 'warm',
        windTolerance: 'high',
        precipPreparedness: 'low',
      },
      {
        headers: authHeaders(user.userId, 'admin'),
        tags: { name: 'api/comfort-put' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.data?.runsColdWarm, 'updated runsColdWarm is warm').to.equal('warm')
  })

  sleep(0.2)
}
