import { garmentListResponseSchema } from '@couture/api-client/contracts/http'
import { expect } from '../support/fixtures/merged-fixtures'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as test,
} from '../support/helpers/wardrobe-onboarding-session'

const garmentList = '**/api/v1/wardrobe/garments'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test(
  '[P0] Wardrobe shows empty only after the garment list Retry returns zero items @local-lane',
  { annotation: [{ type: 'skipNetworkMonitoring' }] },
  async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
    await signUpAndAuthenticate(
      apiRequest,
      page,
      cleanupState,
      testInfo,
      'wardrobe-retry'
    )
    const setup = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/onboarding',
    })
    const failed = interceptNetworkCall({
      method: 'GET',
      url: garmentList,
      fulfillResponse: {
        status: 503,
        body: {
          statusCode: 503,
          message: 'Temporary garment-list failure',
          error: 'Service Unavailable',
        },
      },
    })

    await page.goto('/wardrobe')
    expect((await setup).status).toBe(200)
    expect((await failed).status).toBe(503)
    await expect(page.getByRole('link', { name: 'Set up your closet' })).toBeVisible()
    const retry = page.getByRole('alert').getByTestId('wardrobe-list-retry')
    const empty = page.getByRole('heading', { name: 'No garments added yet' })
    await expect(retry).toHaveAccessibleName('Try again')
    await expect(retry).toBeVisible()
    await expect(empty).toHaveCount(0)

    // The mock route persists after the utility records its first result.
    await page.unroute(garmentList)
    const retried = interceptNetworkCall({ method: 'GET', url: garmentList })
    await retry.click()
    const response = await retried
    expect(response.status).toBe(200)
    expect(garmentListResponseSchema.parse(response.responseJson).data).toEqual([])
    await expect(retry).toHaveCount(0)
    await expect(empty).toBeVisible()
  }
)
