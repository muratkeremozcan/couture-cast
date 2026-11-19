import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  checkDefinitions,
  checkFlagDrift,
  checkProduction,
  definitionProblems,
  readFlagDefinitions,
  describeDrift,
  expectedValues,
  findFlagDrift,
  INTENTIONAL_OVERRIDES,
  projectPrivacyProblems,
  readProjectPrivacy,
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

// Definitions: what proves a rollout is uniform, which 12 probe subjects cannot.
const released = (key, everyone, extra = {}) => ({
  key,
  active: true,
  deleted: false,
  archived: false,
  is_remote_configuration: false,
  evaluation_runtime: 'all',
  features: [],
  filters: {
    groups: [{ properties: [], rollout_percentage: everyone ? 100 : 0 }],
    aggregation_group_type_index: null,
  },
  ...extra,
})
const withFilters = (definition, filters) => ({
  ...definition,
  filters: { ...definition.filters, ...filters },
})

test('a definition released to everyone at the expected value passes', () => {
  assert.deepEqual(definitionProblems(released('a', false), false), [])
  assert.deepEqual(definitionProblems(released('a', true), true), [])
  // PostHog reads a missing rollout percentage as everyone.
  assert.deepEqual(
    definitionProblems(
      withFilters(released('a', true), { groups: [{ properties: [] }] }),
      true
    ),
    []
  )
})

test('red: a cohort-targeted release is not uniform', () => {
  const cohort = withFilters(released('community_read_enabled', false), {
    groups: [
      {
        properties: [{ key: 'id', type: 'cohort', operator: 'in', value: 42 }],
        rollout_percentage: 100,
      },
    ],
  })
  assert.deepEqual(definitionProblems(cohort, false), [
    'release group 1 filters on properties or cohorts',
  ])
})

test('red: a 1 percent rollout is not uniform', () => {
  const partial = withFilters(released('community_read_enabled', false), {
    groups: [{ properties: [], rollout_percentage: 1 }],
  })
  assert.deepEqual(definitionProblems(partial, false), [
    'release group 1 rolls out to 1 percent',
  ])
})

test('red: a multivariate flag with no released variant still fails', () => {
  const variants = withFilters(released('community_read_enabled', false), {
    multivariate: {
      variants: [
        { key: 'a', rollout_percentage: 50 },
        { key: 'b', rollout_percentage: 50 },
      ],
    },
  })
  assert.deepEqual(definitionProblems(variants, false), ['multivariate'])
})

test('a full release opposite the expected value fails', () => {
  assert.deepEqual(definitionProblems(released('a', true), false), [
    'released to everyone as true, expected false',
  ])
})

test('inactive, client-only, holdout, super group, group-aggregated and remote-config flags fail', () => {
  const base = released('a', false)
  for (const [definition, problem] of [
    [{ ...base, active: false }, 'inactive'],
    [{ ...base, evaluation_runtime: 'client' }, 'evaluation runtime client'],
    [{ ...base, holdout: { id: 1 } }, 'holdout'],
    [withFilters(base, { holdout_groups: [{ id: 1 }] }), 'holdout'],
    [withFilters(base, { super_groups: [{ properties: [] }] }), 'super group'],
    [withFilters(base, { aggregation_group_type_index: 0 }), 'group aggregation'],
    [{ ...base, is_remote_configuration: true }, 'remote configuration'],
    [withFilters(base, { feature_enrollment: true }), 'early access enrollment'],
    [
      withFilters(base, {
        groups: [{ properties: [], rollout_percentage: 0, variant: 'a' }],
      }),
      'release group 1 forces a variant',
    ],
  ])
    assert.ok(definitionProblems(definition, false).includes(problem), problem)
})

test('a missing or deleted definition fails, and overrides set the expected value', () => {
  assert.deepEqual(
    checkDefinitions(
      [
        released('kept', true),
        { ...released('deleted', false), deleted: true },
        released('color_analysis_enabled', true),
      ],
      { kept: true, deleted: false, absent: false, color_analysis_enabled: true }
    ),
    [
      { key: 'deleted', problem: 'no active definition in the project' },
      { key: 'absent', problem: 'no active definition in the project' },
    ]
  )
})

test('reads every page of definitions with the read key', async () => {
  const requests = []
  const pages = {
    '/api/projects/329012/feature_flags/?limit=200': {
      results: [released('a', false)],
      next: 'http://app.example.test/api/projects/329012/feature_flags/?limit=200&offset=200',
    },
    '/api/projects/329012/feature_flags/?limit=200&offset=200': {
      results: [released('b', true)],
      next: null,
    },
  }
  const definitions = await readFlagDefinitions({
    key: 'phx_synthetic',
    appHost: 'http://app.example.test/',
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname + new URL(url).search
      requests.push({ path, authorization: init.headers.Authorization })
      return json(pages[path])
    },
  })
  assert.deepEqual(
    definitions.map((definition) => definition.key),
    ['a', 'b']
  )
  assert.deepEqual(
    requests.map((request) => request.authorization),
    ['Bearer phx_synthetic', 'Bearer phx_synthetic']
  )
})

test('an unreadable definitions page is an error, never a pass', async () => {
  await assert.rejects(
    readFlagDefinitions({ key: 'phx_synthetic', fetchImpl: async () => json({}, 403) }),
    /HTTP 403/
  )
  await assert.rejects(
    readFlagDefinitions({
      key: 'phx_synthetic',
      fetchImpl: async () => json({ detail: 'x' }),
    }),
    /no results/
  )
})

test('the CLI refuses to run without the definition read key', () => {
  const run = spawnSync(process.execPath, ['scripts/ci/posthog-flag-drift.mjs'], {
    env: { PATH: process.env.PATH, POSTHOG_PROD_PROJECT_TOKEN: 'phc_synthetic' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /POSTHOG_FLAG_READ_KEY is not set/)
})

// The CLI reads the declared flags from packages/config/src/flags.ts before it checks the read
// key. That package has no "type" because its dist is CommonJS while its source is ES module
// TypeScript, so a plain import of the source logged MODULE_TYPELESS_PACKAGE_JSON in every run.
test('the CLI loads the declared flags without a module-type warning', () => {
  const run = spawnSync(process.execPath, ['scripts/ci/posthog-flag-drift.mjs'], {
    env: { PATH: process.env.PATH, POSTHOG_PROD_PROJECT_TOKEN: 'phc_synthetic' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 2)
  assert.doesNotMatch(run.stderr, /MODULE_TYPELESS_PACKAGE_JSON|Warning/)
})

test('the declared flags module imports nothing, so a standalone copy of it loads', () => {
  const source = readFileSync('packages/config/src/flags.ts', 'utf8')
  assert.doesNotMatch(source, /^\s*(import|export)\s[^;]*\sfrom\s/m)
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/)
})

test('red: early exit is rejected, since the first matching group decides and groups no longer combine', () => {
  const earlyExit = withFilters(released('community_read_enabled', true), {
    early_exit: true,
    groups: [
      { properties: [], rollout_percentage: 0 },
      { properties: [], rollout_percentage: 100 },
    ],
  })
  assert.deepEqual(definitionProblems(earlyExit, true), [
    'early exit: the first matching release group decides, so groups cannot be read as one uniform release',
  ])
  // early_exit false is PostHog's default and changes nothing.
  assert.deepEqual(
    definitionProblems(withFilters(released('a', true), { early_exit: false }), true),
    []
  )
})

test('red: production must discard client IP data, since PostHog fills a null $ip from the request', () => {
  assert.deepEqual(projectPrivacyProblems({ anonymize_ips: true }), [])
  for (const value of [false, null, undefined, 'true'])
    assert.deepEqual(projectPrivacyProblems({ anonymize_ips: value }), [
      'Discard client IP data (anonymize_ips) is off, so PostHog stores the IP of every mobile event',
    ])
})

test('reads the production project settings with the read key, and an unreadable answer is an error', async () => {
  const requests = []
  const project = await readProjectPrivacy({
    key: 'phx_synthetic',
    appHost: 'http://app.example.test/',
    fetchImpl: async (url, init) => {
      requests.push({
        path: new URL(url).pathname,
        authorization: init.headers.Authorization,
      })
      return json({ id: 329012, anonymize_ips: true })
    },
  })
  assert.equal(project.anonymize_ips, true)
  assert.deepEqual(requests, [
    { path: '/api/projects/329012/', authorization: 'Bearer phx_synthetic' },
  ])
  await assert.rejects(
    readProjectPrivacy({
      key: 'phx_synthetic',
      fetchImpl: async () =>
        json({ detail: "API key missing required scope 'project:read'" }, 403),
    }),
    /HTTP 403.*project:read/
  )
  await assert.rejects(
    readProjectPrivacy({ key: 'phx_synthetic', fetchImpl: async () => json([]) }),
    /no project settings/
  )
  await assert.rejects(
    readProjectPrivacy({
      key: 'phx_synthetic',
      fetchImpl: async () => json({ id: 327096, anonymize_ips: true }),
    }),
    /project 327096, not 329012/
  )
})

test('one failing production check never hides another', async () => {
  const route = (handlers) => async (url, init) => {
    const { pathname } = new URL(url)
    for (const [prefix, answer] of handlers)
      if (pathname.startsWith(prefix)) return answer(init)
    throw new Error(`unexpected request ${pathname}`)
  }
  const unreadableSettings = () =>
    json({ detail: "API key missing required scope 'project:read'" }, 403)
  // Settings unreadable and a definition drifted: both are reported.
  const both = await checkProduction({
    expected,
    token: 'phc_synthetic',
    readKey: 'phx_synthetic',
    fetchImpl: route([
      [
        '/api/projects/329012/feature_flags/',
        () => json({ results: [released('community_read_enabled', true)], next: null }),
      ],
      ['/api/projects/329012/', unreadableSettings],
    ]),
  })
  assert.equal(both.length, 2)
  assert.match(both[0], /project settings: reading project settings returned HTTP 403/)
  assert.match(both[1], /flag definitions disagree/)
  // Settings off and runtime drift: both are reported, and the probes still run.
  const probed = await checkProduction({
    expected,
    token: 'phc_synthetic',
    readKey: 'phx_synthetic',
    wait: () => Promise.resolve(),
    fetchImpl: route([
      [
        '/api/projects/329012/feature_flags/',
        () =>
          json({
            results: [
              released('community_read_enabled', false),
              released('weather_alerts_enabled', true),
            ],
            next: null,
          }),
      ],
      ['/api/projects/329012/', () => json({ id: 329012, anonymize_ips: false })],
      [
        '/flags',
        () =>
          json({
            flags: { community_read_enabled: flag('community_read_enabled', false) },
          }),
      ],
    ]),
  })
  assert.equal(probed.length, 2)
  assert.match(probed[0], /Discard client IP data/)
  assert.match(probed[1], /weather_alerts_enabled/)
  // Everything sound: no failures.
  assert.deepEqual(
    await checkProduction({
      expected,
      token: 'phc_synthetic',
      readKey: 'phx_synthetic',
      fetchImpl: route([
        [
          '/api/projects/329012/feature_flags/',
          () =>
            json({
              results: [
                released('community_read_enabled', false),
                released('weather_alerts_enabled', true),
              ],
              next: null,
            }),
        ],
        ['/api/projects/329012/', () => json({ id: 329012, anonymize_ips: true })],
        ['/flags', answering(matching)],
      ]),
    }),
    []
  )
})
