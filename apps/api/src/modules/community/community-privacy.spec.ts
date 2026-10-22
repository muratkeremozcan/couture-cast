import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import { communityPrivacyTransaction } from './community-privacy.js'
const failure = (code: string, sql?: string) =>
  new Prisma.PrismaClientKnownRequestError('Controlled transaction failure', {
    code,
    clientVersion: 'test',
    ...(sql ? { meta: { code: sql } } : {}),
  })
describe('privacy transaction recovery contract', () => {
  it.each([
    failure('P2034'),
    failure('P2010', '40001'),
    failure('P2010', '40P01'),
    failure('P2010', '55P03'),
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
