import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import type { Request } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessTokenIdentityService } from './access-token-identity.service.js'

const requestWithHeaders = (headers: Record<string, string>) =>
  ({ headers }) as unknown as Request

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

  describe('local test bypasses', () => {
    beforeEach(() => {
      vi.stubEnv('TEST_ENV', 'local')
    })

    it.each([
      ['test-token:teen:teen-9', 'teen', 'teen-9'],
      ['test-token:guardian:guardian-2', 'guardian', 'guardian-2'],
      ['test-token:moderator:mod-user-1', 'moderator', 'mod-user-1'],
      ['test-token:admin:cms-1', 'admin', 'cms-1'],
    ])('resolves the integration bypass token %s', async (token, role, userId) => {
      const { service } = createService()

      await expect(service.resolveIdentity(token)).resolves.toEqual({ userId, role })
    })

    it('resolves a Playwright bypass token using the x-user-id header', async () => {
      const { service } = createService()

      await expect(
        service.resolveIdentity(
          'test-token-teen',
          requestWithHeaders({ 'x-user-id': '  pw-teen-1  ' })
        )
      ).resolves.toEqual({ userId: 'pw-teen-1', role: 'teen' })
    })

    it('resolves the bare fallback token from the role and id headers', async () => {
      const { service } = createService()

      await expect(
        service.resolveIdentity(
          'test-token',
          requestWithHeaders({ 'x-user-role': 'MODERATOR', 'x-user-id': 'ops-1' })
        )
      ).resolves.toEqual({ userId: 'ops-1', role: 'moderator' })
    })

    it.each([
      {
        name: 'a Playwright token with no request attached',
        token: 'test-token-teen',
        request: undefined,
      },
      {
        name: 'a Playwright token whose role is outside the allowlist',
        token: 'test-token-superuser',
        request: requestWithHeaders({ 'x-user-id': 'pw-teen-1' }),
      },
      {
        name: 'a Playwright token with no x-user-id header',
        token: 'test-token-teen',
        request: requestWithHeaders({ 'x-forwarded-for': '203.0.113.1' }),
      },
      {
        name: 'the bare fallback token with no request attached',
        token: 'test-token',
        request: undefined,
      },
      {
        name: 'the bare fallback token with an unknown role header',
        token: 'test-token',
        request: requestWithHeaders({ 'x-user-role': 'root', 'x-user-id': 'ops-1' }),
      },
      {
        name: 'the bare fallback token with no id header',
        token: 'test-token',
        request: requestWithHeaders({ 'x-user-role': 'admin' }),
      },
    ])('refuses to grant a bypass identity for $name', async ({ token, request }) => {
      // An incomplete bypass must fall through to Supabase, never invent an identity.
      const { service } = createService()
      const fetchMock = mockSupabaseUser({}, 401)

      await expect(service.resolveIdentity(token, request)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })

  it.each(['preview'])('enables the bypass when VERCEL_ENV is %s', async (vercelEnv) => {
    vi.stubEnv('TEST_ENV', undefined)
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    const { service } = createService()

    await expect(service.resolveIdentity('k6-teen-teen-3')).resolves.toEqual({
      userId: 'teen-3',
      role: 'teen',
    })
  })

  it('never honours a bypass token outside a test environment', async () => {
    // The bypass is the single most dangerous path in auth; it must be env-gated.
    vi.stubEnv('TEST_ENV', undefined)
    vi.stubEnv('VERCEL_ENV', undefined)
    const fetchMock = mockSupabaseUser({}, 401)
    const { service } = createService()

    await expect(
      service.resolveIdentity(
        'test-token',
        requestWithHeaders({ 'x-user-role': 'admin', 'x-user-id': 'ops-1' })
      )
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  describe('missing configuration and transport failures', () => {
    it.each([
      { name: 'the token is blank', token: '   ', env: {} },
      { name: 'SUPABASE_URL is unset', token: 'token', env: { SUPABASE_URL: undefined } },
      {
        name: 'SUPABASE_ANON_KEY is unset',
        token: 'token',
        env: { SUPABASE_ANON_KEY: undefined },
      },
    ])('fails closed without calling Supabase when $name', async ({ token, env }) => {
      for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value)
      }
      const fetchMock = mockSupabaseUser({}, 200)
      const { service } = createService()

      await expect(service.resolveIdentity(token)).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects when the Supabase request itself fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')))
      const { findFirst, service } = createService({ id: 'app-user-1' })

      await expect(service.resolveIdentity('valid-token')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(findFirst).not.toHaveBeenCalled()
    })

    it('rejects when Supabase returns a body that is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response('<html>gateway error</html>', { status: 200 }))
      )
      const { service } = createService({ id: 'app-user-1' })

      await expect(service.resolveIdentity('valid-token')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('rejects when Supabase returns a payload that is not an identity object', async () => {
      mockSupabaseUser(['not', 'an', 'identity'])
      const { service } = createService({ id: 'app-user-1' })

      await expect(service.resolveIdentity('valid-token')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('normalises a Supabase URL that carries a trailing slash', async () => {
      vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co/')
      const fetchMock = mockSupabaseUser({
        app_metadata: { app_role: 'admin', app_user_id: 'app-user-1' },
      })
      const { service } = createService()

      await service.resolveIdentity('valid-token')

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://project.supabase.co/auth/v1/user'
      )
    })
  })

  describe('role resolution from Supabase app metadata', () => {
    it('rejects an identity with no app_metadata at all', async () => {
      mockSupabaseUser({
        email: 'user@example.com',
        confirmed_at: '2026-07-13T12:00:00Z',
      })
      const { findFirst, service } = createService({ id: 'app-user-1' })

      await expect(service.resolveIdentity('no-metadata')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(findFirst).not.toHaveBeenCalled()
    })

    it('falls back to the legacy role claim when app_role is blank', async () => {
      // Older tokens carry `role`; a whitespace-only `app_role` must not mask it.
      mockSupabaseUser({
        app_metadata: { app_role: '   ', role: 'Teen', app_user_id: 'app-user-2' },
      })
      const { service } = createService()

      await expect(service.resolveIdentity('legacy-role-claim')).resolves.toEqual({
        userId: 'app-user-2',
        role: 'teen',
      })
    })

    it('rejects a role claim that is not a string', async () => {
      mockSupabaseUser({ app_metadata: { app_role: 42, app_user_id: 'app-user-3' } })
      const { service } = createService()

      await expect(service.resolveIdentity('numeric-role')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
    })

    it('ignores a blank trusted app_user_id and falls back to the confirmed email', async () => {
      mockSupabaseUser({
        app_metadata: { app_role: 'guardian', app_user_id: '   ' },
        email: 'guardian@example.com',
        email_verified: true,
      })
      const { findFirst, service } = createService({ id: 'db-user-1' })

      await expect(service.resolveIdentity('blank-app-user-id')).resolves.toEqual({
        userId: 'db-user-1',
        role: 'guardian',
      })
      expect(findFirst).toHaveBeenCalledOnce()
    })

    it('rejects an email fallback whose confirmation timestamp is unparseable', async () => {
      mockSupabaseUser({
        app_metadata: { app_role: 'guardian' },
        email: 'guardian@example.com',
        email_confirmed_at: 'sometime last tuesday',
        confirmed_at: '',
      })
      const { findFirst, service } = createService({ id: 'db-user-1' })

      await expect(service.resolveIdentity('bad-timestamp')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(findFirst).not.toHaveBeenCalled()
    })

    it('rejects a confirmed identity whose email is not a valid address', async () => {
      mockSupabaseUser({
        app_metadata: { app_role: 'guardian' },
        email: 'not-an-email',
        email_verified: true,
      })
      const { findFirst, service } = createService({ id: 'db-user-1' })

      await expect(service.resolveIdentity('bad-email')).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      expect(findFirst).not.toHaveBeenCalled()
    })
  })
})
