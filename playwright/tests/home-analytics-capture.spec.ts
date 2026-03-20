import { ritualCreatedPropertiesSchema } from '@couture/api-client/types/analytics-events'
import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../support/fixtures/merged-fixtures'

type PostHogCaptureRequest = {
  event: string
  properties: Record<string, unknown>
}

const POSTHOG_FLAGS_ROUTE = '**/ingest/flags/**'

test.describe('Home analytics capture', () => {
  test(
    '[P0] sends ritual_created to PostHog when the primary CTA is clicked',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall, recurse }) => {
      const pageErrors: string[] = []
      const consoleErrors: string[] = []

      // Passive stubs: they should satisfy PostHog traffic if it happens,
      // but this smoke does not make those requests part of the assertion contract.
      void interceptNetworkCall({
        method: 'POST',
        url: POSTHOG_FLAGS_ROUTE,
        fulfillResponse: {
          status: 200,
          body: {
            featureFlags: {},
            featureFlagPayloads: {},
            quotaLimited: [],
          },
        },
      })
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text())
        }
      })

      await page.addInitScript(() => {
        const browserWindow = window as Window & {
          __enableAnalyticsTestHook?: boolean
        }

        browserWindow.__enableAnalyticsTestHook = true
      })

      const pollCallPromise = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/events/poll*',
        fulfillResponse: {
          status: 200,
          body: {
            events: [],
            nextSince: null,
          },
        },
      })

      await log.step('Load the home page with analytics and poll endpoints stubbed.')
      await page.goto('/')
      const pollCall = await pollCallPromise
      expect(pollCall.status).toBe(200)
      await expect(page.getByTestId('hero-headline')).toBeVisible()

      await log.step('Wait for analytics bindings to hydrate before clicking the CTA.')
      await recurse(
        () =>
          page.evaluate(() => {
            const browserWindow = window as Window & {
              __analyticsBindingsReady?: boolean
            }

            return browserWindow.__analyticsBindingsReady === true
          }),
        (isReady) => {
          expect(isReady).toBe(true)
          return true
        },
        {
          timeout: 10_000,
          interval: 100,
        }
      )

      await page.evaluate(() => {
        const browserWindow = window as Window & {
          __capturedAnalyticsEvents?: PostHogCaptureRequest[]
        }

        browserWindow.__capturedAnalyticsEvents = []
      })

      await log.step(
        'Click the primary CTA and assert ritual_created is sent to PostHog.'
      )
      await page.getByTestId('cta-primary').click()

      const capturedRitualCreatedEvent = await recurse(
        () =>
          page.evaluate(() => {
            const browserWindow = window as Window & {
              __capturedAnalyticsEvents?: PostHogCaptureRequest[]
            }

            return (
              browserWindow.__capturedAnalyticsEvents?.find(
                (capturedEvent) => capturedEvent.event === 'ritual_created'
              ) ?? null
            )
          }),
        (capturedEvent) => {
          expect(capturedEvent).not.toBeNull()
          return true
        },
        {
          timeout: 10_000,
          interval: 100,
        }
      )

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])

      const trackedEvent = capturedRitualCreatedEvent
      expect(trackedEvent).not.toBeNull()
      expect(trackedEvent?.event).toBe('ritual_created')

      const parsedProperties = ritualCreatedPropertiesSchema.safeParse(
        trackedEvent?.properties ?? {}
      )

      expect(
        parsedProperties.success,
        parsedProperties.success ? undefined : parsedProperties.error.message
      ).toBe(true)
      expect(trackedEvent?.properties ?? {}).toEqual(
        expect.objectContaining({
          ritual_type: 'daily_outfit',
          weather_context: 'hero_cta',
        })
      )
    }
  )
})
