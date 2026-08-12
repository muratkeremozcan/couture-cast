// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommerceRepository } from './commerce.repository.js'
import { CommerceRetentionService } from './commerce-retention.service.js'

describe('CommerceRetentionService', () => {
  const repository = {
    findExpiredConversionIds: vi.fn(),
    deleteConversionsByIds: vi.fn(),
    findExpiredClickIds: vi.fn(),
    deleteClicksByIds: vi.fn(),
  }

  let service: CommerceRetentionService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'))

    repository.findExpiredConversionIds.mockReset().mockResolvedValue([])
    repository.deleteConversionsByIds.mockReset().mockResolvedValue(0)
    repository.findExpiredClickIds.mockReset().mockResolvedValue([])
    repository.deleteClicksByIds.mockReset().mockResolvedValue(0)

    service = new CommerceRetentionService(repository as unknown as CommerceRepository)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prunes on a 24-month cutoff, not the telemetry 24-hour one', async () => {
    await service.pruneExpiredCommerceRecords()

    const expectedCutoff = new Date('2024-08-11T00:00:00.000Z')
    expect(repository.findExpiredConversionIds).toHaveBeenCalledWith(
      expectedCutoff,
      expect.any(Number)
    )
    expect(repository.findExpiredClickIds).toHaveBeenCalledWith(
      expectedCutoff,
      expect.any(Number)
    )
  })

  it('deletes conversions before clicks so surviving attribution stays intact', async () => {
    repository.findExpiredConversionIds.mockResolvedValueOnce(['c1'])
    repository.deleteConversionsByIds.mockResolvedValueOnce(1)
    repository.findExpiredClickIds.mockResolvedValueOnce(['k1'])
    repository.deleteClicksByIds.mockResolvedValueOnce(1)

    await service.pruneExpiredCommerceRecords()

    const conversionOrder =
      repository.deleteConversionsByIds.mock.invocationCallOrder[0] ?? Number.NaN
    const clickOrder =
      repository.deleteClicksByIds.mock.invocationCallOrder[0] ?? Number.NaN
    expect(conversionOrder).toBeLessThan(clickOrder)
  })

  it('keeps draining while a batch comes back full', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, index) => `k${index}`)
    repository.findExpiredClickIds
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(['k-last'])
      .mockResolvedValue([])
    repository.deleteClicksByIds.mockResolvedValueOnce(500).mockResolvedValueOnce(1)

    await service.pruneExpiredCommerceRecords()

    expect(repository.findExpiredClickIds).toHaveBeenCalledTimes(2)
    expect(repository.deleteClicksByIds).toHaveBeenCalledTimes(2)
  })

  it('stops after the batch cap rather than looping forever', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, index) => `k${index}`)
    repository.findExpiredClickIds.mockResolvedValue(fullBatch)
    repository.deleteClicksByIds.mockResolvedValue(500)

    await service.pruneExpiredCommerceRecords()

    expect(repository.findExpiredClickIds).toHaveBeenCalledTimes(200)
  })

  it('issues no delete when nothing has aged out', async () => {
    await service.pruneExpiredCommerceRecords()

    expect(repository.deleteConversionsByIds).not.toHaveBeenCalled()
    expect(repository.deleteClicksByIds).not.toHaveBeenCalled()
  })

  it('swallows a failed prune so the scheduler survives it', async () => {
    repository.findExpiredConversionIds.mockRejectedValue(new Error('connection reset'))

    await expect(service.pruneExpiredCommerceRecords()).resolves.toBeUndefined()
  })
})
