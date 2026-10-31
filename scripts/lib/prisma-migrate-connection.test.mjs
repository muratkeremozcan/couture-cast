import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  databaseIdentity,
  isPoolExhaustionOutput,
  poolRetryBaseDelay,
  poolRetryDelays,
  POOL_RETRY_ATTEMPTS,
  PrismaMigratePoolExhaustedError,
  PrismaMigrateTransactionPoolerError,
  resolveMigrationDatabaseUrl,
  runWithPoolRetry,
} from './prisma-migrate-connection.mjs'

// The exact failure the cf493469 production API build hit (password and ref masked).
const SESSION_POOL_EXHAUSTED = [
  'Datasource "db": PostgreSQL database "postgres", schema "public" at "aws-1-us-east-1.pooler.supabase.com:5432"',
  'Error: Schema engine error:',
  'FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15',
].join('\n')

const SESSION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require'
const TRANSACTION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5'
const DIRECT = 'postgresql://postgres:pw@db.abcref.supabase.co:5432/postgres'
const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

describe('isPoolExhaustionOutput', () => {
  test('matches Supavisor and Postgres client-limit refusals', () => {
    assert.equal(isPoolExhaustionOutput(SESSION_POOL_EXHAUSTED), true)
    assert.equal(
      isPoolExhaustionOutput('FATAL: (EMAXCONN) max client connections reached'),
      true
    )
    assert.equal(isPoolExhaustionOutput('FATAL: sorry, too many clients already'), true)
    assert.equal(
      isPoolExhaustionOutput(
        'FATAL: remaining connection slots are reserved for non-replication superuser connections'
      ),
      true
    )
  })

  test('leaves every other migrate failure alone', () => {
    assert.equal(
      isPoolExhaustionOutput('Error: P3009 migrate found failed migrations'),
      false
    )
    assert.equal(
      isPoolExhaustionOutput("Error: P1001: Can't reach database server"),
      false
    )
    assert.equal(isPoolExhaustionOutput('password authentication failed for user'), false)
    assert.equal(isPoolExhaustionOutput(''), false)
  })
})

describe('poolRetryDelays', () => {
  test('doubles from the base, caps at a minute, and stays bounded', () => {
    assert.deepEqual(
      poolRetryDelays(),
      [10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000]
    )
    assert.equal(poolRetryDelays().length, POOL_RETRY_ATTEMPTS - 1)
    assert.deepEqual(poolRetryDelays({ attempts: 3, baseMs: 1 }), [1, 2])
  })

  test('reads a base override only when it is a whole number', () => {
    assert.equal(poolRetryBaseDelay({}), 10_000)
    assert.equal(poolRetryBaseDelay({ PRISMA_MIGRATE_POOL_RETRY_BASE_MS: '5' }), 5)
    assert.equal(poolRetryBaseDelay({ PRISMA_MIGRATE_POOL_RETRY_BASE_MS: '0' }), 1)
    assert.equal(
      poolRetryBaseDelay({ PRISMA_MIGRATE_POOL_RETRY_BASE_MS: 'soon' }),
      10_000
    )
    assert.equal(poolRetryBaseDelay({ PRISMA_MIGRATE_POOL_RETRY_BASE_MS: '-3' }), 10_000)
  })
})

describe('runWithPoolRetry', () => {
  /** @param {Array<{ code: number | null, signal?: NodeJS.Signals | null, output?: string }>} results */
  function scripted(results) {
    const calls = []
    const sleeps = []
    const logs = []
    return {
      calls,
      sleeps,
      logs,
      options: {
        runAttempt: async (attempt) => {
          calls.push(attempt)
          const next = results[Math.min(calls.length - 1, results.length - 1)]
          return { signal: null, output: '', ...next }
        },
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        log: (message) => logs.push(message),
        delaysMs: [5, 10, 20],
      },
    }
  }

  test('retries an exhausted session pool and returns the later success', async () => {
    const run = scripted([
      { code: 1, output: SESSION_POOL_EXHAUSTED },
      { code: 1, output: SESSION_POOL_EXHAUSTED },
      { code: 0 },
    ])
    const result = await runWithPoolRetry(run.options)
    assert.deepEqual(result, { code: 0, signal: null, attempts: 3 })
    assert.deepEqual(run.calls, [1, 2, 3])
    assert.deepEqual(run.sleeps, [5, 10])
    assert.match(run.logs[0], /pool exhausted on attempt 1\/4; retrying in 5ms/)
  })

  test('throws the named failure after the last attempt and never loops on', async () => {
    const run = scripted([{ code: 1, output: SESSION_POOL_EXHAUSTED }])
    await assert.rejects(runWithPoolRetry(run.options), (error) => {
      assert.ok(error instanceof PrismaMigratePoolExhaustedError)
      assert.equal(error.name, 'PrismaMigratePoolExhaustedError')
      assert.equal(error.attempts, 4)
      assert.match(error.message, /after 4 attempts/)
      return true
    })
    assert.deepEqual(run.calls, [1, 2, 3, 4])
    assert.deepEqual(run.sleeps, [5, 10, 20])
  })

  test('returns any other failure at once', async () => {
    const run = scripted([
      { code: 1, output: 'Error: P3009 migrate found failed migrations' },
    ])
    assert.deepEqual(await runWithPoolRetry(run.options), {
      code: 1,
      signal: null,
      attempts: 1,
    })
    assert.deepEqual(run.sleeps, [])
  })

  test('returns a signal stop at once, whatever the output says', async () => {
    const run = scripted([
      { code: null, signal: 'SIGTERM', output: SESSION_POOL_EXHAUSTED },
    ])
    assert.deepEqual(await runWithPoolRetry(run.options), {
      code: null,
      signal: 'SIGTERM',
      attempts: 1,
    })
  })
})

describe('databaseIdentity', () => {
  test('treats the session pooler, transaction pooler and direct host of one project as one database', () => {
    const expected = 'supabase:abcref/postgres'
    assert.equal(databaseIdentity(new URL(SESSION)), expected)
    assert.equal(databaseIdentity(new URL(TRANSACTION)), expected)
    assert.equal(databaseIdentity(new URL(DIRECT)), expected)
  })

  test('tells a local database from another port or a remote project', () => {
    assert.equal(databaseIdentity(new URL(LOCAL)), '127.0.0.1:54322/postgres')
    assert.notEqual(
      databaseIdentity(new URL('postgresql://caller:caller@127.0.0.1:55432/isolated')),
      databaseIdentity(new URL(LOCAL))
    )
    assert.notEqual(
      databaseIdentity(new URL(SESSION.replace('abcref', 'otherref'))),
      databaseIdentity(new URL(SESSION))
    )
  })
})

describe('resolveMigrationDatabaseUrl', () => {
  test('keeps DATABASE_URL when DIRECT_URL is absent, as production runs today', () => {
    assert.deepEqual(resolveMigrationDatabaseUrl({ DATABASE_URL: SESSION }), {
      url: SESSION,
      source: 'DATABASE_URL',
      ignoredDirectUrl: false,
    })
  })

  test('migrates through DIRECT_URL once the runtime moves to the transaction pooler', () => {
    for (const direct of [SESSION, DIRECT]) {
      assert.deepEqual(
        resolveMigrationDatabaseUrl({ DATABASE_URL: TRANSACTION, DIRECT_URL: direct }),
        { url: direct, source: 'DIRECT_URL', ignoredDirectUrl: false }
      )
    }
  })

  test('ignores a DIRECT_URL that reaches another database', () => {
    assert.deepEqual(
      resolveMigrationDatabaseUrl({ DATABASE_URL: LOCAL, DIRECT_URL: SESSION }),
      {
        url: LOCAL,
        source: 'DATABASE_URL',
        ignoredDirectUrl: true,
      }
    )
  })

  test('refuses to migrate through the transaction pooler', () => {
    assert.throws(
      () => resolveMigrationDatabaseUrl({ DATABASE_URL: TRANSACTION }),
      (error) =>
        error instanceof PrismaMigrateTransactionPoolerError &&
        error.source === 'DATABASE_URL' &&
        /DIRECT_URL/.test(error.message)
    )
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          DATABASE_URL: TRANSACTION,
          DIRECT_URL: TRANSACTION,
        }),
      (error) => error instanceof PrismaMigrateTransactionPoolerError
    )
    assert.throws(
      () => resolveMigrationDatabaseUrl({ DATABASE_URL: `${LOCAL}?pgbouncer=true` }),
      PrismaMigrateTransactionPoolerError
    )
  })

  test('leaves an unset DATABASE_URL for Prisma to report', () => {
    assert.deepEqual(resolveMigrationDatabaseUrl({}), {
      url: undefined,
      source: 'DATABASE_URL',
      ignoredDirectUrl: false,
    })
  })
})
