import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '@/src/test-utils/msw/server'

describe('mobile msw network mocking', () => {
  it('uses the default handler response', async () => {
    const response = await fetch('https://example.test/health')
    const body = (await response.json()) as { ok: boolean }

    expect(response.ok).toBe(true)
    expect(body.ok).toBe(true)
  })

  it('allows per-test handler overrides', async () => {
    server.use(
      http.get('https://example.test/health', () =>
        HttpResponse.json({ ok: false }, { status: 503 })
      )
    )

    const response = await fetch('https://example.test/health')
    const body = (await response.json()) as { ok: boolean }

    expect(response.status).toBe(503)
    expect(body.ok).toBe(false)
  })
})
