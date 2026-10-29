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
