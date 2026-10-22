// Story 6.5 owner: signed per-member/filter cursors with independent stream epochs.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { communityFeedModeSchema } from '@couture/api-client/contracts/http'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service.js'

const lane = z
  .object({ epoch: z.string().uuid(), position: z.string().regex(/^\d+$/) })
  .strict()
const schema = z
  .object({
    version: z.literal(1),
    member: z.string().min(1),
    mode: communityFeedModeSchema,
    band: z.string().nullable(),
    public: lane,
    private: lane,
  })
  .strict()
export type CommunityCursor = z.infer<typeof schema>
function sign(payload: string) {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update(`community-cursor:${payload}`)
    .digest('base64url')
}
export function encodeCommunityCursor(cursor: CommunityCursor): string {
  const payload = Buffer.from(JSON.stringify(schema.parse(cursor))).toString('base64url')
  return `${payload}.${sign(payload)}`
}
export function decodeCommunityCursor(
  cursor: string,
  member: string,
  mode: string
): CommunityCursor {
  try {
    const [payload, signature, extra] = cursor.split('.')
    if (!payload || !signature || extra) throw new Error('shape')
    const expected = Buffer.from(sign(payload))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error('signature')
    const data = schema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    if (data.member !== member || data.mode !== mode) throw new Error('scope')
    return data
  } catch {
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_cursor',
      message: 'Invalid community cursor.',
    })
  }
}
