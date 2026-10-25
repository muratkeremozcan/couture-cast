import { randomInt, randomUUID } from 'node:crypto'
import { mergeTests, type Locator, type Page, type Request } from '@playwright/test'
import type {
  ApiRequestParams,
  ApiRequestResponse,
} from '@seontechnologies/playwright-utils/api-request'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  communityCommentSubmissionResponseSchema,
  communityCommentSubmissionsResponseSchema,
  communityCommentsResponseSchema,
  communitySponsoredFeedResponseSchema,
  guardianConsentRevokeResponseSchema,
  reportCommunityCommentResponseSchema,
  type CommunityComment,
  type CommunityCommentSubmission,
} from '@couture/api-client/contracts/http'
import { checkA11y, contrastRatio } from '../support/helpers/accessibility'
import { authHeaders } from '../support/helpers/api-test'
import {
  completedCommunityFeed,
  communityApiTest,
  communityTest,
  expect,
} from '../support/helpers/community-session'
import {
  cleanupGuardianConsentTestData,
  createAcceptedGuardianConsent,
  type GuardianConsentCleanupTarget,
} from '../support/helpers/guardian-consent'

/*
 * `communityTest` signs the browser in; `communityApiTest` adds a second,
 * independently cleaned account. Only the report journey destructures
 * `communityApi`, and fixtures are lazy, so every other test still runs with one
 * account.
 */
const test = mergeTests(communityTest, communityApiTest)

const POST_ID = 'lookbook-5'
const COMMENTS_PATH = `/api/v1/community/posts/${POST_ID}/comments`
const SUBMISSIONS_PATH = `/api/v1/community/posts/${POST_ID}/comment-submissions`
const CREATE_URL = `**${COMMENTS_PATH}`
const ROOTS_URL = `**${COMMENTS_PATH}*`
const SUBMISSIONS_URL = `**${SUBMISSIONS_PATH}*`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PRIVATE_REGION = 'Your submissions. Only you can see these.'
const RECOVERY_COPY = 'Delete this submission and try again with a new comment.'
const FIVE_MINUTES_MS = 5 * 60 * 1000
// WCAG 2.2 SC 1.4.11 non-text contrast minimum for focus indicators.
const MIN_FOCUS_CONTRAST = 3

/*
 * Digits only, on purpose. The screener compares whole tokens and folds any token
 * holding a digit into leet classes, so a hex UUID fragment could in principle
 * spell a listed term. A ten-digit token never did across 3000 random draws for
 * every prefix this file uses (checked against `CommunityTextScreener` on
 * 2026-10-19), and it keeps each run's text distinct on the shared seeded post.
 */
function runToken(): string {
  return String(randomInt(1_000_000_000, 10_000_000_000))
}

/** The accessible-name contract at `community-comments.tsx:67-72`. */
function itemContext(item: Pick<CommunityComment, 'author' | 'body' | 'unavailable'>) {
  return [item.author, item.unavailable ? 'Unavailable.' : item.body]
    .filter(Boolean)
    .join('. ')
}

type Utilities = {
  apiRequest: <T>(
    options: Omit<ApiRequestParams, 'request'>
  ) => Promise<ApiRequestResponse<T>>
  recurse: <T>(
    command: () => Promise<T>,
    predicate: (value: T) => boolean,
    options?: Record<string, unknown>
  ) => Promise<T>
}

type Account = { apiBaseUrl: string; headers: Record<string, string> }

function sessionAccount(session: { accessToken: string; apiBaseUrl: string }): Account {
  return {
    apiBaseUrl: session.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'x-couture-platform': 'web',
    },
  }
}

async function createComment(
  { apiRequest }: Pick<Utilities, 'apiRequest'>,
  account: Account,
  body: string,
  parentId: string | null = null
): Promise<CommunityCommentSubmission> {
  const created = await apiRequest<unknown>({
    method: 'POST',
    path: COMMENTS_PATH,
    baseUrl: account.apiBaseUrl,
    headers: account.headers,
    body: { mutationId: randomUUID(), body, locale: 'en-US', parentId },
  })
  expect(created.status).toBe(200)
  const submission = communityCommentSubmissionResponseSchema.parse(created.body).data
  expect(submission.status).toBe('pending_screening')
  return submission
}

/**
 * Waits on the real standalone worker through the author's private status list,
 * which is newest first and holds only this run's fresh account, so the id is
 * always on the first page. Returns the first status past `pending_screening`;
 * callers assert the exact disposition.
 */
async function settledSubmission(
  { apiRequest, recurse }: Utilities,
  account: Account,
  id: string
): Promise<CommunityCommentSubmission> {
  const response = await recurse(
    () =>
      apiRequest<unknown>({
        method: 'GET',
        path: SUBMISSIONS_PATH,
        baseUrl: account.apiBaseUrl,
        headers: account.headers,
      }),
    (current) =>
      current.status === 200 &&
      communityCommentSubmissionsResponseSchema
        .parse(current.body)
        .data.items.some((item) => item.id === id && item.status !== 'pending_screening'),
    {
      timeout: 20_000,
      interval: 300,
      log: `Waiting for comment ${id} to leave screening`,
    }
  )
  const items = communityCommentSubmissionsResponseSchema.parse(response.body).data.items
  expect(items.map((item) => item.id)).toContain(id)
  return items.find((item) => item.id === id)!
}

/**
 * The thread's failure alert is transient by design: any refresh that succeeds
 * clears it, and realtime can deliver one within the same second as the
 * failure. Records every alert text the thread shows, for `expect.poll`.
 */
async function recordThreadAlerts(thread: Locator): Promise<() => Promise<string[]>> {
  const key = `__threadAlerts${Math.random().toString(36).slice(2)}`
  await thread.evaluate((element, name) => {
    const seen: string[] = []
    Object.assign(window, { [name]: seen })
    new MutationObserver(() =>
      element
        .querySelectorAll('[role="alert"]')
        .forEach((alert) => seen.push(alert.textContent ?? ''))
    ).observe(element, { childList: true, subtree: true, characterData: true })
  }, key)
  return () =>
    thread
      .page()
      .evaluate(
        (name) => (window as unknown as Record<string, string[]>)[name] ?? [],
        key
      )
}

/**
 * Thread reads (roots and status submissions) still in flight on each page.
 *
 * A thread that mounts while a status read for its post is in flight joins that
 * read instead of sending another (`CommunityCommentsState.statuses`), and the
 * read a closed thread started is not cancelled. So a Comments reopen right
 * after the look's own thread, or a Refresh during a read, can legitimately
 * send no status request at all, and an observer registered for one waits for a
 * request that never comes. Every reopen and refresh below waits for these to
 * settle first, so the reads it observes are the ones it caused.
 */
const threadReadsInFlight = new WeakMap<Page, Set<Request>>()

function isThreadRead(request: Request): boolean {
  const { pathname } = new URL(request.url())
  return (
    request.method() === 'GET' &&
    (pathname === COMMENTS_PATH || pathname === SUBMISSIONS_PATH)
  )
}

function trackThreadReads(page: Page) {
  if (threadReadsInFlight.has(page)) return
  const inFlight = new Set<Request>()
  threadReadsInFlight.set(page, inFlight)
  page.on('request', (request) => {
    if (isThreadRead(request)) inFlight.add(request)
  })
  const settle = (request: Request) => inFlight.delete(request)
  page.on('requestfinished', settle)
  page.on('requestfailed', settle)
}

async function threadReadsSettled(page: Page) {
  await expect
    .poll(() => threadReadsInFlight.get(page)?.size ?? 0, {
      message: 'thread reads still in flight',
    })
    .toBe(0)
}

/** Network-first: every read the journey waits on is registered before it fires. */
async function openThread(page: Page, interceptNetworkCall: InterceptNetworkCallFn) {
  trackThreadReads(page)
  const grid = page.getByTestId('community-card-grid')
  const initialFeed = completedCommunityFeed(page)
  await page.goto('/')
  expect((await initialFeed).status).toBe(200)
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  const allFeed = completedCommunityFeed(page, 'all')
  await page.getByTestId('community-filter-all').click()
  const acceptedFeed = await allFeed
  expect(acceptedFeed.status).toBe(200)
  // The web client opts every feed read in to reactions and sponsorship, so the
  // response it rendered is parsed with the variant those headers select.
  const { experimentVariant } = communitySponsoredFeedResponseSchema.parse(
    acceptedFeed.responseJson
  ).data
  await expect(grid).toHaveAttribute('aria-busy', 'false')

  const opener = page.getByTestId(`comments-button-${POST_ID}`)
  const initial = await reopenThread(opener, interceptNetworkCall)
  return {
    opener,
    thread: page.getByTestId('community-comments'),
    initial,
    experimentVariant,
  }
}

async function reopenThread(
  opener: ReturnType<Page['getByTestId']>,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  await threadReadsSettled(opener.page())
  const rootsRead = interceptNetworkCall({ method: 'GET', url: ROOTS_URL })
  const submissionsRead = interceptNetworkCall({ method: 'GET', url: SUBMISSIONS_URL })
  await opener.click()
  return readThread(rootsRead, submissionsRead)
}

async function refreshThread(
  thread: ReturnType<Page['getByTestId']>,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  await threadReadsSettled(thread.page())
  const rootsRead = interceptNetworkCall({ method: 'GET', url: ROOTS_URL })
  const submissionsRead = interceptNetworkCall({ method: 'GET', url: SUBMISSIONS_URL })
  await thread.getByRole('button', { name: 'Refresh', exact: true }).click()
  return readThread(rootsRead, submissionsRead)
}

async function readThread(
  rootsRead: ReturnType<InterceptNetworkCallFn>,
  submissionsRead: ReturnType<InterceptNetworkCallFn>
) {
  const [roots, submissions] = await Promise.all([rootsRead, submissionsRead])
  expect(roots.status).toBe(200)
  expect(submissions.status).toBe(200)
  return {
    roots: communityCommentsResponseSchema.parse(roots.responseJson).data,
    submissions: communityCommentSubmissionsResponseSchema.parse(submissions.responseJson)
      .data,
  }
}

/**
 * Roots are served oldest first, so a comment that is not on the first page means
 * earlier runs left public rows on the shared seeded post. Failing here names
 * that cause instead of a missing locator.
 */
function rootOnFirstPage(page: { items: CommunityComment[] }, id: string) {
  expect(
    page.items.map((item) => item.id),
    `${POST_ID} has more than one page of public roots; an earlier run leaked comments`
  ).toContain(id)
  return page.items.find((item) => item.id === id)!
}

test.describe('Story 6.4 screened threaded comments', () => {
  /*
   * Guardian and teen accounts are removed in afterAll on purpose. A comment's
   * `user_id` is `onDelete: SetNull`, so deleting the teen in afterEach (which
   * runs BEFORE fixture teardown) would orphan the suppressed comment and the
   * `trackUser` teardown, which selects rows by `user_id`, would miss it, leaving
   * an "Unavailable." placeholder on the shared post forever. Test-scoped fixture
   * teardown always completes before afterAll, so the comment rows go first.
   */
  let guardianTargets: GuardianConsentCleanupTarget[] = []
  test.afterAll(async () => {
    await cleanupGuardianConsentTestData(guardianTargets)
    guardianTargets = []
  })

  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('[P1] opens comments without recording a card open and records regular look opens', async ({
    page,
    communitySession,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    // CI timing, made deterministic: every status read answers 1.5 s late, so
    // the look's own thread read is still in flight when Comments reopens. The
    // reopen must wait for it (see `threadReadsInFlight`).
    await page.route(`**${SUBMISSIONS_PATH}*`, async (route) => {
      const response = await route.fetch()
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fulfill({ response })
    })
    const openedPath = `/api/v1/community/posts/${POST_ID}/opened`
    const measurements: unknown[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === openedPath) {
        measurements.push(request.postDataJSON())
      }
    })

    await log.step('Comments opens its thread without producing a card-open request')
    const { opener, thread, experimentVariant } = await openThread(
      page,
      interceptNetworkCall
    )
    await expect(thread.getByRole('heading', { name: 'Comments' })).toBeFocused()
    await expect(thread.getByLabel('Add a comment')).toBeVisible()
    // Both real thread reads have completed after the click handler. Capture all
    // requests so server-side event deduplication cannot hide an extra producer.
    expect(measurements).toEqual([])

    await thread.getByRole('button', { name: 'Close this look', exact: true }).click()
    await expect(thread).toHaveCount(0)
    await expect(opener).toBeFocused()

    await log.step('A regular look open still records the arm served by the real feed')
    const openedCall = interceptNetworkCall({ method: 'POST', url: `**${openedPath}` })
    await page.getByTestId(`lookbook-open-${POST_ID}`).click()
    const opened = await openedCall
    expect(opened.status).toBe(200)
    expect(opened.requestJson).toEqual({ experimentVariant })
    expect(opened.responseJson).toEqual({ tracked: true })
    await expect(page.getByTestId('community-detail')).toBeVisible()
    expect(measurements).toEqual([{ experimentVariant }])

    await page.getByRole('dialog').getByLabel('Close this look', { exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await reopenThread(opener, interceptNetworkCall)
    await expect(thread.getByRole('heading', { name: 'Comments' })).toBeFocused()
    expect(measurements).toEqual([{ experimentVariant }])
  })

  test('[P0] keeps a draft across close and reopen, then publishes it through the worker', async ({
    page,
    communitySession,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const account = sessionAccount(communitySession)
    const draft = `Layers for the wind ${runToken()}`

    await log.step('Open the thread from the card and keep a draft across close')
    const { opener, thread } = await openThread(page, interceptNetworkCall)
    await expect(thread.getByRole('heading', { name: 'Comments' })).toBeFocused()
    await thread.getByLabel('Add a comment').fill(draft)
    // The dialog header and the thread each render a close control with this name.
    await expect(
      page.getByRole('button', { name: 'Close this look', exact: true })
    ).toHaveCount(2)
    await thread.getByRole('button', { name: 'Close this look', exact: true }).click()
    await expect(thread).toHaveCount(0)
    await expect(opener).toBeFocused()
    await reopenThread(opener, interceptNetworkCall)
    await expect(thread.getByLabel('Add a comment')).toHaveValue(draft)

    await log.step('Submit the draft for screening')
    const createCall = interceptNetworkCall({ method: 'POST', url: CREATE_URL })
    await thread.getByRole('button', { name: 'Send comment', exact: true }).click()
    const created = await createCall
    expect(created.status).toBe(200)
    expect(created.requestJson).toEqual({
      mutationId: expect.stringMatching(UUID),
      body: draft,
      locale: 'en-US',
      parentId: null,
    })
    const submission = communityCommentSubmissionResponseSchema.parse(
      created.responseJson
    ).data
    expect(submission).toMatchObject({
      body: draft,
      parentId: null,
      status: 'pending_screening',
    })
    await expect(thread.getByText('Comment submitted for screening.')).toBeAttached()
    await expect(thread.getByRole('region', { name: PRIVATE_REGION })).toBeFocused()
    await expect(thread.getByLabel('Add a comment')).toHaveValue('')
    await expect(thread.getByTestId(`comment-submission-${submission.id}`)).toContainText(
      draft
    )

    await log.step('Wait for the real worker, then refresh the public thread')
    const settled = await settledSubmission(
      { apiRequest, recurse },
      account,
      submission.id
    )
    expect(settled.status).toBe('published')
    const { roots } = await refreshThread(thread, interceptNetworkCall)
    const root = rootOnFirstPage(roots, submission.id)
    expect(root).toMatchObject({ body: draft, isOwn: true, unavailable: false })
    await expect(thread.getByTestId(`comment-${submission.id}`)).toContainText(draft)
    await expect(thread.getByTestId(`comment-submission-${submission.id}`)).toHaveCount(0)
  })

  test('[P0] threads a reply under a root and keeps it when the root becomes a tombstone', async ({
    page,
    communitySession,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const account = sessionAccount(communitySession)
    const token = runToken()
    const rootBody = `Linen over wool ${token}`
    const replyBody = `A matching scarf ${token}`

    await log.step('Seed a published root as the signed-in member')
    const seeded = await createComment({ apiRequest }, account, rootBody)
    expect(
      (await settledSubmission({ apiRequest, recurse }, account, seeded.id)).status
    ).toBe('published')

    const { thread, initial } = await openThread(page, interceptNetworkCall)
    const root = rootOnFirstPage(initial.roots, seeded.id)
    const context = itemContext(root)
    const entry = thread.getByTestId(`comment-${root.id}`)
    await expect(entry.getByRole('button', { name: `Report: ${context}` })).toBeDisabled()

    await log.step('Reply through the contextual Reply control')
    await entry.getByRole('button', { name: `Reply: ${context}`, exact: true }).click()
    await expect(thread.getByLabel('Add a comment')).toBeFocused()
    await expect(thread.getByText(`Replying to a comment: ${context}`)).toBeVisible()
    await thread.getByLabel('Add a comment').fill(replyBody)
    const createCall = interceptNetworkCall({ method: 'POST', url: CREATE_URL })
    await thread.getByRole('button', { name: 'Send comment', exact: true }).click()
    const created = await createCall
    expect(created.status).toBe(200)
    expect(created.requestJson).toMatchObject({ body: replyBody, parentId: root.id })
    const reply = communityCommentSubmissionResponseSchema.parse(
      created.responseJson
    ).data
    expect(
      (await settledSubmission({ apiRequest, recurse }, account, reply.id)).status
    ).toBe('published')

    await log.step('Expand the replies after a refresh')
    const refreshed = await refreshThread(thread, interceptNetworkCall)
    expect(rootOnFirstPage(refreshed.roots, root.id).replyCount).toBe(1)
    const expand = entry.getByRole('button', {
      name: `Replies (1): ${context}`,
      exact: true,
    })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    const repliesRead = interceptNetworkCall({
      method: 'GET',
      url: `**${COMMENTS_PATH}/${root.id}/replies*`,
    })
    await expand.click()
    const replies = await repliesRead
    expect(replies.status).toBe(200)
    expect(
      communityCommentsResponseSchema
        .parse(replies.responseJson)
        .data.items.map((item) => item.id)
    ).toEqual([reply.id])
    await expect(expand).toHaveAttribute('aria-expanded', 'true')
    await expect(thread.getByTestId(`comment-${reply.id}`)).toContainText(replyBody)

    await log.step('Delete the root and keep the reply under its tombstone')
    const deleteCall = interceptNetworkCall({
      method: 'DELETE',
      url: `**${COMMENTS_PATH}/${root.id}`,
    })
    await entry.getByRole('button', { name: `Delete: ${context}`, exact: true }).click()
    const deleted = await deleteCall
    expect(deleted.status).toBe(200)
    expect(
      communityCommentSubmissionResponseSchema.parse(deleted.responseJson).data
    ).toMatchObject({ id: root.id, status: 'author_deleted', body: null })
    await expect(thread.getByText('Comment deleted.')).toBeAttached()
    await expect(thread.getByRole('region', { name: PRIVATE_REGION })).toBeFocused()
    await expect(entry.getByText('Unavailable.', { exact: true })).toBeVisible()
    await expect(entry.getByText(rootBody)).toHaveCount(0)
    await expect(entry.getByRole('button', { name: /^Reply:/ })).toHaveCount(0)
    await expect(thread.getByTestId(`comment-${reply.id}`)).toContainText(replyBody)
    await checkA11y(page)
  })

  test('[P1] keeps the thread reachable, focus-visible and contrasted in dark scheme and at phone width', async ({
    page,
    communitySession,
    interceptNetworkCall,
  }, testInfo) => {
    expect(communitySession.userId).toBeTruthy()
    const { opener, thread } = await openThread(page, interceptNetworkCall)
    const heading = thread.getByRole('heading', { name: 'Comments' })
    const send = thread.getByRole('button', { name: 'Send comment', exact: true })
    // Scoped to the thread: the dialog header carries a second control with this name.
    const closeLook = thread.getByRole('button', { name: 'Close this look', exact: true })
    await expect(heading).toBeFocused()

    await log.step('Light scheme: audit and keep the thread controls in view')
    await checkA11y(page)
    await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(send).toBeInViewport()
    await expect(heading).toBeInViewport()
    await expect(closeLook).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('comments-light-viewport.png'),
      fullPage: false,
    })

    await log.step('Dark scheme: audit and measure the keyboard focus ring')
    await page.emulateMedia({ colorScheme: 'dark' })
    await checkA11y(page)
    await heading.focus()
    await page.keyboard.press('Tab')
    await expect(closeLook).toBeFocused()
    await expect(closeLook).toHaveCSS('outline-style', 'solid')
    const focusColors = await closeLook.evaluate((button) => {
      const panel = button.closest('[role="dialog"]')?.firstElementChild
      if (!panel) throw new Error('Dialog panel missing')
      return {
        outline: getComputedStyle(button).outlineColor,
        background: getComputedStyle(panel).backgroundColor,
      }
    })
    const focusContrast = contrastRatio(focusColors.outline, focusColors.background)
    expect(focusContrast).toBeGreaterThanOrEqual(MIN_FOCUS_CONTRAST)
    await log.info(`Dark-scheme keyboard focus contrast: ${focusContrast.toFixed(2)}:1`)
    await page.screenshot({
      path: testInfo.outputPath('comments-dark-viewport.png'),
      fullPage: false,
    })

    await log.step('Phone width: close returns focus, reopen focuses the heading')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 390, height: 844 })
    await closeLook.click()
    await expect(opener).toBeFocused()
    await reopenThread(opener, interceptNetworkCall)
    await expect(heading).toBeFocused()
    await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(send).toBeInViewport()
    await expect(heading).toBeInViewport()
    await expect(closeLook).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('comments-mobile-viewport.png'),
      fullPage: false,
    })
  })

  test('[P0] pins each withheld sample to its screening disposition and keeps it private', async ({
    communitySession,
    apiRequest,
    recurse,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const account = sessionAccount(communitySession)
    const token = runToken()
    /*
     * Dispositions from the deterministic `CommunityTextScreener` under
     * policy-v2 (low and medium review, high blocks): `damn` is the bad-words
     * backstop at low, `fuck` is an English list term at medium, `kill
     * yourself` is a self_harm phrase at high.
     */
    const samples = [
      { body: `damn ${token}`, status: 'held_for_review' },
      { body: `fuck ${token}`, status: 'held_for_review' },
      { body: `kill yourself ${token}`, status: 'blocked' },
    ] as const

    for (const sample of samples) {
      await log.step(`Screen "${sample.body.split(' ')[0]}" through the worker`)
      const submitted = await createComment({ apiRequest }, account, sample.body)
      const settled = await settledSubmission(
        { apiRequest, recurse },
        account,
        submitted.id
      )
      expect(settled).toMatchObject({ status: sample.status, body: sample.body })
      const publicPage = await apiRequest<unknown>({
        method: 'GET',
        path: COMMENTS_PATH,
        baseUrl: account.apiBaseUrl,
        headers: account.headers,
      })
      expect(publicPage.status).toBe(200)
      const items = communityCommentsResponseSchema.parse(publicPage.body).data.items
      expect(items.map((item) => item.id)).not.toContain(submitted.id)
      expect(items.map((item) => item.body)).not.toContain(sample.body)
    }
  })

  test('[P0] shows a held submission privately with its status and recovery copy', async ({
    page,
    communitySession,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const account = sessionAccount(communitySession)
    const body = `damn ${runToken()}`
    const { thread } = await openThread(page, interceptNetworkCall)

    await log.step('Submit text the screener routes to review')
    await thread.getByLabel('Add a comment').fill(body)
    const createCall = interceptNetworkCall({ method: 'POST', url: CREATE_URL })
    await thread.getByRole('button', { name: 'Send comment', exact: true }).click()
    const created = await createCall
    expect(created.status).toBe(200)
    const { id } = communityCommentSubmissionResponseSchema.parse(
      created.responseJson
    ).data
    expect((await settledSubmission({ apiRequest, recurse }, account, id)).status).toBe(
      'held_for_review'
    )

    await log.step('Refresh and read the private row')
    const { roots, submissions } = await refreshThread(thread, interceptNetworkCall)
    expect(submissions.items.find((item) => item.id === id)?.status).toBe(
      'held_for_review'
    )
    expect(roots.items.map((item) => item.id)).not.toContain(id)
    const row = thread.getByTestId(`comment-submission-${id}`)
    await expect(row).toContainText('Held for review. Only you can see this.')
    await expect(row).toContainText(body)
    await expect(row).toContainText(RECOVERY_COPY)
    await expect(thread.getByText(body)).toHaveCount(1)
    await expect(thread.getByTestId(`comment-${id}`)).toHaveCount(0)

    await log.step('Follow the recovery copy and delete the submission')
    const deleteCall = interceptNetworkCall({
      method: 'DELETE',
      url: `**${COMMENTS_PATH}/${id}`,
    })
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const deleted = await deleteCall
    expect(deleted.status).toBe(200)
    expect(
      communityCommentSubmissionResponseSchema.parse(deleted.responseJson).data
    ).toMatchObject({ id, status: 'author_deleted', body: null })
    await expect(row).toContainText('Deleted.')
    await expect(row.getByText(RECOVERY_COPY)).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await expect(thread.getByText(body)).toHaveCount(0)
  })

  test('[P1] retries a create whose response was lost with the same mutation and publishes once', async ({
    page,
    communitySession,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const account = sessionAccount(communitySession)
    const draft = `Retry after the drop ${runToken()}`
    const { thread } = await openThread(page, interceptNetworkCall)
    const composer = thread.getByLabel('Add a comment')

    await log.step('Let the server accept the first create, then drop its response')
    let firstAttempt = true
    let acceptedId: string | null = null
    // One-shot: later attempts reach the real backend untouched.
    const lostCreate = interceptNetworkCall({
      method: 'POST',
      url: CREATE_URL,
      handler: async (route) => {
        if (firstAttempt) {
          firstAttempt = false
          const accepted = await route.fetch()
          acceptedId = communityCommentSubmissionResponseSchema.parse(
            await accepted.json()
          ).data.id
          await route.abort('connectionfailed')
        } else {
          await route.continue()
        }
      },
    })
    await composer.fill(draft)
    const alerts = await recordThreadAlerts(thread)
    await thread.getByRole('button', { name: 'Send comment', exact: true }).click()
    const { requestJson: firstRequest } = await lostCreate
    expect(firstRequest).toEqual({
      mutationId: expect.stringMatching(UUID),
      body: draft,
      locale: 'en-US',
      parentId: null,
    })
    await expect.poll(alerts).toContain('Comments could not be updated. Try again.')
    await expect(
      thread.getByText(
        'An earlier request needs confirmation. Retry it before sending your edited draft.'
      )
    ).toBeVisible()
    await expect(composer).toHaveValue(draft)

    await log.step('Edit the draft, then retry the original request')
    const edited = `${draft} edited`
    await composer.fill(edited)
    const retryCall = interceptNetworkCall({ method: 'POST', url: CREATE_URL })
    await thread.getByRole('button', { name: 'Retry submission', exact: true }).click()
    const retried = await retryCall
    expect(retried.status).toBe(200)
    expect(retried.requestJson).toEqual(firstRequest)
    const replayed = communityCommentSubmissionResponseSchema.parse(
      retried.responseJson
    ).data
    expect(acceptedId).not.toBeNull()
    expect(replayed).toMatchObject({ id: acceptedId, body: draft })
    await expect(thread.getByRole('alert')).toHaveCount(0)
    await expect(composer).toHaveValue(edited)
    await expect(
      thread.getByRole('button', { name: 'Send comment', exact: true })
    ).toBeVisible()

    await log.step('The one accepted comment publishes through the worker')
    expect(
      (await settledSubmission({ apiRequest, recurse }, account, replayed.id)).status
    ).toBe('published')
    const { roots } = await refreshThread(thread, interceptNetworkCall)
    rootOnFirstPage(roots, replayed.id)
    expect(roots.items.filter((item) => item.body === draft)).toHaveLength(1)
    await expect(thread.getByTestId(`comment-${replayed.id}`)).toContainText(draft)
  })

  test("[P1] reports another member's comment after a failed attempt and returns focus to Report", async ({
    page,
    communitySession,
    communityApi,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const author: Account = {
      apiBaseUrl: communityApi.apiBaseUrl,
      headers: communityApi.headers,
    }
    const body = `Fair question on hem length ${runToken()}`

    await log.step('A second member publishes a comment')
    const authored = await createComment({ apiRequest }, author, body)
    expect(
      (await settledSubmission({ apiRequest, recurse }, author, authored.id)).status
    ).toBe('published')

    const { thread, initial } = await openThread(page, interceptNetworkCall)
    const target = rootOnFirstPage(initial.roots, authored.id)
    expect(target).toMatchObject({ body, isOwn: false })
    const entry = thread.getByTestId(`comment-${target.id}`)
    const trigger = entry.getByRole('button', {
      name: `Report: ${itemContext(target)}`,
      exact: true,
    })

    await log.step('Open Report: the reason select takes focus')
    await trigger.click()
    const reason = entry.getByRole('combobox', { name: 'Reason for the report' })
    await expect(reason).toBeFocused()
    await expect(reason).toHaveValue('spam')
    await reason.selectOption('harassment')

    await log.step('The first attempt fails in transport and the form stays open')
    let firstAttempt = true
    const reportUrl = `**${COMMENTS_PATH}/${target.id}/report`
    const failedReport = interceptNetworkCall({
      method: 'POST',
      url: reportUrl,
      handler: async (route) => {
        if (firstAttempt) {
          firstAttempt = false
          await route.abort('connectionfailed')
        } else {
          await route.continue()
        }
      },
    })
    const alerts = await recordThreadAlerts(thread)
    await entry.getByRole('button', { name: 'Send report', exact: true }).click()
    expect((await failedReport).requestJson).toEqual({ reason: 'harassment' })
    await expect.poll(alerts).toContain('Comments could not be updated. Try again.')
    await expect(reason).toHaveValue('harassment')

    await log.step('Retry: the report is accepted and routed within five minutes')
    const reportCall = interceptNetworkCall({ method: 'POST', url: reportUrl })
    await entry.getByRole('button', { name: 'Send report', exact: true }).click()
    const reported = await reportCall
    expect(reported.status).toBe(200)
    expect(reported.requestJson).toEqual({ reason: 'harassment' })
    const receipt = reportCommunityCommentResponseSchema.parse(reported.responseJson).data
    expect(receipt.reported).toBe(true)
    const routedAfterMs = Date.parse(receipt.routedAt) - Date.parse(receipt.acceptedAt)
    expect(routedAfterMs).toBeGreaterThanOrEqual(0)
    expect(routedAfterMs).toBeLessThanOrEqual(FIVE_MINUTES_MS)
    await expect(reason).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(thread.getByText('Report received.')).toBeAttached()
    await expect(thread.getByRole('alert')).toHaveCount(0)
  })

  test('[P0] replaces a teen comment with a neutral placeholder once guardian consent is revoked', async ({
    page,
    communitySession,
    communityApi,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }, testInfo) => {
    expect(communitySession.userId).toBeTruthy()
    const body = `Wool coat over a knit ${runToken()}`

    await log.step('A 15-year-old with accepted guardian consent publishes a comment')
    const consent = await createAcceptedGuardianConsent(apiRequest, testInfo)
    guardianTargets.push(consent)
    // The fixture's owned teardown erases and deletes the teen's comment rows.
    communityApi.trackUser(consent.teenId)
    const teen: Account = {
      apiBaseUrl: communitySession.apiBaseUrl,
      headers: { ...authHeaders(consent.teenId, 'teen'), 'x-couture-platform': 'web' },
    }
    const authored = await createComment({ apiRequest }, teen, body)
    expect(
      (await settledSubmission({ apiRequest, recurse }, teen, authored.id)).status
    ).toBe('published')

    await log.step('The adult reader sees the body and the alias')
    const { thread, initial } = await openThread(page, interceptNetworkCall)
    const visible = rootOnFirstPage(initial.roots, authored.id)
    expect(visible).toMatchObject({ body, isOwn: false, unavailable: false })
    expect(visible.author).not.toBeNull()
    const alias = visible.author!
    const entry = thread.getByTestId(`comment-${authored.id}`)
    await expect(entry).toContainText(body)
    await expect(entry).toContainText(alias)

    await log.step('The guardian revokes consent through the real route')
    const revoked = await apiRequest<unknown>({
      method: 'POST',
      path: '/api/v1/guardian/revoke',
      baseUrl: communitySession.apiBaseUrl,
      headers: authHeaders(consent.guardianId, 'guardian'),
      body: { guardianId: consent.guardianId, teenId: consent.teenId },
    })
    expect(revoked.status).toBe(200)
    expect(guardianConsentRevokeResponseSchema.parse(revoked.body)).toMatchObject({
      teenId: consent.teenId,
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
    })

    await log.step('A refresh shows only the neutral placeholder')
    const { roots } = await refreshThread(thread, interceptNetworkCall)
    const suppressed = rootOnFirstPage(roots, authored.id)
    expect(suppressed).toMatchObject({ body: null, author: null, unavailable: true })
    // The strict contract carries no status field; the payload must not name a cause.
    expect(JSON.stringify(suppressed)).not.toMatch(/consent|suspend|guardian|teen|minor/i)
    await expect(entry.getByText('Unavailable.', { exact: true })).toBeVisible()
    await expect(entry).not.toContainText(body)
    await expect(entry).not.toContainText(/consent|suspend|guardian|teen|minor/i)
    await expect(thread.getByText(body)).toHaveCount(0)
    await expect(thread.getByText(alias, { exact: true })).toHaveCount(0)
    await expect(entry.getByRole('button', { name: /^Reply:/ })).toHaveCount(0)
    await expect(
      entry.getByRole('button', { name: 'Report: Unavailable.', exact: true })
    ).toBeVisible()
  })
})
