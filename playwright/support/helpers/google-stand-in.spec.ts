// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D10: the stand-in's URL rules and the mock OIDC provider, without a browser.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MOCK_OIDC_URL,
  mockOidcContainerArgs,
} from '../../../scripts/e2e-real-session/mock-oidc-container.mjs'
import { createMockOidcServer } from '../../../scripts/e2e-real-session/mock-oidc.mjs'
import {
  MOCK_OIDC_ORIGIN,
  recordAuthorize,
  rewriteAuthorizeUrl,
  ticketedMockUrl,
} from './google-stand-in'

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

describe('ticketedMockUrl', () => {
  it('keeps the mock URL GoTrue answered with and adds the ticket', () => {
    expect(
      ticketedMockUrl(
        'http://127.0.0.1:53052/realms/cc/protocol/openid-connect/auth?client_id=c&state=s',
        't-1'
      )
    ).toBe(
      'http://127.0.0.1:53052/realms/cc/protocol/openid-connect/auth?client_id=c&state=s&login_hint=t-1'
    )
  })

  it('refuses any other origin', () => {
    expect(ticketedMockUrl('http://127.0.0.1:530520/realms/cc', 't')).toBeNull()
    expect(ticketedMockUrl('http://localhost:53052/realms/cc', 't')).toBeNull()
    expect(
      ticketedMockUrl('http://couturecast-mock-oidc:8080/realms/cc/protocol', 't')
    ).toBeNull()
    expect(
      ticketedMockUrl('https://accounts.google.com/o/oauth2/v2/auth', 't')
    ).toBeNull()
  })
})

describe('mock OIDC topology', () => {
  it('gives GoTrue, the helper and the containers one origin', () => {
    const config = readFileSync(
      path.resolve(__dirname, '../../../supabase/config.toml'),
      'utf8'
    )
    const keycloak = /\[auth\.external\.keycloak\][^[]*?\nurl = "([^"]+)"/.exec(config)
    expect(keycloak?.[1]).toBe(`${MOCK_OIDC_URL}/realms/cc`)
    expect(MOCK_OIDC_ORIGIN).toBe(MOCK_OIDC_URL)
  })

  it("runs the mock in GoTrue's namespace and publishes it on host loopback only", () => {
    const [mock, forwarder] = mockOidcContainerArgs()
    expect(mock.join(' ')).toContain('--network container:supabase_auth_couture-cast')
    expect(mock).not.toContain('-p')
    expect(mock.join(' ')).toContain('MOCK_OIDC_HOST=0.0.0.0')
    expect(forwarder.join(' ')).toContain('--network supabase_network_couture-cast')
    expect(forwarder.join(' ')).toContain('-p 127.0.0.1:53052:53052')
    expect(forwarder.at(-1)).toContain('net.connect(53052, "supabase_auth_couture-cast")')
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
  beforeEach(async () => {
    expect((await fetch(`${base}/__control/reset`, { method: 'POST' })).status).toBe(200)
  })

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

  async function queue(claims: object) {
    return fetch(`${base}/__control/next-identity`, {
      method: 'POST',
      body: JSON.stringify(claims),
    })
  }

  async function authorize(loginHint?: string) {
    const query = new URLSearchParams({
      client_id: 'couturecast-e2e',
      redirect_uri: redirect,
      state: 'opaque',
      response_type: 'code',
      ...(loginHint === undefined ? {} : { login_hint: loginHint }),
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

  async function userinfoFor(location: URL) {
    const token = await fetch(`${base}${oidc}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: location.searchParams.get('code')!,
        client_id: 'couturecast-e2e',
      }),
    })
    expect(token.status).toBe(200)
    const { access_token } = (await token.json()) as { access_token: string }
    const userinfo = await fetch(`${base}${oidc}/userinfo`, {
      headers: { authorization: `Bearer ${access_token}` },
    })
    return (await userinfo.json()) as unknown
  }

  it('gives an authorize without login_hint the queued identity, once', async () => {
    const claims = { sub: 's-q', email: 'queued@synthetic.test', email_verified: true }
    expect((await queue(claims)).status).toBe(201)
    const first = await authorize()
    expect(first.searchParams.get('state')).toBe('opaque')
    expect(await userinfoFor(first)).toEqual(claims)
    const second = await authorize()
    expect(second.searchParams.get('error')).toBe('access_denied')
    expect(second.searchParams.get('code')).toBeNull()
  })

  it('holds one queued identity at a time and refuses one without sub and email', async () => {
    expect((await queue({ sub: 's-a', email: 'a@synthetic.test' })).status).toBe(201)
    expect((await queue({ sub: 's-b', email: 'b@synthetic.test' })).status).toBe(409)
    expect((await queue({ email: 'c@synthetic.test' })).status).toBe(400)
    expect(await userinfoFor(await authorize())).toEqual({
      sub: 's-a',
      email: 'a@synthetic.test',
    })
  })

  it('answers access_denied for a queued deny identity', async () => {
    expect(
      (await queue({ sub: 's-d', email: 'd@synthetic.test', deny: true })).status
    ).toBe(201)
    const location = await authorize()
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('code')).toBeNull()
  })

  it('clears the queued identity on reset', async () => {
    expect((await queue({ sub: 's-r', email: 'r@synthetic.test' })).status).toBe(201)
    expect((await fetch(`${base}/__control/reset`, { method: 'POST' })).status).toBe(200)
    expect((await authorize()).searchParams.get('error')).toBe('access_denied')
  })

  it('takes the ticket over the queued identity when login_hint is present', async () => {
    const claims = { sub: 's-t', email: 't@synthetic.test' }
    expect((await queue({ sub: 's-q2', email: 'q2@synthetic.test' })).status).toBe(201)
    expect(await userinfoFor(await authorize(await ticket(claims)))).toEqual(claims)
    expect(await userinfoFor(await authorize())).toEqual({
      sub: 's-q2',
      email: 'q2@synthetic.test',
    })
  })

  it('answers a request it cannot parse with 400 and keeps serving', async () => {
    const query = new URLSearchParams({
      client_id: 'couturecast-e2e',
      redirect_uri: 'not a url',
    })
    const broken = await fetch(`${base}${oidc}/auth?${query}`, { redirect: 'manual' })
    expect(broken.status).toBe(400)
    expect((await fetch(`${base}/__control/requests`)).status).toBe(200)
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
