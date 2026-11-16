// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D3, TEA-14: the Auth Admin client the federated refusals and the orphan sweep use.
import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupabaseAuthAdmin } from './supabase-auth-admin'

const fetchMock = vi.fn<typeof fetch>()

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const authUser = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  email: `person-${n}@example.test`,
  created_at: '2026-11-01T00:00:00.000Z',
  app_metadata: { provider: 'google' },
})

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://auth.example.test/')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-synthetic')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('SupabaseAuthAdmin.deleteUser', () => {
  it('deletes through the Admin API with the service role key', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}))
    await new SupabaseAuthAdmin().deleteUser('user/1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://auth.example.test/auth/v1/admin/users/user%2F1')
    expect(init?.method).toBe('DELETE')
    expect(init?.headers).toEqual({
      apikey: 'service-role-synthetic',
      authorization: 'Bearer service-role-synthetic',
    })
  })

  it('counts a user Auth already removed (user_not_found) as done', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error_code: 'user_not_found' }))
    await expect(new SupabaseAuthAdmin().deleteUser('gone')).resolves.toBeUndefined()
  })

  it.each([
    [
      'a 404 without user_not_found (a wrong SUPABASE_URL)',
      json(404, { message: 'no route' }),
    ],
    ['a 404 that is not JSON', new Response('not found', { status: 404 })],
    ['a 500', json(500, {})],
    ['a 401', json(401, {})],
  ])('fails on %s', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response)
    await expect(new SupabaseAuthAdmin().deleteUser('id')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  it('fails on a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(new SupabaseAuthAdmin().deleteUser('id')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])(
    'fails closed without calling Auth when %s is missing',
    async (name) => {
      vi.stubEnv(name, '')
      await expect(new SupabaseAuthAdmin().deleteUser('id')).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})

describe('SupabaseAuthAdmin.listUsers', () => {
  it('maps users and pages by X-Total-Count', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { users: [authUser(1), authUser(2)] }, { 'x-total-count': '5' })
    )
    const page = await new SupabaseAuthAdmin().listUsers({ page: 1, perPage: 2 })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://auth.example.test/auth/v1/admin/users?page=1&per_page=2'
    )
    expect(page).toEqual({
      users: [
        {
          id: authUser(1).id,
          email: 'person-1@example.test',
          createdAt: '2026-11-01T00:00:00.000Z',
          appMetadata: { provider: 'google' },
        },
        {
          id: authUser(2).id,
          email: 'person-2@example.test',
          createdAt: '2026-11-01T00:00:00.000Z',
          appMetadata: { provider: 'google' },
        },
      ],
      nextPage: 2,
    })
  })

  it('ends on the last page by the total, even when that page is full', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { users: [authUser(3), authUser(4)] }, { 'x-total-count': '4' })
    )
    const page = await new SupabaseAuthAdmin().listUsers({ page: 2, perPage: 2 })
    expect(page.nextPage).toBeNull()
  })

  it.each(['', ' ', 'abc', '-1', '2.5'])(
    'ignores an X-Total-Count of %j and pages by length instead',
    async (header) => {
      fetchMock.mockResolvedValueOnce(
        json(200, { users: [authUser(1), authUser(2)] }, { 'x-total-count': header })
      )
      const page = await new SupabaseAuthAdmin().listUsers({ page: 1, perPage: 2 })
      expect(page.nextPage).toBe(2)
    }
  )

  it('falls back to a short page when Auth sends no total', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { users: [authUser(1)] }))
    const page = await new SupabaseAuthAdmin().listUsers({ page: 1, perPage: 2 })
    expect(page.nextPage).toBeNull()
  })

  it('maps a missing address and metadata to null and {}', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { users: [{ id: 'a', created_at: '2026-11-01T00:00:00.000Z' }] })
    )
    const page = await new SupabaseAuthAdmin().listUsers({ page: 1, perPage: 50 })
    expect(page.users[0]).toEqual({
      id: 'a',
      email: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      appMetadata: {},
    })
  })

  it.each([
    ['a non-2xx answer', json(500, {})],
    ['a body without users', json(200, { items: [] })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('fails on %s', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response)
    await expect(
      new SupabaseAuthAdmin().listUsers({ page: 1, perPage: 2 })
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
