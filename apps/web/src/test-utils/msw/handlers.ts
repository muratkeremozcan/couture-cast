import { http, HttpResponse } from 'msw'
import type { z } from 'zod'
import {
  allocateCommunityPostResponseSchema,
  communityFeedResponseSchema,
  communityPostResponseSchema,
  publishCommunityPostResponseSchema,
  reportCommunityPostResponseSchema,
  withdrawCommunityPostResponseSchema,
  type CommunityFeedItem,
} from '@couture/api-client/contracts/http'

/**
 * Serves a fixture only after the contract's own response schema accepts it, so a
 * fixture that drifts from the contract fails the request loudly instead of
 * teaching a suite a wire shape the server never sends.
 */
function communityJson<Schema extends z.ZodTypeAny>(
  schema: Schema,
  payload: z.input<Schema>
) {
  return HttpResponse.json(schema.parse(payload) as unknown as Record<string, unknown>)
}

/** One published post, shared by the single-post read and the publish response. */
export const mockCommunityFeedItem: CommunityFeedItem = {
  id: 'mock-community-post-id',
  caption: 'Layered wool over a merino base for a damp commute.',
  altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
  climateBand: 'temperate_wet',
  imageAccess: {
    url: 'https://storage.local/community/mock-community-post-id.jpg',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
  publishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  status: 'published',
  challengeId: null,
  author: { displayName: 'Style Explorer 4F2A', isSelf: false },
}

export const handlers = [
  http.get('/api/v1/events/poll', () =>
    HttpResponse.json({
      events: [],
      nextSince: null,
    })
  ),
  /**
   * Story 6.1. `vitest.setup.ts` throws on any unhandled `/api/` request, so the
   * community routes need defaults even for suites that never assert on them:
   * the deep-link handler reads `GET /posts/{postId}` on every community link,
   * and the grid reads the feed on mount.
   *
   * The default feed is EMPTY. A suite that wants posts calls `useMswHandlers`
   * with its own fixture, which keeps the shared default from quietly deciding
   * what "no looks yet" means.
   */
  http.get('/api/v1/community/feed', () =>
    communityJson(communityFeedResponseSchema, {
      data: {
        items: [],
        authorStates: [],
        nextCursor: null,
        mode: 'auto',
        viewerBand: 'temperate_dry',
        bandResolved: true,
        bandUnresolvedReason: null,
        experimentVariant: 'auto',
        activeChallenge: null,
      },
    })
  ),
  /**
   * 404 by default, which is what an unknown deep-link target has to be: the
   * community branch of `processWebDeepLink` treats a post it cannot read as an
   * invalid link, and a permissive default would hide that path.
   */
  http.get('/api/v1/community/posts/:postId', ({ params }) =>
    params.postId === mockCommunityFeedItem.id
      ? communityJson(communityPostResponseSchema, { data: mockCommunityFeedItem })
      : HttpResponse.json(
          {
            statusCode: 404,
            message: 'Community post not found.',
            error: 'Not Found',
          },
          { status: 404 }
        )
  ),
  http.post('/api/v1/community/posts/allocate', () =>
    communityJson(allocateCommunityPostResponseSchema, {
      data: {
        postId: 'mock-allocated-post-id',
        uploadSessionId: 'mock-upload-session-id',
        uploadUrl: 'https://mock-upload.test/upload',
        uploadToken: 'mock-token',
        requiredHeaders: { 'content-type': 'image/jpeg' },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        altTextSuggestion: 'A layered outfit photographed against a plain wall.',
        altTextSuggestionLocale: 'en-US',
      },
    })
  ),
  http.put(
    'https://mock-upload.test/upload',
    () => new HttpResponse(null, { status: 200 })
  ),
  http.post('/api/v1/community/posts/publish', () =>
    communityJson(publishCommunityPostResponseSchema, {
      data: {
        ...mockCommunityFeedItem,
        id: 'mock-published-post-id',
        status: 'pending_review',
        publishedAt: null,
        author: { displayName: 'You', isSelf: true },
      },
    })
  ),
  http.post('/api/v1/community/posts/:postId/report', () =>
    communityJson(reportCommunityPostResponseSchema, { tracked: true })
  ),
  http.post('/api/v1/community/posts/:postId/withdraw', () =>
    communityJson(withdrawCommunityPostResponseSchema, { tracked: true })
  ),
]
