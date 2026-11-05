// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: P-SLA-REAL-DELIVERY, -HOSTED-PATH, -JOURNEY, -AXE, -STABLE, -STALE-UI,
// -THEMES-WIDTHS, -LOCALE, -KEYBOARD.
//
// The local stack runs the real `community.bootstrap` with the seeded flags on, so a real sweep runs
// every 60 seconds during this file (TEA-14). Every assertion scopes to the seeded case ids, nothing
// asserts a global count, and a stamp seeded by hand would be overwritten within a minute, so the
// stale state stubs the response. moderation-sla-route.integration.spec.ts owns the stale logic.
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { Page } from '@playwright/test'
import { webhookTemplate } from '@seontechnologies/playwright-utils/webhook'
import {
  moderationSlaResponseSchema,
  moderationSlaWebhookPayloadSchema,
  type ModerationSlaSummary,
} from '@couture/api-client/contracts/http'
import { test as base, expect } from '../support/fixtures/merged-fixtures'
import { checkA11y } from '../support/helpers/accessibility'
import { isNonLocalEnvironment, isProdEnvironment } from '../support/helpers/api-test'
import { seedWebSession } from '../support/helpers/commerce-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  newRunId,
  seedMember,
  seedPost,
  seedPostReport,
} from '../../apps/api/integration/helpers/moderation-queue-seed'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const SLA_URL = '/moderation/sla'
const SLA_API = '**/api/v1/moderation/sla'
const HOUR = 3_600_000
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '../../_bmad-output/test-artifacts/story-6-12'
)
/** One sweep interval, its channel time, and a margin for a slow CI start. */
const DELIVERY_TIMEOUT_MS = 150_000

let prismaClient: PrismaClient | undefined
const databaseClient = () =>
  (prismaClient ??= new PrismaClient({ datasources: { db: { url: databaseUrl } } }))

/** One open post case with one report due at `dueAt`. Ids carry the run id. */
function slaSeed(prisma: PrismaClient) {
  const runId = newRunId()
  let sequence = 0
  return {
    runId,
    operator: () => seedMember(prisma, runId, `operator${++sequence}`, { alias: false }),
    async postCase(dueAt: Date) {
      const label = `c${++sequence}`
      const now = new Date()
      const author = await seedMember(prisma, runId, `${label}a`)
      const reporter = await seedMember(prisma, runId, `${label}r`, { alias: false })
      const post = await seedPost(prisma, { runId, label, authorId: author.id, now })
      const report = await seedPostReport(prisma, {
        runId,
        label,
        postId: post.id,
        reporterId: reporter.id,
        reason: 'harassment',
        createdAt: new Date(dueAt.getTime() - 24 * HOUR),
        dueAt,
      })
      return { caseId: `post.${post.id}`, postId: post.id, reportId: report.id }
    },
  }
}

type Seed = ReturnType<typeof slaSeed>
const test = base.extend<{ prisma: PrismaClient; fx: Seed; moderator: { id: string } }>({
  prisma: async ({}, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Seeding needs direct database access, which a preview run does not have.'
    )
    await use(databaseClient())
  },
  fx: async ({ prisma }, use) => {
    const seed = slaSeed(prisma)
    await use(seed)
    // A look left published here takes a slot on the first feed page.
    await prisma.lookbookPost.updateMany({
      where: { id: { startsWith: `${seed.runId}-` }, status: 'published' },
      data: { status: 'withdrawn' },
    })
  },
  moderator: async ({ fx }, use) => {
    await use(await fx.operator())
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

const signInAs = (
  page: Page,
  userId: string,
  role: 'moderator' | 'admin' = 'moderator'
) => seedWebSession(page.context(), localE2EAccessToken(userId, role))

/** Reports close at the end of a test, so later specs walking the queue do not meet them. */
async function closeCase(prisma: PrismaClient, postId: string) {
  await prisma.communityPostReport.updateMany({
    where: { post_id: postId, resolved_at: null },
    data: { resolved_at: new Date() },
  })
}

function staleSummary(overrides: Partial<ModerationSlaSummary> = {}) {
  const now = new Date().toISOString()
  return moderationSlaResponseSchema.parse({
    data: {
      serverNow: now,
      monitor: {
        lastSweepAt: new Date(Date.now() - HOUR).toISOString(),
        stale: true,
        channel: 'console',
      },
      queue: { onTrack: 12, atRisk: 3, breached: 1, escalated: 1, oldestDueAt: now },
      resolution: { windowDays: 7, resolved: 40, withinSla: 38, late: 2 },
      alerts: { pending: 2, failing: 1, consoleOnly: 4 },
      screening: { oldestPendingReviewAt: now },
      recentAlerts: [
        {
          id: 'alert-breached',
          kind: 'breached',
          caseId: 'orphan-post.some_report-id',
          source: 'post',
          risk: 'high',
          slaDueAt: now,
          detectedAt: now,
          delivery: 'pending',
          attempts: 4,
          lastErrorCode: 'http_5xx',
          deliveredAt: null,
        },
        {
          id: 'alert-escalated',
          kind: 'escalated',
          caseId: 'comment.some-comment',
          source: 'comment',
          risk: 'medium',
          slaDueAt: now,
          detectedAt: now,
          delivery: 'delivered',
          attempts: 1,
          lastErrorCode: null,
          deliveredAt: now,
        },
      ],
      ...overrides,
    },
  })
}

test.describe('P-SLA: the real sweep, the real channel, the real page', () => {
  test.describe.configure({ timeout: DELIVERY_TIMEOUT_MS + 60_000 })

  test('[P0] P-SLA-REAL-DELIVERY the worker process sends all three kinds to a real endpoint', async ({
    page,
    prisma,
    fx,
    moderator,
    webhookRegistry,
  }) => {
    const atRisk = await fx.postCase(new Date(Date.now() + HOUR))
    const breached = await fx.postCase(new Date(Date.now() - HOUR))
    const escalated = await fx.postCase(new Date(Date.now() + 20 * HOUR))

    await signInAs(page, moderator.id)
    await page.goto(`/moderation/cases/${encodeURIComponent(escalated.caseId)}`)
    const panel = page.getByRole('region', { name: 'Decision' })
    await panel.getByRole('radio', { name: /^Escalate/ }).check()
    await panel
      .getByRole('textbox', { name: 'Reason (required)' })
      .fill('Needs a second reader before a ruling.')
    await panel.getByRole('button', { name: 'Apply decision' }).click()
    await expect(page.getByTestId('moderation-decision-outcome')).toBeVisible()

    const delivered = async (caseId: string, kind: string) =>
      webhookRegistry.waitFor(
        webhookTemplate(`${kind} ${caseId}`)
          .matchField('kind', kind)
          .matchField('casePath', `/moderation/cases/${caseId}`)
          .withTimeout(DELIVERY_TIMEOUT_MS)
          .withInterval(2_000)
          .build()
      )
    const [first, second, third] = await Promise.all([
      delivered(atRisk.caseId, 'at_risk'),
      delivered(breached.caseId, 'breached'),
      delivered(escalated.caseId, 'escalated'),
    ])
    for (const webhook of [first, second, third]) {
      const body = moderationSlaWebhookPayloadSchema.parse(webhook.body)
      expect(webhook.method).toBe('POST')
      expect(webhook.headers['idempotency-key']).toBe(body.id)
      // Nothing a member wrote reaches the receiver.
      expect(webhook.rawBody).not.toMatch(/Caption|Snapshot|reporter/i)
    }

    await page.goto(SLA_URL)
    const recent = page.getByRole('region', { name: 'Recent alerts' })
    for (const seeded of [atRisk, breached, escalated]) {
      const row = recent
        .getByRole('article')
        .filter({
          has: page.locator(`a[href="/moderation/cases/${seeded.caseId}"]`),
        })
        .first()
      await expect(row).toContainText('Delivered')
    }
    await expect(page.locator('[data-channel="webhook"]')).toBeVisible()

    for (const seeded of [atRisk, breached, escalated])
      await closeCase(prisma, seeded.postId)
  })

  test('[P0] P-SLA-HOSTED-PATH the stack delivers from community.bootstrap, the production path', () => {
    const launcher = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/start-api-e2e-with-workers.mjs'),
      'utf8'
    )
    // The worker this stack starts, with no general bootstrap beside it, so the delivery above
    // can only have come through the 60-second interval the hosted process runs.
    expect(launcher).toContain("'apps/api/dist/src/workers/community.bootstrap.js'")
    expect(launcher).not.toContain("'apps/api/dist/src/workers/bootstrap.js'")
    expect(launcher).toContain('MODERATION_OPS_WEBHOOK_URL')
  })
})

test.describe('P-SLA: the page', () => {
  test('[P0] P-SLA-JOURNEY a moderator goes from the queue to the dashboard to a case', async ({
    page,
    fx,
    prisma,
    moderator,
  }) => {
    const seeded = await fx.postCase(new Date(Date.now() + 20 * HOUR))
    await signInAs(page, moderator.id)
    await page.goto('/moderation')
    await page.getByRole('link', { name: 'SLA dashboard' }).click()
    await expect(page).toHaveURL(/\/moderation\/sla$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'SLA monitoring' })
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Open cases' })).toBeVisible()

    // A real row of this run, linked to its case.
    await prisma.moderationSlaAlert.create({
      data: {
        dedupe_key: `sla:post:${seeded.reportId}:journey`,
        kind: 'breached',
        case_key: seeded.caseId,
        source: 'post',
        anchor_report_id: seeded.reportId,
        risk: 'high',
        sla_due_at: new Date(),
        detected_at: new Date(Date.now() + HOUR),
        next_attempt_at: new Date(Date.now() + 24 * HOUR),
      },
    })
    await page.reload()
    const link = page.locator(`a[href="/moderation/cases/${seeded.caseId}"]`).first()
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Post case' })).toBeVisible()
    await closeCase(prisma, seeded.postId)
    await prisma.moderationSlaAlert.deleteMany({ where: { case_key: seeded.caseId } })
  })

  test('[P0] P-SLA-AXE passes axe on the live page, in light and dark', async ({
    page,
    moderator,
  }) => {
    await signInAs(page, moderator.id)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto(SLA_URL)
      await expect(page.getByRole('region', { name: 'Open cases' })).toBeVisible()
      await checkA11y(page, {
        includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      })
    }
  })

  for (const [name, status, body, expected] of [
    [
      'disabled',
      503,
      { statusCode: 503, code: 'moderation_sla_disabled', message: 'x' },
      'SLA monitoring is turned off.',
    ],
    ['error', 500, { message: 'x' }, 'SLA monitoring is unavailable. Try again.'],
  ] as const) {
    test(
      `[P0] P-SLA-AXE passes axe on the ${name} state, in light and dark`,
      { annotation: [{ type: 'skipNetworkMonitoring' }] },
      async ({ page, moderator, interceptNetworkCall }) => {
        await signInAs(page, moderator.id)
        void interceptNetworkCall({
          url: SLA_API,
          fulfillResponse: { status, body },
        })
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await page.goto(SLA_URL)
          await expect(page.getByText(expected)).toBeVisible()
          await expect(page.getByRole('region', { name: 'Open cases' })).toHaveCount(0)
          await checkA11y(page, {
            includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          })
        }
      }
    )
  }

  test('[P1] P-SLA-STALE-UI shows the banner and keeps the page usable', async ({
    page,
    moderator,
    interceptNetworkCall,
  }) => {
    await signInAs(page, moderator.id)
    void interceptNetworkCall({
      url: SLA_API,
      fulfillResponse: { status: 200, body: staleSummary() },
    })
    await page.goto(SLA_URL)
    const banner = page.locator('[data-monitor-stale="true"]')
    await expect(banner).toContainText('No alerts are going out')
    await expect(page.locator('[data-channel="console"]')).toContainText(
      'nobody is notified'
    )
    await expect(page.getByRole('status')).toHaveText(
      'The monitor stopped running. No alerts are going out.'
    )
    await expect(
      page.locator('a[href="/moderation/cases/orphan-post.some_report-id"]')
    ).toBeVisible()
    await checkA11y(page, {
      includeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    })
  })

  test('[P1] P-SLA-STABLE an auto refresh with equal data announces nothing and moves nothing', async ({
    page,
    moderator,
    interceptNetworkCall,
  }) => {
    const body = staleSummary({
      monitor: {
        lastSweepAt: new Date().toISOString(),
        stale: false,
        channel: 'webhook',
      },
    })
    let reads = 0
    void interceptNetworkCall({
      url: SLA_API,
      handler: async (route) => {
        reads += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      },
    })
    await page.clock.install()
    await signInAs(page, moderator.id)
    await page.goto(SLA_URL)
    const heading = page.getByRole('heading', { name: 'Recent alerts' })
    await expect(heading).toBeVisible()
    const before = await heading.boundingBox()
    await expect(page.getByRole('status')).toHaveText('')
    await page.clock.fastForward(60_000)
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('status')).toHaveText('')
    expect(await heading.boundingBox()).toEqual(before)
  })

  for (const [label, width] of [
    ['mobile', 375],
    ['desktop', 1280],
  ] as const) {
    test(`[P1] P-SLA-THEMES-WIDTHS ${label}: no overflow, 44-pixel targets, in light and dark`, async ({
      page,
      moderator,
      interceptNetworkCall,
    }) => {
      await signInAs(page, moderator.id)
      void interceptNetworkCall({
        url: SLA_API,
        fulfillResponse: { status: 200, body: staleSummary() },
      })
      await page.setViewportSize({ width, height: 900 })
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await page.goto(SLA_URL)
        await expect(page.locator('[data-monitor-stale="true"]')).toBeVisible()
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        expect(overflow, `${label} ${colorScheme}`).toBeLessThanOrEqual(0)
        const main = page.locator('main')
        const controls = main.locator('a, button')
        for (const control of await controls.all()) {
          const box = await control.boundingBox()
          expect(box?.height ?? 0, await control.innerText()).toBeGreaterThanOrEqual(44)
        }
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `sla-stale-${label}-${colorScheme}.png`),
          fullPage: true,
        })
      }
    })
  }

  // The longest catalog and a second one. The app reads the browser language.
  for (const locale of ['de-DE', 'pt-PT'] as const) {
    test.describe(locale, () => {
      test.use({ locale })

      test(`[P1] P-SLA-LOCALE ${locale} renders no key text and no clipped label`, async ({
        page,
        moderator,
        interceptNetworkCall,
      }) => {
        const catalog = JSON.parse(
          fs.readFileSync(
            path.resolve(__dirname, `../../apps/web/src/i18n/locales/${locale}.json`),
            'utf8'
          )
        ) as { moderation: { sla: { title: string } } }
        await signInAs(page, moderator.id)
        void interceptNetworkCall({
          url: SLA_API,
          fulfillResponse: { status: 200, body: staleSummary() },
        })
        await page.setViewportSize({ width: 375, height: 900 })
        await page.goto(SLA_URL)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          catalog.moderation.sla.title
        )
        await expect(page.locator('[data-monitor-stale="true"]')).toBeVisible()
        expect(await page.locator('main').innerText()).not.toMatch(
          /moderation\.sla\.|\{\{/
        )
        const clipped = await page.locator('main').evaluate((root) =>
          Array.from(root.querySelectorAll('h1, h2, dt, a, button, span'))
            .filter(
              (node) =>
                // A screen-reader heading is one pixel wide by design.
                !node.closest('.sr-only') &&
                node.scrollWidth > node.clientWidth + 1 &&
                getComputedStyle(node).overflow !== 'visible'
            )
            .map((node) => node.outerHTML.slice(0, 200))
        )
        expect(clipped).toEqual([])
      })
    })
  }

  test('[P1] P-SLA-KEYBOARD tab order runs through the page with a visible focus ring', async ({
    page,
    moderator,
    interceptNetworkCall,
  }) => {
    await signInAs(page, moderator.id)
    void interceptNetworkCall({
      url: SLA_API,
      fulfillResponse: { status: 200, body: staleSummary() },
    })
    await page.goto(SLA_URL)
    await expect(page.locator('[data-monitor-stale="true"]')).toBeVisible()
    const order: string[] = []
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        if (!element || !element.closest('main')) return null
        const style = getComputedStyle(element)
        return {
          label: element.textContent?.trim() ?? '',
          ring: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
        }
      })
      if (!focused) continue
      expect(focused.ring, focused.label).toBe(true)
      order.push(focused.label)
    }
    expect(order.slice(0, 4)).toEqual([
      'Refresh',
      'Back to queue',
      'Open case',
      'Open case',
    ])
  })
})
