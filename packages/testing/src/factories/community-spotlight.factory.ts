// Story 6.6 owner: deterministic City Spotlight cohort fixtures.
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { CommunityReactionSelection } from '@couture/api-client/contracts/http'
import {
  canonicalCountryCode,
  canonicalSpotlightArea,
  spotlightCountryCodes,
} from '@couture/utils'
import { createLookbookPost, type LookbookPostFixture } from './community.factory.js'

type SpotlightPrismaClient = PrismaClient | Prisma.TransactionClient

/** The privacy cohort the API enforces; fixtures build exactly this many by default. */
export const SPOTLIGHT_FIXTURE_COHORT_AUTHORS = 5

/**
 * Posts in the shared seeded cohort: one past a six-post spotlight page, so
 * View more has something to append. Every spotlight post publishes inside the
 * last seven days and so leads the public feed; seven of them plus the feed
 * seed's five `lookbook-N` rows still fit the feed's first twelve-post page.
 */
export const SEEDED_SPOTLIGHT_COHORT_SIZE = 7

/**
 * One area as a member saved it. The API stores the canonical form: the
 * country as its ISO 3166-1 alpha-2 code, region and city folded (trimmed,
 * NFKD without combining marks, Turkish I folded, lowercased).
 */
export interface SpotlightAreaNames {
  country: string
  region: string
  city: string
}

export interface SpotlightAreaComponentsFixture {
  country: string
  region: string
  city: string
}

/** The canonical components the API stamps for these names. */
export function normalizeSpotlightAreaNames(
  names: SpotlightAreaNames
): SpotlightAreaComponentsFixture {
  const area = canonicalSpotlightArea(names)
  if (!area.country || !area.region || !area.city) {
    throw new Error(
      `Spotlight fixture area does not resolve to a full city tuple: ${JSON.stringify(names)}`
    )
  }
  return { country: area.country, region: area.region, city: area.city }
}

/**
 * Countries fixtures name explicitly. Unique areas never hand them out, so a
 * test's country-level cohort can never absorb another test's posts.
 */
const EXPLICIT_FIXTURE_COUNTRIES = new Set(['US', 'PT', 'BR', 'DE', 'TR', 'GB', 'GE'])
let uniqueAreaCount = 0
let fixtureCountries: readonly string[] | null = null

/**
 * English names of the countries unique areas hand out, each one resolving
 * back to its own code. Names keep privacy assertions meaningful: a two-letter
 * code would match inside unrelated serialized text.
 */
function uniqueFixtureCountries(): readonly string[] {
  if (fixtureCountries) return fixtureCountries
  const english = new Intl.DisplayNames(['en-US'], { type: 'region', fallback: 'none' })
  fixtureCountries = spotlightCountryCodes()
    .filter((code) => !EXPLICIT_FIXTURE_COUNTRIES.has(code))
    .map((code) => ({ code, name: english.of(code) }))
    .filter(({ code, name }) => name && canonicalCountryCode(name) === code)
    .map(({ name }) => name!)
  return fixtureCountries
}

/**
 * A unique area tuple for one test. Tests that mutate reactions own their own
 * area with its own cohort, so no two tests can move each other's ranking.
 * Countries are real, so each call in one process takes the next unused one.
 * Spotlight suites own one database per process, so no two areas in a
 * database ever share a country.
 */
export function uniqueSpotlightArea(namespace: string): SpotlightAreaNames {
  const token = createHash('sha256').update(namespace).digest('hex').slice(0, 10)
  const country = uniqueFixtureCountries()[uniqueAreaCount]
  if (!country) throw new Error('Every fixture country is already taken in this process')
  uniqueAreaCount += 1
  return {
    country,
    region: `Region ${token}`,
    city: `City ${token}`,
  }
}

/**
 * The shared, read-only cohort area that local, Playwright and Maestro seeds
 * publish. It is the Maestro harness member's own saved location
 * (`scripts/run-maestro.mjs`), so the native flow reaches the seeded cohort
 * without a second location; Playwright places its viewer here explicitly.
 */
export const SEEDED_SPOTLIGHT_AREA: SpotlightAreaNames = {
  country: 'United States',
  region: 'Illinois',
  city: 'Chicago',
}

export interface SpotlightReactionFixture {
  userId: string
  postId: string
  selection: CommunityReactionSelection
}

export interface SpotlightCohortFixture {
  area: SpotlightAreaComponentsFixture
  posts: LookbookPostFixture[]
  reactions: SpotlightReactionFixture[]
  /** Post ids in the order the API must rank them at `seedTime`. */
  expectedOrder: string[]
}

const SELECTIONS: readonly CommunityReactionSelection[] = [
  'applause',
  'love',
  'inspiration',
]

/**
 * Plans one post per author, published relative to one captured `seedTime`,
 * with a strictly decreasing number of non-author reactions so the expected
 * ranking is unambiguous. The feed seed's fixed epoch is never used here: the
 * spotlight window is the last seven days, so its posts must move with the seed.
 *
 * Post `i` is published `i + 1` hours before `seedTime` and is reacted to by
 * the `authors.length - 1 - i` authors after it, so fresher posts also carry
 * more reactions and both terms of the score agree.
 */
export function planSpotlightCohort(options: {
  namespace: string
  seedTime: Date
  area: SpotlightAreaNames
  authorIds: readonly string[]
  imageObjectPath?: string
  captionPrefix?: string
}): SpotlightCohortFixture {
  const area = normalizeSpotlightAreaNames(options.area)
  const authors = options.authorIds
  const posts = authors.map((authorId, index) => {
    const publishedAt = new Date(options.seedTime.getTime() - (index + 1) * 3_600_000)
    const id = `${options.namespace}-spotlight-${index + 1}`
    return createLookbookPost(
      {
        id,
        userId: authorId,
        status: 'published',
        caption: `${options.captionPrefix ?? 'Spotlight look'} ${index + 1}`,
        altText: `Spotlight look ${index + 1} styled for the season`,
        ...(options.imageObjectPath ? { imageObjectPath: options.imageObjectPath } : {}),
        locationKey: null,
        areaCountry: area.country,
        areaRegion: area.region,
        areaCity: area.city,
        publishedAt,
        submittedAt: publishedAt,
        altTextConfirmedAt: publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      },
      { now: publishedAt }
    )
  })
  const reactions: SpotlightReactionFixture[] = []
  posts.forEach((post, index) => {
    const reactorCount = Math.max(1, authors.length - 1 - index)
    for (let offset = 1; offset <= reactorCount; offset += 1) {
      const reactor = authors[(index + offset) % authors.length]!
      if (reactor === post.userId) continue
      reactions.push({
        userId: reactor,
        postId: post.id,
        selection: SELECTIONS[(index + offset) % SELECTIONS.length]!,
      })
    }
  })
  return { area, posts, reactions, expectedOrder: posts.map((post) => post.id) }
}

/** Saved-location data whose coarse components land in `area`. */
export function buildSpotlightSavedLocationCreateInput(
  userId: string,
  area: SpotlightAreaNames,
  overrides: { isPrimary?: boolean; locationKey?: string; label?: string } = {}
): Prisma.SavedLocationUncheckedCreateInput {
  const key =
    overrides.locationKey ??
    `spotlight-${createHash('sha256').update(`${userId}:${area.city}`).digest('hex').slice(0, 12)}`
  return {
    user_id: userId,
    label: overrides.label ?? area.city,
    location_key: key,
    latitude: 0,
    longitude: 0,
    timezone: 'UTC',
    city: area.city,
    region: area.region,
    country: area.country,
    is_primary: overrides.isPrimary ?? true,
  }
}

/**
 * Writes the planned posts and reactions. Authors must already exist. Posts are
 * upserted by id so a re-run seed moves them to the new seed time.
 */
export async function persistSpotlightCohort(
  prisma: SpotlightPrismaClient,
  cohort: SpotlightCohortFixture
): Promise<void> {
  for (const post of cohort.posts) {
    const data = {
      user_id: post.userId,
      status: post.status,
      caption: post.caption,
      alt_text: post.altText,
      image_object_path: post.imageObjectPath,
      image_content_type: post.imageContentType,
      image_byte_size: post.imageByteSize,
      alt_text_confirmed_at: post.altTextConfirmedAt,
      submitted_at: post.submittedAt,
      published_at: post.publishedAt,
      locale: post.locale,
      climate_band: post.climateBand,
      area_country: post.areaCountry,
      area_region: post.areaRegion,
      area_city: post.areaCity,
    }
    await prisma.lookbookPost.upsert({
      where: { id: post.id },
      create: { id: post.id, ...data },
      update: data,
    })
  }
  for (const reaction of cohort.reactions) {
    await prisma.communityReaction.upsert({
      where: { user_id_post_id: { user_id: reaction.userId, post_id: reaction.postId } },
      create: {
        user_id: reaction.userId,
        post_id: reaction.postId,
        selection: reaction.selection,
        revision: 1,
      },
      update: { selection: reaction.selection },
    })
  }
}
