// Learning path Step 7: CI and CD automated quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-7-ci-and-cd-automated-quality-gates
import { test, expect } from '../support/fixtures/merged-fixtures'

/**
 * The web app calls the API through its own origin: next.config.ts rewrites `/api/v1/*` to
 * the API base its build environment names. Production shipped with no such variable on
 * 2026-11-11, so every API call from the site, signup included, answered 404 from the web
 * origin while each app's health check stayed green. These two calls reach the API only
 * through that rewrite, need no account, and write nothing.
 *
 * Local and production only. A preview web build has no API rewrite: its branch's API
 * preview alias is not derivable at build time (Vercel shortens long branch aliases with a
 * hash) and sits behind deployment protection, so the preview tier calls the API directly.
 *
 * Each call uses a bare request context, so no inherited bearer or service-role header turns
 * the missing-token path into something else, and each asserts the API's own error body, so
 * a 401 or 400 from anything in front of the API cannot pass.
 */
test.describe('Web origin forwards the API', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.metadata?.environment === 'preview',
      'Preview web builds have no API rewrite; see the comment above.'
    )
  })

  test('WEB-PROXY-01 an unauthenticated API read answers 401 from the API, never 404', async ({
    playwright,
    baseURL,
  }) => {
    const request = await playwright.request.newContext()
    try {
      const origin = new URL(baseURL ?? 'http://localhost:3005').origin
      const response = await request.get(`${origin}/api/v1/commerce/premium/access`)
      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing or invalid bearer token',
      })
    } finally {
      await request.dispose()
    }
  })

  test('WEB-PROXY-02 an invalid signup answers 400 from the API validator, never 404', async ({
    playwright,
    baseURL,
  }) => {
    const request = await playwright.request.newContext()
    try {
      const origin = new URL(baseURL ?? 'http://localhost:3005').origin
      const response = await request.post(`${origin}/api/v1/auth/signup`, { data: {} })
      expect(response.status()).toBe(400)
      expect(await response.json()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid signup payload',
      })
    } finally {
      await request.dispose()
    }
  })
})
