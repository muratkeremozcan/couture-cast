import { describe, expect, it } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_MODERATION_REASON_CATEGORY,
  climateBandSchema,
  communityAuthorPostStateSchema,
  communityFeedAuthorSchema,
  communityFeedCursorPayloadSchema,
  communityFeedItemSchema,
  communityFeedModeSchema,
  communityFeedQuerySchema,
  communityHeadersSchema,
  communityModerationReasonCategories,
  communityModerationReasonCategorySchema,
  decodeCommunityFeedCursor,
  encodeCommunityFeedCursor,
  safeDecodeCommunityFeedCursor,
} from '../src/contracts/http'
import { failureMessageOf, withoutKey } from './community-contract-support'

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
})

describe('6.2 moderation reason categories', () => {
  it('maps one stable code to the category its author sees', () => {
    expect(communityModerationReasonCategories('text_policy_match')).toEqual(['language'])
    expect(communityModerationReasonCategories('moderation_stalled')).toEqual([
      'incomplete',
    ])
  })

  it('reads a joined reason list in schema order without repeats', () => {
    expect(
      communityModerationReasonCategories(
        'screening_unavailable, text_policy_match, script_mixed, locale_unscreenable'
      )
    ).toEqual(['language', 'textUnreadable', 'incomplete'])
  })

  it('returns null for a moderator free-text reason, an inherited key, or nothing', () => {
    expect(communityModerationReasonCategories('Nudity detected by a moderator.')).toBe(
      null
    )
    expect(communityModerationReasonCategories('text_policy_match, spam')).toBe(null)
    expect(communityModerationReasonCategories('constructor')).toBe(null)
    expect(communityModerationReasonCategories('')).toBe(null)
    expect(communityModerationReasonCategories(null)).toBe(null)
  })

  it('maps every code to a schema member, and uses every member', () => {
    const used = new Set(Object.values(COMMUNITY_MODERATION_REASON_CATEGORY))
    expect([...used].sort()).toEqual(
      [...communityModerationReasonCategorySchema.options].sort()
    )
  })
})
