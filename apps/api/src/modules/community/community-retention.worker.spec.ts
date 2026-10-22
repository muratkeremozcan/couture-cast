import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { PushTokenRepository } from '../notifications/push-token.repository.js'
import { CommunityRetentionWorker } from './community-retention.worker.js'

describe('retention batch privacy fences', () => {
  it.each(['empty', 'member', 'post', 'both'] as const)(
    'keeps cleanup bounded and guards exact linked identities: %s',
    async (scope) => {
      const groups =
        scope === 'empty'
          ? []
          : [
              {
                id: 'group',
                post_id: scope === 'member' ? null : 'post',
                deliveries: [{ id: 'delivery', attempts: [{ id: 'attempt' }] }],
              },
            ]
      const subjects =
        scope === 'member' || scope === 'both' ? [{ member_id: 'member' }] : []
      const execute = vi.fn().mockResolvedValue(0)
      const query = vi.fn().mockResolvedValue([])
      const artifactDelete = vi.fn().mockResolvedValue({ count: 0 })
      const flagsDelete = vi.fn().mockResolvedValue({ count: 0 })
      const groupFind = vi.fn().mockResolvedValue(groups)
      const tx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $executeRaw: execute,
        $queryRaw: query,
        communityNotificationGroup: {
          findMany: groupFind,
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        communityArtifactSubject: {
          findMany: vi.fn().mockResolvedValue(subjects),
          deleteMany: artifactDelete,
        },
        communityNotificationIntent: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        communityDomainOutbox: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        communityFlagEvaluation: { deleteMany: flagsDelete },
      }
      const flags = scope === 'empty' ? [] : [{ member_id: 'member' }]
      const transaction = vi
        .fn()
        .mockImplementation((work: (db: typeof tx) => Promise<void>) => work(tx))
      const prisma = {
        pushToken: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'token',
              user_id: 'member',
              binding_generation: 7,
              token: 'ExpoPushToken[fixture]',
            },
          ]),
        },
        communityFlagEvaluation: { findMany: vi.fn().mockResolvedValue(flags) },
        $transaction: transaction,
      } as unknown as PrismaClient
      const deleteBindings = vi.fn().mockResolvedValue(undefined)
      await new CommunityRetentionWorker(prisma, {
        deleteBindings,
      } as unknown as PushTokenRepository).sweep()
      expect(deleteBindings).toHaveBeenCalledExactlyOnceWith([
        {
          registrationId: 'token',
          ownerId: 'member',
          bindingGeneration: 7,
          token: 'ExpoPushToken[fixture]',
          inactiveBefore: expect.any(Date) as Date,
        },
      ])
      expect(groupFind).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }))
      expect(transaction).toHaveBeenCalledTimes(scope === 'empty' ? 1 : 2)
      if (scope === 'empty') expect(flagsDelete).not.toHaveBeenCalled()
      else
        expect(flagsDelete).toHaveBeenCalledWith({
          where: {
            member_id: { in: ['member'] },
            last_used_at: { lt: expect.any(Date) as Date },
          },
        })
      expect(execute).toHaveBeenCalledTimes(scope === 'empty' ? 1 : 3)
      expect(artifactDelete).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              artifact_kind: 'group',
              artifact_id: { in: scope === 'empty' ? [] : ['group'] },
            },
            {
              artifact_kind: 'delivery',
              artifact_id: { in: scope === 'empty' ? [] : ['delivery'] },
            },
            {
              artifact_kind: { in: ['attempt', 'receipt'] },
              artifact_id: { in: scope === 'empty' ? [] : ['attempt'] },
            },
          ],
        },
      })
    }
  )
})
