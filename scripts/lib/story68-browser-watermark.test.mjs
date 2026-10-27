import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  assertBrowserWatermarkEvidence,
  afterInitialCommunityVerification,
  browserWatermarkChecks,
  closedBrowserWatermarkFailure,
  withBrowserWatermarkLock,
} from './story68-browser-watermark.mjs'

const privateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { transpileModule, ScriptTarget } = createRequire(
  path.join(privateRoot, 'package.json')
)('typescript')
const connectionString = `postgresql://owned@127.0.0.1:54322/tea_community_${'a'.repeat(32)}`
const database = `tea_community_${'a'.repeat(32)}`
function clientFactory({ mismatch = -1, blocked = true } = {}) {
  const queries = []
  const ended = []
  const options = []
  class Client extends EventEmitter {
    constructor(option) {
      super()
      this.id = options.length
      options.push(option)
    }
    async connect() {
      return undefined
    }
    async query(sql) {
      queries.push([this.id, sql])
      if (sql.includes('current_database() AS name'))
        return {
          rows: [{ name: this.id === mismatch ? 'postgres' : database }],
        }
      if (sql.includes('pg_stat_activity'))
        return {
          rows: blocked ? [{ pid: 1, state: 'active', wait_event_type: 'Lock' }] : [],
        }
      return { rows: [] }
    }
    async end() {
      ended.push(this.id)
    }
  }
  return { Client, queries, ended, options }
}
function actualJourney({
  failOff = false,
  unavailable = false,
  finalProfile = 200,
  reuseOnRequest = false,
} = {}) {
  let source = fs.readFileSync(
    path.join(privateRoot, 'playwright/tests/share-card-export.spec.ts'),
    'utf8'
  )
  source = source.slice(
    source.indexOf('async function rapidWatermarkDuringRealPreparation('),
    source.indexOf('\nasync function markDocument')
  )
  const javascript = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-browser-proof-unit-'))
  const f = clientFactory()
  let clock = 0
  let mutations = 0
  const page = new EventEmitter()
  const pending = []
  let firstOnRequest
  const emit = (watermark) => {
    const request = (reuseOnRequest && watermark && firstOnRequest) || {
      url: () => 'http://127.0.0.1:4088/api/v1/share-cards/prepare',
      postDataJSON: () => ({ watermark }),
    }
    if (watermark) firstOnRequest ??= request
    page.emit('request', request)
    for (const entry of pending.splice(0)) {
      if (entry.predicate(request)) entry.resolve(request)
      else pending.push(entry)
    }
  }
  page.waitForRequest = (predicate) =>
    new Promise((resolve) => pending.push({ predicate, resolve }))
  let profiles = 0
  page.request = {
    get: async () => ({
      status: () => (++profiles === 1 ? 200 : finalProfile),
      json: async () => ({ user: { id: 'synthetic-unit-member' } }),
    }),
  }
  const checkbox = {
    uncheck: async () => {
      mutations++
      if (failOff) throw new Error('synthetic access_token private@example.test')
      clock += 2005.593315
      emit(false)
    },
    check: async () => {
      mutations++
      emit(true)
      if (unavailable)
        page.emit('response', {
          url: () => 'http://127.0.0.1:4088/api/v1/share-cards/prepare',
          status: () => 503,
        })
    },
  }
  const expect = (value) => ({
    toBe: (other) => assert.equal(value, other),
    toEqual: (other) => assert.deepEqual(Array.from(value), other),
    toBeLessThan: (other) => assert.ok(value < other, `${value} >= ${other}`),
    toHaveAttribute: async (name, value) => {
      assert.equal(name, 'data-loaded')
      assert.equal(value, 'true')
    },
  })
  expect.poll = (read) => ({
    toBe: async (value) => assert.equal(await read(), value),
  })
  const context = {
    performance: { now: () => clock },
    expect,
    pg: { Client: f.Client },
    session: async () => ({ access_token: 'synthetic-unit-token' }),
    fixture: { identities: [{ appUserId: 'synthetic-unit-member' }] },
    pinnedWatermarkDatabase: () => connectionString,
    prepareShareCardInputSchema: { parse: (input) => input },
    modal: () => ({ getByRole: () => checkbox, getByTestId: () => ({}) }),
    test: {
      info: () => ({ project: { name: 'webkit' }, attach: async () => undefined }),
    },
    withBrowserWatermarkLock: (input) =>
      withBrowserWatermarkLock({ ...input, now: () => clock }),
    browserWatermarkChecks,
    assertBrowserWatermarkEvidence,
    closedBrowserWatermarkFailure,
    Error,
    URL,
    Set,
    JSON,
    Buffer,
    fs,
    path,
    directory,
  }
  const invoke = vm.runInNewContext(
    `${javascript}\nrapidWatermarkDuringRealPreparation`,
    context
  )
  return {
    run: () => invoke(page, async () => emit(true), 'http://127.0.0.1:4088'),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
    proof: () =>
      JSON.parse(
        fs.readFileSync(path.join(directory, 'browser-watermark-webkit.json'), 'utf8')
      ),
    failureFile: path.join(directory, 'browser-watermark-failure-webkit.json'),
    mutations: () => mutations,
    ...f,
  }
}

test('actual browser journey accepts the same 2005 ms UI delay with all original checks and three fresh requests', async () => {
  const f = actualJourney()
  try {
    await f.run()
    const proof = f.proof()
    assertBrowserWatermarkEvidence(proof)
    assert.equal(proof.passed, true)
    assert.equal(proof.heldMs, 2005.593315)
    assert.equal(proof.requests, 3)
    assert.equal(proof.unavailableResponses, 0)
    assert.equal(f.mutations(), 2)
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    assert.equal(
      f.queries.some(([, sql]) =>
        sql.includes("idle_in_transaction_session_timeout = '12000ms'")
      ),
      true
    )
    assert.ok(Object.values(proof.checks).every((value) => value === true))
  } finally {
    f.cleanup()
  }
})

function lockInput(f, overrides = {}) {
  return {
    connectionString,
    createClient: (options) => new f.Client(options),
    whileLocked: async ({ waitForBlocked }) => {
      await waitForBlocked()
    },
    onPhase() {
      return undefined
    },
    onHeld() {
      return undefined
    },
    onCheck() {
      return undefined
    },
    ...overrides,
  }
}
test('both database connections must match the UUID before BEGIN', async () => {
  for (const mismatch of [0, 1]) {
    const f = clientFactory({ mismatch })
    await assert.rejects(
      withBrowserWatermarkLock(lockInput(f)),
      /browser_watermark_database_mismatch/
    )
    assert.equal(
      f.queries.some(([, sql]) => sql === 'BEGIN'),
      false
    )
    assert.deepEqual(f.ended.sort(), [0, 1])
  }
})
test('a cached preview cannot replace the actual blocked SQL source witness', async () => {
  const f = clientFactory({ blocked: false })
  await assert.rejects(
    withBrowserWatermarkLock(lockInput(f, { whileLocked: async () => undefined })),
    /browser_watermark_source_not_blocked/
  )
  assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
})
test('12000 ms held time fails without changing the product deadline', async () => {
  const f = clientFactory()
  let clock = 0
  await assert.rejects(
    withBrowserWatermarkLock(
      lockInput(f, {
        now: () => clock,
        whileLocked: async ({ waitForBlocked }) => {
          await waitForBlocked()
          clock = 12000
        },
      })
    ),
    /browser_watermark_hold_deadline/
  )
  assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
})
test('the real 12 second watchdog aborts pending UI work and rolls back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = clientFactory()
  let entered
  const ready = new Promise((resolve) => {
    entered = resolve
  })
  const run = withBrowserWatermarkLock(
    lockInput(f, {
      whileLocked: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
          entered()
        }),
    })
  )
  const rejected = assert.rejects(run, /browser_watermark_hold_deadline/)
  await ready
  t.mock.timers.tick(12000)
  await rejected
  assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
})
test('evidence refuses unknown fields, phases, secret strings and unchecked success', () => {
  const valid = {
    version: 1,
    browser: 'webkit',
    passed: true,
    code: 'ok',
    phase: 'complete',
    elapsedMs: 2006,
    heldMs: 2005,
    requests: 3,
    unavailableResponses: 0,
    checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, true])),
  }
  assertBrowserWatermarkEvidence(valid)
  for (const mutation of [
    { secret: 'private' },
    { phase: 'token' },
    { code: 'raw database error' },
    { browser: 'unit@example.test' },
    { heldMs: 12000 },
    { requests: 2 },
    { unavailableResponses: 1 },
    { checks: { ...valid.checks, blockedSource: false } },
  ])
    assert.throws(
      () => assertBrowserWatermarkEvidence({ ...valid, ...mutation }),
      /invalid_browser_watermark_evidence/
    )
  assert.equal(
    closedBrowserWatermarkFailure(new Error('secret access_token')),
    'browser_watermark_failed'
  )
})

for (const [options, phase, code] of [
  [{ failOff: true }, 'off', 'browser_watermark_failed'],
  [{ unavailable: true }, 'requests', 'browser_watermark_prepare_503'],
  [{ finalProfile: 401 }, 'profile-after', 'browser_watermark_check_failed'],
  [{ reuseOnRequest: true }, 'requests', 'browser_watermark_three_requests_required'],
])
  test(`actual journey failure at ${phase}/${code} preserves closed facts and rolls back`, async () => {
    const f = actualJourney(options)
    try {
      await assert.rejects(f.run())
      const proof = f.proof()
      assertBrowserWatermarkEvidence(proof)
      assert.equal(proof.passed, false)
      assert.equal(proof.phase, phase)
      assert.equal(proof.code, code)
      assert.equal(proof.checks.rolledBack, true)
      assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
      assert.doesNotMatch(
        JSON.stringify(proof),
        /access_token|private@example|synthetic-unit-member|synthetic-unit-token/
      )
    } finally {
      f.cleanup()
    }
  })

test('actual journey retains the first closed failure artifact across later failures', async () => {
  const f = actualJourney({ failOff: true })
  try {
    await assert.rejects(f.run())
    assertBrowserWatermarkEvidence(JSON.parse(fs.readFileSync(f.failureFile, 'utf8')))
    fs.appendFileSync(f.failureFile, '\n')
    const original = fs.readFileSync(f.failureFile)
    await assert.rejects(f.run())
    assert.deepEqual(fs.readFileSync(f.failureFile), original)
  } finally {
    f.cleanup()
  }
})

function communityReadiness({ available = true, resyncRequired = false } = {}) {
  const page = new EventEmitter()
  const waits = []
  page.waitForResponse = (predicate, options) => {
    assert.equal(options.timeout, 20_000)
    return new Promise((resolve, reject) => waits.push({ predicate, resolve, reject }))
  }
  const request = (url, targets) => ({
    url: () => `http://127.0.0.1:4088/api/v1/community/${url}`,
    postDataJSON: () => ({ targets }),
  })
  const target = request('targets/resolve', [{ key: 'owned-post', postId: 'owned-post' }])
  const early = request('events?cursor=early')
  const cursor = request('events?cursor=verified')
  const emit = (req, body, status = 200) => {
    page.emit('request', req)
    const response = {
      url: req.url,
      request: () => req,
      status: () => status,
      json: async () => body,
    }
    page.emit('response', response)
    for (const wait of waits) if (wait.predicate(response)) wait.resolve(response)
  }
  let ready = false
  let navigated = 0
  const promise = afterInitialCommunityVerification({
    page,
    postId: 'owned-post',
    navigate: async () => {
      navigated++
    },
  }).then(() => {
    ready = true
  })
  void promise.catch(() => undefined)
  return {
    page,
    promise,
    ready: () => ready,
    navigated: () => navigated,
    initial: () =>
      emit(target, {
        data: {
          targets: [
            { key: 'owned-post', status: available ? 'available' : 'unavailable' },
          ],
        },
      }),
    early: () => emit(early, { data: { resyncRequired: false } }),
    replay: () => emit(cursor, { data: { resyncRequired } }),
    expire: () => {
      for (const wait of waits)
        wait.reject(new Error('page.waitForResponse: Timeout 20000ms exceeded'))
    },
    foreign: () =>
      emit(request('targets/resolve', [{ postId: 'another-post' }]), {
        data: { targets: [{ key: 'another-post', status: 'available' }] },
      }),
  }
}
test('community readiness requires genuine owned target resolution and subsequent cursor replay before lock acquisition', async () => {
  const f = communityReadiness()
  assert.equal(f.navigated(), 1)
  // A full macrotask turn lets the helper's await chain settle, so a still-false
  // ready() means it is waiting for the replay, not merely mid-chain.
  const settle = () => new Promise(setImmediate)
  f.early()
  f.foreign()
  await settle()
  assert.equal(f.ready(), false)
  f.initial()
  await settle()
  assert.equal(f.ready(), false)
  f.replay()
  await f.promise
  assert.equal(f.ready(), true)
  assert.equal(f.page.listenerCount('request'), 0)
  assert.equal(f.page.listenerCount('response'), 0)
})
for (const options of [{ available: false }, { resyncRequired: true }])
  test(`community readiness rejects unverified target/replay ${JSON.stringify(options)}`, async () => {
    const f = communityReadiness(options)
    f.initial()
    f.replay()
    await assert.rejects(f.promise, /browser_watermark_community_not_verified/)
    assert.equal(f.ready(), false)
    assert.equal(f.page.listenerCount('request'), 0)
    assert.equal(f.page.listenerCount('response'), 0)
  })
test('a resolution that never succeeds names every owned resolve status instead of a bare timeout', async () => {
  const f = communityReadiness()
  const unavailable = {
    url: () => 'http://127.0.0.1:4088/api/v1/community/targets/resolve',
    method: () => 'POST',
    postDataJSON: () => ({ targets: [{ key: 'owned-post', postId: 'owned-post' }] }),
  }
  for (const status of [503, 503]) {
    f.page.emit('request', unavailable)
    f.page.emit('response', {
      url: unavailable.url,
      request: () => unavailable,
      status: () => status,
      json: async () => ({}),
    })
  }
  f.expire()
  await assert.rejects(
    f.promise,
    /browser_watermark_community_resolution_timeout: owned resolve statuses \[503,503\]/
  )
  assert.equal(f.page.listenerCount('response'), 0)
})
