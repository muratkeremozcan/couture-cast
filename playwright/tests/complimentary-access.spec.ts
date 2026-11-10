// Story 6.14 TEA (TEA-15): complimentary full access, end to end, with every member flag
// off globally. Runs only through `npm run test:pw-complimentary`, which owns the
// database (scripts/e2e-complimentary/run.mjs); every other config ignores this file.
//
// The grant and the revoke run through the real operator command against that
// database. A non-grantee control in the same run sees every locked state, which is
// what makes a pass prove the override and not the seed.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import pg from 'pg'
import { COMPLIMENTARY_MEMBER_FLAGS } from '../../packages/config/src/flags'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { authHeaders, createBirthdate } from '../support/helpers/api-test'
import { commerceAccessToken, seedWebSession } from '../support/helpers/commerce-session'
import {
  loadCommunityFixture,
  publishCommunityLook,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'
import { ensurePremiumSeedLocation } from '../support/helpers/premium-session'

const repoRoot = path.resolve(__dirname, '../..')
const databaseUrl = process.env.COMPLIMENTARY_E2E_DATABASE_URL ?? ''
const apiBaseUrl = process.env.API_BASE_URL ?? ''
const ACCESS_PATH = '/api/v1/commerce/premium/access'
const THEME_PATH = '/api/v1/commerce/premium/theme'
const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const FEED_PATH = '/api/v1/community/feed'
const ALLOCATE_PATH = '/api/v1/community/posts/allocate'

const COPY = {
  complimentary: 'You have complimentary Premium access from CoutureCast.',
  none: "You don't have a Premium subscription yet.",
  feedDisabled: 'The community feed is temporarily unavailable.',
}
const SUBSCRIBE_CONTROLS = ['premium-subscribe-monthly', 'premium-subscribe-annual']
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

type Account = { userId: string; email: string }
const run = {
  grantee: null as Account | null,
  control: null as Account | null,
  admin: '',
}

if (!/\/tea_cc614_e2e_[a-f0-9]{32}$/.test(databaseUrl))
  throw new Error('complimentary-access.spec.ts runs only on its owned database.')

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return (await client.query<T>(text, values)).rows
  } finally {
    await client.end()
  }
}

/** The real operator command, against this run's database only. */
function accessCommand(args: string[]) {
  const envFile = path.join(os.tmpdir(), `cc614-e2e-${randomUUID()}.env`)
  fs.writeFileSync(envFile, `DATABASE_URL="${databaseUrl}"\n`, { mode: 0o600 })
  try {
    return execFileSync(
      path.join(repoRoot, 'node_modules/.bin/tsx'),
      [
        '--tsconfig',
        'apps/api/tsconfig.json',
        'scripts/complimentary-access.ts',
        ...args,
        '--env-file',
        envFile,
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } finally {
    fs.rmSync(envFile, { force: true })
  }
}

async function signUp(request: APIRequestContext, label: string): Promise<Account> {
  const email = `cc614-${label}-${randomUUID().slice(0, 12)}@example.com`
  const response = await request.post(`${apiBaseUrl}/api/v1/auth/signup`, {
    data: { email, birthdate: createBirthdate(30) },
  })
  expect(response.status(), await response.text()).toBe(201)
  return { userId: ((await response.json()) as { userId: string }).userId, email }
}

/**
 * Full-page evidence for the owner's pixel review. Written only when a local run sets
 * COMPLIMENTARY_SCREENSHOT_DIR, so CI never writes outside its artifact directory.
 */
async function evidenceShot(page: Page, name: string) {
  const directory = process.env.COMPLIMENTARY_SCREENSHOT_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

async function openSettings(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<unknown> {
  const access = interceptNetworkCall({ method: 'GET', url: `**${ACCESS_PATH}` })
  await page.goto('/settings')
  const answered = await access
  expect(answered.status).toBe(200)
  await waitForAccessibilityReady(page)
  await expect(page.getByTestId('premium-status-line')).toBeVisible()
  return answered.responseJson
}

test.describe.configure({ mode: 'serial' })

test.describe('6.14 complimentary full access, member flags off globally', () => {
  test.beforeAll(async ({ playwright }) => {
    // The stack's launcher seeded the six member flags true. Turn them off globally,
    // the production shape, and leave the kill switch to its code default (true).
    await sql('UPDATE feature_flags SET value = $2::jsonb WHERE key = ANY($1::text[])', [
      [...COMPLIMENTARY_MEMBER_FLAGS],
      'false',
    ])
    await sql('DELETE FROM feature_flags WHERE key = $1', [
      'complimentary_access_enabled',
    ])
    const off = await sql<{ key: string; value: unknown }>(
      'SELECT key, value FROM feature_flags WHERE key = ANY($1::text[]) ORDER BY key',
      [[...COMPLIMENTARY_MEMBER_FLAGS]]
    )
    expect(off.map((row) => row.value)).toEqual(
      COMPLIMENTARY_MEMBER_FLAGS.map(() => false)
    )

    const request = await playwright.request.newContext()
    try {
      run.grantee = await signUp(request, 'grantee')
      run.control = await signUp(request, 'control')
      const admin = await signUp(request, 'owner')
      run.admin = admin.email
      await sql(
        'INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, $3::jsonb)',
        [randomUUID(), admin.email, JSON.stringify({ app_role: 'admin' })]
      )
      for (const account of [run.grantee, run.control])
        await ensurePremiumSeedLocation(request, apiBaseUrl, account.userId)
    } finally {
      await request.dispose()
    }

    const granted = JSON.parse(
      accessCommand([
        'grant',
        '--actor-email',
        run.admin,
        '--member-email',
        run.grantee.email,
        '--reason',
        'Family tester, story 6.14 E2E',
      ])
    ) as { command: string; dryRun: boolean; grantId: string }
    expect(granted).toMatchObject({ command: 'grant', dryRun: false })
    expect(granted.grantId).toBeTruthy()
  })

  for (const viewport of [DESKTOP, MOBILE]) {
    test(`E-FREE-OPENS: a free grantee gets Premium and the community at ${viewport.width} px`, async ({
      page,
      context,
      interceptNetworkCall,
      apiRequest,
      recurse,
    }) => {
      const grantee = run.grantee!
      await page.setViewportSize(viewport)
      await seedWebSession(context, commerceAccessToken(grantee.userId))

      await log.step('Settings show the complimentary state and no subscribe control')
      expect(await openSettings(page, interceptNetworkCall)).toEqual({
        data: { premium: true, source: 'complimentary' },
      })
      await expect(page.getByTestId('premium-status-line')).toHaveText(COPY.complimentary)
      for (const id of SUBSCRIBE_CONTROLS)
        await expect(page.getByTestId(id)).toHaveCount(0)
      await expect(page.getByTestId('premium-disclosure')).toHaveCount(0)
      await evidenceShot(page, `grantee-settings-${viewport.width}`)

      await log.step('The premium theme switch works with premium_themes_enabled off')
      await expect(page.getByTestId('premium-theme-gallery')).toBeVisible()
      await expect(page.getByTestId('premium-theme-locked')).toHaveCount(0)
      await page.getByTestId('premium-theme-gallery').scrollIntoViewIfNeeded()
      await evidenceShot(page, `grantee-theme-gallery-${viewport.width}`)
      const select = interceptNetworkCall({ method: 'PUT', url: `**${THEME_PATH}` })
      await page.getByTestId('premium-theme-option-autumn_umber').click()
      const selected = await select
      expect(selected.status).toBe(200)
      expect(selected.responseJson).toEqual({
        data: { theme: 'autumn_umber', isEntitled: true, themesEnabled: true },
      })
      await recurse(
        () => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        (theme) => theme === 'autumn_umber',
        { timeout: 10_000, log: 'html data-theme is autumn_umber' }
      )
      const reset = interceptNetworkCall({ method: 'PUT', url: `**${THEME_PATH}` })
      await page.getByTestId('premium-theme-option-default').click()
      expect((await reset).status).toBe(200)

      await log.step('The community feed loads on the home page')
      const feed = interceptNetworkCall({ method: 'GET', url: `**${FEED_PATH}*` })
      await page.goto('/')
      expect((await feed).status).toBe(200)
      await expect(page.getByTestId('community-card-grid')).toBeAttached()
      await expect(
        page.getByRole('status').filter({ hasText: COPY.feedDisabled })
      ).toHaveCount(0)

      if (viewport === DESKTOP) {
        await log.step('The planner opens past the premium guard and its flag')
        const planner = await apiRequest({
          method: 'GET',
          path: PLANNER_PATH,
          baseUrl: apiBaseUrl,
          headers: {
            Authorization: `Bearer ${commerceAccessToken(grantee.userId)}`,
            'x-couture-platform': 'web',
          },
        })
        expect(planner.status).toBe(200)

        await log.step(
          'A post publishes through screening with community_write_enabled off'
        )
        const published = await publishCommunityLook(page.request, {
          apiBaseUrl,
          userId: grantee.userId,
          fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
          altText: 'Synthetic plum satin fabric',
          caption: `Complimentary look ${randomUUID().slice(0, 8)}`,
        })
        const terminal = await waitForTerminalAuthorState(
          { apiRequest, recurse },
          { apiBaseUrl, userId: grantee.userId, postId: published.postId }
        )
        expect(terminal.status).toBe('published')
      }
    })
  }

  // Settings is a dark-only member surface by design (the UX spec has no light mode), so one
  // scan per width covers it; a light emulation would only rescan the same palette.
  test('E-A11Y-THEMES: the complimentary state passes axe in dark at both widths', async ({
    page,
    context,
    interceptNetworkCall,
  }, testInfo) => {
    await seedWebSession(context, commerceAccessToken(run.grantee!.userId))
    for (const colorScheme of ['dark'] as const)
      for (const viewport of [DESKTOP, MOBILE]) {
        await log.step(`Scan settings, ${colorScheme}, ${viewport.width} px`)
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await openSettings(page, interceptNetworkCall)
        await expect(page.getByTestId('premium-status-line')).toHaveText(
          COPY.complimentary
        )
        const section = page.getByTestId('premium-subscription-section')
        await section.scrollIntoViewIfNeeded()
        await section.screenshot({
          path: testInfo.outputPath(`complimentary-${colorScheme}-${viewport.width}.png`),
        })
        await checkA11y(page, {
          includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
        })
      }
  })

  test(
    'E-CONTROL-LOCKED: a non-grantee in the same run sees every locked state',
    // The control's 403 feed and 503 allocate are the subject; each is asserted exactly below.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, context, interceptNetworkCall, apiRequest }) => {
      const control = run.control!
      await seedWebSession(context, commerceAccessToken(control.userId))

      expect(await openSettings(page, interceptNetworkCall)).toEqual({
        data: { premium: false, source: 'none' },
      })
      await expect(page.getByTestId('premium-status-line')).toHaveText(COPY.none)
      await expect(page.getByTestId('premium-theme-gallery')).toHaveCount(0)
      await expect(page.getByTestId('premium-disclosure')).toBeVisible()
      for (const viewport of [DESKTOP, MOBILE]) {
        await page.setViewportSize(viewport)
        await openSettings(page, interceptNetworkCall)
        await evidenceShot(page, `control-settings-${viewport.width}`)
      }

      const feed = interceptNetworkCall({ method: 'GET', url: `**${FEED_PATH}*` })
      await page.goto('/')
      const denied = await feed
      expect(denied.status).toBe(403)
      expect(denied.responseJson).toMatchObject({ code: 'denied' })
      // The grid container renders for every signed-in reader; the denial is the status copy.
      await expect(
        page.getByRole('status').filter({ hasText: COPY.feedDisabled })
      ).toBeVisible()

      const headers = {
        Authorization: `Bearer ${commerceAccessToken(control.userId)}`,
        'x-couture-platform': 'web',
      }
      const planner = await apiRequest({
        method: 'GET',
        path: PLANNER_PATH,
        baseUrl: apiBaseUrl,
        headers,
      })
      expect(planner.status).toBe(403)
      const look = loadCommunityFixture('safe-satin-plum-512x512.jpg')
      const allocate = await apiRequest({
        method: 'POST',
        path: ALLOCATE_PATH,
        baseUrl: apiBaseUrl,
        headers: {
          ...authHeaders(control.userId, 'guardian'),
          'x-couture-platform': 'web',
          'Idempotency-Key': randomUUID(),
        },
        body: {
          locale: 'en-US',
          contentType: look.contentType,
          byteSize: look.byteSize,
          sha256: look.sha256,
          widthPx: look.widthPx,
          heightPx: look.heightPx,
        },
        // The 503 is the answer under test; a retry would only repeat it.
        retryConfig: { maxRetries: 0 },
      })
      expect(allocate.status).toBe(503)
    }
  )

  test(
    'E-REVOKE: after a CLI revoke the former grantee is locked on the next request',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, context, interceptNetworkCall }) => {
      const grantee = run.grantee!
      const revoked = JSON.parse(
        accessCommand([
          'revoke',
          '--actor-email',
          run.admin,
          '--member-email',
          grantee.email,
          '--reason',
          'Story 6.14 E2E revoke',
        ])
      ) as { command: string; dryRun: boolean }
      expect(revoked).toMatchObject({ command: 'revoke', dryRun: false })

      await seedWebSession(context, commerceAccessToken(grantee.userId))
      expect(await openSettings(page, interceptNetworkCall)).toEqual({
        data: { premium: false, source: 'none' },
      })
      await expect(page.getByTestId('premium-status-line')).toHaveText(COPY.none)
      await expect(page.getByTestId('premium-theme-gallery')).toHaveCount(0)

      const feed = interceptNetworkCall({ method: 'GET', url: `**${FEED_PATH}*` })
      await page.goto('/')
      expect((await feed).status).toBe(403)
      await expect(
        page.getByRole('status').filter({ hasText: COPY.feedDisabled })
      ).toBeVisible()
    }
  )
})
