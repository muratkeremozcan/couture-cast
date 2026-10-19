import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { expect } from 'vitest'
import { communityCommentsClient, ResponseError } from '@couture/api-client'
import type { CommunityPlatform } from '@couture/api-client/contracts/http'
import {
  createCommunityComment,
  createCommunityCommentSubmission,
} from '@couture/testing'
import { PUBLISHED_POST_ID, communityHeaders } from './fixtures'
import { pactEventAuth, type CreateClient } from '../shared'

export const commentOperations = [
  'roots',
  'replies',
  'submissions',
  'create',
  'delete',
  'report',
] as const
export const commentIntent = {
  mutationId: '64000000-0000-4000-8000-000000000001',
  body: 'Beautiful layers.',
  locale: 'en-US' as const,
  parentId: null,
}
export const commentItem = createCommunityComment({
  id: 'comment-6400-root',
  postId: PUBLISHED_POST_ID,
  body: 'Beautiful layers.',
})
export const commentSubmission = createCommunityCommentSubmission({
  id: commentItem.id,
  postId: PUBLISHED_POST_ID,
  body: commentIntent.body,
})
export const commentReport = {
  reported: true,
  acceptedAt: '2026-10-19T12:00:00.000Z',
  routedAt: '2026-10-19T12:00:00.000Z',
  reviewDueAt: '2026-10-20T12:00:00.000Z',
}
const commentPage = {
  items: [commentItem],
  nextCursor: null,
  snapshot: 1,
  hasNewer: false,
}

export async function verifyCommunityComment(
  pact: PactV4,
  client: CreateClient,
  platform: CommunityPlatform,
  operation: (typeof commentOperations)[number]
) {
  // Provider endpoint: apps/api/src/modules/community/community-comments.controller.ts -> GET/POST/DELETE /api/v1/community/posts/:postId/comments, /comment-submissions, /comments/:commentId/replies, /comments/:commentId/report
  const suffix =
    operation === 'submissions'
      ? '/comment-submissions'
      : operation === 'replies'
        ? `/comments/${commentItem.id}/replies`
        : operation === 'delete'
          ? `/comments/${commentItem.id}`
          : operation === 'report'
            ? `/comments/${commentItem.id}/report`
            : '/comments'
  const method =
    operation === 'create' || operation === 'report'
      ? 'POST'
      : operation === 'delete'
        ? 'DELETE'
        : 'GET'
  const response =
    operation === 'report'
      ? commentReport
      : operation === 'create'
        ? commentSubmission
        : operation === 'delete'
          ? { ...commentSubmission, status: 'author_deleted', body: null }
          : operation === 'submissions'
            ? { items: [commentSubmission], nextCursor: null }
            : operation === 'replies'
              ? {
                  ...commentPage,
                  items: [
                    {
                      ...commentItem,
                      id: 'comment-6400-reply',
                      parentId: commentItem.id,
                    },
                  ],
                }
              : commentPage
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A published community post is visible to the caller',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} screened comment ${operation} request`)
    .withRequest(
      method,
      `/api/v1/community/posts/${PUBLISHED_POST_ID}${suffix}`,
      setJsonContent({
        headers: communityHeaders(platform),
        ...(operation === 'create'
          ? { body: commentIntent }
          : operation === 'report'
            ? { body: { reason: 'spam' } }
            : {}),
      })
    )
    .willRespondWith(200, setJsonContent({ body: { data: response } }))
    .executeTest(async (server: V3MockServer) => {
      const api = communityCommentsClient(client(server), platform)
      const result =
        operation === 'roots'
          ? await api.roots(PUBLISHED_POST_ID)
          : operation === 'replies'
            ? await api.replies(PUBLISHED_POST_ID, commentItem.id)
            : operation === 'submissions'
              ? await api.submissions(PUBLISHED_POST_ID)
              : operation === 'create'
                ? await api.create(PUBLISHED_POST_ID, commentIntent)
                : operation === 'delete'
                  ? await api.delete(PUBLISHED_POST_ID, commentItem.id)
                  : await api.report(PUBLISHED_POST_ID, commentItem.id, 'spam')
      expect(result).toEqual(response)
    })
}

export async function verifyCommunityCommentMissing(
  pact: PactV4,
  client: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community-comments.controller.ts -> GET /api/v1/community/posts/:postId/comments
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The requested community post is not visible to the caller',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} unavailable thread request`)
    .withRequest(
      'GET',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/comments`,
      setJsonContent({ headers: communityHeaders(platform) })
    )
    .willRespondWith(
      404,
      setJsonContent({
        body: {
          statusCode: 404,
          message: 'Community post not found.',
          error: 'Not Found',
        },
      })
    )
    .executeTest(async (server) => {
      const refusal = await communityCommentsClient(client(server), platform)
        .roots(PUBLISHED_POST_ID)
        .then(
          () => null,
          (error: unknown) => error
        )
      expect(refusal).toBeInstanceOf(ResponseError)
      const response = (refusal as ResponseError).response
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Community post not found.',
        error: 'Not Found',
      })
    })
}

export const commentFailureCases = [
  {
    name: 'invalid cursor',
    operation: 'roots',
    status: 400,
    error: 'Bad Request',
    message: 'Invalid pagination cursor.',
    cursor: 'invalid',
  },
  {
    name: 'invisible text',
    operation: 'create',
    status: 400,
    error: 'Bad Request',
    message: 'Comment must contain visible text.',
    body: '\u2800',
  },
  {
    name: 'ineligible author',
    operation: 'create',
    status: 403,
    error: 'Forbidden',
    message: 'You must be at least 13 years old to post to the community feed.',
  },
  {
    name: 'self report',
    operation: 'report',
    status: 403,
    error: 'Forbidden',
    message: 'You cannot report your own comment.',
  },
  {
    name: 'changed mutation',
    operation: 'create',
    status: 409,
    error: 'Conflict',
    message: 'Idempotency key was reused with a different payload.',
  },
  {
    name: 'changed report',
    operation: 'report',
    status: 409,
    error: 'Conflict',
    message: 'You already reported this post for a different reason.',
  },
  {
    name: 'limited create',
    operation: 'create',
    status: 429,
    error: 'Too Many Requests',
    message: 'Comment submission limit reached.',
    retry: '60',
  },
  {
    name: 'limited report',
    operation: 'report',
    status: 429,
    error: 'Too Many Requests',
    message: 'You have reached the daily report limit. Please try again tomorrow.',
    retry: '3600',
  },
  {
    name: 'disabled thread',
    operation: 'roots',
    status: 503,
    error: 'Service Unavailable',
    message: 'Community feed is temporarily unavailable.',
  },
] as const

export async function verifyCommunityCommentFailure(
  pact: PactV4,
  client: CreateClient,
  platform: CommunityPlatform,
  failure: (typeof commentFailureCases)[number]
) {
  const operation = failure.operation
  const input = { ...commentIntent, ...('body' in failure ? { body: failure.body } : {}) }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A comment operation has a documented refusal',
        params: {
          userId: pactEventAuth.userId,
          postId: PUBLISHED_POST_ID,
          refusal: failure.name,
        },
      })
    )
    .uponReceiving(`a ${platform} comment ${failure.name} refusal`)
    .withRequest(
      operation === 'roots' ? 'GET' : 'POST',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/comments${operation === 'report' ? `/${commentItem.id}/report` : ''}`,
      setJsonContent({
        headers: communityHeaders(platform),
        ...('cursor' in failure ? { query: { cursor: failure.cursor } } : {}),
        ...(operation === 'create'
          ? { body: input }
          : operation === 'report'
            ? { body: { reason: 'spam' } }
            : {}),
      })
    )
    .willRespondWith(
      failure.status,
      setJsonContent({
        ...('retry' in failure ? { headers: { 'Retry-After': failure.retry } } : {}),
        body: {
          statusCode: failure.status,
          error: failure.error,
          message: failure.message,
        },
      })
    )
    .executeTest(async (server) => {
      const api = communityCommentsClient(client(server), platform)
      try {
        if (operation === 'roots')
          await api.roots(
            PUBLISHED_POST_ID,
            'cursor' in failure ? failure.cursor : undefined
          )
        else if (operation === 'create') await api.create(PUBLISHED_POST_ID, input)
        else await api.report(PUBLISHED_POST_ID, commentItem.id, 'spam')
        throw new Error('Expected refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(ResponseError)
        const response = (error as ResponseError).response
        expect(response.status).toBe(failure.status)
        expect(await response.json()).toEqual({
          statusCode: failure.status,
          error: failure.error,
          message: failure.message,
        })
        expect(response.headers.get('Retry-After')).toBe(
          'retry' in failure ? failure.retry : null
        )
      }
    })
}

export async function verifyCommunityCommentPage(
  pact: PactV4,
  client: CreateClient,
  platform: CommunityPlatform,
  operation: 'roots' | 'replies' | 'submissions'
) {
  const response =
    operation === 'submissions'
      ? {
          items: [{ ...commentSubmission, id: 'comment-6400-page-two' }],
          nextCursor: 'next-private-page',
        }
      : {
          ...commentPage,
          items: [
            {
              ...commentItem,
              id: 'comment-6400-page-two',
              ...(operation === 'replies' ? { parentId: commentItem.id } : {}),
            },
          ],
          nextCursor: 'next-public-page',
          hasNewer: true,
        }
  const path =
    operation === 'submissions'
      ? '/comment-submissions'
      : operation === 'replies'
        ? `/comments/${commentItem.id}/replies`
        : '/comments'
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A comment page follows a scoped cursor',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} paginated comment ${operation} request`)
    .withRequest(
      'GET',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}${path}`,
      setJsonContent({
        headers: communityHeaders(platform),
        query: { cursor: 'scoped-page-two' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { data: response } }))
    .executeTest(async (server) => {
      const api = communityCommentsClient(client(server), platform)
      const result =
        operation === 'roots'
          ? await api.roots(PUBLISHED_POST_ID, 'scoped-page-two')
          : operation === 'replies'
            ? await api.replies(PUBLISHED_POST_ID, commentItem.id, 'scoped-page-two')
            : await api.submissions(PUBLISHED_POST_ID, 'scoped-page-two')
      expect(result).toEqual(response)
    })
}
