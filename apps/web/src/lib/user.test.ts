import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { getUserProfileFromWeb } from './user'

const profile = {
  user: {
    id: 'user-1',
    email: 'teen@example.test',
    displayName: 'Teen One',
    birthdate: '2012-01-31T00:00:00.000Z',
    role: 'teen',
  },
  linkedGuardians: [
    {
      guardianId: 'guardian-1',
      status: 'granted',
      consentGrantedAt: '2026-08-01T09:00:00.000Z',
    },
  ],
  linkedTeens: [],
}

describe('getUserProfileFromWeb', () => {
  it('reads the profile with a credentialed GET and returns the parsed payload', async () => {
    const seen = vi.fn<(method: string, credentials: RequestCredentials) => void>()
    useMswHandlers(
      http.get('/api/v1/user/profile', ({ request }) => {
        seen(request.method, request.credentials)
        return HttpResponse.json(profile)
      })
    )

    const result = await getUserProfileFromWeb()

    expect(result.user.id).toBe('user-1')
    expect(result.linkedGuardians[0]?.status).toBe('granted')
    // The session cookie is the only credential this call carries.
    expect(seen).toHaveBeenCalledWith('GET', 'include')
  })

  /** A guardian-less teen and a null display name are both normal, not errors. */
  it('accepts a profile with no linked guardians and no display name', async () => {
    useMswHandlers(
      http.get('/api/v1/user/profile', () =>
        HttpResponse.json({
          ...profile,
          user: { ...profile.user, displayName: null, birthdate: null },
          linkedGuardians: [],
        })
      )
    )

    const result = await getUserProfileFromWeb()

    expect(result.user.displayName).toBeNull()
    expect(result.linkedGuardians).toEqual([])
  })

  it('surfaces the server message when the session is not authenticated', async () => {
    useMswHandlers(
      http.get('/api/v1/user/profile', () =>
        HttpResponse.json({ message: 'Missing bearer token' }, { status: 401 })
      )
    )

    await expect(getUserProfileFromWeb()).rejects.toThrow('Missing bearer token')
  })

  /** Some error envelopes carry a code but no prose; the caller still needs copy to show. */
  it('falls back to a status message when the error body carries no message', async () => {
    useMswHandlers(
      http.get('/api/v1/user/profile', () =>
        HttpResponse.json({ statusCode: 404, error: 'Not Found' }, { status: 404 })
      )
    )

    await expect(getUserProfileFromWeb()).rejects.toThrow(
      'User request failed with status 404'
    )
  })

  /** An HTML error page from an edge proxy must not surface as a JSON parse crash. */
  it('falls back to a status message when the error body is not JSON', async () => {
    useMswHandlers(
      http.get(
        '/api/v1/user/profile',
        () => new HttpResponse('<html>Gateway Timeout</html>', { status: 504 })
      )
    )

    await expect(getUserProfileFromWeb()).rejects.toThrow(
      'User request failed with status 504'
    )
  })

  /**
   * The role drives which dashboard the web app renders, so an unrecognized role
   * must fail loudly rather than fall through to a default surface.
   */
  it('rejects a profile carrying an unknown role', async () => {
    useMswHandlers(
      http.get('/api/v1/user/profile', () =>
        HttpResponse.json({ ...profile, user: { ...profile.user, role: 'superuser' } })
      )
    )

    await expect(getUserProfileFromWeb()).rejects.toThrow()
  })
})
