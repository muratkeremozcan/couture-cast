import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { applyEnvOverrides, getConfig, getScenarioConfig } from '@couture/k6-utils/config'
import { handleSummary } from '@couture/k6-utils/handle-summary'
import { fail, sleep } from 'k6'
import http from 'k6/http'
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
import { deleteRequest, getJson, patchJson, postJson, putJson } from '../helpers/http'

export { handleSummary }

const scenarioNames = [
  'testApiHealth',
  'testRealtimePoll',
  'testQueueHealth',
  'testGuardianWritePath',
  'testProfileAndModeration',
  'testRitualOutfits',
  'testComfortPreferences',
  'testCapsuleReadPaths',
  'testCapsuleWritePaths',
  'testCapsuleColdRitual',
  'testRitualCommerceEligible',
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
    'http_req_duration{name:api/ritual}': [`p(95)<${SLO.eventsPoll + infraDelay}`],
    'http_req_duration{name:api/comfort-get}': [`p(95)<${SLO.userProfile + infraDelay}`],
    'http_req_duration{name:api/comfort-put}': [`p(95)<${SLO.userProfile + infraDelay}`],
    // Story 4.3 capsule endpoints, tagged individually so a regression is attributable.
    'http_req_duration{name:capsules/list}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/detail}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/search}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/create}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/update}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/favorite}': [
      `p(95)<${SLO.capsuleWrite + infraDelay}`,
    ],
    'http_req_duration{name:capsules/delete}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/ritual-cold}': [
      `p(95)<${SLO.capsuleRitualCold + infraDelay}`,
    ],
    'http_req_failed{name:capsules/list}': ['rate<0.01'],
    'http_req_failed{name:capsules/detail}': ['rate<0.01'],
    'http_req_failed{name:capsules/search}': ['rate<0.01'],
    'http_req_failed{name:capsules/create}': ['rate<0.01'],
    'http_req_failed{name:capsules/update}': ['rate<0.01'],
    'http_req_failed{name:capsules/favorite}': ['rate<0.01'],
    'http_req_failed{name:capsules/delete}': ['rate<0.01'],
    'http_req_failed{name:capsules/ritual-cold}': ['rate<0.01'],
    // Story 5.1: the warm eligible ritual read, where the affiliate eligibility
    // chain is the marginal cost. Tagged on its own so a breach names commerce
    // rather than the ritual aggregate it shares a route with.
    'http_req_duration{name:api/ritual-eligible}': [
      `p(95)<${SLO.ritualEligible + infraDelay}`,
    ],
    'http_req_failed{name:api/ritual-eligible}': ['rate<0.01'],
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
  testRitualOutfits()
  testComfortPreferences()
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

// ── Scenario: Ritual outfit recommendations ──────────────────────────────────

export function testRitualOutfits() {
  const { status: signupStatus, body: user } = signUp(
    uniqueEmail('ritual-user'),
    '1990-05-18'
  )
  if (signupStatus !== 201 || !user) {
    fail(`ritual-user signup failed: ${signupStatus}`)
  }

  // Create location preference Chicago (chicago-il) for the user
  const locationRes = postJson<{ data: { id: string } }>(
    apiUrl('/api/v1/locations'),
    {
      label: 'Home',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    },
    {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/locations' },
    }
  )
  if (locationRes.status !== 201) {
    fail(`failed to create location preference: ${locationRes.status}`)
  }

  describe('GET /api/v1/ritual', () => {
    const { status, body } = getJson<{
      data: { outfits: unknown[]; weather: unknown; badges: string[] }
    }>(apiUrl('/api/v1/ritual'), {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/ritual' },
    })
    expect(status, 'status is 200').to.equal(200)
    expect(body?.data?.outfits, 'outfits is array').to.be.an('array')
    expect(body?.data?.outfits?.length, '3 scenario outfits').to.equal(3)
    const outfits = body?.data?.outfits as { reasoningBadges?: unknown[] }[]
    const firstOutfit = outfits[0]
    expect(firstOutfit?.reasoningBadges, 'reasoningBadges is array').to.be.an('array')
    expect(
      firstOutfit?.reasoningBadges?.length,
      'at least 1 reasoning badge'
    ).to.be.at.least(1)
    expect(body?.data?.weather, 'weather snapshot present').to.be.an('object')
    expect(body?.data?.badges, 'badges is array').to.be.an('array')
  })

  // Second request should hit the Redis cache — verify it still returns 200
  describe('GET /api/v1/ritual (cached)', () => {
    const { status } = getJson<unknown>(apiUrl('/api/v1/ritual'), {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/ritual' },
    })
    expect(status, 'cached status is 200').to.equal(200)
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

/* --------------------------------------------------------------------------
 * Story 4.3 outfit capsule capacity scenarios.
 *
 * Every request is tagged individually so a threshold breach names the endpoint
 * that caused it rather than the aggregate.
 *
 * Two modes, because latency thresholds only mean something at volume:
 *
 * - Capacity. Seed the representative 1,000-capsule / 10,000-join owner and
 *   pass `CAPSULE_PERF_USER_ID=<owner>`. Every scenario then targets that
 *   fixture and the tagged P95 thresholds are meaningful.
 * - Smoke, the default. No fixture is assumed, so each scenario provisions its
 *   own adult account. That proves routing, auth, validation, and the response
 *   contract on every capsule endpoint without depending on seed data.
 *
 * A seeded minor such as `teen-1` cannot serve as the default owner: guardian
 * consent gating rejects the location write the ritual scenario needs.
 * -------------------------------------------------------------------------- */

const EXPLICIT_CAPSULE_OWNER = __ENV.CAPSULE_PERF_USER_ID

/**
 * Resolves the capsule owner for one scenario iteration. Returns null when the
 * smoke-mode signup fails, so the caller can report and skip rather than
 * attribute an unrelated auth failure to a capsule endpoint.
 */
function resolveCapsuleOwner(): string | null {
  if (typeof EXPLICIT_CAPSULE_OWNER === 'string' && EXPLICIT_CAPSULE_OWNER.length > 0) {
    return EXPLICIT_CAPSULE_OWNER
  }

  const { status, body } = signUp(uniqueEmail('capsule-owner'), '1990-05-18')
  if (status !== 201 || !body) {
    console.warn(`[capsules] smoke owner signup failed with ${status}`)
    return null
  }

  return body.userId
}

function capsulePath(ownerUserId: string, suffix = '') {
  return apiUrl(`/api/v1/wardrobe/${ownerUserId}/capsules${suffix}`)
}

function capsuleHeaders(ownerUserId: string) {
  return authHeaders(ownerUserId, 'admin')
}

type CapsuleListBody = {
  data: { id: string; revision: number }[]
  total: number
}

export function testCapsuleReadPaths() {
  const owner = resolveCapsuleOwner()
  if (!owner) return

  describe('capsule list, detail, and filtered search', () => {
    const list = getJson<CapsuleListBody>(capsulePath(owner, '?limit=20&offset=0'), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/list' },
    })
    expect(list.status, 'capsule list status').to.equal(200)

    const first = list.body?.data?.[0]
    if (first) {
      const detail = getJson(capsulePath(owner, `/${first.id}`), {
        headers: capsuleHeaders(owner),
        tags: { name: 'capsules/detail' },
      })
      expect(detail.status, 'capsule detail status').to.equal(200)
    }

    // Keyword plus occasion plus favorite is the worst-case read path.
    const search = getJson<CapsuleListBody>(
      capsulePath(owner, '?q=capsule&occasion=work&isFavorite=true&limit=20&offset=0'),
      {
        headers: capsuleHeaders(owner),
        tags: { name: 'capsules/search' },
      }
    )
    expect(search.status, 'capsule search status').to.equal(200)
  })

  sleep(1)
}

/**
 * The write path needs two eligible garments, which a freshly signed-up smoke
 * owner never has. The wardrobe seed gives every teen ten ready, active
 * garments under deterministic ids, so the mutation scenario targets that
 * fixture instead. An explicit `CAPSULE_PERF_USER_ID` still wins.
 */
const SEEDED_WARDROBE_OWNER = 'teen-1'

function resolveWriteOwner(): string {
  return typeof EXPLICIT_CAPSULE_OWNER === 'string' && EXPLICIT_CAPSULE_OWNER.length > 0
    ? EXPLICIT_CAPSULE_OWNER
    : SEEDED_WARDROBE_OWNER
}

export function testCapsuleWritePaths() {
  const owner = resolveWriteOwner()

  describe('capsule create, update, favorite, and delete', () => {
    // Tagged separately: this is the garment lookup, not a capsule endpoint.
    // Tagging it `capsules/list` folded its failures into the capsule list
    // error rate and made a healthy list endpoint read as 50 percent failed.
    //
    // Garment listing signs object-storage URLs, so it returns 503 wherever
    // storage is not provisioned. That is an environment gap rather than a
    // capsule regression, so 503 is an expected status here and must not count
    // toward http_req_failed. The write path reports and returns instead.
    const garments = http.get(apiUrl('/api/v1/wardrobe/garments'), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/garment-lookup' },
      responseCallback: http.expectedStatuses(200, 503),
    })

    const listedGarmentIds =
      garments.status === 200
        ? (
            (JSON.parse(garments.body as string) as { data?: { id: string }[] }).data ??
            []
          )
            .slice(0, 2)
            .map((item) => item.id)
        : []

    // Fall back to the seeded ids when listing is unavailable. The wardrobe seed
    // names them deterministically, so the mutation path stays exercised even
    // where object storage is absent.
    const garmentIds =
      listedGarmentIds.length >= 2
        ? listedGarmentIds
        : owner === SEEDED_WARDROBE_OWNER
          ? [`${owner}-garment-1`, `${owner}-garment-2`]
          : []

    if (garmentIds.length < 2) {
      console.warn(
        `[capsules] skipping write path: garment lookup returned ${garments.status} ` +
          `with ${listedGarmentIds.length} eligible garments for "${owner}", and no ` +
          'seeded fallback applies. Seed at least two ready, active garments.'
      )
      return
    }

    const created = postJson<{ data: { id: string; revision: number } }>(
      capsulePath(owner),
      {
        name: `k6 capsule ${Date.now()}`,
        occasions: ['work'],
        garmentIds,
        isFavorite: false,
      },
      { headers: capsuleHeaders(owner), tags: { name: 'capsules/create' } }
    )
    expect(created.status, 'capsule create status').to.equal(201)

    const capsule = created.body?.data
    if (!capsule) {
      fail('capsule create returned no representation')
    }

    /** The strong validator the API issues; mutations require it back. */
    let etag = `"capsule:${capsule.id}:${capsule.revision}"`

    const updated = patchJson<{ data: { revision: number } }>(
      capsulePath(owner, `/${capsule.id}`),
      { name: `k6 capsule renamed ${Date.now()}` },
      {
        headers: { ...capsuleHeaders(owner), 'If-Match': etag },
        tags: { name: 'capsules/update' },
      }
    )
    expect(updated.status, 'capsule update status').to.equal(200)
    etag = `"capsule:${capsule.id}:${updated.body?.data?.revision ?? capsule.revision + 1}"`

    const favorited = patchJson<{ data: { revision: number } }>(
      capsulePath(owner, `/${capsule.id}/favorite`),
      { isFavorite: true },
      {
        headers: { ...capsuleHeaders(owner), 'If-Match': etag },
        tags: { name: 'capsules/favorite' },
      }
    )
    expect(favorited.status, 'capsule favorite status').to.equal(200)
    etag = `"capsule:${capsule.id}:${favorited.body?.data?.revision ?? 0}"`

    const deleted = deleteRequest(capsulePath(owner, `/${capsule.id}`), {
      headers: { ...capsuleHeaders(owner), 'If-Match': etag },
      tags: { name: 'capsules/delete' },
    })
    expect(deleted.status, 'capsule delete status').to.equal(204)
  })

  sleep(1)
}

/* --------------------------------------------------------------------------
 * Story 5.1: the affiliate-eligible ritual read.
 *
 * WHAT THIS MEASURES AND WHY IT IS THE WARM REQUEST. The eligibility chain runs
 * in `RitualController` on EVERY request, cached payload or not, so it is pure
 * marginal cost added to the hottest route in the app (mobile fetches the ritual
 * on every foreground). On a cold request that cost is buried under outfit
 * generation; on a warm one it is the dominant term. Measuring the warm read is
 * therefore the only way this threshold can detect a commerce regression rather
 * than a generator regression, and cold generation already has its own SLO.
 *
 * WHAT MAKES A USER ELIGIBLE HERE. Decision 14's seeded catalog: `sample-partner`
 * publishes wildcard offers at `locale_region: '*'` with `comfort_range` null,
 * which is exactly what a fresh account's `default-{category}` placeholder slots
 * match. So a freshly signed-up user is eligible with no fixture of its own,
 * provided the seed has run and `commerce_affiliate_enabled` is on.
 * -------------------------------------------------------------------------- */

type EligibleRitualBody = {
  data: {
    outfits: {
      id: string
      shopThisLook: { partnerId: string; offerId: string } | null
    }[]
  }
}

export function testRitualCommerceEligible() {
  const { status: signupStatus, body: user } = signUp(
    uniqueEmail('affiliate-user'),
    '1990-05-18'
  )
  if (signupStatus !== 201 || !user) {
    fail(`affiliate-user signup failed: ${signupStatus}`)
  }

  const locationRes = postJson<{ data: { id: string } }>(
    apiUrl('/api/v1/locations'),
    {
      label: 'Home',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    },
    {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/ritual-eligible-setup' },
    }
  )
  if (locationRes.status !== 201) {
    fail(`affiliate location setup failed: ${locationRes.status}`)
  }

  // Cold generation, tagged away from the measured request so its cost cannot
  // enter the commerce threshold. It still counts toward the run aggregate.
  const warmup = getJson<EligibleRitualBody>(apiUrl('/api/v1/ritual'), {
    headers: authHeaders(user.userId, 'admin'),
    tags: { name: 'api/ritual-eligible-warmup' },
  })
  if (warmup.status !== 200) {
    fail(`affiliate warmup ritual failed: ${warmup.status}`)
  }

  describe('GET /api/v1/ritual (affiliate eligible, warm)', () => {
    const { status, body } = getJson<EligibleRitualBody>(apiUrl('/api/v1/ritual'), {
      headers: authHeaders(user.userId, 'admin'),
      tags: { name: 'api/ritual-eligible' },
    })
    expect(status, 'status is 200').to.equal(200)

    const outfits = body?.data?.outfits ?? []
    expect(outfits.length, '3 scenario outfits').to.equal(3)

    /*
     * The check that keeps this threshold honest.
     *
     * If nothing is eligible the request skips offer selection entirely and the
     * P95 below measures a ritual read this story never touched, so the SLO
     * would pass while proving nothing. Asserting eligibility makes that
     * situation a reported failure instead of a silent one.
     */
    const eligible = outfits.filter((outfit) => outfit.shopThisLook !== null)
    if (eligible.length === 0) {
      console.warn(
        '[commerce] No outfit carried shopThisLook, so this iteration did NOT measure ' +
          'the eligible path. Run `npm run db:seed` against the target database: the ' +
          'chain needs the decision-14 sample-partner catalog and ' +
          'commerce_affiliate_enabled resolving true.'
      )
    }
    expect(eligible.length, 'at least one outfit is affiliate eligible').to.be.at.least(1)

    // Asserted unconditionally. Wrapping these in `if (block)` meant a response
    // that stopped carrying the block skipped the assertions instead of failing
    // them, which is the conditional-flow trap that makes a suite look green
    // while it quietly stops checking anything.
    const block = eligible[0]?.shopThisLook
    expect((block?.partnerId ?? '').length, 'block names a partner').to.be.at.least(1)
    expect((block?.offerId ?? '').length, 'block names an offer').to.be.at.least(1)
  })

  sleep(0.2)
}

export function testCapsuleColdRitual() {
  const owner = resolveCapsuleOwner()
  if (!owner) return

  // The ritual needs a resolvable location for the owner, and the wardrobe seed
  // creates garments but no SavedLocation. Provision one the same way
  // testRitualOutfits does; a repeat run against a fixture owner may conflict.
  const location = postJson<{ data: { id: string } }>(
    apiUrl('/api/v1/locations'),
    {
      label: 'Home',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    },
    { headers: capsuleHeaders(owner), tags: { name: 'capsules/location-setup' } }
  )

  if (location.status !== 201 && location.status !== 409) {
    console.warn(
      `[capsules] skipping cold ritual: location setup for "${owner}" ` +
        `returned ${location.status}.`
    )
    return
  }

  describe('cold ritual generation with capsule evaluation', () => {
    /**
     * A distinct occasion per iteration defeats the cache deliberately, so this
     * measures generation rather than a Redis hit.
     */
    const occasions = ['work', 'casual', 'formal', 'sport', 'travel', 'evening']
    const occasion = occasions[Math.floor(Math.random() * occasions.length)]

    const ritual = getJson(apiUrl(`/api/v1/ritual?occasion=${occasion}`), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/ritual-cold' },
    })
    expect(ritual.status, 'cold ritual status').to.equal(200)
  })

  sleep(1)
}
