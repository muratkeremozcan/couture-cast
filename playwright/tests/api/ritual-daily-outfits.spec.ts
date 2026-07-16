import { test, expect } from '../../support/fixtures/merged-fixtures'
import { resolveApiBaseUrl, authHeaders } from '../../support/helpers/api-test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  ritualResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'

process.env.API_E2E_UI_MODE = 'true'

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
      headers: authHeaders('ritual-e2e-user', 'admin'),
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
      path: `${RITUAL_PATH}?locationId=loc-e2e-test`,
      baseUrl,
      headers: authHeaders('ritual-e2e-user', 'admin'),
    })) as RitualResponsePayload

    await log.step('Assert: locationId does not cause a 400 validation error')
    expect([200, 404]).toContain(status)
  })
})
