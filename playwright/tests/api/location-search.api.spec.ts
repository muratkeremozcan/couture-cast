// Production follow-up after the project close (2026-11-19): "City search unavailable".
//
// Jade searched for her city from /settings and every search failed: the deployed API had no
// geocoding provider key, so /api/v1/locations/search answered 503 provider_unavailable. The
// Story 1.2b location specs are tagged @local-lane and talk to the weather provider double, so no
// run ever asked a deployed API to search. This spec has no tag: locally it reaches the double,
// on a preview it reaches the configured provider through the preview's fixture bearer, and a
// deployment without a working provider fails it. Production rejects synthetic bearers and has no
// provisioned member, so the production run skips the authenticated case.
import { log } from '@seontechnologies/playwright-utils/log'
import { locationSearchResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../../support/fixtures/merged-fixtures'
import {
  authHeaders,
  createSignupPayload,
  resolveApiBaseUrl,
  skipSyntheticAuthInProd,
} from '../../support/helpers/api-test'

const SEARCH_PATH = '/api/v1/locations/search'

test.describe('Location search on the deployed API', () => {
  test('[P0] an adult member searching for Chicago gets Chicago candidates with save tokens', async ({
    apiRequest,
  }, testInfo) => {
    skipSyntheticAuthInProd(testInfo)
    const baseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })

    await log.step('Arrange: an adult member account')
    const signup = await apiRequest<{ userId: string }>({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: createSignupPayload(testInfo, 30, 'location-search'),
    })
    expect(signup.status).toBe(201)

    await log.step('Act: search for Chicago as the web does')
    const response = await apiRequest({
      method: 'GET',
      path: SEARCH_PATH,
      baseUrl,
      headers: {
        ...authHeaders(signup.body.userId, 'guardian'),
        'x-couture-platform': 'web',
      },
      params: { q: 'Chicago', locale: 'en-US' },
    })

    await log.step('Assert: 200 with Chicago candidates that can be saved')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const { data } = locationSearchResponseSchema.parse(response.body)
    // A real provider also knows other places named Chicago (one in South Africa); the one a
    // member in Illinois means must be among them, ready to save.
    const chicago = data.find(
      (candidate) =>
        candidate.city === 'Chicago' &&
        candidate.country === 'US' &&
        candidate.region === 'Illinois'
    )
    expect(chicago, JSON.stringify(data.map((c) => c.displayLabel))).toBeDefined()
    expect(chicago!.displayLabel).toContain('Chicago')
    expect(chicago!.candidateToken.length).toBeGreaterThan(0)
  })

  test('[P1] search refuses a caller without a session', async ({
    apiRequest,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const response = await apiRequest({
      method: 'GET',
      path: SEARCH_PATH,
      baseUrl,
      params: { q: 'Chicago', locale: 'en-US' },
    })
    // Production runs only this case: the route is deployed and guarded there.
    expect(response.status).toBe(401)
  })
})
