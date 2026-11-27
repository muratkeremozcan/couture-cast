#!/usr/bin/env node
/**
 * Story 6.17 D10: a Keycloak-shaped OpenID Connect provider for the real local stack.
 *
 * Local GoTrue ignores a URL override for its Google provider, so the real-session lane enables
 * GoTrue's Keycloak provider against this server and a Playwright route rewrites the app's
 * `provider=google` authorize request to `provider=keycloak`. GoTrue then runs its real OAuth
 * flow (authorize, callback, code exchange, userinfo, identity linking by verified address) and
 * the app runs its real PKCE callback.
 *
 * Endpoints, under `/realms/<realm>/protocol/openid-connect/`:
 * - `GET auth`: answers 302 to `redirect_uri` with a one-time `code` and the given `state`. The
 *   identity is chosen by `login_hint`, which must name a ticket issued through the control API,
 *   so parallel workers never share an identity. A device browser cannot add a `login_hint`, so
 *   a request without one takes the queued next identity instead (consumed on use). With
 *   neither, or with `{ deny: true }` claims, it answers `error=access_denied`, as a chooser the
 *   person closed does.
 * - `POST token`: exchanges the code for an opaque access token (form body, client secret basic
 *   or post).
 * - `GET userinfo`: the ticket's claims for that access token.
 *
 * Control API (reached from the host only, through the published port; GoTrue never calls it):
 * - `POST /__control/tickets` with `{ sub, email, email_verified, name, picture, deny }` answers
 *   `{ ticket }`.
 * - `POST /__control/next-identity` with the same claims queues them for the next authorize
 *   without a `login_hint`; one at a time, so a second queue while one waits answers 409.
 * - `POST /__control/reset` clears the queued identity.
 * - `GET /__control/requests` answers every request seen, query included, in order.
 *
 * Nothing here signs a token: GoTrue's Keycloak provider reads claims from userinfo.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.MOCK_OIDC_PORT ?? 23052)
const HOST = process.env.MOCK_OIDC_HOST ?? '127.0.0.1'
const CLIENT_ID = process.env.MOCK_OIDC_CLIENT_ID ?? 'couturecast-e2e'
const tickets = new Map()
/** @type {{ claims: Record<string, unknown> } | undefined} */
let queued
const codes = new Map()
const tokens = new Map()
const requests = []

const id = () => randomBytes(16).toString('hex')

function send(response, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(text)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The client id must match; the secret is not compared. GoTrue's own client authentication is
 * the vendor's, and the stack may be started with any `SUPABASE_AUTH_EXTERNAL_KEYCLOAK_SECRET`
 * (a generated value when unset), which this mock cannot know. Codes stay one-time and bound to
 * the ticket that issued them.
 */
function clientAuthenticated(request, form) {
  const header = request.headers.authorization ?? ''
  if (header.startsWith('Basic ')) {
    const [user] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')
    return decodeURIComponent(user ?? '') === CLIENT_ID
  }
  return form.get('client_id') === CLIENT_ID
}

const OIDC = /^\/realms\/[^/]+\/protocol\/openid-connect\/(auth|token|userinfo)$/

/** The claims a control request carries, or null when they are unusable. */
async function readClaims(request) {
  try {
    const claims = JSON.parse((await readBody(request)) || '{}')
    return claims && typeof claims.email === 'string' && typeof claims.sub === 'string'
      ? claims
      : null
  } catch {
    return null
  }
}

async function issueTicket(request, response) {
  const claims = await readClaims(request)
  if (!claims) return send(response, 400, { error: 'sub and email are required' })
  const ticket = id()
  tickets.set(ticket, claims)
  return send(response, 201, { ticket })
}

async function queueNextIdentity(request, response) {
  const claims = await readClaims(request)
  if (!claims) return send(response, 400, { error: 'sub and email are required' })
  if (queued) return send(response, 409, { error: 'an identity is already queued' })
  queued = { claims }
  return send(response, 201, { queued: true })
}

/** A `login_hint` names a ticket; without one the queued identity is taken, once. */
function identityFor(url) {
  const hint = url.searchParams.get('login_hint')
  if (hint) return tickets.get(hint)
  const next = queued?.claims
  queued = undefined
  return next
}

function authorize(url, response) {
  const redirect = url.searchParams.get('redirect_uri')
  const state = url.searchParams.get('state')
  if (!redirect || url.searchParams.get('client_id') !== CLIENT_ID)
    return send(response, 400, { error: 'invalid_request' })
  const claims = identityFor(url)
  const target = new URL(redirect)
  if (state) target.searchParams.set('state', state)
  if (!claims || claims.deny) {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'The resource owner denied the request')
  } else {
    const code = id()
    codes.set(code, { claims, redirect })
    target.searchParams.set('code', code)
  }
  response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
  return response.end()
}

async function exchangeCode(request, response) {
  const form = new URLSearchParams(await readBody(request))
  if (!clientAuthenticated(request, form))
    return send(response, 401, { error: 'invalid_client' })
  const code = form.get('code') ?? ''
  const grant = codes.get(code)
  codes.delete(code)
  if (!grant || form.get('grant_type') !== 'authorization_code')
    return send(response, 400, { error: 'invalid_grant' })
  const accessToken = id()
  tokens.set(accessToken, grant.claims)
  return send(response, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 300,
    scope: 'openid email profile',
  })
}

function userinfo(request, response) {
  const claims = tokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''))
  if (!claims) return send(response, 401, { error: 'invalid_token' })
  const visible = Object.fromEntries(
    Object.entries(claims).filter(([key]) => key !== 'deny')
  )
  return send(response, 200, visible)
}

/** `METHOD endpoint` -> handler; the endpoint is the control path or the OIDC suffix. */
const ROUTES = {
  'POST /__control/tickets': (request, response) => issueTicket(request, response),
  'POST /__control/next-identity': (request, response) =>
    queueNextIdentity(request, response),
  'POST /__control/reset': (_request, response) => {
    queued = undefined
    return send(response, 200, { reset: true })
  },
  'GET /__control/requests': (_request, response) => send(response, 200, requests),
  'GET auth': (request, response, url) => authorize(url, response),
  'POST token': (request, response) => exchangeCode(request, response),
  'GET userinfo': (request, response) => userinfo(request, response),
}

/** Routes one request; throws on a request it cannot parse. */
async function handle(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? HOST}`)
  requests.push({ method: request.method, path: url.pathname, query: url.search })
  const endpoint = OIDC.exec(url.pathname)?.[1] ?? url.pathname
  const handler = ROUTES[`${request.method} ${endpoint}`]
  if (handler) return handler(request, response, url)
  return send(response, OIDC.test(url.pathname) ? 405 : 404, { error: 'not_found' })
}

export function createMockOidcServer() {
  return createServer(async (request, response) => {
    try {
      await handle(request, response)
    } catch (error) {
      // A malformed request answers 400 and never ends the server a whole run depends on.
      process.stderr.write(`mock-oidc: ${request.method} ${request.url}: ${error}\n`)
      if (!response.headersSent) send(response, 400, { error: 'invalid_request' })
      else response.end()
    }
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  createMockOidcServer().listen(PORT, HOST, () => {
    process.stdout.write(`mock-oidc listening on http://${HOST}:${PORT}\n`)
  })
}
