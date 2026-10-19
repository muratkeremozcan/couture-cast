import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { SetCommunityReactionInput } from '@couture/api-client/contracts/http'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { GuardianService } from '../../src/modules/guardian/guardian.service.js'
import { isolatedCommunityDatabase } from './isolated-community-database.js'

vi.mock('../../src/workers/base.worker.js', () => ({
  defaultWorkerOptions: () => ({}),
  createWorker: () => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    client: Promise.resolve({
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    }),
  }),
}))
vi.mock('../../src/modules/community/community-moderation.outbox.js', () => ({
  CommunityModerationOutboxDispatcher: class {
    dispatchPending = vi.fn().mockResolvedValue(undefined)
  },
}))

export function reactionTestContext() {
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: database.url,
      },
    },
  })
  const repository = new CommunityRepository(prisma)
  const namespace = `community-reactions-${randomUUID()}`
  const guardian = new GuardianService(
    { capture: vi.fn() },
    prisma,
    { markTeenAccessRevoked: vi.fn(), markTeenAccessGranted: vi.fn() } as never,
    { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
  )
  const input = (
    selection: SetCommunityReactionInput['selection'],
    baseRevision = 0
  ): SetCommunityReactionInput => ({ selection, baseRevision, mutationId: randomUUID() })
  async function fixture(birthdate = '1990-01-01T00:00:00Z', client = prisma) {
    const user = await client.user.create({
      data: {
        email: `${namespace}-${randomUUID()}@synthetic.test`,
        profile: {
          create: {
            birthdate: new Date(birthdate),
            preferences: { compliance: { accountStatus: 'active' } },
          },
        },
      },
    })
    const post = await client.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({
          id: `${namespace}-${randomUUID()}`,
          userId: user.id,
          status: 'published',
          publishedAt: new Date('2025-06-01T00:00:00Z'),
          altTextConfirmedAt: new Date('2025-05-31T00:00:00Z'),
        })
      ),
    })
    return { userId: user.id, postId: post.id }
  }
  function mutate(userId: string, postId: string, intent: SetCommunityReactionInput) {
    return repository.setReaction({
      userId,
      postId,
      input: intent,
      platform: 'web',
      assertEligible: async (tx, participation) => {
        if (participation && intent.selection !== null)
          await guardian.assertWardrobeUploadAllowed(userId, undefined, tx)
      },
    })
  }
  beforeAll(async () => {
    await database.migrate()
    await prisma.$queryRaw`SELECT 1 FROM "CommunityReaction" LIMIT 1`
  }, 30_000)
  beforeEach(async () => {
    // This connection belongs to this file's disposable database. Each delivery
    // scenario starts with its own backlog, independent of preceding reactions.
    await prisma.communityReactionOutbox.deleteMany()
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    try {
      await prisma.$disconnect()
    } finally {
      // Database disposal also removes immutable guardian audit records on failure.
      await database.drop()
    }
  })

  return { database, prisma, repository, namespace, guardian, input, fixture, mutate }
}
