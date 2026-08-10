import type { PrismaClient } from '@prisma/client'
import type { FeatureFlagRecord } from '@couture/config'
import { describe, expect, it, vi } from 'vitest'
import { FeatureFlagsRepository } from './feature-flags.repository'

const createRepository = () => {
  const findUnique = vi.fn()
  const upsert = vi.fn((args: unknown) => args)
  const $transaction = vi.fn().mockResolvedValue([])
  const prisma = {
    featureFlag: { findUnique, upsert },
    $transaction,
  } as unknown as PrismaClient

  return {
    findUnique,
    upsert,
    $transaction,
    repository: new FeatureFlagsRepository(prisma),
  }
}

describe('FeatureFlagsRepository', () => {
  describe('findValue', () => {
    it('returns the cached value for a known flag key', async () => {
      const { findUnique, repository } = createRepository()
      findUnique.mockResolvedValue({ key: 'ritual_v2', value: { enabled: true } })

      await expect(repository.findValue('ritual_v2' as never)).resolves.toEqual({
        enabled: true,
      })
      expect(findUnique).toHaveBeenCalledWith({ where: { key: 'ritual_v2' } })
    })

    it('returns null when the fallback cache has never been populated', async () => {
      // A cold cache must read as "no answer" so the caller applies its own default
      // rather than treating an absent row as a disabled flag.
      const { repository } = createRepository()

      await expect(repository.findValue('ritual_v2' as never)).resolves.toBeNull()
    })

    it('returns null when the stored row exists but carries a null value', async () => {
      const { findUnique, repository } = createRepository()
      findUnique.mockResolvedValue({ key: 'ritual_v2', value: null })

      await expect(repository.findValue('ritual_v2' as never)).resolves.toBeNull()
    })
  })

  describe('upsertMany', () => {
    it('writes every flag in a single transaction so the cache stays consistent', async () => {
      const { $transaction, upsert, repository } = createRepository()
      const flags = [
        { key: 'ritual_v2', value: { enabled: true } },
        { key: 'capsule_beta', value: { enabled: false } },
      ] as unknown as FeatureFlagRecord[]

      await repository.upsertMany(flags)

      expect($transaction).toHaveBeenCalledOnce()
      expect(upsert).toHaveBeenCalledTimes(2)
      expect(upsert).toHaveBeenNthCalledWith(1, {
        where: { key: 'ritual_v2' },
        create: { key: 'ritual_v2', value: { enabled: true } },
        update: { value: { enabled: true } },
      })
      // The batch is handed to $transaction as one array of operations.
      expect($transaction.mock.calls[0]?.[0]).toHaveLength(2)
    })

    it('still opens a transaction when there is nothing to sync', async () => {
      const { $transaction, upsert, repository } = createRepository()

      await expect(repository.upsertMany([])).resolves.toBeUndefined()

      expect(upsert).not.toHaveBeenCalled()
      expect($transaction).toHaveBeenCalledWith([])
    })
  })
})
