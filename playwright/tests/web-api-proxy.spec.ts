// Learning path Step 7: CI and CD automated quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-7-ci-and-cd-automated-quality-gates
import { test, expect } from '../support/fixtures/merged-fixtures'

/**
 * The web app calls the API through its own origin: next.config.ts rewrites `/api/v1/*` to
 * the API base its build environment names. Production shipped with no such variable on
 * 2026-11-11, so every API call from the site, signup included, answered 404 from the web
 * origin while each app's health check stayed green. These two calls reach the API only
 * through that rewrite, need no account, and write nothing.
 */
test.describe('Web origin forwards the API', () => {
  test('WEB-PROXY-01 an unauthenticated API read answers 401 from the API, never 404', async ({
    apiRequest,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? 'http://localhost:3005').origin
    const response = (await apiRequest({
      method: 'GET',
      baseUrl: origin,
      path: '/api/v1/commerce/premium/access',
    })) as { status: number }
    expect(response.status).toBe(401)
  })

  test('WEB-PROXY-02 an invalid signup answers 400 from the API validator, never 404', async ({
    apiRequest,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? 'http://localhost:3005').origin
    const response = (await apiRequest({
      method: 'POST',
      baseUrl: origin,
      path: '/api/v1/auth/signup',
      body: {},
    })) as { status: number }
    expect(response.status).toBe(400)
  })
})
