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
  openCommunityPostInputSchema,
  publishCommunityPostInputSchema,
  safeDecodeCommunityFeedCursor,
  updateCommunityChallengeInputSchema,
} from '../src/contracts/http'

type CursorResult = ReturnType<typeof safeDecodeCommunityFeedCursor>

const failureMessageOf = (result: CursorResult): string | undefined =>
  result.success ? undefined : result.error

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
    it('6.1-CON-001 round-trips a publishedAt, id, mode, band cursor payload', () => {
      // Matrix row "Feed page": public rows page on `published_at,id`.
      const payload = {
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-12345',
        mode: 'temperate_dry',
        band: 'temperate_dry',
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
      // Matrix row "Feed page": the message must be indistinguishable from the
      // malformed-cursor message, so the failure a client handles is "restart
      // paging", singular. No expected band is passed anywhere below, so a
      // failure here can only have come from the mode.
      const autoCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-1',
        mode: 'auto',
        band: 'temperate_dry',
      })

      expect(safeDecodeCommunityFeedCursor(autoCursor, 'auto').success).toBe(true)

      const mismatch = safeDecodeCommunityFeedCursor(autoCursor, 'all')
      expect(mismatch.success).toBe(false)
      expect(failureMessageOf(mismatch)).toBe(COMMUNITY_CURSOR_INVALID_MESSAGE)
      expect(failureMessageOf(mismatch)).toBe(
        failureMessageOf(safeDecodeCommunityFeedCursor('!!!garbage!!!'))
      )

      const bandCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-2',
        mode: 'cold_dry',
        band: 'cold_dry',
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
          band: null,
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
          band: null,
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

    it('6.1-CON-005a rejects a cursor minted under a different band with that same message', () => {
      // The resolved band is not recoverable from the mode. Under `auto`, the
      // arm the beta experiment measures, it is derived per request from
      // weather only guaranteed fresh for 60 minutes, so it can move between
      // page one and page two while the mode reads `auto` throughout.
      const cursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-3',
        mode: 'auto',
        band: 'cold_dry',
      })

      expect(safeDecodeCommunityFeedCursor(cursor, 'auto', 'cold_dry').success).toBe(true)

      const mismatch = safeDecodeCommunityFeedCursor(cursor, 'auto', 'warm_wet')
      expect(mismatch.success).toBe(false)
      expect(failureMessageOf(mismatch)).toBe(COMMUNITY_CURSOR_INVALID_MESSAGE)
      expect(failureMessageOf(mismatch)).toBe(
        failureMessageOf(safeDecodeCommunityFeedCursor('!!!garbage!!!'))
      )
    })

    it('6.1-CON-005b keeps an unfiltered page distinguishable from a resolved band', () => {
      // `null` means the page was served with no band filter, which a reader
      // can legitimately page through. Conflating it with a resolved band goes
      // wrong both ways: a band that resolves on page two applies page one's
      // keyset to a narrower set and skips everything newer in it, and a band
      // that stops resolving turns page two into the unfiltered all-regions
      // feed under the same cursor, with no 400 because the mode still matches.
      const shared = { publishedAt: '2026-09-05T12:00:00.000Z', mode: 'auto' } as const
      const unfiltered = encodeCommunityFeedCursor({
        ...shared,
        id: 'post-4',
        band: null,
      })
      const filtered = encodeCommunityFeedCursor({
        ...shared,
        id: 'post-5',
        band: 'cold_dry',
      })

      expect(safeDecodeCommunityFeedCursor(unfiltered, 'auto', null).success).toBe(true)
      expect(safeDecodeCommunityFeedCursor(unfiltered, 'auto', 'cold_dry').success).toBe(
        false
      )
      expect(safeDecodeCommunityFeedCursor(filtered, 'auto', 'cold_dry').success).toBe(
        true
      )
      expect(safeDecodeCommunityFeedCursor(filtered, 'auto', null).success).toBe(false)
    })

    it('6.1-CON-005c skips the band check when no expected band is passed', () => {
      // `undefined` and `null` are different arguments: omitting the band opts
      // out of the check entirely, so a caller written before the band existed
      // still decodes its own cursors, while `null` is a real expectation that
      // the page was unfiltered.
      const cursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-6',
        mode: 'auto',
        band: 'cold_dry',
      })

      expect(safeDecodeCommunityFeedCursor(cursor).success).toBe(true)
      expect(safeDecodeCommunityFeedCursor(cursor, 'auto').success).toBe(true)
      expect(safeDecodeCommunityFeedCursor(cursor, 'auto', undefined).success).toBe(true)
    })

    it('6.1-CON-005d requires band and still refuses an unknown field beside it', () => {
      // Required and nullable, never optional: a cursor minted before the band
      // was carried would otherwise decode into a page whose filter is unknown,
      // which is the case the band exists to catch.
      const payload = {
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-7',
        mode: 'auto',
        band: null,
      }

      expect(communityFeedCursorPayloadSchema.safeParse(payload).success).toBe(true)
      expect(
        communityFeedCursorPayloadSchema.safeParse(withoutKey(payload, 'band')).success
      ).toBe(false)
      expect(
        communityFeedCursorPayloadSchema.safeParse({ ...payload, region: 'emea' }).success
      ).toBe(false)

      const withoutBand = Buffer.from(
        JSON.stringify(withoutKey(payload, 'band')),
        'utf8'
      ).toString('base64url')
      expect(() => decodeCommunityFeedCursor(withoutBand)).toThrow(
        COMMUNITY_CURSOR_INVALID_MESSAGE
      )
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
      // or signed URL, no moderation internals. The exact key set is a
      // deliberate gate: adding a field to the public projection has to be an
      // edit here, in front of a reviewer, before it reaches every viewer.
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
      // Boundaries/Always: authors stay pseudonymous. Publishing a real profile
      // name is Ask First, so the projection cannot carry one.
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
      // The omission case is what a direct API caller sends, so the contract has
      // to fail it before the service ever runs.
      expect(
        publishCommunityPostInputSchema.safeParse(
          withoutKey(publishInput, 'altTextConfirmed')
        ).success
      ).toBe(false)
    })
  })

  describe('card-open input', () => {
    it('6.1-CON-017a requires the served experiment variant and refuses anything else', () => {
      // The beta gate advances on a non-self card-open lift, so the arm the
      // viewer was actually served travels with the event; re-deriving it would
      // attribute the open to an assignment that changed after the feed read.
      // Whether the opener is the author stays server-decided, so a client
      // cannot send that judgement in beside it.
      expect(
        openCommunityPostInputSchema.parse({ experimentVariant: 'auto' })
          .experimentVariant
      ).toBe('auto')
      expect(
        openCommunityPostInputSchema.parse({ experimentVariant: 'all' }).experimentVariant
      ).toBe('all')

      expect(openCommunityPostInputSchema.safeParse({}).success).toBe(false)
      expect(
        openCommunityPostInputSchema.safeParse({ experimentVariant: 'temperate_dry' })
          .success
      ).toBe(false)
      expect(
        openCommunityPostInputSchema.safeParse({
          experimentVariant: 'auto',
          isSelf: false,
        }).success
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

    it('6.1-CON-019 accepts a Monday-anchored week west of UTC, at a non-UTC hour', () => {
      // The mirror case, west of UTC. Local midnight in Los Angeles is 07:00 in
      // UTC, so the instant is nowhere near a UTC day boundary and a check that
      // read the UTC clock would reject it.
      //
      // This case used to assert a Tuesday UTC weekday, using Monday 21:00
      // local. That is no longer a legal window: the rule now anchors on local
      // MIDNIGHT rather than on the local weekday alone, and in any zone behind
      // UTC local Monday midnight always reads Monday in UTC. Auckland in
      // 6.1-CON-018 is the case that still shifts the UTC weekday, backwards to
      // Sunday.
      const parsed = createCommunityChallengeInputSchema.parse(
        createInput({
          startsAt: '2026-09-07T07:00:00.000Z',
          endsAt: '2026-09-14T07:00:00.000Z',
          timeZone: 'America/Los_Angeles',
        })
      )

      expect(parsed.timeZone).toBe('America/Los_Angeles')
      expect(new Date('2026-09-07T07:00:00.000Z').getUTCHours()).toBe(7)
    })

    it('6.1-CON-019a rejects a Monday start that is not local midnight', () => {
      // The hole the previous rule left open. 2026-03-02T15:37Z is 10:37 on a
      // Monday morning in New York, and a check that reads the weekday and the
      // elapsed hours but never the time of day accepted it as a
      // "Monday seven-day window".
      const result = createCommunityChallengeInputSchema.safeParse(
        createInput({
          startsAt: '2026-03-02T15:37:00.000Z',
          endsAt: '2026-03-09T15:37:00.000Z',
          timeZone: 'America/New_York',
        })
      )

      expect(result.success).toBe(false)
      expect(
        result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
      ).toContain('startsAt')
    })

    describe('windows crossing a daylight-saving transition', () => {
      // A Monday-to-Monday week is seven LOCAL days, which is 167 absolute hours
      // across a spring transition and 169 across an autumn one. The rule this
      // replaced compared `end - start` against a hardcoded seven times 24 hours,
      // so in any DST-observing zone it rejected every legitimate window and
      // accepted only the ones landing an hour off the local Monday boundary,
      // which is the boundary `timeZone` is on the schema to pin.

      it('6.1-CON-019b accepts a 167-hour week across the spring transition', () => {
        const startsAt = '2026-03-02T05:00:00.000Z' // Mon 2026-03-02 00:00 EST
        const endsAt = '2026-03-09T04:00:00.000Z' // Mon 2026-03-09 00:00 EDT

        // Guard the fixture: if this ever equals 168 the case has stopped
        // crossing a transition and proves nothing the other tests do not.
        const elapsedHours =
          (Date.parse(endsAt) - Date.parse(startsAt)) / (60 * 60 * 1000)
        expect(elapsedHours).toBe(167)

        const parsed = createCommunityChallengeInputSchema.parse(
          createInput({ startsAt, endsAt, timeZone: 'America/New_York' })
        )

        expect(parsed.startsAt).toBe(startsAt)
        expect(parsed.endsAt).toBe(endsAt)
      })

      it('6.1-CON-019c rejects the 168-hour instant the old rule demanded', () => {
        // The load-bearing half. This is precisely the input the replaced rule
        // required across that transition, and it lands at 01:00 on the Monday
        // rather than at midnight. If this ever passes, the fixed-hour
        // arithmetic has come back.
        const startsAt = '2026-03-02T05:00:00.000Z'
        const endsAt = '2026-03-09T05:00:00.000Z' // Mon 2026-03-09 01:00 EDT

        expect((Date.parse(endsAt) - Date.parse(startsAt)) / (60 * 60 * 1000)).toBe(168)

        const result = createCommunityChallengeInputSchema.safeParse(
          createInput({ startsAt, endsAt, timeZone: 'America/New_York' })
        )

        expect(result.success).toBe(false)
        expect(
          result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
        ).toContain('endsAt')
      })

      it('6.1-CON-019d accepts a 169-hour week across the autumn transition', () => {
        const startsAt = '2026-10-26T04:00:00.000Z' // Mon 2026-10-26 00:00 EDT
        const endsAt = '2026-11-02T05:00:00.000Z' // Mon 2026-11-02 00:00 EST

        expect((Date.parse(endsAt) - Date.parse(startsAt)) / (60 * 60 * 1000)).toBe(169)

        const parsed = createCommunityChallengeInputSchema.parse(
          createInput({ startsAt, endsAt, timeZone: 'America/New_York' })
        )

        expect(parsed.startsAt).toBe(startsAt)
      })
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
      // failed result. If it throws, the caller gets a 500.
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
