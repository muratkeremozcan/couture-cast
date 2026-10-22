// Story 6.6 owner: at-least-once spotlight invalidation from the public stream.
import type { PrismaClient } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
import { areaHashesOf, areaComponentsOf } from './community-spotlight-area.js'
import type { CommunitySpotlightCache } from './community-spotlight-cache.js'

export const SPOTLIGHT_INVALIDATOR_CURSOR_ID = 'public'
const PUBLIC_STREAM_ID = 'public'
const BATCH_SIZE = 200

export type SpotlightInvalidationOutcome =
  | { status: 'idle' }
  | { status: 'advanced'; processed: number; position: bigint }
  | { status: 'resumed_at_head'; position: bigint }
  | { status: 'deferred'; reason: 'redis_unavailable' | 'database_unavailable' }

type StreamEventRow = { sequence: bigint; kind: string; post_id: string | null }
type Plan = { epoch: boolean; areas: Set<string> }

/**
 * Consumes appended public `CommunityStreamEvent` rows by its own durable
 * cursor. Appended rows are committed, so everything it reads is already
 * durable. The cursor moves only after Redis has accepted the invalidation, so
 * a Redis outage replays the same events later: at least once, never lost.
 */
export class CommunitySpotlightInvalidator {
  private readonly logger = createBaseLogger().child({ feature: 'community-spotlight' })

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CommunitySpotlightCache
  ) {}

  /** Never throws: a failure is logged and leaves the cursor where it was. */
  async process(): Promise<SpotlightInvalidationOutcome> {
    let cursor: { epoch: string; position: bigint }
    let head: { epoch: string; sequence: bigint; retention_floor: bigint } | null
    let events: StreamEventRow[] = []
    try {
      head = await this.prisma.communityStreamHead.findUnique({
        where: { id: PUBLIC_STREAM_ID },
        select: { epoch: true, sequence: true, retention_floor: true },
      })
      if (!head) return { status: 'idle' }
      const stored = await this.prisma.communitySpotlightCursor.findUnique({
        where: { id: SPOTLIGHT_INVALIDATOR_CURSOR_ID },
      })
      if (
        !stored ||
        stored.epoch !== head.epoch ||
        stored.position < head.retention_floor
      ) {
        // Events this cursor never saw are gone (first start, stream reset, or
        // behind the retention floor), so every area is invalidated at once.
        return await this.resumeAtHead(head, stored)
      }
      cursor = { epoch: stored.epoch, position: stored.position }
      events = await this.prisma.communityStreamEvent.findMany({
        where: { stream_id: PUBLIC_STREAM_ID, sequence: { gt: cursor.position } },
        orderBy: { sequence: 'asc' },
        take: BATCH_SIZE,
        select: { sequence: true, kind: true, post_id: true },
      })
      if (events.length === 0) return { status: 'idle' }
    } catch {
      return this.defer('database_unavailable')
    }

    let plan: Plan
    try {
      plan = await this.plan(events)
    } catch {
      return this.defer('database_unavailable')
    }
    try {
      if (plan.epoch) await this.cache.bumpEpoch()
      await this.cache.bumpAreas([...plan.areas])
    } catch {
      return this.defer('redis_unavailable')
    }

    const last = events[events.length - 1]!.sequence
    try {
      await this.prisma.communitySpotlightCursor.updateMany({
        where: {
          id: SPOTLIGHT_INVALIDATOR_CURSOR_ID,
          epoch: cursor.epoch,
          position: cursor.position,
        },
        data: { position: last, updated_at: new Date() },
      })
    } catch {
      // Redis already accepted the bump; replaying it later is harmless.
      return this.defer('database_unavailable')
    }
    return { status: 'advanced', processed: events.length, position: last }
  }

  /**
   * An event whose post still has area components invalidates its city,
   * region and country. `resync`, a null post, a missing post or a post with
   * no components cannot be mapped to an area and invalidates everything.
   */
  private async plan(events: readonly StreamEventRow[]): Promise<Plan> {
    const plan: Plan = { epoch: false, areas: new Set() }
    const ids = [
      ...new Set(
        events
          .filter((event) => event.kind !== 'resync' && event.post_id)
          .map((event) => event.post_id!)
      ),
    ]
    const posts = ids.length
      ? await this.prisma.lookbookPost.findMany({
          where: { id: { in: ids } },
          select: { id: true, area_country: true, area_region: true, area_city: true },
        })
      : []
    const byId = new Map(posts.map((post) => [post.id, post]))
    for (const event of events) {
      const post =
        event.kind === 'resync' || !event.post_id ? undefined : byId.get(event.post_id)
      const hashes = post
        ? areaHashesOf(
            areaComponentsOf({
              country: post.area_country,
              region: post.area_region,
              city: post.area_city,
            })
          )
        : []
      if (hashes.length === 0) plan.epoch = true
      for (const hash of hashes) plan.areas.add(hash)
    }
    return plan
  }

  private async resumeAtHead(
    head: { epoch: string; sequence: bigint },
    stored: { epoch: string; position: bigint } | null
  ): Promise<SpotlightInvalidationOutcome> {
    try {
      await this.cache.bumpEpoch()
    } catch {
      return this.defer('redis_unavailable')
    }
    if (stored) {
      await this.prisma.communitySpotlightCursor.updateMany({
        where: {
          id: SPOTLIGHT_INVALIDATOR_CURSOR_ID,
          epoch: stored.epoch,
          position: stored.position,
        },
        data: { epoch: head.epoch, position: head.sequence, updated_at: new Date() },
      })
    } else {
      await this.prisma.communitySpotlightCursor.upsert({
        where: { id: SPOTLIGHT_INVALIDATOR_CURSOR_ID },
        create: {
          id: SPOTLIGHT_INVALIDATOR_CURSOR_ID,
          epoch: head.epoch,
          position: head.sequence,
        },
        update: {},
      })
    }
    this.logger.info(
      {
        event: 'community_spotlight_invalidator_resumed',
        reason: stored ? 'gap' : 'start',
      },
      'Spotlight invalidator resumed at the stream head'
    )
    return { status: 'resumed_at_head', position: head.sequence }
  }

  private defer(
    reason: 'redis_unavailable' | 'database_unavailable'
  ): SpotlightInvalidationOutcome {
    this.logger.warn(
      { event: 'community_spotlight_invalidation_deferred', reason },
      'Spotlight invalidation deferred; the cursor did not advance'
    )
    return { status: 'deferred', reason }
  }
}
