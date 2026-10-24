import { localPlaywrightDatabaseUrl } from './user-test-data'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  type APIRequestContext,
  type Page,
  type WebSocketRoute,
  type TestInfo,
} from '@playwright/test'
import type {
  ApiRequestParams,
  ApiRequestResponse,
} from '@seontechnologies/playwright-utils/api-request'
import {
  interceptNetworkCall,
  type InterceptNetworkCallFn,
} from '@seontechnologies/playwright-utils/intercept-network-call'
import { createNetworkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import {
  communityCommentSubmissionResponseSchema,
  communityCommentSubmissionsResponseSchema,
  communityReactionFeedResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  communityApiTest,
  signUpCommunityUser,
  loadCommunityFixture,
  publishCommunityLook,
  waitForTerminalAuthorState,
  type CommunitySession,
  COMMUNITY_FEED_PATH,
  expect,
} from './community-session'
import { log } from '@seontechnologies/playwright-utils/log'
import { buildUniqueId } from './api-test'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './commerce-session'
import { localE2EAccessToken as engagementToken } from './local-e2e-token'
import { holdEngagementFeed } from './engagement-feed-lock'
export { engagementToken }

export type Utilities = {
  apiRequest: <T>(
    options: Omit<ApiRequestParams, 'request'>
  ) => Promise<ApiRequestResponse<T>>
  recurse: <T>(
    command: () => Promise<T>,
    predicate: (value: T) => boolean,
    options?: Record<string, unknown>
  ) => Promise<T>
}
export type Account = { apiBaseUrl: string; headers: Record<string, string> }

const expectedErasedAuthors = new WeakSet<Page>()
export function expectErasedAuthorDenial(page: Page) {
  expectedErasedAuthors.add(page)
}

async function monitorPage(
  page: Page,
  use: () => Promise<void>,
  info: TestInfo,
  author = false
) {
  const expectsResync =
    !author && info.annotations.some((item) => item.type === 'expectedCommunityResync')
  const expectsErasure =
    author && info.annotations.some((item) => item.type === 'expectedAuthorErasureDenial')
  const events = /\/api\/v1\/community\/events(?:\?|$)/
  // An erased author's open thread can still be reading the comments of a look the
  // erasure removed; that read answers 404 and the thread then closes.
  const erasedComments = /\/api\/v1\/community\/posts\/[^/?]+\/comments(?:\?|$)/
  const excluded = expectsErasure ? [events, erasedComments] : [events]
  const failures: string[] = []
  // playwright-utils deviation: the monitor supports URL exclusions, not status/body-scoped expected errors.
  // Its excluded cursor responses remain status-checked; the scenario validates the canonical body through the same actual HTTP cursor.
  if (expectsResync || expectsErasure)
    page.on('response', (response) => {
      const url = response.url()
      if (!excluded.some((pattern) => pattern.test(url)) || response.status() < 400)
        return
      try {
        if (expectsErasure) {
          expect(expectedErasedAuthors.has(page)).toBe(true)
          expect(response.status()).toBe(events.test(url) ? 403 : 404)
        } else expect(response.status()).toBe(409)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    })
  const monitor = createNetworkErrorMonitorFixture(
    expectsResync || expectsErasure ? { excludePatterns: excluded } : undefined
  ).networkErrorMonitor[0] as (
    args: { page: Page },
    use: () => Promise<void>,
    info: TestInfo
  ) => Promise<void>
  try {
    await monitor({ page }, use, info)
  } finally {
    expect(failures).toEqual([])
  }
}

/**
 * Init script, serialized into the page on its own. It also runs in a fresh page's opaque about:blank, where
 * sessionStorage throws a SecurityError, so it seeds only real app origins.
 */
function seedSessionToken({ key, token }: { key: string; token: string }) {
  if (window.location.origin !== 'null') window.sessionStorage.setItem(key, token)
}

/**
 * Publishes a look for one test, by an owner who is neither the reader nor the
 * actor, so both can react and comment on it. The owner is cleaned up with the
 * API context's accounts. A newly published look leads the "all" feed, so it is on
 * the first page wherever other tests' looks land.
 */
export async function publishOwnLook(
  {
    communityApi,
    request,
    apiRequest,
    recurse,
  }: {
    communityApi: { apiBaseUrl: string; trackUser: (userId: string) => void }
    request: APIRequestContext
    apiRequest: Parameters<typeof waitForTerminalAuthorState>[0]['apiRequest']
    recurse: Parameters<typeof waitForTerminalAuthorState>[0]['recurse']
  },
  testInfo: TestInfo,
  label = 'Engagement look'
): Promise<{ postId: string; caption: string }> {
  const ownerId = await signUpCommunityUser(
    request,
    communityApi.apiBaseUrl,
    // One owner per look, so a test can publish more than one.
    buildUniqueId(
      `engagement-owner-${label.toLowerCase().replace(/\W+/g, '-')}`,
      testInfo
    )
  )
  communityApi.trackUser(ownerId)
  const caption = `${label} ${randomUUID().slice(0, 8)}`
  const published = await publishCommunityLook(request, {
    apiBaseUrl: communityApi.apiBaseUrl,
    userId: ownerId,
    fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
    altText: 'Synthetic plum satin fabric',
    caption,
  })
  const terminal = await waitForTerminalAuthorState(
    { apiRequest, recurse },
    { apiBaseUrl: communityApi.apiBaseUrl, userId: ownerId, postId: published.postId }
  )
  expect(terminal.status).toBe('published')
  return { postId: published.postId, caption }
}

export const test = communityApiTest.extend<{
  authorPage: Page
  communitySession: CommunitySession
  /**
   * The id of a look this test alone reads and changes. A shared seeded post
   * collided when the spec ran in parallel: another worker's reaction or comment
   * landed on the same card between a test's read and its assertion.
   */
  look: string
  exclusiveFeed: void
  networkErrorMonitor: void
}>({
  /**
   * These tests assert on the shared "all" feed: their looks lead it, new looks
   * buffer on it, and their cleanup removes looks from it. Two of them at once,
   * as parallel workers or --repeat-each run them, displace each other's looks and
   * read looks the other's cleanup just deleted. One runs at a time; set up first
   * and torn down last, the lock also covers each test's cleanup.
   */
  exclusiveFeed: [
    async ({}, use, testInfo) =>
      holdEngagementFeed(testInfo, () => use(), {
        databaseUrl: () => localPlaywrightDatabaseUrl().toString(),
      }),
    { auto: true },
  ],
  networkErrorMonitor: [
    async ({ page }, use, info) => monitorPage(page, use, info),
    { auto: true },
  ],
  communitySession: async ({ communityApi, context, request }, use, testInfo) => {
    const userId = await signUpCommunityUser(
      request,
      communityApi.apiBaseUrl,
      buildUniqueId('engagement', testInfo)
    )
    communityApi.trackUser(userId)
    const accessToken = engagementToken(userId)
    await context.addInitScript(seedSessionToken, {
      key: WEB_ACCESS_TOKEN_STORAGE_KEY,
      token: accessToken,
    })
    await use({ userId, accessToken, apiBaseUrl: communityApi.apiBaseUrl })
  },
  look: async ({ communityApi, request, apiRequest, recurse }, use, testInfo) => {
    const { postId } = await publishOwnLook(
      { communityApi, request, apiRequest, recurse },
      testInfo
    )
    await use(postId)
  },
  authorPage: async ({ browser, communityApi, baseURL }, use, testInfo) => {
    const context = await browser.newContext({ baseURL })
    const token = engagementToken(communityApi.userId)
    await context.addInitScript(seedSessionToken, {
      key: WEB_ACCESS_TOKEN_STORAGE_KEY,
      token,
    })
    const page = await context.newPage()
    try {
      await monitorPage(
        page,
        async () => {
          void interceptNetworkCall({
            page,
            url: '**/ingest/**',
            fulfillResponse: { status: 200, body: {} },
          })
          await use(page)
        },
        testInfo,
        true
      )
    } finally {
      await context.close()
    }
  },
})
export { expect }

export const accountFor = (session: {
  apiBaseUrl: string
  accessToken: string
}): Account => ({
  apiBaseUrl: session.apiBaseUrl,
  headers: {
    Authorization: `Bearer ${session.accessToken}`,
    'x-couture-platform': 'web',
  },
})

export async function openAll(page: Page) {
  page.on('requestfailed', (request) => {
    void log.info(
      `Request failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`
    )
  })
  page.on('console', (message) => {
    if (message.type() === 'error') void log.info(`Browser error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    void log.info(`Page error: ${error.message}`)
  })
  await page.goto('/')
  await expect(
    page.getByTestId('community-card-grid').getByRole('article').first()
  ).toBeVisible()
  await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  // playwright-utils deviation: interceptNetworkCall binds to the first matching
  // request. The app may supersede (abort) that feed read, so wait for the
  // completed `all` response the grid actually renders.
  const all = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'GET' &&
      url.pathname === COMMUNITY_FEED_PATH &&
      url.searchParams.get('mode') === 'all'
    )
  })
  await page.getByTestId('community-filter-all').click()
  const result = await all
  expect(result.status()).toBe(200)
  const data = communityReactionFeedResponseSchema.parse(await result.json()).data
  await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  return data
}
export const interceptFor =
  (page: Page): InterceptNetworkCallFn =>
  (options) =>
    interceptNetworkCall({ page, ...options })
export const thread = (page: Page) => page.getByTestId('community-comments')

/**
 * Records, from inside the page, every moment the given card or the open thread stops
 * being visible, or the outage notice appears. A single snapshot can miss a brief
 * hide; a MutationObserver cannot. Returns a stop function with what it saw.
 */
export async function watchContentStaysVisible(page: Page, postId: string) {
  await page.evaluate((cardId) => {
    const lapses: string[] = []
    const check = () => {
      const card = document.querySelector(`[data-testid="lookbook-card-${cardId}"]`)
      const sheet = document.querySelector('[data-testid="community-comments"]')
      if (!card?.checkVisibility())
        lapses.push(`card hidden @${Math.round(performance.now())}`)
      if (!sheet?.checkVisibility())
        lapses.push(`thread hidden @${Math.round(performance.now())}`)
      if (document.body.textContent?.includes('Community is temporarily unavailable'))
        lapses.push(`outage notice @${Math.round(performance.now())}`)
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    check()
    Object.defineProperty(window, '__contentWatch', {
      configurable: true,
      value: { lapses, stop: () => observer.disconnect() },
    })
  }, postId)
  return () =>
    page.evaluate(() => {
      const watch = (
        window as unknown as { __contentWatch: { lapses: string[]; stop: () => void } }
      ).__contentWatch
      watch.stop()
      return [...new Set(watch.lapses.map((lapse) => lapse.split(' @')[0]))]
    })
}
export async function openComments(page: Page, postId: string) {
  await page.getByTestId(`comments-button-${postId}`).click()
  await expect(
    thread(page).getByRole('heading', { name: 'Comments', exact: true })
  ).toBeFocused()
  await expect(thread(page).getByLabel('Add a comment')).toBeVisible()
}
export async function closeComments(page: Page) {
  await thread(page).getByRole('button', { name: 'Close this look', exact: true }).click()
  await expect(thread(page)).toHaveCount(0)
}

export async function submitComment(
  { apiRequest }: Utilities,
  account: Account,
  postId: string,
  body: string,
  parentId: string | null = null
) {
  const result = await apiRequest<unknown>({
    method: 'POST',
    path: `/api/v1/community/posts/${postId}/comments`,
    baseUrl: account.apiBaseUrl,
    headers: account.headers,
    body: { mutationId: randomUUID(), body, locale: 'en-US', parentId },
    retryConfig: { maxRetries: 0 },
  })
  expect(result.status).toBe(200)
  return communityCommentSubmissionResponseSchema.parse(result.body).data
}
export async function settleComment(
  utils: Utilities,
  account: Account,
  postId: string,
  id: string
) {
  const result = await utils.recurse(
    () =>
      utils.apiRequest<unknown>({
        method: 'GET',
        path: `/api/v1/community/posts/${postId}/comment-submissions`,
        baseUrl: account.apiBaseUrl,
        headers: account.headers,
      }),
    (response) =>
      response.status === 200 &&
      communityCommentSubmissionsResponseSchema
        .parse(response.body)
        .data.items.some((item) => item.id === id && item.status !== 'pending_screening'),
    { timeout: 20_000, interval: 250 }
  )
  return communityCommentSubmissionsResponseSchema
    .parse(result.body)
    .data.items.find((item) => item.id === id)!
}

/** Only community periodic timers are disabled. Request and operation deadlines remain real. */
export async function disablePeriodicCommunityPolling(page: Page) {
  // playwright-utils deviation: timer interception has no utility counterpart; this is an external clock boundary.
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window)
    const interval = window.setInterval.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const periodic =
        (delay !== undefined && delay >= 7_500 && delay < 8_000) ||
        [3_000, 6_000, 12_000, 24_000, 30_000].includes(delay ?? 0)
      return original(periodic ? () => undefined : handler, periodic ? 0 : delay, ...args)
    }) as typeof window.setTimeout
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      interval(
        delay === 30_000 ? () => undefined : handler,
        delay,
        ...args
      )) as typeof window.setInterval
  })
}

export async function observeCommunitySocket(page: Page) {
  let blocked = false,
    handshakes = 0,
    doorbells = 0
  const bells: number[] = []
  const sockets = new Set<WebSocketRoute>()
  // playwright-utils deviation: HTTP interceptNetworkCall cannot observe or fault WebSocket frames.
  await page.routeWebSocket('**/api/realtime**', async (socket) => {
    if (blocked) {
      await socket.close()
      return
    }
    sockets.add(socket)
    const server = socket.connectToServer()
    server.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString()
      if (text.startsWith('40/community')) handshakes++
      if (text.startsWith('42/community') && text.includes('community:changed')) {
        const payload = JSON.parse(text.slice(text.indexOf('['))) as unknown[]
        expect(payload).toEqual([
          'community:changed',
          { version: 1, type: 'community:changed' },
        ])
        doorbells++
        bells.push(Date.now())
      }
      socket.send(message)
    })
    socket.onClose(async () => {
      sockets.delete(socket)
      await server.close()
    })
  })
  const reads: { path: string; at: number }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      request.method() === 'GET' &&
      /\/community\/(events|posts\/[^/]+\/(comments|comment-submissions))/.test(
        url.pathname
      )
    ) {
      reads.push({ path: url.pathname, at: Date.now() })
    }
  })
  return {
    get handshakes() {
      return handshakes
    },
    get doorbells() {
      return doorbells
    },
    /** Arrival time of each doorbell, recorded before it is forwarded to the page. */
    bells,
    reads,
    async disconnect() {
      blocked = true
      for (const socket of sockets) await socket.close()
      sockets.clear()
    },
    reconnect() {
      blocked = false
    },
  }
}

/** Controlled operator entry point. Production has no HTTP moderation operator route. */
export async function takeDownCommunityLook(postId: string, operatorId: string) {
  const db = communityTestDatabase()
  // The normal local Playwright route builds API dist before executing browser tests.
  const { CommunityModerationActionsService } =
    require('../../../apps/api/dist/src/modules/community/community-moderation.actions.js') as {
      CommunityModerationActionsService: new (
        db: PrismaClient,
        flags: { getFeatureFlag: () => never }
      ) => {
        takeDownPublishedPost(input: {
          postId: string
          operatorId: string
          reason: string
        }): Promise<{ takenDown: boolean }>
      }
    }
  try {
    const service = new CommunityModerationActionsService(db, {
      getFeatureFlag: () => {
        throw new Error('Unexpected feature flag lookup in takedown')
      },
    })
    expect(
      await service.takeDownPublishedPost({
        postId,
        operatorId,
        reason: 'Synthetic acceptance takedown',
      })
    ).toEqual({ takenDown: true })
    expect(
      (await db.lookbookPost.findUniqueOrThrow({ where: { id: postId } })).status
    ).toBe('flagged')
  } finally {
    await db.$disconnect()
  }
}

/** Production account-erasure repository entry point, scoped to the fixture's own account. */
export async function requestCommunityAccountErasure(userId: string) {
  const db = communityTestDatabase()
  const { CommunityRepository } =
    require('../../../apps/api/dist/src/modules/community/community.repository.js') as {
      CommunityRepository: new (db: PrismaClient) => {
        requestErasureForUser(userId: string, at: Date): Promise<number>
      }
    }
  try {
    const at = new Date()
    expect(
      await new CommunityRepository(db).requestErasureForUser(userId, at)
    ).toBeGreaterThan(0)
    expect(
      await db.lookbookPost.count({
        where: { user_id: userId, erasure_requested_at: null },
      })
    ).toBe(0)
  } finally {
    await db.$disconnect()
  }
}

export function communityTestDatabase() {
  return new PrismaClient({ datasourceUrl: localPlaywrightDatabaseUrl().toString() })
}

/** Observe fallback timer arming without changing any timer or callback. */
export async function observeCommunityFallbackTimers(page: Page) {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window)
    const evidence = { armed: 0 }
    Object.defineProperty(window, '__communityFallbackTimers', { value: evidence })
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== undefined && delay >= 7500 && delay < 8000) evidence.armed++
      return original(handler, delay, ...args)
    }) as typeof window.setTimeout
  })
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { __communityFallbackTimers: { armed: number } })
          .__communityFallbackTimers.armed
    )
}
