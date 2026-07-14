import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { applyEnvOverrides, getConfig, getScenarioConfig } from '@couture/k6-utils/config'
import { handleSummary } from '@couture/k6-utils/handle-summary'
import { fail, sleep } from 'k6'
import {
  apiUrl,
  authHeaders,
  BASE_URL,
  infraDelay,
  SLO,
  TEST_ENV,
  uniqueEmail,
} from '../helpers/config'
import {
  extractInvitationToken,
  type GuardianInvitationAcceptResponse,
  type GuardianInvitationResponse,
  type QueueHealthResponse,
  signUp,
} from '../helpers/api'
import { getJson, postJson } from '../helpers/http'

export { handleSummary }

const scenarioNames = [
  'testApiHealth',
  'testRealtimePoll',
  'testQueueHealth',
  'testGuardianWritePath',
  'testProfileAndModeration',
]

export const options = {
  ...getScenarioConfig(scenarioNames, applyEnvOverrides(getConfig())),
  thresholds: {
    http_req_duration: [`p(95)<${SLO.aggregate + infraDelay}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.95'],
    'http_req_duration{name:api/health}': [`p(95)<${SLO.health + infraDelay}`],
    'http_req_duration{name:api/events-poll}': [`p(95)<${SLO.eventsPoll + infraDelay}`],
    'http_req_duration{name:api/queue-health}': [`p(95)<${SLO.queueHealth + infraDelay}`],
    'http_req_duration{name:auth/signup}': [`p(95)<${SLO.signup + infraDelay}`],
    'http_req_duration{name:guardian/invitations}': [
      `p(95)<${SLO.guardianInvite + infraDelay}`,
    ],
    'http_req_duration{name:guardian/accept}': [
      `p(95)<${SLO.guardianAccept + infraDelay}`,
    ],
    'http_req_duration{name:guardian/revoke}': [
      `p(95)<${SLO.guardianRevoke + infraDelay}`,
    ],
    'http_req_duration{name:user/profile}': [`p(95)<${SLO.userProfile + infraDelay}`],
    'http_req_duration{name:moderation/actions}': [
      `p(95)<${SLO.moderationAction + infraDelay}`,
    ],
  },
}

// When options.scenarios is set k6 dispatches to named exports below and ignores default.
// The default runs all scenarios in sequence — used as a fallback when running without
// TEST_CONFIG (e.g. k6 run dist/test.js --vus 1 --iterations 1).
export default function () {
  testApiHealth()
  testRealtimePoll()
  testQueueHealth()
  testGuardianWritePath()
  testProfileAndModeration()
}

export function setup() {
  console.log(`k6 target: ${BASE_URL} (TEST_ENV=${TEST_ENV})`)
  if (TEST_ENV !== 'local') {
    console.warn(
      `[write-path] Running against "${TEST_ENV}": testGuardianWritePath and testProfileAndModeration ` +
        'create user accounts and moderation records that are not cleaned up. ' +
        'Schedule periodic db:reset or scope write-path scenarios to local only if this accumulates.'
    )
  }
}

// ── Scenario: API health ─────────────────────────────────────────────────────

export function testApiHealth() {
  describe('GET /api/health', () => {
    const { status, body } = getJson<{ status: string; service: string }>(
      apiUrl('/api/health'),
      { tags: { name: 'api/health' } }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.status, 'status is ok').to.equal('ok')
    expect(body?.service, 'service name').to.equal('couturecast-api')
  })

  sleep(0.2)
}

// ── Scenario: Realtime poll ──────────────────────────────────────────────────

export function testRealtimePoll() {
  const { status: signupStatus, body: user } = signUp(
    uniqueEmail('poll-user'),
    '1990-05-18'
  )
  if (signupStatus !== 201 || !user) {
    fail(`poll-user signup failed: ${signupStatus}`)
  }

  describe('GET /api/v1/events/poll', () => {
    const since = encodeURIComponent(new Date(Date.now() - 60_000).toISOString())
    const { status, body } = getJson<{ events: unknown[]; nextSince: string | null }>(
      apiUrl(`/api/v1/events/poll?since=${since}`),
      {
        headers: authHeaders(user.userId, 'admin'),
        tags: { name: 'api/events-poll' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.events, 'events is array').to.be.an('array')
    expect(
      body != null && (body.nextSince === null || typeof body.nextSince === 'string'),
      'cursor is null or string'
    ).to.equal(true)
  })

  sleep(0.2)
}

// ── Scenario: Queue health ───────────────────────────────────────────────────

export function testQueueHealth() {
  describe('GET /api/v1/health/queues', () => {
    const { status, body } = getJson<QueueHealthResponse>(
      apiUrl('/api/v1/health/queues'),
      {
        tags: { name: 'api/queue-health' },
      }
    )
    expect(status, 'status is 200').to.equal(200)
    expect(body?.status, 'status is ok').to.equal('ok')
    expect(body?.queues.length, 'at least 4 queues').to.be.at.least(4)
    expect(body?.queues, 'includes weather-ingestion').to.include('weather-ingestion')
    expect(body?.queues, 'includes alert-fanout').to.include('alert-fanout')
  })

  sleep(0.2)
}

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
