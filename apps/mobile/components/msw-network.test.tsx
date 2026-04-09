import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { ResponseError } from '@couture/api-client'
import { loadMobileApiHealth } from '@/src/lib/api-health'
import { server } from '@/src/test-utils/msw/server'

describe('mobile msw network mocking', () => {
  const originalExpoPublicApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalExpoPublicApiBaseUrl
  })

  it('uses the default handler response', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test'

    const body = await loadMobileApiHealth()

    expect(body.status).toBe('ok')
    expect(body.service).toBe('couturecast-api')
  })

  it('allows per-test handler overrides', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test'
    server.use(
      http.get('https://example.test/api/health', () =>
        HttpResponse.json(
          {
            status: 'ok',
            service: 'couturecast-api',
            environment: 'test',
            gitSha: 'override-sha',
            gitBranch: 'override-branch',
            timestamp: '2026-04-09T00:00:00.000Z',
          },
          { status: 503 }
        )
      )
    )

    try {
      await loadMobileApiHealth()
      throw new Error('Expected the generated mobile client to surface the 503 response')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ResponseError)

      const responseError = error as ResponseError
      expect(responseError.response.status).toBe(503)
    }
  })
})
