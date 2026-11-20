import { describe, expect, it, vi } from 'vitest'
import {
  PROD_SYNTHETIC_MEMBER_EMAIL,
  TRUSTED_PROD_API_ORIGIN,
  TRUSTED_PROD_WEB_ORIGIN,
  assertTrustedProdOrigins,
  browserSessionOf,
  isProdRun,
  prodMemberApiGet,
  prodMemberStorageState,
  prodSyntheticMemberConfig,
  signInProdSyntheticMember,
  signOutProdSyntheticMember,
} from './prod-synthetic-member'

const SUPABASE = 'https://abcdefghij0123456789.supabase.co'
const ENV = {
  PROD_SUPABASE_URL: `${SUPABASE}/`,
  PROD_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  PROD_SYNTHETIC_MEMBER_PASSWORD: 'run-password',
}

const SESSION = {
  access_token: 'access-1',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 1,
  refresh_token: 'refresh-1',
  user: {
    id: 'auth-user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: PROD_SYNTHETIC_MEMBER_EMAIL,
    app_metadata: { provider: 'email', secret_flag: 'x' },
    user_metadata: { note: 'private' },
    identities: [{ identity_data: { sub: 'x' } }],
  },
}

const answering = (status: number, body: unknown = SESSION) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

const callOf = (mock: ReturnType<typeof answering>) =>
  mock.mock.calls[0] as unknown as [string, RequestInit]

describe('the production synthetic member', () => {
  it('is a production run only', () => {
    expect(isProdRun({ TEST_ENV: 'prod' })).toBe(true)
    expect(isProdRun({ TEST_ENV: 'PROD ' })).toBe(true)
    expect(isProdRun({ TEST_ENV: 'preview' })).toBe(false)
    expect(isProdRun({})).toBe(false)
  })

  it('reads the CI inputs, and falls back to the operator .env.prod names', () => {
    expect(prodSyntheticMemberConfig(ENV)).toMatchObject({
      supabaseUrl: SUPABASE,
      publishableKey: 'sb_publishable_test',
      email: PROD_SYNTHETIC_MEMBER_EMAIL,
      missing: [],
    })
    expect(
      prodSyntheticMemberConfig({
        SUPABASE_URL: 'https://other.supabase.test',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_env',
        PROD_SYNTHETIC_MEMBER_PASSWORD: 'p',
        PROD_SYNTHETIC_MEMBER_EMAIL: 'other@example.com',
      })
    ).toMatchObject({
      supabaseUrl: 'https://other.supabase.test',
      publishableKey: 'sb_publishable_env',
      email: 'other@example.com',
      missing: [],
    })
  })

  it('fails by name when an input is missing, instead of running signed out', async () => {
    await expect(
      signInProdSyntheticMember({ PROD_SUPABASE_URL: SUPABASE }, answering(200))
    ).rejects.toThrow(
      'PROD_SUPABASE_PUBLISHABLE_KEY, PROD_SYNTHETIC_MEMBER_PASSWORD unset'
    )
  })

  it('sends the password to a hosted Supabase project and nowhere else', async () => {
    const fetchImpl = answering(200)
    await expect(
      signInProdSyntheticMember(
        { ...ENV, PROD_SUPABASE_URL: 'https://attacker.example' },
        fetchImpl
      )
    ).rejects.toThrow('not a hosted Supabase project origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('signs in through the password grant with exactly the publishable key header', async () => {
    const fetchImpl = answering(200)
    const member = await signInProdSyntheticMember(ENV, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = callOf(fetchImpl)
    expect(url).toBe(`${SUPABASE}/auth/v1/token?grant_type=password`)
    expect(init.headers).toEqual({
      apikey: 'sb_publishable_test',
      'content-type': 'application/json',
    })
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toEqual({
      email: PROD_SYNTHETIC_MEMBER_EMAIL,
      password: 'run-password',
    })
    expect(member).toMatchObject({
      authUserId: 'auth-user-1',
      accessToken: 'access-1',
      email: PROD_SYNTHETIC_MEMBER_EMAIL,
    })
  })

  it('masks the minted token in the runner log, only on a runner', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await signInProdSyntheticMember(ENV, answering(200))
    expect(log).not.toHaveBeenCalled()
    await signInProdSyntheticMember({ ...ENV, GITHUB_ACTIONS: 'true' }, answering(200))
    expect(log).toHaveBeenCalledWith('::add-mask::access-1')
    log.mockRestore()
  })

  it('names the status, never the password, when production refuses the sign-in', async () => {
    const failure = signInProdSyntheticMember(ENV, answering(400, { error: 'invalid' }))
    await expect(failure).rejects.toThrow('answered 400')
    await expect(failure).rejects.not.toThrow('run-password')
  })

  it('reports a transport failure as a category, without the request or the cause', async () => {
    const reset = vi.fn(() =>
      Promise.reject(
        new Error('socket hang up: Authorization: Bearer secret run-password')
      )
    )
    const failure = signInProdSyntheticMember(ENV, reset)
    await expect(failure).rejects.toThrow('failed to complete')
    await expect(failure).rejects.not.toThrow('run-password')
    await expect(failure).rejects.not.toThrow('Bearer')
  })

  it('refuses an answer with no session', async () => {
    await expect(signInProdSyntheticMember(ENV, answering(200, {}))).rejects.toThrow(
      'returned no session'
    )
  })

  it('pins the credential to the production web and API origins', () => {
    expect(() =>
      assertTrustedProdOrigins(TRUSTED_PROD_WEB_ORIGIN, TRUSTED_PROD_API_ORIGIN)
    ).not.toThrow()
    expect(() =>
      assertTrustedProdOrigins(
        `${TRUSTED_PROD_WEB_ORIGIN}/settings`,
        TRUSTED_PROD_API_ORIGIN
      )
    ).not.toThrow()
    for (const web of [
      'https://preview.couturecast.app',
      'http://couture-cast-web.vercel.app',
      'https://couture-cast-web.vercel.app.attacker.example',
      'not a url',
    ])
      expect(() => assertTrustedProdOrigins(web, TRUSTED_PROD_API_ORIGIN)).toThrow(
        'production web origin'
      )
    expect(() =>
      assertTrustedProdOrigins(
        TRUSTED_PROD_WEB_ORIGIN,
        'https://preview-api.couturecast.app'
      )
    ).toThrow('production API origin')
  })

  it('reads the API only on the production origin, and reports a failure as a category', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const fetchImpl = answering(200, { user: { email: member.email } })
    const read = await prodMemberApiGet(
      member,
      TRUSTED_PROD_API_ORIGIN,
      '/api/v1/user/profile',
      fetchImpl
    )
    expect(read.status).toBe(200)
    const [url, init] = callOf(fetchImpl)
    expect(url).toBe(`${TRUSTED_PROD_API_ORIGIN}/api/v1/user/profile`)
    expect(init.headers).toEqual({
      authorization: 'Bearer access-1',
      'x-couture-platform': 'web',
    })
    expect(init.redirect).toBe('error')

    await expect(
      prodMemberApiGet(member, 'https://preview-api.couturecast.app', '/x', fetchImpl)
    ).rejects.toThrow('production API origin')
    const reset = vi.fn(() => Promise.reject(new Error('reset: Bearer access-1')))
    const failure = prodMemberApiGet(member, TRUSTED_PROD_API_ORIGIN, '/x', reset)
    await expect(failure).rejects.toThrow('failed to complete')
    await expect(failure).rejects.not.toThrow('access-1')
  })

  it('gives a browser a minimal session without the real refresh token', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const stored = browserSessionOf(member)
    expect(stored).toMatchObject({ access_token: 'access-1', token_type: 'bearer' })
    expect(JSON.stringify(stored)).not.toContain('refresh-1')
    // Only what the web app reads: no identities, metadata or other provider data.
    expect(stored.user).toEqual({
      id: 'auth-user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: PROD_SYNTHETIC_MEMBER_EMAIL,
      email_confirmed_at: undefined,
      app_metadata: {},
      user_metadata: {},
      created_at: undefined,
    })
  })

  it('stores the session for the one production web origin, and no other', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const state = prodMemberStorageState(member, `${TRUSTED_PROD_WEB_ORIGIN}/settings`)
    expect(state.cookies).toEqual([])
    expect(state.origins).toHaveLength(1)
    expect(state.origins[0]!.origin).toBe(TRUSTED_PROD_WEB_ORIGIN)
    expect(state.origins[0]!.localStorage.map((entry) => entry.name)).toEqual([
      'couturecast.auth-session',
    ])
    expect(() =>
      prodMemberStorageState(member, 'https://preview.couturecast.app')
    ).toThrow('production web origin')
  })

  it('revokes its own session on sign-out, reports what happened, and never throws', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const fetchImpl = answering(204, {})
    expect(await signOutProdSyntheticMember(member, fetchImpl)).toBe('revoked')
    const [url, init] = callOf(fetchImpl)
    expect(url).toBe(`${SUPABASE}/auth/v1/logout?scope=local`)
    expect(init.headers).toEqual({
      apikey: 'sb_publishable_test',
      authorization: 'Bearer access-1',
    })
    expect(init.redirect).toBe('error')

    expect(await signOutProdSyntheticMember(member, answering(401, {}))).toBe(
      'refused 401'
    )
    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    expect(await signOutProdSyntheticMember(member, failing)).toBe('unreachable')
  })
})
