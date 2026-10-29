import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import {
  assertAppCarriesNoSecret,
  scanApp,
  secretCandidates,
} from './native-ios-app-secret-scan.mjs'

const jwt = (role) =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url'),
    Buffer.from(`${role}-signature-bytes`).toString('base64url'),
  ].join('.')
const anon = jwt('anon')

function app(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-app-scan-'))
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
    fs.writeFileSync(path.join(directory, name), text)
  }
  return directory
}

describe('built iOS app secret scan', () => {
  test('an app with no key passes and reports no anon key', () => {
    const result = assertAppCarriesNoSecret(
      scanApp(app({ 'Info.plist': 'plain', 'a/b.bin': 'x' }), { anonKey: anon })
    )
    assert.deepEqual(result, {
      scanned: 2,
      foreignJwt: 0,
      ownedValue: 0,
      anonKeyEmbedded: false,
    })
  })

  test('the per-job anon key may appear and is reported as a boolean', () => {
    const result = assertAppCarriesNoSecret(
      scanApp(app({ 'EXConstants.bundle/app.config': `{"k":"${anon}"}` }), {
        anonKey: anon,
      })
    )
    assert.equal(result.anonKeyEmbedded, true)
  })

  test('a service role JWT fails even though it is a JWT', () => {
    const directory = app({ 'Frameworks/x.dylib': `bin ${jwt('service_role')} bin` })
    assert.throws(() => assertAppCarriesNoSecret(scanApp(directory, { anonKey: anon })), {
      message: 'ios_app_embeds_non_anon_jwt',
    })
  })

  test('a long value from the owned environment fails', () => {
    const secret = 'postgresql://owner:hunter2hunter2@127.0.0.1:54322/db'
    const env = { DATABASE_URL: secret, SHORT: 'x', PORT: 4088 }
    assert.deepEqual(secretCandidates(env), [secret])
    assert.throws(
      () =>
        assertAppCarriesNoSecret(
          scanApp(app({ 'main.jsbundle': `a${secret}b` }), { candidates: [secret] })
        ),
      { message: 'ios_app_embeds_owned_env_value' }
    )
  })

  test('an empty app directory never passes', () => {
    assert.throws(() => assertAppCarriesNoSecret(scanApp(app({}), {})), {
      message: 'ios_app_scan_empty',
    })
  })
})

describe('the scan fails closed from the command line', () => {
  const script = new URL('./native-ios-app-secret-scan.mjs', import.meta.url).pathname
  const secret = 'postgresql://owner:hunter2hunter2@127.0.0.1:54322/db'
  const harness = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-scan-harness-'))
    for (const [name, text] of Object.entries(files))
      fs.writeFileSync(path.join(dir, name), text)
    return dir
  }
  const run = (appDir, harnessDir) =>
    spawnSync(
      process.execPath,
      [script, appDir, ...(harnessDir === undefined ? [] : [harnessDir])],
      {
        encoding: 'utf8',
      }
    )
  const planted = () => app({ 'main.jsbundle': `a${secret}b` })

  test('a planted owned value fails when the harness directory is given', () => {
    const result = run(
      planted(),
      harness({ 'owned-env.json': JSON.stringify({ DATABASE_URL: secret }) })
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /ios_app_embeds_owned_env_value/)
  })

  for (const [title, harnessDir, expected] of [
    ['an empty harness argument', '', /ios_app_scan_harness_required/],
    ['no harness argument', undefined, /ios_app_scan_harness_required/],
    [
      'a harness without owned-env.json',
      harness({}),
      /ios_app_scan_owned_env_unreadable/,
    ],
    [
      'an unparsable owned-env.json',
      harness({ 'owned-env.json': '{nope' }),
      /ios_app_scan_owned_env_unreadable/,
    ],
    [
      'an owned-env.json with no long value',
      harness({ 'owned-env.json': JSON.stringify({ PORT: 4088, SHORT: 'x' }) }),
      /ios_app_scan_no_candidates/,
    ],
  ])
    test(`${title} is a failure, never a pass`, () => {
      const result = run(planted(), harnessDir)
      assert.equal(result.status, 1, result.stdout)
      assert.match(result.stderr, expected)
    })

  describe('published values are not secrets', () => {
    const origin = 'http://127.0.0.1:4088'
    const supabase = 'http://127.0.0.1:53068'
    const env = (extra = {}) =>
      harness({
        'owned-env.json': JSON.stringify({
          API_BASE_URL: origin,
          SUPABASE_URL: supabase,
          PUBLIC_API_URL: `${origin}/`,
          DATABASE_URL: secret,
          ...extra,
        }),
        'public-build-env.json': JSON.stringify({
          EXPO_PUBLIC_API_BASE_URL: origin,
          EXPO_PUBLIC_SUPABASE_URL: supabase,
        }),
      })

    test('public loopback URLs in the app pass when the private value stays out', () => {
      const result = run(
        app({
          'EXConstants.bundle/app.config': `{"api":"${origin}","sb":"${supabase}"}`,
        }),
        env()
      )
      assert.equal(result.status, 0, result.stderr)
    })

    test('a DATABASE_URL style value still fails next to the public URLs', () => {
      const result = run(app({ 'main.jsbundle': `${origin} ${secret}` }), env())
      assert.equal(result.status, 1)
      assert.match(result.stderr, /ios_app_embeds_owned_env_value/)
    })

    test('a long value the build env publishes is allowed, one it does not is not', () => {
      const published = 'https://api.example.test/v1/community-service-endpoint'
      const dir = harness({
        'owned-env.json': JSON.stringify({ PUBLISHED: published, DATABASE_URL: secret }),
        'public-build-env.json': JSON.stringify({ EXPO_PUBLIC_API: published }),
      })
      assert.equal(run(app({ a: published }), dir).status, 0)
      assert.equal(run(app({ a: secret }), dir).status, 1)
    })

    test('an owned environment of only public URLs has nothing to compare and fails', () => {
      const dir = harness({ 'owned-env.json': JSON.stringify({ API_BASE_URL: origin }) })
      const result = run(app({ a: origin }), dir)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /ios_app_scan_no_candidates/)
    })
  })
})
