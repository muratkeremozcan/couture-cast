import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessTokenIdentityService } from './access-token-identity.service.js'

function mockSupabaseUser(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    )
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function createService(user: { id: string } | null = null) {
  const findFirst = vi.fn().mockResolvedValue(user)
  const prisma = { user: { findFirst } }

  return {
    findFirst,
    service: new AccessTokenIdentityService(prisma as unknown as PrismaClient),
  }
}

describe('AccessTokenIdentityService', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /**
   * Regression: the k6 role segment used a generic character class that also
   * matched hyphens, so a greedy match swallowed the leading segments of any
   * hyphenated user id. Every seeded fixture owner (`teen-1`, and the capsule
   * performance owner) authenticated as an unknown role and got a 401.
   */
  describe('k6 load-test bypass', () => {
    beforeEach(() => {
      vi.stubEnv('TEST_ENV', 'local')
    })

    it.each([
      ['k6-admin-teen-1', 'admin', 'teen-1'],
      ['k6-teen-teen-1', 'teen', 'teen-1'],
      ['k6-admin-perf-capsule-owner', 'admin', 'perf-capsule-owner'],
      ['k6-guardian-guardian-2', 'guardian', 'guardian-2'],
      ['k6-admin-cmsk6t86h0000jp6mwows8lo7', 'admin', 'cmsk6t86h0000jp6mwows8lo7'],
      ['k6-moderator-mod_1', 'moderator', 'mod_1'],
    ])('resolves %s to a hyphen-safe identity', async (token, role, userId) => {
      const { service } = createService()

      await expect(service.resolveIdentity(token)).resolves.toEqual({
        userId,
        role,
      })
    })

    it('still rejects a token whose role is outside the allowlist', async () => {
      const { service } = createService()
      mockSupabaseUser(null, 401)

      await expect(service.resolveIdentity('k6-superuser-teen-1')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })
  })

  it('prefers trusted app metadata and ignores client-controlled user metadata', async () => {
    const fetchMock = mockSupabaseUser({
      app_metadata: {
        app_role: 'ADMIN',
        app_user_id: 'app-user-1',
      },
      email: 'attacker@example.com',
      user_metadata: {
        app_role: 'teen',
        app_user_id: 'spoofed-user',
      },
    })
    const { findFirst, service } = createService()

    await expect(service.resolveIdentity('verified-access-token')).resolves.toEqual({
      userId: 'app-user-1',
      role: 'admin',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/user',
      expect.objectContaining({
        headers: {
          apikey: 'anon-key',
          authorization: 'Bearer verified-access-token',
        },
      })
    )
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('maps a confirmed verified email when trusted app user metadata is absent', async () => {
    mockSupabaseUser({
      app_metadata: { app_role: 'guardian' },
      email: 'USER@Example.com',
      email_confirmed_at: '2026-07-13T12:00:00.000Z',
    })
    const { findFirst, service } = createService({ id: 'app-user-1' })

    await expect(service.resolveIdentity('verified-access-token')).resolves.toEqual({
      userId: 'app-user-1',
      role: 'guardian',
    })
    await expect(service.resolveUserId('verified-access-token')).resolves.toBe(
      'app-user-1'
    )
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        email: {
          equals: 'user@example.com',
          mode: 'insensitive',
        },
      },
      select: { id: true },
    })
  })

  it('rejects email fallback without server confirmation evidence', async () => {
    mockSupabaseUser({
      app_metadata: { app_role: 'guardian' },
      email: 'user@example.com',
      user_metadata: { email_verified: true },
    })
    const { findFirst, service } = createService({ id: 'app-user-1' })

    await expect(service.resolveIdentity('unconfirmed-email')).rejects.toThrow(
      UnauthorizedException
    )
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects roles outside the API authorization allowlist', async () => {
    mockSupabaseUser({
      app_metadata: {
        app_role: 'service_role',
        app_user_id: 'app-user-1',
      },
    })
    const { service } = createService()

    await expect(service.resolveIdentity('unsafe-role')).rejects.toThrow(
      UnauthorizedException
    )
  })

  it('rejects a token Supabase Auth does not accept', async () => {
    mockSupabaseUser({}, 401)
    const { findFirst, service } = createService()

    await expect(service.resolveIdentity('invalid-token')).rejects.toThrow(
      UnauthorizedException
    )
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects confirmed identities that have no matching app user', async () => {
    mockSupabaseUser({
      app_metadata: { app_role: 'guardian' },
      confirmed_at: '2026-07-13T12:00:00.000Z',
      email: 'missing@example.com',
    })
    const { service } = createService()

    await expect(service.resolveIdentity('valid-but-unmapped')).rejects.toThrow(
      UnauthorizedException
    )
  })
})
