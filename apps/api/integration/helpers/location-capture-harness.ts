import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaClient, type TelemetryEvent } from '@prisma/client'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest'
import {
  createSavedLocationFromSearchResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchCandidateSchema,
  locationUnavailableResponseSchema,
  type LocationSearchCandidate,
} from '@couture/api-client/contracts/http'
import { z } from 'zod'
import {
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../../scripts/weather-provider-double.mjs'
import {
  coordinateKeySuffix,
  sentinelPlace,
} from '../../../../scripts/lib/weather-provider-double-data.mjs'
import { getRedisConfig, redisOptionsFromConfig } from '../../src/config/redis'
import {
  ANALYTICS_CLIENT,
  type AnalyticsCaptureEvent,
} from '../../src/analytics/analytics.service'
import type { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../../src/modules/auth/security.guards'
import {
  LOCATION_FORECAST_PROVIDER,
  LOCATION_GEOCODER,
  LocationCaptureService,
} from '../../src/modules/location-preferences/location-capture.service'
import {
  LOCATION_CLOCK,
  type LocationClock,
} from '../../src/modules/location-preferences/location-clock.js'
import { LocationPreferencesController } from '../../src/modules/location-preferences/location-preferences.controller'
import { PrismaLocationPreferencesRepository } from '../../src/modules/location-preferences/location-preferences.repository'
import { LocationPreferencesService } from '../../src/modules/location-preferences/location-preferences.service'
import { TelemetryService } from '../../src/modules/telemetry/telemetry.service'
import { OpenWeatherGeocodingClient } from '../../src/modules/weather/providers/openweather-geocoding.client'
import { OpenWeatherProvider } from '../../src/modules/weather/providers/openweather.provider'
import type { IWeatherProvider } from '../../src/modules/weather/providers/weather-provider.interface'
import type { WeatherIngestionTarget } from '../../src/modules/weather/providers/weather.types'
import { WeatherApiGeocodingClient } from '../../src/modules/weather/providers/weatherapi-geocoding.client'
import { WeatherApiProvider } from '../../src/modules/weather/providers/weatherapi.provider'
import {
  WEATHER_REFRESH_QUEUE_OPTIONS,
  WeatherRefreshQueue,
} from '../../src/modules/weather/weather-refresh.queue'
import { WeatherRepository } from '../../src/modules/weather/weather.repository'
import { httpTestUrl, listenHttpApp } from '../../src/testing/loopback-http-app.js'

/**
 * Story 1.2b: the shared harness for the location capture suites. Each test
 * gets its own Nest app, Prisma client and BullMQ queue under a unique Redis
 * prefix, all closed when the test ends, against a real migrated database, a
 * real Redis and the deterministic provider double. CI sets
 * LOCATION_PREFERENCES_REAL_DB_INTEGRATION=true, and then a failed schema probe
 * fails the suite; it never skips.
 */

export const runRealDatabase =
  process.env.LOCATION_PREFERENCES_REAL_DB_INTEGRATION === 'true'
export function describeRealDatabase(name: string, factory: () => void): void {
  ;(runRealDatabase ? describe : describe.skip)(name, factory)
}

// The published response schemas strip unknown keys so installed clients
// survive an additive server change. The server's own output is pinned exactly
// here: a candidate that grew an identity field would fail these.
export const exactSearchResponseSchema = z
  .object({ data: z.array(locationSearchCandidateSchema.strict()) })
  .strict()
export const exactRequestErrorSchema = locationRequestErrorResponseSchema.strict()
export const exactUnavailableSchema = locationUnavailableResponseSchema.strict()

// The spec's numbers, written out so a change to a production constant fails.
/** Provider calls on the capture path give up after 3 seconds. */
export const PROVIDER_DEADLINE_MS = 3000
/** Headroom over the deadline for a real HTTP round trip on a loaded runner. */
export const DEADLINE_MARGIN_MS = 900
/**
 * Slack under the deadline for a call that timed out: timers and `Date.now()`
 * are millisecond-coarse and a timer can fire a tick early. 100 ms still proves
 * the call waited out the deadline instead of failing fast.
 */
export const DEADLINE_EARLY_SLACK_MS = 100
/** A search candidate stays savable for 15 minutes. */
export const CANDIDATE_LIFETIME_MS = 15 * 60_000
/** `WEATHER_REFRESH_MINUTES` is unset here, so the refresh queue buckets by 5. */
export const REFRESH_BUCKET_MINUTES = 5
/** A primary's snapshot older than five minutes is refreshed on promotion. */
export const PRIMARY_REFRESH_STALE_MS = 5 * 60_000

export function controlledClock(): LocationClock & {
  advance(milliseconds: number): void
} {
  let milliseconds = Date.parse('2026-10-22T12:04:59.999Z')
  return {
    now: () => new Date(milliseconds),
    advance: (elapsed) => {
      milliseconds += elapsed
    },
  }
}

export type Mode = 'openweather' | 'weatherapi'

/**
 * Holds every save-time forecast call at the provider boundary until
 * `release()`. `arrived` settles once `expected` calls are inside, or after a
 * deadline so a schedule that never brings them all in fails on `arrivals()`
 * instead of hanging the test.
 */
export interface ForecastBarrier {
  arrived: Promise<void>
  arrivals(): number
  release(): void
}

export interface Harness {
  app: INestApplication
  prisma: PrismaClient
  queue: Queue
  captured: { event: string; properties: unknown }[]
  analytics: AnalyticsCaptureEvent[]
  telemetryRows: TelemetryEvent[]
  clock: ReturnType<typeof controlledClock>
  tokens: Map<string, string>
  holdForecasts(expected: number): ForecastBarrier
  close(): Promise<void>
}

function authGuard(tokens: Map<string, string>) {
  const guardianConsentStateService = {
    canTeenAccess: vi.fn().mockResolvedValue(true),
  } as unknown as GuardianConsentStateService
  const accessTokenIdentityService = {
    resolveIdentity: vi.fn((token: string) => {
      const userId = tokens.get(token)
      return userId
        ? Promise.resolve({ userId, role: 'guardian' as const })
        : Promise.reject(new Error('Unknown test access token'))
    }),
  } as unknown as AccessTokenIdentityService
  return {
    guardianConsentStateService,
    guard: new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService),
  }
}

const BARRIER_DEADLINE_MS = 2000

function forecastBarrier(expected: number): {
  barrier: ForecastBarrier
  enter: () => Promise<void>
} {
  let arrivals = 0
  let allArrived!: () => void
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrived = new Promise<void>((resolve) => {
    allArrived = resolve
  })
  const deadline = setTimeout(allArrived, BARRIER_DEADLINE_MS)
  void arrived.then(() => clearTimeout(deadline))
  return {
    barrier: { arrived, arrivals: () => arrivals, release },
    enter: async () => {
      arrivals += 1
      if (arrivals >= expected) allArrived()
      await released
    },
  }
}

export async function createHarness(
  mode: Mode,
  double: WeatherProviderDouble,
  realTelemetry = false
): Promise<Harness> {
  const prisma = new PrismaClient()
  try {
    // Schema probe: fails the suite, never skips it, when a migration is absent.
    await prisma.$queryRaw`SELECT 1 FROM "LocationSearchWindow" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "SavedLocation" LIMIT 1`
  } catch (error) {
    await prisma.$disconnect()
    throw error
  }

  const env = {
    TEST_ENV: 'local',
    OPENWEATHER_API_ORIGIN: double.origin,
    WEATHERAPI_API_ORIGIN: double.origin,
  }
  const prefix = `cc12b-test-${randomUUID()}`
  const tokens = new Map<string, string>()
  const captured: Harness['captured'] = []
  const analytics: AnalyticsCaptureEvent[] = []
  const telemetryRows: TelemetryEvent[] = []
  // Retain IDs of this harness's actual writes for assertions and cleanup;
  // pseudonymous rows cannot be selected by a user FK.
  const trackedPrisma = prisma.$extends({
    query: {
      telemetryEvent: {
        async create({ args, query }) {
          const row = await query(args)
          // TelemetryService creates without a projection. Prisma's generic
          // extension result also models selected rows, so narrow this full row.
          telemetryRows.push(row as TelemetryEvent)
          return row
        },
      },
    },
  })
  const clock = controlledClock()
  const auth = authGuard(tokens)
  const geocoder =
    mode === 'weatherapi'
      ? new WeatherApiGeocodingClient({ apiKey: 'double-key', env })
      : new OpenWeatherGeocodingClient({ apiKey: 'double-key', env })
  const provider =
    mode === 'weatherapi'
      ? new WeatherApiProvider({ apiKey: 'double-key', env, forecastDays: 3 })
      : new OpenWeatherProvider({ apiKey: 'double-key', env })
  let gate: ((target: WeatherIngestionTarget) => Promise<void>) | null = null
  const forecastProvider: IWeatherProvider = {
    fetchForecast: async (target, signal) => {
      await gate?.(target)
      return provider.fetchForecast(target, signal)
    },
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [LocationPreferencesController],
    providers: [
      { provide: PrismaClient, useValue: trackedPrisma },
      PrismaLocationPreferencesRepository,
      LocationPreferencesService,
      LocationCaptureService,
      WeatherRepository,
      WeatherRefreshQueue,
      { provide: WEATHER_REFRESH_QUEUE_OPTIONS, useValue: { prefix } },
      { provide: LOCATION_GEOCODER, useValue: geocoder },
      { provide: LOCATION_FORECAST_PROVIDER, useValue: forecastProvider },
      { provide: LOCATION_CLOCK, useValue: clock },
      {
        provide: ANALYTICS_CLIENT,
        useValue: {
          capture: (event: AnalyticsCaptureEvent) =>
            analytics.push(structuredClone(event)),
        },
      },
      {
        provide: GuardianConsentStateService,
        useValue: auth.guardianConsentStateService,
      },
      realTelemetry
        ? TelemetryService
        : {
            provide: TelemetryService,
            useValue: {
              captureEvent: vi.fn(
                (_userId: string, event: string, properties: unknown) => {
                  captured.push({ event, properties })
                  return Promise.resolve()
                }
              ),
            },
          },
    ],
  })
    .overrideGuard(RequestAuthGuard)
    .useValue(auth.guard)
    .compile()

  const app = moduleRef.createNestApplication()
  await listenHttpApp(app)
  const queue = new Queue('weather-ingestion', {
    connection: redisOptionsFromConfig(getRedisConfig()),
    prefix,
  })

  return {
    app,
    prisma,
    queue,
    captured,
    analytics,
    telemetryRows,
    clock,
    tokens,
    holdForecasts(expected) {
      const { barrier, enter } = forecastBarrier(expected)
      gate = enter
      return barrier
    },
    async close() {
      await app.close()
      await queue.obliterate({ force: true })
      await queue.close()
      await prisma.$disconnect()
    },
  }
}

/** A place the double invents for this nonce alone, so no other run shares its key. */
export function sentinel(label: string) {
  const nonce = `${label}${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const place = sentinelPlace(nonce)
  const suffix = coordinateKeySuffix(place.lat, place.lon)
  return {
    query: `Sentinel ${nonce}`,
    place,
    suffix,
    locationKey: `sentinelville-sentinel-county-us-${suffix}`,
  }
}

export function headers(token: string, platform = 'web') {
  return { authorization: `Bearer ${token}`, 'x-couture-platform': platform }
}

/**
 * Registers the suite lifecycle and returns the request helpers. Every
 * harness closes when its test ends, so connections never accumulate across
 * tests; rows are removed once, after the suite.
 */
export function useLocationCaptureSuite() {
  let double: WeatherProviderDouble
  let open: Harness[] = []
  const userIds: string[] = []
  const snapshotKeys = new Set<string>()

  beforeAll(async () => {
    double = await startWeatherProviderDouble()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    const closing = open
    open = []
    for (const harness of closing) await harness.close()
  })

  afterAll(async () => {
    const prisma = new PrismaClient()
    try {
      const snapshots = { location_key: { in: [...snapshotKeys] } }
      await prisma.forecastSegment.deleteMany({ where: { weather_snapshot: snapshots } })
      await prisma.weatherSnapshot.deleteMany({ where: snapshots })
      await prisma.weatherIngestionState.deleteMany({ where: snapshots })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await prisma.$disconnect()
    }
    await double?.close()
  })

  async function harnessFor(mode: Mode, realTelemetry = false): Promise<Harness> {
    const harness = await createHarness(mode, double, realTelemetry)
    open.push(harness)
    return harness
  }

  async function member(harness: Harness): Promise<{ id: string; token: string }> {
    const id = `cc12b-member-${randomUUID()}`
    await harness.prisma.user.create({ data: { id, email: `${id}@example.com` } })
    userIds.push(id)
    const token = `token-${id}`
    harness.tokens.set(token, id)
    return { id, token }
  }

  async function search(
    harness: Harness,
    token: string,
    q: string,
    locale = 'en-US'
  ): Promise<LocationSearchCandidate[]> {
    const response = await request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q, locale })
      .set(headers(token))
    expect(response.status).toBe(200)
    return exactSearchResponseSchema.parse(response.body).data
  }

  function searchRequest(harness: Harness, token: string, q: string) {
    return request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q })
      .set(headers(token))
  }

  function save(harness: Harness, token: string, candidateToken: string, label = 'Home') {
    return request(httpTestUrl(harness.app))
      .post('/api/v1/locations/from-search')
      .set(headers(token, 'mobile'))
      .send({ candidateToken, label })
  }

  async function saveCandidate(
    harness: Harness,
    token: string,
    candidate: LocationSearchCandidate,
    label = 'Home'
  ) {
    const response = await save(harness, token, candidate.candidateToken, label)
    expect(response.status).toBe(201)
    const location = createSavedLocationFromSearchResponseSchema.parse(response.body).data
    snapshotKeys.add(location.locationKey)
    return location
  }

  return {
    get double() {
      return double
    },
    harnessFor,
    member,
    search,
    searchRequest,
    save,
    saveCandidate,
    trackSnapshotKey: (key: string) => snapshotKeys.add(key),
  }
}
