import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { bundleUrlFromManifest, warmMetro } from './warm-metro.mjs'

const base = 'http://127.0.0.1:8089'
const launch = `${base}/node_modules/expo-router/entry.bundle?platform=ios&dev=true&transform.engine=hermes`

test('the dev-client manifest names the bundle to build', () => {
  const json = JSON.stringify({ launchAsset: { url: launch } })
  assert.deepEqual(bundleUrlFromManifest(json, base, 'ios'), {
    url: launch,
    source: 'manifest',
  })
  const multipart = `--boundary\r\ncontent-type: application/json\r\n\r\n${json}\r\n--boundary--`
  assert.equal(bundleUrlFromManifest(multipart, base, 'ios').url, launch)
})

test('without a manifest the app entry bundle is built', () => {
  const entry = `${base}/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false`
  for (const body of ['<html>interstitial</html>', '{"error":"no"}', ''])
    assert.deepEqual(bundleUrlFromManifest(body, base, 'ios'), {
      url: entry,
      source: 'entry',
    })
  // A launch asset on another origin is never fetched.
  const foreign = JSON.stringify({
    launchAsset: { url: 'https://cdn.example/entry.bundle' },
  })
  assert.equal(bundleUrlFromManifest(foreign, base, 'ios').source, 'entry')
})

async function metro(
  t,
  {
    manifestStatus = 200,
    bundleStatus = 200,
    bundleBody = 'x'.repeat(4096),
    lazy = 'false',
  } = {}
) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, platform: req.headers['expo-platform'] })
    if (req.url === '/') {
      const url = `http://127.0.0.1:${server.address().port}/node_modules/expo-router/entry.bundle?platform=ios&dev=true&lazy=${lazy}`
      res.writeHead(manifestStatus, { 'content-type': 'application/expo+json' })
      res.end(JSON.stringify({ launchAsset: { url } }))
      return
    }
    res.writeHead(bundleStatus, { 'content-type': 'application/javascript' })
    res.end(bundleBody)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  return { seen, url: `http://127.0.0.1:${server.address().port}` }
}

test('warming asks the way the dev client asks and drains the bundle', async (t) => {
  const server = await metro(t)
  const result = await warmMetro({ baseUrl: server.url, platform: 'ios' })
  assert.equal(result.source, 'manifest')
  assert.equal(result.bytes, 4096)
  assert.equal(result.lazy, 'false')
  assert.deepEqual(server.seen, [
    { url: '/', platform: 'ios' },
    {
      url: '/node_modules/expo-router/entry.bundle?platform=ios&dev=true&lazy=false',
      platform: undefined,
    },
  ])
})

test('a bundle Metro cannot build fails the warm-up', async (t) => {
  const failing = await metro(t, {
    bundleStatus: 500,
    bundleBody: '{"type":"SyntaxError"}',
  })
  await assert.rejects(
    warmMetro({ baseUrl: failing.url, platform: 'ios' }),
    /metro_bundle_unavailable:500/
  )
  const empty = await metro(t, { bundleBody: '' })
  await assert.rejects(warmMetro({ baseUrl: empty.url, platform: 'ios' }), /unavailable/)
  await assert.rejects(
    warmMetro({ baseUrl: empty.url, platform: 'web' }),
    /platform_required/
  )
})

test('a lazy dev bundle is refused so no module builds during a flow', async (t) => {
  const lazy = await metro(t, { lazy: 'true' })
  await assert.rejects(
    warmMetro({ baseUrl: lazy.url, platform: 'ios' }),
    /metro_bundle_still_lazy/
  )
  // Nothing was fetched past the manifest.
  assert.equal(lazy.seen.length, 1)
})
