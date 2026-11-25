// Story 6.3 device-reset owner: reset a member's reaction state between flow attempts in `scripts/lib/mobile-e2e-flow-state.mjs` and `scripts/lib/mobile-e2e-flow-retry.mjs`
import { createHash } from 'node:crypto'
import { fold, reversePlaces } from './weather-provider-double-data.mjs'

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
 * Production follow-up (2026-11-19): Use my location on mobile. The flow sets the device to
 * USE_MY_LOCATION_DEVICE. Read at full accuracy it rounds to USE_MY_LOCATION_ROUNDED; the OS may
 * answer a reduced-accuracy fix near it instead, which still resolves to the double's Chicago.
 */
export const USE_MY_LOCATION_FLOW = 'maestro/location-use-my-location.yaml'
export const USE_MY_LOCATION_DEVICE = Object.freeze({
  latitude: 41.871234,
  longitude: -87.641234,
})
export const USE_MY_LOCATION_ROUNDED = Object.freeze({
  latitude: 41.87,
  longitude: -87.64,
})

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
 * Story 7.6 (7.6-MAE-001): `maestro/garment-delete-flow.yaml` deletes one garment for real. The
 * shared seeded garments (top, bottom, outerwear, shoes) belong to the capsule and tag-edit
 * flows, so this flow gets its own ready dress before each attempt, a category no other flow
 * seeds or selects, under an ID reserved for this fixture (`garmentDeleteFixtureId`), so the hooks
 * never touch another dress; the after hook removes whatever is left of it. The row has no stored
 * photo: the closet lists it with `imageAccess: null` (signing failure is logged, not raised) and
 * the purge's storage removal of an absent key is a no-op.
 * Learning path Step 64: Garment delete.
 * See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
 */
export const GARMENT_DELETE_FLOW = 'maestro/garment-delete-flow.yaml'
export const GARMENT_DELETE_TARGET_CATEGORY = 'dress'

const requireGarmentDeleteMember = (userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('The garment delete flow state requires a member ID')
  }
}

/**
 * The fixture's reserved ID: a UUID derived from the member, so the hooks name exactly this row
 * and never another dress the member may own. Seed, settle check and cleanup all use it.
 */
export const garmentDeleteFixtureId = (userId) => {
  requireGarmentDeleteMember(userId)
  const hex = createHash('sha256')
    .update(`garment-delete-fixture:${userId}`)
    .digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** The fixture's object key: the only key a purge of this photo-less ready row enqueues. */
const garmentDeleteFixturePath = (userId, garmentId) =>
  `wardrobe/${userId}/${garmentId}.png`

export const removeGarmentDeleteTarget = async (prisma, userId) => {
  const garmentId = garmentDeleteFixtureId(userId)
  await prisma.$transaction([
    // A purge records the fixture's object key in the deletion outbox; the drain must not chase
    // it. Only that exact key, so no other member's job is touched.
    prisma.wardrobeObjectDeletion.deleteMany({
      where: { object_path: garmentDeleteFixturePath(userId, garmentId) },
    }),
    prisma.garmentItem.deleteMany({ where: { id: garmentId, user_id: userId } }),
  ])
}

/**
 * Story 7.6 (7.6-MAE-001): the proof that the flow's last Delete reached the server. The flow
 * ends once its Undo window closes, while the DELETE may still be in flight, so it cannot relaunch
 * the app to read the closet back: the force stop could cancel that request. This waits, after the
 * flow and before the fixture is removed, until the fixture is no longer active: the API purged
 * it, or flipped it to `deletion_pending` for the sweep. A fixture still active at the deadline
 * fails the flow with that cause; whether the request never arrived or the API refused it is left
 * to the API and device logs.
 */
export const waitForGarmentDeleteTargetGone = async (
  prisma,
  userId,
  {
    timeoutMs = 15_000,
    intervalMs = 250,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) => {
  const garmentId = garmentDeleteFixtureId(userId)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const fixture = await prisma.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
      select: { retention_status: true },
    })
    if (!fixture) {
      throw new Error(
        `garment_delete_fixture_missing: the seeded dress ${garmentId} is gone; something other than the flow removed it`
      )
    }
    if (fixture.retention_status !== 'active') return
    if (Date.now() >= deadline) {
      throw new Error(
        `garment_delete_not_committed: the seeded dress ${garmentId} was still active at the ${timeoutMs} ms deadline`
      )
    }
    await sleep(intervalMs)
  }
}

/**
 * The end of a flow's state: `verify` (when the hook has one) only after a passing flow, then
 * `after` whatever happened. `verify` proves an outcome the flow cannot see itself; a failed flow
 * already has its cause. When both fail, both causes are reported.
 *
 * @param {{ verify?: (prisma: unknown, userId: string) => Promise<void>, after: (prisma: unknown, userId: string) => Promise<void> }} hook
 */
export const settleMobileE2EFlowState = async (hook, prisma, userId, { passed }) => {
  let verifyError
  if (passed && hook.verify) {
    try {
      await hook.verify(prisma, userId)
    } catch (error) {
      verifyError = error
    }
  }
  try {
    await hook.after(prisma, userId)
  } catch (cleanupError) {
    if (!verifyError) throw cleanupError
    throw new AggregateError(
      [verifyError, cleanupError],
      `${verifyError.message}; the cleanup also failed: ${cleanupError.message}`
    )
  }
  if (verifyError) throw verifyError
}

export const seedGarmentDeleteTarget = async (prisma, userId) => {
  await removeGarmentDeleteTarget(prisma, userId)
  const garmentId = garmentDeleteFixtureId(userId)
  const now = new Date()
  await prisma.garmentItem.create({
    data: {
      id: garmentId,
      user_id: userId,
      object_path: garmentDeleteFixturePath(userId, garmentId),
      mime_type: 'image/png',
      file_size_bytes: 2048,
      category: GARMENT_DELETE_TARGET_CATEGORY,
      material: 'cotton',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      tags_confirmed_at: now,
      committed_at: now,
    },
  })
  return garmentId
}

/**
 * State a flow needs beyond the shared per-flow reset, keyed by flow path.
 * `before` runs ahead of every attempt; `verify`, when present, runs once a
 * flow passed (see `settleMobileE2EFlowState`); `after` runs once the flow
 * finishes, pass or fail, so the flows after it start from the baseline the identity
 * setup created. A flow with no entry gets the shared reset alone.
 *
 * @param {{
 *   locationSentinelKeySuffix: string,
 *   cleanupComments: (tx: unknown, commentIds: string[]) => Promise<void>,
 *   longRootTarget?: { postId: string, authorId: string },
 *   garmentDeleteSettle?: { timeoutMs?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> },
 * }} options
 */
export const mobileE2EFlowStateHooks = ({
  locationSentinelKeySuffix,
  cleanupComments,
  longRootTarget = COMMUNITY_COMMENTS_LONG_ROOT_TARGET,
  garmentDeleteSettle,
}) => ({
  [LOCATION_CAPTURE_FLOW]: {
    before: (prisma, userId) =>
      clearMobileE2ELocations(prisma, userId, locationSentinelKeySuffix),
    after: (prisma, userId) => restoreMobileE2EBaselineLocation(prisma, userId),
  },
  // Starts with no saved location, so the Chicago it saves is not a duplicate of the baseline.
  [USE_MY_LOCATION_FLOW]: {
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
  [GARMENT_DELETE_FLOW]: {
    before: (prisma, userId) => seedGarmentDeleteTarget(prisma, userId),
    // Runs only after a passing flow: the DELETE landed (see waitForGarmentDeleteTargetGone).
    verify: (prisma, userId) =>
      waitForGarmentDeleteTargetGone(prisma, userId, garmentDeleteSettle),
    after: (prisma, userId) => removeGarmentDeleteTarget(prisma, userId),
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

/** True when a coordinate carries at most two decimals, the precision the app may send. */
const twoDecimals = (value) =>
  Number.isFinite(value) && Math.round(value * 100) / 100 === value

/**
 * Production follow-up (2026-11-19): judges what the weather provider double saw while the Use
 * my location flow ran. On a device the OS answers the injected position at reduced accuracy, so
 * the fix the app reads (and rounds) can differ from the injected pair: the verdict checks what a
 * correct client guarantees instead. Every reverse lookup carried at most two decimals, the
 * precise injected position never reached the provider, and a lookup resolved to the city the
 * flow saves (Chicago). The exact rounding arithmetic is pinned by the mocked-device unit tests.
 * Returns the named cause that fails the flow, or `undefined`.
 *
 * @param {{
 *   before: { geocoding: number },
 *   requests: { geocoding: { seq: number, query: string, latitude?: number, longitude?: number }[] },
 *   device?: { latitude: number, longitude: number },
 *   city?: string,
 * }} observed
 * @returns {string | undefined}
 */
export const useMyLocationWeatherDoubleCause = ({
  before,
  requests,
  device = USE_MY_LOCATION_DEVICE,
  city = 'Chicago',
}) => {
  const lookups = requests.geocoding.filter((entry) => entry.seq > before.geocoding)
  const reverse = lookups.filter((entry) => typeof entry.latitude === 'number')
  if (reverse.length === 0) {
    return 'weather provider double saw no reverse lookup during the flow'
  }
  const precise = [String(device.latitude), String(device.longitude)]
  if (
    lookups.some((entry) =>
      precise.some((value) => JSON.stringify(entry).includes(value))
    )
  ) {
    return 'the precise device position reached the weather provider; the app must round it first'
  }
  const unrounded = reverse.filter(
    (entry) => !twoDecimals(entry.latitude) || !twoDecimals(entry.longitude)
  )
  if (unrounded.length > 0) {
    // Counts only: a failure reason is logged in CI and must not carry a position.
    return `${unrounded.length} of ${reverse.length} reverse lookups carried more than two decimals`
  }
  if (
    !reverse.some(
      (entry) => reversePlaces(entry.latitude, entry.longitude)[0]?.name === city
    )
  ) {
    return `none of ${reverse.length} reverse lookups resolved to ${city}`
  }
  return undefined
}
