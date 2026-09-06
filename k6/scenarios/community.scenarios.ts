// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { sleep } from 'k6'
import { apiUrl, authHeaders } from '../helpers/config'
import { getJson } from '../helpers/http'

/* --------------------------------------------------------------------------
 * Story 6.1: the community feed read.
 *
 * WHAT THIS MEASURES. `GET /api/v1/community/feed` in its two shapes, tagged
 * separately so a regression names which one moved:
 *
 *   api/community-feed-all   mode=all, the unfiltered keyset page
 *   api/community-feed-band  mode=temperate_dry, the band-filtered keyset page
 *
 * They are separate scenarios rather than one because they hit DIFFERENT
 * composite indexes -- `LookbookPost_status_published_at_id_idx` for the global
 * page and `LookbookPost_climate_band_status_published_at_id_idx` for the
 * filtered one -- and folding them into one tag would let a regression in
 * either hide inside the other's samples.
 * `apps/api/integration/community-feed-query-plan.integration.spec.ts` asserts
 * that both plans are index scans against a synthetic 2,000-row table; these
 * scenarios are what says the latency that produces is acceptable under load.
 *
 * READ ONLY, DELIBERATELY. `POST /posts/allocate` and `POST /posts/publish` are
 * absent for the same class of reason `POST /subscription/refresh` is absent
 * from `premium.scenarios.ts`: publishing enqueues an ADR-013 moderation job
 * per call, so a load run against it would be a load test of the screening
 * pipeline and its third-party engines rather than of this API, and the rolling
 * 24-hour cap of ten submissions means every virtual user past the tenth would
 * be measuring the 429 path anyway. Reporting is out for the same reason: it
 * writes a moderation record with an SLA clock attached. Keep writes out of
 * this file.
 *
 * SEED DEPENDENCY. Both scenarios read the seeded lookbook posts from
 * `packages/db/prisma/seeds/rituals.ts`, which upserts five published rows with
 * `climate_band` alternating `temperate_dry` / `cold_dry` -- so `mode=all`
 * should return five and `mode=temperate_dry` three. They authenticate as
 * `premium-active-user` from `packages/db/prisma/seeds/commerce.ts`, a stable
 * seeded id, exactly like `premium.scenarios.ts`. The `community_read_enabled`
 * flag defaults to false in the registry and is seeded true by
 * `packages/db/prisma/seeds/feature-flags.ts`; without the seed the route
 * answers 503 rather than a feed.
 * -------------------------------------------------------------------------- */

const FEED_PATH = '/api/v1/community/feed'

/** Seeded in `packages/db/prisma/seeds/commerce.ts`. */
const FEED_READER_USER_ID = 'premium-active-user'

/**
 * The band half the seeded posts carry. `packages/db/prisma/seeds/rituals.ts`
 * stamps `idx % 2 === 0 ? 'temperate_dry' : 'cold_dry'` across five rows, so
 * this band is the one guaranteed to be non-empty.
 */
const SEEDED_BAND = 'temperate_dry'

type CommunityFeedBody = {
  data: {
    items: {
      id: string
      status: string
      publishedAt: string | null
      climateBand: string | null
      imageAccess: { url: string; expiresAt: string }
    }[]
    authorStates: unknown[]
    nextCursor: string | null
    mode: string
    viewerBand: string | null
    bandResolved: boolean
    experimentVariant: string
  }
}

function feedHeaders() {
  return {
    ...authHeaders(FEED_READER_USER_ID, 'guardian'),
    // Required on every community operation, and server-trusted for analytics.
    'x-couture-platform': 'web',
  }
}

/**
 * The check that keeps these thresholds honest.
 *
 * An empty feed is a cheaper query than a full one: Postgres stops at the first
 * page boundary either way, but no rows means no signed-URL minting, which is
 * the marginal per-item cost this read actually carries. If the seed has not
 * run, the endpoint answers 200 with `items: []` and the P95 below would be
 * measuring a code path no real viewer ever takes. Failing the check turns that
 * into a reported failure instead of a silently optimistic number.
 *
 * `imageAccess.url` is the field asserted rather than `imageUrl`: the contract
 * dropped the duplicate signed URL, and `imageAccess` is now its only home. An
 * assertion on the removed field would pass vacuously against `undefined`.
 */
function assertFeedMeasuredRealWork(
  body: CommunityFeedBody | null | undefined,
  label: string
) {
  const items = body?.data?.items ?? []

  if (items.length === 0) {
    console.warn(
      `[community] the ${label} feed came back EMPTY, so this iteration did NOT ` +
        'measure the populated read path. Run `npm run db:seed` against the target ' +
        'database: these scenarios need the seeded lookbook posts from ' +
        'packages/db/prisma/seeds/rituals.ts and community_read_enabled resolving true.'
    )
  }

  expect(items.length, `${label} feed returned seeded posts`).to.be.at.least(1)

  const first = items[0]
  expect(first?.status, `${label} feed serves published rows`).to.equal('published')
  expect(
    (first?.publishedAt ?? '').length,
    `${label} feed rows carry the publication clock the cursor keysets on`
  ).to.be.at.least(1)
  expect(
    (first?.imageAccess?.url ?? '').length,
    `${label} feed minted a signed image URL`
  ).to.be.at.least(1)
}

/** The unfiltered page: every region, ordered by `published_at,id`. */
export function testCommunityFeedAll() {
  describe('GET /api/v1/community/feed (mode=all)', () => {
    const { status, body } = getJson<CommunityFeedBody>(
      apiUrl(`${FEED_PATH}?mode=all&limit=12`),
      {
        headers: feedHeaders(),
        tags: { name: 'api/community-feed-all' },
      }
    )

    expect(status, 'status is 200').to.equal(200)
    expect(body?.data?.mode, 'server echoes the requested mode').to.equal('all')
    assertFeedMeasuredRealWork(body, 'all-region')
  })

  sleep(0.2)
}

/** The band-filtered page, which is a different index than the one above. */
export function testCommunityFeedByBand() {
  describe('GET /api/v1/community/feed (band-filtered)', () => {
    const { status, body } = getJson<CommunityFeedBody>(
      apiUrl(`${FEED_PATH}?mode=${SEEDED_BAND}&limit=12`),
      {
        headers: feedHeaders(),
        tags: { name: 'api/community-feed-band' },
      }
    )

    expect(status, 'status is 200').to.equal(200)
    expect(body?.data?.mode, 'server echoes the requested mode').to.equal(SEEDED_BAND)
    assertFeedMeasuredRealWork(body, 'band-filtered')

    // Every row on a pinned-band page is in that band. A filter that silently
    // fell back to the global feed would still be fast, still return items, and
    // still pass every assertion above -- so the measurement has to prove it
    // filtered, not merely that it answered.
    const offBand = (body?.data?.items ?? []).filter(
      (item) => item.climateBand !== SEEDED_BAND
    )
    expect(offBand.length, 'band-filtered page contains only that band').to.equal(0)
  })

  sleep(0.2)
}
