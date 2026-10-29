import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import { communityPrivacyTransaction } from './community-privacy.js'
const failure = (code: string, sql?: string) =>
  new Prisma.PrismaClientKnownRequestError('Controlled transaction failure', {
    code,
    clientVersion: 'test',
    ...(sql ? { meta: { code: sql } } : {}),
  })
// A model operation's deadlock or lock timeout, as Prisma 6.19 raised it (2026-10-27 probe).
const modelFailure = (sql: string, message: string) =>
  new Prisma.PrismaClientUnknownRequestError(
    `Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sql}", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion: 'test' }
  )
// The error plpgsql_check's pldbgapi2 layer raised on local Supabase, as Prisma reports it.
const pldbgapi2 = (
  code = 'XX000',
  message = 'ERROR: cannot find parent statement on pldbgapi2 call stack'
) =>
  new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${code}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: 'test', meta: { code, message } }
  )
describe('privacy transaction recovery contract', () => {
  it.each([
    failure('P2034'),
    failure('P2010', '40001'),
    failure('P2010', '40P01'),
    failure('P2010', '55P03'),
    modelFailure('40P01', 'deadlock detected'),
    modelFailure('55P03', 'canceling statement due to lock timeout'),
    pldbgapi2(),
  ])(
    'retries a transient database failure and commits the original operation once',
    async (error) => {
      const work = vi.fn(() => Promise.resolve('committed'))
      const transaction = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockImplementation(() => work())
      const result = await communityPrivacyTransaction(
        { $transaction: transaction } as unknown as PrismaClient,
        work
      )
      expect(result).toBe('committed')
      expect(transaction).toHaveBeenCalledTimes(2)
      expect(work).toHaveBeenCalledTimes(1)
      expect(transaction).toHaveBeenLastCalledWith(work, {
        isolationLevel: 'ReadCommitted',
        timeout: 7000,
        maxWait: 1000,
      })
    }
  )
  it.each([
    failure('P2002'),
    failure('P2010'),
    failure('P2010', '23514'),
    modelFailure('23514', 'new row violates check constraint'),
    pldbgapi2('XX000', 'ERROR: some other internal error'),
    pldbgapi2('P0001', 'ERROR: cannot find parent statement on pldbgapi2 call stack'),
    new Error('cannot find parent statement on pldbgapi2 call stack'),
    new Error('unavailable'),
  ])(
    'propagates permanent failures without replaying a privacy mutation',
    async (error) => {
      const transaction = vi.fn().mockRejectedValue(error)
      await expect(
        communityPrivacyTransaction(
          { $transaction: transaction } as unknown as PrismaClient,
          () => Promise.resolve()
        )
      ).rejects.toBe(error)
      expect(transaction).toHaveBeenCalledTimes(1)
    }
  )
  it('ends after three pldbgapi2 failures and preserves the original error', async () => {
    const error = pldbgapi2()
    const transaction = vi.fn().mockRejectedValue(error)
    await expect(
      communityPrivacyTransaction(
        { $transaction: transaction } as unknown as PrismaClient,
        () => Promise.resolve()
      )
    ).rejects.toBe(error)
    expect(transaction).toHaveBeenCalledTimes(3)
  })
  it('ends after three transient failures and preserves the original error', async () => {
    const error = failure('P2034')
    const transaction = vi.fn().mockRejectedValue(error)
    await expect(
      communityPrivacyTransaction(
        { $transaction: transaction } as unknown as PrismaClient,
        () => Promise.resolve()
      )
    ).rejects.toBe(error)
    expect(transaction).toHaveBeenCalledTimes(3)
  })
})
