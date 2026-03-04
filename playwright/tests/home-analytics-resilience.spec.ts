import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('Home analytics resilience', () => {
  test(
    '[P0] keeps key interactions working when poll endpoint fails',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const pollCallPromise = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/events/poll*',
        fulfillResponse: {
          status: 503,
          body: {
            error: 'temporary_poll_failure',
            events: [],
            nextSince: null,
          },
        },
      })

      await page.goto('/')
      const pollCall = await pollCallPromise
      expect(pollCall.status).toBe(503)

      const initialUrl = page.url()
      await page.getByTestId('cta-primary').click()

      await log.step(
        'Primary CTA should capture analytics but avoid navigation side-effects.'
      )
      await expect(page).toHaveURL(initialUrl)
      await expect(page.getByTestId('hero-headline')).toBeVisible()

      await page.getByTestId('cta-secondary').click()
      await expect(page).toHaveURL(/#wardrobe$/)

      await page.getByTestId('nav-community').click()
      await expect(page).toHaveURL(/#community$/)
      await expect(page.getByTestId('health-indicator')).toBeVisible()
    }
  )
})
