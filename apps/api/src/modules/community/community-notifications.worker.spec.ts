import { describe, expect, it, vi } from 'vitest'
import type { Prisma, PrismaClient } from '@prisma/client'
import { CommunityNotificationsWorker } from './community-notifications.worker.js'
import { pldbgapi2Abort } from '../../testing/pldbgapi2.js'

describe('notification fan-out after a pldbgapi2 re-run (repeat safety)', () => {
  it('starts the re-run from the listed group row, not the aborted attempt re-read', async () => {
    const listed = { id: 'group-1', recipient_id: 'recipient-1', post_id: 'post-listed' }
    const links = [{ member_id: 'recipient-1', generation: 1 }]
    const guardPosts: unknown[] = []
    const tx = {
      $executeRaw: vi.fn((sql: Prisma.Sql) => {
        guardPosts.push(sql.values.at(-1))
        return Promise.resolve(0)
      }),
      // Run 1 claims the row; run 2 finds it gone and ends.
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'group-1' }])
        .mockResolvedValueOnce([]),
      communityArtifactSubject: { findMany: vi.fn().mockResolvedValue(links) },
      communitySubject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ member_id: 'recipient-1', generation: 1 }]),
      },
      // Run 1's re-read sees a row whose post moved; run 1 then aborts.
      communityNotificationGroup: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...listed, post_id: 'post-moved' }),
      },
      notificationPreference: {
        findUnique: vi.fn().mockRejectedValueOnce(pldbgapi2Abort()),
      },
    }
    const prisma = {
      communityNotificationGroup: { findMany: vi.fn().mockResolvedValue([listed]) },
      communityArtifactSubject: { findMany: vi.fn().mockResolvedValue(links) },
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    }
    const worker = new CommunityNotificationsWorker(prisma as unknown as PrismaClient, {
      dispatch: vi.fn(),
    })

    await expect(worker.fanout()).resolves.toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    // Each run guards the post the listed row named.
    expect(guardPosts).toEqual(['post-listed', 'post-listed'])
  })
})

describe('dispatch pass report', () => {
  const isLag = (sql: TemplateStringsArray) => sql.join('?').includes('AS lag_ms')
  function deliveries(rows: { id: string }[]) {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $executeRaw: vi.fn().mockResolvedValue(1),
    }
    const prisma = {
      $queryRaw: vi.fn((sql: TemplateStringsArray) =>
        Promise.resolve(isLag(sql) ? [{ lag_ms: 0, outstanding: 0 }] : rows)
      ),
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    }
    return { prisma, tx }
  }

  it('counts moved and rejected deliveries and resolves, so one rejection never fails the pass', async () => {
    const { prisma, tx } = deliveries([
      { id: 'moved' },
      { id: 'unchanged' },
      { id: 'rejected' },
    ])
    const dispatch = vi.fn((id: string) =>
      id === 'rejected'
        ? Promise.reject(new Error('lock timeout'))
        : Promise.resolve(id === 'moved')
    )
    const worker = new CommunityNotificationsWorker(prisma as unknown as PrismaClient, {
      dispatch,
    })
    await expect(worker.dispatch()).resolves.toEqual({ selected: 3, moved: 1, failed: 1 })
    expect(dispatch).toHaveBeenCalledTimes(3)
    // Only the rejected delivery moves on, in a bounded transaction that skips held rows.
    expect(tx.$executeRawUnsafe.mock.calls).toEqual([
      ["SET LOCAL lock_timeout = '100ms'"],
      ["SET LOCAL statement_timeout = '500ms'"],
    ])
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(
      (tx.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?')
    ).toContain('FOR UPDATE SKIP LOCKED')
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([['rejected']])
  })

  it('still resolves the pass when moving a rejected delivery on fails', async () => {
    const { prisma } = deliveries([{ id: 'rejected' }])
    prisma.$transaction.mockRejectedValue(new Error('database down'))
    const worker = new CommunityNotificationsWorker(prisma as unknown as PrismaClient, {
      dispatch: () => Promise.reject(new Error('lock timeout')),
    })
    await expect(worker.dispatch()).resolves.toEqual({ selected: 1, moved: 0, failed: 1 })
  })
})
