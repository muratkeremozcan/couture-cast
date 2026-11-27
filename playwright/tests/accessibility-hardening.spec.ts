// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.8 Task 5 step 2 owner: E2E Playwright test skip-link activation, main landmark focus, and reduced-motion emulation in `playwright/tests/accessibility-hardening.spec.ts`
// Story CC-7.12 (Step 69): the scan covers the Looks Plan and Ideas segments and /looks/capsules
// in place of /looks/plan; Plan week opens /looks?segment=plan, a tab with no back arrow.
import type { Locator, Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { expect } from '../support/fixtures/merged-fixtures'
// communityTest only adds a lazy `communitySession`; the severe-alert cases
// destructure it because the events feed behind that alert requires an account.
import { communityTest as test } from '../support/helpers/community-session'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { focusBackdrop, focusRing } from '../support/helpers/painted-contrast'

// This scan discovers nothing: it iterates this literal array, so a destination
// route missing from it is never scanned at either viewport and AC 8's axe evidence
// for it does not exist.
// Story CC-7.11 D1, D6, D7, D9: the Looks tab and the new sub-screens (Plan, Silhouette and
// Style, which replaced the Home drawer and the Closet Silhouette modal) join the scan.
const primaryRoutes = [
  '/',
  '/wardrobe',
  '/looks',
  '/community',
  '/settings',
  '/palette',
] as const
const secondaryRoutes = [
  // Story CC-7.12 D1, D6, D11: Plan is a Looks segment (the old /looks/plan redirects there),
  // Ideas is the other segment a signed-in member can open, and the capsule manager moved
  // under Looks.
  '/looks?segment=plan',
  '/looks?segment=ideas',
  '/looks/capsules',
  '/wardrobe/silhouette',
  '/settings/style',
  '/signup',
  '/guardian/accept',
  '/guardian/dashboard',
  '/teen/dashboard',
  // Learning path Step 57 (#step-57-google-sign-in): the public legal pages Story 6.17 adds.
  '/privacy',
  '/terms',
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

/**
 * Story CC-7.9 D3 and D7: a keyboard focus ring is the `focusEssential` outline inside the gold
 * `focus` halo, and it must stand out from the surface it is drawn over: the nearest painted
 * ancestor (`data-surface="card"`, the top bar, or the `data-surface="page"` surface). The
 * computed outline is held to 3:1 on that backdrop, and the pixels focus actually changes are
 * held to 3:1 against what was painted there before.
 */
async function expectVisibleFocusRing(target: Locator, label: string) {
  const ring = await focusRing(target, async () => {
    await target.focus()
    await expect(target).toBeFocused()
  })
  // WCAG 2.4.13: the 3:1 change covers at least a 2 CSS px perimeter of the control.
  expect(ring!.qualifying, `${label}: ring pixels at 3:1`).toBeGreaterThanOrEqual(
    ring!.required!
  )
  const focused = await target.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      visible: element.matches(':focus-visible'),
      outline: styles.outlineColor,
      outlineStyle: styles.outlineStyle,
    }
  })
  expect(focused.visible, `${label}: :focus-visible`).toBe(true)
  expect(focused.outlineStyle, label).toBe('solid')
  const backdrop = await focusBackdrop(target)
  expect(
    contrastRatio(focused.outline, backdrop.color),
    `${label}: outline on ${backdrop.node}`
  ).toBeGreaterThanOrEqual(3)
  return backdrop
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

  test('the invalid-link information banner and Today pass axe', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openStablePage(
      page,
      '/?source=invalid_source&slot=bad_slot',
      interceptNetworkCall
    )
    await expect(page.getByTestId('deep-link-info-banner')).toBeVisible()
    await checkA11y(page)
  })

  test('severe alert and community deep-link targets receive programmatic focus', async ({
    page,
    interceptNetworkCall,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
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

  test.describe('free Plan focus and reduced motion', () => {
    test.use({ allowPremiumPlannerRefusal: true })

    test('reduced motion and forced colors preserve immediate visible focus', async ({
      page,
      interceptNetworkCall,
      communitySession,
    }) => {
      expect(communitySession.userId).toBeTruthy()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize(viewports[0])
      await openStablePage(page, '/', interceptNetworkCall)

      // Story CC-7.12 D11: the "Plan week" control links to the Looks Plan segment, where the
      // planner renders as the inline rail. Plan is a tab with no back arrow, so browser back
      // returns to Today, where the Plan link remains focusable.
      await page.getByTestId('home-plan-week').click()
      await expect(page).toHaveURL('/looks?segment=plan')
      const planner = page.getByRole('complementary', { name: 'Planner Rail' })
      await expect(planner).toBeVisible()
      await expect(planner).toHaveCSS('animation-name', 'none')
      await expect(
        page.getByTestId('app-header').getByTestId('app-top-bar-back')
      ).toHaveCount(0)
      await page.goBack()
      await expect(page).toHaveURL('/')
      const planLink = page.getByTestId('home-plan-week')
      const transitionDuration = await planLink.evaluate(
        (node) => getComputedStyle(node).transitionDuration
      )
      expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001)

      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
      // The `home-plan-week` mouse click above leaves Chromium's
      // `:focus-visible` heuristic in its pointer-interaction state, so a plain
      // `planLink.focus()` stopped matching `:focus-visible` and `outlineStyle` came back
      // `'none'` where the assertion below wants `'solid'`. One real keyboard event
      // resets that heuristic before the script-triggered focus, matching how a
      // keyboard user reaches this element; confirmed by removing it and reproducing
      // the failure.
      await page.keyboard.press('Tab')
      await planLink.focus()
      const forcedStyles = await planLink.evaluate((node) => {
        const styles = getComputedStyle(node)
        return { boxShadow: styles.boxShadow, outlineStyle: styles.outlineStyle }
      })
      expect(forcedStyles.boxShadow).toBe('none')
      expect(forcedStyles.outlineStyle).toBe('solid')
    })
  })

  test('rendered top bar, Today Plan, and alert focus outlines meet 3:1 in both schemes', async ({
    page,
    interceptNetworkCall,
    communitySession,
  }) => {
    // The alert surface below needs a signed-in account (see installSevereAlert).
    expect(communitySession.userId).toBeTruthy()
    // Desktop width: the tab links sit in the top bar only from 768 px (Story CC-7.9 D6).
    await page.setViewportSize(viewports[0])

    // Story CC-7.9 D2, D7: the always-dark page and its black nav are gone, so each ring is
    // measured on the surface it really sits on, in the light and the dark scheme.
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await openStablePage(page, '/', interceptNetworkCall)

      const nav = page.getByTestId('primary-nav').getByTestId('nav-ritual')
      const navBackdrop = await expectVisibleFocusRing(nav, `${colorScheme} top bar tab`)
      expect(navBackdrop.surface, `${colorScheme} top bar tab`).toBe('page')

      await expectVisibleFocusRing(
        page.getByTestId('home-plan-week'),
        `${colorScheme} Today Plan`
      )
    }

    // The alert stub answers every later events poll, so the alert pages run after the Home ones.
    installSevereAlert(interceptNetworkCall)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await openStablePage(
        page,
        '/?source=notification&type=severe_weather&alertId=alert-999',
        interceptNetworkCall
      )
      // Scoped to the alert panel: the page also carries a persistent "Plan week"
      // control near the hero actions (Story 5.5 Decision 7) with the same accessible
      // name, and this assertion is about the alert's own surface (`dangerSurface`, D2).
      const severeAlert = page.getByTestId('severe-weather-alert-focused')
      await expect(severeAlert).toBeVisible()
      // Story CC-7.12 D11: the alert's Plan week is a link to the Looks Plan segment.
      const alertPlan = severeAlert.getByRole('link', { name: 'Plan week' })
      await expect(alertPlan).toHaveAttribute('href', '/looks?segment=plan')
      const alertBackdrop = await expectVisibleFocusRing(
        alertPlan,
        `${colorScheme} alert action`
      )
      expect(alertBackdrop.color, `${colorScheme} alert action`).toBe(
        await severeAlert.evaluate((panel) => getComputedStyle(panel).backgroundColor)
      )
    }
  })
})
