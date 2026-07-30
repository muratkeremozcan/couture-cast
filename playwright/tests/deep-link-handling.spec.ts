// Story 3.7 Task 6 step 1 owner: E2E Playwright test widget tap, severe weather alert focus, community lookbook highlight, and invalid deep link fallback
import { test, expect } from '../support/fixtures/merged-fixtures'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'

async function openDeepLink(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  path: string
) {
  const pollCall = interceptNetworkCall({
    method: 'GET',
    url: '**/api/v1/events/poll*',
    fulfillResponse: {
      status: 200,
      body: {
        events: [createWeatherAlertPolledEvent('alert-999', 'guardian')],
        nextSince: '2026-07-30T12:00:00.000Z',
      },
    },
  })

  await page.goto(path)
  expect((await pollCall).status).toBe(200)
}

test.describe('Widget / Notification Deep-Link Handling (Story 3.7)', () => {
  test('3.7-E2E-001: Widget tap deep link URL hydrates hero canvas and active chip', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openDeepLink(page, interceptNetworkCall, '/?source=widget&slot=am')

    const heroTitle = page.getByTestId('hero-recommendation-title')
    await expect(heroTitle).toBeVisible()
    await expect(heroTitle).toHaveText('Double-Breasted Blazer & Silk Knit')

    const personalChip = page.getByTestId('chip-personal')
    await expect(personalChip).toHaveAttribute('aria-pressed', 'true')
  })

  test('3.7-E2E-002: Severe weather notification deep link focuses severe weather alert banner', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openDeepLink(
      page,
      interceptNetworkCall,
      '/?source=notification&type=severe_weather&alertId=alert-999'
    )

    const alertBanner = page.getByTestId('severe-weather-alert-focused')
    await expect(alertBanner).toBeVisible()
    await expect(alertBanner).toContainText('A severe thunderstorm warning is active.')
    await expect(page.getByRole('button', { name: 'Adjust outfit' })).toBeVisible()
  })

  test('3.7-E2E-003: Community notification deep link highlights target lookbook card', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openDeepLink(
      page,
      interceptNetworkCall,
      '/?source=notification&type=community&cardId=look-3'
    )

    const highlightedCard = page.locator('#lookbook-card-look-3')
    await expect(highlightedCard).toBeVisible()
    await expect(highlightedCard).toHaveAttribute('data-highlighted', 'true')
    await expect(highlightedCard).toBeFocused()
  })

  test('3.7-E2E-004: Invalid deep link falls back to hero ritual and displays InfoBanner', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openDeepLink(
      page,
      interceptNetworkCall,
      '/?source=invalid_source&slot=bad_slot'
    )

    const infoBanner = page.getByTestId('deep-link-info-banner')
    await expect(infoBanner).toBeVisible()
    await expect(infoBanner).toContainText(
      'This link is invalid, expired, or no longer available.'
    )

    await expect(page.getByTestId('lookbook-prism-container')).toBeVisible()
  })
})
