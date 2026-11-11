import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { checkFlagDrift, findMissingFlags } from './posthog-flag-drift.mjs'

const keys = ['community_read_enabled', 'premium_themes_enabled']
const answer =
  (body, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
const flag = (key) => ({ key, enabled: false, reason: { code: 'no_condition_match' } })

test('reports each declared key PostHog leaves out', async () => {
  const result = await findMissingFlags({
    keys,
    token: 'phc_synthetic',
    fetchImpl: answer({
      flags: { premium_themes_enabled: flag('premium_themes_enabled') },
    }),
  })
  assert.deepEqual(result, { missing: ['community_read_enabled'] })
})

test('passes when every declared key exists, whatever its rollout', async () => {
  const result = await findMissingFlags({
    keys,
    token: 'phc_synthetic',
    fetchImpl: answer({
      flags: Object.fromEntries(
        keys.map((key) => [key, { ...flag(key), enabled: true }])
      ),
      errorsWhileComputingFlags: false,
    }),
  })
  assert.deepEqual(result, { missing: [] })
})

test('sends every declared key in one v2 request with the project token', async () => {
  let request
  await findMissingFlags({
    keys,
    token: 'phc_synthetic',
    host: 'https://flags.example.test/',
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) }
      return answer({ flags: {} })()
    },
  })
  assert.equal(request.url, 'https://flags.example.test/flags?v=2')
  assert.deepEqual(request.body.flag_keys_to_evaluate, keys)
  assert.equal(request.body.api_key, 'phc_synthetic')
})

test('an evaluation error, a quota limit or an HTTP error is unavailable, never "missing"', async () => {
  for (const fetchImpl of [
    answer({ flags: {}, errorsWhileComputingFlags: true }),
    answer({ flags: {}, quotaLimited: ['feature_flags'] }),
    answer({ error: 'down' }, 503),
    answer({ detail: 'no flags here' }),
    async () => {
      throw new Error('ECONNRESET')
    },
  ]) {
    const result = await findMissingFlags({ keys, token: 'phc_synthetic', fetchImpl })
    assert.ok(result.unavailable, JSON.stringify(result))
    assert.equal(result.missing, undefined)
  }
})

test('retries an unavailable answer and returns the first definitive one', async () => {
  const bodies = [{ flags: {}, errorsWhileComputingFlags: true }, { flags: {} }]
  const waits = []
  const result = await checkFlagDrift({
    keys,
    token: 'phc_synthetic',
    fetchImpl: async () => answer(bodies.shift())(),
    wait: async (ms) => waits.push(ms),
  })
  assert.deepEqual(result, { missing: keys })
  assert.deepEqual(waits, [5_000])
})

test('gives up as unavailable after three attempts', async () => {
  let calls = 0
  const result = await checkFlagDrift({
    keys,
    token: 'phc_synthetic',
    fetchImpl: async () => {
      calls++
      return answer({ flags: {} }, 502)()
    },
    wait: () => Promise.resolve(),
  })
  assert.equal(calls, 3)
  assert.equal(result.unavailable, 'HTTP 502')
})

test('the CLI refuses to run without the project token', () => {
  const run = spawnSync(process.execPath, ['scripts/ci/posthog-flag-drift.mjs'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /POSTHOG_PROD_PROJECT_TOKEN is not set/)
})
