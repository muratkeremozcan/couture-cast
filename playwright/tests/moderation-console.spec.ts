// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderator console in a real browser against the real API and database.
// Every row carries a run id and nothing is deleted: AuditLog is immutable and its user_id is a RESTRICT key.
// The queue is read by a moderator identity the API accepts only in a local or preview run.
// The media happy path is stubbed at the network edge because the local stack has no Storage signing.
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { Locator, Page, Route } from '@playwright/test'
import {
  moderationCaseDetailResponseSchema,
  moderationMediaUnavailableReasonSchema,
} from '@couture/api-client/contracts/http'
import { test as base, expect } from '../support/fixtures/merged-fixtures'
import { checkA11y } from '../support/helpers/accessibility'
import { authHeaders, resolveApiBaseUrl } from '../support/helpers/api-test'
import { seedWebSession } from '../support/helpers/commerce-session'
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

type Fixtures = { prisma: PrismaClient }
type WorkerFixtures = { queue: SeededQueue; workerPrisma: PrismaClient }

const test = base.extend<Fixtures, WorkerFixtures>({
  workerPrisma: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      await use(prisma)
      await prisma.$disconnect()
    },
    { scope: 'worker' },
  ],
  queue: [
    async ({ workerPrisma }, use) => {
      await use(await seedModerationQueue(workerPrisma, { now: new Date() }))
    },
    { scope: 'worker' },
  ],
  prisma: async ({ workerPrisma }, use) => {
    await use(workerPrisma)
  },
})

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.metadata?.environment === 'prod',
    'Synthetic moderator identities are not provisioned in production.'
  )
})

const QUEUE_URL = '/moderation'
/** Next adds its own route announcer with role alert, so the console alert is everything else. */
const alertOf = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)')
const caseUrl = (caseId: string) => `/moderation/cases/${encodeURIComponent(caseId)}`

async function signInAs(
  page: Page,
  userId: string,
  role: 'moderator' | 'admin' | 'guardian' = 'moderator'
) {
  await seedWebSession(page.context(), localE2EAccessToken(userId, role))
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
  for (const caseId of caseIds) await expect(linkFor(caseId)).toHaveCount(1)
}

const hrefsOf = async (links: Locator) =>
  links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))

test.describe('Moderator console (Story 6.10)', () => {
  test('[P0] P-Q-CONSOLE a moderator reads the queue in order and opens a case', async ({
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

  test('[P0] P-Q-CONSOLE the queue filters by source, risk and time through the API', async ({
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

  test(
    '[P0] P-Q-FORBIDDEN a guardian and a teen see a refusal and no case data',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, queue }) => {
      for (const role of ['guardian', 'teen'] as const) {
        const context = await page.context().browser()!.newContext()
        const view = await context.newPage()
        await seedWebSession(view.context(), localE2EAccessToken(queue.author.id, role))
        await view.goto(QUEUE_URL)
        await expect(alertOf(view)).toBeVisible()
        await expect(view.getByRole('list', { name: 'Cases' })).toHaveCount(0)
        const text = await view.locator('body').innerText()
        expect(text).not.toContain(queue.runId)
        await view.goto(caseUrl(queue.expectations.B!.caseId))
        await expect(alertOf(view)).toBeVisible()
        expect(await view.locator('body').innerText()).not.toContain(queue.runId)
        await context.close()
      }
    }
  )

  test(
    '[P0] P-Q-FORBIDDEN a visitor with no session is told to sign in and sends no request',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, queue }) => {
      const requests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/api/v1/moderation/')) requests.push(request.url())
      })
      await page.goto(caseUrl(queue.expectations.B!.caseId))
      await expect(alertOf(page)).toContainText('Sign in again to continue.')
      expect(requests).toEqual([])
    }
  )

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

  test('[P1] P-Q-KEYBOARD the queue and the case are operable by keyboard alone', async ({
    page,
    queue,
  }) => {
    await signInAs(page, queue.moderator.id)
    await page.goto(QUEUE_URL)
    const target = queue.expectations.F!.caseId
    await loadCases(page, [target])
    const link = page.locator(`a[href="${caseUrl(target)}"]`)
    // Programmatic focus never shows a focus-visible ring, so reach the link the way a keyboard user does.
    for (
      let step = 0;
      step < 80 && !(await link.evaluate((node) => node === document.activeElement));
      step++
    )
      await page.keyboard.press('Tab')
    await expect(link).toBeFocused()
    const outline = await link.evaluate((node) => {
      const style = getComputedStyle(node)
      return { width: style.outlineWidth, style: style.outlineStyle }
    })
    expect(outline.style).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
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
    '[P1] P-Q-DEEPLINK a pasted case URL opens directly, and a bad or unknown id fails closed',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, queue }) => {
      await signInAs(page, queue.moderator.id)
      await page.goto(caseUrl(queue.expectations.C!.caseId))
      await expect(
        page.getByRole('heading', { level: 1, name: 'Post case' })
      ).toBeVisible()
      // The screening finding on C is shown with its engine version.
      await expect(page.getByRole('region', { name: 'Machine findings' })).toContainText(
        '1.2.0'
      )

      for (const id of ['post.never-existed', 'not-a-case', 'post.%2F..%2Fx']) {
        await page.goto(`/moderation/cases/${id}`)
        await expect(alertOf(page)).toContainText('This case no longer exists.')
        await expect(page.getByRole('region', { name: 'Reporters' })).toHaveCount(0)
      }

      // Next.js answers a malformed percent escape with its own 400 before the page renders,
      // so the console never sees it. Either closed outcome is acceptable, a 5xx or case data is not.
      for (const id of ['%E0%A4%A', '%', '%zz', 'post.%E0%A4']) {
        const response = await page.goto(`/moderation/cases/${id}`)
        expect(response?.status(), id).toBeLessThan(500)
        if (response?.status() === 200)
          await expect(alertOf(page)).toContainText('This case no longer exists.')
        await expect(page.getByRole('region', { name: 'Reporters' })).toHaveCount(0)
        expect(await page.locator('body').innerText()).not.toContain(queue.runId)
      }
    }
  )

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

  test('[P0] P-Q-MEDIA a signed image loads without a referrer and an expired link offers a reload', async ({
    page,
    queue,
  }) => {
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
    await page.route('**/api/v1/moderation/cases/post.*', async (route: Route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { data: Record<string, unknown> }
      body.data.media = {
        state: 'available',
        url: `${new URL(page.url()).origin}/__cc610/ok.png?token=SIGNED`,
        expiresAt,
        altText: 'Reported look',
      }
      await route.fulfill({ response, json: body })
    })
    await signInAs(page, queue.moderator.id)
    await page.goto(QUEUE_URL)
    await page.goto(caseUrl(queue.expectations.A!.caseId))
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
    async ({ page, queue }) => {
      // The flag path is proven against the real API in the integration and Pact suites.
      // A flag flip here would race every other worker, so the browser renders the controller's exact 503 body.
      await signInAs(page, queue.moderator.id)
      await page.route('**/api/v1/moderation/cases**', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'cache-control': 'private, no-store' },
          // The exact body the controller throws, which the contract requires to carry a message.
          json: {
            statusCode: 503,
            code: 'moderation_console_disabled',
            message: 'The moderation console is not available.',
          },
        })
      })
      await page.goto(QUEUE_URL)
      await expect(alertOf(page)).toContainText('The moderation console is turned off.')
      await expect(page.getByRole('list', { name: 'Cases' })).toHaveCount(0)
    }
  )

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

  test('[P1] P-Q-AXE the queue and the case pass axe in light and dark', async ({
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

  test('[P2] P-Q-THEMES-WIDTHS the console fits 320, 768 and 1280 pixels in light and dark', async ({
    page,
    queue,
  }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    await signInAs(page, queue.moderator.id)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        for (const [name, url] of [
          ['queue', QUEUE_URL],
          ['case', caseUrl(queue.expectations.B!.caseId)],
        ] as const) {
          await page.goto(url)
          await (name === 'queue'
            ? loadCases(page, [queue.expectations.B!.caseId])
            : expect(page.getByRole('region', { name: 'Reporters' })).toBeVisible())
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth
          )
          expect(overflow, `${name} ${colorScheme} ${width}`).toBeLessThanOrEqual(0)
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${name}-${colorScheme}-${width}.png`),
            fullPage: false,
          })
        }
      }
    }
  })
})
