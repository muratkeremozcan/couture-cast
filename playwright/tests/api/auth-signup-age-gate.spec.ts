import type { TestInfo } from '@playwright/test'
import {
  badRequestHttpErrorSchema,
  forbiddenHttpErrorSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { test, expect } from '../../support/fixtures/merged-fixtures'
import { buildUniqueId, resolveApiBaseUrl } from '../../support/helpers/api-test'

type SignupPayload = {
  email: string
  birthdate: string
}

type ApiResponsePayload = {
  status: number
  body: unknown
}

type ApiRequestFixture = (params: {
  method: 'POST'
  path: string
  baseUrl: string
  body: unknown
  headers?: Record<string, string>
  retryConfig: { maxRetries: number }
}) => Promise<ApiResponsePayload>

function isProdEnvironment(testInfo: TestInfo): boolean {
  const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
  return metadata.environment === 'prod'
}

function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

async function postSignup(
  apiRequest: unknown,
  baseUrl: string,
  payload: SignupPayload
): Promise<ApiResponsePayload> {
  const request = apiRequest as ApiRequestFixture

  return request({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl,
    body: payload,
    retryConfig: { maxRetries: 0 },
  })
}

function createBirthdate(yearsAgo: number): string {
  const today = new Date()
  const birthdate = new Date(
    Date.UTC(
      today.getUTCFullYear() - yearsAgo,
      today.getUTCMonth(),
      today.getUTCDate(),
      12
    )
  )
  return birthdate.toISOString().slice(0, 10)
}

function createSignupPayload(
  testInfo: TestInfo,
  age: 12 | 15 | 16,
  prefix: string
): SignupPayload {
  return {
    email: `${buildUniqueId(prefix, testInfo)}@example.com`,
    birthdate: createBirthdate(age),
  }
}

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
    const { status, body } = await postSignup(
      apiRequest,
      resolveApiBaseUrl(testInfo),
      payload
    )

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
    const { status, body } = await postSignup(
      apiRequest,
      resolveApiBaseUrl(testInfo),
      payload
    )

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
    const { status, body } = await postSignup(
      apiRequest,
      resolveApiBaseUrl(testInfo),
      payload
    )

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

    const firstResponse = await postSignup(apiRequest, baseUrl, payload)
    expect(firstResponse.status).toBe(201)
    await validateSchema(signupResponseSchema, firstResponse.body, {
      shape: {
        age: 16,
        accountStatus: 'active',
        guardianConsentRequired: false,
      },
    })

    const duplicateResponse = await postSignup(apiRequest, baseUrl, payload)

    expect(duplicateResponse.status).toBe(400)
    await validateSchema(badRequestHttpErrorSchema, duplicateResponse.body, {
      shape: { statusCode: 400, error: 'Bad Request' },
    })
    expect(extractErrorMessage(duplicateResponse.body)).toContain(
      'Email already registered'
    )
  })
})
