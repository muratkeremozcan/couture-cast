// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { REFRESH_PATH } from './test-store-journey.mjs'
import { redactPath, refreshPolicy, startApiProxy } from './test-store-proxy.mjs'

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

// TEA ruling, 2026-11-13: the evidence carries no user id, subscriber id or receipt data.
test('logged paths drop the query and replace subscriber, member and receipt ids', async (t) => {
  const member = '7b2c4e8a-1f3d-4c5b-9a6e-0d1f2a3b4c5d'
  const cuid = 'clx9a8b7c6d5e4f3g2h1i0j'
  const subscriber = '$RCAnonymousID:4f1c2b9e8d7a6c5b'
  const receipt = 'GPA.3312-4410-2231-55128'
  const api = await upstream(t)
  const proxy = await startApiProxy({ target: api.origin })
  t.after(() => proxy.close())
  const paths = [
    `/api/v1/commerce/subscription?receipt=${receipt}&user=${member}`,
    `/v1/subscribers/${encodeURIComponent(subscriber)}/offerings`,
    '/v1/subscribers/plain-name/attributes',
    `/api/v1/users/${member}/profile`,
    `/api/v1/members/${cuid}`,
    `/api/v1/receipts/${receipt}`,
  ]
  for (const item of paths) await fetch(`${proxy.url}${item}`)
  assert.deepEqual(
    proxy.log.map((entry) => entry.path),
    [
      '/api/v1/commerce/subscription',
      '/v1/subscribers/:subscriber/offerings',
      '/v1/subscribers/:subscriber/attributes',
      '/api/v1/users/:id/profile',
      '/api/v1/members/:id',
      '/api/v1/receipts/:id',
    ]
  )
  const logged = JSON.stringify(proxy.log)
  for (const secret of [
    member,
    cuid,
    '4f1c2b9e8d7a6c5b',
    'RCAnonymousID',
    receipt,
    'plain-name',
  ])
    assert.ok(!logged.includes(secret), secret)
  // The API still received the real path; only the evidence is redacted.
  assert.ok(api.seen.some((entry) => entry.url.includes(member)))
  // Fixed paths stay readable.
  assert.equal(
    redactPath('/api/v1/commerce/subscription/refresh'),
    '/api/v1/commerce/subscription/refresh'
  )
  assert.equal(
    redactPath('/api/v1/commerce/premium/access?x=1'),
    '/api/v1/commerce/premium/access'
  )
})
