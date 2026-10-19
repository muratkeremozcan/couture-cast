// Story 6.4 owner: valid deterministic fixtures and scoped privacy-preserving cleanup.
import { Prisma } from '@prisma/client'
import { expect, it, vi } from 'vitest'
import {
  communityCommentSchema,
  communityCommentSubmissionSchema,
} from '@couture/api-client/contracts/http'
import { cleanupCommunityCommentFixtures } from '../src/community-comments-cleanup.js'
import {
  createCommunityComment,
  createCommunityCommentSubmission,
} from '../src/factories/community.factory.js'

it('creates independent canonical public and private fixtures with explicit reply/tombstone overrides', () => {
  const root = createCommunityComment()
  expect(communityCommentSchema.parse(root)).toMatchObject({
    parentId: null,
    publicationSequence: 1,
    unavailable: false,
  })
  root.body = 'A modified local fixture.'
  expect(createCommunityComment().body).toBe('A lovely layered look.')
  const reply = createCommunityComment({
    id: 'reply',
    parentId: 'root',
    body: null,
    author: null,
    unavailable: true,
    publicationSequence: 2,
  })
  expect(communityCommentSchema.parse(reply)).toMatchObject({
    id: 'reply',
    parentId: 'root',
    body: null,
    unavailable: true,
  })
  expect(
    communityCommentSubmissionSchema.parse(createCommunityCommentSubmission())
  ).toMatchObject({ status: 'pending_screening', publicationSequence: null })
  expect(
    communityCommentSubmissionSchema.parse(
      createCommunityCommentSubmission({
        id: 'deleted',
        status: 'author_deleted',
        body: null,
      })
    )
  ).toMatchObject({ id: 'deleted', status: 'author_deleted', body: null })
})

it('cleans only selected fixture rows and retains roots referenced by another member', async () => {
  const comment = {
    findMany: vi.fn().mockResolvedValue([{ parent_id: 'retained-root' }]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  }
  const report = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
  const tx = {
    communityComment: comment,
    communityCommentReport: report,
  } as unknown as Prisma.TransactionClient
  await cleanupCommunityCommentFixtures(tx, [])
  expect(comment.findMany).not.toHaveBeenCalled()
  await cleanupCommunityCommentFixtures(tx, ['retained-root', 'owned-reply'])
  expect(comment.findMany).toHaveBeenCalledWith({
    where: {
      parent_id: { in: ['retained-root', 'owned-reply'] },
      id: { notIn: ['retained-root', 'owned-reply'] },
    },
    select: { parent_id: true },
  })
  expect(report.updateMany).toHaveBeenCalledWith({
    where: { comment_id: { in: ['retained-root', 'owned-reply'] } },
    data: { content_snapshot: Prisma.DbNull },
  })
  expect(comment.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['retained-root'] } },
    data: {
      body: null,
      user_id: null,
      status: 'erased',
      screening_reason: null,
      screening_version: null,
    },
  })
  expect(comment.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: ['owned-reply'] } },
  })
})
