// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (TEA-18): the app under the Test Store journey reaches our API only through
// this loopback proxy. It logs every request (method, redacted path, action, status; never a
// header, query or body) and can refuse the subscription refresh, the one call that makes the API pull
// the RevenueCat ledger. That log is how a journey record names the path that delivered an
// entitlement, and refusing the refresh is how the preview leg isolates the webhook.
//
// On the preview leg it also adds Vercel's automation bypass header, so the app, which cannot
// send one, reaches the protected preview API. The header value comes from the caller and is
// never logged.
import http from 'node:http'
import https from 'node:https'
import { REFRESH_PATH } from './test-store-journey.mjs'

// A path segment that names a user, member, subscriber or receipt: a UUID, or any segment of 16
// or more characters that carries a digit (cuid, hex and RevenueCat `$RCAnonymousID:` ids).
const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[^/]{16,}|\$RCAnonymousID:.*)$/i

/**
 * The path as the evidence records it (TEA ruling, 2026-11-13): no query string, the segment
 * after `subscribers` as `:subscriber`, and every id-shaped segment as `:id`, so a log line
 * carries no user id or receipt data.
 */
const safeDecode = (segment) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function redactPath(url) {
  const pathname = new URL(url, 'http://proxy.invalid').pathname
  const segments = pathname.split('/')
  return segments
    .map((segment, index) => {
      if (index > 0 && segments[index - 1] === 'subscribers' && segment)
        return ':subscriber'
      return ID_SEGMENT.test(safeDecode(segment)) ? ':id' : segment
    })
    .join('/')
}

const isRefresh = (entry) => entry.method === 'POST' && entry.path === REFRESH_PATH

/**
 * Policy by name: `forward` lets every request through; `block` refuses every refresh;
 * `block-once` refuses the next refresh and then forwards.
 */
export function refreshPolicy(name) {
  if (name === 'forward') return () => 'forward'
  if (name === 'block') return (entry) => (isRefresh(entry) ? 'block' : 'forward')
  if (name === 'block-once') {
    let used = false
    return (entry) => {
      if (used || !isRefresh(entry)) return 'forward'
      used = true
      return 'block'
    }
  }
  throw new Error(`test_store_proxy_policy_invalid: ${name}`)
}

/**
 * Starts the proxy on 127.0.0.1. `target` is the API origin; `headers` are added to every
 * forwarded request. Resolves to { url, port, log, setPolicy(name), close() }.
 */
export function startApiProxy({ target, port = 0, headers = {}, now = Date.now }) {
  const upstream = new URL(target)
  const transport = upstream.protocol === 'https:' ? https : http
  const log = []
  let policy = refreshPolicy('forward')

  const server = http.createServer((request, response) => {
    const entry = {
      at: now(),
      method: request.method,
      path: redactPath(request.url),
    }
    entry.action = policy(entry)
    log.push(entry)
    if (entry.action === 'block') {
      entry.status = 503
      request.resume()
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({ message: 'Refused by the Test Store journey proxy.' })
      )
      return
    }
    const forwarded = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: upstream.host, ...headers },
      },
      (answer) => {
        entry.status = answer.statusCode
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      }
    )
    forwarded.on('error', (error) => {
      entry.status = 502
      entry.error = error.code ?? 'upstream_error'
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(forwarded)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address().port
      resolve({
        url: `http://127.0.0.1:${bound}`,
        port: bound,
        log,
        setPolicy: (name) => {
          policy = refreshPolicy(name)
        },
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
