import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  AppendBudgetExceeded,
  appendFailure,
  isAppendDeferral,
} from './community-stream.repository.js'

const failure = (code: string, sql?: string) =>
  new Prisma.PrismaClientKnownRequestError('Controlled append failure', {
    code,
    clientVersion: 'test',
    ...(sql ? { meta: { code: sql } } : {}),
  })

describe('community append failure classification', () => {
  it.each([
    ['a NOWAIT head lock miss', failure('P2010', '55P03'), 'head_contention'],
    ['a statement timeout', failure('P2010', '57014'), 'budget_pressure'],
    ['a transaction timeout', failure('P2010', '25P04'), 'budget_pressure'],
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
    ['a plain error', new Error('connection refused')],
    ['a non-error rejection', 'unavailable'],
  ] as const)('reports %s as a dependency failure', (_, error) => {
    expect(appendFailure(error)).toBe('dependency_unavailable')
    expect(isAppendDeferral(error)).toBe(false)
  })
})
