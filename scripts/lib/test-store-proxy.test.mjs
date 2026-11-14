// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { REFRESH_PATH } from './test-store-journey.mjs'
import { refreshPolicy, startApiProxy } from './test-store-proxy.mjs'

/** A stand-in API that echoes what reached it. */
async function upstream(t) {
  const seen = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      seen.push({
        method: request.method,
        url: request.url,
        bypass: request.headers['x-vercel-protection-bypass'],
        authorization: request.headers.authorization,
        body,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: { ok: true } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { origin: `http://127.0.0.1:${server.address().port}`, seen }
}

test('forwards with the bypass header, keeps the bearer and body, and logs no query or header', async (t) => {
  const api = await upstream(t)
  const proxy = await startApiProxy({
    target: api.origin,
    headers: { 'x-vercel-protection-bypass': 'fixture-bypass' },
  })
  t.after(() => proxy.close())
  const response = await fetch(`${proxy.url}/api/v1/auth/signup?token=fixture-query`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer fixture-token',
      'content-type': 'application/json',
    },
    body: '{"a":1}',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(api.seen[0], {
    method: 'POST',
    url: '/api/v1/auth/signup?token=fixture-query',
    bypass: 'fixture-bypass',
    authorization: 'Bearer fixture-token',
    body: '{"a":1}',
  })
  assert.equal(proxy.log.length, 1)
  assert.deepEqual(
    { ...proxy.log[0], at: 0 },
    { at: 0, method: 'POST', path: '/api/v1/auth/signup', action: 'forward', status: 200 }
  )
  assert.doesNotMatch(JSON.stringify(proxy.log), /fixture-(bypass|token|query)/)
})

test('block refuses every refresh with 503 and never reaches the API; reads still pass', async (t) => {
  const api = await upstream(t)
  const proxy = await startApiProxy({ target: api.origin })
  t.after(() => proxy.close())
  proxy.setPolicy('block')
  const refresh = await fetch(`${proxy.url}${REFRESH_PATH}`, { method: 'POST' })
  assert.equal(refresh.status, 503)
  const read = await fetch(`${proxy.url}/api/v1/commerce/subscription`)
  assert.equal(read.status, 200)
  assert.deepEqual(
    api.seen.map((entry) => entry.url),
    ['/api/v1/commerce/subscription']
  )
  assert.deepEqual(
    proxy.log.map((entry) => [entry.action, entry.status]),
    [
      ['block', 503],
      ['forward', 200],
    ]
  )
})

test('block-once refuses only the next refresh', () => {
  const policy = refreshPolicy('block-once')
  const refresh = { method: 'POST', path: REFRESH_PATH }
  assert.equal(policy({ method: 'GET', path: REFRESH_PATH }), 'forward')
  assert.equal(policy(refresh), 'block')
  assert.equal(policy(refresh), 'forward')
  assert.throws(() => refreshPolicy('sometimes'), /test_store_proxy_policy_invalid/)
})

test('an unreachable API answers 502 and the log records it', async (t) => {
  const proxy = await startApiProxy({ target: 'http://127.0.0.1:9' })
  t.after(() => proxy.close())
  const response = await fetch(`${proxy.url}/api/health`)
  assert.equal(response.status, 502)
  assert.equal(proxy.log[0].status, 502)
})
