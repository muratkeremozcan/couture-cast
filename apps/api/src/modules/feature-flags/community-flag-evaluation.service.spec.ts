import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import { CommunityFlagEvaluationService } from './community-flag-evaluation.service.js'
import { CommunityAuthorizationBudget } from '../community/community-availability.js'
import { pldbgapi2Abort } from '../../testing/pldbgapi2.js'

const lockTimeout = () =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `55P03`.', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: '55P03', message: 'ERROR: canceling statement due to lock timeout' },
  })

describe('flag claim after a pldbgapi2 re-run (repeat safety)', () => {
  it('treats a guard lock timeout in the re-run as a guard failure, not insert contention', async () => {
    // Run 1 passes the guards and aborts in the INSERT. Run 2 then times out in the
    // guards, before its own INSERT: that is not contention on the insert, so the
    // claim must surface it instead of retrying as if another instance held the row.
    const timeout = lockTimeout()
    const executeRaw = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(pldbgapi2Abort())
      .mockRejectedValue(timeout)
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $executeRaw: executeRaw,
    }
    const $transaction = vi.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx)
    )
    const service = new CommunityFlagEvaluationService(
      { $transaction } as unknown as PrismaClient,
      { getFeatureFlagValue: vi.fn() }
    )
    const budget = new CommunityAuthorizationBudget(performance.now() + 60_000)

    await expect(service['claim']('member-1', 'owner-1', budget)).rejects.toBe(timeout)
    expect($transaction).toHaveBeenCalledTimes(2)
    expect(executeRaw).toHaveBeenCalledTimes(3)
  })
})
