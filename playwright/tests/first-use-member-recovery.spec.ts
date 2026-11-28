// Story CC-7.12 (Step 69): Plan week opens the Looks Plan segment, city setup returns there, and
// an entitled member sees no free preview in place of the removed lock panel.
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  plannerResponseSchema,
  ritualResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from '../support/fixtures/merged-fixtures'
import { localPlaywrightDatabaseUrl } from '../support/helpers/user-test-data'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingEnvironment as environment,
  wardrobeOnboardingTest as test,
} from '../support/helpers/wardrobe-onboarding-session'

const planner = '**/api/v1/commerce/premium/planner'
const ritual = '**/api/v1/ritual?*'
const unavailable = {
  status: 503,
  body: {
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'Temporary upstream failure',
  },
}

async function grantComplimentaryAccess(userId: string) {
  const prisma = new PrismaClient({
    datasourceUrl: localPlaywrightDatabaseUrl().toString(),
  })
  try {
    await prisma.complimentaryAccessGrant.create({
      data: { member_id: userId, reason: 'First-use Planner fixture' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function saveChicago(
  apiRequest: Parameters<typeof signUpAndAuthenticate>[0],
  accessToken: string
) {
  const location = await apiRequest({
    method: 'POST',
    path: '/api/v1/locations',
    baseUrl: environment.apiBaseUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      label: 'Chicago',
      locationKey: 'chicago-il',
      latitude: 41.878,
      longitude: -87.63,
      timezone: 'America/Chicago',
    },
  })
  expect(location.status).toBe(201)
}

test.use({ authSessionEnabled: false })

test.afterEach(async ({ cleanupState }) => {
  if (!cleanupState.userId) return
  const prisma = new PrismaClient({
    datasourceUrl: localPlaywrightDatabaseUrl().toString(),
  })
  try {
    await prisma.complimentaryAccessGrant.deleteMany({
      where: { member_id: cleanupState.userId, reason: 'First-use Planner fixture' },
    })
  } finally {
    await prisma.$disconnect()
  }
})

test.describe('Member Home and Planner recovery', () => {
  test(
    '[P1] Home keeps the changed sample through city Cancel and shows a weather-based look after city save @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'home-choose-city'
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/')
      const sample = page.getByTestId('member-sample-outfit')
      await sample.getByText('Edit sample', { exact: true }).click()
      const outfit = sample.getByTestId('guest-preview-outfit')
      const name = sample.getByTestId('guest-preview-look-name')
      const first = await name.innerText()
      await sample.getByTestId('guest-preview-try-another').click()
      await expect(name).not.toHaveText(first)
      const chosen = await outfit.getAttribute('data-look-id')
      expect(chosen).toBeTruthy()

      const city = sample.getByTestId('home-set-city')
      await city.click()
      const search = page.getByRole('combobox', { name: 'Search for a city' })
      await expect(search).toBeVisible()
      await page.getByTestId('locations-guided-cancel').click()
      await expect(outfit).toHaveAttribute('data-look-id', chosen!)
      await expect(page.getByTestId('share-card-open')).toHaveCount(0)

      await city.click()
      await search.fill(`Sentinel ${randomUUID()}`)
      const option = page.getByRole('option', { name: /Sentinelville/ })
      await expect(option).toBeVisible()
      await option.click()
      const label = page.getByLabel('Name this place')
      await label.fill('First use city')
      const saved = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/locations/from-search',
      })
      await label.press('Enter')
      expect((await saved).status).toBe(201)
      await expect(page.getByTestId('weather-header')).toContainText('First use city')
      await expect(sample.getByTestId('today-outfit-weather-reason')).toBeVisible()
      await expect(sample).toHaveCount(1)
      await expect(city).toHaveCount(0)
      await expect(page.getByTestId('home-live-outfit')).toHaveCount(0)
    }
  )

  test(
    '[P0] An entitled member without a city can reach city setup from the Planner rail @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'planner-no-city'
      )
      await grantComplimentaryAccess(cleanupState.userId!)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/')

      const load = interceptNetworkCall({ method: 'GET', url: planner })
      await page.getByTestId('home-plan-week').click()
      // Story CC-7.12 D11: Plan week links to the Looks Plan segment.
      await expect(page).toHaveURL('/looks?segment=plan')
      const response = await load
      expect(response.status).toBe(400)
      expect(response.responseJson).toMatchObject({
        message: 'No location preferences found for user',
      })

      const rail = page.getByRole('complementary', { name: 'Planner Rail' })
      await expect(rail).toBeVisible()
      await expect(rail.getByTestId('planner-rail-error')).toHaveCount(0)
      // Story CC-7.12 D10: the lock panel is gone; what a non-entitled member sees in its place is
      // the free preview, which an entitled member without a city must not get.
      await expect(rail.getByTestId('plan-free-preview')).toHaveCount(0)
      await expect(page.getByTestId('plan-upgrade')).toHaveCount(0)
      await rail.getByTestId('planner-set-city').click()
      await expect(
        page.getByRole('combobox', { name: 'Search for a city' })
      ).toBeVisible()
      const target = new URL(page.url())
      expect(target.pathname).toBe('/settings/places')
      // Story CC-7.12 D11: city setup returns to the Looks Plan segment (SET_CITY_FROM_PLANNER).
      expect(target.searchParams.get('returnTo')).toBe('/looks?segment=plan')
    }
  )

  test(
    '[P0] Planner Retry recovers the server-generated week on a phone @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      const token = await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'planner-retry'
      )
      await grantComplimentaryAccess(cleanupState.userId!)
      await saveChicago(apiRequest, token)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/')

      const initial = interceptNetworkCall({
        method: 'GET',
        url: planner,
        fulfillResponse: unavailable,
      })
      await page.getByTestId('home-plan-week').click()
      // Story CC-7.12 D11: Plan week links to the Looks Plan segment.
      await expect(page).toHaveURL('/looks?segment=plan')
      expect((await initial).status).toBe(503)
      const rail = page.getByRole('complementary', { name: 'Planner Rail' })
      await expect(rail.getByTestId('planner-rail-error')).toBeVisible()
      await expect(rail.getByTestId('planner-set-city')).toHaveCount(0)
      await expect(rail.getByTestId('planner-days')).toHaveCount(0)

      await page.unroute(planner)
      const recovered = interceptNetworkCall({ method: 'GET', url: planner })
      await rail.getByTestId('planner-rail-retry').click()
      const response = await recovered
      expect(response.status).toBe(200)
      const { days } = plannerResponseSchema.parse(response.responseJson).data
      expect(days).toHaveLength(7)
      expect(days.some((day) => day.status === 'ready')).toBe(true)
      for (const day of days)
        await expect(rail.getByTestId(`planner-day-${day.planDate}`)).toBeVisible()
      await expect(rail.getByTestId('planner-rail-error')).toHaveCount(0)
    }
  )

  test(
    '[P0] Home retains the example until Retry restores the forecast and weather-based look @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      const token = await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'home-ritual-retry'
      )
      await saveChicago(apiRequest, token)
      const initial = interceptNetworkCall({
        method: 'GET',
        url: ritual,
        fulfillResponse: unavailable,
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/')
      expect((await initial).status).toBe(503)

      const sample = page.getByTestId('member-sample-outfit')
      await expect(sample.getByTestId('member-sample-label')).toHaveText('Sample look')
      await sample.getByText('Edit sample', { exact: true }).click()
      const outfit = sample.getByTestId('guest-preview-outfit')
      const original = await outfit.getAttribute('data-look-id')
      expect(original).toBeTruthy()
      await sample.getByTestId('guest-preview-try-another').click()
      await expect(outfit).not.toHaveAttribute('data-look-id', original!)
      await expect(page.getByTestId('home-live-outfit')).toHaveCount(0)
      await expect(page.getByTestId('share-card-open')).toHaveCount(0)

      await page.unroute(ritual)
      const recovered = interceptNetworkCall({ method: 'GET', url: ritual })
      await page.getByTestId('home-outfit-retry').click()
      const response = await recovered
      expect(response.status).toBe(200)
      const { outfits } = ritualResponseSchema.parse(response.responseJson).data
      expect(outfits.some((item) => item.garmentIds.length > 0)).toBe(true)
      await expect(page.getByTestId('weather-header')).toContainText('Chicago')
      await expect(sample.getByTestId('today-outfit-weather-reason')).toBeVisible()
      await expect(sample).toHaveCount(1)
      await expect(page.getByTestId('home-live-outfit')).toHaveCount(0)
      await expect(page.getByTestId('home-outfit-retry')).toHaveCount(0)
    }
  )
})
