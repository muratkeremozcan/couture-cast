import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  checkFlagDrift,
  describeDrift,
  expectedValues,
  findFlagDrift,
  INTENTIONAL_OVERRIDES,
  SERVER_USER_AGENT,
} from './posthog-flag-drift.mjs'

const expected = { community_read_enabled: false, weather_alerts_enabled: true }
const subjects = ['subject-a', 'subject-b']
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const flag = (key, enabled, extra = {}) => ({ key, enabled, ...extra })
/** Answers every subject with the given flags, or per subject when given a function. */
const answering = (flags) => async (_url, init) =>
  json({
    flags: typeof flags === 'function' ? flags(JSON.parse(init.body).distinct_id) : flags,
  })
const matching = {
  community_read_enabled: flag('community_read_enabled', false),
  weather_alerts_enabled: flag('weather_alerts_enabled', true),
}
const drift = (fetchImpl) =>
  findFlagDrift({ expected, token: 'phc_synthetic', subjects, fetchImpl })

test('passes when every key answers its expected value for every subject', async () => {
  assert.deepEqual(await drift(answering(matching)), {
    omitted: [],
    multivariate: [],
    mismatched: [],
  })
})

test('reports a key PostHog omits: missing, inactive or filtered from the server runtime', async () => {
  const result = await drift(
    answering({ weather_alerts_enabled: matching.weather_alerts_enabled })
  )
  assert.deepEqual(result.omitted, ['community_read_enabled'])
})

test('reports a flag that failed to evaluate as omitted', async () => {
  const result = await drift(
    answering({
      ...matching,
      community_read_enabled: flag('community_read_enabled', false, { failed: true }),
    })
  )
  assert.deepEqual(result.omitted, ['community_read_enabled'])
})

test('reports a full rollout opposite the declared default', async () => {
  const result = await drift(
    answering({
      ...matching,
      community_read_enabled: flag('community_read_enabled', true),
    })
  )
  assert.deepEqual(result.mismatched, [
    { key: 'community_read_enabled', expected: false, observed: [true] },
  ])
})

test('reports a partial rollout as disagreement across subjects', async () => {
  const result = await drift(
    answering((subject) => ({
      ...matching,
      weather_alerts_enabled: flag('weather_alerts_enabled', subject === 'subject-a'),
    }))
  )
  assert.deepEqual(result.mismatched, [
    { key: 'weather_alerts_enabled', expected: true, observed: [false, true] },
  ])
})

test('reports a multivariate flag', async () => {
  const result = await drift(
    answering({
      ...matching,
      community_read_enabled: flag('community_read_enabled', true, { variant: 'test' }),
    })
  )
  assert.deepEqual(result.multivariate, ['community_read_enabled'])
})

test('an evaluation error, a quota limit or an HTTP error is unavailable, never drift', async () => {
  for (const fetchImpl of [
    async () => json({ flags: {}, errorsWhileComputingFlags: true }),
    async () => json({ flags: {}, quotaLimited: ['feature_flags'] }),
    async () => json({ error: 'down' }, 503),
    async () => json({ detail: 'no flags here' }),
    async () => {
      throw new Error('ECONNRESET')
    },
  ]) {
    const result = await drift(fetchImpl)
    assert.ok(result.unavailable, JSON.stringify(result))
    assert.equal(result.omitted, undefined)
  }
})

test('retries an unavailable answer and returns the first definitive one', async () => {
  let calls = 0
  const waits = []
  const result = await checkFlagDrift({
    expected,
    token: 'phc_synthetic',
    subjects,
    fetchImpl: async () =>
      ++calls === 1
        ? json({ flags: {}, errorsWhileComputingFlags: true })
        : json({ flags: {} }),
    wait: async (ms) => waits.push(ms),
  })
  assert.deepEqual(result.omitted, Object.keys(expected))
  assert.deepEqual(waits, [5_000])
})

test('gives up as unavailable after three attempts', async () => {
  let calls = 0
  const result = await checkFlagDrift({
    expected,
    token: 'phc_synthetic',
    subjects,
    fetchImpl: async () => {
      calls++
      return json({ flags: {} }, 502)
    },
    wait: () => Promise.resolve(),
  })
  assert.equal(calls, 3)
  assert.equal(result.unavailable, 'HTTP 502')
})

test('a pinned override replaces the declared default and must name a declared flag', () => {
  assert.deepEqual(
    expectedValues(
      { color_analysis_enabled: false, community_read_enabled: false },
      { color_analysis_enabled: { value: true, reason: 'owner decision' } }
    ),
    { color_analysis_enabled: true, community_read_enabled: false }
  )
  assert.throws(
    () =>
      expectedValues(
        { community_read_enabled: false },
        { gone: { value: true, reason: 'x' } }
      ),
    /Overrides for undeclared flags: gone/
  )
  assert.equal(INTENTIONAL_OVERRIDES.color_analysis_enabled.value, true)
  assert.ok(INTENTIONAL_OVERRIDES.color_analysis_enabled.reason.length > 0)
})

test('describes each kind of drift on its own line', () => {
  assert.deepEqual(
    describeDrift({
      omitted: ['a'],
      multivariate: ['b'],
      mismatched: [{ key: 'c', expected: false, observed: [false, true] }],
    }),
    [
      'Omitted by PostHog (missing, inactive or not evaluated server-side): a.',
      'Multivariate, where the runtime reads a boolean: b.',
      'c: expected false for every subject, PostHog answered false and true.',
    ]
  )
})

// The real transport against an HTTP recorder: PostHog classifies the runtime from these headers,
// so the check must arrive as the API adapter does.
test('sends the API adapter server User-Agent, one v2 request per subject', async () => {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      requests.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(body),
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ flags: matching }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await findFlagDrift({
      expected,
      token: 'phc_synthetic',
      subjects,
      host: `http://127.0.0.1:${server.address().port}/`,
    })
    assert.deepEqual(result, { omitted: [], multivariate: [], mismatched: [] })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  assert.equal(requests.length, subjects.length)
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, '/flags?v=2')
    assert.equal(request.headers['user-agent'], SERVER_USER_AGENT)
    assert.equal(request.headers['content-type'], 'application/json')
    assert.deepEqual(request.body, {
      api_key: 'phc_synthetic',
      distinct_id: subjects[index],
      flag_keys_to_evaluate: Object.keys(expected),
    })
  }
})

test('the server User-Agent is the one the API adapter sends', () => {
  const adapter = readFileSync('apps/api/src/posthog/posthog.service.ts', 'utf8')
  assert.ok(adapter.includes(`'User-Agent': '${SERVER_USER_AGENT}'`))
})

test('the CLI refuses to run without the project token', () => {
  const run = spawnSync(process.execPath, ['scripts/ci/posthog-flag-drift.mjs'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /POSTHOG_PROD_PROJECT_TOKEN is not set/)
})
