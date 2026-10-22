// Story 6.6 owner: City Spotlight reads, snapshots and analytics.
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { LookbookPost } from '@prisma/client'
import {
  type CommunityPlatform,
  type CommunityReactionSpotlight as CommunitySpotlight,
  type CommunityReactionSpotlightItem as CommunitySpotlightItem,
  type CommunitySpotlightLevel,
  type OpenCommunityPostResponse,
} from '@couture/api-client/contracts/http'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { communitySubjectToken, postDedupeKey } from './community-analytics.js'
import {
  areaHash,
  availableAreaLevels,
  viewerAreaLabel,
  type SpotlightAreaComponents,
  type SpotlightAreaLevel,
  type SpotlightLocation,
} from './community-spotlight-area.js'
import {
  COMMUNITY_SPOTLIGHT_REDIS,
  CommunitySpotlightCache,
  type SpotlightCounters,
  type SpotlightRedis,
  type SpotlightSnapshot,
} from './community-spotlight-cache.js'
import {
  decodeSpotlightCursor,
  encodeSpotlightCursor,
  invalidSpotlightCursor,
} from './community-spotlight-cursor.js'
import {
  SPOTLIGHT_MIN_COHORT_AUTHORS,
  spotlightAsOf,
  spotlightSnapshotId,
} from './community-spotlight-ranking.js'
import {
  CommunitySpotlightRepository,
  type SpotlightCohorts,
} from './community-spotlight.repository.js'
import { CommunityService } from './community.service.js'

export interface CommunitySpotlightClock {
  now(): Date
}

export const COMMUNITY_SPOTLIGHT_CLOCK = Symbol('COMMUNITY_SPOTLIGHT_CLOCK')

/** Lets an integration suite own an isolated key space in a shared Redis. */
export const COMMUNITY_SPOTLIGHT_KEY_PREFIX_TOKEN = Symbol(
  'COMMUNITY_SPOTLIGHT_KEY_PREFIX'
)

/** The only production clock. Tests construct the service with their own. */
export const systemSpotlightClock: CommunitySpotlightClock = { now: () => new Date() }

/** The spotlight-view dedupe bucket, matching the feed view's ten seconds. */
const SPOTLIGHT_VIEW_BUCKET_MS = 10_000

export interface GetSpotlightParams {
  userId: string
  platform: CommunityPlatform
  cursor?: string
  limit: number
  reactions?: boolean
}

interface ViewerResolution {
  location: SpotlightLocation | null
  level: CommunitySpotlightLevel
}

type ResolvedViewer = ViewerResolution & {
  location: SpotlightLocation
  level: SpotlightAreaLevel
}

function resolvedLevel(
  area: SpotlightAreaComponents,
  cohorts: SpotlightCohorts
): CommunitySpotlightLevel {
  return (
    availableAreaLevels(area).find(
      (level) => cohorts[level] >= SPOTLIGHT_MIN_COHORT_AUTHORS
    ) ?? 'none'
  )
}

function isResolved(viewer: ViewerResolution): viewer is ResolvedViewer {
  return viewer.location !== null && viewer.level !== 'none'
}

export function spotlightViewDedupeKey(userId: string, now: number): string {
  return [
    'community_spotlight_viewed',
    communitySubjectToken(userId),
    String(Math.floor(now / SPOTLIGHT_VIEW_BUCKET_MS)),
  ].join(':')
}

@Injectable()
export class CommunitySpotlightService {
  private readonly logger = new Logger(CommunitySpotlightService.name)
  private readonly cache: CommunitySpotlightCache

  constructor(
    @Inject(CommunitySpotlightRepository)
    private readonly repository: CommunitySpotlightRepository,
    @Inject(CommunityService)
    private readonly community: CommunityService,
    @Inject(TelemetryService)
    private readonly telemetry: TelemetryService,
    @Inject(COMMUNITY_SPOTLIGHT_REDIS)
    redis: SpotlightRedis,
    @Inject(COMMUNITY_SPOTLIGHT_CLOCK)
    private readonly clock: CommunitySpotlightClock,
    @Inject(COMMUNITY_SPOTLIGHT_KEY_PREFIX_TOKEN)
    keyPrefix: string
  ) {
    this.cache = new CommunitySpotlightCache(redis, keyPrefix)
  }

  /** Read authorization, rollout, consent, age, erasure and canary rules match the feed. */
  getSpotlight(params: GetSpotlightParams): Promise<CommunitySpotlight> {
    return this.community.readAuthorized(params.userId, () => this.read(params))
  }

  private async read(params: GetSpotlightParams): Promise<CommunitySpotlight> {
    const asOf = spotlightAsOf(this.clock.now())
    // The level is resolved by a live cohort count BEFORE any pointer lookup,
    // so a level that fell below the cohort is never served from a pointer.
    const viewer = await this.resolveViewer(params.userId, asOf)
    if (params.cursor) return this.laterPage(params, params.cursor, viewer)

    if (!isResolved(viewer)) {
      await this.recordViewed(params, 'none', 0)
      return { level: 'none', label: null, items: [], nextCursor: null }
    }
    const { snapshot, visible } = await this.currentSnapshot(
      viewer.location.area,
      viewer.level,
      asOf
    )
    if (snapshot.level === 'none') {
      await this.recordViewed(params, 'none', 0)
      return { level: 'none', label: null, items: [], nextCursor: null }
    }
    const page = await this.page(params, snapshot, 0, visible)
    await this.recordViewed(params, snapshot.level, page.items.length)
    return {
      level: snapshot.level,
      label: viewerAreaLabel(viewer.location, snapshot.level),
      ...page,
    }
  }

  private async resolveViewer(userId: string, asOf: Date): Promise<ViewerResolution> {
    const location = await this.repository.findAreaLocation(userId)
    if (!location) return { location: null, level: 'none' }
    const cohorts = await this.repository.cohorts(location.area, asOf)
    return { location, level: resolvedLevel(location.area, cohorts) }
  }

  /**
   * The area's current snapshot, or a fresh build. A cached snapshot with any
   * entry that is no longer visible, or whose reaction generation moved, is
   * rebuilt before anything is served.
   */
  private async currentSnapshot(
    area: SpotlightAreaComponents,
    level: SpotlightAreaLevel,
    asOf: Date
  ): Promise<{
    snapshot: SpotlightSnapshot | { level: 'none' }
    visible?: Map<string, LookbookPost>
  }> {
    const hash = areaHash(area, level)
    let counters: SpotlightCounters | null = null
    let cached: SpotlightSnapshot | null = null
    try {
      counters = await this.cache.counters(hash)
      cached = await this.cache.current(level, hash, counters)
    } catch (error) {
      counters = null
      this.logRedisFallback(error)
    }
    if (cached) {
      const visible = await this.repository.visiblePosts(
        cached.entries.map((entry) => entry.id)
      )
      const fresh = cached.entries.every(
        (entry) => visible.get(entry.id)?.reaction_generation === entry.generation
      )
      if (fresh) return { snapshot: cached, visible }
    }

    const built = await this.build(area, level, asOf)
    if (built.level !== 'none' && built.level === level && counters) {
      try {
        await this.cache.publish(built, counters)
      } catch (error) {
        this.logRedisFallback(error)
      }
    }
    return { snapshot: built }
  }

  /**
   * Level selection and ranking in one repeatable-read snapshot. Starting at
   * the live-resolved level, a level whose cohort fell under the threshold
   * since that count widens to the next one, so the cohort always holds for
   * what is served.
   */
  private async build(
    area: SpotlightAreaComponents,
    from: SpotlightAreaLevel,
    asOf: Date
  ): Promise<SpotlightSnapshot | { level: 'none' }> {
    const levels = availableAreaLevels(area)
    return this.repository.repeatableRead(async (tx) => {
      for (const level of levels.slice(levels.indexOf(from))) {
        const ranking = await this.repository.rank(area, level, asOf, tx)
        if (ranking.cohort >= SPOTLIGHT_MIN_COHORT_AUTHORS)
          return this.snapshotOf(area, level, asOf, ranking.rows)
      }
      return { level: 'none' as const }
    })
  }

  private snapshotOf(
    area: SpotlightAreaComponents,
    level: SpotlightAreaLevel,
    asOf: Date,
    rows: readonly { id: string; generation: number }[]
  ): SpotlightSnapshot {
    const hash = areaHash(area, level)
    return {
      version: 1,
      id: spotlightSnapshotId({
        asOf,
        level,
        areaHash: hash,
        ids: rows.map((r) => r.id),
      }),
      asOf: asOf.toISOString(),
      level,
      areaHash: hash,
      entries: rows.map((row) => ({ id: row.id, generation: row.generation })),
    }
  }

  private async laterPage(
    params: GetSpotlightParams,
    rawCursor: string,
    viewer: ViewerResolution
  ): Promise<CommunitySpotlight> {
    const cursor = decodeSpotlightCursor(rawCursor, params.userId)
    if (
      !isResolved(viewer) ||
      cursor.level !== viewer.level ||
      cursor.areaHash !== areaHash(viewer.location.area, viewer.level)
    )
      throw invalidSpotlightCursor()

    const cursorAsOf = new Date(cursor.asOf)
    let snapshot: SpotlightSnapshot | null = null
    try {
      snapshot = await this.cache.snapshot(cursor.snapshotId)
    } catch (error) {
      this.logRedisFallback(error)
    }
    if (!snapshot) {
      // Redis is down or the snapshot expired: recompute at the cursor's own
      // as_of. Only an identical ranking may continue the scroll.
      const ranking = await this.repository.repeatableRead((tx) =>
        this.repository.rank(viewer.location.area, viewer.level, cursorAsOf, tx)
      )
      snapshot = this.snapshotOf(
        viewer.location.area,
        viewer.level,
        cursorAsOf,
        ranking.rows
      )
      if (snapshot.id !== cursor.snapshotId) throw invalidSpotlightCursor()
    }
    if (
      snapshot.level !== cursor.level ||
      snapshot.areaHash !== cursor.areaHash ||
      snapshot.asOf !== cursorAsOf.toISOString() ||
      cursor.index >= snapshot.entries.length
    )
      throw invalidSpotlightCursor()

    const cohort = await this.repository.cohortAt(
      viewer.location.area,
      snapshot.level,
      cursorAsOf
    )
    if (cohort < SPOTLIGHT_MIN_COHORT_AUTHORS) throw invalidSpotlightCursor()

    const page = await this.page(params, snapshot, cursor.index)
    return {
      level: snapshot.level,
      label: viewerAreaLabel(viewer.location, snapshot.level),
      ...page,
    }
  }

  /**
   * One page of ranked positions. Entries that fail live visibility are
   * skipped by index, so no entry repeats or shifts between pages.
   */
  private async page(
    params: GetSpotlightParams,
    snapshot: SpotlightSnapshot,
    index: number,
    knownVisible?: Map<string, LookbookPost>
  ): Promise<{ items: CommunitySpotlightItem[]; nextCursor: string | null }> {
    const slice = snapshot.entries.slice(index, index + params.limit)
    const visible =
      knownVisible ?? (await this.repository.visiblePosts(slice.map((entry) => entry.id)))
    const ranks = new Map(slice.map((entry, offset) => [entry.id, index + offset + 1]))
    const posts = slice
      .map((entry) => visible.get(entry.id))
      .filter((post): post is LookbookPost => post !== undefined)
    const projected = await this.community.projectFeedItems(
      posts,
      params.userId,
      params.reactions === true
    )
    const items = projected.map((item) => ({ ...item, rank: ranks.get(item.id)! }))
    const next = index + params.limit
    return {
      items,
      nextCursor:
        next < snapshot.entries.length
          ? encodeSpotlightCursor(params.userId, {
              level: snapshot.level,
              areaHash: snapshot.areaHash,
              asOf: snapshot.asOf,
              snapshotId: snapshot.id,
              index: next,
            })
          : null,
    }
  }

  /**
   * The spotlight branch of the opened endpoint. It records only
   * `community_spotlight_opened`, never `community_card_opened`.
   */
  async recordOpened(params: {
    userId: string
    postId: string
    platform: CommunityPlatform
    rank: number
  }): Promise<OpenCommunityPostResponse> {
    await this.community.assertPublicPostReadable(params.userId, params.postId)
    const viewer = await this.resolveViewer(
      params.userId,
      spotlightAsOf(this.clock.now())
    )
    await this.capture(params.userId, 'community_spotlight_opened', {
      platform: params.platform,
      dedupeKey: postDedupeKey(
        `${params.postId}:${communitySubjectToken(params.userId)}:spotlight`,
        'community_spotlight_opened'
      ),
      level: viewer.level,
      rank: params.rank,
    })
    return { tracked: true }
  }

  private recordViewed(
    params: GetSpotlightParams,
    level: CommunitySpotlightLevel,
    itemCount: number
  ): Promise<void> {
    return this.capture(params.userId, 'community_spotlight_viewed', {
      platform: params.platform,
      dedupeKey: spotlightViewDedupeKey(params.userId, this.clock.now().getTime()),
      level,
      itemCount,
    })
  }

  private async capture<T extends Parameters<TelemetryService['captureEvent']>[1]>(
    userId: string,
    eventType: T,
    properties: Parameters<TelemetryService['captureEvent']>[2] & object
  ): Promise<void> {
    try {
      await this.telemetry.captureEvent(userId, eventType, properties as never)
    } catch (error: unknown) {
      this.logger.warn({ error, event: eventType }, 'Community telemetry capture failed')
    }
  }

  private logRedisFallback(error: unknown): void {
    this.logger.warn(
      {
        event: 'community_spotlight_redis_unavailable',
        reason: error instanceof Error ? error.name : 'unknown',
      },
      'Spotlight read model unavailable; ranking directly from the database'
    )
  }
}
