#!/usr/bin/env node
/**
 * The API gateway of the iOS lane's native Supabase stack, in place of Kong.
 *
 * It reproduces the two Kong services the share-card journey calls, as the
 * Supabase CLI v2.62.5 template (internal/start/templates/kong.yml) declares them:
 *
 * - `/auth/v1/verify`, `/auth/v1/callback`, `/auth/v1/authorize` go to GoTrue's
 *   `/verify`, `/callback` and `/authorize` with the request headers untouched.
 * - `/auth/v1/` goes to GoTrue `/` and `/storage/v1/` to storage-api `/`, both with
 *   the request-transformer that rewrites `Authorization` from the `apikey`.
 * - `/storage/v1/s3/` goes to storage-api `/s3` without that rewrite, because an S3
 *   signature lives in `Authorization`.
 *
 * The CLI template configures no key-auth plugin, so Kong refuses no request for
 * its apikey: an absent or unknown apikey reaches the upstream, which refuses a
 * request whose `Authorization` does not hold a JWT signed with the stack secret.
 * This gateway keeps that contract. Every route also carries Kong's cors plugin
 * with its defaults, and anything else answers Kong's 404.
 *
 * Bodies stream in both directions, so a storage upload never sits in memory.
 */
import http from 'node:http'
import { fileURLToPath } from 'node:url'

/**
 * @typedef {{ prefix: string, upstream: 'gotrue' | 'storage', path: string, bearer: boolean }} Route
 */

/** Kong's routes, longest prefix first (Kong matches the longest path). */
export const ROUTES = /** @type {Route[]} */ ([
  { prefix: '/auth/v1/verify', upstream: 'gotrue', path: '/verify', bearer: false },
  { prefix: '/auth/v1/callback', upstream: 'gotrue', path: '/callback', bearer: false },
  { prefix: '/auth/v1/authorize', upstream: 'gotrue', path: '/authorize', bearer: false },
  { prefix: '/storage/v1/s3/', upstream: 'storage', path: '/s3', bearer: false },
  { prefix: '/storage/v1/', upstream: 'storage', path: '/', bearer: true },
  { prefix: '/auth/v1/', upstream: 'gotrue', path: '/', bearer: true },
])

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Kong's cors plugin defaults: any origin, every method, the asked-for headers. */
const CORS_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT'

/**
 * The route a request path takes and the upstream path Kong's `strip_path` builds
 * from it: the route prefix is removed and the remainder joined to the service path.
 *
 * @param {string} pathname
 * @returns {{ route: Route, upstreamPath: string } | null}
 */
export function matchRoute(pathname) {
  const route = ROUTES.find((candidate) => pathname.startsWith(candidate.prefix))
  if (!route) return null
  const remainder = pathname.slice(route.prefix.length).replace(/^\/+/, '')
  if (remainder === '') return { route, upstreamPath: route.path }
  const base = route.path.endsWith('/') ? route.path : `${route.path}/`
  return { route, upstreamPath: `${base}${remainder}` }
}

/**
 * The `Authorization` value Kong's request-transformer sets on a bearer route,
 * the CLI's `BearerToken` expression:
 *
 *   (authorization ~= nil and authorization:sub(1, 10) ~= 'Bearer sb_' and authorization)
 *   or (apikey == secretKey and 'Bearer ' .. serviceRoleKey)
 *   or (apikey == publishableKey and 'Bearer ' .. anonKey)
 *   or apikey
 *
 * `undefined` means the header is removed, as Kong does when the expression is nil.
 *
 * @param {{ authorization?: string, apikey?: string }} headers
 * @param {{ secretKey: string, serviceRoleKey: string, publishableKey: string, anonKey: string }} keys
 * @returns {string | undefined}
 */
export function bearerFor({ authorization, apikey }, keys) {
  if (authorization !== undefined && authorization.slice(0, 10) !== 'Bearer sb_')
    return authorization
  if (apikey !== undefined && apikey === keys.secretKey)
    return `Bearer ${keys.serviceRoleKey}`
  if (apikey !== undefined && apikey === keys.publishableKey)
    return `Bearer ${keys.anonKey}`
  return apikey
}

/**
 * The headers sent upstream: the client's, less hop-by-hop ones, with Host set to
 * the upstream (Kong's preserve_host is off) and Kong's X-Forwarded-* added.
 *
 * @param {import('node:http').IncomingHttpHeaders} incoming
 * @param {{ route: Route, upstream: URL, clientAddress: string, gatewayPort: number, originalPath: string, keys: Parameters<typeof bearerFor>[1] }} context
 */
export function upstreamHeaders(incoming, context) {
  /** @type {Record<string, string | string[]>} */
  const headers = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'host') continue
    headers[name] = value
  }
  if (context.route.bearer) {
    const single = (/** @type {unknown} */ value) =>
      typeof value === 'string' ? value : undefined
    const authorization = bearerFor(
      {
        authorization: single(incoming.authorization),
        apikey: single(incoming.apikey),
      },
      context.keys
    )
    if (authorization === undefined) delete headers.authorization
    else headers.authorization = authorization
  }
  const requestHost = typeof incoming.host === 'string' ? incoming.host : ''
  const priorFor = incoming['x-forwarded-for']
  headers.host = context.upstream.host
  headers['x-forwarded-for'] = priorFor
    ? `${priorFor}, ${context.clientAddress}`
    : context.clientAddress
  headers['x-forwarded-proto'] = 'http'
  headers['x-forwarded-host'] = requestHost.replace(/:\d+$/, '')
  headers['x-forwarded-port'] = String(context.gatewayPort)
  headers['x-forwarded-path'] = context.originalPath
  headers['x-forwarded-prefix'] = context.route.prefix.replace(/\/$/, '')
  return headers
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function kongError(res, status, message) {
  const body = JSON.stringify({ message })
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

/**
 * @param {{
 *   gotrueUrl: string
 *   storageUrl: string
 *   keys: Parameters<typeof bearerFor>[1]
 * }} options
 */
export function createGateway({ gotrueUrl, storageUrl, keys }) {
  const upstreams = { gotrue: new URL(gotrueUrl), storage: new URL(storageUrl) }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://gateway.invalid')
    const matched = matchRoute(url.pathname)
    if (!matched) {
      req.resume()
      kongError(res, 404, 'no Route matched with those values')
      return
    }
    if (
      req.method === 'OPTIONS' &&
      req.headers.origin &&
      req.headers['access-control-request-method']
    ) {
      req.resume()
      /** @type {Record<string, string>} */
      const preflight = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': CORS_METHODS,
        'content-length': '0',
      }
      const asked = req.headers['access-control-request-headers']
      if (typeof asked === 'string') preflight['access-control-allow-headers'] = asked
      res.writeHead(200, preflight)
      res.end()
      return
    }
    const upstream = upstreams[matched.route.upstream]
    const address = /** @type {import('node:net').AddressInfo} */ (server.address())
    const forward = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: `${matched.upstreamPath}${url.search}`,
      headers: upstreamHeaders(req.headers, {
        route: matched.route,
        upstream,
        clientAddress: req.socket.remoteAddress ?? '',
        gatewayPort: address.port,
        originalPath: url.pathname,
        keys,
      }),
    })
    forward.on('response', (answer) => {
      /** @type {Record<string, string | string[]>} */
      const headers = {}
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value
      }
      headers['access-control-allow-origin'] = '*'
      res.writeHead(answer.statusCode ?? 502, headers)
      answer.pipe(res)
    })
    forward.on('error', () => {
      if (res.headersSent) res.destroy()
      else
        kongError(res, 502, 'An invalid response was received from the upstream server')
    })
    // A client that goes away takes its upstream request with it.
    res.on('close', () => {
      if (!res.writableFinished) forward.destroy()
    })
    req.pipe(forward)
  })
  return server
}

/**
 * Reads the gateway's settings from the environment `native-supabase.mjs start`
 * gives it; every one is required.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function gatewayOptionsFromEnv(env) {
  const read = (/** @type {string} */ name) => {
    const value = env[name]
    if (!value) throw new Error(`${name} is required.`)
    return value
  }
  return {
    port: Number(read('NATIVE_GATEWAY_PORT')),
    gotrueUrl: read('NATIVE_GATEWAY_GOTRUE_URL'),
    storageUrl: read('NATIVE_GATEWAY_STORAGE_URL'),
    keys: {
      anonKey: read('NATIVE_GATEWAY_ANON_KEY'),
      serviceRoleKey: read('NATIVE_GATEWAY_SERVICE_ROLE_KEY'),
      publishableKey: read('NATIVE_GATEWAY_PUBLISHABLE_KEY'),
      secretKey: read('NATIVE_GATEWAY_SECRET_KEY'),
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port, ...options } = gatewayOptionsFromEnv(process.env)
  const server = createGateway(options)
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ status: 'listening', port, pid: process.pid }))
  })
  const stop = () => server.close(() => process.exit(0))
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
