// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
import type { Locator, Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'

// This scan discovers nothing: it iterates this literal array, so a destination
// route missing from it is never scanned at either viewport and AC 8's axe evidence
// for it does not exist.
const primaryRoutes = ['/', '/community', '/wardrobe', '/settings', '/palette'] as const
const secondaryRoutes = [
  '/signup',
  '/guardian/accept',
  '/guardian/dashboard',
  '/teen/dashboard',
] as const
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
] as const

function installAuthenticatedProfile(
  route: string,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  if (route !== '/guardian/dashboard' && route !== '/teen/dashboard') {
    return
  }

  const profile =
    route === '/guardian/dashboard'
      ? {
          user: {
            id: 'guardian-accessibility',
            email: 'guardian-accessibility@example.com',
            displayName: 'Accessibility Guardian',
            birthdate: '1987-03-04T00:00:00.000Z',
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [
            {
              teenId: 'teen-accessibility',
              status: 'granted',
              consentGrantedAt: '2026-08-01T12:00:00.000Z',
            },
          ],
        }
      : {
          user: {
            id: 'teen-accessibility',
            email: 'teen-accessibility@example.com',
            displayName: 'Accessibility Teen',
            birthdate: '2011-04-15T00:00:00.000Z',
            role: 'teen',
          },
          linkedGuardians: [
            {
              guardianId: 'guardian-accessibility',
              status: 'granted',
              consentGrantedAt: '2026-08-01T12:00:00.000Z',
            },
          ],
          linkedTeens: [],
        }

  void interceptNetworkCall({
    url: '**/api/v1/user/profile',
    fulfillResponse: {
      status: 200,
      body: profile,
    },
  })
}

async function openStablePage(
  page: Page,
  route: string,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  installAuthenticatedProfile(route, interceptNetworkCall)
  await page.goto(route)
  await waitForAccessibilityReady(page)

  if (route === '/guardian/dashboard') {
    await expect(page.getByTestId('linked-teen-teen-accessibility')).toBeVisible()
  }
  if (route === '/teen/dashboard') {
    await expect(page.getByTestId('teen-consent-status')).toHaveText(
      'Guardian consent granted'
    )
  }
}

async function expectSkipContract(page: Page) {
  const main = page.locator('main#main-content')
  await expect(main).toHaveCount(1)
  await expect(main).toHaveAttribute('tabindex', '-1')

  const firstFocusable = page
    .locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    .first()
  await expect(firstFocusable).toHaveAccessibleName('Skip to main content')
}

function installSevereAlert(interceptNetworkCall: InterceptNetworkCallFn) {
  void interceptNetworkCall({
    url: '**/api/v1/events/poll**',
    fulfillResponse: {
      status: 200,
      body: {
        events: [createWeatherAlertPolledEvent('alert-999', 'guardian')],
        nextSince: '2026-08-03T12:00:00.000Z',
      },
    },
  })
}

function parseRgb(value: string): [number, number, number] {
  const channels = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${value}`)
  }
  return channels as [number, number, number]
}

function contrastRatio(left: string, right: string): number {
  const luminance = (color: string) => {
    const channels = parseRgb(color).map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

async function focusColors(target: Locator) {
  await target.focus()
  return target.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      background: styles.backgroundColor,
      outline: styles.outlineColor,
      outlineStyle: styles.outlineStyle,
    }
  })
}

test.describe('Story 3.8 route audit matrix', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  for (const route of primaryRoutes) {
    for (const viewport of viewports) {
      test(`axe and landmark contract: ${route} at ${viewport.name}`, async ({
        page,
        interceptNetworkCall,
      }) => {
        await page.setViewportSize(viewport)
        await openStablePage(page, route, interceptNetworkCall)
        await expectSkipContract(page)
        await checkA11y(page)
      })
    }
  }

  for (const route of secondaryRoutes) {
    test(`axe and landmark contract: ${route}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await page.setViewportSize(viewports[0])
      await openStablePage(page, route, interceptNetworkCall)
      await expectSkipContract(page)
      await checkA11y(page)
    })
  }
})

test.describe('Story 3.8 interaction states', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('skip link activation and forward plus reverse order', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(page, '/', interceptNetworkCall)

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skipLink).toBeFocused()
    await page.keyboard.press('Tab')
    const nextControl = page.locator(':focus')
    await expect(nextControl).toBeVisible()
    await expect(nextControl).not.toHaveAccessibleName('Skip to main content')
    await page.keyboard.press('Shift+Tab')
    await expect(skipLink).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(page.locator('main#main-content')).toBeFocused()
  })

  test('chip keys preserve button semantics and Tab exits the group', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(page, '/', interceptNetworkCall)
    const personal = page.getByTestId('chip-personal')
    const community = page.getByTestId('chip-community')
    const sponsored = page.getByTestId('chip-sponsored')

    await personal.focus()
    await page.keyboard.press('ArrowRight')
    await expect(community).toBeFocused()
    await expect(community).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(personal).toBeFocused()
    await page.keyboard.press('End')
    await expect(sponsored).toBeFocused()
    await page.keyboard.press('Home')
    await expect(personal).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).not.toHaveAttribute('data-testid', /chip-/)

    /*
     * The `article[id^="lookbook-card-"]` half of this assertion moved to
     * `community-feed.spec.ts`, which owns the community focus contract. What
     * survives is the half that never needed a card: a non-card child of a
     * scrolling region must NOT be focusable, which is the property that keeps the
     * tab order short.
     */
    await expect(
      page.locator('[data-testid="outfit-scroll"] > div').first()
    ).not.toHaveAttribute('tabindex')
  })

  test('selected chips and an information banner pass axe', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(
      page,
      '/?source=invalid_source&slot=bad_slot',
      interceptNetworkCall
    )
    await expect(page.getByTestId('deep-link-info-banner')).toBeVisible()
    await page.getByTestId('chip-community').click()
    await expect(page.getByTestId('chip-community')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await checkA11y(page)
  })

  test('severe alert and community deep-link targets receive programmatic focus', async ({
    page,
    interceptNetworkCall,
  }) => {
    installSevereAlert(interceptNetworkCall)
    await openStablePage(
      page,
      '/?source=notification&type=severe_weather&alertId=alert-999',
      interceptNetworkCall
    )
    const alert = page.getByTestId('severe-weather-alert-focused')
    await expect(alert).toBeFocused()
    await expect(alert).toHaveAttribute('tabindex', '-1')
    await checkA11y(page)

    /*
     * The community deep-link half of this test is asserted in
     * `community-feed.spec.ts`. `look-3` was an id from `MOCK_LOOKBOOK_ITEMS`, which
     * Story 6.1 deleted, so the locator named a card that can never exist, and
     * rewriting the id here would produce a test failing for a reason unrelated to
     * accessibility, in a file about accessibility. The severe-alert half above
     * still proves the programmatic focus contract this test exists for.
     */
  })

  test('client validation error passes axe with alert semantics', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(page, '/signup', interceptNetworkCall)
    await page.getByLabel('Email').fill('teen@example.com')
    await page.getByLabel('Birthdate').fill('2020-01-01')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('signup-error-message')).toBeVisible()
    await checkA11y(page)
  })

  test('successful feedback state passes axe with status semantics', async ({
    page,
    interceptNetworkCall,
  }) => {
    void interceptNetworkCall({
      url: '**/api/v1/auth/signup',
      fulfillResponse: {
        status: 201,
        body: {
          userId: 'accessibility-adult',
          age: 30,
          accountStatus: 'active',
          guardianConsentRequired: false,
        },
      },
    })
    await openStablePage(page, '/signup', interceptNetworkCall)
    await page.getByLabel('Email').fill('adult@example.com')
    await page.getByLabel('Birthdate').fill('1996-01-01')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('signup-success-message')).toBeVisible()
    await checkA11y(page)
  })

  test('baseline route inventory has no production web modal', async ({
    page,
    interceptNetworkCall,
  }) => {
    for (const route of [...primaryRoutes, ...secondaryRoutes]) {
      await openStablePage(page, route, interceptNetworkCall)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  })

  test('reduced motion and forced colors preserve immediate visible focus', async ({
    page,
    interceptNetworkCall,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(viewports[0])
    await openStablePage(page, '/', interceptNetworkCall)

    // Story 5.5 Decision 7: the planner defaults closed and opens from the "Plan
    // week" control. `viewports[0]` is desktop width, so this opens the inline rail.
    await page.getByTestId('planner-open-control').click()
    const planner = page.getByRole('complementary', { name: 'Planner Rail' })
    await expect(planner).toBeVisible()
    await expect(planner).toHaveCSS('animation-name', 'none')
    const chip = page.getByTestId('chip-personal')
    const transitionDuration = await chip.evaluate(
      (node) => getComputedStyle(node).transitionDuration
    )
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001)

    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    // The `planner-open-control` mouse click above leaves Chromium's
    // `:focus-visible` heuristic in its pointer-interaction state, so a plain
    // `chip.focus()` stopped matching `:focus-visible` and `outlineStyle` came back
    // `'none'` where the assertion below wants `'solid'`. One real keyboard event
    // resets that heuristic before the script-triggered focus, matching how a
    // keyboard user reaches this element; confirmed by removing it and reproducing
    // the failure.
    await page.keyboard.press('Tab')
    await chip.focus()
    const forcedStyles = await chip.evaluate((node) => {
      const styles = getComputedStyle(node)
      return { boxShadow: styles.boxShadow, outlineStyle: styles.outlineStyle }
    })
    expect(forcedStyles.boxShadow).toBe('none')
    expect(forcedStyles.outlineStyle).toBe('solid')
  })

  test('rendered light, dark, gold, and alert focus outlines meet 3:1', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(page, '/', interceptNetworkCall)

    const dark = await focusColors(page.getByTestId('nav-ritual'))
    expect(contrastRatio(dark.outline, 'rgb(0, 0, 0)')).toBeGreaterThanOrEqual(3)
    expect(dark.outlineStyle).toBe('solid')

    const lightChip = page.getByTestId('chip-community')
    const light = await focusColors(lightChip)
    expect(contrastRatio(light.outline, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3)
    expect(light.outlineStyle).toBe('solid')

    const gold = await focusColors(page.getByTestId('chip-personal'))
    expect(contrastRatio(gold.outline, gold.background)).toBeGreaterThanOrEqual(3)
    expect(gold.outlineStyle).toBe('solid')

    installSevereAlert(interceptNetworkCall)
    await openStablePage(
      page,
      '/?source=notification&type=severe_weather&alertId=alert-999',
      interceptNetworkCall
    )
    // Scoped to the alert panel: the page also carries a persistent "Plan week"
    // control near the hero actions (Story 5.5 Decision 7) with the same accessible
    // name, and this assertion is about the alert's own dark surface.
    const severeAlert = page.getByTestId('severe-weather-alert-focused')
    const alert = await focusColors(
      severeAlert.getByRole('button', { name: 'Plan week' })
    )
    expect(contrastRatio(alert.outline, 'rgb(54, 31, 31)')).toBeGreaterThanOrEqual(3)
    expect(alert.outlineStyle).toBe('solid')
  })
})
