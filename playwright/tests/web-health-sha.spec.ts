import { test, expect } from '../support/fixtures/merged-fixtures'

process.env.API_E2E_UI_MODE = 'true'

const getExpectedSha = () =>
  process.env.EXPECTED_SHA ?? process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA

test.describe('Web health metadata', () => {
  test('returns status and git metadata', async ({ apiRequest }, testInfo) => {
    const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
    const fallbackBaseUrl = metadata.baseUrl ?? 'http://localhost:3005'
    const healthEndpoint =
      metadata.healthEndpoint ?? new URL('/api/health', fallbackBaseUrl).toString()

    const healthUrl = new URL(healthEndpoint)

    const response = await apiRequest({
      method: 'GET',
      baseUrl: healthUrl.origin,
      path: healthUrl.pathname + healthUrl.search,
    })

    if (!response || typeof response !== 'object') {
      throw new Error('Health response missing payload')
    }

    const { status, body } = response as { status: number; body: unknown }
    expect(status).toBe(200)

    if (!body || typeof body !== 'object') {
      throw new Error('Health response body missing')
    }

    const payload = body as Record<string, unknown>
    expect(payload.status).toBe('ok')
    expect(typeof payload.gitSha).toBe('string')
    expect((payload.gitSha as string).length).toBeGreaterThan(0)
    expect(payload.gitSha).not.toBe('unknown')
    expect(typeof payload.gitBranch).toBe('string')

    const expectedSha = getExpectedSha()
    if (expectedSha) {
      const expectedShort = expectedSha.slice(0, 7)
      const actualShort = (payload.gitSha as string).slice(0, 7)
      expect(actualShort).toBe(expectedShort)
    }
  })
})
