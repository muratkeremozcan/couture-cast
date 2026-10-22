// Story 6.6 owner: City Spotlight eligibility, cohort and ranking reads.
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient, type LookbookPost } from '@prisma/client'
import { COMMUNITY_CANARY_USER_ID_PREFIX } from './community-analytics.js'
import { PUBLICLY_VISIBLE_POST_WHERE } from './community.repository.js'
import {
  findSpotlightLocation,
  type SpotlightAreaComponents,
  type SpotlightAreaLevel,
  type SpotlightLocation,
} from './community-spotlight-area.js'
import {
  SPOTLIGHT_AGE_OFFSET_HOURS,
  SPOTLIGHT_SCORE_EXPONENT,
  SPOTLIGHT_SNAPSHOT_CAP,
  SPOTLIGHT_WINDOW_DAYS,
} from './community-spotlight-ranking.js'

export interface SpotlightRankedRow {
  id: string
  reactions: number
  score: number
  publishedAt: Date
  generation: number
}

export interface SpotlightRanking {
  cohort: number
  rows: SpotlightRankedRow[]
}

export type SpotlightCohorts = Record<SpotlightAreaLevel, number>

const CANARY_PATTERN = `${COMMUNITY_CANARY_USER_ID_PREFIX}%`

/**
 * The public visibility rule, inlined for raw SQL. It must stay equal to
 * `PUBLICLY_VISIBLE_POST_WHERE`; the integration suite pins the two together.
 */
function visibleSql(alias: string): Prisma.Sql {
  const p = Prisma.raw(alias)
  return Prisma.sql`${p}.status = 'published' AND ${p}.published_at IS NOT NULL
    AND ${p}.erasure_requested_at IS NULL AND ${p}.anonymized_at IS NULL
    AND ${p}.user_id NOT LIKE ${CANARY_PATTERN}`
}

function areaSql(area: SpotlightAreaComponents, level: SpotlightAreaLevel): Prisma.Sql {
  const country = Prisma.sql`p.area_country = ${area.country}`
  if (level === 'country') return country
  const region = Prisma.sql`${country} AND p.area_region = ${area.region}`
  if (level === 'region') return region
  return Prisma.sql`${region} AND p.area_city = ${area.city}`
}

/** `published_at` is a UTC `timestamp(3)`, so `as_of` is bound as UTC explicitly. */
function asOfSql(asOf: Date): Prisma.Sql {
  return Prisma.sql`(${asOf.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
}

function windowSql(asOf: Date): Prisma.Sql {
  return Prisma.sql`p.published_at > ${asOfSql(asOf)} - make_interval(days => ${SPOTLIGHT_WINDOW_DAYS}::int)
    AND p.published_at <= ${asOfSql(asOf)}`
}

/**
 * Eligible posts at one scope with their non-author reaction counts. A post
 * with only its author's reaction has no row here.
 */
function eligibleSql(
  area: SpotlightAreaComponents,
  level: SpotlightAreaLevel,
  asOf: Date
) {
  return Prisma.sql`
    SELECT p.id, p.user_id, p.published_at, p.reaction_generation,
      p.area_country, p.area_region, p.area_city,
      count(r.user_id)::int AS reactions
    FROM "LookbookPost" p
    JOIN "CommunityReaction" r
      ON r.post_id = p.id AND r.selection IS NOT NULL AND r.user_id <> p.user_id
    WHERE ${visibleSql('p')} AND p.area_country IS NOT NULL
      AND ${areaSql(area, level)} AND ${windowSql(asOf)}
    GROUP BY p.id`
}

@Injectable()
export class CommunitySpotlightRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * The first saved location in `findViewerLocations` order whose country is
   * usable, with its canonical hierarchical components. Null means `none`.
   */
  findAreaLocation(userId: string): Promise<SpotlightLocation | null> {
    return findSpotlightLocation(this.prisma, userId)
  }

  /**
   * Counts one spotlight read in the member's fixed one-minute window and
   * returns the window's count, in one atomic statement: concurrent reads
   * serialize on the member's row, so none is lost.
   */
  async recordRead(
    userId: string,
    now: Date
  ): Promise<{ reads: number; windowStart: Date }> {
    const [row] = await this.prisma.$queryRaw<{ reads: number; window_start: Date }[]>`
      INSERT INTO "CommunitySpotlightReadWindow" AS w (user_id, window_start, reads)
      VALUES (${userId}, date_trunc('minute', ${now.toISOString()}::timestamptz), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        reads = CASE WHEN w.window_start = EXCLUDED.window_start THEN w.reads + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start
      RETURNING reads, window_start`
    return { reads: row!.reads, windowStart: row!.window_start }
  }

  /** Distinct eligible authors at every level of this area, from one statement. */
  async cohorts(
    area: SpotlightAreaComponents,
    asOf: Date,
    client: Prisma.TransactionClient = this.prisma
  ): Promise<SpotlightCohorts> {
    if (!area.country) return { city: 0, region: 0, country: 0 }
    const [row] = await client.$queryRaw<
      { city: number; region: number; country: number }[]
    >(Prisma.sql`
      WITH eligible AS (${eligibleSql(area, 'country', asOf)})
      SELECT
        count(DISTINCT user_id) FILTER (
          WHERE area_region = ${area.region} AND area_city = ${area.city})::int AS city,
        count(DISTINCT user_id) FILTER (WHERE area_region = ${area.region})::int AS region,
        count(DISTINCT user_id)::int AS country
      FROM eligible
    `)
    return {
      city: area.city ? (row?.city ?? 0) : 0,
      region: area.region ? (row?.region ?? 0) : 0,
      country: row?.country ?? 0,
    }
  }

  /** Distinct eligible authors at exactly one level. */
  async cohortAt(
    area: SpotlightAreaComponents,
    level: SpotlightAreaLevel,
    asOf: Date
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ cohort: number }[]>(Prisma.sql`
      WITH eligible AS (${eligibleSql(area, level, asOf)})
      SELECT count(DISTINCT user_id)::int AS cohort FROM eligible
    `)
    return row?.cohort ?? 0
  }

  /**
   * The cohort and the ranked rows of one level from ONE statement, so the
   * privacy count and the ranking come from the same snapshot.
   */
  async rank(
    area: SpotlightAreaComponents,
    level: SpotlightAreaLevel,
    asOf: Date,
    client: Prisma.TransactionClient = this.prisma
  ): Promise<SpotlightRanking> {
    const [row] = await client.$queryRaw<{ cohort: number; rows: unknown }[]>(Prisma.sql`
      WITH eligible AS (${eligibleSql(area, level, asOf)}),
      scored AS (
        SELECT id, user_id, published_at, reaction_generation, reactions,
          reactions::numeric / power(
            extract(epoch FROM (${asOfSql(asOf)} - published_at)) / 3600
              + ${SPOTLIGHT_AGE_OFFSET_HOURS}::numeric,
            ${SPOTLIGHT_SCORE_EXPONENT}::numeric) AS score
        FROM eligible
      ),
      top AS (
        SELECT * FROM scored
        ORDER BY score DESC, reactions DESC, published_at DESC, id DESC
        LIMIT ${SPOTLIGHT_SNAPSHOT_CAP}
      )
      SELECT
        (SELECT count(DISTINCT user_id) FROM scored)::int AS cohort,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'reactions', reactions, 'score', score::float8,
            'publishedAt', to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'generation', reaction_generation)
            ORDER BY score DESC, reactions DESC, published_at DESC, id DESC)
          FROM top), '[]'::json) AS rows
    `)
    const rows = (Array.isArray(row?.rows) ? row.rows : []) as {
      id: string
      reactions: number
      score: number
      publishedAt: string
      generation: number
    }[]
    return {
      cohort: row?.cohort ?? 0,
      rows: rows.map((entry) => ({ ...entry, publishedAt: new Date(entry.publishedAt) })),
    }
  }

  /** Runs reads that must share one MVCC snapshot. */
  repeatableRead<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  }

  /** The posts among `ids` that are publicly visible right now, with generations. */
  async visiblePosts(ids: readonly string[]): Promise<Map<string, LookbookPost>> {
    if (ids.length === 0) return new Map()
    const posts = await this.prisma.lookbookPost.findMany({
      where: { AND: [PUBLICLY_VISIBLE_POST_WHERE, { id: { in: [...ids] } }] },
    })
    return new Map(posts.map((post) => [post.id, post]))
  }
}
