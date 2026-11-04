// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.11 test owner: the decision panel, the author standing and the banned notice in a real browser
// against the real API. P-D-JOURNEY, P-D-CONFLICT, P-D-BAN-JOURNEY, P-D-AXE, P-D-TAKEDOWN-PUBLIC,
// P-D-KEYBOARD, P-D-THEMES-WIDTHS, P-D-OFFLINE-RETRY, P-D-APPEAL, P-D-PREVIEW-CLOSED, P-D-LOCALE, P-D-DISABLED.
// P-D-ROLES lives in playwright/tests/api/auth-moderation-security.spec.ts.
// Two kinds of test share this file.
// Live tests need no database: they sign up a throwaway moderator through the product API, so they run on a
// local stack and on a Vercel preview alike. Each environment's flag state is pinned, see `closedWriteCode`.
// Seeded tests need direct database access and run on a local stack only.
// Every seeded row carries a run id and nothing is deleted: AuditLog is immutable and its user_id is a
// RESTRICT key.
// The flags stay at the seeded value (RG5), so a disabled state on a local stack is a routed answer plus the
// real flag in the API integration suite.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  errors,
  type APIRequestContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
  type WebSocket,
} from '@playwright/test'
import {
  communityBannedErrorSchema,
  communityFeedResponseSchema,
  communitySpotlightResponseSchema,
  MODERATION_QUEUE_MAX_LIMIT,
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  moderationDecisionErrorSchema,
  moderationDecisionResponseSchema,
  type ModerationDecisionAction,
} from '@couture/api-client/contracts/http'
import {
  buildSpotlightSavedLocationCreateInput,
  persistSpotlightCohort,
  planSpotlightCohort,
} from '@couture/testing'
import type {
  ApiRequestParams,
  ApiRequestResponse,
} from '@seontechnologies/playwright-utils/api-request'
import { interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call'
import { test as base, expect } from '../support/fixtures/merged-fixtures'
import { checkA11y } from '../support/helpers/accessibility'
import {
  authHeaders,
  type ApiRole,
  buildUniqueId,
  isNonLocalEnvironment,
  isProdEnvironment,
  resolveApiBaseUrl,
} from '../support/helpers/api-test'
import { installApiProxy } from '../support/helpers/browser-api-proxy'
import {
  seedWebSession,
  WEB_ACCESS_TOKEN_STORAGE_KEY,
} from '../support/helpers/commerce-session'
import { signUpCommunityUser } from '../support/helpers/community-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  newRunId,
  SEED_DAY_MS,
  seedMember,
  seedPost,
  seedPostReport,
} from '../../apps/api/integration/helpers/moderation-queue-seed'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '../../_bmad-output/test-artifacts/story-6-11'
)
const LOCALES_DIR = path.resolve(__dirname, '../../apps/web/src/i18n/locales')

const NO_DATABASE =
  'Seeding needs direct database access, which a preview run does not have.'
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

// The client is built on first use, so a preview run never opens a database connection.
let prismaClient: PrismaClient | undefined
const databaseClient = () =>
  (prismaClient ??= new PrismaClient({ datasources: { db: { url: databaseUrl } } }))

type SeededMember = { id: string; alias: string }
type PostStatus = 'published' | 'flagged'
type SeededCase = {
  caseId: string
  postId: string
  caption: string
  author: SeededMember
  reporters: SeededMember[]
}

/**
 * A feed read omits a post whose image cannot be signed, and only the seed uploads objects.
 * So every look here points at the object the seeded spotlight cohort already holds in local Storage.
 */
let signableImagePath: Promise<string> | undefined
const seededImagePath = (prisma: PrismaClient) =>
  (signableImagePath ??= prisma.lookbookPost
    .findUniqueOrThrow({ where: { id: 'seed-spotlight-1' } })
    .then((post) => {
      if (!post.image_object_path) throw new Error('The seeded spotlight lost its image.')
      return post.image_object_path
    }))

/** One test's data. Ids carry a run id, so tests and repeats never share a row. */
function decisionSeed(prisma: PrismaClient) {
  const runId = newRunId()
  let counter = 0
  const label = () => `${++counter}`
  const member = (name = 'member'): Promise<SeededMember> =>
    seedMember(prisma, runId, `${name}${label()}`)
  const operator = (): Promise<SeededMember> =>
    seedMember(prisma, runId, `operator${label()}`, { alias: false })

  async function post(authorId: string, status: PostStatus = 'published') {
    const now = new Date()
    const name = label()
    const caption = `Look ${runId} ${name}`
    const row = await seedPost(prisma, {
      runId,
      label: name,
      authorId,
      status,
      caption,
      altText: `Alt ${name}`,
      now,
      ...(status === 'flagged' ? { moderationReason: 'unsafe_class' } : {}),
    })
    await prisma.lookbookPost.update({
      where: { id: row.id },
      data: { image_object_path: await seededImagePath(prisma) },
    })
    return { id: row.id, caption }
  }

  async function report(postId: string) {
    const reporter = await member('reporter')
    const now = new Date()
    await seedPostReport(prisma, {
      runId,
      label: label(),
      postId,
      reporterId: reporter.id,
      reason: 'harassment',
      createdAt: now,
      dueAt: new Date(now.getTime() + SEED_DAY_MS),
    })
    return reporter
  }

  async function postCase(
    params: { status?: PostStatus; reports?: number; author?: SeededMember } = {}
  ): Promise<SeededCase> {
    const author = params.author ?? (await member('author'))
    const row = await post(author.id, params.status)
    const reporters: SeededMember[] = []
    for (let index = 0; index < (params.reports ?? 1); index++)
      reporters.push(await report(row.id))
    return {
      caseId: `post.${row.id}`,
      postId: row.id,
      caption: row.caption,
      author,
      reporters,
    }
  }

  return { runId, member, operator, post, report, postCase }
}

type OpenAs = (
  userId: string,
  role: ApiRole,
  options?: BrowserContextOptions
) => Promise<Page>

type Fixtures = {
  prisma: PrismaClient
  fx: ReturnType<typeof decisionSeed>
  moderator: SeededMember
  /** A signed-in browser of its own, for a second person. Closed with the test. */
  openAs: OpenAs
}

// These fixtures seed this story's rows and no other spec uses them, so they stay beside the tests.
const test = base.extend<Fixtures>({
  prisma: async ({}, use, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), NO_DATABASE)
    await use(databaseClient())
  },
  fx: async ({ prisma }, use) => {
    await use(decisionSeed(prisma))
  },
  moderator: async ({ fx }, use) => {
    await use(await fx.operator())
  },
  openAs: async ({ browser }, use) => {
    const contexts: { close: () => Promise<void> }[] = []
    await use(async (userId, role, options = {}) => {
      const context = await browser.newContext(options)
      contexts.push(context)
      await seedWebSession(context, localE2EAccessToken(userId, role))
      const page = await context.newPage()
      // The merged fixture stubs ingest on its own page only. A second person's page gets the same stub.
      void interceptNetworkCall({
        page,
        url: '**/ingest/**',
        fulfillResponse: { status: 200, body: {} },
      })
      return page
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

test.afterAll(async () => {
  await prismaClient?.$disconnect()
})

test.beforeEach(({}, testInfo) => {
  test.skip(
    isProdEnvironment(testInfo),
    'Synthetic moderator identities are not provisioned in production.'
  )
})

const QUEUE_URL = '/moderation'
const caseUrl = (caseId: string) => `/moderation/cases/${encodeURIComponent(caseId)}`
const COMMUNITY_URL = '/'

/** Next adds its own route announcer with role alert, so the console alert is everything else. */
const alertOf = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)')
const panelOf = (page: Page) => page.getByRole('region', { name: 'Decision' })
const standingOf = (page: Page) => page.getByRole('region', { name: 'Author standing' })
const outcomeOf = (page: Page) => page.getByTestId('moderation-decision-outcome')
const noticeOf = (page: Page) => page.getByTestId('community-banned-notice')
const cardOf = (page: Page, postId: string) => page.getByTestId(`lookbook-card-${postId}`)

const ACTION_LABEL: Record<ModerationDecisionAction, string> = {
  resolve: 'Resolve',
  release: 'Release',
  takedown: 'Take down',
  escalate: 'Escalate',
  ban: 'Ban the author',
}
const actionRadio = (page: Page, action: ModerationDecisionAction) =>
  panelOf(page).getByRole('radio', { name: new RegExp(`^${ACTION_LABEL[action]}`) })
const reasonBox = (page: Page) =>
  panelOf(page).getByRole('textbox', { name: 'Reason (required)' })
const submitButton = (page: Page) =>
  panelOf(page).getByRole('button', { name: 'Apply decision' })
const confirmButton = (page: Page) =>
  panelOf(page).getByRole('button', { name: 'Yes, apply it' })

async function signInAs(page: Page, userId: string, role: ApiRole = 'moderator') {
  await seedWebSession(page.context(), localE2EAccessToken(userId, role))
  const testInfo = test.info()
  if (!isNonLocalEnvironment(testInfo)) return
  // A deployed web preview and its API are separate protected origins, as in the 6.10 console spec.
  await installApiProxy(page, testInfo)
  await page.addInitScript(
    ({ key, token }) => {
      if (window.location.origin === 'null') return
      window.sessionStorage.setItem(key, token)
      // eslint-disable-next-line @typescript-eslint/unbound-method -- called back with the caller's own `this`
      const removeItem = Storage.prototype.removeItem
      Storage.prototype.removeItem = function (this: Storage, name: string) {
        if (this === window.sessionStorage && name === key) return
        removeItem.call(this, name)
      }
    },
    { key: WEB_ACCESS_TOKEN_STORAGE_KEY, token: localE2EAccessToken(userId, role) }
  )
}

async function openCase(page: Page, caseId: string) {
  await page.goto(caseUrl(caseId))
  await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
}

/** Everything but the submit: pick the action and type the reason. */
async function fillDecision(
  page: Page,
  action: ModerationDecisionAction,
  reason: string
) {
  await actionRadio(page, action).check()
  await reasonBox(page).fill(reason)
}

/** A whole decision through the panel, the confirmation step included where the action has one. */
async function decideInBrowser(
  page: Page,
  action: ModerationDecisionAction,
  reason: string
) {
  await fillDecision(page, action, reason)
  await submitButton(page).click()
  if (action === 'takedown' || action === 'ban') await confirmButton(page).click()
}

type Actor = { id: string; role: ApiRole }
type ApiRequest = <T>(
  options: Omit<ApiRequestParams, 'request'>
) => Promise<ApiRequestResponse<T>>

/** An operator as the console uses the API: read the revision, then decide. Always a fresh mutation. */
async function decideByApi(
  apiRequest: ApiRequest,
  testInfo: TestInfo,
  actor: Actor,
  caseId: string,
  input: { action: ModerationDecisionAction; reason: string; ban?: unknown }
) {
  const baseUrl = resolveApiBaseUrl(testInfo)
  const headers = authHeaders(actor.id, actor.role)
  const detail = await apiRequest<unknown>({
    method: 'GET',
    path: `/api/v1/moderation/cases/${caseId}`,
    baseUrl,
    headers,
  })
  expect(detail.status, JSON.stringify(detail.body)).toBe(200)
  const { revision } = moderationCaseDetailResponseSchema.parse(detail.body).data
  return apiRequest<unknown>({
    method: 'POST',
    path: `/api/v1/moderation/cases/${caseId}/decisions`,
    baseUrl,
    headers,
    body: { ...input, mutationId: randomUUID(), expectedRevision: revision },
    retryConfig: { maxRetries: 0 },
  })
}

const memberHeaders = (userId: string) => ({
  ...authHeaders(userId, 'guardian'),
  'x-couture-platform': 'web',
})

/** Enough pages of 30 to reach the end of the feed in any local database. */
const WHOLE_FEED = 200

/** The `all` feed as one member reads it, walked page by page. */
async function feedIds(
  apiRequest: ApiRequest,
  testInfo: TestInfo,
  userId: string,
  pages = 3
) {
  const ids: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < pages; page++) {
    const result: { status: number; body: unknown } = await apiRequest<unknown>({
      method: 'GET',
      path: `/api/v1/community/feed?mode=all&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      baseUrl: resolveApiBaseUrl(testInfo),
      headers: memberHeaders(userId),
    })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const { data } = communityFeedResponseSchema.parse(result.body)
    ids.push(...data.items.map((item) => item.id))
    cursor = data.nextCursor
    if (!cursor) break
  }
  return ids
}

/** Reads the spotlight once, for the module (`spotlight`) or for the Home teaser (`home_teaser`). */
async function spotlightIds(
  apiRequest: ApiRequest,
  testInfo: TestInfo,
  userId: string,
  surface?: 'home_teaser'
) {
  const result = await apiRequest<unknown>({
    method: 'GET',
    path: `/api/v1/community/spotlight${surface ? `?surface=${surface}` : ''}`,
    baseUrl: resolveApiBaseUrl(testInfo),
    headers: memberHeaders(userId),
  })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  const { data } = communitySpotlightResponseSchema.parse(result.body)
  return { level: data.level, ids: data.items.map((item) => item.id) }
}

/** Every case id one queue status holds, as a moderator reads it through the API, walked to the last page. */
async function queueCaseIds(
  apiRequest: ApiRequest,
  testInfo: TestInfo,
  moderatorId: string,
  status: 'open' | 'resolved'
) {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const result: { status: number; body: unknown } = await apiRequest<unknown>({
      method: 'GET',
      path: '/api/v1/moderation/cases',
      baseUrl: resolveApiBaseUrl(testInfo),
      headers: authHeaders(moderatorId, 'moderator'),
      params: {
        status,
        limit: MODERATION_QUEUE_MAX_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
    })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const { data } = moderationCasesResponseSchema.parse(result.body)
    ids.push(...data.items.map((item) => item.caseId))
    cursor = data.nextCursor
  } while (cursor)
  return ids
}

/** Opens the community section on the `all` filter, where a newly published look leads. */
async function openCommunity(page: Page, postId: string) {
  await page.goto(COMMUNITY_URL)
  // playwright-utils deviation: interceptNetworkCall binds to the first matching request, and the grid
  // supersedes and aborts feed reads, so this waits for the completed read the grid renders.
  const answered = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname.endsWith('/api/v1/community/feed') &&
      url.searchParams.get('mode') === 'all'
    )
  })
  await page.getByTestId('community-filter-all').click()
  expect((await answered).status()).toBe(200)
  // Looks seeded by parallel workers since can push this one past the first page, so walk until it shows.
  const grid = page.getByTestId('community-card-grid')
  const more = page.getByRole('button', { name: 'Load more looks' })
  for (let attempt = 0; attempt < 10; attempt++) {
    await expect(grid).toHaveAttribute('aria-busy', 'false')
    if ((await cardOf(page, postId).count()) > 0 || !(await more.isEnabled())) break
    await more.click()
  }
  await expect(cardOf(page, postId)).toBeVisible()
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )

/** The first element inside `region` that sticks out past the region or clips its own text. */
const overflowingElement = (region: Locator) =>
  region.evaluate((root) => {
    const limit = root.getBoundingClientRect().right + 0.5
    for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const element = node as HTMLElement
      const box = element.getBoundingClientRect()
      if (box.width === 0 || getComputedStyle(element).position === 'absolute') continue
      if (box.right > limit || element.scrollWidth > element.clientWidth + 1) {
        if (getComputedStyle(element).display === 'inline') continue
        return `${element.tagName}: ${element.textContent?.slice(0, 60) ?? ''}`
      }
    }
    return null
  })

/**
 * Every interactive target in `scope` as a label and a measured box.
 * A radio's target is its whole label, which is what a pointer can hit.
 */
const targetSizes = (scope: Locator) =>
  scope.evaluateAll((roots) =>
    roots.flatMap((root) =>
      Array.from(
        root.querySelectorAll(
          'button, a[href], select, textarea, label:has(input[type="radio"])'
        )
      ).map((element) => {
        const box = element.getBoundingClientRect()
        return {
          target: `${element.tagName} ${element.textContent?.trim().slice(0, 30) ?? ''}`,
          width: box.width,
          height: box.height,
        }
      })
    )
  )

async function expectTargetsAt44(scope: Locator, label: string) {
  const targets = await targetSizes(scope)
  expect(targets.length, `${label} holds a target`).toBeGreaterThan(0)
  for (const target of targets) {
    expect(target.height, `${label} ${target.target} height`).toBeGreaterThanOrEqual(44)
    expect(target.width, `${label} ${target.target} width`).toBeGreaterThanOrEqual(44)
  }
}

/**
 * Lists every text the one polite region takes, compared with its previous raw text.
 * Clearing the region and setting the same words again is two announcements, so it shows as two.
 */
async function watchAnnouncements(page: Page) {
  await outcomeOf(page).evaluate((node) => {
    const seen: string[] = []
    let previous = node.textContent?.trim() ?? ''
    new MutationObserver(() => {
      const text = node.textContent?.trim() ?? ''
      if (text === previous) return
      previous = text
      if (text) seen.push(text)
    }).observe(node, { subtree: true, childList: true, characterData: true })
    Object.defineProperty(window, '__cc611Announcements', { value: seen })
  })
  return () =>
    page.evaluate(
      () => (window as unknown as { __cc611Announcements: string[] }).__cc611Announcements
    )
}

/** The rows one decision writes, for a test that says exactly one was written. */
async function decisionRows(prisma: PrismaClient, caseId: string) {
  return prisma.moderationDecision.findMany({
    where: { case_key: caseId },
    orderBy: { sequence: 'asc' },
  })
}

/** The socket revalidates every 4 to 6 seconds (D8), so this covers two rounds and the read after them. */
const REALTIME_WINDOW_MS = 20_000
/** How long a test that says nothing more is sent keeps listening for a late request. */
const QUIET_WINDOW_MS = 2_000

const pathOf = (request: Request) => new URL(request.url()).pathname
const isDecisionPost = (request: Request) =>
  request.method() === 'POST' && pathOf(request).endsWith('/decisions')
const isCaseRead = (request: Request) =>
  request.method() === 'GET' &&
  /^\/api\/v1\/moderation\/cases\/[^/]+$/.test(pathOf(request))
const isFeedRead = (request: Request) =>
  request.method() === 'GET' && pathOf(request) === '/api/v1/community/feed'

/** Keeps the URL of every matching request from now on, in flight or answered. */
function trackRequests(page: Page, matches: (request: Request) => boolean) {
  const seen: string[] = []
  // playwright-utils deviation: interceptNetworkCall settles on the first match, and this counts them all.
  page.on('request', (request) => {
    if (matches(request)) seen.push(request.url())
  })
  return seen
}

/** Fails the moment a matching request starts inside the window, and passes when the window ends quiet. */
async function expectNoFurtherRequest(
  page: Page,
  matches: (request: Request) => boolean,
  label: string
) {
  // playwright-utils deviation: interceptNetworkCall has no way to assert that a request never comes.
  const late = await page
    .waitForRequest(matches, { timeout: QUIET_WINDOW_MS })
    .catch((error: unknown) => {
      if (error instanceof errors.TimeoutError) return null
      throw error
    })
  expect(late?.url() ?? null, label).toBeNull()
}

/** Nothing left the page, nothing is about to, and nothing was written. */
async function expectNoDecisionSent(
  page: Page,
  posts: string[],
  prisma: PrismaClient,
  caseId: string
) {
  await expectNoFurtherRequest(page, isDecisionPost, 'a decision POST')
  expect(posts).toEqual([])
  expect(await decisionRows(prisma, caseId)).toHaveLength(0)
}

// ---------------------------------------------------------------------------------------------------
// Live tests: no database, safe on a preview.
// ---------------------------------------------------------------------------------------------------

/**
 * The code a moderator's write answers in this environment, or null when the route is open.
 * A local stack seeds both flags on. A deployed preview runs no seed, so both stay at their default off,
 * and the route reads the console flag first. Turning a flag on for previews changes this line on purpose.
 */
const closedWriteCode = (testInfo: TestInfo) =>
  isNonLocalEnvironment(testInfo) ? 'moderation_console_disabled' : null

/** A schema-valid case the stubbed tests serve themselves, so they need no stored case. */
const stubbedDetail = (
  caseId: string,
  allowedActions: ModerationDecisionAction[]
): unknown =>
  moderationCaseDetailResponseSchema.parse({
    data: {
      caseId,
      source: 'post',
      status: 'open',
      risk: 'medium',
      slaState: 'on_track',
      slaDueAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
      acceptedAt: new Date(Date.now() - 3_600_000).toISOString(),
      serverNow: new Date().toISOString(),
      reportCount: 1,
      locale: 'en-US',
      subject: { state: 'alias', alias: 'stub-author' },
      snapshot: {
        available: true,
        caption: 'Stubbed caption',
        altText: 'Stubbed alt text',
        body: null,
        climateBand: null,
        capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
      target: {
        state: 'live',
        status: 'published',
        publishedAt: new Date(Date.now() - 7_200_000).toISOString(),
        parentBody: null,
      },
      findings: null,
      reporters: [
        {
          identity: { state: 'alias', alias: 'stub-reporter' },
          origin: 'member',
          reason: 'spam',
          details: null,
          reportedAt: new Date(Date.now() - 3_600_000).toISOString(),
          resolved: false,
        },
      ],
      priorActions: [],
      media: { state: 'unavailable', reason: 'no_image' },
      viewerConflict: false,
      revision: '0123456789abcdef',
      allowedActions,
      banKinds: allowedActions.includes('ban') ? ['temporary'] : [],
      escalated: false,
      firstDecisionAt: null,
      subjectStanding: null,
    },
  })

/** One page of the queue holding the stubbed case, so the walk to it needs no stored case. */
const stubbedQueue = (caseId: string): unknown =>
  moderationCasesResponseSchema.parse({
    data: {
      items: [
        {
          caseId,
          source: 'post',
          status: 'open',
          risk: 'medium',
          slaState: 'on_track',
          slaDueAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
          acceptedAt: new Date(Date.now() - 3_600_000).toISOString(),
          escalated: false,
          reportCount: 1,
          reasons: ['spam'],
          locale: 'en-US',
          hasFinding: false,
          excerpt: 'Stubbed caption',
        },
      ],
      nextCursor: null,
      serverNow: new Date().toISOString(),
    },
  })

test.describe('Moderation decisions, live (Story 6.11)', () => {
  // A live moderator is made the way a product user is made, so a preview can have one.
  const liveModerator = (request: APIRequestContext, testInfo: TestInfo) =>
    signUpCommunityUser(
      request,
      resolveApiBaseUrl(testInfo),
      buildUniqueId('moderator', testInfo)
    )

  test('[P1] P-D-PREVIEW-CLOSED the write routes answer per this environment, and no other role learns which', async ({
    request,
    apiRequest,
  }, testInfo) => {
    const moderatorId = await liveModerator(request, testInfo)
    const closed = closedWriteCode(testInfo)
    const baseUrl = resolveApiBaseUrl(testInfo)
    const body = {
      action: 'resolve',
      reason: 'Closed contract probe.',
      mutationId: randomUUID(),
      expectedRevision: '0000000000000000',
    }
    const appeal = {
      status: 'requested',
      reason: 'Closed contract probe.',
      mutationId: randomUUID(),
    }
    const routes = [
      {
        path: '/api/v1/moderation/cases/post.never-existed/decisions',
        data: body,
        missing: 'case_not_found',
      },
      {
        path: '/api/v1/moderation/sanctions/never-existed/appeal',
        data: appeal,
        missing: 'sanction_not_found',
      },
    ]
    for (const { path: route, data, missing } of routes) {
      for (const role of ['moderator', 'admin'] as const) {
        // playwright-utils deviation: apiRequest returns only status and body, and this reads Cache-Control.
        const answer = await request.post(`${baseUrl}${route}`, {
          headers: authHeaders(moderatorId, role),
          data,
        })
        expect(answer.headers()['cache-control'], route).toBe('private, no-store')
        const parsed = moderationDecisionErrorSchema.parse(await answer.json())
        // The flag is read before the id, so a closed route cannot reveal which ids exist.
        expect(answer.status(), route).toBe(closed ? 503 : 404)
        expect(parsed.code, route).toBe(closed ?? missing)
      }

      const post = (headers?: Record<string, string>) =>
        apiRequest<unknown>({
          method: 'POST',
          path: route,
          baseUrl,
          ...(headers ? { headers } : {}),
          body: data,
          retryConfig: { maxRetries: 0 },
        })
      const anonymous = await post()
      expect(anonymous.status, `anonymous ${route}`).toBe(401)
      const guardian = await post(
        authHeaders(buildUniqueId('guardian', testInfo), 'guardian')
      )
      expect(guardian.status, `guardian ${route}`).toBe(403)
      expect(JSON.stringify(guardian.body)).toContain('Insufficient role')
      const teen = await post(authHeaders(buildUniqueId('teen', testInfo), 'teen'))
      expect(teen.status, `teen ${route}`).toBe(403)
      expect(JSON.stringify(teen.body)).not.toContain('moderation_')
    }
  })

  test(
    '[P1] P-D-PREVIEW-CLOSED the real console in the browser matches this environment',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request }, testInfo) => {
      const moderatorId = await liveModerator(request, testInfo)
      await signInAs(page, moderatorId)
      await page.goto(QUEUE_URL)
      if (closedWriteCode(testInfo)) {
        await expect(alertOf(page)).toContainText('The moderation console is turned off.')
        await expect(page.locator('a[href^="/moderation/cases/"]')).toHaveCount(0)
      } else {
        // The list is left out at zero items, so an empty queue is the other healthy answer.
        await expect(
          page.getByRole('list', { name: 'Cases' }).or(page.getByText('No open cases.'))
        ).toBeVisible()
        await expect(alertOf(page)).toHaveCount(0)
      }
    }
  )

  test(
    '[P1] P-D-PREVIEW-CLOSED with decisions off a case from the queue reads as before and carries no form',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request, interceptNetworkCall }, testInfo) => {
      const moderatorId = await liveModerator(request, testInfo)
      // Sign in first: a later route wins, so the stubs below sit above the preview API proxy.
      await signInAs(page, moderatorId)
      const caseId = 'post.stubclosed'
      const headers = { 'cache-control': 'private, no-store' }
      void interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/moderation/cases?*',
        fulfillResponse: { status: 200, headers, body: stubbedQueue(caseId) },
      })
      // With the flag off the detail answers an empty list. P-D-DISABLED shows this stub with a form.
      void interceptNetworkCall({
        method: 'GET',
        url: `**/api/v1/moderation/cases/${caseId}`,
        fulfillResponse: { status: 200, headers, body: stubbedDetail(caseId, []) },
      })
      await page.goto(QUEUE_URL)
      await page.locator(`a[href="${caseUrl(caseId)}"]`).click()
      await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Content' })).toContainText(
        'Stubbed caption'
      )
      await expect(panelOf(page)).toHaveCount(0)
      await expect(page.getByRole('radio')).toHaveCount(0)
    }
  )

  test(
    '[P2] P-D-DISABLED a routed 503 keeps the case readable and the reason typed, and the reload drops the form',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request, interceptNetworkCall }, testInfo) => {
      const moderatorId = await liveModerator(request, testInfo)
      // Sign in first: a later route wins, so the stubs below sit above the preview API proxy.
      await signInAs(page, moderatorId)
      const caseId = 'post.stubdisabled'
      let allowed: ModerationDecisionAction[] = ['resolve', 'takedown', 'escalate']
      let reads = 0
      void interceptNetworkCall({
        method: 'GET',
        url: `**/api/v1/moderation/cases/${caseId}`,
        handler: async (route) => {
          reads += 1
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'cache-control': 'private, no-store' },
            json: stubbedDetail(caseId, allowed),
          })
        },
      })
      const refused = interceptNetworkCall({
        method: 'POST',
        url: `**/api/v1/moderation/cases/${caseId}/decisions`,
        fulfillResponse: {
          status: 503,
          headers: { 'cache-control': 'private, no-store' },
          // Parsed by the shipped error schema, so a body the contract rejects fails this test.
          body: moderationDecisionErrorSchema.parse({
            statusCode: 503,
            code: 'moderation_decisions_disabled',
            message: 'Moderation decisions are not available.',
          }),
        },
      })
      await openCase(page, caseId)
      const reason = 'Typed before the flag closed.'
      await fillDecision(page, 'resolve', reason)
      await submitButton(page).click()
      await refused

      const alert = panelOf(page).getByRole('alert')
      await expect(alert).toHaveText(
        /Moderation decisions are turned off\. Cases stay readable\./
      )
      await expect(reasonBox(page)).toHaveValue(reason)
      // Nothing to retry: a closed flag offers a reload and never a retry of the write.
      await expect(alert.getByRole('button', { name: 'Try again' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Content' })).toContainText(
        'Stubbed caption'
      )

      // With the flag off the detail answers an empty list, and the form goes with it.
      allowed = []
      expect(reads).toBe(1)
      await alert.getByRole('button', { name: 'Reload case' }).click()
      await expect(panelOf(page)).toHaveCount(0)
      expect(reads).toBe(2)
      await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
      await expect(page.getByRole('radio')).toHaveCount(0)
    }
  )
})

// ---------------------------------------------------------------------------------------------------
// Seeded tests: they read and write the database directly, so a preview run skips them.
// ---------------------------------------------------------------------------------------------------

test.describe('Moderation decisions, seeded (Story 6.11)', () => {
  test.describe('P-D-JOURNEY', () => {
    test('[P0] P-D-JOURNEY a moderator opens a case from the queue, resolves it and reads the outcome', async ({
      page,
      apiRequest,
      prisma,
      fx,
      moderator,
    }, testInfo) => {
      const seeded = await fx.postCase({ reports: 2 })
      await signInAs(page, moderator.id)
      await page.goto(QUEUE_URL)
      const link = page.locator(`a[href="${caseUrl(seeded.caseId)}"]`)
      const list = page.getByRole('list', { name: 'Cases' })
      await expect(list).toBeVisible()
      // A newly reported case may sit below the older open cases of a long-lived database.
      for (let attempt = 0; attempt < 400 && (await link.count()) === 0; attempt++) {
        const more = page.getByRole('button', { name: 'Load more' })
        if (!(await more.isVisible())) break
        const rows = page.locator('ol[aria-label="Cases"] > li')
        const before = await rows.count()
        await more.click()
        await expect(rows.nth(before)).toBeVisible()
      }
      await link.click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Post case' })
      ).toBeVisible()

      // A published target with open reports offers exactly these, and the panel starts idle.
      const radios = panelOf(page).getByRole('radio')
      await expect(radios).toHaveCount(4)
      await expect(actionRadio(page, 'resolve')).toBeChecked()
      await expect(actionRadio(page, 'release')).toHaveCount(0)
      await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'true')
      await expect(page.getByText('First decision')).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Prior actions' })).toContainText(
        'No prior actions'
      )

      const reason = 'No breach of the rules in this look.'
      await reasonBox(page).fill(reason)
      await expect(panelOf(page)).toContainText(
        `${reason.length} of 1000 characters, at least 3`
      )
      await expect(submitButton(page)).toHaveAttribute('aria-disabled', 'false')

      const reads = trackRequests(page, isCaseRead)
      // playwright-utils deviation: a passive watch on one real response, with no route in its way.
      const answered = page.waitForResponse((response) =>
        response.url().endsWith('/decisions')
      )
      await submitButton(page).click()
      const applied = moderationDecisionResponseSchema.parse(
        await (await answered).json()
      ).data
      expect(applied.replayed).toBe(false)
      // A resolve has no step after commit, so nothing can miss the bound.
      expect(applied.cacheInvalidation).toBe('completed')

      await expect(outcomeOf(page)).toHaveText('The reports are resolved.')
      await expect(outcomeOf(page)).toBeFocused()
      await expect(page.getByText(/First decision/)).toBeVisible()
      const prior = page.getByRole('region', { name: 'Prior actions' })
      await expect(prior).toContainText('Report resolved')
      await expect(prior).toContainText(reason)
      expect(reads, 'one reload after the outcome').toHaveLength(1)
      await expectNoFurtherRequest(page, isCaseRead, 'a second read of the case')

      // Only what a resolved case still allows stays on the panel, and the reason is cleared.
      await expect(actionRadio(page, 'resolve')).toHaveCount(0)
      await expect(reasonBox(page)).toHaveValue('')

      const rows = await decisionRows(prisma, seeded.caseId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'resolve',
        moderator_id: moderator.id,
        moderator_role: 'moderator',
        reason,
        is_terminal: true,
      })
      const reports = await prisma.communityPostReport.findMany({
        where: { post_id: seeded.postId },
      })
      expect(reports).toHaveLength(2)
      for (const report of reports)
        expect(report.resolved_at).toEqual(rows[0]!.decided_at)
      expect(
        (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: seeded.postId } }))
          .status
      ).toBe('published')
      const audit = await prisma.auditLog.findMany({
        where: { user_id: moderator.id, event_type: 'moderation_decision_applied' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0]!.event_data).toEqual({
        decisionId: rows[0]!.id,
        caseId: seeded.caseId,
        action: 'resolve',
        role: 'moderator',
      })

      // The case left the open queue. The list is left out at zero items, so an empty queue also answers.
      await page.getByRole('link', { name: 'Back to queue' }).click()
      await expect(page).toHaveURL(/\/moderation$/)
      await expect(list.or(page.getByText('No open cases.'))).toBeVisible()
      await expect(link).toHaveCount(0)
      // The page shows only the first page of a long queue, so the API proves the rest, and where the case went.
      expect(
        await queueCaseIds(apiRequest, testInfo, moderator.id, 'open')
      ).not.toContain(seeded.caseId)
      expect(
        await queueCaseIds(apiRequest, testInfo, moderator.id, 'resolved')
      ).toContain(seeded.caseId)
    })

    test('[P0] P-D-JOURNEY a release publishes a flagged post and a reader sees it', async ({
      page,
      apiRequest,
      prisma,
      fx,
      moderator,
    }, testInfo) => {
      const seeded = await fx.postCase({ status: 'flagged' })
      const reader = await fx.member('reader')
      expect(await feedIds(apiRequest, testInfo, reader.id)).not.toContain(seeded.postId)

      await signInAs(page, moderator.id)
      await openCase(page, seeded.caseId)
      await expect(actionRadio(page, 'release')).toBeVisible()
      await expect(actionRadio(page, 'takedown')).toHaveCount(0)
      const reason = 'The screener misread a satin fabric.'
      await decideInBrowser(page, 'release', reason)
      // A release has no confirmation step.
      await expect(outcomeOf(page)).toHaveText(
        'The content is published and the reports are resolved.'
      )
      await expect(page.getByText(/First decision/)).toBeVisible()
      const prior = page.getByRole('region', { name: 'Prior actions' })
      await expect(prior).toContainText('Released')
      await expect(prior).toContainText(reason)

      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: seeded.postId },
      })
      expect(post.status).toBe('published')
      expect(await decisionRows(prisma, seeded.caseId)).toHaveLength(1)
      expect(await feedIds(apiRequest, testInfo, reader.id)).toContain(seeded.postId)
    })

    test('[P0] P-D-JOURNEY a takedown confirms in the page, hides the post and shows the outcome', async ({
      page,
      apiRequest,
      prisma,
      fx,
      moderator,
    }, testInfo) => {
      const seeded = await fx.postCase()
      const reader = await fx.member('reader')
      expect(await feedIds(apiRequest, testInfo, reader.id)).toContain(seeded.postId)

      const dialogs: string[] = []
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message())
        void dialog.dismiss()
      })
      await signInAs(page, moderator.id)
      await openCase(page, seeded.caseId)
      const reason = 'The caption targets another member.'
      await fillDecision(page, 'takedown', reason)
      const posts = trackRequests(page, isDecisionPost)
      await submitButton(page).click()
      // The step sends nothing until the moderator says yes.
      await expect(
        panelOf(page).getByRole('group', { name: /Take this content down/ })
      ).toBeVisible()
      await expect(confirmButton(page)).toBeFocused()
      await expectNoDecisionSent(page, posts, prisma, seeded.caseId)

      await confirmButton(page).click()
      await expect(outcomeOf(page)).toHaveText(
        'The content is down and the reports are resolved.'
      )
      expect(posts, 'the yes sends the one decision').toHaveLength(1)
      await expect(page.getByText(/First decision/)).toBeVisible()
      const prior = page.getByRole('region', { name: 'Prior actions' })
      await expect(prior).toContainText('Taken down')
      await expect(prior).toContainText(reason)
      expect(dialogs).toEqual([])

      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: seeded.postId },
      })
      expect(post.status).toBe('flagged')
      expect(await decisionRows(prisma, seeded.caseId)).toHaveLength(1)
      expect(await feedIds(apiRequest, testInfo, reader.id)).not.toContain(seeded.postId)
    })
  })

  test.describe('P-D-CONFLICT', () => {
    /** Two moderators on one case: the first decides, and the second submits from a stale page. */
    async function staleSecondSubmit(
      args: Pick<Fixtures, 'openAs' | 'fx' | 'moderator'> & { page: Page },
      firstAction: ModerationDecisionAction,
      firstOutcome: string,
      secondAction: ModerationDecisionAction,
      reason: string
    ) {
      const { page, openAs, fx, moderator } = args
      const seeded = await fx.postCase()
      const second = await fx.operator()
      await signInAs(page, moderator.id)
      const other = await openAs(second.id, 'moderator')
      await openCase(page, seeded.caseId)
      await openCase(other, seeded.caseId)
      await decideInBrowser(page, firstAction, `First moderator: ${firstAction}.`)
      await expect(outcomeOf(page)).toHaveText(firstOutcome)
      await decideInBrowser(other, secondAction, reason)
      const alert = panelOf(other).getByRole('alert')
      await expect(alert).toContainText('This case changed since you opened it.')
      await expect(reasonBox(other), 'the reason survives the conflict').toHaveValue(
        reason
      )
      return { seeded, second, other, alert }
    }

    test(
      '[P0] P-D-CONFLICT a reload after the conflict fetches once and keeps the typed reason',
      { annotation: [{ type: 'skipNetworkMonitoring' }] },
      async ({ page, openAs, prisma, fx, moderator }) => {
        const reason = 'Typed by the second moderator, on a stale page.'
        const { seeded, other, alert } = await staleSecondSubmit(
          { page, openAs, fx, moderator },
          'resolve',
          'The reports are resolved.',
          'takedown',
          reason
        )
        expect(await decisionRows(prisma, seeded.caseId)).toHaveLength(1)

        // A conflict fetches nothing until the moderator asks, and then fetches once.
        const reads = trackRequests(other, isCaseRead)
        await expectNoFurtherRequest(
          other,
          isCaseRead,
          'a read before the moderator asks'
        )
        await alert.getByRole('button', { name: 'Reload case' }).click()
        await expect(other.getByText(/First decision/)).toBeVisible()
        expect(reads).toHaveLength(1)
        await expectNoFurtherRequest(other, isCaseRead, 'a second read of the case')
        await expect(alert).toHaveCount(0)
        await expect(reasonBox(other), 'the reason survives the reload').toHaveValue(
          reason
        )
      }
    )

    test(
      '[P0] P-D-CONFLICT after the reload a resubmit applies to the new state and the first decision time holds',
      { annotation: [{ type: 'skipNetworkMonitoring' }] },
      async ({ page, openAs, apiRequest, prisma, fx, moderator }, testInfo) => {
        const reason = 'Typed by the second moderator, on a stale page.'
        const { seeded, second, other, alert } = await staleSecondSubmit(
          { page, openAs, fx, moderator },
          'resolve',
          'The reports are resolved.',
          'takedown',
          reason
        )
        const [first] = await decisionRows(prisma, seeded.caseId)
        await alert.getByRole('button', { name: 'Reload case' }).click()
        await expect(other.getByText(/First decision/)).toBeVisible()

        // A resolved case can still be taken down, so the same intent now applies.
        await decideInBrowser(other, 'takedown', reason)
        await expect(outcomeOf(other)).toHaveText(
          'The content is down and the reports are resolved.'
        )
        const rows = await decisionRows(prisma, seeded.caseId)
        expect(rows.map((row) => [row.sequence, row.action])).toEqual([
          [1, 'resolve'],
          [2, 'takedown'],
        ])
        expect(rows[1]!.moderator_id).toBe(second.id)
        expect(rows[1]!.reason).toBe(reason)
        expect(first!.decided_at.getTime()).toBeLessThan(rows[1]!.decided_at.getTime())
        // The first effective decision stays the first one.
        const detail = await apiRequest<unknown>({
          method: 'GET',
          path: `/api/v1/moderation/cases/${seeded.caseId}`,
          baseUrl: resolveApiBaseUrl(testInfo),
          headers: authHeaders(second.id, 'moderator'),
        })
        expect(
          moderationCaseDetailResponseSchema.parse(detail.body).data.firstDecisionAt
        ).toBe(first!.decided_at.toISOString())
      }
    )

    test(
      '[P0] P-D-CONFLICT after a conflict the applied action is gone from the panel and the API answers action_not_applicable',
      { annotation: [{ type: 'skipNetworkMonitoring' }] },
      async ({ page, openAs, apiRequest, prisma, fx, moderator }, testInfo) => {
        const reason = 'A second takedown, on a stale page.'
        const { seeded, second, other, alert } = await staleSecondSubmit(
          { page, openAs, fx, moderator },
          'takedown',
          'The content is down and the reports are resolved.',
          'takedown',
          reason
        )
        await alert.getByRole('button', { name: 'Reload case' }).click()
        await expect(other.getByText(/First decision/)).toBeVisible()
        await expect(actionRadio(other, 'takedown')).toHaveCount(0)

        // The console no longer offers it. The same request at the new revision is refused by name.
        const response = await decideByApi(
          apiRequest,
          testInfo,
          { id: second.id, role: 'moderator' },
          seeded.caseId,
          { action: 'takedown', reason }
        )
        expect(response.status).toBe(409)
        const body = moderationDecisionErrorSchema.parse(response.body)
        expect(body.code).toBe('action_not_applicable')
        expect(body.detail).toBe('target_not_published')
        expect(await decisionRows(prisma, seeded.caseId)).toHaveLength(1)
      }
    )
  })

  test(
    '[P0] P-D-BAN-JOURNEY a seven-day ban closes the open community page, refuses engagement and leaves the wardrobe',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, openAs, apiRequest, prisma, fx, moderator, recurse }, testInfo) => {
      test.setTimeout(120_000)
      const baseUrl = resolveApiBaseUrl(testInfo)
      const seeded = await fx.postCase()
      const otherLook = await fx.post(seeded.author.id)
      const viewer = await fx.member('viewer')

      // The member's page is open, on a live socket, when the ban lands.
      await signInAs(page, seeded.author.id, 'guardian')
      const sockets: WebSocket[] = []
      const closed: string[] = []
      const ready: string[] = []
      // playwright-utils deviation: HTTP interceptNetworkCall cannot observe WebSocket frames.
      page.on('websocket', (socket) => {
        if (!socket.url().includes('/api/realtime')) return
        sockets.push(socket)
        socket.on('framereceived', ({ payload }) => {
          if (String(payload).startsWith('40/community')) ready.push(socket.url())
        })
        socket.on('close', () => closed.push(socket.url()))
      })
      await openCommunity(page, seeded.postId)
      await recurse(
        () => Promise.resolve(ready.length),
        (count) => count > 0,
        { timeout: REALTIME_WINDOW_MS, interval: 100 }
      )
      const openSockets = () => sockets.length - closed.length
      expect(openSockets()).toBeGreaterThan(0)
      await expect(noticeOf(page)).toHaveCount(0)

      const operator = await openAs(moderator.id, 'moderator')
      await openCase(operator, seeded.caseId)
      const reason = 'Repeated harassment after a warning.'
      await actionRadio(operator, 'ban').check()
      // A moderator sees temporary bans only, and seven days is the default.
      const panel = panelOf(operator)
      await expect(panel.getByRole('combobox', { name: 'Ban type' })).toHaveValue(
        'temporary'
      )
      await expect(
        panel.getByRole('combobox', { name: 'Ban type' }).getByRole('option')
      ).toHaveCount(1)
      await expect(panel.getByRole('combobox', { name: 'Duration' })).toHaveValue('7')
      await reasonBox(operator).fill(reason)
      await submitButton(operator).click()
      await expect(panel.getByText(/Ban this author for the chosen time/)).toBeVisible()
      await confirmButton(operator).click()
      await expect(outcomeOf(operator)).toContainText('The author is banned until')

      const standing = standingOf(operator)
      await expect(standing).toContainText('Active')
      await expect(standing).toContainText('Temporary')
      await expect(standing).toContainText('None recorded')

      const sanction = await prisma.communitySanction.findFirstOrThrow({
        where: { user_id: seeded.author.id },
      })
      expect(sanction.kind).toBe('temporary')
      const days =
        (sanction.expires_at!.getTime() - sanction.created_at.getTime()) / SEED_DAY_MS
      expect(days).toBeCloseTo(7, 5)

      // The open page closes with no reload: the socket is told at its next revalidation.
      await expect(noticeOf(page)).toBeVisible({ timeout: REALTIME_WINDOW_MS })
      await expect(noticeOf(page)).toContainText('Your community access is suspended')
      await expect(noticeOf(page)).toContainText('You can return after')
      await expect(noticeOf(page)).toContainText(
        'Your wardrobe, daily ritual, alerts and account settings are not affected.'
      )
      await expect(noticeOf(page)).toContainText('contact CoutureCast support')
      await expect(noticeOf(page).getByRole('button')).toHaveCount(0)
      await expect(noticeOf(page)).not.toContainText(reason)
      await expect(cardOf(page, seeded.postId)).toHaveCount(0)
      await recurse(
        // Wrapped: recurse treats a falsy result as no result, and zero is the answer here.
        () => Promise.resolve({ open: openSockets() }),
        ({ open }) => open === 0,
        { timeout: REALTIME_WINDOW_MS, interval: 100 }
      )

      // A fresh read lands on the same notice.
      await page.reload()
      await expect(noticeOf(page)).toBeVisible()
      await expect(
        page.getByTestId('community-card-grid').getByRole('article')
      ).toHaveCount(0)

      // The filters and the notifications link leave with the feed, and nothing reads it again.
      await expect(page.getByTestId('community-filter-all')).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: 'Community notifications' })
      ).toHaveCount(0)
      const feedReads = trackRequests(page, isFeedRead)
      await expectNoFurtherRequest(page, isFeedRead, 'a feed read on the closed page')
      expect(feedReads).toEqual([])
      await expect(noticeOf(page)).toBeVisible()

      // Comment and reaction fail with the member's own view of the ban.
      const headers = memberHeaders(seeded.author.id)
      const refusals = [
        await apiRequest<unknown>({
          method: 'POST',
          path: `/api/v1/community/posts/${otherLook.id}/comments`,
          baseUrl,
          headers,
          body: {
            mutationId: randomUUID(),
            body: 'A comment during a ban.',
            locale: 'en-US',
            parentId: null,
          },
          retryConfig: { maxRetries: 0 },
        }),
        await apiRequest<unknown>({
          method: 'PUT',
          path: `/api/v1/community/posts/${otherLook.id}/reaction`,
          baseUrl,
          headers,
          body: { selection: 'love', mutationId: randomUUID(), baseRevision: 0 },
          retryConfig: { maxRetries: 0 },
        }),
        await apiRequest<unknown>({
          method: 'GET',
          path: '/api/v1/community/feed?mode=all',
          baseUrl,
          headers,
        }),
      ]
      for (const refusal of refusals) {
        expect(refusal.status).toBe(403)
        const banned = communityBannedErrorSchema.parse(refusal.body)
        expect(banned.sanction).toEqual({
          kind: 'temporary',
          expiresAt: sanction.expires_at!.toISOString(),
          appealStatus: 'not_requested',
        })
        const text = JSON.stringify(refusal.body)
        expect(text).not.toContain(reason)
        expect(text).not.toContain(moderator.id)
        expect(text).not.toContain(seeded.caseId)
      }

      // Everything else stays open, because a ban closes the community and nothing more.
      // playwright-utils deviation: this page's earlier routes stay in place, so a passive watch is enough.
      const wardrobe = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === '/api/v1/wardrobe/garments'
      )
      await page.goto('/wardrobe')
      expect((await wardrobe).status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(noticeOf(page)).toHaveCount(0)

      // A second member no longer sees the post on the next read, and the author's other look stays.
      const ids = await feedIds(apiRequest, testInfo, viewer.id)
      expect(ids).not.toContain(seeded.postId)
      expect(ids).toContain(otherLook.id)
      const second = await openAs(viewer.id, 'guardian')
      await openCommunity(second, otherLook.id)
      await expect(cardOf(second, seeded.postId)).toHaveCount(0)
    }
  )

  test('[P1] P-D-TAKEDOWN-PUBLIC a second member loses the post from feed, spotlight and teaser on the next read', async ({
    openAs,
    apiRequest,
    prisma,
    fx,
    moderator,
    recurse,
  }, testInfo) => {
    test.setTimeout(90_000)
    // Six authors in a city of this run alone, so the cohort still holds after one post leaves it.
    const authors = []
    for (let index = 0; index < 6; index++) authors.push(await fx.member('cohort'))
    const area = {
      country: 'United States',
      region: `Region ${fx.runId}`,
      city: `City ${fx.runId}`,
    }
    const plan = planSpotlightCohort({
      namespace: fx.runId,
      seedTime: new Date(),
      area,
      authorIds: authors.map((author) => author.id),
      captionPrefix: `Spotlight ${fx.runId}`,
      imageObjectPath: await seededImagePath(prisma),
    })
    await persistSpotlightCohort(prisma, plan)
    const viewer = await fx.member('viewer')
    await prisma.savedLocation.create({
      data: buildSpotlightSavedLocationCreateInput(viewer.id, area),
    })
    const top = plan.expectedOrder[0]!
    await fx.report(top)
    const caseId = `post.${top}`

    // Before: the top look leads every public surface, so a read below that loses it means something.
    const spotlightBefore = await spotlightIds(apiRequest, testInfo, viewer.id)
    expect(spotlightBefore.level).toBe('city')
    expect(spotlightBefore.ids[0]).toBe(top)
    expect(
      (await spotlightIds(apiRequest, testInfo, viewer.id, 'home_teaser')).ids[0]
    ).toBe(top)
    // The plan publishes an hour back, below every newer look of a long-lived database, so walk the whole feed.
    expect(await feedIds(apiRequest, testInfo, viewer.id, WHOLE_FEED)).toContain(top)

    const response = await decideByApi(
      apiRequest,
      testInfo,
      { id: moderator.id, role: 'moderator' },
      caseId,
      { action: 'takedown', reason: 'Taken down in the public surfaces test.' }
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const applied = moderationDecisionResponseSchema.parse(response.body).data
    // The spotlight bump has a 1000 ms bound. Past it the answer is `deferred` and the decision stands.
    expect(['completed', 'deferred']).toContain(applied.cacheInvalidation)

    // The feed reads the post's status, so its next read holds on either answer.
    expect(await feedIds(apiRequest, testInfo, viewer.id, WHOLE_FEED)).not.toContain(top)

    const readSpotlight = async () => ({
      spotlight: await spotlightIds(apiRequest, testInfo, viewer.id),
      teaser: await spotlightIds(apiRequest, testInfo, viewer.id, 'home_teaser'),
    })
    // A completed bump owes the very next read, with no polling, so a worker catching up cannot pass for it.
    // Only a deferred bump leaves the cache to the worker, so only that answer may wait for it.
    const after =
      applied.cacheInvalidation === 'completed'
        ? await readSpotlight()
        : await recurse(
            readSpotlight,
            (read) => !read.spotlight.ids.includes(top) && !read.teaser.ids.includes(top),
            { timeout: 15_000, interval: 250 }
          )
    expect(after.spotlight.ids).not.toContain(top)
    expect(after.teaser.ids).not.toContain(top)
    expect(after.spotlight.level, 'the rest of the cohort still holds').toBe('city')
    expect(after.spotlight.ids[0]).toBe(plan.expectedOrder[1])
    expect(after.teaser.ids[0]).toBe(plan.expectedOrder[1])

    // The same in the viewer's browser on a narrow layout, where the teaser shows.
    const browserView = await openAs(viewer.id, 'guardian', {
      viewport: { width: 390, height: 844 },
    })
    await browserView.goto(COMMUNITY_URL)
    await expect(browserView.getByTestId('home-spotlight-teaser-link')).toBeVisible()
    await expect(browserView.getByTestId('home-spotlight-teaser-link')).not.toContainText(
      plan.posts[0]!.caption!
    )
    await expect(
      browserView.getByTestId(`community-spotlight-item-${plan.expectedOrder[1]!}`)
    ).toBeVisible()
    await expect(browserView.getByTestId(`community-spotlight-item-${top}`)).toHaveCount(
      0
    )
  })

  // Programmatic focus never shows a focus-visible ring, so every control is reached with real key presses.
  const expectVisibleFocus = async (target: Locator, label: string) => {
    await expect(target, label).toBeFocused()
    const ring = await target.evaluate((node) => ({
      visible: node.matches(':focus-visible'),
      style: getComputedStyle(node).outlineStyle,
      width: Number.parseFloat(getComputedStyle(node).outlineWidth),
    }))
    expect(ring.visible, `${label} matches focus-visible`).toBe(true)
    expect(ring.style, `${label} outline`).not.toBe('none')
    expect(ring.width, `${label} outline width`).toBeGreaterThanOrEqual(2)
  }

  /** Tabs from the top of the case to the submit, choosing a takedown and typing the reason on the way. */
  async function tabThroughPanel(page: Page, reason: string) {
    const firstAction = actionRadio(page, 'resolve')
    for (
      let step = 0;
      step < 60 &&
      !(await firstAction.evaluate((node) => node === document.activeElement));
      step++
    )
      await page.keyboard.press('Tab')
    await expectVisibleFocus(firstAction, 'first action')

    // Action: Tab lands on the checked radio and the arrow keys change it.
    await page.keyboard.press('ArrowDown')
    await expect(actionRadio(page, 'takedown')).toBeChecked()
    await expectVisibleFocus(actionRadio(page, 'takedown'), 'takedown action')

    // Reason: the next Tab goes to the reason, and the submit follows it.
    await page.keyboard.press('Tab')
    await expectVisibleFocus(reasonBox(page), 'reason')
    await page.keyboard.type(reason)
    await expect(reasonBox(page)).toHaveValue(reason)
    await page.keyboard.press('Tab')
    await expectVisibleFocus(submitButton(page), 'submit')
  }

  test('[P1] P-D-KEYBOARD a whole decision works by keyboard with focus visible at every step', async ({
    page,
    prisma,
    fx,
    moderator,
  }) => {
    const seeded = await fx.postCase()
    await signInAs(page, moderator.id)
    await openCase(page, seeded.caseId)
    await tabThroughPanel(page, 'Decided with a keyboard alone.')
    const posts = trackRequests(page, isDecisionPost)

    // Confirm: focus moves to Yes, and Enter applies.
    await page.keyboard.press('Enter')
    await expectVisibleFocus(confirmButton(page), 'confirm')
    await expectNoDecisionSent(page, posts, prisma, seeded.caseId)
    await page.keyboard.press('Enter')

    // Outcome: focus lands on the outcome with a ring, past the reload.
    await expect(outcomeOf(page)).toHaveText(
      'The content is down and the reports are resolved.'
    )
    await expectVisibleFocus(outcomeOf(page), 'outcome')
    expect(posts, 'the yes sends the one decision').toHaveLength(1)
    expect(await decisionRows(prisma, seeded.caseId)).toHaveLength(1)

    // The next Tab goes on from the outcome, so focus was never lost to the document.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  })

  test('[P1] P-D-KEYBOARD Cancel on the confirmation returns focus to the submit and sends nothing', async ({
    page,
    prisma,
    fx,
    moderator,
  }) => {
    const seeded = await fx.postCase()
    await signInAs(page, moderator.id)
    await openCase(page, seeded.caseId)
    const reason = 'Reconsidered with a keyboard alone.'
    await tabThroughPanel(page, reason)
    const posts = trackRequests(page, isDecisionPost)

    await page.keyboard.press('Enter')
    await expectVisibleFocus(confirmButton(page), 'confirm')
    await page.keyboard.press('Tab')
    const cancel = panelOf(page).getByRole('button', { name: 'Cancel' })
    await expectVisibleFocus(cancel, 'cancel')
    await page.keyboard.press('Enter')
    await expect(cancel).toHaveCount(0)
    await expectNoDecisionSent(page, posts, prisma, seeded.caseId)
    await expect(reasonBox(page)).toHaveValue(reason)
    await expectVisibleFocus(submitButton(page), 'submit after cancel')
  })

  test(
    '[P1] P-D-OFFLINE-RETRY a lost response retries as a replay, with one decision row and one announcement',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, prisma, fx, moderator, interceptNetworkCall }) => {
      const seeded = await fx.postCase()
      await signInAs(page, moderator.id)
      await openCase(page, seeded.caseId)
      const announcements = await watchAnnouncements(page)

      const mutationIds: string[] = []
      const replies: unknown[] = []
      void interceptNetworkCall({
        method: 'POST',
        url: `**/api/v1/moderation/cases/${seeded.caseId}/decisions`,
        handler: async (route, request) => {
          mutationIds.push((request.postDataJSON() as { mutationId: string }).mutationId)
          // The server commits, and the answer never reaches the page.
          const response = await route.fetch()
          replies.push(await response.json())
          if (replies.length === 1) await route.abort('internetdisconnected')
          else await route.fulfill({ response })
        },
      })

      const reason = 'The answer to this one gets lost.'
      await decideInBrowser(page, 'resolve', reason)
      const alert = panelOf(page).getByRole('alert')
      await expect(alert).toContainText('The decision may not have reached the server.')
      await expect(reasonBox(page)).toHaveValue(reason)
      await expect(outcomeOf(page)).toBeEmpty()
      const rows = await decisionRows(prisma, seeded.caseId)
      expect(rows, 'the first attempt committed').toHaveLength(1)

      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(outcomeOf(page)).toHaveText('The reports are resolved.')
      await expect(page.getByText(/First decision/)).toBeVisible()
      await expect(reasonBox(page)).toHaveValue('')

      expect(mutationIds).toHaveLength(2)
      expect(mutationIds[1]).toBe(mutationIds[0])
      const [first, second] = replies.map(
        (reply) => moderationDecisionResponseSchema.parse(reply).data
      )
      expect(first!.replayed).toBe(false)
      expect(second!.replayed).toBe(true)
      expect(second!.decisionId).toBe(first!.decisionId)
      expect(second!.firstDecisionAt).toBe(first!.firstDecisionAt)

      const after = await decisionRows(prisma, seeded.caseId)
      expect(after).toHaveLength(1)
      expect(after[0]!.decided_at).toEqual(rows[0]!.decided_at)
      expect(
        await prisma.auditLog.count({
          where: { user_id: moderator.id, event_type: 'moderation_decision_applied' },
        })
      ).toBe(1)
      expect(await announcements()).toEqual(['The reports are resolved.'])
    }
  )

  test('[P1] P-D-APPEAL a moderator records the appeal, an admin overturns it and the community page returns', async ({
    openAs,
    apiRequest,
    prisma,
    fx,
    moderator,
  }, testInfo) => {
    test.setTimeout(90_000)
    const seeded = await fx.postCase()
    const otherLook = await fx.post(seeded.author.id)
    const admin = await fx.operator()
    const response = await decideByApi(
      apiRequest,
      testInfo,
      { id: moderator.id, role: 'moderator' },
      seeded.caseId,
      {
        action: 'ban',
        reason: 'Banned ahead of the appeal test.',
        ban: { kind: 'temporary', durationDays: 7 },
      }
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)

    const member = await openAs(seeded.author.id, 'guardian')
    await member.goto(COMMUNITY_URL)
    await expect(noticeOf(member)).toContainText('contact CoutureCast support')

    // A moderator records the request and is offered no outcome.
    const operator = await openAs(moderator.id, 'moderator')
    await openCase(operator, seeded.caseId)
    const standing = standingOf(operator)
    await expect(standing).toContainText('None recorded')
    await expect(standing.getByRole('button', { name: 'Uphold the ban' })).toHaveCount(0)
    await expect(standing.getByRole('button', { name: 'Overturn the ban' })).toHaveCount(
      0
    )
    const note = standing.getByRole('textbox', { name: 'Appeal note (required)' })
    await note.fill('The member wrote to support.')
    const record = standing.getByRole('button', { name: 'Record an appeal' })
    await expect(record).toHaveAttribute('aria-disabled', 'false')
    await record.click()
    await expect(outcomeOf(operator)).toHaveText('The appeal is recorded.')
    await expect(standing).toContainText('Waiting for a decision')
    await expect(standing.getByRole('button')).toHaveCount(0)
    await member.reload()
    await expect(noticeOf(member)).toContainText(
      'Your request for a review has been recorded and is waiting for a decision.'
    )

    // An admin overturns it from their own session.
    const adminPage = await openAs(admin.id, 'admin')
    await openCase(adminPage, seeded.caseId)
    const adminStanding = standingOf(adminPage)
    await expect(adminStanding).toContainText('Waiting for a decision')
    await adminStanding
      .getByRole('textbox', { name: 'Appeal note (required)' })
      .fill('The evidence does not hold.')
    await adminStanding.getByRole('button', { name: 'Overturn the ban' }).click()
    await expect(outcomeOf(adminPage)).toContainText('The ban is lifted.')
    await expect(adminStanding).toContainText('Ended')
    await expect(adminStanding).toContainText('Ban overturned')
    await expect(adminStanding.getByRole('button')).toHaveCount(0)

    const sanction = await prisma.communitySanction.findFirstOrThrow({
      where: { user_id: seeded.author.id },
    })
    expect(sanction.appeal_status).toBe('overturned')
    expect(sanction.lifted_at).not.toBeNull()
    expect((await decisionRows(prisma, seeded.caseId)).map((row) => row.action)).toEqual([
      'ban',
      'appeal_requested',
      'appeal_overturned',
    ])

    // The member's community page returns on reload, and the taken-down target stays down.
    await openCommunity(member, otherLook.id)
    await expect(noticeOf(member)).toHaveCount(0)
    await expect(cardOf(member, seeded.postId)).toHaveCount(0)
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(post.status).toBe('flagged')
  })

  /**
   * Walks one moderator through every panel state and stops at each one for `visit`.
   * P-D-AXE and P-D-THEMES-WIDTHS share it, so they cover the same states.
   */
  async function walkStates(
    args: Pick<Fixtures, 'openAs' | 'fx'> & { moderatorId: string },
    options: BrowserContextOptions,
    visit: (state: string, view: Page) => Promise<void>
  ) {
    const { openAs, fx, moderatorId } = args
    const seeded = await fx.postCase()
    const view = await openAs(moderatorId, 'moderator', options)
    await openCase(view, seeded.caseId)
    await visit('panel-idle', view)

    await fillDecision(view, 'takedown', 'A reason for the states walk.')
    await submitButton(view).click()
    await expect(confirmButton(view)).toBeVisible()
    await visit('panel-confirm', view)

    // A new report lands while the confirmation is up, which moves the revision.
    await fx.report(seeded.postId)
    await confirmButton(view).click()
    const alert = panelOf(view).getByRole('alert')
    await expect(alert).toContainText('This case changed since you opened it.')
    await visit('panel-conflict', view)

    await alert.getByRole('button', { name: 'Reload case' }).click()
    await expect(alert).toHaveCount(0)
    await expect(
      view.getByRole('region', { name: 'Reporters' }).getByRole('listitem')
    ).toHaveCount(2)
    await fillDecision(view, 'takedown', 'A reason for the states walk.')
    await submitButton(view).click()
    await confirmButton(view).click()
    await expect(outcomeOf(view)).toHaveText(
      'The content is down and the reports are resolved.'
    )
    await visit('panel-applied', view)

    await fillDecision(view, 'ban', 'A ban for the states walk.')
    await expect(panelOf(view).getByRole('combobox', { name: 'Duration' })).toBeVisible()
    await visit('panel-ban-options', view)
    await submitButton(view).click()
    await confirmButton(view).click()
    await expect(outcomeOf(view)).toContainText('The author is banned until')
    await expect(
      standingOf(view).getByRole('button', { name: 'Record an appeal' })
    ).toBeVisible()
    await visit('standing', view)

    const member = await openAs(seeded.author.id, 'guardian', options)
    await member.goto(COMMUNITY_URL)
    await expect(noticeOf(member)).toBeVisible()
    await visit('banned-notice', member)
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [375, 1280]) {
      const options: BrowserContextOptions = {
        colorScheme,
        viewport: { width, height: 900 },
      }

      test(`[P0] P-D-AXE every panel state, the standing and the banned notice pass axe, ${colorScheme} at ${width}`, async ({
        openAs,
        fx,
        moderator,
      }) => {
        test.setTimeout(180_000)
        const visited: string[] = []
        await walkStates(
          { openAs, fx, moderatorId: moderator.id },
          options,
          async (state, view) => {
            visited.push(state)
            await checkA11y(view, { includeTags: AXE_TAGS })
          }
        )
        expect(visited).toEqual([
          'panel-idle',
          'panel-confirm',
          'panel-conflict',
          'panel-applied',
          'panel-ban-options',
          'standing',
          'banned-notice',
        ])
      })

      test(`[P1] P-D-THEMES-WIDTHS the panel and the notice fit with 44 pixel targets, ${colorScheme} at ${width}`, async ({
        openAs,
        fx,
        moderator,
      }) => {
        test.setTimeout(180_000)
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        await walkStates(
          { openAs, fx, moderatorId: moderator.id },
          options,
          async (state, view) => {
            const label = `${state} ${colorScheme} ${width}`
            expect(await horizontalOverflow(view), label).toBeLessThanOrEqual(0)
            if (state === 'banned-notice') {
              expect(await overflowingElement(noticeOf(view)), label).toBeNull()
            } else if (state === 'standing') {
              // A banned author's case has nothing left to decide, so the standing is the only form here.
              expect(await overflowingElement(standingOf(view)), label).toBeNull()
              await expectTargetsAt44(standingOf(view), `${label} standing`)
            } else {
              expect(await overflowingElement(panelOf(view)), label).toBeNull()
              await expectTargetsAt44(panelOf(view), `${label} panel`)
            }
            await view.screenshot({
              path: path.join(SCREENSHOT_DIR, `${state}-${colorScheme}-${width}.png`),
              fullPage: true,
            })
          }
        )
      })
    }
  }

  /** The strings one locale must show, read from the shipped catalog so a missing key cannot pass. */
  function catalog(locale: string) {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8')
    ) as {
      moderation: {
        decision: {
          title: string
          action: Record<string, string>
          reason: string
          submit: string
          confirmYes: string
          confirm: Record<string, string>
          outcome: Record<string, string>
        }
        standing: {
          title: string
          appeal: Record<string, string>
          step: Record<string, string>
          kind: Record<string, string>
        }
      }
      community: {
        banned: { title: string; scope: string; appeal: Record<string, string> }
      }
    }
    return parsed
  }

  /** A raw key or enum that reached the screen. A word in the catalog itself never matches these. */
  const RAW_TEXT =
    /\b(moderation|community)\.[a-zA-Z]+|\b(not_requested|takedown|ban_temporary|ban_permanent|allowedActions|temporary|permanent|escalate|resolve|release)\b/

  // de-DE holds the longest decision, standing and notice strings of the ten catalogs.
  for (const locale of ['es-419', 'de-DE']) {
    test(`[P2] P-D-LOCALE ${locale} renders the panel, the standing and the notice with no overflow and no raw enum`, async ({
      openAs,
      apiRequest,
      fx,
      moderator,
    }, testInfo) => {
      test.setTimeout(120_000)
      const strings = catalog(locale)
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
      const open = await fx.postCase()
      const banned = await fx.postCase()
      const response = await decideByApi(
        apiRequest,
        testInfo,
        { id: moderator.id, role: 'moderator' },
        banned.caseId,
        {
          action: 'ban',
          reason: 'Banned ahead of the locale test.',
          ban: { kind: 'temporary', durationDays: 7 },
        }
      )
      expect(response.status, JSON.stringify(response.body)).toBe(200)

      for (const width of [375, 1280]) {
        const options = { locale, viewport: { width, height: 900 } }
        const view = await openAs(moderator.id, 'moderator', options)

        await view.goto(caseUrl(open.caseId))
        const panel = view.getByRole('region', {
          name: strings.moderation.decision.title,
        })
        await expect(panel).toBeVisible()
        for (const action of ['resolve', 'takedown', 'escalate', 'ban'])
          await expect(panel).toContainText(strings.moderation.decision.action[action]!)
        await panel
          .getByRole('radio', {
            name: new RegExp(`^${strings.moderation.decision.action.ban!}`),
          })
          .check()
        await panel
          .getByRole('textbox', { name: strings.moderation.decision.reason })
          .fill('Locale check.')
        await panel
          .getByRole('button', { name: strings.moderation.decision.submit })
          .click()
        await expect(panel).toContainText(
          strings.moderation.decision.confirm.ban_temporary!
        )
        await expect(
          panel.getByRole('button', { name: strings.moderation.decision.confirmYes })
        ).toBeVisible()
        expect(
          await horizontalOverflow(view),
          `${locale} ${width} panel`
        ).toBeLessThanOrEqual(0)
        expect(await overflowingElement(panel), `${locale} ${width} panel`).toBeNull()
        expect(await panel.innerText()).not.toMatch(RAW_TEXT)
        await view.screenshot({
          path: path.join(SCREENSHOT_DIR, `locale-${locale}-panel-${width}.png`),
          fullPage: true,
        })

        await view.goto(caseUrl(banned.caseId))
        const standing = view.getByRole('region', {
          name: strings.moderation.standing.title,
        })
        await expect(standing).toContainText(strings.moderation.standing.kind.temporary!)
        await expect(standing).toContainText(
          strings.moderation.standing.appeal.not_requested!
        )
        await expect(standing).toContainText(strings.moderation.standing.step.requested!)
        expect(
          await horizontalOverflow(view),
          `${locale} ${width} standing`
        ).toBeLessThanOrEqual(0)
        expect(
          await overflowingElement(standing),
          `${locale} ${width} standing`
        ).toBeNull()
        expect(await standing.innerText()).not.toMatch(RAW_TEXT)
        await view.screenshot({
          path: path.join(SCREENSHOT_DIR, `locale-${locale}-standing-${width}.png`),
          fullPage: true,
        })

        const member = await openAs(banned.author.id, 'guardian', options)
        await member.goto(COMMUNITY_URL)
        const notice = noticeOf(member)
        await expect(notice).toContainText(strings.community.banned.title)
        await expect(notice).toContainText(strings.community.banned.scope)
        await expect(notice).toContainText(strings.community.banned.appeal.not_requested!)
        expect(
          await horizontalOverflow(member),
          `${locale} ${width} notice`
        ).toBeLessThanOrEqual(0)
        expect(await overflowingElement(notice), `${locale} ${width} notice`).toBeNull()
        expect(await notice.innerText()).not.toMatch(RAW_TEXT)
        await member.screenshot({
          path: path.join(SCREENSHOT_DIR, `locale-${locale}-notice-${width}.png`),
          fullPage: true,
        })
      }
    })
  }
})
