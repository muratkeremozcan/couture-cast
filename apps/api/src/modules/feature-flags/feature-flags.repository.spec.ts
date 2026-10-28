// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import type { PrismaClient } from '@prisma/client'
import type { FeatureFlagRecord } from '@couture/config'
import { describe, expect, it, vi } from 'vitest'
import { FeatureFlagsRepository } from './feature-flags.repository'

const createRepository = () => {
  const findUnique = vi.fn()
  const upsert = vi.fn((args: unknown) => args)
  const prisma = {
    featureFlag: { findUnique, upsert },
  } as unknown as PrismaClient
  // Writes run on the transaction client, so a write outside it would miss `tx`.
  const tx = { featureFlag: { upsert } }
  const $transaction = vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx))
  Object.assign(prisma, { $transaction })

  return {
    findUnique,
    upsert,
    $transaction,
    repository: new FeatureFlagsRepository(prisma),
  }
}

describe('FeatureFlagsRepository', () => {
  describe('findValue', () => {
    it('shares one in-flight database read per key across 100 cold waiters', async () => {
      const { findUnique, repository } = createRepository()
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
        await held
        return { key: where.key, value: where.key === 'community_read_enabled' }
      })
      const reads = Array.from({ length: 100 }, () =>
        Promise.all([
          repository.findValue('community_read_enabled'),
          repository.findValue('color_analysis_enabled'),
        ])
      )
      await Promise.resolve()
      expect(findUnique).toHaveBeenCalledTimes(2)
      release()
      expect(await Promise.all(reads)).toEqual(
        Array.from({ length: 100 }, () => [true, false])
      )
      await repository.findValue('community_read_enabled')
      expect(findUnique).toHaveBeenCalledTimes(3)
    })

    it('rejects every waiter on a failed shared read and allows a fresh read afterward', async () => {
      const { findUnique, repository } = createRepository()
      const failure = new Error('database unavailable')
      findUnique.mockRejectedValueOnce(failure)
      const reads = Array.from({ length: 100 }, () =>
        repository.findValue('community_read_enabled')
      )
      expect(
        (await Promise.allSettled(reads)).every(
          (result) => result.status === 'rejected' && result.reason === failure
        )
      ).toBe(true)
      expect(findUnique).toHaveBeenCalledOnce()
      findUnique.mockResolvedValueOnce({ value: false })
      await expect(repository.findValue('community_read_enabled')).resolves.toBe(false)
      expect(findUnique).toHaveBeenCalledTimes(2)
    })

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
    })

    it('still opens a transaction when there is nothing to sync', async () => {
      const { $transaction, upsert, repository } = createRepository()

      await expect(repository.upsertMany([])).resolves.toBeUndefined()

      expect(upsert).not.toHaveBeenCalled()
      expect($transaction).toHaveBeenCalledOnce()
    })
  })
})
