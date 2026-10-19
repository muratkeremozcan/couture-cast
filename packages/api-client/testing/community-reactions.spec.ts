import { createApiClient } from '../src/client'
import { describe, expect, it } from 'vitest'
import {
  generateHttpOpenApiDocument,
  internalServerErrorHttpErrorSchema,
} from '../src/contracts/http'
import {
  communityFeedItemSchema,
  communityReactionFeedItemSchema,
  communityReactionSummarySchema,
  reconcileCommunityReactionItem,
  setCommunityReactionInputSchema,
} from '../src/contracts/http/community'

const summary = {
  counts: { applause: 1, love: 2, inspiration: 3 },
  total: 6,
  viewerReaction: 'love' as const,
  revision: 2,
  generation: 8,
}
const post = {
  id: 'synthetic-post',
  caption: null,
  altText: 'A wool coat.',
  climateBand: null,
  imageAccess: {
    url: 'https://storage.test/image.png',
    expiresAt: '2026-10-18T12:00:00.000Z',
  },
  publishedAt: '2026-10-18T11:00:00.000Z',
  createdAt: '2026-10-18T11:00:00.000Z',
  status: 'published' as const,
  challengeId: null,
  author: { displayName: 'Style Explorer 1234', isSelf: false },
}
describe('Story 6.3 reaction contracts', () => {
  it('documents reachable reaction errors and the rate-limit retry header', () => {
    const operation =
      generateHttpOpenApiDocument().paths?.['/api/v1/community/posts/{postId}/reaction']
        ?.put
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '429',
      '500',
      '503',
    ])
    for (const [status, schema] of [
      ['400', 'BadRequestHttpError'],
      ['401', 'UnauthorizedHttpError'],
      ['403', 'ForbiddenHttpError'],
      ['404', 'NotFoundHttpError'],
      ['429', 'TooManyRequestsHttpError'],
      ['500', 'InternalServerErrorHttpError'],
      ['503', 'ServiceUnavailableHttpError'],
    ] as const) {
      expect(operation?.responses?.[status]).toMatchObject({
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
        },
      })
    }
    expect(operation?.responses?.['429']).toMatchObject({
      headers: {
        'Retry-After': { schema: { type: 'integer', minimum: 1 } },
      },
    })
  })

  it('requires the established 500 envelope and keeps unexpected fields closed', () => {
    const unexpectedFailure = {
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    }
    expect(internalServerErrorHttpErrorSchema.parse(unexpectedFailure)).toEqual(
      unexpectedFailure
    )
    expect(
      internalServerErrorHttpErrorSchema.safeParse({
        statusCode: 500,
        message: 'Internal server error',
      }).success
    ).toBe(false)
    expect(
      internalServerErrorHttpErrorSchema.safeParse({
        ...unexpectedFailure,
        error: 'Database error',
      }).success
    ).toBe(false)
    expect(
      internalServerErrorHttpErrorSchema.safeParse({
        ...unexpectedFailure,
        details: 'private database details',
      }).success
    ).toBe(false)
  })

  it('preserves strict installed clients and accepts only the negotiated fields', () => {
    expect(communityFeedItemSchema.parse(post)).toEqual(post)
    expect(
      communityFeedItemSchema.safeParse({ ...post, reactions: summary }).success
    ).toBe(false)
    expect(
      communityReactionFeedItemSchema.parse({ ...post, reactions: summary }).reactions
    ).toEqual(summary)
    expect(
      communityReactionFeedItemSchema.parse({ ...post, status: 'flagged' }).reactions
    ).toBeUndefined()
  })
  it('requires a closed palette, UUID identity and a nonnegative integer base revision', () => {
    const intent = {
      selection: null,
      mutationId: '63100000-0000-4000-8000-000000000001',
      baseRevision: 0,
    }
    expect(setCommunityReactionInputSchema.parse(intent)).toEqual(intent)
    for (const invalid of [
      { ...intent, selection: 'laugh' },
      { ...intent, mutationId: 'unstable' },
      { ...intent, baseRevision: -1 },
      { ...intent, baseRevision: 1.5 },
      { ...intent, isSelf: true },
    ])
      expect(setCommunityReactionInputSchema.safeParse(invalid).success).toBe(false)
  })
  it('refuses incoherent aggregates and keeps newer confirmed state against stale HTTP reads', () => {
    expect(
      communityReactionSummarySchema.safeParse({ ...summary, total: 9 }).success
    ).toBe(false)
    const confirmed = { ...post, reactions: summary }
    const stale = { ...post, reactions: { ...summary, revision: 1, generation: 7 } }
    expect(reconcileCommunityReactionItem(stale, confirmed).reactions).toEqual(summary)
    expect(reconcileCommunityReactionItem(confirmed, stale)).toEqual(confirmed)
    expect(reconcileCommunityReactionItem(confirmed)).toEqual(confirmed)
  })
  it('negotiates capability without replacing authentication, platform or caller headers', async () => {
    const seen: Headers[] = []
    const client = createApiClient('https://api.synthetic.test', {
      accessToken: 'synthetic-token',
      communityReactions: true,
      headers: { 'x-synthetic-client': 'contract' },
      fetchApi: (_request, init) => {
        seen.push(new Headers(init?.headers))
        return Promise.resolve(
          new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      },
    })
    await client.apiV1CommunityFeedGet({ xCouturePlatform: 'web', mode: 'all' })
    expect(seen[0]?.get('x-couture-reactions')).toBe('1')
    expect(seen[0]?.get('x-couture-platform')).toBe('web')
    expect(seen[0]?.get('Authorization')).toBe('Bearer synthetic-token')
    expect(seen[0]?.get('x-synthetic-client')).toBe('contract')
  })
})
