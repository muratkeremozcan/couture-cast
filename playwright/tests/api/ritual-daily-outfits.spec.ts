import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  resolveApiBaseUrl,
  authHeaders,
  createTeenSignupPayload,
} from '../../support/helpers/api-test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  ritualResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'

const RITUAL_PATH = '/api/v1/ritual'

type RitualResponsePayload = {
  status: number
  body: {
    data?: {
      weather: unknown
      outfits: unknown[]
      badges: unknown[]
    }
    message?: string
    statusCode?: number
  }
}

test.describe('Ritual API – daily scenario outfit recommendations', () => {
  let oldUiMode: string | undefined
  let testUserId = 'ritual-e2e-user'
  let locationId = 'loc-e2e-test'

  test.beforeAll(async ({ apiRequest }, testInfo) => {
    oldUiMode = process.env.API_E2E_UI_MODE
    process.env.API_E2E_UI_MODE = 'true'

    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    // Sign up a user
    const signupPayload = createTeenSignupPayload(testInfo, 'ritual-e2e-user')
    const signupResponse = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: signupPayload,
    })

    if (signupResponse.status === 201) {
      testUserId = (signupResponse.body as { userId: string }).userId

      // Create a location preference for this user
      const locationResponse = await apiRequest({
        method: 'POST',
        path: '/api/v1/locations',
        baseUrl,
        headers: authHeaders(testUserId, 'admin'),
        body: {
          label: 'Chicago',
          locationKey: 'chicago-il',
          latitude: 41.878,
          longitude: -87.63,
          timezone: 'America/Chicago',
        },
      })

      if (locationResponse.status === 201) {
        const bodyData = locationResponse.body as { data: { id: string } }
        locationId = bodyData.data.id
      }
    }
  })

  test.afterAll(() => {
    if (oldUiMode === undefined) {
      delete process.env.API_E2E_UI_MODE
    } else {
      process.env.API_E2E_UI_MODE = oldUiMode
    }
  })

  test('[P1] unauthenticated request returns 401', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    await log.step('Act: send unauthenticated GET to /api/v1/ritual')
    const { status, body } = (await apiRequest({
      method: 'GET',
      path: RITUAL_PATH,
      baseUrl,
    })) as RitualResponsePayload

    await log.step('Assert: expect 401 and validate error schema')
    expect(status).toBe(401)
    await validateSchema(unauthorizedHttpErrorSchema, body)
  })

  test('[P1] authenticated request returns valid ritual response', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    await log.step('Act: send authenticated GET to /api/v1/ritual')
    const { status, body } = (await apiRequest({
      method: 'GET',
      path: RITUAL_PATH,
      baseUrl,
      headers: authHeaders(testUserId, 'admin'),
    })) as RitualResponsePayload

    await log.step('Assert: expect 200 and validate ritual response schema')
    expect(status).toBe(200)
    await validateSchema(ritualResponseSchema, body)

    await log.step('Assert: structural assertions on the response data')
    expect(body.data).toBeDefined()
    expect(body.data!.outfits).toHaveLength(3)

    const scenarios = body.data!.outfits.map((o) => (o as { scenario: string }).scenario)
    expect(scenarios).toEqual(expect.arrayContaining(['morning', 'midday', 'evening']))

    await log.step('Assert: weather snapshot and badges are present')
    expect(body.data!.weather).toBeDefined()
    expect(body.data!.badges).toBeDefined()
    expect(Array.isArray(body.data!.badges)).toBe(true)

    const outfits = body.data!.outfits as unknown as {
      scenario: string
      garmentIds: string[]
      reasoningBadges: { key: string; label: string; bullets: string[] }[]
      comfortNotes: string
    }[]

    await log.step('Assert: outfits contain structured reasoningBadges')
    for (const outfit of outfits) {
      expect(outfit.reasoningBadges).toBeDefined()
      expect(Array.isArray(outfit.reasoningBadges)).toBe(true)
      expect(outfit.reasoningBadges.length).toBeGreaterThan(0)
      for (const badge of outfit.reasoningBadges) {
        expect(badge.key).toBeDefined()
        expect(typeof badge.key).toBe('string')
        expect(badge.label).toBeDefined()
        expect(typeof badge.label).toBe('string')
        expect(badge.bullets).toBeDefined()
        expect(Array.isArray(badge.bullets)).toBe(true)
        expect(badge.bullets.length).toBeGreaterThan(0)
        for (const bullet of badge.bullets) {
          expect(typeof bullet).toBe('string')
        }
      }
    }
  })

  test('[P2] optional locationId query param is accepted', async ({
    apiRequest,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    await log.step('Act: send GET with optional locationId query param')
    const { status } = (await apiRequest({
      method: 'GET',
      path: `${RITUAL_PATH}?locationId=${locationId}`,
      baseUrl,
      headers: authHeaders(testUserId, 'admin'),
    })) as RitualResponsePayload

    await log.step('Assert: locationId does not cause a 400 validation error')
    expect(status).toBe(200)
  })
})
