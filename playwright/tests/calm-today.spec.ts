// Learning path Step 70: Calm Today with one primary job.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-70-calm-today-with-one-primary-job
// Test design: _bmad-output/test-artifacts/test-design-7-13-calm-today-one-primary-job.md.
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { foldBand } from '../support/helpers/five-tab'
import { measureWebScreen } from '../support/helpers/screen-budget'
import {
  FIXED_NOW,
  openFixtureShell,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import type { ShellMode } from '../support/helpers/shell-fixtures'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

const outfitCard = (page: Page) => page.getByTestId('today-first-content')
const primary = (page: Page) => page.getByTestId('today-primary-action')
const setCity = (page: Page) => page.getByTestId('home-set-city')
const closet = (page: Page) => page.getByTestId('home-closet-strip')
const add = (page: Page) => page.getByTestId('home-add-garment')
const plan = (page: Page) => page.getByTestId('home-plan-week')
const spotlight = (page: Page) => page.getByTestId('home-spotlight-teaser-link')

async function topToBottom(...parts: Locator[]) {
  let previousBottom = 0
  for (const part of parts) {
    await expect(part).toHaveCount(1)
    await expect(part).toBeVisible()
    const box = (await part.boundingBox())!
    expect(
      box.y,
      `${part.toString()} follows the previous section`
    ).toBeGreaterThanOrEqual(previousBottom - 1)
    previousBottom = box.y + box.height
  }
}

test.describe('CC-7.13 Calm Today @local-lane', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
  })

  test('[P0] [7.13-WEB-001/003/004] the outfit leads, one action opens details, and the rows follow in order', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
    })
    await page.goto('/')
    await waitForShellSettled(page, router)

    const weather = page.getByTestId('weather-header')
    const card = outfitCard(page)
    const action = primary(page)
    await topToBottom(weather, card, closet(page), plan(page), spotlight(page))
    const band = await foldBand(page)
    for (const first of [weather, card, action]) {
      const box = (await first.boundingBox())!
      expect(box.y, `${first.toString()} fits below the top bar`).toBeGreaterThanOrEqual(
        band.top - 1
      )
      expect(
        box.y + box.height,
        `${first.toString()} clears the tab bar`
      ).toBeLessThanOrEqual(band.bottom + 1)
    }

    const measurement = await measureWebScreen(page, 'today')
    expect(measurement.primaryButtons.map(({ key }) => key)).toEqual([
      'today-primary-action',
    ])
    await expect(add(page)).toHaveCount(0)
    await expect(closet(page)).toHaveAttribute('href', '/wardrobe')
    await expect(closet(page).locator('img')).toHaveCount(0)
    await expect(closet(page)).toHaveAccessibleName(
      'Recent pieces. Top, Bottom, and Outer layer'
    )
    await expect(page.getByTestId('community-spotlight')).toHaveCount(0)
    await expect(page.getByTestId('community-lookbook-grid')).toHaveCount(0)
    await expect(page.getByTestId('chip-navigation-bar')).toHaveCount(0)
    await expect(page.getByTestId('community-chip-row')).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: /daily ritual|lookbook prism/i })
    ).toHaveCount(0)
    await expect(
      page.getByText(/^(Preview outfits|See the planner|Start wardrobe upload)$/i)
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(sign out|report)$/i })).toHaveCount(
      0
    )
    expect(router.calls('home-teaser')).toBeGreaterThan(0)
    expect(router.calls('community-feed')).toBe(0)
    expect(router.calls('community-spotlight')).toBe(0)

    await expect(action).toHaveAttribute('aria-expanded', 'false')
    await action.click()
    await expect(action).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByText(/comfort note for shell-visual-member/)).toBeVisible()
    await action.click()
    await expect(card.getByText(/comfort note for shell-visual-member/)).toBeHidden()

    setScreen('looks')
    await expect(plan(page)).toHaveAccessibleName('Plan your week')
    await plan(page).click()
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    setScreen('profile')
    await page.getByTestId('bottom-nav-settings').click()
    await expect(page.getByRole('button', { name: /^sign out$/i })).toBeVisible()
  })

  for (const mode of [
    'populated',
    'empty',
    'empty-closet',
    'ritual-503',
  ] as const satisfies readonly ShellMode[]) {
    test(
      `[P0] [7.13-WEB-002/005] ${mode}: actionable outfit and a Today height of at most 1,688 px`,
      {
        annotation:
          mode === 'ritual-503' ? [{ type: 'expectTodayForecastUnavailable' }] : [],
      },
      async ({ page, interceptNetworkCall }) => {
        const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
          mode,
          screen: 'home',
        })
        await page.goto('/')
        await waitForShellSettled(page, router)

        const fallback = mode === 'empty' || mode === 'ritual-503'
        const emptyCloset = mode === 'empty' || mode === 'empty-closet'
        await expect(outfitCard(page)).toHaveCount(1)
        await expect(fallback ? setCity(page) : primary(page)).toBeVisible()
        await expect(fallback ? primary(page) : setCity(page)).toHaveCount(0)
        await topToBottom(
          outfitCard(page),
          emptyCloset ? add(page) : closet(page),
          plan(page)
        )
        await expect(emptyCloset ? closet(page) : add(page)).toHaveCount(0)
        if (mode === 'empty') await expect(spotlight(page)).toHaveCount(0)
        if (emptyCloset) {
          await expect(add(page)).toHaveText(/Add your first piece/)
          await expect(add(page)).toHaveAttribute('href', '/wardrobe?entry=add')
        }
        const height = (await measureWebScreen(page, 'today')).todayHeight
        expect(height, 'measured Today document height').toBeGreaterThan(0)
        expect(height).toBeLessThanOrEqual(1688)

        if (fallback) {
          await expect(page.getByTestId('member-sample-outfit')).toBeVisible()
          await expect(outfitCard(page).getByTestId('member-sample-label')).toBeVisible()
          setScreen('profile')
          await setCity(page).click()
          await expect(page).toHaveURL(
            /\/settings\?addLocation=1&returnTo=%2F#locations$/i
          )
        }
      }
    )
  }

  test('[P0] [7.13-WEB-002] an unresolved or failed closet read shows no empty-closet prompt', async ({
    page,
    interceptNetworkCall,
    recurse,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'closet-unavailable',
      screen: 'home',
    })
    const release = router.hold('garments')
    try {
      await page.goto('/')
      await recurse(
        () => Promise.resolve(router.calls('garments')),
        (count) => count > 0
      )
      await expect(page.getByTestId('screen-placeholder')).toBeVisible()
      await expect(add(page)).toHaveCount(0)
    } finally {
      release()
    }
    await waitForShellSettled(page, router)
    await expect(primary(page)).toBeVisible()
    await expect(plan(page)).toBeVisible()
    await expect(add(page)).toHaveCount(0)
    await expect(closet(page)).toHaveCount(0)
  })

  for (const mode of ['populated', 'empty', 'ritual-503'] as const) {
    test(
      `[P0] [7.13-WEB-005] ${mode}: Today controls remain reachable at 320 px and 200% text`,
      {
        annotation:
          mode === 'ritual-503' ? [{ type: 'expectTodayForecastUnavailable' }] : [],
      },
      async ({ page, interceptNetworkCall }) => {
        await page.setViewportSize({ width: 320, height: 640 })
        const { router } = await openFixtureShell(page, interceptNetworkCall, {
          mode,
          screen: 'home',
        })
        await page.goto('/')
        await waitForShellSettled(page, router)
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
        await expect(page.locator('html')).toHaveCSS('font-size', '32px')
        await expect(mode === 'populated' ? primary(page) : setCity(page)).toBeVisible()
        const controls = page
          .locator(
            'main :is(a[href], button, summary), [data-testid="sticky-bottom-nav"] a'
          )
          .filter({ visible: true })
        expect(await controls.count()).toBeGreaterThanOrEqual(8)
        for (const control of await controls.all()) {
          await control.click({ trial: true })
          const box = (await control.boundingBox())!
          expect(box.x, `${control.toString()} left edge`).toBeGreaterThanOrEqual(-1)
          expect(
            box.x + box.width,
            `${control.toString()} right edge`
          ).toBeLessThanOrEqual(321)
        }
        const documentWidths = await page.evaluate(() => ({
          content: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        }))
        expect(documentWidths.content).toBeLessThanOrEqual(documentWidths.viewport + 1)
      }
    )
  }
})
