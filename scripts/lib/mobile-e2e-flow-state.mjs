import { fold } from './weather-provider-double-data.mjs'

/**
 * Reset state owned by the synthetic member before each flow and watchdog retry.
 * A timed-out flow can have saved a reaction before stalling during relaunch.
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
