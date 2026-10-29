import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import {
  bearerFor,
  createGateway,
  gatewayOptionsFromEnv,
  matchRoute,
} from './native-supabase-gateway.mjs'

const keys = {
  anonKey: 'anon.jwt',
  serviceRoleKey: 'service.jwt',
  publishableKey: 'sb_publishable_fixture',
  secretKey: 'sb_secret_fixture',
}

/** An upstream that records each request and answers with what the test asks. */
async function recordingUpstream(t, answer = (req, res) => res.end('ok')) {
  const seen = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    seen.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks),
    })
    answer(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  return { seen, url: `http://127.0.0.1:${server.address().port}` }
}

async function gateway(t, gotrue, storage) {
  const server = createGateway({ gotrueUrl: gotrue.url, storageUrl: storage.url, keys })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

test('Kong routes map to their upstream paths with the prefix stripped', () => {
  const cases = [
    ['/auth/v1/user', 'gotrue', '/user', true],
    ['/auth/v1/admin/users/abc', 'gotrue', '/admin/users/abc', true],
    ['/auth/v1/verify', 'gotrue', '/verify', false],
    ['/auth/v1/verify/extra', 'gotrue', '/verify/extra', false],
    ['/auth/v1/callback', 'gotrue', '/callback', false],
    ['/auth/v1/authorize', 'gotrue', '/authorize', false],
    [
      '/storage/v1/object/community-images/a/b.png',
      'storage',
      '/object/community-images/a/b.png',
      true,
    ],
    ['/storage/v1/bucket', 'storage', '/bucket', true],
    ['/storage/v1/s3/bucket/key', 'storage', '/s3/bucket/key', false],
  ]
  for (const [pathname, upstream, upstreamPath, bearer] of cases) {
    const matched = matchRoute(pathname)
    assert.equal(matched?.route.upstream, upstream, pathname)
    assert.equal(matched?.upstreamPath, upstreamPath, pathname)
    assert.equal(matched?.route.bearer, bearer, pathname)
  }
  for (const pathname of [
    '/',
    '/auth/v1',
    '/storage/v1',
    '/rest/v1/users',
    '/realtime/v1/x',
  ])
    assert.equal(matchRoute(pathname), null, pathname)
})

test('the Authorization rewrite follows the CLI BearerToken expression', () => {
  // A client JWT passes through unchanged.
  assert.equal(
    bearerFor({ authorization: 'Bearer user.jwt', apikey: keys.secretKey }, keys),
    'Bearer user.jwt'
  )
  // An opaque key in Authorization is replaced from the apikey.
  assert.equal(
    bearerFor(
      { authorization: 'Bearer sb_secret_fixture', apikey: keys.secretKey },
      keys
    ),
    'Bearer service.jwt'
  )
  assert.equal(bearerFor({ apikey: keys.publishableKey }, keys), 'Bearer anon.jwt')
  // A legacy JWT apikey is copied as is, which Kong also does.
  assert.equal(bearerFor({ apikey: 'anon.jwt' }, keys), 'anon.jwt')
  // Nothing to go on: the header is removed.
  assert.equal(bearerFor({}, keys), undefined)
  assert.equal(bearerFor({ authorization: 'Bearer sb_unknown' }, keys), undefined)
})

test('an unrouted path gets Kong 404 and never reaches an upstream', async (t) => {
  const gotrue = await recordingUpstream(t)
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  const response = await fetch(`${base}/rest/v1/users`, {
    headers: { apikey: keys.anonKey },
  })
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    message: 'no Route matched with those values',
  })
  assert.equal(gotrue.seen.length + storage.seen.length, 0)
})

test('auth requests reach GoTrue stripped, with the query and client headers kept', async (t) => {
  const gotrue = await recordingUpstream(t, (req, res) => {
    res.setHeader('x-upstream', 'gotrue')
    res.setHeader('set-cookie', ['a=1', 'b=2'])
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  const response = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: keys.anonKey,
      'content-type': 'application/json',
      'x-client-info': 'supabase-js/2',
    },
    body: '{"refresh_token":"r"}',
  })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-upstream'), 'gotrue')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(response.headers.getSetCookie(), ['a=1', 'b=2'])
  assert.deepEqual(await response.json(), { ok: true })
  const [request] = gotrue.seen
  assert.equal(request.method, 'POST')
  assert.equal(request.url, '/token?grant_type=refresh_token')
  assert.equal(request.headers.apikey, keys.anonKey)
  assert.equal(request.headers.authorization, keys.anonKey)
  assert.equal(request.headers['x-client-info'], 'supabase-js/2')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(request.headers.host, new URL(gotrue.url).host)
  assert.equal(request.headers['x-forwarded-prefix'], '/auth/v1')
  assert.equal(request.headers['x-forwarded-path'], '/auth/v1/token')
  assert.equal(request.headers['x-forwarded-proto'], 'http')
  assert.equal(request.body.toString(), '{"refresh_token":"r"}')
  assert.equal(storage.seen.length, 0)
})

test('an absent apikey is refused by the upstream, never by the gateway', async (t) => {
  const gotrue = await recordingUpstream(t, (req, res) => {
    res.writeHead(req.headers.authorization ? 200 : 401, {
      'content-type': 'application/json',
    })
    res.end(req.headers.authorization ? '{}' : '{"message":"no authorization"}')
  })
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  const response = await fetch(`${base}/auth/v1/admin/users`)
  assert.equal(response.status, 401)
  assert.equal(gotrue.seen.length, 1)
  assert.equal(gotrue.seen[0].headers.authorization, undefined)
})

test('the open verify route keeps the request headers untouched', async (t) => {
  const gotrue = await recordingUpstream(t, (req, res) => {
    res.writeHead(303, { location: 'http://127.0.0.1:3000/#access_token=x' })
    res.end()
  })
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  const response = await fetch(`${base}/auth/v1/verify?token=t&type=magiclink`, {
    headers: { apikey: keys.secretKey },
    redirect: 'manual',
  })
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), 'http://127.0.0.1:3000/#access_token=x')
  assert.equal(gotrue.seen[0].url, '/verify?token=t&type=magiclink')
  assert.equal(gotrue.seen[0].headers.authorization, undefined)
})

test('a secret apikey becomes the service-role bearer on storage', async (t) => {
  const gotrue = await recordingUpstream(t)
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  await fetch(`${base}/storage/v1/bucket`, { headers: { apikey: keys.secretKey } })
  assert.equal(storage.seen[0].url, '/bucket')
  assert.equal(storage.seen[0].headers.authorization, 'Bearer service.jwt')
})

test('storage uploads stream through in both directions', async (t) => {
  const size = 6 * 1024 * 1024
  const gotrue = await recordingUpstream(t)
  const storage = await recordingUpstream(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    // A chunked answer, the way storage-api streams a download.
    res.write(Buffer.alloc(size / 2, 1))
    res.end(Buffer.alloc(size / 2, 2))
  })
  const base = await gateway(t, gotrue, storage)
  const payload = Buffer.alloc(size, 7)
  // A chunked request body: the gateway must not need a content-length.
  const response = await fetch(`${base}/storage/v1/object/community-images/a.png`, {
    method: 'POST',
    headers: { authorization: 'Bearer user.jwt', 'content-type': 'image/png' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload.subarray(0, size / 2))
        controller.enqueue(payload.subarray(size / 2))
        controller.close()
      },
    }),
    duplex: 'half',
  })
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(response.status, 200)
  assert.equal(body.length, size)
  assert.equal(body[0], 1)
  assert.equal(body[size - 1], 2)
  const [request] = storage.seen
  assert.equal(request.url, '/object/community-images/a.png')
  assert.equal(request.headers.authorization, 'Bearer user.jwt')
  assert.equal(request.headers['content-type'], 'image/png')
  assert.ok(request.body.equals(payload))
})

test('a CORS preflight is answered by the gateway, like Kong cors', async (t) => {
  const gotrue = await recordingUpstream(t)
  const storage = await recordingUpstream(t)
  const base = await gateway(t, gotrue, storage)
  const response = await fetch(`${base}/auth/v1/user`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:3088',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'apikey,authorization',
    },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(
    response.headers.get('access-control-allow-headers'),
    'apikey,authorization'
  )
  assert.equal(gotrue.seen.length, 0)
})

test('an unreachable upstream answers Kong 502', async (t) => {
  const closed = http.createServer()
  closed.listen(0, '127.0.0.1')
  await once(closed, 'listening')
  const url = `http://127.0.0.1:${closed.address().port}`
  closed.close()
  await once(closed, 'close')
  const storage = await recordingUpstream(t)
  const base = await gateway(t, { url }, storage)
  const response = await fetch(`${base}/auth/v1/health`)
  assert.equal(response.status, 502)
  assert.match((await response.json()).message, /invalid response/)
})

test('the gateway refuses to start without every setting', () => {
  const env = {
    NATIVE_GATEWAY_PORT: '54321',
    NATIVE_GATEWAY_GOTRUE_URL: 'http://127.0.0.1:9999',
    NATIVE_GATEWAY_STORAGE_URL: 'http://127.0.0.1:5000',
    NATIVE_GATEWAY_ANON_KEY: 'a',
    NATIVE_GATEWAY_SERVICE_ROLE_KEY: 's',
    NATIVE_GATEWAY_PUBLISHABLE_KEY: 'p',
    NATIVE_GATEWAY_SECRET_KEY: 'k',
  }
  assert.equal(gatewayOptionsFromEnv(env).port, 54321)
  for (const name of Object.keys(env)) {
    const partial = { ...env, [name]: '' }
    assert.throws(() => gatewayOptionsFromEnv(partial), new RegExp(name))
  }
})
