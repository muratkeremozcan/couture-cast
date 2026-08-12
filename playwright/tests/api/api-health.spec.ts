import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../../support/fixtures/merged-fixtures'

test.describe('API smoke', () => {
  test('root endpoint responds with hello message', async ({ apiRequest }, testInfo) => {
    const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
    const apiBaseUrl = metadata.apiBaseUrl ?? 'http://localhost:4000'

    await log.step('Query API root endpoint and verify Hello World payload')
    const rawResponse: unknown = await apiRequest<string>({
      method: 'GET',
      path: '/',
      baseUrl: apiBaseUrl,
      uiMode: true,
    })

    if (!rawResponse || typeof rawResponse !== 'object') {
      throw new Error('API response missing payload')
    }

    const { status, body } = rawResponse as { status: number; body: unknown }
    if (typeof status !== 'number') {
      throw new Error('API response missing numeric status')
    }
    const bodyText =
      typeof body === 'string' ? body : JSON.stringify(body ?? { message: '' })

    expect(status).toBe(200)
    expect(bodyText).toContain('Hello World!')
  })
})
