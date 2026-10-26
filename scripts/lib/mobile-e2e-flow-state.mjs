import { fold } from './weather-provider-double-data.mjs'

// The native harness owns an isolated UUID database, genuine identities and source fixtures.
// Its flow never uses the shared Expo Go member or reset hooks.
export const SHARE_CARD_EXPORT_FLOW = {
  path: 'maestro/share-card-export.yaml',
  runner: 'scripts/run-story68-native.mjs',
  stateOwner: 'scripts/e2e-share-card/prepare.mjs',
}

/**
 * Reset state owned by the synthetic member before each flow and watchdog retry.
 * A timed-out flow can have saved a reaction before stalling during relaunch.
 * It can also have turned affiliate suggestions off: commerce-affiliate.yaml
 * opts out, then relaunches, and a relaunch that stalls into the watchdog
 * (2026-10-23, CI job 120691261539) left its retry with no affiliate block to
 * find. Without a preference row the member has the default, suggestions on.
 */
export const resetMobileE2EFlowState = async (prisma, userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Mobile E2E flow reset requires a member ID')
  }
  await prisma.$transaction([
    prisma.wardrobeOnboardingState.deleteMany({ where: { user_id: userId } }),
    prisma.communityReactionOutbox.deleteMany({ where: { user_id: userId } }),
    prisma.communityReactionReceipt.deleteMany({ where: { user_id: userId } }),
    prisma.communityReaction.deleteMany({ where: { user_id: userId } }),
    prisma.commercePreference.deleteMany({ where: { user_id: userId } }),
  ])
}

/**
 * The saved location `setupMobileE2EIdentity` gives every synthetic member,
 * which every other flow's ritual and community band read.
 */
export const MOBILE_E2E_BASELINE_LOCATION = {
  label: 'Chicago',
  location_key: 'chicago-il',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'United States',
}

/**
 * The baseline as the API's create-location body, so identity setup saves the
 * same place `restoreMobileE2EBaselineLocation` puts back after a flow.
 */
export const mobileE2EBaselineLocationRequestBody = () => ({
  label: MOBILE_E2E_BASELINE_LOCATION.label,
  locationKey: MOBILE_E2E_BASELINE_LOCATION.location_key,
  latitude: MOBILE_E2E_BASELINE_LOCATION.latitude,
  longitude: MOBILE_E2E_BASELINE_LOCATION.longitude,
  timezone: MOBILE_E2E_BASELINE_LOCATION.timezone,
  city: MOBILE_E2E_BASELINE_LOCATION.city,
  region: MOBILE_E2E_BASELINE_LOCATION.region,
  country: MOBILE_E2E_BASELINE_LOCATION.country,
})

const requireMember = (userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Mobile E2E location state requires a member ID')
  }
}

/**
 * Story 1.2b: the location capture flow starts from a member with no saved
 * location and no snapshot for the sentinel place the run searches for.
 */
export const clearMobileE2ELocations = async (prisma, userId, sentinelKeySuffix) => {
  requireMember(userId)
  if (typeof sentinelKeySuffix !== 'string' || sentinelKeySuffix.length === 0) {
    throw new Error('Mobile E2E location reset requires the sentinel key suffix')
  }
  const snapshots = { location_key: { endsWith: sentinelKeySuffix } }
  await prisma.$transaction([
    prisma.savedLocation.deleteMany({ where: { user_id: userId } }),
    prisma.forecastSegment.deleteMany({ where: { weather_snapshot: snapshots } }),
    prisma.weatherSnapshot.deleteMany({ where: snapshots }),
  ])
}

/**
 * Puts the member back on the baseline location alone, as primary, so the
 * flows that run after the location capture flow read what they always read.
 */
export const restoreMobileE2EBaselineLocation = async (prisma, userId) => {
  requireMember(userId)
  await prisma.$transaction([
    prisma.savedLocation.deleteMany({ where: { user_id: userId } }),
    prisma.savedLocation.create({
      data: {
        ...MOBILE_E2E_BASELINE_LOCATION,
        user_id: userId,
        is_primary: true,
        sort_order: 0,
      },
    }),
  ])
}

export const LOCATION_CAPTURE_FLOW = 'maestro/location-capture.yaml'
export const COMMUNITY_COMMENTS_FLOW = 'maestro/community-comments.yaml'

/**
 * Story 6.4: the published root `community-comments.yaml` replies to with the
 * keyboard open, the longest reply context the composer has to keep on screen.
 * The flow used to type a root this long itself, and on the local Play AVD that
 * one `inputText` ran past Maestro 2.8's 120 s per-command deadline, so the
 * runner seeds it. ASCII words, spaces and digits keep the flow's regexes
 * literal-safe; 270 of the 280 units a comment allows. The runner hands it to
 * the flow as `COMMUNITY_COMMENTS_LONG_ROOT`.
 */
export const COMMUNITY_COMMENTS_LONG_ROOT =
  'Seeded long root of 270 units about a rainy day look with soft layers and ' +
  'warm woolen fabric that keeps the reply context long enough to wrap across ' +
  'many lines while the keyboard stays open so the composer and the send ' +
  'control must still fit on the phone screen above it'

/**
 * The post the flow opens, and a seeded adult from
 * `packages/db/prisma/seeds/users.ts` as the author: someone other than the
 * synthetic member, so the member sees it as another member's comment.
 */
export const COMMUNITY_COMMENTS_LONG_ROOT_TARGET = Object.freeze({
  postId: 'lookbook-5',
  authorId: 'guardian-2',
})

const requireLongRootTarget = (target) => {
  if (
    typeof target?.postId !== 'string' ||
    target.postId.length === 0 ||
    typeof target.authorId !== 'string' ||
    target.authorId.length === 0
  ) {
    throw new Error('The community comments long root requires a post and an author')
  }
}

/**
 * Takes the post's privacy guard, as the API does before it changes or removes
 * a published comment, then runs `cleanupComments` (`@couture/testing`'s
 * `cleanupCommunityCommentFixtures`) on every copy of the long root.
 */
const clearLongRoot = async (tx, cleanupComments, target) => {
  await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[],ARRAY[${target.postId}]::text[],true)`
  const rows = await tx.communityComment.findMany({
    where: {
      post_id: target.postId,
      user_id: target.authorId,
      parent_id: null,
      body: COMMUNITY_COMMENTS_LONG_ROOT,
    },
    select: { id: true },
  })
  await cleanupComments(
    tx,
    rows.map((row) => row.id)
  )
}

/**
 * Removes the long root. Idempotent: with nothing seeded it changes nothing.
 */
export const removeCommunityCommentsLongRoot = async (
  prisma,
  cleanupComments,
  target = COMMUNITY_COMMENTS_LONG_ROOT_TARGET
) => {
  requireLongRootTarget(target)
  await prisma.$transaction((tx) => clearLongRoot(tx, cleanupComments, target))
}

/**
 * Publishes exactly one long root, replacing any copy an earlier attempt left,
 * so a watchdog retry starts from the same thread as the first attempt. The
 * post's row lock and sequence increment are the ones the API's publication
 * takes, so the root gets the next publication sequence and the thread's
 * snapshot covers it.
 */
export const seedCommunityCommentsLongRoot = async (
  prisma,
  cleanupComments,
  target = COMMUNITY_COMMENTS_LONG_ROOT_TARGET
) => {
  requireLongRootTarget(target)
  await prisma.$transaction(async (tx) => {
    const [post] = await tx.$queryRaw`
      SELECT id FROM "LookbookPost" WHERE id = ${target.postId} FOR UPDATE`
    const author = await tx.user.findUnique({
      where: { id: target.authorId },
      select: { id: true },
    })
    if (!post || !author) {
      throw new Error(
        `The community comments long root needs post ${target.postId} and author ` +
          `${target.authorId}; run \`npm run db:seed\``
      )
    }
    await clearLongRoot(tx, cleanupComments, target)
    const { comment_publication_sequence: sequence } = await tx.lookbookPost.update({
      where: { id: target.postId },
      data: { comment_publication_sequence: { increment: 1 } },
      select: { comment_publication_sequence: true },
    })
    await tx.communityComment.create({
      data: {
        post_id: target.postId,
        user_id: target.authorId,
        parent_id: null,
        body: COMMUNITY_COMMENTS_LONG_ROOT,
        locale: 'en-US',
        platform: 'web',
        status: 'published',
        publication_sequence: sequence,
        published_at: new Date(),
      },
    })
  })
}

/**
 * State a flow needs beyond the shared per-flow reset, keyed by flow path.
 * `before` runs ahead of every attempt; `after` runs once the flow finishes,
 * pass or fail, so the flows after it start from the baseline the identity
 * setup created. A flow with no entry gets the shared reset alone.
 *
 * @param {{
 *   locationSentinelKeySuffix: string,
 *   cleanupComments: (tx: unknown, commentIds: string[]) => Promise<void>,
 *   longRootTarget?: { postId: string, authorId: string },
 * }} options
 */
export const mobileE2EFlowStateHooks = ({
  locationSentinelKeySuffix,
  cleanupComments,
  longRootTarget = COMMUNITY_COMMENTS_LONG_ROOT_TARGET,
}) => ({
  [LOCATION_CAPTURE_FLOW]: {
    before: (prisma, userId) =>
      clearMobileE2ELocations(prisma, userId, locationSentinelKeySuffix),
    after: (prisma, userId) => restoreMobileE2EBaselineLocation(prisma, userId),
  },
  [COMMUNITY_COMMENTS_FLOW]: {
    before: (prisma) =>
      seedCommunityCommentsLongRoot(prisma, cleanupComments, longRootTarget),
    after: (prisma) =>
      removeCommunityCommentsLongRoot(prisma, cleanupComments, longRootTarget),
  },
})

/**
 * Half the thousandth of a degree a saved-location key keeps, so a forecast
 * fetched for the saved candidate always matches and one fetched anywhere
 * else (swapped coordinates, the baseline, another place) never does.
 */
const SENTINEL_COORDINATE_TOLERANCE = 0.0005

const describeForecasts = (forecasts) =>
  forecasts.length === 0
    ? 'none'
    : forecasts.map((entry) => `${entry.latitude},${entry.longitude}`).join('; ')

/**
 * Story 1.2b: judges what the weather provider double saw while the location
 * capture flow ran. `before` is `/__double/stats` read just before the flow,
 * `requests` is `/__double/requests` read just after it, `query` is the run's
 * sentinel search and `place` the sentinel place it geocodes to. Returns the
 * named cause that fails the flow, or `undefined` when the double received
 * that search and a forecast call at that place's coordinates.
 *
 * @param {{
 *   before: { geocoding: number, forecast: number },
 *   requests: {
 *     geocoding: { seq: number, query: string }[],
 *     forecast: { seq: number, latitude: number | null, longitude: number | null }[],
 *   },
 *   query: string,
 *   place: { lat: number, lon: number },
 * }} observed
 * @returns {string | undefined}
 */
export const locationCaptureWeatherDoubleCause = ({ before, requests, query, place }) => {
  const searches = requests.geocoding.filter((entry) => entry.seq > before.geocoding)
  const forecasts = requests.forecast.filter((entry) => entry.seq > before.forecast)
  if (searches.length === 0 && forecasts.length === 0) {
    return 'weather provider double saw no geocoding or forecast call during the flow'
  }
  if (!searches.some((entry) => fold(entry.query) === fold(query))) {
    return `weather provider double never received the search "${query}"`
  }
  const atPlace = forecasts.some(
    (entry) =>
      Math.abs(entry.latitude - place.lat) <= SENTINEL_COORDINATE_TOLERANCE &&
      Math.abs(entry.longitude - place.lon) <= SENTINEL_COORDINATE_TOLERANCE
  )
  if (!atPlace) {
    return `no save-time forecast was fetched at the saved candidate's coordinates ${place.lat},${place.lon} (forecast calls during the flow: ${describeForecasts(forecasts)})`
  }
  return undefined
}
