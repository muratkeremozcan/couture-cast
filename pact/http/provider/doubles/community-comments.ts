import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_COMMENT_SELF_REPORT_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_COMMENT_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_COMMENT_SUBMISSION_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_RATE_LIMITED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
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
          throw new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE)
        case 'ineligible author':
          throw new ForbiddenException(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
        case 'self report':
          throw new ForbiddenException(COMMUNITY_COMMENT_SELF_REPORT_MESSAGE)
        case 'changed mutation':
          throw new ConflictException(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
        case 'changed report':
          throw new ConflictException(COMMUNITY_COMMENT_REPORT_REASON_CHANGED_MESSAGE)
        case 'limited create':
          throw new CommunityRateLimitException(
            COMMUNITY_COMMENT_SUBMISSION_RATE_LIMITED_MESSAGE,
            60
          )
        case 'limited report':
          throw new CommunityRateLimitException(
            COMMUNITY_REPORT_RATE_LIMITED_MESSAGE,
            3600
          )
        case 'disabled thread':
          throw new ServiceUnavailableException(COMMUNITY_FEED_DISABLED_MESSAGE)
      }
    }
    if (state?.scenario === 'post-not-found')
      throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
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
