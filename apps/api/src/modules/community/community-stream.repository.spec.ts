import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  AppendBudgetExceeded,
  appendFailure,
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
    ['a closed connection', failure('P1017')],
    ['a plain error', new Error('connection refused')],
    ['a non-error rejection', 'unavailable'],
  ] as const)('reports %s as a dependency failure', (_, error) => {
    expect(appendFailure(error)).toBe('dependency_unavailable')
    expect(isAppendDeferral(error)).toBe(false)
  })
})
