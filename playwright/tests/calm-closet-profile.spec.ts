// Learning path Step 73: Calm Closet and Profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-73-calm-closet-and-profile
// Test design: _bmad-output/test-artifacts/test-design-7-16-calm-closet-profile.md.
import type { Page } from '@playwright/test'
import { suggestGarmentTagsWireResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  SCHEMES,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { expectReadable } from '../support/helpers/readable-text'
import {
  SHELL_PROFILE_NAME,
  type ShellClosetFixture,
} from '../support/helpers/shell-fixtures'

const PROFILE_ROWS = [
  ['account', 'Account', '/settings/account'],
  ['places', 'Places', '/settings/places'],
  ['style', 'Style', '/settings/style'],
  ['premium', 'Premium', '/settings/premium'],
  ['notifications', 'Notifications', '/notification-settings'],
  ['language', 'Language', '/settings/language'],
  ['about', 'About and privacy', '/settings/about'],
] as const

const ISO = '2026-11-20T12:00:00.000Z'
const PHOTO =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="navy"/%3E%3C/svg%3E'

const STATUSES = [
  ['awaiting_tags', 'Needs tags'],
  ['failed', 'Failed'],
  ['processing', 'Processing'],
] as const

function closetFixture(complete: boolean): ShellClosetFixture {
  type Garment = ShellClosetFixture['garments']['data'][number]
  const pieces: Pick<Garment, 'id' | 'status' | 'category'>[] = [
    { id: 'ready-top', status: 'ready', category: 'top' },
    { id: 'ready-bottom', status: 'ready', category: 'bottom' },
    ...STATUSES.map(([status]) => ({ id: status, status, category: null })),
  ]
  return {
    garments: {
      data: pieces.map((garment) => ({
        ...garment,
        material: garment.category ? 'cotton' : null,
        comfortRange: garment.category ? 'mild' : null,
        tagsConfirmedAt: garment.category ? ISO : null,
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        retentionStatus: 'active',
        createdAt: ISO,
        committedAt: ISO,
        imageAccess:
          garment.status === 'failed'
            ? null
            : { url: PHOTO, expiresAt: '2099-12-31T00:00:00.000Z' },
      })),
    },
    onboarding: {
      data: {
        ...(complete
          ? { status: 'completed', currentStep: 'complete', completedAt: ISO }
          : { status: 'in_progress', currentStep: 'tagging', completedAt: null }),
        usedStarterWardrobe: false,
        garmentsCapturedCount: 2,
        startedAt: ISO,
        revision: 4,
      },
    },
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.locator('html').evaluate((html) => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
})

test.describe('CC-7.16 Calm Closet and Profile @local-lane', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
  })

  test('[P0] [7.16-CLO-001/002] the category row filters the grid and badges identify only actionable states', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
      closet: closetFixture(true),
    })
    await page.goto('/wardrobe')
    await waitForShellSettled(page, router)

    const header = page.getByTestId('app-header')
    await expect(header.getByRole('heading', { name: 'Closet' })).toBeVisible()
    await expect(header.getByTestId('garment-capture-open')).toHaveText(/Add/)
    await expect(header.getByTestId('closet-more-menu')).toHaveAccessibleName(
      'More closet options'
    )

    const filters = page.getByTestId('closet-category-filters')
    const grid = page.getByTestId('closet-garment-grid')
    await expect(filters).toHaveCount(1)
    await expect(grid.getByTestId(/^garment-open-/)).toHaveCount(2)
    const gridTop = (await grid.boundingBox())!.y
    const filterBox = (await filters.boundingBox())!
    const headerBox = (await header.boundingBox())!
    expect(filterBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
    expect(gridTop).toBeGreaterThanOrEqual(filterBox.y + filterBox.height - 1)

    const top = grid.getByTestId('garment-card-ready-top')
    const bottom = grid.getByTestId('garment-card-ready-bottom')
    await expect(top.getByRole('img')).toBeVisible()
    await expect(top.getByTestId('garment-card-label')).toContainText(/top/i)
    await expect(top.getByTestId(/^garment-status-/)).toHaveCount(0)

    const tones = new Set<string>()
    const icons = new Set<string>()
    for (const [status, label] of STATUSES) {
      const badge = grid
        .getByTestId(`garment-card-${status}`)
        .getByTestId(`garment-status-${status}`)
      await expect(badge).toHaveText(label)
      const icon = badge.locator('svg[aria-hidden="true"]')
      await expect(icon).toBeVisible()
      icons.add(await icon.evaluate((svg) => svg.innerHTML))
      tones.add(await badge.evaluate((element) => getComputedStyle(element).color))
    }
    expect(icons.size).toBe(STATUSES.length)
    expect(tones.size).toBe(STATUSES.length)
    await expect(grid.getByTestId(/^garment-status-/)).toHaveCount(STATUSES.length)
    await expect(page.getByTestId('closet-setup-progress')).toHaveCount(0)

    await filters.getByTestId('closet-category-top').click()
    await expect(top).toBeVisible()
    await expect(bottom).toHaveCount(0)
    await filters.getByTestId('closet-category-all').click()
    await expect(bottom).toBeVisible()

    const tagRead = interceptNetworkCall({
      method: 'POST',
      url: '**/api/v1/wardrobe/garments/awaiting_tags/suggest-tags',
      fulfillResponse: {
        status: 200,
        body: suggestGarmentTagsWireResponseSchema.parse({
          data: { mode: 'manual', garmentId: 'awaiting_tags' },
        }),
      },
    })
    await grid.getByRole('button', { name: 'Needs tags' }).click()
    expect((await tagRead).status).toBe(200)
    await expect(
      page.getByRole('dialog', { name: 'Organize Garment Tags' })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await grid.getByRole('button', { name: /^Failed\./ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await top.getByTestId('garment-open-ready-top').click()
    await expect(
      page.getByTestId('garment-detail').getByTestId('style-piece-open')
    ).toBeEnabled()
  })

  test('[P1] [7.16-CLO-003] incomplete setup appears once below the garment grid and opens setup', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
      closet: closetFixture(false),
    })
    await page.goto('/wardrobe')
    await waitForShellSettled(page, router)

    const progress = page.getByTestId('closet-setup-progress')
    const grid = page.getByTestId('closet-garment-grid')
    await expect(progress).toHaveCount(1)
    const gridBox = (await grid.boundingBox())!
    expect((await progress.boundingBox())!.y).toBeGreaterThanOrEqual(
      gridBox.y + gridBox.height - 1
    )
    await progress.getByRole('link', { name: /closet setup/i }).click()
    await expect(page).toHaveURL(/\/wardrobe\/onboarding$/)
  })

  test('[P0] [7.16-PRO-001/003] Profile rows are ordered and every topic opens its own screen', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'profile',
    })
    await page.goto('/settings')
    await waitForShellSettled(page, router)

    const rows = page.getByTestId(
      /^profile-(account|places|style|premium|notifications|language|about)-row$/
    )
    await expect(rows).toHaveCount(PROFILE_ROWS.length)
    expect(
      await rows.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    ).toEqual(PROFILE_ROWS.map(([, , href]) => href))
    const places = page.getByTestId('profile-places-row')
    await expect(page.getByTestId('profile-account-row')).toContainText(
      SHELL_PROFILE_NAME
    )
    await expect(places).toContainText('Chicago')
    await expect(page.getByTestId('profile-style-row')).toContainText('Complete')
    await expect(page.getByTestId('profile-premium-row')).toContainText('Active')
    await expect(
      page.getByTestId('profile-notifications-row').getByText('On', { exact: true })
    ).toBeVisible()
    await expect(page.getByTestId('profile-language-row')).toContainText('English')
    await expect(page.getByTestId('profile-about-row')).toContainText('CoutureCast')
    const signOut = page.getByTestId('profile-sign-out')
    await expect(signOut).toBeVisible()
    const lastRow = (await rows.last().boundingBox())!
    expect((await signOut.boundingBox())!.y).toBeGreaterThanOrEqual(
      lastRow.y + lastRow.height - 1
    )
    await expect(page.getByRole('link', { name: /planner|plan week/i })).toHaveCount(0)

    for (const [id, label, href] of PROFILE_ROWS) {
      const row = page.getByTestId(`profile-${id}-row`)
      await expect(row).toContainText(label)
      await row.click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      const title = id === 'notifications' ? /notifications/i : label
      await expect(page.getByTestId('app-top-bar-title')).toHaveText(title)
      if (id === 'places') {
        await expect(page.getByTestId('locations-section')).toContainText('Chicago home')
      }
      await page.getByTestId('app-top-bar-back').click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(row).toBeVisible()
    }
  })

  test('[P0] [7.16-PRO-002] a saved guided Places link still opens the city search', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openFixtureShell(page, interceptNetworkCall, {
      mode: 'empty',
      screen: 'profile',
    })
    await page.goto('/settings?addLocation=1&returnTo=%2Fcommunity#locations')

    await expect(page).toHaveURL(
      /settings\/places\?addLocation=1&returnTo=%2Fcommunity#locations$/
    )
    await expect(
      page.getByTestId('locations-section').getByRole('combobox')
    ).toBeFocused()
  })

  test('[P1] [7.16-ACC-001] Language offers expandable help in place', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'profile',
    })
    await page.goto('/settings/language')

    const help = page.getByTestId('settings-learn-more')
    const details = page.locator('details').filter({ has: help })
    await expect(help).toHaveText(/Your browser sets the language\.\s*Learn more/)
    await expect(details).toHaveJSProperty('open', false)
    await help.press('Enter')
    await expect(details).toHaveJSProperty('open', true)
    await expect(details.locator('p')).toBeVisible()
  })

  for (const colorScheme of SCHEMES) {
    test.describe(`${colorScheme} at German 200% text`, () => {
      test.use({ colorScheme, locale: 'de-DE', viewport: { width: 320, height: 640 } })

      test('[P1] [7.16-ACC-002] localized Closet and Profile controls fit at 320 px', async ({
        page,
        interceptNetworkCall,
      }) => {
        const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
          mode: 'populated',
          screen: 'closet',
          closet: closetFixture(false),
        })
        await page.goto('/wardrobe')
        await waitForShellSettled(page, router)
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
        await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE')
        await expect(page.locator('html')).toHaveCSS('font-size', '32px')

        for (const id of [
          'app-top-bar-title',
          'garment-capture-open',
          'closet-more-menu',
          'closet-category-all',
          'closet-category-top',
          'garment-status-awaiting_tags',
          'garment-status-processing',
          'closet-setup-progress',
        ]) {
          await expectReadable(page.getByTestId(id))
        }
        await expectNoHorizontalOverflow(page)

        setScreen('profile')
        await page.getByTestId('bottom-nav-settings').click()
        await expect(page).toHaveURL(/\/settings$/)
        await waitForShellSettled(page, router)
        for (const [id] of PROFILE_ROWS) {
          await expectReadable(page.getByTestId(`profile-${id}-row`))
        }
        await expectReadable(page.getByTestId('profile-sign-out'))
        await expectNoHorizontalOverflow(page)

        await page.getByTestId('profile-places-row').click()
        await expect(page).toHaveURL(/\/settings\/places$/)
        await expectReadable(page.getByTestId('app-top-bar-title'))
        await expectReadable(
          page.getByTestId('locations-section').getByText('Chicago home')
        )
        await expectNoHorizontalOverflow(page)
      })
    })
  }
})
