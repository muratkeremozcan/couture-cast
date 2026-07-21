import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  resolveApiBaseUrl,
  authHeaders,
  createTeenSignupPayload,
} from '../../support/helpers/api-test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
} from '@couture/api-client/contracts/http'

const COMFORT_PATH = '/api/v1/personalization/comfort'

test.describe('Comfort Preferences API – user personalized comfort settings', () => {
  let oldUiMode: string | undefined
  let testUserId = 'comfort-e2e-user'

  test.beforeAll(async ({ apiRequest }, testInfo) => {
    oldUiMode = process.env.API_E2E_UI_MODE
    process.env.API_E2E_UI_MODE = 'true'

    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    // Sign up a user
    const signupPayload = createTeenSignupPayload(testInfo, 'comfort-e2e-user')
    const signupResponse = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: signupPayload,
    })

    if (signupResponse.status === 201) {
      testUserId = (signupResponse.body as { userId: string }).userId
    }
  })

  test.afterAll(() => {
    if (oldUiMode === undefined) {
      delete process.env.API_E2E_UI_MODE
    } else {
      process.env.API_E2E_UI_MODE = oldUiMode
    }
  })

  test('[P1] unauthenticated request returns 401', async ({ apiRequest }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    await log.step('Act: send unauthenticated GET to /api/v1/personalization/comfort')
    const response = await apiRequest({
      method: 'GET',
      path: COMFORT_PATH,
      baseUrl,
    })

    await log.step('Assert: expect 401 status')
    expect(response.status).toBe(401)
  })

  test('[P1] CRUD comfort preferences returns valid responses', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_RITUAL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    await log.step('Act: GET default comfort preferences')
    const getResponse = await apiRequest({
      method: 'GET',
      path: COMFORT_PATH,
      baseUrl,
      headers: authHeaders(testUserId, 'admin'),
    })

    expect(getResponse.status).toBe(200)
    await validateSchema(comfortPreferencesResponseSchema, getResponse.body)
    const getBody = comfortPreferencesResponseSchema.parse(getResponse.body)
    expect(getBody.data).toEqual({
      runsColdWarm: 'neutral',
      windTolerance: 'medium',
      precipPreparedness: 'medium',
    })

    await log.step('Act: PUT updated comfort preferences')
    const updateResponse = await apiRequest({
      method: 'PUT',
      path: COMFORT_PATH,
      baseUrl,
      headers: authHeaders(testUserId, 'admin'),
      body: {
        runsColdWarm: 'cold',
        windTolerance: 'low',
        precipPreparedness: 'high',
      },
    })

    expect(updateResponse.status).toBe(200)
    await validateSchema(updateComfortPreferencesResponseSchema, updateResponse.body)
    const updateBody = updateComfortPreferencesResponseSchema.parse(updateResponse.body)
    expect(updateBody.data).toEqual({
      runsColdWarm: 'cold',
      windTolerance: 'low',
      precipPreparedness: 'high',
    })

    await log.step('Act: GET comfort preferences again')
    const getResponse2 = await apiRequest({
      method: 'GET',
      path: COMFORT_PATH,
      baseUrl,
      headers: authHeaders(testUserId, 'admin'),
    })

    expect(getResponse2.status).toBe(200)
    const getBody2 = comfortPreferencesResponseSchema.parse(getResponse2.body)
    expect(getBody2.data).toEqual({
      runsColdWarm: 'cold',
      windTolerance: 'low',
      precipPreparedness: 'high',
    })
  })
})
