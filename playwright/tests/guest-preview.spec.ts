// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16: the web guest preview end to end on the local stack.
// W-GATE-*, W-NO-PROTECTED-CALLS, W-NAV-HISTORY, W-RELOAD-RESUME, W-RAPID-CHANGES,
// W-GATE-TAMPER, E-NO-DB-WRITES, E-GATE-SERVER-WINS, T-NO-PAGEVIEW, T-BEFORE-ELIGIBILITY,
// L-MEMBER-OPENS-PREVIEW and the AC2 timing record.
import fs from 'node:fs'
import path from 'node:path'
import type { Page, Request } from '@playwright/test'
import { SAMPLE_CATALOG } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { buildUniqueId, resolveApiBaseUrl } from '../support/helpers/api-test'
import {
  isAllowedGuestPreviewRequest,
  isVercelPreviewToolbarRequest,
} from '../support/helpers/guest-preview-requests'
import {
  commerceAccessToken,
  createLocationForUser,
  seedWebSession,
  signUpCommerceUser,
} from '../support/helpers/commerce-session'

const STORAGE_KEY = 'couturecast.guest-preview'
const LABEL =
  'Sample wardrobe. Example weather and outfits, not your closet or live forecast.'

type CapturedEvent = { event: string; properties: Record<string, unknown> }

/**
 * E1: every request the guest page makes is recorded. `isAllowedGuestPreviewRequest`
 * allows only the safe methods GET, HEAD and OPTIONS to the web origin outside `/api/`,
 * GET, HEAD and POST to the web origin's `/ingest/` PostHog proxy (a keyed build such as
 * production loads the SDK bundle and sends guest_preview_* batches there; their content
 * is proven by the analytics wire test), plus the Vercel toolbar on a preview deployment.
 * Anything else (the API origin, the Supabase origin, any other host, or a write to any
 * other path) lands in `offAllowlist`, so a direct browser write cannot slip past.
 */
function recordRequests(page: Page, webOrigin: string) {
  const all: Request[] = []
  const offAllowlist: string[] = []
  page.on('request', (request) => {
    all.push(request)
    if (
      isAllowedGuestPreviewRequest(
        { method: request.method(), url: request.url() },
        webOrigin
      )
    )
      return
    const url = new URL(request.url())
    offAllowlist.push(`${request.method()} ${url.origin}${url.pathname}`)
  })
  return { all, offAllowlist, webOrigin }
}

async function enableAnalyticsHook(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as {
      __enableAnalyticsTestHook?: boolean
      __capturedAnalyticsEvents?: unknown[]
    }
    target.__enableAnalyticsTestHook = true
    target.__capturedAnalyticsEvents = []
  })
}

const capturedEvents = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __capturedAnalyticsEvents?: CapturedEvent[] })
        .__capturedAnalyticsEvents ?? []
  )

/**
 * Every POST the page made, as method and URL. The Vercel preview toolbar's own login check
 * (vercel run 43738587377) is the deployment's traffic, not the page's, so it is left out on a
 * preview origin only.
 */
const posts = (requests: { all: Request[]; webOrigin: string }) =>
  requests.all
    .filter(
      (request) =>
        request.method() === 'POST' &&
        !isVercelPreviewToolbarRequest({ url: request.url() }, requests.webOrigin)
    )
    .map((request) => `POST ${request.url()}`)

async function passGate(page: Page, birthdate = '2000-01-15') {
  await page.getByTestId('guest-preview-birthdate').fill(birthdate)
  await page.getByTestId('guest-preview-gate-submit').click()
}

/** The radios are visually hidden; a person clicks the label, so the test does too. */
const choose = (page: Page, testId: string) =>
  page.locator(`label:has([data-testid="${testId}"])`).click()

const garmentIds = (page: Page) =>
  page
    .getByTestId('guest-preview-garment')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.garmentId))

async function expectPageFitsWidth(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions).toEqual({ viewport: width, content: width })
}

test.describe('Guest preview (signed out)', () => {
  test.use({ authSessionEnabled: false })

  test('[P0] [UX-FIRST-001] a phone visitor can find and edit a sample outfit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const teaser = page.getByRole('region', { name: 'Sample outfit' })
    const entry = teaser.getByRole('link', { name: 'Try a sample wardrobe' })
    await expect(teaser.getByRole('heading', { name: 'Sample outfit' })).toBeInViewport({
      ratio: 1,
    })
    await expect(teaser.getByText(LABEL, { exact: true })).toBeInViewport({ ratio: 1 })
    await expect(entry).toBeInViewport({ ratio: 1 })
    await entry.click()
    await passGate(page)

    const outfit = page.getByTestId('guest-preview-outfit')
    const nextLook = outfit.getByRole('button', { name: 'Try another look' })
    await expect(outfit.getByRole('heading', { name: 'Office oxford' })).toBeInViewport({
      ratio: 1,
    })
    const weather = outfit.getByTestId('guest-preview-weather-chip')
    await expect(weather).toHaveText('Mild and dry')
    await expect(weather).toBeInViewport({ ratio: 1 })
    await expect(nextLook).toBeInViewport({ ratio: 1 })

    const explanation = outfit.getByTestId('guest-preview-explanation')
    await expect(outfit.getByText('Loafers', { exact: true })).toBeVisible()
    await outfit.getByRole('button', { name: 'Swap shoes: Loafers' }).click()
    await page.getByRole('dialog').getByRole('radio', { name: 'White sneakers' }).click()
    await expect(outfit.getByText('White sneakers', { exact: true })).toBeVisible()
    await expect(outfit.getByText('Loafers', { exact: true })).toHaveCount(0)
    await expect(explanation).toContainText('You chose White sneakers')

    await outfit.getByRole('button', { name: 'Undo swaps' }).click()
    await expect(outfit.getByText('Loafers', { exact: true })).toBeVisible()
    await expect(explanation).not.toContainText('You chose White sneakers')

    await nextLook.click()
    await expect(outfit.getByRole('heading', { name: 'Silk midi' })).toBeVisible()
    await expect(outfit.getByText('Midi skirt', { exact: true })).toBeVisible()
    await expect(outfit.getByText('Loafers', { exact: true })).toHaveCount(0)
    await expect(explanation).toContainText('It is mild enough to skip an outer layer.')
  })

  test('[P0] [UX-FIRST-002] adding a garment from the preview asks the guest to create an account', async ({
    page,
  }) => {
    await page.goto('/preview')
    await passGate(page)
    await page.getByRole('button', { name: 'Try another look' }).click()
    const editedOutfit = page.getByRole('heading', { name: 'Silk midi' })
    await expect(editedOutfit).toBeVisible()
    const add = page.getByRole('region', { name: 'Add your own garment' })
    await expect(add).toContainText('Create an account to add your clothes')
    await add.getByRole('link', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/signup\?from=preview$/)
    await page.getByRole('link', { name: 'Back to preview' }).click()
    await expect(editedOutfit).toBeVisible()
  })

  test('[P1] [UX-FIRST-004] the first outfit actions fit at 320 px with enlarged text', async ({
    page,
  }) => {
    const width = 320
    await page.setViewportSize({ width, height: 760 })
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = '200%'
      })
    })
    await page.goto('/')
    await expect(page.locator('html')).toHaveCSS('font-size', '32px')

    const teaser = page.getByRole('region', { name: 'Sample outfit' })
    const entry = teaser.getByRole('link', { name: 'Try a sample wardrobe' })
    await expect(teaser.getByText(LABEL, { exact: true })).toBeVisible()
    await entry.scrollIntoViewIfNeeded()
    await expect(entry).toBeInViewport({ ratio: 1 })
    await expectPageFitsWidth(page, width)
    await entry.click()
    await passGate(page)

    const outfit = page.getByTestId('guest-preview-outfit')
    const nextLook = outfit.getByRole('button', { name: 'Try another look' })
    await expect(outfit.getByRole('heading', { name: 'Office oxford' })).toBeVisible()
    await nextLook.scrollIntoViewIfNeeded()
    await expect(nextLook).toBeInViewport({ ratio: 1 })
    await expectPageFitsWidth(page, width)
  })

  test('[P0] [6.16-E2E-001] the gate blocks under-13 with no request, no storage and no event', async ({
    page,
  }) => {
    await enableAnalyticsHook(page)
    await page.goto('/preview')
    const requests = recordRequests(page, new URL(page.url()).origin)
    await passGate(page, '2020-01-01')
    await expect(page.getByTestId('guest-preview-gate-error')).toHaveText(
      'You must be 13 or older'
    )
    await expect(page.getByTestId('guest-preview-birthdate')).toHaveValue('')
    await expect(page.getByTestId('guest-preview-outfit')).toHaveCount(0)
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    ).toBeNull()
    expect(requests.offAllowlist).toEqual([])
    // PR 236 review: /ingest/ is on the allowlist for keyed builds, so the refused gate is
    // also held to no POST at all: no SDK event or batch leaves for an under-13 visitor.
    expect(posts(requests)).toEqual([])
    expect(await capturedEvents(page)).toEqual([])
  })

  test('[P0] [6.16-E2E-002] a full guest journey talks only to the web origin', async ({
    page,
  }, testInfo) => {
    const webOrigin = new URL(testInfo.project.use.baseURL ?? page.url()).origin
    const requests = recordRequests(page, webOrigin)
    await page.goto('/preview')
    // Nothing is sent before eligibility, even to the /ingest/ proxy (PR 236 review).
    await expect(page.getByTestId('guest-preview-gate')).toBeVisible()
    expect(posts(requests)).toEqual([])
    await passGate(page)
    await expect(page.getByTestId('guest-preview-label')).toHaveText(LABEL)
    await choose(page, 'guest-preview-thermal-cold')
    await page.getByTestId('guest-preview-swap-shoes').click()
    await page.getByTestId('guest-preview-swap-option-white-sneakers').click()
    await page.getByTestId('guest-preview-try-another').click()
    await page.getByTestId('guest-preview-nav-preferences').click()
    await page.getByTestId('guest-preview-vote-like').first().click()
    await page.getByTestId('guest-preview-nav-wardrobe').click()
    await page.getByTestId('guest-preview-item').first().click()
    await page.keyboard.press('Escape')
    expect(requests.all.length).toBeGreaterThan(0)
    expect(requests.offAllowlist).toEqual([])
    expect(requests.all.filter((request) => request.url().includes('sample:'))).toEqual(
      []
    )
    // Row counts run in the serial real-session lane with its own database
    // (guest-preview-real-session.spec.ts), where nothing else writes in parallel.
  })

  test('[P0] [6.16-E2E-003] controls change the outfit and its explanation together (AC2)', async ({
    page,
  }) => {
    await page.goto('/preview')
    await passGate(page)
    await expect
      .poll(() => garmentIds(page))
      .toEqual(['sample:g:oxford-shirt', 'sample:g:dark-jeans', 'sample:g:loafers'])
    await choose(page, 'guest-preview-thermal-cold')
    await expect.poll(async () => (await garmentIds(page))[0]).toBe('sample:g:fleece-zip')
    await expect(page.getByTestId('guest-preview-explanation')).toContainText(
      'Fleece zip jacket adds warmth below 59°F.'
    )
    await choose(page, 'guest-preview-weather-cool-windy')
    await choose(page, 'guest-preview-wind-high')
    await choose(page, 'guest-preview-wind-medium')
    await choose(page, 'guest-preview-thermal-warm')
    // W-RAPID-CHANGES: the screen settles on the policy result for the last state.
    await expect
      .poll(async () => (await garmentIds(page))[0])
      .toBe('sample:g:trench-coat')
    await expect(page.getByTestId('guest-preview-explanation')).toContainText(
      'Trench coat'
    )
  })

  test('[P1] [6.16-E2E-004] Back and Forward move between surfaces and a reload resumes the preview', async ({
    page,
  }) => {
    await page.goto('/preview')
    await passGate(page)
    await choose(page, 'guest-preview-thermal-cold')
    await page.getByTestId('guest-preview-nav-wardrobe').click()
    await expect(page).toHaveURL(/\/preview\?view=wardrobe$/)
    await expect(page.getByTestId('guest-preview-wardrobe')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('guest-preview-outfit')).toBeVisible()
    await page.goForward()
    await expect(page.getByTestId('guest-preview-wardrobe')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('guest-preview-wardrobe')).toBeVisible()
    await page.getByTestId('guest-preview-back-to-outfit').click()
    await expect.poll(async () => (await garmentIds(page))[0]).toBe('sample:g:fleece-zip')
  })

  test('[P0] [6.16-E2E-005] forged or stale stored state shows the gate again (W-GATE-TAMPER)', async ({
    page,
  }) => {
    await page.goto('/preview')
    await passGate(page)
    await expect(page.getByTestId('guest-preview-outfit')).toBeVisible()
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        eligibility: { expiresAt: number }
      }
      state.eligibility.expiresAt += 7 * 24 * 60 * 60 * 1000
      localStorage.setItem(key, JSON.stringify(state))
    }, STORAGE_KEY)
    await page.reload()
    await expect(page.getByTestId('guest-preview-gate')).toBeVisible()
  })

  test('[P0] [6.16-E2E-010] the gate turns on the 13th birthday in the visitor’s own date', async ({
    page,
  }) => {
    await page.goto('/preview')
    // The browser's local calendar date, the one the gate reads, at run time.
    const [birthdayTomorrow, birthdayToday] = await page.evaluate(() => {
      const iso = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const today = new Date()
      const tomorrow = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1
      )
      return [
        iso(
          new Date(tomorrow.getFullYear() - 13, tomorrow.getMonth(), tomorrow.getDate())
        ),
        iso(new Date(today.getFullYear() - 13, today.getMonth(), today.getDate())),
      ]
    })
    await passGate(page, birthdayTomorrow)
    await expect(page.getByTestId('guest-preview-gate-error')).toHaveText(
      'You must be 13 or older'
    )
    await expect(page.getByTestId('guest-preview-outfit')).toHaveCount(0)
    await passGate(page, birthdayToday)
    await expect(page.getByTestId('guest-preview-outfit')).toBeVisible()
  })

  test(
    '[P0] [6.16-E2E-011] a server age refusal at signup wins over the preview gate (E-GATE-SERVER-WINS)',
    // The 403 is the scenario under test, so the failed-request monitor stays off here.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page }) => {
      await page.goto('/preview')
      await passGate(page)
      await page.getByTestId('guest-preview-create-account').click()
      await expect(page).toHaveURL(/\/signup\?from=preview$/)
      expect(
        await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
      ).not.toBeNull()
      // The client rule passes this birthdate; the server refuses it with the body the API's
      // ForbiddenException sends, as it would on a clock or rule mismatch.
      await page.route('**/api/v1/auth/signup', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 403,
            message: 'You must be 13 or older',
            error: 'Forbidden',
          }),
        })
      )
      await page.getByLabel('Email').fill('guest-preview-server-refusal@example.test')
      await page.getByLabel('Birthdate').fill('2000-01-15')
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.getByText('You must be 13 or older').first()).toBeVisible()
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
        .toBeNull()
      await page.getByTestId('signup-back-to-preview').click()
      await expect(page.getByTestId('guest-preview-gate')).toBeVisible()
    }
  )

  test('[P0] [6.16-E2E-006] signup under 13 from the preview discards it (client age check)', async ({
    page,
  }) => {
    await page.goto('/preview')
    await passGate(page)
    await page.getByTestId('guest-preview-create-account').click()
    await expect(page).toHaveURL(/\/signup\?from=preview$/)
    await page.getByLabel('Email').fill('guest-preview-kid@example.test')
    await page.getByLabel('Birthdate').fill('2020-01-01')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('You must be 13 or older').first()).toBeVisible()
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
      .toBeNull()
    await page.getByTestId('signup-back-to-preview').click()
    await expect(page.getByTestId('guest-preview-gate')).toBeVisible()
  })

  test('[P0] [6.16-E2E-007] guest analytics start after the gate and no page view names the preview', async ({
    page,
  }) => {
    await enableAnalyticsHook(page)
    await page.goto('/preview')
    await passGate(page, '2010-02-30')
    expect(await capturedEvents(page)).toEqual([])
    await passGate(page)
    await choose(page, 'guest-preview-thermal-cold')
    const events = await capturedEvents(page)
    expect(events.map((event) => event.event)).toEqual([
      'guest_preview_started',
      'guest_preview_interacted',
    ])
    expect(events[1]?.properties).toEqual({
      platform: 'web',
      catalog_version: SAMPLE_CATALOG.catalogVersion,
      action: 'control_changed',
      control: 'thermal',
    })
    expect(events.some((event) => event.event.startsWith('$page'))).toBe(false)
    expect(
      events.some((event) =>
        [
          'profile_completed',
          'first_outfit_generated',
          'wardrobe_onboarding_completed',
        ].includes(event.event)
      )
    ).toBe(false)
  })

  test('[P1] [6.16-E2E-008] AC2: input to updated result stays under 200 ms at p95 over 30 changes', async ({
    page,
  }, testInfo) => {
    await page.goto('/preview')
    const start = Date.now()
    await passGate(page)
    await expect(page.getByTestId('guest-preview-outfit')).toBeVisible()
    const firstUseful = Date.now() - start
    const controls = [
      'guest-preview-thermal-cold',
      'guest-preview-thermal-warm',
      'guest-preview-weather-cool-windy',
      'guest-preview-weather-warm-rainy',
      'guest-preview-weather-mild-dry',
      'guest-preview-thermal-neutral',
    ]
    const samples = await page.evaluate(async (ids) => {
      const durations: number[] = []
      for (let index = 0; index < 30; index += 1) {
        const id = ids[index % ids.length] as string
        const before = document.querySelector(
          '[data-testid="guest-preview-explanation"]'
        )?.textContent
        const input = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)
        const started = performance.now()
        input?.click()
        await new Promise<void>((resolve) => {
          const check = () => {
            const now = document.querySelector(
              '[data-testid="guest-preview-explanation"]'
            )?.textContent
            if (now !== before || performance.now() - started > 1000) resolve()
            else requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        })
        durations.push(performance.now() - started)
      }
      return durations
    }, controls)
    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] as number
    const record = {
      story: '6.16',
      browser: testInfo.project.name,
      changes: samples.length,
      p95Ms: Math.round(p95),
      maxMs: Math.round(sorted.at(-1) as number),
      firstUsefulPreviewMs: firstUseful,
    }
    await testInfo.attach('ac2-timing.json', {
      body: JSON.stringify(record, null, 2),
      contentType: 'application/json',
    })
    const directory = process.env.STORY616_EVIDENCE_DIR
    if (directory) {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(
        path.join(directory, 'ac2-web-timing.json'),
        JSON.stringify(record, null, 2)
      )
    }
    expect(p95).toBeLessThanOrEqual(200)
    expect(firstUseful).toBeLessThanOrEqual(2000)
  })
})

// A real signed-up member with the local token, which only the local stack's identity
// parser accepts; so @local-lane. The location lets Home load its ritual without a 400.
test.describe('Guest preview (member) @local-lane', () => {
  test.use({ authSessionEnabled: false })

  test('[P0] [6.16-E2E-009] a signed-in member opening /preview returns to the app', async ({
    page,
    request,
  }, testInfo) => {
    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommerceUser(
      request,
      apiBaseUrl,
      'guest-preview-member',
      buildUniqueId('web', testInfo)
    )
    await createLocationForUser(request, apiBaseUrl, userId)
    await seedWebSession(page, commerceAccessToken(userId))
    await page.goto('/preview')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('guest-preview-gate')).toHaveCount(0)
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    ).toBeNull()
  })
})
