import { describe, expect, it } from 'vitest'
import {
  communityPostAltTextSchema,
  communityPostCaptionSchema,
  createCommunityChallengeInputSchema,
  ianaTimeZoneSchema,
  openCommunityPostInputSchema,
  isSpotlightOpenInput,
  communitySpotlightQuerySchema,
  publishCommunityPostInputSchema,
  updateCommunityChallengeInputSchema,
} from '../src/contracts/http'
import { withoutKey } from './community-contract-support'

describe('community HTTP contracts', () => {
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
      expect(openCommunityPostInputSchema.parse({ experimentVariant: 'auto' })).toEqual({
        experimentVariant: 'auto',
      })
      expect(openCommunityPostInputSchema.parse({ experimentVariant: 'all' })).toEqual({
        experimentVariant: 'all',
      })

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

    it('6.6-CON-001 accepts the spotlight branch only with a rank from 1 to 60, a served level and no variant', () => {
      expect(
        openCommunityPostInputSchema.parse({
          surface: 'spotlight',
          rank: 1,
          level: 'city',
        })
      ).toEqual({
        surface: 'spotlight',
        rank: 1,
        level: 'city',
      })
      for (const level of ['city', 'region', 'country'])
        expect(
          openCommunityPostInputSchema.safeParse({
            surface: 'spotlight',
            rank: 60,
            level,
          }).success
        ).toBe(true)
      for (const rank of [0, 61, 1.5, '1'])
        expect(
          openCommunityPostInputSchema.safeParse({
            surface: 'spotlight',
            rank,
            level: 'city',
          }).success
        ).toBe(false)
      for (const body of [
        { surface: 'spotlight', rank: 3 },
        { surface: 'spotlight', rank: 3, level: 'none' },
        { surface: 'spotlight', rank: 3, level: 'planet' },
        { surface: 'spotlight', rank: 3, level: 'city', experimentVariant: 'auto' },
        { experimentVariant: 'auto', level: 'city' },
        { surface: 'feed', rank: 3, level: 'city' },
      ])
        expect(openCommunityPostInputSchema.safeParse(body).success).toBe(false)
      expect(
        isSpotlightOpenInput({ surface: 'spotlight', rank: 2, level: 'region' })
      ).toBe(true)
      expect(isSpotlightOpenInput({ experimentVariant: 'auto' })).toBe(false)
    })

    it('6.7-CON-002 accepts the Home teaser open with the same rank and level rules', () => {
      expect(
        openCommunityPostInputSchema.parse({
          surface: 'home_teaser',
          rank: 1,
          level: 'country',
        })
      ).toEqual({ surface: 'home_teaser', rank: 1, level: 'country' })
      expect(
        isSpotlightOpenInput({ surface: 'home_teaser', rank: 1, level: 'city' })
      ).toBe(true)
      for (const body of [
        { surface: 'home_teaser', rank: 0, level: 'city' },
        { surface: 'home_teaser', rank: 1, level: 'none' },
        { surface: 'home_teaser', rank: 1 },
        { surface: 'home_teaser', rank: 1, level: 'city', experimentVariant: 'auto' },
        { surface: 'home', rank: 1, level: 'city' },
        { surface: 'community', rank: 1, level: 'city' },
      ])
        expect(openCommunityPostInputSchema.safeParse(body).success).toBe(false)
    })

    it('6.7-CON-003 reads the spotlight surface with community as the default', () => {
      expect(communitySpotlightQuerySchema.parse({})).toEqual({
        limit: 6,
        surface: 'community',
      })
      expect(
        communitySpotlightQuerySchema.parse({ limit: '1', surface: 'home_teaser' })
      ).toEqual({ limit: 1, surface: 'home_teaser' })
      for (const surface of ['spotlight', 'HOME_TEASER', ''])
        expect(communitySpotlightQuerySchema.safeParse({ surface }).success).toBe(false)
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

    it('6.1-CON-022a rejects a two-week window whose both edges are local Monday midnight', () => {
      // Both edges pass the Monday-midnight check, so only the seven-local-day rule
      // can refuse this window, and it reports the problem on endsAt.
      const result = createCommunityChallengeInputSchema.safeParse(
        createInput({ endsAt: '2026-09-20T12:00:00.000Z' })
      )

      expect(result.success).toBe(false)
      expect(
        result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
      ).toEqual(['endsAt'])
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
})
