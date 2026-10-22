// Story 6.6 owner: signed spotlight cursors bound to member, area and snapshot.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_SPOTLIGHT_MAX_RANK,
} from '@couture/api-client/contracts/http'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service.js'
import { communitySubjectToken } from './community-analytics.js'

const payloadSchema = z
  .object({
    version: z.literal(1),
    /** The member's HMAC subject token, so the cursor never carries a raw id. */
    member: z.string().min(1),
    level: z.enum(['city', 'region', 'country']),
    areaHash: z.string().regex(/^[0-9a-f]{64}$/),
    asOf: z.string().datetime(),
    snapshotId: z.string().regex(/^[0-9a-f]{64}$/),
    index: z
      .number()
      .int()
      .min(1)
      .max(COMMUNITY_SPOTLIGHT_MAX_RANK - 1),
  })
  .strict()

export type SpotlightCursor = Omit<z.infer<typeof payloadSchema>, 'version' | 'member'>

function sign(payload: string): string {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update(`community-spotlight-cursor:${payload}`)
    .digest('base64url')
}

export function invalidSpotlightCursor(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'invalid_cursor',
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  })
}

export function encodeSpotlightCursor(userId: string, cursor: SpotlightCursor): string {
  const payload = Buffer.from(
    JSON.stringify(
      payloadSchema.parse({
        version: 1,
        member: communitySubjectToken(userId),
        ...cursor,
      })
    )
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** A forged, malformed or foreign cursor is one stable `invalid_cursor` refusal. */
export function decodeSpotlightCursor(cursor: string, userId: string): SpotlightCursor {
  try {
    const [payload, signature, extra] = cursor.split('.')
    if (!payload || !signature || extra !== undefined) throw new Error('shape')
    const expected = Buffer.from(sign(payload))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error('signature')
    const data = payloadSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    )
    if (data.member !== communitySubjectToken(userId)) throw new Error('member')
    return {
      level: data.level,
      areaHash: data.areaHash,
      asOf: data.asOf,
      snapshotId: data.snapshotId,
      index: data.index,
    }
  } catch {
    throw invalidSpotlightCursor()
  }
}
