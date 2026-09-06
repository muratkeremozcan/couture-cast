// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
import { PrismaClient } from '@prisma/client'
import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '../fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  createBirthdate,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from './api-test'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './commerce-session'

export const COMMUNITY_FEED_PATH = '/api/v1/community/feed'
export const COMMUNITY_ALLOCATE_PATH = '/api/v1/community/posts/allocate'
export const COMMUNITY_PUBLISH_PATH = '/api/v1/community/posts/publish'

export const COMMUNITY_FEED_URL = `**${COMMUNITY_FEED_PATH}*`

/**
 * The five posts `packages/db/prisma/seeds/rituals.ts` publishes, restated here
 * because that file computes them inline (`lookbook-${idx + 1}`, caption
 * `Look ${idx + 1} — weather-ready layers`, band
 * `idx % 2 === 0 ? 'temperate_dry' : 'cold_dry'`) and exports nothing.
 * `assertSeededFeed` below checks the restatement so a drifted seed fails naming
 * `npm run db:seed`.
 */
export const SEEDED_COMMUNITY_POSTS = [
  {
    id: 'lookbook-1',
    climateBand: 'temperate_dry',
    caption: 'Look 1 — weather-ready layers',
  },
  { id: 'lookbook-2', climateBand: 'cold_dry', caption: 'Look 2 — weather-ready layers' },
  {
    id: 'lookbook-3',
    climateBand: 'temperate_dry',
    caption: 'Look 3 — weather-ready layers',
  },
  { id: 'lookbook-4', climateBand: 'cold_dry', caption: 'Look 4 — weather-ready layers' },
  {
    id: 'lookbook-5',
    climateBand: 'temperate_dry',
    caption: 'Look 5 — weather-ready layers',
  },
] as const

/** The band that more than one seeded post carries, so a band-filtered page is
 * never a single-row page by accident. */
export const SEEDED_BAND = 'temperate_dry'

export type CommunitySession = {
  userId: string
  accessToken: string
  apiBaseUrl: string
}

/**
 * The local integration bypass, in the same shape `commerceAccessToken` mints.
 * `guardian`, because `RequestAuthGuard` gates a teen account behind active
 * guardian consent and every community call would be refused before any community
 * code ran.
 */
export function communityAccessToken(userId: string): string {
  return `test-token:guardian:${userId}`
}

export async function signUpCommunityUser(
  request: APIRequestContext,
  apiBaseUrl: string,
  uniqueSuffix: string
): Promise<string> {
  const response = await request.post(`${apiBaseUrl}/api/v1/auth/signup`, {
    data: {
      email: `community-e2e-${uniqueSuffix}@example.com`,
      // Adult on purpose, for the reason `communityAccessToken` records.
      birthdate: createBirthdate(30),
    },
  })

  expect(
    response.status(),
    `Signup failed: ${response.status()} ${await response.text()}`
  ).toBe(201)

  const body = (await response.json()) as { userId: string }
  expect(body.userId).toBeTruthy()
  return body.userId
}

type FeedItem = { id: string; climateBand: string | null; caption: string | null }

/**
 * An unseeded database answers 200 with an empty feed, which renders the empty
 * state: indistinguishable at a glance from a feed that failed to load, and from a
 * filter that legitimately matched nothing. Failing here names the cause.
 */
export function assertSeededFeed(items: FeedItem[]): void {
  const ids = items.map((item) => item.id)
  const missing = SEEDED_COMMUNITY_POSTS.filter((post) => !ids.includes(post.id))

  expect(
    missing,
    `The community feed is missing seeded posts ${missing
      .map((post) => post.id)
      .join(', ')}. Run \`npm run db:seed\`: these specs read the published rows ` +
      'that packages/db/prisma/seeds/rituals.ts upserts.'
  ).toEqual([])
}

/**
 * A signed-in browser session on a brand-new account.
 *
 * EVERY TEST MUST DESTRUCTURE `communitySession`, INCLUDING TESTS THAT NEVER
 * REFERENCE IT. Playwright fixtures are lazy: a test that omits it does not get a
 * session, and a signed-out community surface does not error. It renders the "Sign
 * in to take part in the community." panel with no grid, no chips and no
 * create-post control, so the test fails on a missing locator and reads exactly
 * like a broken component. Two Story 6.1 specs were written that way and cost a
 * debugging round each.
 *
 * The habit that makes it visible: destructure it and assert on it, e.g.
 * `expect(communitySession.userId).toBeTruthy()` as the first line. That trivial
 * assertion makes the fixture run and says out loud that this test needs a session,
 * so the next reader does not delete it as noise.
 *
 * THE TWO FIXTURES IN THIS FILE DIFFER IN A WAY THAT DECIDES HOW AN ARM-SENSITIVE
 * ASSERTION FAILS. `communityTest` creates ONE account per test and that account is
 * stable within the test. `communityApiTest` creates a fresh account per test, so
 * across RUNS its account changes every time. The community beta assignment is
 * stable per VIEWER, derived from the user id, and it selects the effective feed
 * mode: `resolveEffectiveMode` is `requestedMode === 'auto' ? variant :
 * requestedMode`. An assertion that requests `auto` and expects `auto` back is
 * decided by which arm the account's id hashes into. A fixed account gives a STABLE
 * pass or failure; a fresh account per run gives a COIN FLIP, and an intermittent
 * failure is the thing someone eventually reruns until it goes green. `6.1-API-04`
 * was exactly that before it was rewritten to derive the served mode. An explicit
 * band literal and an explicit `all` both win over the assignment, so only `auto`
 * requests are exposed at all.
 *
 * Context-level, like `commerceTest`: a reload or a second page stays
 * authenticated, and `setExtraHTTPHeaders` covers the Next.js rewrite path where
 * the server proxies through to the API.
 *
 * The account is disposable and the rows it leaves are not: a report row points at
 * a SEEDED post and outlives the account that made it, so the teardown below
 * removes what this session created. See `deleteCommunityRowsForUser` for why that
 * reaches for Prisma.
 */
export const communityTest = test.extend<{ communitySession: CommunitySession }>({
  communitySession: async ({ context, request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Community journeys need the seeded lookbook posts and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommunityUser(
      request,
      apiBaseUrl,
      buildUniqueId('web', testInfo)
    )
    const accessToken = communityAccessToken(userId)

    await context.addInitScript(
      ([storageKey, token]) => {
        window.sessionStorage.setItem(storageKey as string, token as string)
      },
      [WEB_ACCESS_TOKEN_STORAGE_KEY, accessToken]
    )
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

    await use({ userId, accessToken, apiBaseUrl })

    await deleteCommunityRowsForUser(userId)
  },
})

/**
 * The database these specs' throwaway accounts write to. Same resolution chain
 * `apps/api/vitest.config.ts` uses, and the same local Supabase default: CI sets
 * `DATABASE_URL` to the ephemeral service container
 * (`.github/workflows/pr-pw-e2e-local.yml`'s `LOCAL_DATABASE_URL`), and a local run
 * falls back to the port the repo standardises on. Nothing here reads
 * `packages/db/.env`: importing Prisma dotenv-loads that file as a side effect and
 * would silently repoint cleanup at a different database.
 */
const cleanupDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * Prisma rather than the public API, because there is no public way to remove a
 * draft: `POST /posts/allocate` creates one and `withdrawPost` rejects anything
 * outside `WITHDRAWABLE_STATUSES`. A spec that allocates without publishing leaks
 * a row per call, forever; orphaned drafts are what made `commerce-seed.spec.ts`
 * go red. A spec that genuinely tested the abandoned-upload sweep should leave its
 * row for the sweep instead — none of these do.
 *
 * Scoped to the fixture's own account rather than `registerForCleanup`/`cleanup()`
 * from `@couture/testing`, deliberately: the registry needs every call site to
 * remember, which is the omission that produced this leak, and `cleanup()` also
 * issues an unscoped `deleteMany` against `AlertCooldownReservation` that a
 * community spec has no business doing to a shared database.
 */
async function deleteCommunityRowsForUser(userId: string): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: cleanupDatabaseUrl } },
  })
  try {
    /*
     * Reports first, posts second. A report carries `onDelete: SetNull` on both
     * relations, so deleting the post would leave the report alive with a null
     * `post_id` and nothing identifying whose run left it. The report journeys
     * assert against SEEDED posts (a fresh account has nothing of its own to
     * report), so the row they leave behind belongs to a post that outlives the
     * run, and `@@unique([post_id, reporter_id])` means a survivor silently
     * changes what a later run's first report against that post does.
     */
    await prisma.communityPostReport.deleteMany({ where: { reporter_id: userId } })
    // Every community post this account could own, drafts and published alike, so a
    // test that later publishes needs no second cleanup path bolted on.
    await prisma.lookbookPost.deleteMany({ where: { user_id: userId } })
  } finally {
    await prisma.$disconnect()
  }
}

export type CommunityApiContext = {
  userId: string
  apiBaseUrl: string
  headers: Record<string, string>
  /**
   * Hands a SECOND account to the teardown. The cross-user test needs one: proving
   * that a member cannot see another member's draft allocates that draft under a
   * second real account, so a teardown scoped only to `userId` leaked exactly one
   * row per run. Six orphan drafts accumulated in the shared local database that
   * way, each carrying this file's `byteSize` literal and a different owner.
   */
  trackUser: (userId: string) => void
}

/**
 * One throwaway account per API test, mirroring `commerceApiTest`.
 *
 * The fresh account is load-bearing: the rate limit is per user over a rolling 24
 * hours, and the report record is unique per (reporter, post) with no public
 * delete. Two tests sharing an account would make the eleventh-submission row and
 * the duplicate-report row depend on execution order.
 *
 */
export const communityApiTest = test.extend<{ communityApi: CommunityApiContext }>({
  communityApi: async ({ request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Community API journeys need the seeded lookbook posts and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommunityUser(
      request,
      apiBaseUrl,
      buildUniqueId('api', testInfo)
    )

    const trackedUserIds = new Set<string>([userId])

    await use({
      userId,
      apiBaseUrl,
      headers: { ...authHeaders(userId, 'guardian'), 'x-couture-platform': 'web' },
      trackUser: (extraUserId: string) => {
        trackedUserIds.add(extraUserId)
      },
    })

    /*
     * Deliberately allowed to throw. A cleanup step that swallows its own failure
     * is how the leak this exists to close came back unnoticed the first time.
     */
    for (const trackedUserId of trackedUserIds) {
      await deleteCommunityRowsForUser(trackedUserId)
    }
  },
})

export { expect }
