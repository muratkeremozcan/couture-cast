// Story 6.1: Socket.io half of the CLIMATE_BANDS parity guarantee.
//
// Boundaries/Always: "one six-value CLIMATE_BANDS tuple with parity tests across
// Prisma, Zod, generated clients, and Socket.io." The Prisma half lives in
// packages/db. This file covers the Socket.io half and pins it to the same Zod
// contract the REST projection uses, because a realtime payload that drifts from
// the REST vocabulary is a client bug that only shows up under live traffic.
//
// Nothing exercised socket-events.ts before this suite: a repository-wide search
// for `socketEventSchemas` and `lookbookNewEventSchema` found only dist/,
// coverage/, a generator script, and the source module itself.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  alertWeatherEventSchema,
  lookbookNewEventSchema,
  ritualUpdateEventSchema,
  socketEventSchemas,
} from '../src/types/socket-events'
import { climateBandSchema, communityPostStatusSchema } from '../src/contracts/http'

const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny =>
  schema instanceof z.ZodOptional || schema instanceof z.ZodNullable
    ? unwrapSchema(schema.unwrap() as z.ZodTypeAny)
    : schema

const withoutKey = (
  source: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> => {
  const copy = { ...source }
  delete copy[key]
  return copy
}

const enumOptionsOf = (schema: z.ZodTypeAny): readonly string[] => {
  const inner = unwrapSchema(schema)
  expect(inner).toBeInstanceOf(z.ZodEnum)
  return (inner as z.ZodEnum<[string, ...string[]]>).options
}

const lookbookDataShape = lookbookNewEventSchema.shape.data.shape

const ENVELOPE = {
  version: '1',
  timestamp: '2026-09-05T12:00:00.000Z',
  userId: 'user-1',
}

const socketFixtures: Record<string, Record<string, unknown>> = {
  'lookbook:new': { postId: 'post-1', climateBand: 'temperate_dry' },
  'ritual:update': { ritualId: 'ritual-1', status: 'scheduled' },
  'alert:weather': {
    alertType: 'temperature',
    location: 'Milan',
    message: 'A cold snap arrives overnight.',
    severity: 'warning',
  },
}

describe('6.1 socket contract parity', () => {
  describe('climate band tuple parity', () => {
    it('6.1-CON-070 uses the same six-value CLIMATE_BANDS tuple, in the same order', () => {
      // Order is load-bearing, not incidental: the Prisma enum, the OpenAPI
      // component, and the UI filter order are all read positionally, so a
      // reordered tuple is a silent data-meaning change.
      expect(enumOptionsOf(lookbookDataShape.climateBand)).toEqual([...CLIMATE_BANDS])
      expect(enumOptionsOf(lookbookDataShape.climateBand)).toEqual(
        climateBandSchema.options
      )
      expect(CLIMATE_BANDS).toHaveLength(6)
    })

    it('6.1-CON-071 accepts every band on the wire and rejects anything outside the tuple', () => {
      for (const band of CLIMATE_BANDS) {
        expect(
          lookbookNewEventSchema.safeParse({
            ...ENVELOPE,
            data: { postId: 'post-1', climateBand: band },
          }).success,
          `socket lookbook event must accept band "${band}"`
        ).toBe(true)
      }

      for (const band of ['temperate', 'cold', 'arid', 'tropical', 'all', 'auto']) {
        expect(
          lookbookNewEventSchema.safeParse({
            ...ENVELOPE,
            data: { postId: 'post-1', climateBand: band },
          }).success,
          `socket lookbook event must reject "${band}"`
        ).toBe(false)
      }
    })

    it('6.1-CON-072 leaves the band optional so an unclassified post can still be announced', () => {
      // Classification returns null on fewer than three usable days, and the
      // matrix forbids inferring a band for those rows.
      expect(
        lookbookNewEventSchema.safeParse({ ...ENVELOPE, data: { postId: 'post-1' } })
          .success
      ).toBe(true)
      expect(
        lookbookNewEventSchema.safeParse({
          ...ENVELOPE,
          data: { postId: 'post-1', climateBand: null },
        }).success
      ).toBe(false)
    })
  })

  describe('event envelope', () => {
    it('6.1-CON-073 covers every registered socket channel with a fixture', () => {
      // A channel added without a fixture would silently skip the envelope
      // assertions below, so the registry itself is pinned.
      expect(Object.keys(socketEventSchemas).sort()).toEqual(
        Object.keys(socketFixtures).sort()
      )
      expect(socketEventSchemas['lookbook:new']).toBe(lookbookNewEventSchema)
      expect(socketEventSchemas['ritual:update']).toBe(ritualUpdateEventSchema)
      expect(socketEventSchemas['alert:weather']).toBe(alertWeatherEventSchema)
    })

    it.each(Object.keys(socketFixtures))(
      '6.1-CON-074 %s carries version and timestamp and rejects a payload missing either',
      (channel) => {
        const schema = socketEventSchemas[channel as keyof typeof socketEventSchemas]
        const data = socketFixtures[channel]

        expect(schema.safeParse({ ...ENVELOPE, data }).success).toBe(true)

        expect(
          schema.safeParse({ ...withoutKey(ENVELOPE, 'version'), data }).success,
          `${channel} must reject a payload with no version`
        ).toBe(false)

        expect(
          schema.safeParse({ ...withoutKey(ENVELOPE, 'timestamp'), data }).success,
          `${channel} must reject a payload with no timestamp`
        ).toBe(false)

        expect(
          schema.safeParse({ ...ENVELOPE, version: '', data }).success,
          `${channel} must reject an empty version`
        ).toBe(false)

        expect(
          schema.safeParse({ ...ENVELOPE, timestamp: '2026-09-05', data }).success,
          `${channel} must reject a timestamp that is not a full ISO instant`
        ).toBe(false)

        expect(
          schema.safeParse({ ...ENVELOPE, userId: '', data }).success,
          `${channel} must reject an empty userId`
        ).toBe(false)

        expect(
          schema.safeParse({ ...ENVELOPE }).success,
          `${channel} must reject a payload with no data`
        ).toBe(false)
      }
    )
  })

  describe('post status vocabulary', () => {
    it('6.1-CON-075 pins the lookbook payload shape so a status field cannot arrive unnoticed', () => {
      expect(Object.keys(lookbookDataShape).sort()).toEqual([
        'climateBand',
        'locale',
        'postId',
      ])
    })

    it('6.1-CON-078 keeps media URLs off the realtime channel', () => {
      // A URL broadcast over the socket has no expiry and no revocation path, so
      // a takedown cannot reach one already pushed to a client. The spec requires
      // expired URLs to be refetched and content hidden before its object is
      // deleted; neither is possible for a URL delivered this way. Clients
      // resolve the post through GET /api/v1/community/posts/{postId} instead.
      expect(Object.keys(lookbookDataShape)).not.toContain('mediaUrls')
      expect(
        lookbookNewEventSchema.safeParse({
          ...ENVELOPE,
          data: {
            postId: 'post-1',
            mediaUrls: ['https://cdn.example.com/a.jpg'],
          },
        }).success,
        'a payload carrying mediaUrls must be refused'
      ).toBe(false)
    })

    it('6.1-CON-076 requires any post status on the socket event to be the contract enum', () => {
      // The lookbook event carries no status today. If one is added, it must be
      // the same eight-member tuple the REST contract and the Prisma enum use,
      // in the same order, rather than a second realtime-only vocabulary.
      expect(communityPostStatusSchema.options).toEqual([
        'draft',
        'uploading',
        'pending_review',
        'published',
        'flagged',
        'review_failed',
        'withdrawn',
        'consent_suspended',
      ])

      const statusField = (lookbookDataShape as Record<string, z.ZodTypeAny | undefined>)
        .status

      if (statusField !== undefined) {
        expect(enumOptionsOf(statusField)).toEqual(communityPostStatusSchema.options)
      }
    })

    it('6.1-CON-077 keeps the ritual status vocabulary separate from the post lifecycle', () => {
      // `ritual:update` also has a `status`, and it is a scheduling state rather
      // than a moderation state. Asserting the two are disjoint stops a future
      // parity check from being pointed at the wrong field.
      const ritualStatuses = enumOptionsOf(
        ritualUpdateEventSchema.shape.data.shape.status
      )

      expect(ritualStatuses).toEqual(['scheduled', 'in-progress', 'completed'])
      expect(
        ritualStatuses.filter((status) =>
          (communityPostStatusSchema.options as readonly string[]).includes(status)
        )
      ).toEqual([])
    })
  })
})
