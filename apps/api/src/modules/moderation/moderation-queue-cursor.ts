// Story 6.10 owner: the signed keyset cursor of the moderator queue in `apps/api/src/modules/moderation/moderation-queue-cursor.ts`.
// Same HMAC discipline as `community-cursor.ts`: a tampered, re-scoped or foreign cursor is a closed 400.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import type { ModerationCasesQuery } from '@couture/api-client/contracts/http'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service.js'

/** The filters a cursor is bound to. `limit` is not one: a client may change the page size. */
export type ModerationQueueFilters = Pick<
  ModerationCasesQuery,
  'source' | 'locale' | 'risk' | 'status' | 'sla'
>

/** The last sort tuple of a page. `dueKey` is the exact Postgres timestamp text, microseconds included. */
export interface ModerationQueuePosition {
  rank: number
  dueKey: string
  caseKey: string
}

const payloadSchema = z
  .object({
    version: z.literal(1),
    filters: z.string(),
    rank: z.number().int().min(0).max(2),
    dueKey: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
    caseKey: z.string().min(1).max(160),
  })
  .strict()

function filterKey(filters: ModerationQueueFilters): string {
  return JSON.stringify([
    filters.source ?? null,
    filters.locale ?? null,
    filters.risk ?? null,
    filters.status,
    filters.sla ?? null,
  ])
}

function sign(payload: string): string {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update(`moderation-queue-cursor:${payload}`)
    .digest('base64url')
}

export function encodeModerationQueueCursor(
  position: ModerationQueuePosition,
  filters: ModerationQueueFilters
): string {
  const payload = Buffer.from(
    JSON.stringify(
      payloadSchema.parse({ version: 1, filters: filterKey(filters), ...position })
    )
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'invalid_cursor',
    message: 'Invalid moderation cursor.',
  })
}

export function decodeModerationQueueCursor(
  cursor: string,
  filters: ModerationQueueFilters
): ModerationQueuePosition {
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
    if (data.filters !== filterKey(filters)) throw new Error('scope')
    return { rank: data.rank, dueKey: data.dueKey, caseKey: data.caseKey }
  } catch {
    throw invalidCursor()
  }
}
