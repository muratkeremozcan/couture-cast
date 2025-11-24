import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('API smoke', () => {
  test('root endpoint responds with hello message', async ({ request }, testInfo) => {
    const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
    const apiBaseUrl = metadata.apiBaseUrl ?? 'http://localhost:4000'

    const response = await request.get(apiBaseUrl)
    expect(response.ok()).toBeTruthy()

    const body = await response.text()
    expect(body).toContain('Hello World!')
  })
})
