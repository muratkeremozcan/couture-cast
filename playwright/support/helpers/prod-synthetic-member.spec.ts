import { describe, expect, it, vi } from 'vitest'
import {
  PROD_SYNTHETIC_MEMBER_EMAIL,
  browserSessionOf,
  isProdRun,
  prodMemberHeaders,
  prodSyntheticMemberConfig,
  signInProdSyntheticMember,
  signOutProdSyntheticMember,
} from './prod-synthetic-member'

const ENV = {
  PROD_SUPABASE_URL: 'https://project.supabase.test/',
  PROD_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  PROD_SYNTHETIC_MEMBER_PASSWORD: 'run-password',
}

const SESSION = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 1,
  user: { id: 'auth-user-1', email: PROD_SYNTHETIC_MEMBER_EMAIL },
}

const answering = (status: number, body: unknown = SESSION) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

describe('the production synthetic member', () => {
  it('is a production run only', () => {
    expect(isProdRun({ TEST_ENV: 'prod' })).toBe(true)
    expect(isProdRun({ TEST_ENV: 'PROD ' })).toBe(true)
    expect(isProdRun({ TEST_ENV: 'preview' })).toBe(false)
    expect(isProdRun({})).toBe(false)
  })

  it('reads the CI inputs, and falls back to the operator .env.prod names', () => {
    expect(prodSyntheticMemberConfig(ENV)).toMatchObject({
      supabaseUrl: 'https://project.supabase.test',
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
      signInProdSyntheticMember(
        { PROD_SUPABASE_URL: ENV.PROD_SUPABASE_URL },
        answering(200)
      )
    ).rejects.toThrow(
      'PROD_SUPABASE_PUBLISHABLE_KEY, PROD_SYNTHETIC_MEMBER_PASSWORD unset'
    )
  })

  it('signs in through the password grant with the publishable key only', async () => {
    const fetchImpl = answering(200)
    const member = await signInProdSyntheticMember(ENV, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://project.supabase.test/auth/v1/token?grant_type=password')
    expect(init.headers).toMatchObject({ apikey: 'sb_publishable_test' })
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

  it('names the status, never the password, when production refuses the sign-in', async () => {
    const failure = signInProdSyntheticMember(ENV, answering(400, { error: 'invalid' }))
    await expect(failure).rejects.toThrow('answered 400')
    await expect(failure).rejects.not.toThrow('run-password')
  })

  it('refuses an answer with no session', async () => {
    await expect(signInProdSyntheticMember(ENV, answering(200, {}))).rejects.toThrow(
      'returned no session'
    )
  })

  it('gives a browser the session without the refresh token', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const stored = browserSessionOf(member)
    expect(stored).toMatchObject({ access_token: 'access-1' })
    expect(stored.refresh_token).not.toBe('refresh-1')
    expect(JSON.stringify(stored)).not.toContain('refresh-1')
    expect(prodMemberHeaders(member)).toEqual({
      authorization: 'Bearer access-1',
      'x-couture-platform': 'web',
    })
  })

  it('revokes its own session on sign-out, and never throws', async () => {
    const member = await signInProdSyntheticMember(ENV, answering(200))
    const fetchImpl = answering(204, {})
    await signOutProdSyntheticMember(member, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://project.supabase.test/auth/v1/logout?scope=local')
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-1' })

    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(signOutProdSyntheticMember(member, failing)).resolves.toBeUndefined()
  })
})
