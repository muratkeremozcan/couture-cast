// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
//
// Round one built this page against MSW because the commerce endpoints did not exist
// yet, so the assertions below cover the wire shape as well as the UI: a page that
// renders the right thing off the wrong request passes every unit test in
// `apps/web/src/app/settings/page.test.tsx`.
import type { Locator, Page } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  checkA11y,
  contrastRatio,
  waitForAccessibilityReady,
} from '../support/helpers/accessibility'
import {
  COMMERCE_PREFERENCES_PATH,
  commerceTest as test,
  expect,
} from '../support/helpers/commerce-session'
import { test as anonymousTest } from '../support/fixtures/merged-fixtures'

const PREFERENCES_URL = `**${COMMERCE_PREFERENCES_PATH}`

/** The dark settings surface `data-focus-surface="dark"` selects the ring for. */
const DARK_SURFACE_RGB = 'rgb(10, 10, 10)'

/** WCAG 2.2 non-text contrast floor, which is what a focus indicator is held to. */
const MIN_FOCUS_CONTRAST = 3

type PreferenceBody = { data: { affiliateCtasEnabled: boolean } }
type PreferenceRequest = { affiliateCtasEnabled: boolean }

/** The fixture is bound to `unknown` payloads, so results are narrowed here. */
type PreferenceExchange = {
  status: number
  requestJson: PreferenceRequest | null
  responseJson: PreferenceBody | null
}

function optOutToggle(page: Page): Locator {
  return page.getByRole('checkbox', { name: 'Show "Shop this look" suggestions' })
}

/**
 * The section's own error, addressed by test id. Next renders
 * `<div role="alert" aria-live="assertive" id="__next-route-announcer__">` into every
 * page, so `getByRole('alert')` always resolves to at least one element: asserting a
 * count of zero can never pass, and asserting text is a strict-mode violation the
 * moment the section's own alert appears. Both were real failures on the first CI
 * run.
 */
function errorMessage(page: Page): Locator {
  return page.getByTestId('commerce-error-message')
}

function watchPreferenceCall(
  interceptNetworkCall: InterceptNetworkCallFn,
  method: 'GET' | 'PUT'
): Promise<PreferenceExchange> {
  return interceptNetworkCall({ method, url: PREFERENCES_URL }).then((result) => ({
    status: result.status,
    requestJson: result.requestJson as PreferenceRequest | null,
    responseJson: result.responseJson as PreferenceBody | null,
  }))
}

/**
 * Network-first: the read is registered before the navigation that triggers it, so
 * the spec never races the page and never needs a wait. It returns the exchange and
 * asserts nothing, because an `expect` in here would report every failure as
 * "openSettings failed" and hide the claim that actually broke.
 */
async function openSettings(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<PreferenceExchange> {
  const load = watchPreferenceCall(interceptNetworkCall, 'GET')

  await page.goto('/settings')

  const exchange = await load
  await waitForAccessibilityReady(page)

  return exchange
}

test.describe('Story 5.1 web settings affiliate opt-out', () => {
  test('[P1] 5.1-E2E-WEB-01 discloses the integration above the toggle and defaults to enabled', async ({
    commerceSession: _commerceSession,
    page,
    interceptNetworkCall,
  }) => {
    await log.step('Load settings and capture the preference read')
    const loaded = await openSettings(page, interceptNetworkCall)

    expect(loaded.status).toBe(200)
    // A user with no stored row reads as enabled, and the server is the authority on
    // that default.
    expect(loaded.responseJson).toEqual({ data: { affiliateCtasEnabled: true } })

    await log.step('Assert the section, its disclosure, and the control')
    await expect(
      page.getByRole('heading', { name: 'Shopping and partners' })
    ).toBeVisible()

    const disclosure = page.getByTestId('commerce-disclosure')
    await expect(disclosure).toBeVisible()
    await expect(disclosure).toContainText('CoutureCast may earn a commission.')
    await expect(disclosure).toContainText('No wardrobe photos or personal details')

    await expect(optOutToggle(page)).toBeChecked()
    await expect(optOutToggle(page)).toBeEnabled()

    await log.step('Assert the disclosure precedes the control in reading order')
    // PRD FR5.1's acceptance is "disclosures visible before click", a statement
    // about document order.
    const disclosurePrecedesControl = await page.evaluate(() => {
      const text = document.querySelector('[data-testid="commerce-disclosure"]')
      const control = document.querySelector('[data-testid="commerce-opt-out-toggle"]')
      if (!text || !control) return false
      return Boolean(
        text.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    })
    expect(disclosurePrecedesControl).toBe(true)
  })

  test('[P0] 5.1-E2E-WEB-02 turns the opt-out off, persists it across a reload, and turns it back on', async ({
    commerceSession: _commerceSession,
    page,
    interceptNetworkCall,
  }) => {
    await openSettings(page, interceptNetworkCall)

    await log.step('Turn the opt-out off and assert the request and response')
    const turnOff = watchPreferenceCall(interceptNetworkCall, 'PUT')
    await optOutToggle(page).uncheck()

    const offResult = await turnOff
    expect(offResult.status).toBe(200)
    expect(offResult.requestJson).toEqual({ affiliateCtasEnabled: false })
    expect(offResult.responseJson).toEqual({ data: { affiliateCtasEnabled: false } })

    await expect(page.getByTestId('commerce-status-region')).toHaveText(
      'Shopping preferences updated'
    )
    await expect(errorMessage(page)).toHaveCount(0)
    await expect(optOutToggle(page)).not.toBeChecked()

    await log.step('Reload and assert the server, not the client, remembered it')
    const reloaded = await openSettings(page, interceptNetworkCall)
    expect(reloaded.status).toBe(200)
    expect(reloaded.responseJson).toEqual({ data: { affiliateCtasEnabled: false } })
    await expect(optOutToggle(page)).not.toBeChecked()

    await log.step('Turn it back on and assert the round trip again')
    const turnOn = watchPreferenceCall(interceptNetworkCall, 'PUT')
    await optOutToggle(page).check()

    const onResult = await turnOn
    expect(onResult.status).toBe(200)
    expect(onResult.requestJson).toEqual({ affiliateCtasEnabled: true })
    expect(onResult.responseJson).toEqual({ data: { affiliateCtasEnabled: true } })
    await expect(optOutToggle(page)).toBeChecked()

    const restored = await openSettings(page, interceptNetworkCall)
    expect(restored.status).toBe(200)
    expect(restored.responseJson).toEqual({ data: { affiliateCtasEnabled: true } })
    await expect(optOutToggle(page)).toBeChecked()
  })

  test('[P1] 5.1-E2E-WEB-03 passes axe signed in and with the confirmation showing', async ({
    commerceSession: _commerceSession,
    page,
    interceptNetworkCall,
  }) => {
    expect((await openSettings(page, interceptNetworkCall)).status).toBe(200)

    await log.step('Scan the loaded settings page')
    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })

    await log.step('Scan again with the live-region confirmation rendered')
    const save = watchPreferenceCall(interceptNetworkCall, 'PUT')
    await optOutToggle(page).uncheck()
    expect((await save).status).toBe(200)
    await expect(page.getByTestId('commerce-status-region')).toHaveText(
      'Shopping preferences updated'
    )

    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })
  })

  test('[P1] 5.1-E2E-WEB-04 operates from the keyboard alone with a visible focus ring', async ({
    commerceSession: _commerceSession,
    page,
    interceptNetworkCall,
  }) => {
    expect((await openSettings(page, interceptNetworkCall)).status).toBe(200)
    // The intercept resolves when the response arrives, one render before the
    // control becomes interactive. A disabled checkbox is out of the tab order, so
    // tabbing before this lands on the nav.
    await expect(optOutToggle(page)).toBeEnabled()

    await log.step('Tab from the top of the document to the control')
    // The skip link is the first focusable element in the layout and the checkbox is
    // the first one inside `main`, so two presses is the whole path. The exact count
    // is the point: a control reachable only after ten tabs is unusable.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(optOutToggle(page)).toBeFocused()

    await log.step('Assert the focus indicator is actually rendered and visible')
    const ring = await optOutToggle(page).evaluate((element) => {
      const styles = getComputedStyle(element)
      return {
        outlineColor: styles.outlineColor,
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
        boxShadow: styles.boxShadow,
      }
    })
    expect(ring.outlineStyle).toBe('solid')
    expect(Number.parseFloat(ring.outlineWidth)).toBeGreaterThanOrEqual(2)
    expect(contrastRatio(ring.outlineColor, DARK_SURFACE_RGB)).toBeGreaterThanOrEqual(
      MIN_FOCUS_CONTRAST
    )
    // The gold halo is the second half of the indicator; without it the ring is a
    // plain outline and the design token is dead code.
    expect(ring.boxShadow).toContain('201, 161, 74')

    await log.step('Toggle with Space and assert the request went out')
    const save = watchPreferenceCall(interceptNetworkCall, 'PUT')
    await page.keyboard.press('Space')

    const result = await save
    expect(result.status).toBe(200)
    expect(result.requestJson).toEqual({ affiliateCtasEnabled: false })
    await expect(optOutToggle(page)).not.toBeChecked()
    await expect(optOutToggle(page)).toBeFocused()

    await log.step('Assert the target is at least 44 by 44')
    const box = await optOutToggle(page).boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  test(
    '[P1] 5.1-E2E-WEB-05 keeps the control enabled after a failed save and reverts it',
    // The 503 below is the subject of the test. The `networkErrorMonitor` fixture in
    // `merged-fixtures.ts` is `auto: true` and fails any test that sees a response
    // of 400 or worse, so without this annotation the test fails on the monitor
    // before reaching its assertions.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ commerceSession: _commerceSession, page, interceptNetworkCall }) => {
      expect((await openSettings(page, interceptNetworkCall)).status).toBe(200)

      await log.step('Fail the write and assert the app surfaces the catalog message')
      const failedSave = interceptNetworkCall({
        method: 'PUT',
        url: PREFERENCES_URL,
        fulfillResponse: {
          status: 503,
          body: {
            statusCode: 503,
            message: 'Affiliate suggestions are temporarily unavailable.',
            error: 'Service Unavailable',
          },
        },
      })

      await optOutToggle(page).click()
      expect((await failedSave).status).toBe(503)

      // commerce-preferences-section.tsx shows catalog copy unconditionally on a
      // failed save, never the server's English-only error body. A save and a read
      // have no actionable failure to distinguish, so an untranslated server string
      // would tell a reader nothing the catalog string does not.
      await expect(errorMessage(page)).toHaveText(
        'Unable to update shopping preferences.'
      )
      // Reverted. A consent control that keeps showing a state the server rejected
      // is a broken opt-out.
      await expect(optOutToggle(page)).toBeChecked()
      await expect(optOutToggle(page)).toBeEnabled()
      await expect(page.getByTestId('commerce-status-region')).toBeEmpty()
    }
  )
})

anonymousTest.describe('Story 5.1 web settings signed out', () => {
  anonymousTest(
    '[P1] 5.1-E2E-WEB-06 discloses the integration with the control disabled and issues no request',
    async ({ page }) => {
      let preferenceRequests = 0
      await page.route(`**${COMMERCE_PREFERENCES_PATH}`, async (route) => {
        preferenceRequests += 1
        await route.fallback()
      })

      await page.goto('/settings')
      await waitForAccessibilityReady(page)

      await expect(
        page.getByRole('heading', { name: 'Shopping and partners' })
      ).toBeVisible()
      await expect(page.getByTestId('commerce-disclosure')).toBeVisible()
      await expect(page.getByTestId('commerce-signed-out-hint')).toHaveText(
        'Sign in to change this'
      )
      await expect(optOutToggle(page)).toBeDisabled()

      // The page must not ask for a preference it has no credential to read, and the
      // unauthenticated accessibility gate loads this same route.
      expect(preferenceRequests).toBe(0)
    }
  )
})
