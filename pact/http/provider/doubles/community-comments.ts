// Story 6.4 owner: transport provider doubles keep real comment controllers/guards.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common'
import {
  createCommunityComment,
  createCommunityCommentSubmission,
} from '@couture/testing'
import { getProviderCommunityState } from '../state'
import { CommunityRateLimitException } from '../../../../apps/api/src/modules/community/community-rate-limit.exception'
import type { CommunityCommentsService } from '../../../../apps/api/src/modules/community/community-comments.service'
const postId = 'post-6100-published-0001'
const item = createCommunityComment({
  id: 'comment-6400-root',
  postId,
  body: 'Beautiful layers.',
})
const submission = createCommunityCommentSubmission({
  id: item.id,
  postId,
  body: item.body,
})
export function createCommunityCommentsDouble(): Pick<
  CommunityCommentsService,
  'list' | 'submissions' | 'create' | 'delete' | 'report'
> {
  const visible = () => {
    const state = getProviderCommunityState()
    if (state?.scenario === 'comment-refusal') {
      switch (state.refusal) {
        case 'invalid cursor':
          throw new BadRequestException('Invalid pagination cursor.')
        case 'ineligible author':
          throw new ForbiddenException(
            'You must be at least 13 years old to post to the community feed.'
          )
        case 'self report':
          throw new ForbiddenException('You cannot report your own comment.')
        case 'changed mutation':
          throw new ConflictException(
            'Idempotency key was reused with a different payload.'
          )
        case 'changed report':
          throw new ConflictException(
            'You already reported this post for a different reason.'
          )
        case 'limited create':
          throw new CommunityRateLimitException('Comment submission limit reached.', 60)
        case 'limited report':
          throw new CommunityRateLimitException(
            'You have reached the daily report limit. Please try again tomorrow.',
            3600
          )
        case 'disabled thread':
          throw new ServiceUnavailableException(
            'Community feed is temporarily unavailable.'
          )
      }
    }
    if (state?.scenario === 'post-not-found')
      throw new NotFoundException('Community post not found.')
  }
  return {
    list: (params) => {
      visible()
      const paginated = getProviderCommunityState()?.scenario === 'comment-page'
      return Promise.resolve({
        items: [
          params.parentId
            ? {
                ...item,
                id: paginated ? 'comment-6400-page-two' : 'comment-6400-reply',
                parentId: item.id,
              }
            : paginated
              ? { ...item, id: 'comment-6400-page-two' }
              : item,
        ],
        nextCursor: paginated ? 'next-public-page' : null,
        snapshot: 1,
        hasNewer: paginated,
      })
    },
    submissions: () => {
      visible()
      return Promise.resolve(
        getProviderCommunityState()?.scenario === 'comment-page'
          ? {
              items: [{ ...submission, id: 'comment-6400-page-two' }],
              nextCursor: 'next-private-page',
            }
          : { items: [submission], nextCursor: null }
      )
    },
    create: () => {
      visible()
      return Promise.resolve(submission)
    },
    delete: () => {
      visible()
      return Promise.resolve({ ...submission, status: 'author_deleted', body: null })
    },
    report: () => {
      visible()
      return Promise.resolve({
        reported: true,
        acceptedAt: '2026-10-19T12:00:00.000Z',
        routedAt: '2026-10-19T12:00:00.000Z',
        reviewDueAt: '2026-10-20T12:00:00.000Z',
      })
    },
  }
}
