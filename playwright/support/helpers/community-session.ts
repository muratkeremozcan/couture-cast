// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
// Story 6.1 Task 6: browser and API sessions for the community feed journeys.
//
// WHY THIS EXISTS AT ALL, rather than the specs leaning on the default fixture.
// `apps/web/src/lib/community.ts` reads `sessionStorage[couturecast.access-token]`
// as its SOLE credential, and `merged-fixtures.ts`'s auth-session fixture does not
// write that key. A spec that only relies on the default fixture therefore renders
// the signed-out community panel — "Sign in to take part in the community." — and
// every card, chip effect and control it wanted to assert is simply absent. That is
// not a hypothetical: it is what `lookbook-prism.spec.ts` and
// `accessibility-hardening.spec.ts` were doing when they went red, and the failure
// looks identical to a broken render. The context-level init script below is the
// same one `commerce-session.ts` and `premium-session.ts` use, and it is the thing
// that makes the community grid render at all.
//
// SEEDED DATA IS THE FIXTURE. The community feed is a PUBLIC read, so a
// brand-new account sees the seeded posts immediately; there is no per-user
// arrangement to do for a read. `packages/db/prisma/seeds/rituals.ts` upserts five
// already-published `LookbookPost` rows and this module re-states their ids, bands
// and captions with `assertSeededFeed` to prove the assumption rather than trust it.
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
 *
 * Restating a fixture is a liability unless something checks it, which is what
 * `assertSeededFeed` below is for: it fails naming `npm run db:seed` rather than
 * letting a spec fail later on a missing card with no explanation.
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
 *
 * `guardian` rather than `teen`: a teen account is gated behind active guardian
 * consent by `RequestAuthGuard`, so every community call would be refused before
 * any community code ran. The teen consent gate is a separate journey with its
 * own arrangement, not something to trip over here.
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
 * Proves the seed actually ran before a spec asserts on a card that would
 * otherwise merely be missing.
 *
 * An unseeded database answers 200 with an empty feed, which renders the empty
 * state — indistinguishable at a glance from a feed that failed to load, and from
 * a filter that returned nothing legitimately. Failing here names the cause.
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
 * REFERENCE IT. Playwright fixtures are lazy: a test that omits it does not get
 * a session, and this is the one fixture where that failure does not look like a
 * failure. A signed-out community surface does not error — it renders the "Sign
 * in to take part in the community." panel, with no grid, no chips and no
 * create-post control in it — so the test fails on a missing locator and reads
 * exactly like a broken component. Two Story 6.1 specs were written that way and
 * cost a debugging round each before the cause was obvious.
 *
 * The habit that makes it visible: destructure it and assert on it, e.g.
 * `expect(communitySession.userId).toBeTruthy()` as the first line. That is a
 * trivial assertion whose real job is to make the fixture run and to say out loud
 * that this test needs a session, so the next reader does not delete it as noise.
 *
 * THE TWO FIXTURES IN THIS FILE DIFFER IN A WAY THAT DECIDES HOW AN
 * ARM-SENSITIVE ASSERTION FAILS, and the difference is invisible unless you look
 * for it. `communityTest` creates ONE account per test and that account is stable
 * within the test. `communityApiTest` also creates a fresh account per test — so
 * across RUNS its account changes every time.
 *
 * That matters because the community beta assignment is stable per VIEWER,
 * derived from the user id, and it selects the effective feed mode:
 * `resolveEffectiveMode` is `requestedMode === 'auto' ? variant : requestedMode`.
 * An assertion that requests `auto` and expects `auto` back is therefore decided
 * by which arm the account's id hashes into. With a fixed account that is a
 * STABLE pass or failure; with a fresh account per run it is a COIN FLIP, and an
 * intermittent failure is the thing someone eventually reruns until it goes
 * green. `6.1-API-04` was exactly that before it was rewritten to derive the
 * served mode instead of assuming it.
 *
 * So when auditing for arm sensitivity, "is the fixture stable?" has a different
 * answer for each half of this file. An explicit band literal and an explicit
 * `all` both win over the assignment, so only `auto` requests are exposed at all.
 *
 * Context-level rather than page-level, exactly like `commerceTest`: a reload or
 * a second page stays authenticated, and `setExtraHTTPHeaders` covers the
 * Next.js rewrite path where the server proxies through to the API.
 *
 * The account is disposable, but disposable is not the same as clean: a report
 * row points at a SEEDED post and outlives the account that made it, so the
 * teardown below removes what this session created. See
 * `deleteCommunityRowsForUser` for why that reaches for Prisma.
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

    /*
     * The browser fixture needs the same teardown as the API one. Reading the
     * seeded feed leaves nothing behind, but the report journey does: it reports
     * a SEEDED post, and that row has no public undo and outlives the throwaway
     * account that made it.
     */
    await deleteCommunityRowsForUser(userId)
  },
})

/**
 * The database these specs' throwaway accounts write to.
 *
 * Same resolution chain `apps/api/vitest.config.ts` uses, and the same local
 * Supabase default: CI sets `DATABASE_URL` to the ephemeral service container
 * (`.github/workflows/pr-pw-e2e-local.yml`'s `LOCAL_DATABASE_URL`), and a local
 * run falls back to the port the repo standardises on. Nothing here reads
 * `packages/db/.env`, which is the trap `apps/api/vitest.config.ts` documents at
 * length: importing Prisma dotenv-loads that file as a side effect and would
 * silently repoint cleanup at a different database.
 */
const cleanupDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * WHY THIS FILE REACHES FOR PRISMA AT ALL, when every other arrangement in these
 * helpers goes through the public API.
 *
 * `POST /posts/allocate` creates a `draft` LookbookPost row, and there is no
 * public way to remove one: `withdrawPost` rejects anything outside
 * `WITHDRAWABLE_STATUSES`, deliberately, because withdrawal used to accept a
 * draft that had never been submitted. So a spec that allocates without
 * publishing leaks a row per call, every run, forever. That is not hypothetical
 * — orphaned drafts in a shared database are what made `commerce-seed.spec.ts`
 * go red, and the ones traced back carried this file's own `byteSize` literal.
 *
 * INTENT MATTERS HERE, and these specs' intent is explicit: the allocation rows
 * they create are incidental to what they assert (idempotent replay, mismatched
 * replay, cross-user invisibility). None of them is testing the abandoned-upload
 * expiry sweep. A flow that DID test the sweep should leave its row behind and
 * let the sweep collect it; that would be the feature working. These are simply
 * litter, so they are removed.
 *
 * SCOPED TO THE FIXTURE'S OWN THROWAWAY ACCOUNT rather than routed through
 * `registerForCleanup`/`cleanup()` from `@couture/testing`, and that is a
 * deliberate divergence from the integration tier worth stating. Two reasons.
 * The registry needs every call site to remember to register, which is the exact
 * class of omission that produced this leak; doing it in the fixture, keyed on
 * the user it created, is forget-proof by construction — a test cannot fail to
 * register something it never had to. And `cleanup()` additionally issues an
 * unscoped `deleteMany` against `AlertCooldownReservation`, bounded only by when
 * `configureCleanup` last ran, which a community spec has no business doing to a
 * shared database.
 */
async function deleteCommunityRowsForUser(userId: string): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: cleanupDatabaseUrl } },
  })
  try {
    /*
     * Reports first, posts second. A report carries `onDelete: SetNull` on both
     * relations, so deleting the post would orphan the report rather than remove
     * it, and the row would survive with a null `post_id` — a leak that is worse
     * than the draft one because nothing identifies whose run left it.
     *
     * Reports are the other row these specs create with no public undo: the
     * report journeys assert against SEEDED posts (a fresh account has nothing
     * of its own to report), so the row they leave behind belongs to a post that
     * outlives the run. The `@@unique([post_id, reporter_id])` constraint means
     * a surviving row would also silently change what a later run's first report
     * against that post does.
     */
    await prisma.communityPostReport.deleteMany({ where: { reporter_id: userId } })
    // Every community post this account could own, not only the drafts: a test
    // that later publishes should not need a second cleanup path bolted on.
    await prisma.lookbookPost.deleteMany({ where: { user_id: userId } })
  } finally {
    await prisma.$disconnect()
  }
}

export type CommunityApiContext = {
  /** A fresh, disposable account created for this one test. */
  userId: string
  apiBaseUrl: string
  /** Ready to spread onto authenticated community requests. */
  headers: Record<string, string>
  /**
   * Hands a SECOND account to the teardown, for a test that needs more than one
   * actor.
   *
   * The cross-user test is the case: proving that one member cannot see another
   * member's draft needs a second real account, and the draft it allocates
   * belongs to that account rather than to `userId`. A teardown scoped only to
   * `userId` therefore leaked exactly one row per run, which is how six orphan
   * drafts accumulated in the shared local database before this existed. Every
   * one of them carried this file's `byteSize` literal and a different owner.
   */
  trackUser: (userId: string) => void
}

/**
 * One throwaway account per API test, mirroring `commerceApiTest`.
 *
 * A fresh account per test is load-bearing here rather than tidy: the rate limit
 * is per user over a rolling 24 hours, and the report record is unique per
 * (reporter, post) with no public delete. Two tests sharing an account would
 * make the eleventh-submission row and the duplicate-report row depend on
 * execution order.
 *
 * `x-couture-platform` is spread onto `headers` because every community
 * operation requires it; a request without it is a 400 that has nothing to do
 * with the behaviour under test.
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

    // Every account this test creates, the fixture's own included. A test that
    // makes a second actor registers it here and the teardown treats both alike.
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
     * Deliberately allowed to throw. A cleanup step that swallows its own
     * failure is how the leak this exists to close came back unnoticed the first
     * time; a loud teardown failure names the problem while someone is still
     * looking at it.
     */
    for (const trackedUserId of trackedUserIds) {
      await deleteCommunityRowsForUser(trackedUserId)
    }
  },
})

export { expect }
