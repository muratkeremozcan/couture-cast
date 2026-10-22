import { describe, expect, it } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  communityFeedModeSchema,
  generateHttpOpenApiDocument,
} from '../src/contracts/http'

describe('community HTTP contracts', () => {
  describe('published OpenAPI surface', () => {
    const document = generateHttpOpenApiDocument()

    it.each([
      ['get', '/api/v1/community/posts/{postId}/comments'],
      ['get', '/api/v1/community/posts/{postId}/comments/{commentId}/replies'],
      ['get', '/api/v1/community/posts/{postId}/comment-submissions'],
      ['post', '/api/v1/community/posts/{postId}/comments'],
      ['delete', '/api/v1/community/posts/{postId}/comments/{commentId}'],
      ['post', '/api/v1/community/posts/{postId}/comments/{commentId}/report'],
    ] as const)(
      'documents the reachable internal error on comment %s %s',
      (method, path) => {
        expect(document.paths?.[path]?.[method]?.responses?.['500']).toEqual({
          description: 'Internal server error occurred.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InternalServerErrorHttpError' },
            },
          },
        })
      }
    )

    it('6.1-CON-037 registers the single-post read path used by deep links and polling', () => {
      // Matrix row "Client race": a deep link outside the first page resolves
      // the visible target directly, and an owned post is polled until terminal.
      const postPath = document.paths?.['/api/v1/community/posts/{postId}']

      expect(postPath?.get).toBeDefined()
      expect(postPath?.get?.security).toEqual([{ bearerAuth: [] }])
      expect(postPath?.get?.responses?.['404']).toBeDefined()
      expect(
        (postPath?.get?.parameters ?? []).map(
          (parameter) => (parameter as { name?: string }).name
        )
      ).toEqual(['x-couture-reactions', 'postId', 'x-couture-platform'])
    })

    it('6.1-CON-038 registers the new community components', () => {
      const schemas = document.components?.schemas ?? {}

      for (const component of [
        'CommunityFeedMode',
        'CommunityBandUnresolvedReason',
        'CommunityExperimentVariant',
        'CommunityAuthorPostState',
        'CommunityFeedItem',
        'CommunityFeed',
        'CommunityPostResponse',
        'EmbeddedCommunityChallenge',
      ]) {
        expect(schemas, `component "${component}" must be registered`).toHaveProperty(
          component
        )
      }
    })

    it('6.1-CON-039 publishes the feed mode parameter enum from the single source', () => {
      // A hand-copied enum in the path definition is how a mode reaches the
      // schema and never reaches the published spec, so assert identity.
      const modeParameter = (
        document.paths?.['/api/v1/community/feed']?.get?.parameters ?? []
      ).find((parameter) => (parameter as { name?: string }).name === 'mode') as
        | { schema?: { enum?: string[]; default?: string } }
        | undefined

      expect(modeParameter?.schema?.enum).toEqual([...communityFeedModeSchema.options])
      expect(modeParameter?.schema?.default).toBe('auto')
    })

    it('6.1-CON-040 preserves nullable enum values without mutating the ClimateBand component', () => {
      expect(document.info.version).toBe('1.7.0')

      const standaloneBand = document.components?.schemas?.ClimateBand as {
        type?: string
        enum?: (string | null)[]
      }
      expect(standaloneBand).toBeDefined()
      expect(standaloneBand.enum).not.toContain(null)
      expect(standaloneBand.enum).toEqual([...CLIMATE_BANDS])

      const communityFeed = document.components?.schemas?.CommunityFeed as {
        properties?: {
          viewerBand?: { type?: string[]; enum?: (string | null)[] }
          bandUnresolvedReason?: { type?: string[]; enum?: (string | null)[] }
        }
      }
      expect(communityFeed).toBeDefined()
      expect(communityFeed.properties?.viewerBand?.enum).toContain(null)
      expect(communityFeed.properties?.bandUnresolvedReason?.enum).toContain(null)
    })

    // Every community operation, its exact documented response set, and its
    // security scheme, in one table.
    //
    // WHY AN EXACT SET AND NOT A SUBSET. On 2026-09-06 six response descriptions
    // were written into `contracts/http/community.ts`, lost from the working tree,
    // and neither the type checker nor any test noticed; they were found by a
    // person reading the regenerated JSON. Nothing could have caught it, because
    // every guard in this package proves that the contracts, the document and the
    // SDK AGREE, and agreement is preserved perfectly when a change is absent from
    // all three. A missing response description is indistinguishable from a
    // description nobody wanted. Only an assertion that names what must be present
    // can detect an absence, and at the time exactly one operation had one:
    // 6.1-CON-041 below, which is what caught the 400 added to the card-open path.
    //
    // The shape is lifted from `wardrobe-contract.spec.ts:265-284` and its two
    // siblings, which have driven this same table for three modules; community had
    // simply never adopted it.
    //
    // `security` is pinned for the same reason as the codes. An operation that
    // quietly loses `bearerAuth` is the same class of absence and considerably
    // worse, and it is the one nobody would catch by reading, because an
    // unauthenticated endpoint looks exactly like an authenticated one in the
    // registration source.
    const COMMUNITY_ROUTES = [
      {
        method: 'get',
        path: '/api/v1/community/feed',
        statuses: ['200', '400', '401', '500', '503'],
      },
      {
        method: 'get',
        path: '/api/v1/community/posts/{postId}',
        statuses: ['200', '400', '401', '404', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/posts/allocate',
        // No 429 here, on purpose. `CommunityService.allocatePost` enforces no
        // rolling cap; the only two throws of `CommunityRateLimitException` are
        // in `publishPost` and `reportPost`. The document carried a 429 for this
        // operation until 2026-09-06, when this table caught the mismatch and it
        // was removed as the wrong side: the daily cap counts PUBLISHED posts, a
        // draft allocated here may never be published, and gating allocation
        // would refuse upload sessions for drafts the cap was never meant to see.
        statuses: ['200', '400', '401', '403', '409', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/posts/publish',
        statuses: ['200', '400', '401', '403', '404', '409', '429', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/posts/{postId}/report',
        statuses: ['200', '400', '401', '403', '404', '409', '429', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/posts/{postId}/opened',
        statuses: ['200', '400', '401', '404', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/posts/{postId}/withdraw',
        statuses: ['200', '400', '401', '403', '404', '409', '500', '503'],
      },
      {
        method: 'post',
        path: '/api/v1/community/challenges',
        statuses: ['200', '400', '401', '403', '409', '500'],
      },
      {
        method: 'patch',
        path: '/api/v1/community/challenges/{id}',
        statuses: ['200', '400', '401', '403', '404', '409', '500'],
      },
    ] as const

    it('6.1-CON-042 publishes exactly the documented failures, and bearer auth, on every community operation', () => {
      // Guard the table itself: a row silently dropped from it would shrink the
      // surface under assertion without failing anything.
      expect(COMMUNITY_ROUTES).toHaveLength(9)

      for (const route of COMMUNITY_ROUTES) {
        const label = `${route.method.toUpperCase()} ${route.path}`
        const operation = document.paths?.[route.path]?.[route.method]

        expect(operation, `${label} is not registered at all`).toBeDefined()
        expect(
          operation?.security,
          `${label} does not require bearerAuth. An operation losing its security scheme reads identically to one that never had it.`
        ).toEqual([{ bearerAuth: [] }])

        const documented = Object.keys(operation?.responses ?? {}).sort()
        const expected: string[] = [...route.statuses]
        const added = documented.filter((code) => !expected.includes(code))
        const removed = expected.filter((code) => !documented.includes(code))

        expect(
          documented,
          `${label} response codes changed. Added: ${
            added.length > 0 ? added.join(', ') : 'none'
          }. Removed: ${
            removed.length > 0 ? removed.join(', ') : 'none'
          }. If the change is intended, update this route's statuses; if it is not, a documented response has gone missing.`
        ).toEqual(expected)
      }
    })

    it('6.1-CON-041 registers the card-open path with its parameters and failures', () => {
      const openedPath = document.paths?.['/api/v1/community/posts/{postId}/opened']

      expect(openedPath?.post).toBeDefined()
      expect(openedPath?.post?.security).toEqual([{ bearerAuth: [] }])
      expect(openedPath?.post?.requestBody).toBeDefined()
      expect(
        (openedPath?.post?.parameters ?? []).map(
          (parameter) => (parameter as { name?: string }).name
        )
      ).toEqual(['postId', 'x-couture-platform'])

      // The exact set, because the absent codes carry meaning: any viewer may
      // open any post they can see, so there is no 403 to document, and a post
      // they cannot see is a 404 rather than an authorization failure.
      //
      // 400 is present because the controller rejects a missing or invalid
      // `x-couture-platform` header and an invalid body before the service is
      // reached. It was undocumented until 2026-09-06; this path was one of only
      // three operations in the whole published spec that took a required header
      // and documented no 400.
      expect(Object.keys(openedPath?.post?.responses ?? {}).sort()).toEqual([
        '200',
        '400',
        '401',
        '404',
        '500',
        '503',
      ])
    })
  })
})
