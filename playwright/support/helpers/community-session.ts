// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
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

/** Bucket the community upload session writes to, per the storage adapter. */
const COMMUNITY_IMAGES_BUCKET = 'community-images'

const COMMUNITY_FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../apps/api/test/fixtures/community-moderation/v1'
)

type CommunityFixtureEntry = {
  path: string
  sha256: string
  byteSize: number
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  widthPx: number
  heightPx: number
  pattern: string
  neutralBand: 'high' | 'moderate' | 'low'
}

export type CommunityFixtureImage = CommunityFixtureEntry & { bytes: Buffer }

/**
 * The manifest is read rather than the directory listed, because the manifest is
 * what pins the hashes; a file present on disk but absent from it is exactly the
 * unverified content `scripts/community-moderation-fixtures.mjs --verify-only`
 * exists to reject.
 */
export function readCommunityFixtureManifest(): {
  corpusId: string
  files: CommunityFixtureEntry[]
} {
  const manifestPath = path.join(COMMUNITY_FIXTURE_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Community fixture manifest missing at ${manifestPath}. Run \`npm run fixtures:community-screening\`.`
    )
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    corpusId: string
    files: CommunityFixtureEntry[]
  }
}

/**
 * Loads one fixture and re-checks its SHA-256 before handing the bytes over.
 * A journey that uploads drifted bytes would fail deep inside the moderation
 * worker as `IMAGE_CHECKSUM_MISMATCH`, which reads like a pipeline defect rather
 * than a stale fixture.
 */
export function loadCommunityFixture(fileName: string): CommunityFixtureImage {
  const entry = readCommunityFixtureManifest().files.find(
    (file) => file.path === fileName
  )
  if (!entry) {
    throw new Error(`No community fixture named ${fileName} in the v1 manifest.`)
  }

  const bytes = fs.readFileSync(path.join(COMMUNITY_FIXTURE_DIR, entry.path))
  const actual = createHash('sha256').update(bytes).digest('hex')
  expect(
    actual,
    `${entry.path} does not match its manifest hash. Regenerate the corpus rather than editing bytes by hand.`
  ).toBe(entry.sha256)

  return { ...entry, bytes }
}

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

/** Statuses no moderation run will move a post away from. */
export const COMMUNITY_TERMINAL_STATUSES = [
  'published',
  'flagged',
  'review_failed',
  'withdrawn',
  'consent_suspended',
] as const

export type CommunityTerminalStatus = (typeof COMMUNITY_TERMINAL_STATUSES)[number]

export type PublishedCommunityLook = {
  postId: string
  uploadSessionId: string
  objectPath: string
}

/**
 * Drives allocate, the direct byte upload and publish over real HTTP, the way
 * the web client does at `apps/web/src/lib/community.ts`.
 *
 * The bytes go straight to the Supabase signed URL rather than through the API:
 * that PUT is the only step in the whole journey the API never sees, so a test
 * that fakes it proves nothing about the upload contract. `Idempotency-Key` is
 * reused across allocate and publish exactly as the web client reuses it.
 */
export async function publishCommunityLook(
  request: APIRequestContext,
  options: {
    apiBaseUrl: string
    userId: string
    fixture: CommunityFixtureImage
    altText: string
    caption?: string
    locale?: string
  }
): Promise<PublishedCommunityLook> {
  const { apiBaseUrl, userId, fixture, altText } = options
  const locale = options.locale ?? 'en-US'
  const headers = { ...authHeaders(userId, 'guardian'), 'x-couture-platform': 'web' }
  const idempotencyKey = randomUUID()

  const allocateResponse = await request.post(`${apiBaseUrl}${COMMUNITY_ALLOCATE_PATH}`, {
    headers: { ...headers, 'Idempotency-Key': idempotencyKey },
    data: {
      locale,
      contentType: fixture.contentType,
      byteSize: fixture.byteSize,
      sha256: fixture.sha256,
      widthPx: fixture.widthPx,
      heightPx: fixture.heightPx,
    },
  })
  expect(
    allocateResponse.status(),
    `Allocate failed: ${allocateResponse.status()} ${await allocateResponse.text()}`
  ).toBe(200)
  const allocated = (await allocateResponse.json()) as {
    data: {
      postId: string
      uploadSessionId: string
      uploadUrl: string
      uploadToken: string
      requiredHeaders: Record<string, string>
    }
  }
  const session = allocated.data

  // Sent back by allocate rather than assumed from the fixture: the bucket
  // enforces its own MIME allowlist, so a PUT whose content type disagrees with
  // the signed session is rejected by storage with no API error to read.
  const uploadContentType = session.requiredHeaders['content-type']
  expect(uploadContentType, 'allocate returned no required content-type header').toBe(
    fixture.contentType
  )

  const uploadResponse = await request.put(session.uploadUrl, {
    headers: {
      'X-Upload-Token': session.uploadToken,
      'Content-Type': fixture.contentType,
    },
    data: fixture.bytes,
  })
  expect(
    uploadResponse.ok(),
    `Upload to the signed URL failed: ${uploadResponse.status()} ${await uploadResponse.text()}`
  ).toBe(true)

  const publishResponse = await request.post(`${apiBaseUrl}${COMMUNITY_PUBLISH_PATH}`, {
    headers: { ...headers, 'Idempotency-Key': idempotencyKey },
    data: {
      postId: session.postId,
      uploadSessionId: session.uploadSessionId,
      altText,
      altTextConfirmed: true,
      caption: options.caption ?? null,
      locale,
    },
  })
  expect(
    publishResponse.status(),
    `Publish failed: ${publishResponse.status()} ${await publishResponse.text()}`
  ).toBe(200)

  const extension =
    fixture.contentType === 'image/jpeg' ? 'jpg' : fixture.contentType.slice(6)
  return {
    postId: session.postId,
    uploadSessionId: session.uploadSessionId,
    objectPath: `community/${session.postId}/${session.uploadSessionId}.${extension}`,
  }
}

export type CommunityAuthorState = {
  status: string
  moderationReason: string | null
  engineVersion: string | null
}

/**
 * Polls the author's own view until moderation reaches a terminal status.
 *
 * Two surfaces are read because neither is sufficient alone. `GET /posts/:postId`
 * is the one an author can poll for any status, but it carries no
 * `moderationReason`; the feed's `authorStates` carries the reason but drops a
 * post the moment it publishes. So status comes from the post endpoint and the
 * reason is fetched from the feed only for the non-published terminal states,
 * which are the ones that actually have a reason to report.
 *
 * `moderation_engine_version` is read straight from the row: it is the field
 * that says whether a fixture or a real model produced the verdict, and no
 * public endpoint exposes it.
 */
export async function waitForTerminalAuthorState(
  request: APIRequestContext,
  options: {
    apiBaseUrl: string
    userId: string
    postId: string
    timeoutMs?: number
  }
): Promise<CommunityAuthorState> {
  const { apiBaseUrl, userId, postId } = options
  const headers = { ...authHeaders(userId, 'guardian'), 'x-couture-platform': 'web' }
  const deadline = Date.now() + (options.timeoutMs ?? 90_000)
  let lastStatus = 'unknown'

  while (Date.now() < deadline) {
    const response = await request.get(`${apiBaseUrl}/api/v1/community/posts/${postId}`, {
      headers,
    })
    if (response.status() === 200) {
      const body = (await response.json()) as { data: { status: string } }
      lastStatus = body.data.status
      if ((COMMUNITY_TERMINAL_STATUSES as readonly string[]).includes(lastStatus)) {
        return {
          status: lastStatus,
          moderationReason:
            lastStatus === 'published'
              ? null
              : await readAuthorStateReason(request, apiBaseUrl, userId, postId),
          engineVersion: await readModerationEngineVersion(postId),
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Post ${postId} never reached a terminal status; last observed "${lastStatus}". ` +
      'A post stuck at pending_review usually means no community worker is consuming ' +
      'the moderation queue, which the E2E launcher starts and waits on.'
  )
}

async function readAuthorStateReason(
  request: APIRequestContext,
  apiBaseUrl: string,
  userId: string,
  postId: string
): Promise<string | null> {
  const response = await request.get(`${apiBaseUrl}${COMMUNITY_FEED_PATH}`, {
    headers: { ...authHeaders(userId, 'guardian'), 'x-couture-platform': 'web' },
  })
  if (response.status() !== 200) return null
  const body = (await response.json()) as {
    data: { authorStates: { id: string; moderationReason: string | null }[] }
  }
  return (
    body.data.authorStates.find((state) => state.id === postId)?.moderationReason ?? null
  )
}

async function readModerationEngineVersion(postId: string): Promise<string | null> {
  const prisma = new PrismaClient({ datasources: { db: { url: cleanupDatabaseUrl } } })
  try {
    const post = await prisma.lookbookPost.findUnique({
      where: { id: postId },
      select: { moderation_engine_version: true },
    })
    return post?.moderation_engine_version ?? null
  } finally {
    await prisma.$disconnect()
  }
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
 * Removes the uploaded objects before the rows that point at them.
 *
 * Story 6.2 AC 9 requires teardown to delete uploaded storage objects as well as
 * database rows, and the order matters: `image_object_path` on the row is the
 * only record of where the object lives, so deleting rows first strands every
 * object in the bucket with nothing left to identify it. There is no sweep that
 * would collect them, because `objects_purged_at` is driven by the erasure path
 * rather than by test cleanup.
 *
 * Credentials come from the same `.env.local` the local stack already loads. If
 * an object needs deleting and they are absent, this throws rather than warning:
 * a cleanup step that swallows its own failure is how the row leak this file
 * already documents went unnoticed the first time.
 */
async function deleteCommunityStorageObjects(objectPaths: string[]): Promise<void> {
  if (objectPaths.length === 0) return

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      `Cannot delete ${objectPaths.length} uploaded community object(s): SUPABASE_URL and ` +
        'SUPABASE_SERVICE_ROLE_KEY are unset. Start the local stack with `npm run supabase:start` ' +
        'so the bytes this run uploaded do not outlive it.'
    )
  }

  const storage = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  }).storage.from(COMMUNITY_IMAGES_BUCKET)

  const { error } = await storage.remove(objectPaths)
  if (error) {
    throw new Error(
      `Failed to delete uploaded community objects ${objectPaths.join(', ')}: ${error.message}`
    )
  }
}

/**
 * Prisma rather than the public API, because there is no public way to remove a
 * draft: `POST /posts/allocate` creates one and `withdrawPost` rejects anything
 * outside `WITHDRAWABLE_STATUSES`. A spec that allocates without publishing leaks
 * a row per call, forever; orphaned drafts are what made `commerce-seed.spec.ts`
 * go red. A spec that genuinely tested the abandoned-upload sweep should leave its
 * row for the sweep instead; none of these do.
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
    const uploaded = await prisma.lookbookPost.findMany({
      where: { user_id: userId, image_object_path: { not: null } },
      select: { image_object_path: true },
    })

    /*
     * The storage failure is held rather than thrown here. AC 9 wants objects AND
     * rows gone after pass or failure, so letting a storage error skip the row
     * deletion below would turn one leak into two. The error is rethrown once the
     * rows are gone, so the run still fails loudly.
     */
    let storageError: Error | null = null
    try {
      await deleteCommunityStorageObjects(
        uploaded
          .map((post) => post.image_object_path)
          .filter((objectPath): objectPath is string => objectPath !== null)
      )
    } catch (error) {
      storageError = error instanceof Error ? error : new Error(String(error))
    }

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

    /*
     * Moderation events before posts, for the same `onDelete: SetNull` reason
     * the reports carry, and with a sharper consequence. `content_snapshot`
     * holds the caption and the confirmed alt text verbatim, so a row orphaned
     * by deleting its post keeps a copy of the submission with nothing left to
     * identify whose run left it. Nothing collects those afterwards: the erasure
     * sweep deliberately retains moderation events, because the fact of a
     * decision is meant to outlive the person.
     */
    const postIds = (
      await prisma.lookbookPost.findMany({
        where: { user_id: userId },
        select: { id: true },
      })
    ).map((post) => post.id)
    if (postIds.length > 0) {
      await prisma.moderationEvent.deleteMany({ where: { post_id: { in: postIds } } })
    }
    // Every community post this account could own, drafts and published alike, so a
    // test that later publishes needs no second cleanup path bolted on.
    await prisma.lookbookPost.deleteMany({ where: { user_id: userId } })

    if (storageError) throw storageError
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
     * Every account is cleaned before any failure is raised. Failures still
     * throw, because a cleanup step that swallows its own failure is how the
     * leak this exists to close came back unnoticed the first time; but a bare
     * `for await` that rethrows immediately skips every account after the first
     * one, which turns one leak into several. The cross-user tests track a
     * second account holding an allocated draft, so that account is exactly the
     * one a rethrow would strand.
     */
    const cleanupFailures: Error[] = []
    for (const trackedUserId of trackedUserIds) {
      try {
        await deleteCommunityRowsForUser(trackedUserId)
      } catch (error) {
        cleanupFailures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        `Community cleanup failed for ${cleanupFailures.length} of ${trackedUserIds.size} account(s): ${cleanupFailures
          .map((failure) => failure.message)
          .join(' | ')}`
      )
    }
  },
})

export { expect }
