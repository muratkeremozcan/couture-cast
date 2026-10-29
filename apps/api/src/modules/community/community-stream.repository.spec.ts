import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  AppendBudgetExceeded,
  appendFailure,
  CommunityStreamRepository,
  isAppendDeferral,
} from './community-stream.repository.js'

const failure = (code: string, sql?: string, message?: string) =>
  new Prisma.PrismaClientKnownRequestError('Controlled append failure', {
    code,
    clientVersion: 'test',
    ...(sql ? { meta: { code: sql, ...(message ? { message } : {}) } } : {}),
  })
// A model operation inside the append raises these as unknown request errors carrying
// the engine's PostgresError rendering (Prisma 6.19, measured 2026-10-27).
const modelFailure = (sql: string, message: string, severity = 'ERROR') =>
  new Prisma.PrismaClientUnknownRequestError(
    `Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sql}", message: "${message}", severity: "${severity}", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion: 'test' }
  )
const TRANSACTION_TIMEOUT = 'terminating connection due to transaction timeout'
const IDLE_TIMEOUT = 'terminating connection due to idle-in-transaction timeout'

describe('community append failure classification', () => {
  it.each([
    ['a NOWAIT head lock miss', failure('P2010', '55P03'), 'head_contention'],
    [
      'a model lock timeout',
      modelFailure('55P03', 'canceling statement due to lock timeout'),
      'head_contention',
    ],
    ['a statement timeout', failure('P2010', '57014'), 'budget_pressure'],
    [
      'a model statement timeout',
      modelFailure('57014', 'canceling statement due to statement timeout'),
      'budget_pressure',
    ],
    [
      'a transaction timeout',
      failure('P2010', '25P04', `FATAL: ${TRANSACTION_TIMEOUT}`),
      'budget_pressure',
    ],
    [
      'a model transaction timeout',
      modelFailure('25P04', TRANSACTION_TIMEOUT, 'FATAL'),
      'budget_pressure',
    ],
    [
      'an idle-in-transaction timeout',
      failure('P2010', '25P03', `FATAL: ${IDLE_TIMEOUT}`),
      'budget_pressure',
    ],
    [
      'a model idle-in-transaction timeout',
      modelFailure('25P03', IDLE_TIMEOUT, 'FATAL'),
      'budget_pressure',
    ],
    ['an expired interactive transaction', failure('P2028'), 'budget_pressure'],
    [
      'the completion budget',
      new AppendBudgetExceeded('Community append completion budget exhausted'),
      'budget_pressure',
    ],
  ] as const)('defers the batch on %s', (_, error, reason) => {
    expect(appendFailure(error)).toBe(reason)
    expect(isAppendDeferral(error)).toBe(true)
  })

  it.each([
    ['a unique violation', failure('P2002')],
    ['a raw query failure without a SQL state', failure('P2010')],
    ['a deadlock', failure('P2010', '40P01')],
    ['a model deadlock', modelFailure('40P01', 'deadlock detected')],
    ['25P04 with another message', modelFailure('25P04', 'some other fatal', 'FATAL')],
    ['a raw 25P04 without its message', failure('P2010', '25P04')],
    ['25P03 with another message', modelFailure('25P03', 'some other fatal', 'FATAL')],
    [
      '25P03 with the transaction timeout text',
      modelFailure('25P03', TRANSACTION_TIMEOUT),
    ],
    ['25P04 with the idle timeout text', modelFailure('25P04', IDLE_TIMEOUT, 'FATAL')],
    // Prisma 6.19 reports a 25P03 or 25P04 that fires while the session is idle only as
    // P1017, with no SQLSTATE. A real lost connection looks the same, so it stays a
    // dependency failure (decision 2026-10-28).
    [
      'a server-closed connection',
      new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
        code: 'P1017',
        clientVersion: 'test',
      }),
    ],
    ['a plain error', new Error('connection refused')],
    ['a non-error rejection', 'unavailable'],
  ] as const)('reports %s as a dependency failure', (_, error) => {
    expect(appendFailure(error)).toBe('dependency_unavailable')
    expect(isAppendDeferral(error)).toBe(false)
  })
})

// Each prepared candidate costs 10 ms and each written row 60 ms of fake time.
const PREPARE_MS = 10
const WRITE_ROW_MS = 60
type Row = {
  id: string
  stream_id: string
  kind: string
  revision: bigint
  post_id: string
  comment_id: null
  parent_id: null
  appended_at: Date | null
}
function sqlText(query: unknown): string {
  return Array.isArray(query) ? query.join('?') : (query as Prisma.Sql).sql
}
/** A transaction client that answers each append query against an in-memory outbox. */
function outboxClient(rows: Row[], written: string[][]) {
  const queued = () => rows.filter((row) => !row.appended_at)
  const tx = {
    $executeRawUnsafe: (query: string) => {
      if (query === 'SAVEPOINT community_candidate') vi.advanceTimersByTime(PREPARE_MS)
      return Promise.resolve(0)
    },
    $queryRaw: (query: unknown, ...values: unknown[]) => {
      const text = sqlText(query)
      if (text.includes('hashtext(value)')) return Promise.resolve([{ key: 1 }])
      if (text.includes('pg_try_advisory_xact_lock_shared'))
        return Promise.resolve([{ acquired: true }])
      if (text.includes('FOR UPDATE SKIP LOCKED'))
        return Promise.resolve(queued().filter((row) => row.id === values[0]))
      if (text.includes('AS valid')) return Promise.resolve([{ valid: true }])
      return Promise.resolve([])
    },
    $executeRaw: (query: Prisma.Sql) => {
      // Eight values per input row; the first is the outbox id.
      const ids = query.values.filter((_, index) => index % 8 === 0) as string[]
      vi.advanceTimersByTime(ids.length * WRITE_ROW_MS)
      for (const row of rows) if (ids.includes(row.id)) row.appended_at = new Date()
      written.push(ids)
      return Promise.resolve(ids.length)
    },
    communityDomainOutbox: { findMany: () => Promise.resolve(queued()) },
    communityArtifactSubject: { findMany: () => Promise.resolve([]) },
    lookbookPost: {
      findUnique: () =>
        Promise.resolve({
          status: 'published',
          user_id: 'member',
          erasure_requested_at: null,
          anonymized_at: null,
        }),
    },
  }
  return {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient
}

describe('community append completion budget trim', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes only the rows that fit the remaining budget and queues the rest', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const rows: Row[] = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      stream_id: 'public',
      kind: 'post.published',
      revision: 1n,
      post_id: `post-${index}`,
      comment_id: null,
      parent_id: null,
      appended_at: null,
    }))
    const written: string[][] = []
    const stream = new CommunityStreamRepository(outboxClient(rows, written))
    // Injected write-cost estimate: 60 ms per row. The window closes after 15 candidates
    // (150 ms), which leaves 250 ms of the 400 ms budget: four rows fit, 250 / 60 = 4.17.
    Reflect.set(stream, 'writeCostMs', WRITE_ROW_MS)

    const first = await stream.appendWithReport()
    expect(first).toMatchObject({ stop: 'window', ready: 15, selectedReason: 'budget' })
    expect(first.remainingMs).toBe(250)
    expect(first.writeCostMs).toBe(WRITE_ROW_MS)
    expect(first.selected).toBe(
      Math.max(1, Math.floor(first.remainingMs / first.writeCostMs))
    )
    expect(first.selected).toBe(4)
    expect(first.count).toBe(4)
    expect(written[0]).toEqual(rows.slice(0, 4).map((row) => row.id))

    // The eleven trimmed rows stay queued, and the next batch writes them first.
    expect(rows.filter((row) => !row.appended_at)).toHaveLength(16)
    const second = await stream.appendWithReport()
    expect(second).toMatchObject({ ready: 15, selectedReason: 'budget', selected: 4 })
    expect(written[1]).toEqual(rows.slice(4, 8).map((row) => row.id))
    let drained = 8
    while (rows.some((row) => !row.appended_at))
      drained += (await stream.appendWithReport()).count
    expect(drained).toBe(20)
    expect(written.flat()).toEqual(rows.map((row) => row.id))
  })
})
