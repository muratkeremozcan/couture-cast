// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: P-REFUSED-REAL, P-ERASE-JOURNEY, P-CONSOLE-AFTER, P-DOWNLOAD, P-RANGE, P-REPORTER-ERASED,
// P-FLAG-OFF. A real browser against the real API and workers on the real local Supabase, where the
// application role is the non-superuser `postgres`. That is what makes the refusal here honest.
//
// The stack's community worker sweeps erasure every 30 seconds. The aging helper backdates the request and
// the post under the real guard, and that worker finishes the job. The injected-clock suite owns the edges.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import type { Page } from '@playwright/test'
import { Client } from 'pg'
import {
  moderationErasureResponseSchema,
  moderationEvidenceBundleSchema,
  type ModerationEvidenceBundle,
} from '@couture/api-client/contracts/http'
import { test as base, expect } from '../support/fixtures/merged-fixtures'
import {
  isNonLocalEnvironment,
  isProdEnvironment,
  resolveApiBaseUrl,
} from '../support/helpers/api-test'
import { seedWebSession } from '../support/helpers/commerce-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  newRunId,
  seedMember,
  seedPost,
  seedPostReport,
} from '../../apps/api/integration/helpers/moderation-queue-seed'
import { localDatabaseUrl } from '../../scripts/lib/local-supabase-ports.mjs'

const databaseUrl = process.env.DATABASE_URL ?? localDatabaseUrl()
const HOUR = 3_600_000
const SEVENTY_ONE_HOURS = 71 * HOUR
const ERASURE_PATH = '/api/v1/moderation/erasure-requests'
const EXPORT_PATH = '/api/v1/moderation/evidence-exports'
const REASON = 'Breaks the community rules, as this moderator reads them.'
const REMOVED_LABEL = 'Reason removed by erasure'
/** One sweep interval, a post at a time, and a margin for a slow CI start. */
const SWEEP_TIMEOUT_MS = 120_000

let prismaClient: PrismaClient | undefined
const databaseClient = () =>
  (prismaClient ??= new PrismaClient({ datasources: { db: { url: databaseUrl } } }))

const caseUrl = (caseId: string) => `/moderation/cases/${encodeURIComponent(caseId)}`
const panelOf = (page: Page) => page.getByRole('region', { name: 'Decision' })
const signInAs = (
  page: Page,
  userId: string,
  role: 'moderator' | 'admin' = 'moderator'
) => seedWebSession(page.context(), localE2EAccessToken(userId, role))

function historySeed(prisma: PrismaClient) {
  const runId = newRunId()
  let sequence = 0
  const postIds: string[] = []
  return {
    runId,
    operator: () => seedMember(prisma, runId, `operator${++sequence}`, { alias: false }),
    member: (alias = true) => seedMember(prisma, runId, `member${++sequence}`, { alias }),
    /** A live post with one member's report, holding canaries in every free-text column. */
    async postCase() {
      const label = `h${++sequence}`
      const now = new Date()
      const canaries = {
        caption: `caption-canary-${runId}-${label}`,
        altText: `alt-canary-${runId}-${label}`,
        details: `details-canary-${runId}-${label}`,
      }
      const author = await seedMember(prisma, runId, `${label}a`)
      const reporter = await seedMember(prisma, runId, `${label}r`, { alias: false })
      const post = await seedPost(prisma, {
        runId,
        label,
        authorId: author.id,
        now,
        caption: canaries.caption,
        altText: canaries.altText,
      })
      const report = await seedPostReport(prisma, {
        runId,
        label,
        postId: post.id,
        reporterId: reporter.id,
        reason: 'harassment',
        createdAt: new Date(now.getTime() - HOUR),
        dueAt: new Date(now.getTime() + 23 * HOUR),
        details: canaries.details,
        snapshot: {
          caption: canaries.caption,
          altText: canaries.altText,
          locale: 'en-US',
          climateBand: 'temperate_dry',
          capturedAt: now.toISOString(),
        },
        subjectAlias: author.alias ?? null,
      })
      postIds.push(post.id)
      return {
        caseId: `post.${post.id}`,
        postId: post.id,
        reportId: report.id,
        author,
        reporter,
        canaries,
      }
    },
    /** Closes what this test opened, so later specs walking the queue do not meet it. */
    async cleanUp() {
      await prisma.communityPostReport.updateMany({
        where: { id: { startsWith: `${runId}-` }, resolved_at: null },
        data: { resolved_at: new Date() },
      })
      await prisma.$transaction(async (tx) => {
        for (const id of postIds) {
          await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[${id}]::text[], true)`
          await tx.lookbookPost.updateMany({
            where: { id, status: 'published' },
            data: { status: 'withdrawn' },
          })
        }
      })
    },
  }
}

const test = base.extend<{ prisma: PrismaClient; fx: ReturnType<typeof historySeed> }>({
  prisma: async ({}, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Seeding needs direct database access, which a preview run does not have.'
    )
    await use(databaseClient())
  },
  fx: async ({ prisma }, use) => {
    const seed = historySeed(prisma)
    await use(seed)
    await seed.cleanUp()
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

/** Decides a case the way a moderator does, in the panel, and waits for the route's answer. */
async function decideInBrowser(page: Page, action: RegExp) {
  const panel = panelOf(page)
  await panel.getByRole('radio', { name: action }).check()
  await panel.getByRole('textbox', { name: 'Reason (required)' }).fill(REASON)
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/decisions')
  )
  await panel.getByRole('button', { name: 'Apply decision' }).click()
  expect((await answered).status()).toBe(200)
}

/** The real guard, as the erasure sweep's own transaction takes it. */
async function ageErasure(prisma: PrismaClient, memberId: string, postId: string) {
  const at = new Date(Date.now() - SEVENTY_ONE_HOURS)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[${postId}]::text[], true)`
    await tx.lookbookPost.update({
      where: { id: postId },
      data: { erasure_requested_at: at, image_delete_attempted_at: null },
    })
    await tx.moderationErasureRequest.update({
      where: { member_id: memberId },
      data: { requested_at: at },
    })
  })
}

function recomputeDigest(bundle: ModerationEvidenceBundle): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonical(source[key])])
    )
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          decisions: bundle.decisions,
          reports: bundle.reports,
          auditEvents: bundle.auditEvents,
          alerts: bundle.alerts,
        })
      )
    )
    .digest('hex')
}

/** Presses a control, takes the real browser download, and reads the file as it landed on disk. */
async function downloadVia(page: Page, press: () => Promise<void>) {
  const pending = page.waitForEvent('download')
  await press()
  const download = await pending
  const path = await download.path()
  const text = fs.readFileSync(path, 'utf8')
  return {
    fileName: download.suggestedFilename(),
    text,
    bundle: moderationEvidenceBundleSchema.parse(JSON.parse(text)),
  }
}

test.describe('P-HISTORY: enforcement on the real role', () => {
  test("[P0] P-REFUSED-REAL refuses a browser-made decision to the API's own connection string", async ({
    page,
    prisma,
    fx,
  }) => {
    const seeded = await fx.postCase()
    const moderator = await fx.operator()
    await signInAs(page, moderator.id)
    await page.goto(caseUrl(seeded.caseId))
    await decideInBrowser(page, /^Resolve/)

    const [row] = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(row).toBeDefined()
    const client = new Client({ connectionString: databaseUrl })
    await client.connect()
    try {
      const { rows: role } = await client.query<{ rolsuper: boolean }>(
        'SELECT rolsuper FROM pg_roles WHERE rolname = current_user'
      )
      // Local Supabase's application role. CI runs this job on that stack, so a superuser here is a broken proof.
      if (process.env.CI) expect(role).toEqual([{ rolsuper: false }])
      const read = async () =>
        (
          await client.query<{ doc: string; version: string }>(
            `SELECT row_to_json(d)::text AS doc, xmin::text AS version
             FROM "ModerationDecision" d WHERE id = $1`,
            [row!.id]
          )
        ).rows[0]
      const before = await read()
      // In one rolled-back transaction: on a regression, TRUNCATE would otherwise commit under the
      // parallel workers that share this stack.
      await client.query('BEGIN')
      for (const statement of [
        {
          sql: 'UPDATE "ModerationDecision" SET reason = \'rewritten\' WHERE id = $1',
          values: [row!.id],
        },
        { sql: 'DELETE FROM "ModerationDecision" WHERE id = $1', values: [row!.id] },
        { sql: 'TRUNCATE "ModerationDecision" CASCADE', values: [] },
      ]) {
        await client.query('SAVEPOINT refused')
        await expect(client.query(statement.sql, statement.values)).rejects.toMatchObject(
          {
            code: '42501',
          }
        )
        await client.query('ROLLBACK TO SAVEPOINT refused')
      }
      await client.query('ROLLBACK')
      expect(await read()).toEqual(before)
    } finally {
      await client.end()
    }
  })
})

test.describe('P-HISTORY: account erasure through the real route and the real sweep', () => {
  test.describe.configure({ timeout: SWEEP_TIMEOUT_MS + 90_000 })

  test('[P0] P-ERASE-JOURNEY, P-CONSOLE-AFTER, P-DOWNLOAD erase a member and read what is left', async ({
    page,
    prisma,
    fx,
    request,
    recurse,
  }, testInfo) => {
    const seeded = await fx.postCase()
    const moderator = await fx.operator()
    const admin = await fx.operator()

    // A real decision, with a real audit row, on the member about to go.
    await signInAs(page, moderator.id)
    await page.goto(caseUrl(seeded.caseId))
    await decideInBrowser(page, /^Escalate/)
    const before = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
      orderBy: { sequence: 'asc' },
    })
    expect(before).toHaveLength(1)
    expect(before[0]!.subject_user_id).toBe(seeded.author.id)
    await expect(page.getByText(REASON).first()).toBeVisible()

    const response = await request.post(`${resolveApiBaseUrl(testInfo)}${ERASURE_PATH}`, {
      headers: {
        Authorization: `Bearer ${localE2EAccessToken(admin.id, 'admin')}`,
        'x-couture-platform': 'web',
      },
      data: { memberId: seeded.author.id },
    })
    expect(response.status()).toBe(201)
    const { data } = moderationErasureResponseSchema.parse(await response.json())
    expect(Date.parse(data.deadlineAt) - Date.parse(data.requestedAt)).toBe(72 * HOUR)

    // Identity leaves at commit, ahead of any sweep.
    const atRequest = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: before[0]!.id },
    })
    expect(atRequest.subject_user_id).toBeNull()
    expect(atRequest.reason).toBe('[erased]')
    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: seeded.author.id } })
    ).toBeNull()

    await ageErasure(prisma, seeded.author.id, seeded.postId)
    const completed = await recurse(
      () =>
        prisma.moderationErasureRequest.findUniqueOrThrow({
          where: { member_id: seeded.author.id },
        }),
      (row) => row.completed_at !== null,
      { timeout: SWEEP_TIMEOUT_MS, interval: 2_000 }
    )
    expect(completed.completed_at).not.toBeNull()

    expect(
      await prisma.lookbookPost.findUnique({ where: { id: seeded.postId } })
    ).toBeNull()
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportId },
    })
    expect(report.post_id).toBeNull()
    expect(report.image_object_path).toBeNull()
    const text = JSON.stringify(report.content_snapshot)
    expect(text).not.toContain(seeded.canaries.caption)
    expect(text).not.toContain(seeded.canaries.altText)
    const after = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: before[0]!.id },
    })
    expect(after).toMatchObject({
      action: before[0]!.action,
      sequence: before[0]!.sequence,
      moderator_role: before[0]!.moderator_role,
      decided_at: before[0]!.decided_at,
      subject_alias: before[0]!.subject_alias,
      post_id: null,
    })

    // What a moderator now sees.
    const orphan = `orphan-post.${seeded.reportId}`
    const reader = await fx.operator()
    const readerPage = await page.context().newPage()
    await signInAs(readerPage, reader.id)
    await readerPage.goto(caseUrl(orphan))
    await expect(readerPage.getByText(REMOVED_LABEL).first()).toBeVisible()
    await expect(readerPage.locator('body')).not.toContainText('[erased]')
    await expect(readerPage.locator('body')).not.toContainText(REASON)
    await expect(readerPage.locator('body')).not.toContainText(seeded.canaries.caption)

    // The bundle, off the real download.
    const file = await downloadVia(readerPage, () =>
      readerPage.getByRole('button', { name: 'Export evidence' }).click()
    )
    expect(file.fileName).toBe(`moderation-evidence-${file.bundle.exportId}.json`)
    for (const needle of [
      seeded.author.id,
      seeded.reporter.id,
      seeded.canaries.caption,
      seeded.canaries.altText,
      seeded.canaries.details,
      '[erased]',
      'content_snapshot',
      'image_object_path',
    ])
      expect(file.text, needle).not.toContain(needle)
    expect(file.bundle.decisions[0]).toMatchObject({
      decisionId: before[0]!.id,
      reason: null,
      reasonRemoved: true,
      moderatorId: moderator.id,
    })
    expect(recomputeDigest(file.bundle)).toBe(file.bundle.sha256)
    await expect(
      readerPage.getByRole('status').filter({ hasText: 'SHA-256' })
    ).toContainText(file.bundle.sha256)
    const audits = await prisma.auditLog.findMany({
      where: { user_id: reader.id, event_type: 'moderation_evidence_exported' },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]!.event_data).toMatchObject({
      exportId: file.bundle.exportId,
      sha256: file.bundle.sha256,
      scope: 'case',
    })
    await readerPage.close()
  })

  test('[P0] P-RANGE lets an admin export a period, and refuses a moderator with no audit row', async ({
    page,
    prisma,
    fx,
    request,
  }, testInfo) => {
    const seeded = await fx.postCase()
    const decider = await fx.operator()
    await signInAs(page, decider.id)
    await page.goto(caseUrl(seeded.caseId))
    await decideInBrowser(page, /^Escalate/)

    const admin = await fx.operator()
    const adminPage = await page
      .context()
      .browser()!
      .newContext()
      .then((context) => context.newPage())
    await signInAs(adminPage, admin.id, 'admin')
    await adminPage.goto('/moderation')
    await adminPage.getByRole('link', { name: 'Evidence export' }).click()
    await expect(adminPage).toHaveURL(/\/moderation\/evidence$/)
    // The decision's own day, so a run that crosses UTC midnight still selects it.
    const { decided_at: decidedAt } = await prisma.moderationDecision.findFirstOrThrow({
      where: { case_key: seeded.caseId },
    })
    const today = decidedAt.toISOString().slice(0, 10)
    await adminPage.getByLabel('From (UTC)').fill(today)
    await adminPage.getByLabel('To (UTC)').fill(today)
    const file = await downloadVia(adminPage, () =>
      adminPage.getByRole('button', { name: 'Export period' }).click()
    )
    expect(file.bundle.scope).toMatchObject({ scope: 'range' })
    expect(file.bundle.decisions.map((row) => row.caseId)).toContain(seeded.caseId)
    expect(file.text).not.toContain(seeded.reporter.id)
    expect(file.text).not.toContain(seeded.author.id)
    expect(
      await prisma.auditLog.count({
        where: { user_id: admin.id, event_type: 'moderation_evidence_exported' },
      })
    ).toBe(1)
    await adminPage.context().close()

    const moderator = await fx.operator()
    await signInAs(page, moderator.id)
    await page.goto('/moderation/evidence')
    await expect(
      page.getByRole('alert').filter({ hasText: 'Only an admin can export a period.' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export period' })).toHaveCount(0)
    const refused = await request.post(`${resolveApiBaseUrl(testInfo)}${EXPORT_PATH}`, {
      headers: {
        Authorization: `Bearer ${localE2EAccessToken(moderator.id, 'moderator')}`,
        'x-couture-platform': 'web',
      },
      data: {
        scope: 'range',
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
      },
    })
    expect(refused.status()).toBe(403)
    expect(((await refused.json()) as { code?: string }).code).toBe('admin_required')
    expect(
      await prisma.auditLog.count({
        where: { user_id: moderator.id, event_type: 'moderation_evidence_exported' },
      })
    ).toBe(0)
  })

  test('[P1] P-REPORTER-ERASED keeps a case actionable when its reporter is erased', async ({
    page,
    prisma,
    fx,
    request,
  }, testInfo) => {
    const seeded = await fx.postCase()
    const admin = await fx.operator()
    const response = await request.post(`${resolveApiBaseUrl(testInfo)}${ERASURE_PATH}`, {
      headers: {
        Authorization: `Bearer ${localE2EAccessToken(admin.id, 'admin')}`,
        'x-couture-platform': 'web',
      },
      data: { memberId: seeded.reporter.id },
    })
    expect(response.status()).toBe(201)
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportId },
    })
    expect(report).toMatchObject({ reporter_id: null, details: null, resolved_at: null })

    const moderator = await fx.operator()
    await signInAs(page, moderator.id)
    await page.goto(caseUrl(seeded.caseId))
    await expect(panelOf(page)).toBeVisible()
    await expect(page.locator('body')).not.toContainText(seeded.canaries.details)
    await decideInBrowser(page, /^Resolve/)
    const resolved = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportId },
    })
    expect(resolved.resolved_at).not.toBeNull()
  })
})

test.describe('P-HISTORY: the flag', () => {
  test(
    '[P1] P-FLAG-OFF removes the control and closes the page when the API says it is closed',
    {
      // The closed answer is the state under test, stubbed because the seeded flag is on for every peer.
      annotation: [{ type: 'skipNetworkMonitoring' }],
    },
    async ({ page, fx, interceptNetworkCall }) => {
      const seeded = await fx.postCase()
      const moderator = await fx.operator()
      await signInAs(page, moderator.id)
      const closed = {
        status: 503,
        body: {
          statusCode: 503,
          code: 'moderation_history_disabled',
          message: 'Moderation history is not available.',
        },
      }
      const availability = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/moderation/evidence-exports/availability',
        fulfillResponse: closed,
      })
      await page.goto(caseUrl(seeded.caseId))
      await availability
      await expect(page.getByRole('region', { name: 'Decision' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Export evidence' })).toHaveCount(0)

      const onPage = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/moderation/evidence-exports/availability',
        fulfillResponse: closed,
      })
      await page.goto('/moderation/evidence')
      await onPage
      await expect(
        page.getByRole('alert').filter({ hasText: 'Evidence export is turned off.' })
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Export period' })).toHaveCount(0)
    }
  )
})

test.describe('P-LANG: the page says what language it is in', () => {
  test.use({ locale: 'de-DE' })

  test('[P1] P-LANG names the rendered language on the evidence page, WCAG 3.1.1', async ({
    page,
    fx,
  }) => {
    const admin = await fx.operator()
    await signInAs(page, admin.id, 'admin')
    await page.goto('/moderation/evidence')
    await expect(page.getByRole('heading', { name: 'Nachweisexport' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', /^de\b/)
  })
})
