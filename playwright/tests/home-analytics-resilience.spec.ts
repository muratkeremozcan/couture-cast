// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import type { Page } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../support/fixtures/merged-fixtures'
import {
  buildUniqueId,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from '../support/helpers/api-test'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../support/helpers/commerce-session'
import {
  communityAccessToken,
  signUpCommunityUser,
} from '../support/helpers/community-session'
import { cleanupUserTestData } from '../support/helpers/user-test-data'

async function expectKeyInteractionsWork(page: Page) {
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

test.describe('Home analytics resilience', () => {
  test(
    '[P0] keeps key interactions working for a signed-out visitor',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page }) => {
      await page.goto('/')
      await expectKeyInteractionsWork(page)
    }
  )

  test(
    '[P0] polls with the signed-in bearer and keeps key interactions working when the poll fails',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ context, page, request, interceptNetworkCall }, testInfo) => {
      test.skip(
        isNonLocalEnvironment(testInfo),
        'A signed-in browser session needs the local auth bypass.'
      )

      const apiBaseUrl = resolveApiBaseUrl(testInfo, {
        fallback: 'http://localhost:4000',
      })
      const userId = await signUpCommunityUser(
        request,
        apiBaseUrl,
        buildUniqueId('analytics-poll', testInfo)
      )
      const accessToken = communityAccessToken(userId)

      try {
        // Session storage only, with no context-wide Authorization header: the
        // bearer on the poll has to come from the web client itself.
        await context.addInitScript(
          ([storageKey, token]) => {
            window.sessionStorage.setItem(storageKey as string, token as string)
          },
          [WEB_ACCESS_TOKEN_STORAGE_KEY, accessToken]
        )
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
        expect(pollCall.request?.headers().authorization).toBe(`Bearer ${accessToken}`)

        await expectKeyInteractionsWork(page)
      } finally {
        await cleanupUserTestData(userId)
      }
    }
  )
})
