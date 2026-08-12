import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { fail, sleep } from 'k6'
import { apiUrl, authHeaders, uniqueEmail } from '../helpers/config'
import { signUp } from '../helpers/api'
import { getJson, postJson } from '../helpers/http'

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
