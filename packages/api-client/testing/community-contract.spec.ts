// Story 6.1: Community HTTP contracts specification and tests.
//
// These suites exist to prove the Boundaries the story states at the tier where
// they are cheapest to prove: the public projection carries no private field,
// the cursor is bound to the filter mode it was minted under, alt text cannot be
// published unconfirmed, and a challenge window is Monday-anchored in its own
// zone rather than in UTC.
import { describe, expect, it } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  climateBandSchema,
  communityAuthorPostStateSchema,
  communityFeedAuthorSchema,
  communityFeedCursorPayloadSchema,
  communityFeedItemSchema,
  communityFeedModeSchema,
  communityFeedQuerySchema,
  communityHeadersSchema,
  communityPostAltTextSchema,
  communityPostCaptionSchema,
  createCommunityChallengeInputSchema,
  decodeCommunityFeedCursor,
  encodeCommunityFeedCursor,
  generateHttpOpenApiDocument,
  ianaTimeZoneSchema,
  publishCommunityPostInputSchema,
  safeDecodeCommunityFeedCursor,
  updateCommunityChallengeInputSchema,
} from '../src/contracts/http'

type CursorResult = ReturnType<typeof safeDecodeCommunityFeedCursor>

/** Narrows the safe-decode result so two failures can be compared by message. */
const failureMessageOf = (result: CursorResult): string | undefined =>
  result.success ? undefined : result.error

/** Copies a fixture without one key, to exercise a required field's absence. */
const withoutKey = (
  source: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> => {
  const copy = { ...source }
  delete copy[key]
  return copy
}

describe('community HTTP contracts', () => {
  describe('cursor serialization and decoding', () => {
    it('6.1-CON-001 round-trips a publishedAt, id, mode cursor payload', () => {
      // Matrix row "Feed page": public rows page on `published_at,id`, and the
      // cursor embeds the filter mode it was minted under.
      const payload = {
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-12345',
        mode: 'temperate_dry',
      } as const

      const encoded = encodeCommunityFeedCursor(payload)
      expect(typeof encoded).toBe('string')
      expect(encoded).not.toContain(' ')

      expect(decodeCommunityFeedCursor(encoded)).toEqual(payload)
      expect(safeDecodeCommunityFeedCursor(encoded)).toEqual({
        success: true,
        data: payload,
      })
    })

    it('6.1-CON-002 rejects a corrupt cursor with the stable invalid-cursor message', () => {
      expect(() => decodeCommunityFeedCursor('!!!not-valid-base64url!!!')).toThrow(
        COMMUNITY_CURSOR_INVALID_MESSAGE
      )
      // Well-formed base64url of `{}`: decodes, then fails the payload schema.
      expect(() => decodeCommunityFeedCursor('e30=')).toThrow(
        COMMUNITY_CURSOR_INVALID_MESSAGE
      )

      expect(safeDecodeCommunityFeedCursor('corrupt-cursor')).toEqual({
        success: false,
        error: COMMUNITY_CURSOR_INVALID_MESSAGE,
      })
    })

    it('6.1-CON-003 rejects a cursor minted under a different mode with that same message', () => {
      // Matrix row "Feed page": a changed filter discards the cursor. The
      // message must be indistinguishable from the malformed-cursor message so
      // the failure mode a client handles is "restart paging", singular.
      const autoCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-1',
        mode: 'auto',
      })

      expect(safeDecodeCommunityFeedCursor(autoCursor, 'auto').success).toBe(true)

      const mismatch = safeDecodeCommunityFeedCursor(autoCursor, 'all')
      expect(mismatch.success).toBe(false)
      expect(failureMessageOf(mismatch)).toBe(COMMUNITY_CURSOR_INVALID_MESSAGE)
      expect(failureMessageOf(mismatch)).toBe(
        failureMessageOf(safeDecodeCommunityFeedCursor('!!!garbage!!!'))
      )

      // A band-pinned cursor is equally bound: `cold_dry` is not `warm_dry`.
      const bandCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-2',
        mode: 'cold_dry',
      })
      expect(safeDecodeCommunityFeedCursor(bandCursor, 'warm_dry').success).toBe(false)
      expect(safeDecodeCommunityFeedCursor(bandCursor, 'cold_dry').success).toBe(true)
    })

    it('6.1-CON-004 refuses unknown fields in the cursor payload', () => {
      const encoded = Buffer.from(
        JSON.stringify({
          publishedAt: '2026-09-05T12:00:00.000Z',
          id: 'post-123',
          mode: 'auto',
          extraProp: 'forbidden',
        }),
        'utf8'
      ).toString('base64url')

      expect(() => decodeCommunityFeedCursor(encoded)).toThrow(
        COMMUNITY_CURSOR_INVALID_MESSAGE
      )
      expect(safeDecodeCommunityFeedCursor(encoded).success).toBe(false)
      expect(
        communityFeedCursorPayloadSchema.safeParse({
          publishedAt: '2026-09-05T12:00:00.000Z',
          id: 'post-123',
          mode: 'auto',
          extraProp: 'forbidden',
        }).success
      ).toBe(false)
    })

    it('6.1-CON-005 refuses a legacy createdAt,id cursor', () => {
      // Ordering on creation time inserts a newly published post behind a
      // cursor the reader already consumed. A cursor from the old shape must
      // not silently keep working.
      const legacy = Buffer.from(
        JSON.stringify({ createdAt: '2026-09-05T12:00:00.000Z', id: 'post-9' }),
        'utf8'
      ).toString('base64url')

      expect(() => decodeCommunityFeedCursor(legacy)).toThrow(
        COMMUNITY_CURSOR_INVALID_MESSAGE
      )
      expect(safeDecodeCommunityFeedCursor(legacy).success).toBe(false)
    })
  })

  describe('feed query parameters', () => {
    it('6.1-CON-006 defaults mode to auto', () => {
      expect(communityFeedQuerySchema.parse({}).mode).toBe('auto')
    })

    it('6.1-CON-007 accepts every one of the eight feed modes', () => {
      expect(communityFeedModeSchema.options).toEqual(['auto', 'all', ...CLIMATE_BANDS])
      expect(communityFeedModeSchema.options).toHaveLength(8)

      for (const mode of communityFeedModeSchema.options) {
        expect(communityFeedQuerySchema.parse({ mode }).mode).toBe(mode)
      }
    })

    it('6.1-CON-008 rejects an unknown mode and the removed climateBand parameter', () => {
      // Matrix row "Band resolution": an unknown override is a 400.
      expect(() => communityFeedQuerySchema.parse({ mode: 'polar' })).toThrow()
      expect(() => communityFeedQuerySchema.parse({ mode: 'temperate' })).toThrow()
      // `climateBand` was replaced by `mode`; the query object is `.strict()`,
      // so a client still sending the old parameter fails loudly.
      expect(() => communityFeedQuerySchema.parse({ climateBand: 'cold_dry' })).toThrow()
    })

    it('6.1-CON-009 accepts a limit within [1, 30], defaults to 12, and coerces strings', () => {
      expect(communityFeedQuerySchema.parse({}).limit).toBe(12)
      expect(communityFeedQuerySchema.parse({ limit: 1 }).limit).toBe(1)
      expect(communityFeedQuerySchema.parse({ limit: 30 }).limit).toBe(30)
      expect(communityFeedQuerySchema.parse({ limit: '25' }).limit).toBe(25)
    })

    it('6.1-CON-010 rejects limit values outside [1, 30]', () => {
      expect(() => communityFeedQuerySchema.parse({ limit: 0 })).toThrow()
      expect(() => communityFeedQuerySchema.parse({ limit: 31 })).toThrow()
      expect(() => communityFeedQuerySchema.parse({ limit: -5 })).toThrow()
    })
  })

  describe('public feed projection', () => {
    const publicItem = {
      id: 'post-1',
      caption: 'Crisp autumn layering.',
      altText: 'A wool trench over a striped knit.',
      climateBand: 'temperate_dry',
      imageAccess: {
        url: 'https://cdn.couturecast.test/o/opaque-object-key',
        expiresAt: '2026-09-05T13:00:00.000Z',
      },
      publishedAt: '2026-09-05T12:00:00.000Z',
      createdAt: '2026-09-05T11:00:00.000Z',
      status: 'published',
      challengeId: null,
      author: { displayName: 'Aurora Fox', isSelf: false },
    }

    it('6.1-CON-011 exposes exactly the allowlisted public keys and nothing else', () => {
      // Boundaries/Never: no cross-user table row, no user id in an object path
      // or signed URL, no moderation internals. Asserted as an exact key set so
      // adding a field to the public projection has to be a deliberate edit
      // here, not an accident that ships to every viewer.
      expect(Object.keys(communityFeedItemSchema.shape).sort()).toEqual([
        'altText',
        'author',
        'caption',
        'challengeId',
        'climateBand',
        'createdAt',
        'id',
        'imageAccess',
        'publishedAt',
        'status',
      ])

      expect(communityFeedItemSchema.parse(publicItem)).toEqual(publicItem)
    })

    it('6.1-CON-012 refuses an author user id, a storage object path, and moderation internals', () => {
      const forbiddenFields = {
        authorUserId: 'user-123',
        userId: 'user-123',
        authorId: 'user-123',
        objectPath: 'community/user-123/post-1.jpg',
        storageKey: 'community/user-123/post-1.jpg',
        moderationReason: 'nudity',
        moderationEngineResults: 'engine-a:pass',
        reportCount: 3,
        // Removed by this story: the signed URL lives only in `imageAccess`,
        // and a second copy is a second thing to expire.
        imageUrl: 'https://cdn.couturecast.test/o/opaque-object-key',
      }

      for (const [field, value] of Object.entries(forbiddenFields)) {
        expect(
          communityFeedItemSchema.safeParse({ ...publicItem, [field]: value }).success,
          `public feed item must reject "${field}"`
        ).toBe(false)
      }
    })

    it('6.1-CON-013 keeps the author pseudonymous with a display name and a self flag', () => {
      // Boundaries/Always: keep authors pseudonymous. Ask First covers
      // publishing real profile names, so the projection cannot carry one.
      expect(Object.keys(communityFeedAuthorSchema.shape).sort()).toEqual([
        'displayName',
        'isSelf',
      ])
      expect(
        communityFeedAuthorSchema.safeParse({
          displayName: 'Aurora Fox',
          isSelf: false,
          userId: 'user-123',
        }).success
      ).toBe(false)
    })

    it('6.1-CON-014 gives authorStates moderationReason and a shape distinct from the public item', () => {
      // Matrix row "Moderation": the author sees their own recovery state. That
      // reason is owner-only, which is exactly why the two projections must not
      // be the same object.
      const authorStateKeys = Object.keys(communityAuthorPostStateSchema.shape).sort()

      expect(authorStateKeys).toEqual([
        'altText',
        'caption',
        'challengeId',
        'climateBand',
        'createdAt',
        'id',
        'imageAccess',
        'moderationReason',
        'publishedAt',
        'status',
      ])
      expect(authorStateKeys).not.toEqual(
        Object.keys(communityFeedItemSchema.shape).sort()
      )
      expect(authorStateKeys).toContain('moderationReason')
      expect(Object.keys(communityFeedItemSchema.shape)).not.toContain('moderationReason')
      // The author section has no `author` block: every row in it is the caller's.
      expect(authorStateKeys).not.toContain('author')

      expect(
        communityAuthorPostStateSchema.parse({
          id: 'post-2',
          caption: null,
          altText: 'A quilted parka on a snowy street.',
          climateBand: 'cold_wet',
          imageAccess: null,
          createdAt: '2026-09-05T11:00:00.000Z',
          publishedAt: null,
          status: 'flagged',
          challengeId: null,
          moderationReason: 'failed_image_screen',
        }).moderationReason
      ).toBe('failed_image_screen')
    })
  })

  describe('publish input', () => {
    const publishInput = {
      postId: 'post-1',
      uploadSessionId: 'upload-1',
      altText: 'A wool trench over a striped knit.',
      altTextConfirmed: true as const,
      locale: 'en-US' as const,
    }

    it('6.1-CON-015 accepts a publish that confirms alt text, with an optional challenge', () => {
      expect(publishCommunityPostInputSchema.parse(publishInput).altTextConfirmed).toBe(
        true
      )
      expect(
        publishCommunityPostInputSchema.parse({
          ...publishInput,
          caption: 'Crisp autumn layering.',
          challengeId: 'challenge-1',
        }).challengeId
      ).toBe('challenge-1')
    })

    it('6.1-CON-016 rejects a publish whose alt text is explicitly unconfirmed', () => {
      // Boundaries/Never: publish unconfirmed alt text. A boolean field would
      // let `false` reach a service check; the literal makes it unrepresentable.
      expect(
        publishCommunityPostInputSchema.safeParse({
          ...publishInput,
          altTextConfirmed: false,
        }).success
      ).toBe(false)
    })

    it('6.1-CON-017 rejects a publish that omits altTextConfirmed entirely', () => {
      // The omission case is the one a direct API caller reaches for, so it has
      // to fail at the contract rather than only in the service.
      expect(
        publishCommunityPostInputSchema.safeParse(
          withoutKey(publishInput, 'altTextConfirmed')
        ).success
      ).toBe(false)
    })
  })

  describe('challenge window validation', () => {
    // Matrix row "Challenge": a Monday seven-day IANA-zone window. Every
    // instant below is chosen so the UTC weekday and the local weekday differ,
    // so a UTC-arithmetic implementation cannot pass these.
    const copy = {
      'en-US': { title: 'Layer up', body: 'Show your best cold-weather layering.' },
    }

    /** Monday 00:00 in Pacific/Auckland, which is Sunday 12:00 in UTC. */
    const AUCKLAND_MONDAY_START = '2026-09-06T12:00:00.000Z'
    const AUCKLAND_MONDAY_END = '2026-09-13T12:00:00.000Z'

    const INVALID_TIME_ZONES = ['Mars/Olympus_Mons', 'Pacific/Aukland', 'UTC+12', '']

    const createInput = (overrides: Record<string, unknown> = {}) => ({
      slug: 'spring-layers',
      startsAt: AUCKLAND_MONDAY_START,
      endsAt: AUCKLAND_MONDAY_END,
      timeZone: 'Pacific/Auckland',
      copy,
      ...overrides,
    })

    it('6.1-CON-018 accepts a Monday-anchored week whose UTC weekday is Sunday', () => {
      const parsed = createCommunityChallengeInputSchema.parse(createInput())

      expect(parsed.startsAt).toBe(AUCKLAND_MONDAY_START)
      expect(parsed.endsAt).toBe(AUCKLAND_MONDAY_END)
      expect(parsed.isActive).toBe(true)
      // Guard the fixture itself: if these ever agree, the test stopped proving
      // zone handling and started proving UTC arithmetic.
      expect(new Date(AUCKLAND_MONDAY_START).getUTCDay()).toBe(0)
    })

    it('6.1-CON-019 accepts a Monday-anchored week whose UTC weekday is Tuesday', () => {
      // The mirror case, west of UTC: Monday 21:00 in Los Angeles is Tuesday
      // 04:00 in UTC.
      const parsed = createCommunityChallengeInputSchema.parse(
        createInput({
          startsAt: '2026-09-08T04:00:00.000Z',
          endsAt: '2026-09-15T04:00:00.000Z',
          timeZone: 'America/Los_Angeles',
        })
      )

      expect(parsed.timeZone).toBe('America/Los_Angeles')
      expect(new Date('2026-09-08T04:00:00.000Z').getUTCDay()).toBe(2)
    })

    it('6.1-CON-020 rejects a Tuesday start in the zone even when UTC reads Monday', () => {
      // 2026-09-07T12:00Z is Monday in UTC and Tuesday in Auckland. This is the
      // case a UTC-only check would wave through.
      expect(new Date('2026-09-07T12:00:00.000Z').getUTCDay()).toBe(1)

      const result = createCommunityChallengeInputSchema.safeParse(
        createInput({
          startsAt: '2026-09-07T12:00:00.000Z',
          endsAt: '2026-09-14T12:00:00.000Z',
        })
      )

      expect(result.success).toBe(false)
      expect(
        result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
      ).toContain('startsAt')
    })

    it('6.1-CON-021 rejects a six-day span', () => {
      expect(
        createCommunityChallengeInputSchema.safeParse(
          createInput({ endsAt: '2026-09-12T12:00:00.000Z' })
        ).success
      ).toBe(false)
    })

    it('6.1-CON-022 rejects an eight-day span', () => {
      expect(
        createCommunityChallengeInputSchema.safeParse(
          createInput({ endsAt: '2026-09-14T12:00:00.000Z' })
        ).success
      ).toBe(false)
    })

    it('6.1-CON-023 rejects an end that precedes the start', () => {
      expect(
        createCommunityChallengeInputSchema.safeParse(
          createInput({
            startsAt: AUCKLAND_MONDAY_END,
            endsAt: AUCKLAND_MONDAY_START,
          })
        ).success
      ).toBe(false)
    })

    it('6.1-CON-023a rejects a non-IANA zone at the field level', () => {
      for (const zone of INVALID_TIME_ZONES) {
        expect(
          ianaTimeZoneSchema.safeParse(zone).success,
          `time zone "${zone}" must be rejected`
        ).toBe(false)
      }
    })

    it('6.1-CON-023b rejects a non-IANA zone through the create and update schemas', () => {
      // Matrix row "Challenge": an invalid window is a 400. A validation pipe
      // reaches this through safeParse, so the composed schema has to return a
      // failed result rather than raise, or the caller gets a 500 instead.
      for (const zone of INVALID_TIME_ZONES) {
        expect(
          createCommunityChallengeInputSchema.safeParse(createInput({ timeZone: zone }))
            .success,
          `create must reject time zone "${zone}" without throwing`
        ).toBe(false)

        expect(
          updateCommunityChallengeInputSchema.safeParse({
            startsAt: AUCKLAND_MONDAY_START,
            endsAt: AUCKLAND_MONDAY_END,
            timeZone: zone,
          }).success,
          `update must reject time zone "${zone}" without throwing`
        ).toBe(false)
      }
    })

    it('6.1-CON-024 rejects an empty PATCH body', () => {
      expect(updateCommunityChallengeInputSchema.safeParse({}).success).toBe(false)
    })

    it('6.1-CON-025 rejects a PATCH that moves only one edge of the window', () => {
      // The Monday and seven-day rules cannot be evaluated from a fragment, so
      // a window change has to restate startsAt, endsAt and timeZone together.
      for (const partial of [
        { startsAt: AUCKLAND_MONDAY_START },
        { endsAt: AUCKLAND_MONDAY_END },
        { timeZone: 'Pacific/Auckland' },
        { startsAt: AUCKLAND_MONDAY_START, endsAt: AUCKLAND_MONDAY_END },
        { startsAt: AUCKLAND_MONDAY_START, timeZone: 'Pacific/Auckland' },
      ]) {
        expect(
          updateCommunityChallengeInputSchema.safeParse(partial).success,
          `partial window ${JSON.stringify(partial)} must be rejected`
        ).toBe(false)
      }
    })

    it('6.1-CON-026 accepts a PATCH that restates the whole window, or leaves it alone', () => {
      expect(
        updateCommunityChallengeInputSchema.safeParse({
          startsAt: AUCKLAND_MONDAY_START,
          endsAt: AUCKLAND_MONDAY_END,
          timeZone: 'Pacific/Auckland',
        }).success
      ).toBe(true)

      expect(updateCommunityChallengeInputSchema.parse({ isActive: false })).toEqual({
        isActive: false,
      })
    })

    it('6.1-CON-027 rejects a restated window that is no longer Monday-anchored', () => {
      expect(
        updateCommunityChallengeInputSchema.safeParse({
          startsAt: '2026-09-07T12:00:00.000Z',
          endsAt: '2026-09-14T12:00:00.000Z',
          timeZone: 'Pacific/Auckland',
        }).success
      ).toBe(false)
    })
  })

  describe('caption and alt-text bounds', () => {
    it('6.1-CON-028 accepts a caption up to 280 characters without URLs or emails', () => {
      const cleanCaption = 'Crisp autumn morning layer with trench and scarf.'
      expect(communityPostCaptionSchema.parse(cleanCaption)).toBe(cleanCaption)
      expect(communityPostCaptionSchema.parse('')).toBe('')
      expect(communityPostCaptionSchema.parse('a'.repeat(280))).toHaveLength(280)
    })

    it('6.1-CON-029 rejects captions exceeding 280 characters', () => {
      expect(() => communityPostCaptionSchema.parse('a'.repeat(281))).toThrow()
    })

    it('6.1-CON-030 rejects captions containing web URLs or links', () => {
      expect(() =>
        communityPostCaptionSchema.parse(
          'Check out my profile at http://couturecast.test'
        )
      ).toThrow(/URL/)
      expect(() =>
        communityPostCaptionSchema.parse('Look at this https://instagram.com/mylook')
      ).toThrow(/URL/)
      expect(() =>
        communityPostCaptionSchema.parse('Visit www.example.com for more')
      ).toThrow(/URL/)
      expect(() =>
        communityPostCaptionSchema.parse('Follow me on myblog.co for daily fits')
      ).toThrow(/URL/)
    })

    it('6.1-CON-031 rejects captions containing email addresses', () => {
      expect(() =>
        communityPostCaptionSchema.parse(
          'Reach me at designer@couturecast.test for collab'
        )
      ).toThrow(/email/)
    })

    it('6.1-CON-032 enforces alt-text length between 1 and 200 characters', () => {
      expect(communityPostAltTextSchema.parse('A wool trench coat.')).toBe(
        'A wool trench coat.'
      )
      expect(() => communityPostAltTextSchema.parse('')).toThrow()
      expect(communityPostAltTextSchema.parse('x'.repeat(200))).toHaveLength(200)
      expect(() => communityPostAltTextSchema.parse('x'.repeat(201))).toThrow()
    })
  })

  describe('climate band enum vocabulary', () => {
    it('6.1-CON-033 accepts exactly the six canonical climate bands, in tuple order', () => {
      // Boundaries/Always: one six-value CLIMATE_BANDS tuple with parity tests.
      expect(climateBandSchema.options).toEqual([...CLIMATE_BANDS])
      expect(climateBandSchema.options).toHaveLength(6)

      for (const band of CLIMATE_BANDS) {
        expect(climateBandSchema.parse(band)).toBe(band)
      }
    })

    it('6.1-CON-034 rejects legacy or invalid band strings', () => {
      expect(() => climateBandSchema.parse('temperate')).toThrow()
      expect(() => climateBandSchema.parse('cold')).toThrow()
      expect(() => climateBandSchema.parse('arid')).toThrow()
      expect(() => climateBandSchema.parse('tropical')).toThrow()
    })
  })

  describe('platform header validation', () => {
    it('6.1-CON-035 accepts web and mobile platforms', () => {
      expect(
        communityHeadersSchema.parse({ 'x-couture-platform': 'web' })[
          'x-couture-platform'
        ]
      ).toBe('web')
      expect(
        communityHeadersSchema.parse({ 'x-couture-platform': 'mobile' })[
          'x-couture-platform'
        ]
      ).toBe('mobile')
    })

    it('6.1-CON-036 rejects a missing platform header or an undeclared platform', () => {
      expect(() => communityHeadersSchema.parse({})).toThrow()
      expect(() =>
        communityHeadersSchema.parse({ 'x-couture-platform': 'desktop' })
      ).toThrow()
      expect(() =>
        communityHeadersSchema.parse({ 'x-couture-platform': 'tablet' })
      ).toThrow()
    })
  })

  describe('published OpenAPI surface', () => {
    const document = generateHttpOpenApiDocument()

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
      ).toEqual(['postId', 'x-couture-platform'])
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
      expect(document.info.version).toBe('1.6.0')

      // Standalone ClimateBand component must NOT contain null.
      const standaloneBand = document.components?.schemas?.ClimateBand as {
        type?: string
        enum?: (string | null)[]
      }
      expect(standaloneBand).toBeDefined()
      expect(standaloneBand.enum).not.toContain(null)
      expect(standaloneBand.enum).toEqual([...CLIMATE_BANDS])

      // Nullable publication in CommunityFeed.viewerBand must contain null.
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
  })
})
