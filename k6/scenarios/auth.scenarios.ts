import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { fail, sleep } from 'k6'
import { apiUrl, authHeaders, uniqueEmail } from '../helpers/config'
import { signUp } from '../helpers/api'
import { getJson, postJson, putJson } from '../helpers/http'

// ── Scenario: Guardian write path (guardian consent off) ────────────────────

/**
 * Guardian consent is off (owner ruling 2026-11-16): a 13 to 15 year old is active at signup,
 * and the guardian consent endpoints answer 409 guardian_consent_off before any other guard.
 * The routes keep their names, so their latency thresholds still apply to the refusal.
 */
export function testGuardianWritePath() {
  // Sign up teen — data flows downstream so the call is outside the describe block
  const { status: teenStatus, body: teen } = signUp(uniqueEmail('teen'), '2012-05-18')
  describe('POST /api/v1/auth/signup (teen)', () => {
    expect(teenStatus, 'status is 201').to.equal(201)
    expect(teen?.accountStatus, 'is active').to.equal('active')
    expect(teen?.guardianConsentRequired, 'needs no guardian').to.equal(false)
  })
  if (teenStatus !== 201) fail(`teen signup failed: ${teenStatus}`)
  if (!teen) fail('signup returned empty body')

  const refused = (path: string, body: unknown, name: string) =>
    postJson<{ code?: string }>(apiUrl(path), body, {
      tags: { name },
      expectedStatuses: [409],
    })
  const invitation = refused(
    '/api/v1/guardian/invitations',
    {
      teenId: teen.userId,
      guardianEmail: uniqueEmail('guardian'),
      consentLevel: 'read_only',
    },
    'guardian/invitations'
  )
  const accept = refused(
    '/api/v1/guardian/accept',
    { token: 'k6-no-token' },
    'guardian/accept'
  )
  const revoke = refused(
    '/api/v1/guardian/revoke',
    { guardianId: teen.userId, teenId: teen.userId },
    'guardian/revoke'
  )
  describe('guardian consent endpoints while consent is off', () => {
    for (const [label, response] of [
      ['invitations', invitation],
      ['accept', accept],
      ['revoke', revoke],
    ] as const) {
      expect(response.status, `${label} status is 409`).to.equal(409)
      expect(response.body?.code, `${label} code`).to.equal('guardian_consent_off')
    }
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
