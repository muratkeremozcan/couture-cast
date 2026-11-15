// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D10: the stand-in's URL rules and the mock OIDC provider, without a browser.
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMockOidcServer } from '../../../scripts/e2e-real-session/mock-oidc.mjs'
import { publicMockUrl, recordAuthorize, rewriteAuthorizeUrl } from './google-stand-in'

const AUTH = 'http://127.0.0.1:53051/auth/v1/authorize'

describe('rewriteAuthorizeUrl', () => {
  it('changes only the provider of a google authorize request', () => {
    const original = `${AUTH}?provider=google&redirect_to=http%3A%2F%2F127.0.0.1%3A3077%2Fauth%2Fcallback%3Ffrom%3Dpreview&code_challenge=abc&code_challenge_method=s256&prompt=select_account`
    const rewritten = new URL(rewriteAuthorizeUrl(original)!)
    const before = new URL(original)
    expect(rewritten.searchParams.get('provider')).toBe('keycloak')
    before.searchParams.set('provider', 'keycloak')
    expect(rewritten.toString()).toBe(before.toString())
  })

  it.each([
    `${AUTH}?provider=github`,
    'http://127.0.0.1:53051/auth/v1/otp?provider=google',
    'http://127.0.0.1:53051/auth/v1/authorize/extra?provider=google',
  ])('leaves %s alone', (url) => {
    expect(rewriteAuthorizeUrl(url)).toBeNull()
  })
})

describe('recordAuthorize', () => {
  it('reads what the app asked for', () => {
    expect(
      recordAuthorize(
        `${AUTH}?provider=google&redirect_to=http%3A%2F%2F127.0.0.1%3A3077%2Fauth%2Fcallback&code_challenge=abc&code_challenge_method=s256&prompt=select_account`
      )
    ).toEqual({
      provider: 'google',
      prompt: 'select_account',
      redirectTo: 'http://127.0.0.1:3077/auth/callback',
      codeChallengeMethod: 's256',
      hasCodeChallenge: true,
    })
  })
})

describe('publicMockUrl', () => {
  it('moves the internal host to the published port and adds the ticket', () => {
    expect(
      publicMockUrl(
        'http://couturecast-mock-oidc:8080/realms/cc/protocol/openid-connect/auth?client_id=c&state=s',
        't-1'
      )
    ).toBe(
      'http://127.0.0.1:53052/realms/cc/protocol/openid-connect/auth?client_id=c&state=s&login_hint=t-1'
    )
  })

  it('refuses any other host', () => {
    expect(
      publicMockUrl('http://couturecast-mock-oidc.evil:8080/realms/cc', 't')
    ).toBeNull()
    expect(publicMockUrl('https://accounts.google.com/o/oauth2/v2/auth', 't')).toBeNull()
  })
})

describe('mock OIDC provider', () => {
  const server = createMockOidcServer()
  let base = ''
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  const oidc = '/realms/cc/protocol/openid-connect'
  const redirect = 'http://127.0.0.1:54321/auth/v1/callback'

  async function ticket(claims: object) {
    const response = await fetch(`${base}/__control/tickets`, {
      method: 'POST',
      body: JSON.stringify(claims),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { ticket: string }).ticket
  }

  async function authorize(loginHint: string) {
    const query = new URLSearchParams({
      client_id: 'couturecast-e2e',
      redirect_uri: redirect,
      state: 'opaque',
      response_type: 'code',
      login_hint: loginHint,
    })
    const response = await fetch(`${base}${oidc}/auth?${query}`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    return new URL(response.headers.get('location')!)
  }

  it('issues a one-time code that trades for the ticket claims', async () => {
    const claims = { sub: 's-1', email: 'stand-in@synthetic.test', email_verified: true }
    const location = await authorize(await ticket(claims))
    expect(location.origin + location.pathname).toBe(redirect)
    expect(location.searchParams.get('state')).toBe('opaque')
    const code = location.searchParams.get('code')!
    const exchange = () =>
      fetch(`${base}${oidc}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'couturecast-e2e',
          client_secret: '',
          redirect_uri: redirect,
        }),
      })
    const token = await exchange()
    expect(token.status).toBe(200)
    const { access_token } = (await token.json()) as { access_token: string }
    const userinfo = await fetch(`${base}${oidc}/userinfo`, {
      headers: { authorization: `Bearer ${access_token}` },
    })
    expect(await userinfo.json()).toEqual(claims)
    expect((await exchange()).status).toBe(400)
  })

  it('answers access_denied for a deny ticket and for an unknown ticket', async () => {
    for (const hint of [
      await ticket({ sub: 's-2', email: 'd@synthetic.test', deny: true }),
      'nope',
    ]) {
      const location = await authorize(hint)
      expect(location.searchParams.get('error')).toBe('access_denied')
      expect(location.searchParams.get('code')).toBeNull()
    }
  })

  it('refuses a wrong client', async () => {
    const response = await fetch(`${base}${oidc}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'x',
        client_id: 'other',
      }),
    })
    expect(response.status).toBe(401)
  })
})
