// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): Looks > Plan at 390 x 664. A free member and a visitor see the
// sample week with one line and one Upgrade inside the fold, an entitled member sees the week,
// no screen shows a Planner lock, Today's Plan your week opens Plan in one click, the old Plan
// addresses redirect on the server, and a guardian-pending teen opens every segment, the detail
// and the capsule manager (7.12-E2E-030..035, 060, 061). Reads come from looks-fixtures.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { waitForShellSettled } from '../support/helpers/app-shell'
import { FOLD_VIEWPORT, foldBand } from '../support/helpers/five-tab'
import {
  openLooksFixture,
  type CapsuleSeed,
  type LookSeed,
} from '../support/helpers/looks-fixtures'
import { bodies, type ShellScreen } from '../support/helpers/shell-fixtures'

// The fixture shell seeds its own bearer; the stored auth session would sign in a real member.
test.use({ authSessionEnabled: false, viewport: FOLD_VIEWPORT })

const LOOKS: LookSeed[] = [
  { id: 'look-a', created: 10, title: 'Rainy commute' },
  { id: 'look-c', created: 30, title: 'Gallery Sunday', source: 'style_piece' },
]
const CAPSULES: CapsuleSeed[] = [{ id: 'capsule-b', created: 20, name: 'Work week' }]
const FREE_LINE = 'Premium plans your whole week around your forecast.'
const OLD_LOCK_IDS = [
  'planner-rail-locked',
  'planner-rail-get-premium',
  'planner-locked',
  'planner-locked-cta',
]
/** The one refusal a free member's Plan answers with. */
const PLANNER_REFUSAL = /^GET 403 \/api\/v1\/commerce\/premium\/planner$/
/** Purchase and entitlement calls a visitor's Upgrade must never make (P5). */
const PURCHASE_OR_ENTITLEMENT =
  /\/api\/v1\/commerce\/(subscription|checkout|purchase|entitlement|premium\/(access|planner))|stripe|revenuecat/i

const segment = (page: Page, id: 'saved' | 'ideas' | 'plan') =>
  page.getByTestId(`looks-segment-${id}`)

/**
 * Tests that expect a refusal opt out of the library monitor; this keeps every other 4xx or 5xx
 * failing the test. Entries read `METHOD STATUS /path`.
 */
function watchHttpErrors(page: Page, expected: RegExp[]) {
  const unexpected: string[] = []
  page.on('response', (response) => {
    if (response.status() < 400) return
    const entry = `${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`
    if (!expected.some((pattern) => pattern.test(entry))) unexpected.push(entry)
  })
  return () => [...unexpected]
}

/**
 * A free account everywhere, not only on Plan: Profile's Premium reads answer as the shell's
 * empty member does (no subscription, no access, no theme). Registered after the fixture, so
 * these answer first.
 */
async function serveFreeAccount(page: Page, memberId: string) {
  const { json } = bodies(memberId, false)
  const reads: [string, string][] = [
    ['commerce/premium/access', 'premium-access'],
    ['commerce/premium/theme', 'premium-theme'],
    ['commerce/subscription', 'subscription'],
  ]
  for (const [path, key] of reads) {
    await page.route(
      (url) => url.pathname.endsWith(`/api/v1/${path}`),
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ json: json[key] })
          : route.fallback()
    )
  }
}

/** A free member: Plan answers Premium required and the account reads say free. */
async function openFreeMember(
  page: Page,
  interceptNetworkCall: Parameters<typeof openLooksFixture>[1]
) {
  const fixture = await openLooksFixture(page, interceptNetworkCall, {
    looks: LOOKS,
    capsules: CAPSULES,
    planner: 'free',
  })
  await serveFreeAccount(page, fixture.memberId)
  return fixture
}

/** Every planner read the page sends, so a test can prove the free state was asked for. */
function countPlannerReads(page: Page) {
  let count = 0
  page.on('request', (request) => {
    if (/\/api\/v1\/commerce\/premium\/planner/.test(request.url())) count += 1
  })
  return () => count
}

/** The free preview: seven sample days, the one line and exactly one Upgrade, in the fold. */
async function expectFreePreview(page: Page, upgradeHref: string) {
  const preview = page.getByTestId('plan-free-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('[data-testid^="plan-free-day-"]')).toHaveCount(7)
  for (let day = 0; day < 7; day += 1)
    await expect(preview.getByTestId(`plan-free-day-${day}`)).toBeVisible()
  await expect(page.getByText(FREE_LINE, { exact: true })).toHaveCount(1)
  await expect(preview.getByText(FREE_LINE, { exact: true })).toBeVisible()

  const upgrade = page.getByTestId('plan-upgrade')
  await expect(upgrade).toHaveCount(1)
  await expect(upgrade).toHaveText('Upgrade')
  await expect(upgrade).toHaveAttribute('href', upgradeHref)
  for (const id of OLD_LOCK_IDS) await expect(page.getByTestId(id), id).toHaveCount(0)

  // P4: a member who never scrolls reads what Premium adds and reaches Upgrade.
  const band = await foldBand(page)
  const upgradeBox = (await upgrade.boundingBox())!
  expect(upgradeBox, 'Upgrade has a box').not.toBeNull()
  expect(upgradeBox.y, 'Upgrade starts below the top bar').toBeGreaterThanOrEqual(
    band.top - 1
  )
  expect(
    upgradeBox.y + upgradeBox.height,
    'Upgrade bottom inside the fold'
  ).toBeLessThanOrEqual(band.bottom + 1)
  const firstDay = (await preview.getByTestId('plan-free-day-0').boundingBox())!
  expect(upgradeBox.y, 'Upgrade sits above the sample week').toBeLessThan(firstDay.y)
}

/**
 * Planner lock findings on the page: an element whose test id names a planner lock, or the old
 * lock copy. Other Premium features (the palette advisor) keep their own locked states.
 */
function plannerLockFindings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-testid]'))
      .map((node) => node.dataset['testid'] ?? '')
      .filter(
        (id) =>
          (/locked/i.test(id) && /plan/i.test(id)) || /planner-rail-get-premium/i.test(id)
      )
    const text = document.body.innerText
    const copy = [
      /planner is a premium feature/i,
      /\bplanner\b[^\n]{0,60}\block/i,
      /\block[^\n]{0,60}\bplanner\b/i,
    ]
      .filter((pattern) => pattern.test(text))
      .map((pattern) => `text ${String(pattern)}`)
    return [...ids, ...copy]
  })
}

test.describe('CC-7.12 Plan for free and entitled members @local-lane', () => {
  test(
    '[P0] [7.12-E2E-030] free member: sample week, the one line and one Upgrade inside the fold, no lock',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const unexpectedErrors = watchHttpErrors(page, [PLANNER_REFUSAL])
      const plannerReads = countPlannerReads(page)
      const fixture = await openFreeMember(page, interceptNetworkCall)
      await page.goto('/looks?segment=plan')
      await waitForShellSettled(page, fixture.router)
      await expect(segment(page, 'plan')).toHaveAttribute('aria-selected', 'true')

      await expectFreePreview(page, '/settings#premium')
      // The preview answers the planner's own refusal, not a guess before the read.
      expect(plannerReads()).toBeGreaterThan(0)
      await expect(page.getByTestId('planner-days')).toHaveCount(0)

      fixture.setScreen('profile')
      await page.getByTestId('plan-upgrade').click()
      await expect(page).toHaveURL(/\/settings#premium$/)
      await expect(page.getByTestId('premium-subscription-section')).toBeVisible()
      expect(unexpectedErrors()).toEqual([])
    }
  )

  test('[P0] [7.12-E2E-031] entitled member: the week renders with no preview and no Upgrade', async ({
    page,
    interceptNetworkCall,
  }) => {
    // The shell default answers the planner with a week (the failing control for E2E-030).
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
      capsules: CAPSULES,
    })
    await page.goto('/looks?segment=plan')
    await waitForShellSettled(page, fixture.router)
    await expect(segment(page, 'plan')).toHaveAttribute('aria-selected', 'true')

    await expect(page.getByTestId('planner-days')).toBeVisible()
    await expect(page.getByTestId('plan-free-preview')).toHaveCount(0)
    await expect(page.getByTestId('plan-upgrade')).toHaveCount(0)
    await expect(page.getByText(FREE_LINE, { exact: true })).toHaveCount(0)
    for (const id of OLD_LOCK_IDS) await expect(page.getByTestId(id), id).toHaveCount(0)
  })

  test('[P0] [7.12-E2E-033] signed out: Plan shows the preview, Upgrade opens sign-in with no return path and no purchase call', async ({
    page,
  }) => {
    const commerce: string[] = []
    page.on('request', (request) => {
      if (PURCHASE_OR_ENTITLEMENT.test(request.url())) commerce.push(request.url())
    })
    await page.goto('/looks?segment=plan')
    await expect(segment(page, 'plan')).toHaveAttribute('aria-selected', 'true')
    await expectFreePreview(page, '/signin')

    await page.getByTestId('plan-upgrade').click()
    // P5 as countered: sign-in gains no return address.
    await expect(page).toHaveURL(/\/signin$/)
    expect(commerce).toEqual([])
  })
})

test.describe('CC-7.12 no Planner lock outside Plan @local-lane', () => {
  test(
    '[P0] [7.12-E2E-032] control: on Plan the free preview shows and the probe finds no lock, and it does find a planted one',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const unexpectedErrors = watchHttpErrors(page, [PLANNER_REFUSAL])
      const fixture = await openFreeMember(page, interceptNetworkCall)
      await page.goto('/looks?segment=plan')
      await waitForShellSettled(page, fixture.router)
      // The free state is on screen, so a surviving lock would render here first.
      await expect(page.getByTestId('plan-free-preview')).toBeVisible()
      expect(await plannerLockFindings(page)).toEqual([])

      // The probe sees a lock when one is there.
      await page.evaluate(() => {
        const node = document.createElement('div')
        node.dataset['testid'] = 'planner-rail-locked'
        node.id = 'planted-planner-lock'
        node.textContent = 'The 7-Day Planner is a Premium feature'
        document.querySelector('main')?.append(node)
      })
      expect(await plannerLockFindings(page)).toEqual([
        'planner-rail-locked',
        'text /planner is a premium feature/i',
      ])
      await page.evaluate(() => document.getElementById('planted-planner-lock')?.remove())
      expect(unexpectedErrors()).toEqual([])
    }
  )

  /** Every tab, the Looks segments and the CC-7.11 sub-screens at their CC-7.12 addresses. */
  const WALK: {
    path: string
    screen: ShellScreen
    gate: boolean
    cookieProfile?: boolean
  }[] = [
    { path: '/', screen: 'home', gate: true },
    { path: '/wardrobe', screen: 'closet', gate: true },
    { path: '/looks?segment=saved', screen: 'looks', gate: true },
    { path: '/looks?segment=ideas', screen: 'looks', gate: true },
    { path: '/community', screen: 'community', gate: true },
    { path: '/settings', screen: 'profile', gate: true },
    { path: '/wardrobe?garment=shell-garment-1', screen: 'closet', gate: true },
    { path: '/wardrobe/onboarding', screen: 'closet', gate: false },
    { path: '/wardrobe/silhouette', screen: 'closet', gate: false },
    { path: '/looks/capsules', screen: 'looks', gate: false },
    { path: '/looks/saved/look-a', screen: 'looks', gate: false },
    { path: '/settings/style', screen: 'profile', gate: false },
    { path: '/palette', screen: 'profile', gate: false },
    { path: '/notification-settings', screen: 'profile', gate: false },
    { path: '/guardian/dashboard', screen: 'profile', gate: false, cookieProfile: true },
    { path: '/teen/dashboard', screen: 'profile', gate: false, cookieProfile: true },
  ]
  for (const stop of WALK) {
    test(
      `[P0] [7.12-E2E-032] free member on ${stop.path}: no Planner lock`,
      { annotation: [{ type: 'skipNetworkMonitoring' }] },
      async ({ page, interceptNetworkCall }) => {
        const unexpectedErrors = watchHttpErrors(page, [PLANNER_REFUSAL])
        // Sub-screens read more than the shell serves: an empty page for the rest, registered
        // first so every fixture read answers before it (as sub-screen-back.spec.ts does).
        await page.route('**/api/v1/**', (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ json: { data: [], total: 0, limit: 20, offset: 0 } })
            : route.fallback()
        )
        const fixture = await openFreeMember(page, interceptNetworkCall)
        if (stop.cookieProfile) {
          // The dashboards read the profile with the cookie session, which the router refuses.
          const { json } = bodies(fixture.memberId, true)
          await page.route('**/api/v1/user/profile', (route) =>
            route.request().method() === 'GET'
              ? route.fulfill({ json: json.profile })
              : route.fallback()
          )
        }
        fixture.setScreen(stop.screen)
        await page.goto(stop.path)
        if (stop.gate) await waitForShellSettled(page, fixture.router)
        await expect(page.getByTestId('app-top-bar-title')).toBeVisible()
        await expect
          .poll(() => fixture.router.inflight(), { message: 'fixture reads in flight' })
          .toBe(0)

        expect(await plannerLockFindings(page)).toEqual([])
        for (const id of OLD_LOCK_IDS)
          await expect(page.getByTestId(id), id).toHaveCount(0)
        expect(unexpectedErrors()).toEqual([])
      }
    )
  }
})

test.describe('CC-7.12 one click to Plan and the old addresses @local-lane', () => {
  const members = ['free', 'premium', 'signed out'] as const
  for (const member of members) {
    test(
      `[P0] [7.12-E2E-034] ${member}: Today's Plan your week opens Looks on Plan in one click`,
      { annotation: member === 'free' ? [{ type: 'skipNetworkMonitoring' }] : [] },
      async ({ page, interceptNetworkCall }) => {
        const unexpectedErrors = watchHttpErrors(page, [PLANNER_REFUSAL])
        const visited: string[] = []
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
        })
        const fixture =
          member === 'free'
            ? await openFreeMember(page, interceptNetworkCall)
            : member === 'premium'
              ? await openLooksFixture(page, interceptNetworkCall, { looks: LOOKS })
              : null
        fixture?.setScreen('home')
        await page.goto('/')
        if (fixture) await waitForShellSettled(page, fixture.router)

        const control = page.getByTestId('planner-open-control')
        await expect(control).toHaveAttribute('href', '/looks?segment=plan')
        fixture?.setScreen('looks')
        await control.click()
        await expect(page).toHaveURL(/\/looks\?segment=plan$/)
        await expect(segment(page, 'plan')).toHaveAttribute('aria-selected', 'true')
        if (member === 'premium')
          await expect(page.getByTestId('planner-days')).toBeVisible()
        else await expect(page.getByTestId('plan-free-preview')).toBeVisible()
        // One click, no hop: the old Plan route never loads on the way.
        expect(visited.filter((path) => path === '/looks/plan')).toEqual([])
        expect(unexpectedErrors()).toEqual([])
      }
    )
  }

  test('[P0] [7.12-E2E-035] /looks/plan and /?planner=1 answer a server redirect to Looks on Plan', async ({
    page,
  }) => {
    for (const from of ['/looks/plan', '/?planner=1']) {
      const response = await page.request.get(from, { maxRedirects: 0 })
      expect([307, 308], `${from} status`).toContain(response.status())
      const location = new URL(response.headers()['location']!, 'http://localhost')
      expect(location.pathname, from).toBe('/looks')
      expect(location.searchParams.get('segment'), from).toBe('plan')
      // Next carries the source query along; only the legacy key may ride with it.
      for (const key of location.searchParams.keys())
        expect(['segment', 'planner'], `${from} query ${key}`).toContain(key)
    }
    // Control: Today without the legacy key is no redirect.
    const today = await page.request.get('/', { maxRedirects: 0 })
    expect(today.status()).toBe(200)

    // In the browser the legacy key is dropped and Plan opens.
    await page.goto('/?planner=1')
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await expect(segment(page, 'plan')).toHaveAttribute('aria-selected', 'true')
    await page.goto('/looks/plan')
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await expect(page.getByTestId('plan-free-preview')).toBeVisible()
  })
})

test.describe('CC-7.12 guardian-pending teen @local-lane', () => {
  test('[P0] [7.12-E2E-060] a guardian-pending teen opens every segment, the detail and the capsule manager with the same taps', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'guardian-pending',
      looks: LOOKS,
      capsules: CAPSULES,
    })
    await page.goto('/looks')
    await waitForShellSettled(page, fixture.router)

    await expect(segment(page, 'saved')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('saved-look-card-look-c')).toBeVisible()
    await segment(page, 'ideas').click()
    await expect(page).toHaveURL(/\/looks\?segment=ideas$/)
    await expect(page.getByTestId('looks-ideas-grid')).toBeVisible()
    await segment(page, 'plan').click()
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await expect(page.getByTestId('looks-first-content')).toBeVisible()
    await segment(page, 'saved').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved$/)

    await page.getByTestId('saved-look-card-look-c').click()
    await expect(page).toHaveURL(/\/looks\/saved\/look-c\?from=all$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Gallery Sunday')
    await expect(page.getByTestId('saved-look-detail')).toBeVisible()
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved$/)

    await page.getByTestId('looks-filter-capsules').click()
    await expect(page).toHaveURL(/filter=capsules/)
    await page.getByTestId('looks-manage-capsules').click()
    await expect(page).toHaveURL(/\/looks\/capsules$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Outfit capsules')
  })

  test(
    '[P0] [7.12-E2E-061] a guardian-pending teen on Plan sees the preview with Upgrade to Profile Premium',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const unexpectedErrors = watchHttpErrors(page, [PLANNER_REFUSAL])
      const fixture = await openLooksFixture(page, interceptNetworkCall, {
        mode: 'guardian-pending',
        looks: LOOKS,
        planner: 'free',
      })
      await page.goto('/looks?segment=plan')
      await waitForShellSettled(page, fixture.router)
      await expectFreePreview(page, '/settings#premium')

      // The existing teen purchase rules live in Profile's Premium section; Upgrade lands there.
      fixture.setScreen('profile')
      await page.getByTestId('plan-upgrade').click()
      await expect(page).toHaveURL(/\/settings#premium$/)
      await expect(page.getByTestId('premium-subscription-section')).toBeVisible()
      expect(unexpectedErrors()).toEqual([])
    }
  )
})
