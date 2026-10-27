import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  assertRapidWatermarkRuntime,
  rapidWatermarkRequests,
  withRapidWatermarkLock,
} from './story68-rapid-watermark.mjs'

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
      whileLocked: async () => undefined,
      now: () => 10,
    })
    assert.equal(result.blockedSourceObserved, true)
    assert.equal(result.heldMs, 0)
    assert.ok(
      f.queries.some(
        ([, sql]) => sql === 'LOCK TABLE "OutfitRecommendation" IN ACCESS EXCLUSIVE MODE'
      )
    )
    assert.ok(
      f.queries.some(([, sql]) => sql.includes('idle_in_transaction_session_timeout'))
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
        whileLocked: async () => undefined,
      }),
      /blocked_outfit_source_required/
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('12 seconds of held time fails with rollback while the service budget stays unchanged', async () => {
    const f = clients()
    let clock = 0
    await assert.rejects(
      withRapidWatermarkLock({
        connectionString,
        createClient: f.createClient,
        whileLocked: async () => {
          clock = 12000
        },
        now: () => clock,
      }),
      /rapid_watermark_hold_deadline/
    )
    assert.equal(f.queries.at(-1)[1], 'ROLLBACK')
  })

  test('the actual watchdog aborts pending UI work and releases the lock at 12 seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const f = clients()
    let markStarted
    const started = new Promise((resolve) => {
      markStarted = resolve
    })
    let aborted = false
    const run = withRapidWatermarkLock({
      connectionString,
      createClient: f.createClient,
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
    t.mock.timers.tick(12000)
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
