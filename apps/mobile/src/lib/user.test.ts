import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import { getUserProfileFromMobile, updatePreferredLocaleFromMobile } from './user'

const profile = {
  user: {
    id: 'user-1',
    email: 'teen@example.com',
    displayName: null,
    birthdate: '2012-05-04T00:00:00.000Z',
    role: 'teen' as const,
  },
  linkedGuardians: [
    {
      guardianId: 'guardian-1',
      status: 'granted' as const,
      consentGrantedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  linkedTeens: [],
}

describe('mobile user profile and preferences', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  let restoreTokenResolver: (() => void) | undefined

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    restoreTokenResolver?.()
    restoreTokenResolver = undefined
  })

  it('reads the profile with its guardian links', async () => {
    server.use(http.get('*/api/v1/user/profile', () => HttpResponse.json(profile)))

    const result = await getUserProfileFromMobile()

    expect(result).toEqual(profile)
    expect(result.linkedGuardians[0]?.status).toBe('granted')
  })

  /**
   * A pending guardian link has no grant timestamp. The nullable field is what
   * lets the teen dashboard distinguish "waiting" from "approved".
   */
  it('keeps a pending guardian link with no grant timestamp', async () => {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({
          ...profile,
          linkedGuardians: [
            { guardianId: 'guardian-2', status: 'pending', consentGrantedAt: null },
          ],
        })
      )
    )

    const result = await getUserProfileFromMobile()

    expect(result.linkedGuardians[0]).toEqual({
      guardianId: 'guardian-2',
      status: 'pending',
      consentGrantedAt: null,
    })
  })

  it('surfaces the API message when the session is rejected', async () => {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      )
    )

    await expect(getUserProfileFromMobile()).rejects.toThrow('Unauthorized')
  })

  /** An HTML gateway page must still yield an actionable message. */
  it('falls back to a status message when the error body is not JSON', async () => {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.text('<html>bad gateway</html>', { status: 502 })
      )
    )

    await expect(getUserProfileFromMobile()).rejects.toThrow(
      'User request failed with status 502'
    )
  })

  /** A body that parses but omits `message` still needs the status fallback. */
  it('falls back to a status message when the error body omits a message', async () => {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({ statusCode: 500 }, { status: 500 })
      )
    )

    await expect(getUserProfileFromMobile()).rejects.toThrow(
      'User request failed with status 500'
    )
  })

  it('rejects a profile whose role is outside the contract enum', async () => {
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({ ...profile, user: { ...profile.user, role: 'superuser' } })
      )
    )

    await expect(getUserProfileFromMobile()).rejects.toThrow()
  })

  it('sends the preferred locale as a bearer-authenticated PUT', async () => {
    restoreTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    let authorization: string | null = null
    let body: unknown
    server.use(
      http.put('*/api/v1/user/preferences', async ({ request }) => {
        authorization = request.headers.get('authorization')
        body = await request.json()
        return HttpResponse.json({ success: true })
      })
    )

    const result = await updatePreferredLocaleFromMobile('fr-CA')

    expect(authorization).toBe('Bearer session-token')
    expect(body).toEqual({ locale: 'fr-CA' })
    expect(result).toEqual({ success: true })
  })

  /**
   * Signed-out locale changes still have to reach the server-side default rather
   * than throwing on a missing token, which is why the resolver falls back to ''.
   */
  it('still sends the locale when no session token is available', async () => {
    restoreTokenResolver = setMobileAccessTokenResolver(() => undefined)
    let authorization: string | null = 'unset'
    server.use(
      http.put('*/api/v1/user/preferences', ({ request }) => {
        authorization = request.headers.get('authorization')
        return HttpResponse.json({ success: true })
      })
    )

    await updatePreferredLocaleFromMobile('tr-TR')

    expect(authorization).toBeNull()
  })

  it('rejects a preferences response that does not confirm success', async () => {
    restoreTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    server.use(
      http.put('*/api/v1/user/preferences', () => HttpResponse.json({ success: false }))
    )

    await expect(updatePreferredLocaleFromMobile('de-DE')).rejects.toThrow()
  })
})
