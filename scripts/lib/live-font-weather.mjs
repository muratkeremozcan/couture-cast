// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling on Antigravity r30 item 1: the Community screen shows the out-of-date forecast
// notice once the harness location's weather snapshot is over an hour old
// (packages/db/prisma/seeds/weather.ts), and that notice is one of the stale keys an approved
// residual lists. So the run sets the banner state itself: before the first capture it ages the
// snapshot of the harness account's saved location past the hour, through the harness's own
// local database only, and records the state it expects.
import { NATIVE_JOURNEY_LOCATION_KEY } from './native-journey-weather.mjs'

/** The banner state an aged snapshot gives the Community screen (weatherBannerState). */
export const AGED_WEATHER_BANNER = 'out-of-date'
/** How far back the run sets `fetched_at`: well past the one hour that makes a snapshot stale. */
export const WEATHER_AGE_MINUTES = 120

function coded(code, detail) {
  const error = new Error(`${code}:${detail}`)
  error.code = code
  return error
}

/**
 * The harness database URL from its owned env (`owned-env.json` in the harness dir), checked the
 * way scripts/run-story68-native.mjs ownedEnv checks it: a loopback host and the harness's own
 * `tea_community_<32 hex>` database. Anything else (another host, the Supabase default
 * `postgres` database on the same port) is refused. The detail never carries the URL.
 */
export function harnessDatabaseUrl(ownedEnv) {
  let url
  try {
    url = new URL(ownedEnv?.DATABASE_URL)
  } catch {
    throw coded('live_font_harness_database_required', 'DATABASE_URL unreadable')
  }
  // pg connects to a host or socket named in the query string, so a URL with any search part,
  // or any scheme but postgres, could reach another server than the loopback host it names.
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw coded(
      'live_font_harness_database_required',
      `scheme ${url.protocol} is not postgres`
    )
  if (url.search !== '' || url.hash !== '')
    throw coded(
      'live_font_harness_database_required',
      'connection options in the URL are not allowed'
    )
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw coded(
      'live_font_harness_database_required',
      `host ${url.hostname} is not local`
    )
  if (!/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname))
    throw coded(
      'live_font_harness_database_required',
      `database ${url.pathname.slice(1) || 'missing'} is not a harness database`
    )
  return url.toString()
}

/**
 * Ages the harness location's weather snapshot: `fetched_at` set `ageMinutes` before `now`.
 * `query(url, sql, params)` runs one statement and resolves to its row count. Resolves to the
 * banner state the run expects and the aging applied, for the report and each proposed entry.
 */
export async function ageWeatherSnapshot({
  ownedEnv,
  query,
  now = Date.now(),
  ageMinutes = WEATHER_AGE_MINUTES,
  locationKey = NATIVE_JOURNEY_LOCATION_KEY,
}) {
  const url = harnessDatabaseUrl(ownedEnv)
  const fetchedAt = new Date(now - ageMinutes * 60_000)
  let snapshots
  try {
    snapshots = await query(
      url,
      'UPDATE "WeatherSnapshot" SET "fetched_at" = $1 WHERE "location_key" = $2',
      [fetchedAt, locationKey]
    )
  } catch (error) {
    throw coded('live_font_weather_aging_failed', error?.message ?? String(error))
  }
  if (!(snapshots > 0))
    throw coded('live_font_weather_aging_failed', `no snapshot for ${locationKey}`)
  return {
    weatherBanner: AGED_WEATHER_BANNER,
    weatherAging: {
      locationKey,
      ageMinutes,
      fetchedAt: fetchedAt.toISOString(),
      snapshots,
    },
  }
}
