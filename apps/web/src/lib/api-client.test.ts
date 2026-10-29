// Learning path Step 15: Validate, generate, and consume the canonical contract.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-15-validate-generate-and-consume-the-canonical-contract
import type { Configuration } from '@couture/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebApiClient } from './api-client'

describe('createWebApiClient', () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('uses the public API base URL env var and include credentials by default', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.couturecast.test/'

    const client = createWebApiClient({
      accessToken: () => 'web-token',
    })
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('https://api.couturecast.test')
    expect(configuration.credentials).toBe('include')
    expect(await configuration.accessToken?.()).toBe('web-token')
  })

  it('falls back to same-origin requests when no public base URL is configured', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL

    const client = createWebApiClient()
    const configuration = (client as unknown as { configuration: Configuration })
      .configuration

    expect(configuration.basePath).toBe('')
    expect(configuration.credentials).toBe('include')
  })
})

describe('A02 actual installed SDK failed-refresh bearer boundary', () => {
  it('retains retryable fallback scope and automatic SDK recovery after held profile and startup failure', async () => {
    vi.resetModules()
    const { http, HttpResponse } = await import('msw')
    const { useMswHandlers } = await import('../test-utils/msw/runtime')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sdk.story65.synthetic.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-key')
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', window.location.origin)
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
    const principal = 'distinct-sdk-principal'
    const makeSession = (ttl: number) => {
      const expiry = (Date.now() + ttl) / 1000
      return {
        access_token: `e30.${btoa(JSON.stringify({ sub: principal, exp: expiry }))}.signature`,
        refresh_token: 'synthetic-refresh-session',
        expires_at: expiry,
        expires_in: ttl / 1000,
        token_type: 'bearer',
        user: {
          id: principal,
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      }
    }
    const storageKey = 'couturecast.auth-session'
    window.localStorage.setItem(storageKey, JSON.stringify(makeSession(120000)))
    let refreshes = 0
    let profileDelay = 0
    let profileStatus = 200
    let refreshReady = false
    let lastProfileBearer: string | null = null
    useMswHandlers(
      http.get('*/api/v1/user/profile', async ({ request }) => {
        lastProfileBearer = request.headers.get('authorization')
        if (profileDelay)
          await new Promise((resolve) => setTimeout(resolve, profileDelay))
        return HttpResponse.json(
          {
            user: {
              id: 'canonical-app-owner',
              email: 'synthetic@example.test',
              displayName: null,
              birthdate: '1990-01-01T00:00:00Z',
              role: 'guardian',
            },
            linkedGuardians: [],
            linkedTeens: [],
          },
          { status: profileStatus }
        )
      }),
      http.post('https://sdk.story65.synthetic.test/auth/v1/token', () => {
        refreshes++
        if (refreshReady) return HttpResponse.json(makeSession(120000))
        return HttpResponse.json(
          { error_code: 'refresh_token_not_found', msg: 'Controlled rejected refresh' },
          { status: 400 }
        )
      }),
      http.post(
        'https://sdk.story65.synthetic.test/auth/v1/logout',
        () => new HttpResponse(null, { status: 204 })
      )
    )
    const session = await import('./web-session')
    let cleanup: (() => void) | undefined
    try {
      cleanup = await session.startWebSession()
      await session.webSupabase().auth.stopAutoRefresh()
      expect(session.webSessionIdentity()).toBe('canonical-app-owner')
      window.localStorage.setItem(storageKey, JSON.stringify(makeSession(1500)))
      // This is the actual SDK fallback after a real controlled refresh response.
      const fallback = await session.webSupabase().auth.getSession()
      expect(refreshes).toBe(1)
      expect(fallback.error).toBeNull()
      // The fallback keeps the stored lifetime. A round trip that lands in the same millisecond
      // leaves all 1500 of it, so the bound is inclusive.
      expect(fallback.data.session!.expires_at! * 1000 - Date.now()).toBeLessThanOrEqual(
        1500
      )
      expect(fallback.data.session!.expires_at! * 1000 - Date.now()).toBeGreaterThan(0)
      const { communityRealtimeTokenFromWeb } = await import('./community')
      await expect(communityRealtimeTokenFromWeb()).rejects.toThrow(
        'Session verification is unavailable.'
      )
      expect(session.webSessionIdentity()).toBe('canonical-app-owner')
      // Actual SDK failed-refresh fallback initially has sufficient lifetime. The
      // final canonical HTTP await consumes four seconds before bearer supply.
      const shortSession = makeSession(5500)
      window.localStorage.setItem(storageKey, JSON.stringify(shortSession))
      profileDelay = 4000
      const started = performance.now()
      await expect(communityRealtimeTokenFromWeb()).rejects.toThrow(
        'Session verification is unavailable.'
      )
      expect(lastProfileBearer).toBe(`Bearer ${shortSession.access_token}`)
      expect(performance.now() - started).toBeGreaterThanOrEqual(3900)
      expect(session.webSessionIdentity()).toBe('canonical-app-owner')
      const freshSession = makeSession(120000)
      window.localStorage.setItem(storageKey, JSON.stringify(freshSession))
      profileDelay = 0
      expect(await communityRealtimeTokenFromWeb()).toBe(freshSession.access_token)
      const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey)!)
      expect(stored).toMatchObject({ refresh_token: 'synthetic-refresh-session' })
      // Reuse the one actual SDK client. Retire the prior subscription before
      // exercising an unverified startup and its automatic recovery lifecycle.
      cleanup()
      cleanup = undefined
      await session.webSupabase().auth.signOut({ scope: 'local' })
      expect(await session.resolveWebSessionToken()).toBeUndefined()
      expect(session.webSessionIdentity()).toBeNull()
      window.localStorage.setItem(storageKey, JSON.stringify(makeSession(120000)))
      profileStatus = 503
      cleanup = await session.startWebSession()
      await session.webSupabase().auth.stopAutoRefresh()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(session.webSessionIdentity()).toBeNull()
      profileStatus = 200
      refreshReady = true
      // TOKEN_REFRESHED must recover canonical ownership without an app resolver.
      const refreshed = await session.webSupabase().auth.refreshSession()
      expect(refreshed.error).toBeNull()
      await vi.waitFor(() =>
        expect(session.webSessionIdentity()).toBe('canonical-app-owner')
      )
      await session.webSupabase().auth.signOut({ scope: 'local' })
      await vi.waitFor(() => expect(session.webSessionIdentity()).toBeNull())
    } finally {
      cleanup?.()
      await session.signOutWebSession()
      vi.unstubAllEnvs()
    }
  }, 15000)
})
