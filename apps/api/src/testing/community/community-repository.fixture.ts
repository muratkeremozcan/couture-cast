// Learning path Step 38: Community feed by climate band.
import { vi } from 'vitest'
import { type PrismaClient } from '@prisma/client'
import { CommunityRepository } from '../../modules/community/community.repository'

export const viewerUserId = 'user-viewer-456'

export const createRepo = () => {
  const savedLocationFindMany = vi.fn()
  const lookbookPostFindMany = vi.fn()
  const lookbookPostFindUnique = vi.fn()
  const lookbookPostFindUniqueOrThrow = vi.fn()
  const lookbookPostCreate = vi.fn()
  const lookbookPostUpdate = vi.fn()
  const lookbookPostUpdateMany = vi.fn()
  const spotlightReadWindowDeleteMany = vi.fn().mockResolvedValue({ count: 0 })
  const communityChallengeFindFirst = vi.fn()
  const communityChallengeFindUnique = vi.fn()
  const communityChallengeCreate = vi.fn()
  const communityChallengeUpdate = vi.fn()
  const moderationOutboxUpsert = vi.fn()
  const moderationEventFindFirst = vi.fn()
  const moderationEventFindMany = vi.fn()
  const moderationEventCreate = vi.fn()
  const reportFindUnique = vi.fn()
  const reportFindMany = vi.fn()
  const reportCreate = vi.fn()
  const aliasFindUnique = vi.fn()
  const aliasFindMany = vi.fn()
  const aliasCreate = vi.fn()
  const executeRaw = vi.fn().mockResolvedValue(1)
  const queryRaw = vi.fn()
  const transaction = vi.fn()

  const client = {
    communitySubject: { findUnique: vi.fn().mockResolvedValue({ generation: 0 }) },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({
        birthdate: new Date('1990-01-01'),
        preferences: { compliance: { accountStatus: 'active' } },
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: viewerUserId,
        profile: { birthdate: new Date('1990-01-01') },
        teen_roles: [],
      }),
    },
    guardianConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    communityReaction: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    communityReactionReceipt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    communityReactionOutbox: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    communitySpotlightReadWindow: { deleteMany: spotlightReadWindowDeleteMany },
    savedLocation: { findMany: savedLocationFindMany },
    lookbookPost: {
      findMany: lookbookPostFindMany,
      findUnique: lookbookPostFindUnique,
      findUniqueOrThrow: lookbookPostFindUniqueOrThrow,
      create: lookbookPostCreate,
      update: lookbookPostUpdate,
      updateMany: lookbookPostUpdateMany,
    },
    communityChallenge: {
      findFirst: communityChallengeFindFirst,
      findUnique: communityChallengeFindUnique,
      create: communityChallengeCreate,
      update: communityChallengeUpdate,
    },
    communityModerationOutbox: {
      upsert: moderationOutboxUpsert,
    },
    moderationEvent: {
      findFirst: moderationEventFindFirst,
      findMany: moderationEventFindMany,
      create: moderationEventCreate,
    },
    communityComment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    communityCommentReceipt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    communityCommentScreeningOutbox: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    communityCommentAnalyticsSubject: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    communityCommentReport: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    communityPostReport: {
      findUnique: reportFindUnique,
      findMany: reportFindMany,
      create: reportCreate,
    },
    communityAlias: {
      findUnique: aliasFindUnique,
      findMany: aliasFindMany,
      create: aliasCreate,
    },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  }

  // The transaction double runs the callback against the same client, which is
  // what lets these specs assert the statement ORDER inside a transaction --
  // the advisory lock has to be first or the count is not serialised.
  transaction.mockImplementation((callback: (tx: typeof client) => unknown) =>
    callback(client)
  )

  const prisma = {
    ...client,
    $transaction: transaction,
  } as unknown as PrismaClient

  const repo = new CommunityRepository(prisma)
  return {
    repo,
    savedLocationFindMany,
    lookbookPostFindMany,
    lookbookPostFindUnique,
    lookbookPostFindUniqueOrThrow,
    lookbookPostCreate,
    lookbookPostUpdate,
    lookbookPostUpdateMany,
    spotlightReadWindowDeleteMany,
    communityChallengeFindFirst,
    communityChallengeFindUnique,
    communityChallengeCreate,
    communityChallengeUpdate,
    moderationOutboxUpsert,
    moderationEventFindFirst,
    moderationEventFindMany,
    moderationEventCreate,
    reportFindUnique,
    reportFindMany,
    reportCreate,
    aliasFindUnique,
    aliasFindMany,
    aliasCreate,
    executeRaw,
    queryRaw,
    transaction,
  }
}
