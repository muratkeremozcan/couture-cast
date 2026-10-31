import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  PREPARE_DEADLINE_MS,
  PREPARE_SETTLE_MARGIN_MS,
  apiPrepareRequestClock,
  assertRapidWatermarkRuntime,
  createPrepareRequestTracker,
  holdLimitMs,
  liveRequestLimitMs,
  rapidWatermarkRequests,
  withRapidWatermarkLock,
} from './story68-rapid-watermark.mjs'

// No prepare request in flight: the per-request clock stays at zero.
const idle = () => 0

const name = `tea_community_${'a'.repeat(32)}`
const connectionString = `postgresql://postgres:owned@127.0.0.1:54322/${name}`
const valid = () => ({
  environment: { DATABASE_URL: connectionString, API_BASE_URL: 'http://127.0.0.1:4088' },
  build: {
    EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
    STORY68_NATIVE_TEST_BUILD: '1',
  },
  resources: { owner: 'cc68-impl', database: name, createdDatabase: true, apiPort: 4088 },
  apiLog: JSON.stringify({ code: 'owned_database_verified', database: name }),
})
function clients({ mismatch = false, blocked = true } = {}) {
  const queries = []
  const ended = []
  let index = 0
  return {
    queries,
    ended,
    createClient() {
      const id = index++
      return {
        async connect() {
          return undefined
        },
        on() {
          return undefined
        },
        async query(sql) {
          queries.push([id, sql])
          if (sql.includes('current_database() AS name'))
            return { rows: [{ name: mismatch ? 'postgres' : name }] }
          if (sql.includes('pg_stat_activity'))
            return {
              rows: blocked
                ? [{ pid: 123, state: 'active', wait_event_type: 'Lock' }]
                : [],
            }
          return { rows: [] }
        },
        async end() {
          ended.push(id)
        },
      }
    },
  }
}

describe('assertRapidWatermarkRuntime', () => {
  test('pins the UUID database, recorded ownership, isolated build and effective API before any mutation', () => {
    assert.equal(assertRapidWatermarkRuntime(valid()), connectionString)
    for (const [mutate, code] of [
      [
        (v) => {
          v.environment.DATABASE_URL = 'postgresql://x@remote.example/postgres'
        },
        /owned_uuid_loopback_database_required/,
      ],
      [
        (v) => {
          v.environment.DATABASE_URL = 'postgresql://x@127.0.0.1/postgres'
        },
        /owned_uuid_loopback_database_required/,
      ],
      [
        (v) => {
          v.environment.API_BASE_URL = 'http://127.0.0.1:4000'
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.build.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:4088'
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.build.STORY68_NATIVE_TEST_BUILD = '0'
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.resources.database = 'postgres'
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.resources.createdDatabase = false
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.resources.owner = 'another-task'
        },
        /pinned_owned_native_runtime_required/,
      ],
      [
        (v) => {
          v.apiLog = JSON.stringify({
            code: 'owned_database_verified',
            database: 'postgres',
          })
        },
        /effective_owned_api_database_proof_required/,
      ],
    ]) {
      const input = valid()
      mutate(input)
      assert.throws(() => assertRapidWatermarkRuntime(input), code)
    }
  })
})

describe('withRapidWatermarkLock', () => {
  test('checks both effective databases before BEGIN and closes both on misroute', async () => {
    const f = clients({ mismatch: true })
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        oldestLiveRequestMs: idle,
        whileLocked: async () => assert.fail('UI must not run'),
      }),
      /effective_owned_database/
    )
    assert.equal(
      f.queries.some(([, sql]) => sql === 'BEGIN'),
      false
    )
    assert.deepEqual(f.ended.sort(), [0, 1])
  })

  test('observes the actual blocked source and rolls back before returning a successful bounded proof', async () => {
    const f = clients()
    const result = await withRapidWatermarkLock({
      connectionString,
      createClient: f.createClient,
      oldestLiveRequestMs: idle,
      whileLocked: async () => undefined,
      now: () => 10,
    })
    assert.equal(result.blockedSourceObserved, true)
    assert.equal(result.heldMs, 0)
    assert.equal(result.longestLiveRequestMs, 0)
    assert.ok(
      f.queries.some(
        ([, sql]) => sql === 'LOCK TABLE "OutfitRecommendation" IN ACCESS EXCLUSIVE MODE'
      )
    )
    assert.ok(
      f.queries.some(
        ([, sql]) => sql === "SET LOCAL idle_in_transaction_session_timeout = '30000ms'"
      )
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    assert.deepEqual(f.ended.sort(), [0, 1])
  })

  test('a failed UI flow preserves its error and always releases the owned lock', async () => {
    const f = clients()
    const original = new Error('real_maestro_failed')
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        oldestLiveRequestMs: idle,
        whileLocked: async () => {
          throw original
        },
      }),
      (error) => error === original
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    assert.deepEqual(f.ended.sort(), [0, 1])
  })

  test('a cached preview with no actual blocked source cannot satisfy this proof', async () => {
    const f = clients({ blocked: false })
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        oldestLiveRequestMs: idle,
        whileLocked: async () => undefined,
      }),
      /blocked_outfit_source_required/
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('30 seconds of held time fails with rollback while the service budget stays unchanged', async () => {
    const f = clients()
    let clock = 0
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        oldestLiveRequestMs: idle,
        whileLocked: async () => {
          clock = 30000
        },
        now: () => clock,
      }),
      /rapid_watermark_hold_deadline/
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('a long hold passes while each request the user superseded leaves within 12 seconds', async () => {
    // CI held 8.2 to 11.3 s from LOCK to release, and a 12 s limit on that span failed two of
    // the last four main runs on a starved host. Each request waited about a third of it.
    const f = clients()
    let clock = 0
    let age = 0
    const result = await withRapidWatermarkLock({
      connectionString,
      createClient: f.createClient,
      oldestLiveRequestMs: () => age,
      whileLocked: async () => {
        clock = 16000
        age = 4000
      },
      now: () => clock,
    })
    assert.equal(result.heldMs, 16000)
    assert.equal(result.longestLiveRequestMs, 4000)
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('a request still waiting at release fails the proof once it has waited 12 seconds', async () => {
    const f = clients()
    let age = 0
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        oldestLiveRequestMs: () => age,
        whileLocked: async () => {
          age = 12000
        },
      }),
      /rapid_watermark_request_deadline/
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('the request watchdog aborts pending UI work and releases the lock at 12 seconds of one request', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const f = clients()
    let age = 0
    let markStarted
    const started = new Promise((resolve) => {
      markStarted = resolve
    })
    let aborted = false
    const run = withRapidWatermarkLock({
      connectionString,
      createClient: f.createClient,
      oldestLiveRequestMs: () => age,
      whileLocked: (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true }
          )
          markStarted()
        }),
    })
    const failure = assert.rejects(run, /rapid_watermark_request_deadline/)
    await started
    age = 11999
    t.mock.timers.tick(50)
    assert.equal(aborted, false)
    age = 12000
    t.mock.timers.tick(50)
    await failure
    assert.equal(aborted, true)
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    assert.deepEqual(f.ended.sort(), [0, 1])
  })

  test('a broken request clock fails closed with rollback', async () => {
    for (const oldestLiveRequestMs of [
      () => Number.NaN,
      () => -1,
      () => {
        throw new Error('rapid_watermark_request_clock_required')
      },
    ]) {
      const f = clients()
      await assert.rejects(
        withRapidWatermarkLock({
          connectionString,
          createClient: f.createClient,
          oldestLiveRequestMs,
          whileLocked: async () => undefined,
        }),
        /rapid_watermark_request_clock_required/
      )
      assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    }
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: () => assert.fail('must guard before client construction'),
        whileLocked: async () => assert.fail('must guard before UI'),
      }),
      /rapid_watermark_request_clock_required/
    )
  })

  test('the actual watchdog aborts pending UI work and releases the lock at 30 seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const f = clients()
    let markStarted
    const started = new Promise((resolve) => {
      markStarted = resolve
    })
    let aborted = false
    const run = withRapidWatermarkLock({
      connectionString,
      createClient: f.createClient,
      oldestLiveRequestMs: idle,
      whileLocked: (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true }
          )
          markStarted()
        }),
    })
    const failure = assert.rejects(run, /rapid_watermark_hold_deadline/)
    await started
    t.mock.timers.tick(29999)
    assert.equal(aborted, false)
    t.mock.timers.tick(1)
    await failure
    assert.equal(aborted, true)
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
    assert.deepEqual(f.ended.sort(), [0, 1])
  })

  test('a non-owned connection is rejected before constructing either client', async () => {
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString: 'postgresql://x@127.0.0.1/postgres',
        createClient: () => assert.fail('must guard before client construction'),
        whileLocked: async () => assert.fail('must guard before UI'),
      }),
      /owned_uuid_loopback_database_required/
    )
  })
})

describe('rapidWatermarkRequests', () => {
  test('requires three fresh requests and rejects any actual prepare 503', () => {
    const rows = [1, 2, 3].map((id) =>
      JSON.stringify({
        path: '/api/v1/share-cards/prepare',
        method: 'POST',
        message: 'request_received',
        requestId: `owned-${id}`,
      })
    )
    assert.equal(rapidWatermarkRequests(rows.join('\n')).requests, 3)
    assert.throws(
      () => rapidWatermarkRequests(rows.slice(1).join('\n')),
      /three_fresh_prepare_requests/
    )
    assert.throws(
      () =>
        rapidWatermarkRequests(
          [
            ...rows,
            JSON.stringify({ path: '/api/v1/share-cards/prepare', statusCode: 503 }),
          ].join('\n')
        ),
      /prepare_503/
    )
  })
})

describe('prepare request clock', () => {
  const at = (ms) => new Date(Date.UTC(2026, 9, 31, 12, 0, 0) + ms).toISOString()
  const row = (message, requestId, ms, extra = {}) =>
    JSON.stringify({
      path: '/api/v1/share-cards/prepare',
      method: 'POST',
      message,
      requestId,
      timestamp: at(ms),
      ...extra,
    }) + '\n'

  test('the per-request limit leaves every held request the time to settle before the product deadline', () => {
    const service = fs.readFileSync(
      'apps/api/src/modules/share-cards/share-cards.service.ts',
      'utf8'
    )
    // The service refuses a preparation this long after it arrives, queue time included.
    assert.match(service, new RegExp(`\\}, ${PREPARE_DEADLINE_MS}\\)`))
    assert.equal(liveRequestLimitMs, 12000)
    assert.equal(liveRequestLimitMs + PREPARE_SETTLE_MARGIN_MS, PREPARE_DEADLINE_MS)
    assert.ok(holdLimitMs > liveRequestLimitMs)
  })

  test('a request counts from its own arrival until the API answers or the client aborts it', () => {
    const base = Date.UTC(2026, 9, 31, 12, 0, 0)
    const tracker = createPrepareRequestTracker()
    tracker.update(row('request_received', 'first', 800))
    assert.equal(tracker.oldestAgeMs(base + 2800), 2000)
    // The toggle aborts the first request; the API logs that as its completion.
    tracker.update(row('request_completed', 'first', 2850, { statusCode: 200 }))
    tracker.update(row('request_received', 'second', 2860))
    assert.equal(tracker.oldestAgeMs(base + 4860), 2000)
    tracker.update(row('request_failed', 'second', 4900, { statusCode: 503 }))
    assert.equal(tracker.oldestAgeMs(base + 9000), 0)
    // Other paths, malformed rows and a line still being written are not requests yet.
    const partial = row('request_received', 'third', 9100)
    tracker.update(
      JSON.stringify({
        path: '/api/v1/user/profile',
        message: 'request_received',
        requestId: 'x',
        timestamp: at(0),
      }) +
        '\nnot json\n' +
        partial.slice(0, 20)
    )
    assert.equal(tracker.oldestAgeMs(base + 10000), 0)
    tracker.update(partial.slice(20))
    assert.equal(tracker.oldestAgeMs(base + 10100), 1000)
  })

  test('the clock reads only the API log written since the hold began', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-request-clock-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'api.log')
    const base = Date.UTC(2026, 9, 31, 12, 0, 0)
    // A request from before the hold never answered in this log: it is not this hold's.
    fs.writeFileSync(file, row('request_received', 'earlier', -60000))
    let now = base
    const oldest = apiPrepareRequestClock({
      file,
      fromByte: fs.statSync(file).size,
      clock: () => now,
    })
    assert.equal(oldest(), 0)
    fs.appendFileSync(file, row('request_received', 'held', 500))
    now = base + 3500
    assert.equal(oldest(), 3000)
    fs.appendFileSync(file, row('request_completed', 'held', 3600))
    assert.equal(oldest(), 0)
  })
})
