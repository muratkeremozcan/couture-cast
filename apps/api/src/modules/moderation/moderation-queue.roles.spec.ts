// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-Q-CTRL-ROLES claim handling. The role that opens the moderator
// routes comes from `app_metadata` only, and test-token bypasses are closed outside test builds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'

const ADULT_BIRTHDATE = new Date('1985-05-05T00:00:00.000Z')

function service(
  options: { users?: { id: string }[]; profileBirthdate?: Date | null } = {}
) {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue(options.users ?? [{ id: 'db-user-1' }]) },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({
        birthdate:
          options.profileBirthdate === undefined
            ? ADULT_BIRTHDATE
            : options.profileBirthdate,
      }),
    },
  }
  return new AccessTokenIdentityService(prisma as never)
}

function stubSupabaseUser(user: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(user) })
  )
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://auth.test')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('U-Q-CTRL-ROLES: how a caller becomes a moderator', () => {
  it('gives a moderator role from app_metadata.app_role with the trusted app user id', async () => {
    stubSupabaseUser({
      id: 'auth-1',
      app_metadata: { app_role: 'moderator', app_user_id: 'mod-9' },
    })
    await expect(service().resolveIdentity('real-token')).resolves.toEqual({
      userId: 'mod-9',
      role: 'moderator',
    })
  })

  it('ignores a role a member wrote into user_metadata', async () => {
    stubSupabaseUser({
      id: 'auth-2',
      email: 'member@example.test',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      user_metadata: { role: 'moderator', app_role: 'admin' },
      app_metadata: {},
    })
    const identity = await service().resolveIdentity('real-token')
    expect(identity.role).toBe('guardian')
    expect(['moderator', 'admin']).not.toContain(identity.role)
  })

  it('refuses an unknown role string instead of defaulting upward', async () => {
    stubSupabaseUser({
      id: 'auth-3',
      app_metadata: { app_role: 'superuser', app_user_id: 'u' },
    })
    await expect(service().resolveIdentity('real-token')).rejects.toThrow()
  })

  it.each([
    'test-token:moderator:attacker',
    'k6-moderator-attacker',
    'test-token-moderator',
    'test-token',
  ])('rejects the %s bypass when the build is production', async (token) => {
    vi.stubEnv('TEST_ENV', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    stubSupabaseUser({ message: 'invalid' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })
    )
    await expect(
      service().resolveIdentity(token, {
        headers: { 'x-user-id': 'attacker', 'x-user-role': 'moderator' },
      } as never)
    ).rejects.toThrow()
  })
})
