// Story 4.4 Task 8 owner: shared test-identity scaffolding for the wardrobe
// onboarding/silhouette Playwright journeys. Extracted out of the three specs
// that each independently defined an identical `CleanupState`, `cleanupState`
// fixture, and `signUpAndAuthenticate` -- centralizing the
// `test-token:guardian:<userId>` token format and the
// `couturecast.access-token` session-storage key here means an auth-scheme
// change only needs one edit instead of three.
import type { Page, TestInfo } from '@playwright/test'
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test as base } from '../fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../../config/environments'
import { buildUniqueId } from './api-test'
import type { ApiRequestFixture } from './api-test'
import { cleanupWardrobeUserTestData } from './user-test-data'

const environment = resolveEnvironmentConfig('local')

export type WardrobeCleanupState = {
  userId?: string
  accessToken?: string
}

/**
 * A wardrobe onboarding/silhouette journey signs up its own isolated API user
 * rather than reusing the shared persisted session (`authSessionEnabled:
 * false` in each describe block), so cleanup is per-test, not global.
 */
export const wardrobeOnboardingTest = base.extend<{
  cleanupState: WardrobeCleanupState
}>({
  cleanupState: async ({ apiRequest }, use) => {
    const state: WardrobeCleanupState = {}
    try {
      await use(state)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        state.accessToken,
        state.userId,
        environment.apiBaseUrl
      )
    }
  },
})

/** Signs up an isolated user through the real API and authenticates the browser as them. */
export async function signUpAndAuthenticate(
  apiRequest: ApiRequestFixture,
  page: Page,
  cleanupState: WardrobeCleanupState,
  testInfo: TestInfo,
  prefix: string
): Promise<string> {
  const signup = await apiRequest({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl: environment.apiBaseUrl,
    body: {
      email: `${buildUniqueId(prefix, testInfo)}@example.test`,
      birthdate: '1990-06-15',
    },
  })
  expect(signup.status).toBe(201)
  const signupBody = signupResponseSchema.parse(signup.body)
  cleanupState.userId = signupBody.userId
  const accessToken = `test-token:guardian:${signupBody.userId}`
  cleanupState.accessToken = accessToken

  await page.addInitScript((token) => {
    window.sessionStorage.setItem('couturecast.access-token', token)
  }, accessToken)
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

  return accessToken
}

export { environment as wardrobeOnboardingEnvironment }
