import { test, expect } from '../support/fixtures/merged-fixtures'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'

test.describe('Widget / Notification Deep-Link Handling (Story 3.7)', () => {
  test.beforeEach(async ({ page }) => {
    // Network-first: intercept APIs BEFORE navigation to prevent flakiness
    await page.route('**/api/v1/events/poll**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [createWeatherAlertPolledEvent('alert-999', 'guardian')],
          nextSince: '2026-07-30T12:00:00.000Z',
        }),
      })
    })

    // Intercept the ritual API to provide deterministic fixture data
    await page.route('**/api/v1/ritual**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            weather: {
              current: { temp: 70, feelsLike: 68, description: 'Clear Sky', icon: '01d' },
              hourly: Array.from({ length: 48 }, (_, i) => ({
                dt: Date.now() / 1000 + i * 3600,
                temp: 65 + i,
                icon: '01d',
              })),
              alerts: null,
            },
            outfits: [
              {
                scenario: 'morning',
                garmentIds: ['classic-trench-coat', 'navy-chinos'],
                comfortNote: 'Mild morning with gentle winds. Trench coat recommended.',
                heroTitle: 'Double-Breasted Blazer & Silk Knit',
                reasoningBadges: [{ label: 'Breeze Guard' }],
              },
              {
                scenario: 'midday',
                garmentIds: ['casual-tee', 'denim-jeans'],
                comfortNote: 'Warm and sunny midday. Light tee is perfect.',
                heroTitle: 'Linen Casual Set',
                reasoningBadges: [{ label: 'UV Shield' }],
              },
              {
                scenario: 'evening',
                garmentIds: ['crewneck-sweater', 'corduroy-pants'],
                comfortNote: 'Cool evening ahead. Sweater recommended.',
                heroTitle: 'Knit Evening Ensemble',
                reasoningBadges: [{ label: 'Warmth Layer' }],
              },
            ],
          },
        }),
      })
    })
  })

  test('3.7-E2E-001: Widget tap deep link URL hydrates hero canvas and active chip', async ({
    page,
  }) => {
    await page.goto('/?source=widget&slot=am')

    const heroTitle = page.getByTestId('hero-recommendation-title')
    await expect(heroTitle).toBeVisible()
    await expect(heroTitle).toHaveText('Double-Breasted Blazer & Silk Knit')

    const personalChip = page.getByTestId('chip-personal')
    await expect(personalChip).toHaveAttribute('aria-pressed', 'true')
  })

  test('3.7-E2E-002: Severe weather notification deep link focuses severe weather alert banner', async ({
    page,
  }) => {
    await page.goto('/?source=notification&type=severe_weather&alertId=alert-999')

    const alertBanner = page.getByTestId('severe-weather-alert-focused')
    await expect(alertBanner).toBeVisible()
    await expect(alertBanner).toContainText('A severe thunderstorm warning is active.')
    await expect(page.getByRole('button', { name: 'Adjust outfit' })).toBeVisible()
  })

  test('3.7-E2E-003: Community notification deep link highlights target lookbook card', async ({
    page,
  }) => {
    await page.goto('/?source=notification&type=community&cardId=look-3')

    const highlightedCard = page.locator('#lookbook-card-look-3')
    await expect(highlightedCard).toBeVisible()
    await expect(highlightedCard).toHaveAttribute('data-highlighted', 'true')
    await expect(highlightedCard).toBeFocused()
  })

  test('3.7-E2E-004: Invalid deep link falls back to hero ritual and displays InfoBanner', async ({
    page,
  }) => {
    await page.goto('/?source=invalid_source&slot=bad_slot')

    const infoBanner = page.getByTestId('deep-link-info-banner')
    await expect(infoBanner).toBeVisible()
    await expect(infoBanner).toContainText('We refreshed your data after reconnecting')

    await expect(page.getByTestId('lookbook-prism-container')).toBeVisible()
  })
})
