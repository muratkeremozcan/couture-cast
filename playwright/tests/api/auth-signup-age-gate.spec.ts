import {
  badRequestHttpErrorSchema,
  forbiddenHttpErrorSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  createSignupPayload,
  extractErrorMessage,
  isProdEnvironment,
  resolveApiBaseUrl,
} from '../../support/helpers/api-test'

test.describe('Signup age-gate API contracts', () => {
  test.beforeEach(({}, testInfo) => {
    // These checks create accounts in the backing store. Keep them out of prod
    // until dedicated cleanup/isolation exists for signup identities.
    test.skip(
      isProdEnvironment(testInfo),
      'Skipping signup write-path contract tests in production.'
    )
  })

  test('[P0] returns 403 for children younger than thirteen', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const payload = createSignupPayload(testInfo, 12, 'signup-under-13')
    const { status, body } = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: resolveApiBaseUrl(testInfo),
      body: payload,
    })

    expect(status).toBe(403)
    await validateSchema(forbiddenHttpErrorSchema, body, {
      shape: { statusCode: 403, error: 'Forbidden' },
    })
    expect(extractErrorMessage(body)).toContain('You must be 13 or older')
  })

  test('[P0] returns pending guardian consent for ages thirteen through fifteen', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const payload = createSignupPayload(testInfo, 15, 'signup-guardian-required')
    const { status, body } = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: resolveApiBaseUrl(testInfo),
      body: payload,
    })

    expect(status).toBe(201)
    await validateSchema(signupResponseSchema, body, {
      shape: {
        age: 15,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
  })

  test('[P0] returns active status for users sixteen and older', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const payload = createSignupPayload(testInfo, 16, 'signup-active')
    const { status, body } = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: resolveApiBaseUrl(testInfo),
      body: payload,
    })

    expect(status).toBe(201)
    await validateSchema(signupResponseSchema, body, {
      shape: {
        age: 16,
        accountStatus: 'active',
        guardianConsentRequired: false,
      },
    })
  })

  test('[P1] returns 400 when the email is already registered', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const payload = createSignupPayload(testInfo, 16, 'signup-duplicate')
    const baseUrl = resolveApiBaseUrl(testInfo)

    const firstResponse = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: payload,
    })
    expect(firstResponse.status).toBe(201)
    await validateSchema(signupResponseSchema, firstResponse.body, {
      shape: {
        age: 16,
        accountStatus: 'active',
        guardianConsentRequired: false,
      },
    })

    const duplicateResponse = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: payload,
    })

    expect(duplicateResponse.status).toBe(400)
    await validateSchema(badRequestHttpErrorSchema, duplicateResponse.body, {
      shape: { statusCode: 400, error: 'Bad Request' },
    })
    expect(extractErrorMessage(duplicateResponse.body)).toContain(
      'Email already registered'
    )
  })
})
