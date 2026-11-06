// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderator console in a real browser against the real API.
// Two kinds of test share this file.
// Live tests need no database: they sign up a throwaway moderator through the product API and read
// whatever the queue holds, so they run on a local stack and on a Vercel preview alike.
// Seeded tests need direct database access and run on a local stack only: a preview run has no database
// secret by design. Every seeded row carries a run id and nothing is deleted: AuditLog is immutable and
// its user_id is a RESTRICT key.
// The moderation console flag is environment configuration. A local stack seeds it on. A preview may have it
// off, and then the live tests assert the closed-console contract in place of the queue.
// The media happy path is stubbed at the network edge because no local stack signs Storage URLs.
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { APIRequestContext, Locator, Page, Route, TestInfo } from '@playwright/test'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  moderationMediaUnavailableReasonSchema,
  moderationQueueErrorSchema,
} from '@couture/api-client/contracts/http'
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
import { drainApiProxy, installApiProxy } from '../support/helpers/browser-api-proxy'
import {
  seedWebSession,
  WEB_ACCESS_TOKEN_STORAGE_KEY,
} from '../support/helpers/commerce-session'
import { signUpCommunityUser } from '../support/helpers/community-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  seedMember,
  seedModerationQueue,
  seedPost,
  seedPostReport,
  type SeededQueue,
} from '../../apps/api/integration/helpers/moderation-queue-seed'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '../../_bmad-output/test-artifacts/story-6-10'
)

const NO_DATABASE =
  'Seeding needs direct database access, which a preview run does not have.'

// The client and the seed are built on first use, so a preview run never opens a database connection.
let prismaClient: PrismaClient | undefined
let seededQueue: Promise<SeededQueue> | undefined
const databaseClient = () =>
  (prismaClient ??= new PrismaClient({ datasources: { db: { url: databaseUrl } } }))

type Fixtures = { prisma: PrismaClient; queue: SeededQueue; moderator: { id: string } }

const test = base.extend<Fixtures>({
  prisma: async ({}, use, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), NO_DATABASE)
    await use(databaseClient())
  },
  queue: async ({}, use, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), NO_DATABASE)
    seededQueue ??= seedModerationQueue(databaseClient(), { now: new Date() })
    await use(await seededQueue)
  },
  // A user row the audit foreign key can point at, made the way a product user is made.
  moderator: async ({ request }, use, testInfo) => {
    const id = await signUpCommunityUser(
      request,
      resolveApiBaseUrl(testInfo),
      buildUniqueId('moderator', testInfo)
    )
    await use({ id })
  },
})

test.afterAll(async () => {
  // A look left published here takes a slot on the first feed page, which seeded rows already fill.
  if (seededQueue) {
    const { runId } = await seededQueue
    await databaseClient().lookbookPost.updateMany({
      where: { id: { startsWith: `${runId}-` }, status: 'published' },
      data: { status: 'withdrawn' },
    })
  }
  await prismaClient?.$disconnect()
})

test.beforeEach(({}, testInfo) => {
  test.skip(
    isProdEnvironment(testInfo),
    'Synthetic moderator identities are not provisioned in production.'
  )
})

const QUEUE_URL = '/moderation'
/** Next adds its own route announcer with role alert, so the console alert is everything else. */
const alertOf = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)')
const caseUrl = (caseId: string) => `/moderation/cases/${encodeURIComponent(caseId)}`

async function signInAs(page: Page, userId: string, role: ApiRole = 'moderator') {
  await seedWebSession(page.context(), localE2EAccessToken(userId, role))
  // A deployed web preview and its API are separate protected origins. The proxy carries the
  // page's own bearer to the API with the deployment-protection bypass, as the other preview specs do.
  const testInfo = test.info()
  if (!isNonLocalEnvironment(testInfo)) return
  await installApiProxy(page, testInfo)
  // A web build without fixture auth (`NEXT_PUBLIC_E2E_AUTH`) verifies the session with Supabase and clears a
  // token it does not recognise a moment after hydration (`removeItem`). The console reads that token for every
  // request, so a deployed preview must never see it gone. The token is set before any page script runs and
  // removal of that one key is refused, so no request can land between a clear and a restore.
  // A local stack runs the fixture build and needs none of this.
  await page.addInitScript(
    ({ key, token }) => {
      if (window.location.origin === 'null') return
      window.sessionStorage.setItem(key, token)
      // Patch the prototype: assigning a property on a Storage instance writes a storage item.
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

/** The queue spans pages when other runs left open cases, so walk it until these ids are present. */
async function loadCases(page: Page, caseIds: string[]) {
  const linkFor = (caseId: string) => page.locator(`a[href="${caseUrl(caseId)}"]`)
  const list = page.getByRole('list', { name: 'Cases' })
  await expect(list).toBeVisible()
  // A long-lived local database can hold thousands of older open cases, so walk until the queue ends.
  for (let attempt = 0; attempt < 400; attempt++) {
    const present = await Promise.all(
      caseIds.map(async (caseId) => (await linkFor(caseId).count()) > 0)
    )
    if (present.every(Boolean)) return
    const more = page.getByRole('button', { name: 'Load more' })
    if (!(await more.isVisible())) break
    const before = await page.locator('ol[aria-label="Cases"] > li').count()
    await more.click()
    await expect
      .poll(() => page.locator('ol[aria-label="Cases"] > li').count())
      .toBeGreaterThan(before)
  }
  // Open reports from earlier runs sort ahead of these cases until the database is reset, so a run that
  // walks the whole queue without finding them names that cause instead of a bare count mismatch.
  for (const caseId of caseIds)
    await expect(
      linkFor(caseId),
      `${caseId} not found after walking the queue; reset the local database to drop open cases left by earlier runs`
    ).toHaveCount(1)
}

const hrefsOf = async (links: Locator) =>
  links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))

/**
 * Asks the API whether the console is on, as a moderator. The role check passes either way, so the
 * only two answers are the queue (200) and the closed console (503 `moderation_console_disabled`).
 * Anything else is a defect and fails here.
 */
async function consoleIsOn(
  request: APIRequestContext,
  testInfo: TestInfo,
  moderatorId: string
): Promise<boolean> {
  const response = await request.get(
    `${resolveApiBaseUrl(testInfo)}/api/v1/moderation/cases?limit=1`,
    { headers: authHeaders(moderatorId, 'moderator') }
  )
  if (response.status() === 200) {
    moderationCasesResponseSchema.parse(await response.json())
    return true
  }
  expect(response.status(), await response.text()).toBe(503)
  expect(moderationQueueErrorSchema.parse(await response.json()).code).toBe(
    'moderation_console_disabled'
  )
  return false
}

/** A local stack seeds the flag on, so only a preview may skip a test that needs the queue. */
async function requireConsoleOn(
  request: APIRequestContext,
  testInfo: TestInfo,
  moderatorId: string
) {
  const on = await consoleIsOn(request, testInfo, moderatorId)
  if (!isNonLocalEnvironment(testInfo))
    expect(on, 'a local stack seeds the console on').toBe(true)
  test.skip(
    !on,
    'This environment has moderation_console_enabled off. P-Q-DISABLED-REAL asserts that state.'
  )
}

const firstCaseLink = (page: Page) => page.locator('ol[aria-label="Cases"] a').first()

/** Waits for whatever the queue settles on: cases, the empty state or a closed-console notice. */
async function settleQueue(page: Page) {
  await expect(
    page
      .getByRole('list', { name: 'Cases' })
      .or(page.getByText('No open cases.'))
      .or(alertOf(page))
  ).toBeVisible()
}

const CLOSED_CONSOLE = 'The moderation console is turned off.'
const NO_CASE = 'This case no longer exists.'

/** A schema-valid case the media test serves itself, so it needs no stored case. */
const stubbedDetail = (caseId: string, media: unknown) =>
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
      media,
      viewerConflict: false,
      // Story 6.11: the decision state a read-only stub has, with no form offered.
      revision: '0123456789abcdef',
      allowedActions: [],
      banKinds: [],
      escalated: false,
      firstDecisionAt: null,
      subjectStanding: null,
    },
  })

test.describe('Moderator console, live (Story 6.10)', () => {
  test('[P0] P-Q-CONSOLE a moderator reads the live queue, filters it through the API and opens a case', async ({
    page,
    request,
    moderator,
  }, testInfo) => {
    await requireConsoleOn(request, testInfo, moderator.id)
    await signInAs(page, moderator.id)
    await page.goto(QUEUE_URL)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Moderation queue' })
    ).toBeVisible()
    await settleQueue(page)
    await expect(alertOf(page)).toHaveCount(0)

    // Each filter reaches the API, and everything the API returns obeys it.
    for (const [label, value, key] of [
      ['Source', 'comment', 'source'],
      ['Risk', 'high', 'risk'],
    ] as const) {
      const answered = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/moderation/cases') &&
          new URL(response.url()).searchParams.get(key) === value
      )
      await page.getByLabel(label).selectOption(value)
      const response = await answered
      expect(response.status()).toBe(200)
      const { items } = moderationCasesResponseSchema.parse(await response.json()).data
      for (const item of items) expect(item[key], `${key} filter`).toBe(value)
      await page.getByLabel(label).selectOption({ index: 0 })
      await settleQueue(page)
    }

    // A queue that holds a case lets the moderator open it and come back.
    const link = firstCaseLink(page)
    if ((await link.count()) > 0) {
      await link.click()
      await expect(
        page.getByRole('heading', { level: 1, name: /^(Post|Comment) case$/ })
      ).toBeVisible()
      await page.getByRole('link', { name: 'Back to queue' }).click()
      await expect(page).toHaveURL(/\/moderation$/)
    }
  })

  test(
    '[P0] P-Q-FORBIDDEN a guardian and a teen see a refusal and no case data',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page }, testInfo) => {
      for (const role of ['guardian', 'teen'] as const) {
        const context = await page.context().browser()!.newContext()
        const view = await context.newPage()
        const id = buildUniqueId(`${role}-console`, testInfo)
        await signInAs(view, id, role)
        for (const url of [QUEUE_URL, caseUrl('post.anything')]) {
          await view.goto(url)
          await expect(alertOf(view)).toBeVisible()
          await expect(view.getByRole('list', { name: 'Cases' })).toHaveCount(0)
          await expect(view.locator('a[href^="/moderation/cases/"]')).toHaveCount(0)
        }
        await drainApiProxy(view)
        await context.close()
      }
    }
  )

  test(
    '[P0] P-Q-FORBIDDEN a visitor with no session is told to sign in and sends no request',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page }) => {
      const requests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/api/v1/moderation/')) requests.push(request.url())
      })
      await page.goto(caseUrl('post.anything'))
      await expect(alertOf(page)).toContainText('Sign in again to continue.')
      expect(requests).toEqual([])
    }
  )

  test('[P1] P-Q-KEYBOARD the queue and the case are operable by keyboard alone', async ({
    page,
    request,
    moderator,
  }, testInfo) => {
    await requireConsoleOn(request, testInfo, moderator.id)
    await signInAs(page, moderator.id)
    await page.goto(QUEUE_URL)
    await settleQueue(page)
    // Programmatic focus never shows a focus-visible ring, so reach each control the way a keyboard user does.
    const reach = async (target: Locator) => {
      for (
        let step = 0;
        step < 200 && !(await target.evaluate((node) => node === document.activeElement));
        step++
      )
        await page.keyboard.press('Tab')
      await expect(target).toBeFocused()
      const outline = await target.evaluate((node) => getComputedStyle(node).outlineStyle)
      expect(outline).not.toBe('none')
    }
    await reach(page.getByLabel('Source'))

    const link = firstCaseLink(page)
    if ((await link.count()) === 0) return
    await reach(link)
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { level: 1, name: /^(Post|Comment) case$/ })
    ).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Back to queue' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Reload case' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('link', { name: 'Back to queue' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/moderation$/)
  })

  test(
    '[P1] P-Q-DEEPLINK an unknown or malformed case id fails closed',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request, moderator }, testInfo) => {
      const on = await consoleIsOn(request, testInfo, moderator.id)
      if (!isNonLocalEnvironment(testInfo)) expect(on).toBe(true)
      await signInAs(page, moderator.id)
      // A case the API does not know reads as gone when the console is on and as closed when it is off.
      const expected = on ? NO_CASE : CLOSED_CONSOLE
      for (const id of ['post.never-existed', 'not-a-case', 'post.%2F..%2Fx']) {
        await page.goto(`/moderation/cases/${id}`)
        await expect(alertOf(page)).toContainText(expected)
        await expect(page.getByRole('region', { name: 'Reporters' })).toHaveCount(0)
      }

      // Next.js answers a malformed percent escape with its own 400 before the page renders,
      // so the console never sees it. Any closed outcome is acceptable, a 5xx or case data is not.
      for (const id of ['%E0%A4%A', '%', '%zz', 'post.%E0%A4']) {
        // A hosting edge may refuse the request outright, with no page at all. That is closed too.
        const response = await page.goto(`/moderation/cases/${id}`).catch(() => null)
        if (response === null) continue
        expect(response.status(), id).toBeLessThan(500)
        if (response.status() === 200) await expect(alertOf(page)).toContainText(expected)
        await expect(page.getByRole('region', { name: 'Reporters' })).toHaveCount(0)
      }
    }
  )

  test('[P0] P-Q-MEDIA a signed image loads without a referrer and an expired link offers a reload', async ({
    page,
    moderator,
  }) => {
    // Sign in first: a later route wins, so the stubs below sit above the preview API proxy.
    await signInAs(page, moderator.id)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
    const referers: (string | undefined)[] = []
    await page.route('**/__cc610/ok.png*', async (route: Route) => {
      referers.push(route.request().headers().referer)
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    let expiresAt = new Date(Date.now() + 120_000).toISOString()
    const caseId = 'post.stubmedia'
    await page.route(`**/api/v1/moderation/cases/${caseId}*`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'private, no-store' },
        json: stubbedDetail(caseId, {
          state: 'available',
          url: `${new URL(page.url()).origin}/__cc610/ok.png?token=SIGNED`,
          expiresAt,
          altText: 'Reported look',
        }),
      })
    })
    await page.goto(caseUrl(caseId))
    const image = page.getByRole('img', { name: 'Reported look' })
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0)
    expect(referers.every((value) => value === undefined)).toBe(true)

    expiresAt = new Date(Date.now() - 1_000).toISOString()
    await page.getByRole('button', { name: 'Reload case' }).click()
    await expect(page.getByText('The image link expired.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload image' })).toBeVisible()
  })

  test(
    '[P1] P-Q-DISABLED a switched-off console shows the disabled state',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, moderator }) => {
      // The flag path is proven against the real API in the integration and Pact suites.
      // A flag flip here would race every other worker, so the browser renders the controller's exact 503 body.
      await signInAs(page, moderator.id)
      await page.route('**/api/v1/moderation/cases**', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'cache-control': 'private, no-store' },
          // Parsed by the shipped error schema, so a body the contract rejects fails this test.
          json: moderationQueueErrorSchema.parse({
            statusCode: 503,
            code: 'moderation_console_disabled',
            message: 'The moderation console is not available.',
          }),
        })
      })
      await page.goto(QUEUE_URL)
      await expect(alertOf(page)).toContainText(CLOSED_CONSOLE)
      await expect(page.getByRole('list', { name: 'Cases' })).toHaveCount(0)
    }
  )

  test(
    '[P1] P-Q-DISABLED-REAL an environment with the console off closes it end to end',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request, moderator }, testInfo) => {
      const on = await consoleIsOn(request, testInfo, moderator.id)
      test.skip(on, 'The console is on here, so there is no closed state to observe.')
      await signInAs(page, moderator.id)
      await page.goto(QUEUE_URL)
      await expect(alertOf(page)).toContainText(CLOSED_CONSOLE)
      await expect(page.getByRole('list', { name: 'Cases' })).toHaveCount(0)
      await expect(page.locator('a[href^="/moderation/cases/"]')).toHaveCount(0)
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
    }
  )

  test('[P1] P-Q-AXE the queue and a case pass axe in light and dark', async ({
    page,
    request,
    moderator,
  }, testInfo) => {
    const on = await consoleIsOn(request, testInfo, moderator.id)
    if (!isNonLocalEnvironment(testInfo)) expect(on).toBe(true)
    test.skip(!on, 'P-Q-DISABLED-REAL runs axe on the closed state.')
    await signInAs(page, moderator.id)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto(QUEUE_URL)
      await settleQueue(page)
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
      const link = firstCaseLink(page)
      if ((await link.count()) === 0) continue
      await link.click()
      await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
      // A client-side navigation sets the document title a moment after the content renders.
      await expect(page).toHaveTitle(/moderation case/i)
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
    }
  })

  test(
    '[P2] P-Q-THEMES-WIDTHS the console fits 320, 768 and 1280 pixels in light and dark',
    // A closed console answers 503 on a preview, and the page still has to fit.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, request, moderator }, testInfo) => {
      const on = await consoleIsOn(request, testInfo, moderator.id)
      if (!isNonLocalEnvironment(testInfo)) expect(on).toBe(true)
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
      await signInAs(page, moderator.id)
      const fits = (label: string) =>
        page
          .evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth
          )
          .then((overflow) => expect(overflow, label).toBeLessThanOrEqual(0))
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        for (const width of [320, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 })
          await page.goto(QUEUE_URL)
          await settleQueue(page)
          await fits(`queue ${colorScheme} ${width}`)
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `queue-${colorScheme}-${width}.png`),
          })
          const link = firstCaseLink(page)
          if (!on || (await link.count()) === 0) continue
          await page.goto((await link.getAttribute('href'))!)
          await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
          await fits(`case ${colorScheme} ${width}`)
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `case-${colorScheme}-${width}.png`),
          })
        }
      }
    }
  )
})

// Seeded tests: they read and write the database directly, so a preview run skips them.
test.describe('Moderator console, seeded (Story 6.10)', () => {
  test('[P0] P-Q-CONSOLE-ORDER the seeded cases appear in risk and due order and open', async ({
    page,
    queue,
  }) => {
    await signInAs(page, queue.moderator.id)
    await page.goto(QUEUE_URL)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Moderation queue' })
    ).toBeVisible()
    const ids = queue.openOrder.map((key) => queue.expectations[key]!.caseId)
    await loadCases(page, ids)

    // The seeded cases appear in risk, then due, order, whatever else the queue holds.
    const mine = (await hrefsOf(page.locator('ol[aria-label="Cases"] a'))).filter(
      (href) => ids.some((id) => href === caseUrl(id))
    )
    expect(mine).toEqual(ids.map(caseUrl))

    // A resolved case and the two unreported ones never appear in the open queue.
    for (const caseId of [queue.expectations.H!.caseId, ...queue.neverQueued])
      await expect(page.locator(`a[href="${caseUrl(caseId)}"]`)).toHaveCount(0)

    // The breached orphan sits first among this run's cases and says so.
    const orphan = page
      .locator(
        `article[aria-labelledby="case-${ids[0]}"], li:has(a[href="${caseUrl(ids[0]!)}"])`
      )
      .first()
    await expect(orphan).toContainText('Breached')
    await expect(orphan).toContainText('High')

    await page.locator(`a[href="${caseUrl(queue.expectations.B!.caseId)}"]`).click()
    await expect(page).toHaveURL(
      new RegExp(`/moderation/cases/post\\.${queue.posts.B.id}$`)
    )
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
    const reporters = page.getByRole('region', { name: 'Reporters' })
    await expect(reporters.getByRole('listitem')).toHaveCount(3)
    for (const n of [1, 2, 3])
      await expect(reporters).toContainText(`${queue.runId}-reporter${n}`)
    await page.getByRole('link', { name: 'Back to queue' }).click()
    await expect(page).toHaveURL(/\/moderation$/)
  })

  test('[P0] P-Q-FILTERS-SEEDED the queue filters seeded cases by source, risk and time', async ({
    page,
    queue,
  }) => {
    await signInAs(page, queue.moderator.id)
    await page.goto(QUEUE_URL)
    await loadCases(page, [queue.expectations.D!.caseId])
    await page.getByLabel('Source').selectOption('comment')
    const comments = page.locator('ol[aria-label="Cases"] a')
    await expect(comments.first()).toBeVisible()
    await loadCases(page, [queue.expectations.D!.caseId])
    await expect(
      page.locator(`a[href="${caseUrl(queue.expectations.B!.caseId)}"]`)
    ).toHaveCount(0)
    await page.getByLabel('Source').selectOption({ index: 0 })
    await page.getByLabel('Risk').selectOption('high')
    await loadCases(page, [queue.expectations.F!.caseId, queue.expectations.B!.caseId])
    await expect(
      page.locator(`a[href="${caseUrl(queue.expectations.E!.caseId)}"]`)
    ).toHaveCount(0)
    await page.getByLabel('Risk').selectOption({ index: 0 })
    await page.getByLabel('Time').selectOption('breached')
    await loadCases(page, [queue.expectations.F!.caseId])
    await expect(
      page.locator(`a[href="${caseUrl(queue.expectations.A!.caseId)}"]`)
    ).toHaveCount(0)
  })

  test('[P1] P-Q-INTAKE-E2E a report filed through the product API reaches the queue', async ({
    page,
    request,
    prisma,
    queue,
  }, testInfo) => {
    const author = await seedMember(prisma, queue.runId, 'intake-author')
    const reporter = await seedMember(prisma, queue.runId, 'intake-reporter')
    const post = await seedPost(prisma, {
      runId: queue.runId,
      label: 'intake',
      authorId: author.id,
      now: new Date(),
    })
    const response = await request.post(
      `${resolveApiBaseUrl(testInfo)}/api/v1/community/posts/${post.id}/report`,
      {
        headers: {
          ...authHeaders(reporter.id, 'guardian'),
          'x-couture-platform': 'web',
        },
        data: { reason: 'harassment', details: 'Filed from the intake E2E' },
      }
    )
    expect(response.status(), await response.text()).toBe(200)

    await signInAs(page, queue.moderator.id)
    await page.goto(QUEUE_URL)
    await loadCases(page, [`post.${post.id}`])
    await page.locator(`a[href="${caseUrl(`post.${post.id}`)}"]`).click()
    const reporters = page.getByRole('region', { name: 'Reporters' })
    await expect(reporters).toContainText(reporter.alias)
    await expect(reporters).toContainText('Harassment')
    await expect(reporters).toContainText('Filed from the intake E2E')
  })

  test('[P0] P-Q-AUDIT-ONE one case view writes one audit row and a reload writes a second', async ({
    page,
    prisma,
    queue,
  }) => {
    const moderator = await seedMember(prisma, queue.runId, 'audit-mod', { alias: false })
    const count = () =>
      prisma.auditLog.count({
        where: { user_id: moderator.id, event_type: 'moderation_case_viewed' },
      })
    await signInAs(page, moderator.id)
    expect(await count()).toBe(0)

    await page.goto(QUEUE_URL)
    await loadCases(page, [queue.expectations.A!.caseId])
    expect(await count()).toBe(0)

    await page.goto(caseUrl(queue.expectations.A!.caseId))
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
    // A focus change or a minute tick must not refetch.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(1_500)
    expect(await count()).toBe(1)

    const [row] = await prisma.auditLog.findMany({
      where: { user_id: moderator.id, event_type: 'moderation_case_viewed' },
    })
    expect(row?.event_data).toEqual({
      caseId: queue.expectations.A!.caseId,
      source: 'post',
      role: 'moderator',
    })

    await page.getByRole('button', { name: 'Reload case' }).click()
    await expect.poll(count).toBe(2)
  })

  test('[P0] P-Q-HOSTILE reporter text and a hostile caption render as inert text', async ({
    page,
    prisma,
    queue,
  }) => {
    const hostile =
      '<img src=x onerror="window.__cc610xss=1"><script>window.__cc610xss=1</script> [go](javascript:alert(1)) ‮evil'
    const author = await seedMember(prisma, queue.runId, 'hostile-author')
    const reporter = await seedMember(prisma, queue.runId, 'hostile-reporter')
    const post = await seedPost(prisma, {
      runId: queue.runId,
      label: 'hostile',
      authorId: author.id,
      caption: hostile,
      altText: hostile,
      now: new Date(),
    })
    const now = new Date()
    await seedPostReport(prisma, {
      runId: queue.runId,
      label: 'hostile',
      postId: post.id,
      reporterId: reporter.id,
      reason: 'spam',
      createdAt: now,
      dueAt: new Date(now.getTime() + 20 * 3_600_000),
      subjectAlias: author.alias,
      imageObjectPath: post.image_object_path,
      details: hostile,
      snapshot: {
        caption: hostile,
        altText: hostile,
        locale: 'en-US',
        climateBand: 'temperate_dry',
        capturedAt: now.toISOString(),
      },
    })

    let dialog = false
    page.on('dialog', (event) => {
      dialog = true
      void event.dismiss()
    })
    await signInAs(page, queue.moderator.id)
    await page.goto(caseUrl(`post.${post.id}`))
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Reporters' })).toContainText(
      '<img src=x onerror="window.__cc610xss=1">'
    )
    // The bidi override shows as a marker and the character itself is gone.
    await expect(page.getByRole('region', { name: 'Reporters' })).toContainText(
      '<U+202E>'
    )
    expect(await page.locator('main').innerText()).not.toContain('‮')
    expect(
      await page.locator('img[src="x"], main script, main a[href^="javascript:"]').count()
    ).toBe(0)
    expect(
      await page.evaluate(() => (window as never as Record<string, unknown>).__cc610xss)
    ).toBeUndefined()
    expect(dialog).toBe(false)

    await page.goto(QUEUE_URL)
    await loadCases(page, [`post.${post.id}`])
    expect(
      await page
        .locator('ol[aria-label="Cases"] img[src="x"], ol[aria-label="Cases"] script')
        .count()
    ).toBe(0)
    expect(dialog).toBe(false)
  })

  test('[P0] P-Q-MEDIA-REAL the unstubbed API answers a closed media block for a post with an image', async ({
    request,
    queue,
  }, testInfo) => {
    // The stubbed test above proves the browser handles a signed URL.
    // This one holds the real API to the contract: no storage locally means a closed reason, never a raw path.
    const response = await request.get(
      `${resolveApiBaseUrl(testInfo)}/api/v1/moderation/cases/${queue.expectations.A!.caseId}`,
      { headers: authHeaders(queue.moderator.id, 'moderator') }
    )
    expect(response.status()).toBe(200)
    const body = moderationCaseDetailResponseSchema.parse(await response.json())
    const { media } = body.data
    if (media.state === 'available') {
      expect(media.url).toMatch(/^https?:\/\//)
      expect(Date.parse(media.expiresAt)).toBeGreaterThan(Date.now())
    } else {
      expect(moderationMediaUnavailableReasonSchema.options).toContain(media.reason)
      // A post that has an image can only fail to sign, never claim to have none.
      expect(media.reason).toBe('signing_failed')
    }
    // The object path appears only inside a signed URL, so check everything except media.
    const rest = { ...body.data, media: null }
    expect(JSON.stringify(rest)).not.toContain(
      queue.posts.A.image_object_path ?? 'no-path'
    )
  })

  test('[P1] P-Q-DEEPLINK-FINDING a pasted case URL shows the screening finding with its engine version', async ({
    page,
    queue,
  }) => {
    await signInAs(page, queue.moderator.id)
    await page.goto(caseUrl(queue.expectations.C!.caseId))
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Machine findings' })).toContainText(
      '1.2.0'
    )
  })

  test('[P1] P-Q-SEEDED-AXE the seeded case passes axe in light and dark', async ({
    page,
    queue,
  }) => {
    await signInAs(page, queue.moderator.id)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto(QUEUE_URL)
      await loadCases(page, [queue.expectations.B!.caseId])
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
      await page.goto(caseUrl(queue.expectations.B!.caseId))
      await expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible()
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
    }
  })
})
