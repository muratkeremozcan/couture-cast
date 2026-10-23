import { listenHttpApp, httpTestUrl } from './helpers/loopback-http-app.js'
import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaClient, type TelemetryEvent } from '@prisma/client'
import { Queue } from 'bullmq'
import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createSavedLocationFromSearchResponseSchema,
  listSavedLocationsResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchCandidateSchema,
  locationUnavailableResponseSchema,
  tooManyRequestsHttpErrorSchema,
  type LocationSearchCandidate,
} from '@couture/api-client/contracts/http'
import { canonicalSpotlightArea } from '@couture/utils'
import { z } from 'zod'
import {
  SENTINEL_TEMPERATURE_C,
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../scripts/weather-provider-double.mjs'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis'
import type * as PinoConfig from '../src/logger/pino.config.js'
import {
  ANALYTICS_CLIENT,
  type AnalyticsCaptureEvent,
} from '../src/analytics/analytics.service'
import type { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import {
  encodeLocationCandidate,
  LOCATION_CANDIDATE_TTL_MS,
  resolveLocationCandidateSecret,
} from '../src/modules/location-preferences/location-candidate-token'
import {
  LOCATION_FORECAST_PROVIDER,
  LOCATION_GEOCODER,
  LocationCaptureService,
} from '../src/modules/location-preferences/location-capture.service'
import {
  LOCATION_CLOCK,
  type LocationClock,
} from '../src/modules/location-preferences/location-clock.js'
import { LocationPreferencesController } from '../src/modules/location-preferences/location-preferences.controller'
import { PrismaLocationPreferencesRepository } from '../src/modules/location-preferences/location-preferences.repository'
import { LocationPreferencesService } from '../src/modules/location-preferences/location-preferences.service'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service'
import { OpenWeatherGeocodingClient } from '../src/modules/weather/providers/openweather-geocoding.client'
import { OpenWeatherProvider } from '../src/modules/weather/providers/openweather.provider'
import { WeatherApiGeocodingClient } from '../src/modules/weather/providers/weatherapi-geocoding.client'
import { WeatherApiProvider } from '../src/modules/weather/providers/weatherapi.provider'
import { createWeatherLocationJobId } from '../src/modules/weather/weather-processor'
import { WeatherQueryService } from '../src/modules/weather/weather-query.service'
import {
  WEATHER_REFRESH_QUEUE_OPTIONS,
  WeatherRefreshQueue,
} from '../src/modules/weather/weather-refresh.queue'
import { WeatherRepository } from '../src/modules/weather/weather.repository'
import {
  clearMobileE2ELocations,
  MOBILE_E2E_BASELINE_LOCATION,
  restoreMobileE2EBaselineLocation,
} from '../../../scripts/lib/mobile-e2e-flow-state.mjs'
import {
  coordinateKeySuffix,
  sentinelPlace,
} from '../../../scripts/lib/weather-provider-double-data.mjs'

/**
 * Story 1.2b: the capture path against a real migrated database, a real Redis
 * queue and the deterministic provider double. CI sets
 * LOCATION_PREFERENCES_REAL_DB_INTEGRATION=true, and then a failed schema probe
 * fails this suite; it never skips.
 */

// The published response schemas strip unknown keys so installed clients
// survive an additive server change. The server's own output is pinned exactly
// here: a candidate that grew an identity field would fail these.
const exactSearchResponseSchema = z
  .object({ data: z.array(locationSearchCandidateSchema.strict()) })
  .strict()
const exactRequestErrorSchema = locationRequestErrorResponseSchema.strict()
const exactUnavailableSchema = locationUnavailableResponseSchema.strict()

const runRealDatabase = process.env.LOCATION_PREFERENCES_REAL_DB_INTEGRATION === 'true'
const describeRealDatabase = runRealDatabase ? describe : describe.skip

// Capture the real Pino serialization at its output boundary, including child
// bindings and every log level. HTTP request logging is outside this module.
const { capturedLogLines } = vi.hoisted(() => ({ capturedLogLines: [] as string[] }))
vi.mock('../src/logger/pino.config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PinoConfig>()
  return {
    ...actual,
    createBaseLogger: (options: Parameters<typeof actual.createBaseLogger>[0] = {}) =>
      actual.createBaseLogger({
        ...options,
        env: { ...process.env, LOG_LEVEL: 'trace', PINO_PRETTY: 'false' },
        destination: { write: (line) => capturedLogLines.push(line) },
      }),
  }
})

function controlledClock(): LocationClock & { advance(milliseconds: number): void } {
  let milliseconds = Date.parse('2026-10-22T12:04:59.999Z')
  return {
    now: () => new Date(milliseconds),
    advance: (elapsed) => {
      milliseconds += elapsed
    },
  }
}

type Mode = 'openweather' | 'weatherapi'

interface Harness {
  app: INestApplication
  prisma: PrismaClient
  queue: Queue
  captured: { event: string; properties: unknown }[]
  analytics: AnalyticsCaptureEvent[]
  telemetryRows: TelemetryEvent[]
  clock: ReturnType<typeof controlledClock>
  tokens: Map<string, string>
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

async function createHarness(
  mode: Mode,
  double: WeatherProviderDouble,
  realTelemetry = false
): Promise<Harness> {
  const prisma = new PrismaClient()
  // Schema probe: fails the suite, never skips it, when a migration is absent.
  await prisma.$queryRaw`SELECT 1 FROM "LocationSearchWindow" LIMIT 1`
  await prisma.$queryRaw`SELECT 1 FROM "SavedLocation" LIMIT 1`

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
  const forecastProvider =
    mode === 'weatherapi'
      ? new WeatherApiProvider({ apiKey: 'double-key', env, forecastDays: 3 })
      : new OpenWeatherProvider({ apiKey: 'double-key', env })

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
  const config = getRedisConfig()
  const queue = new Queue('weather-ingestion', {
    connection: redisOptionsFromConfig(config),
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
    async close() {
      await app.close()
      await queue.obliterate({ force: true })
      await queue.close()
      await prisma.$disconnect()
    },
  }
}

describeRealDatabase('Location capture real-database integration', () => {
  let double: WeatherProviderDouble
  const harnesses: Harness[] = []
  const userIds: string[] = []
  const snapshotKeys = new Set<string>()

  beforeAll(async () => {
    double = await startWeatherProviderDouble()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    const prisma = new PrismaClient()
    try {
      const snapshots = { location_key: { in: [...snapshotKeys] } }
      await prisma.forecastSegment.deleteMany({ where: { weather_snapshot: snapshots } })
      await prisma.weatherSnapshot.deleteMany({ where: snapshots })
      await prisma.weatherIngestionState.deleteMany({
        where: { location_key: { in: [...snapshotKeys] } },
      })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await prisma.$disconnect()
    }
    for (const harness of harnesses) await harness.close()
    await double?.close()
  })

  async function harnessFor(mode: Mode, realTelemetry = false): Promise<Harness> {
    const harness = await createHarness(mode, double, realTelemetry)
    harnesses.push(harness)
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

  function headers(token: string, platform = 'web') {
    return { authorization: `Bearer ${token}`, 'x-couture-platform': platform }
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

  it('1.2b-INT-01 searches, saves the first location as primary and persists its snapshot', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)

    const candidates = await search(harness, viewer.token, 'Chicago', 'fr-FR')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(5)
    expect(candidates[0]).toMatchObject({
      country: 'US',
      city: 'Chicago',
      region: 'Illinois',
      displayLabel: 'Chicago, Illinois, États-Unis',
    })

    const location = await saveCandidate(harness, viewer.token, candidates[0]!)
    expect(location).toMatchObject({
      isPrimary: true,
      timezone: 'America/Chicago',
      city: 'Chicago',
      region: 'Illinois',
      country: 'US',
      locationKey: 'chicago-illinois-us-41-878n-87-630w',
      latitude: 41.878,
      longitude: -87.63,
    })

    const snapshot = await harness.prisma.weatherSnapshot.findFirst({
      where: { location_key: location.locationKey },
      include: { segments: true },
    })
    expect(snapshot?.temperature).toBe(SENTINEL_TEMPERATURE_C)
    expect(snapshot?.segments).toHaveLength(48)
    expect(Array.isArray(snapshot?.daily_summaries)).toBe(true)

    const latest = await new WeatherQueryService(
      new WeatherRepository(harness.prisma)
    ).getLatestWeather(location.locationKey)
    expect(latest.status).toBe('fresh')

    expect(canonicalSpotlightArea(location)).toEqual({
      country: 'US',
      region: 'illinois',
      city: 'chicago',
    })
  })

  it('1.2b-INT-02 refuses a short query with 400 before any provider call', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const before = double.stats.geocoding

    const response = await request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q: 'C' })
      .set(headers(viewer.token))

    expect(response.status).toBe(400)
    expect(exactRequestErrorSchema.parse(response.body).code).toBe('invalid_request')
    expect(double.stats.geocoding).toBe(before)
  })

  it('1.2b-INT-03 answers a typed retryable 503 for a provider that fails or exceeds 3 seconds', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)

    for (const q of ['Provider down', 'Provider slow']) {
      const startedAt = Date.now()
      const response = await request(httpTestUrl(harness.app))
        .get('/api/v1/locations/search')
        .query({ q })
        .set(headers(viewer.token))
      expect(response.status).toBe(503)
      expect(exactUnavailableSchema.parse(response.body)).toMatchObject({
        code: 'provider_unavailable',
        retryable: true,
      })
      expect(Date.now() - startedAt).toBeLessThan(3900)
    }
    expect(harness.captured.map((entry) => entry.properties)).toEqual([
      { platform: 'web', outcome: 'provider_unavailable', resultCount: 0 },
      { platform: 'web', outcome: 'provider_timeout', resultCount: 0 },
    ])
  }, 15_000)

  it('1.2b-INT-04 enforces three locations, duplicates, distinct same-name keys and null regions', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)

    const springfields = await search(harness, viewer.token, 'Springfield')
    expect(springfields.map((candidate) => candidate.region)).toEqual([
      'Illinois',
      'Missouri',
    ])
    const illinois = await saveCandidate(
      harness,
      viewer.token,
      springfields[0]!,
      'Capital'
    )
    const missouri = await saveCandidate(
      harness,
      viewer.token,
      springfields[1]!,
      'Ozarks'
    )
    expect(illinois.locationKey).not.toBe(missouri.locationKey)

    const duplicate = await save(
      harness,
      viewer.token,
      springfields[0]!.candidateToken,
      'Again'
    )
    expect(duplicate.status).toBe(400)
    expect(exactRequestErrorSchema.parse(duplicate.body).code).toBe('location_duplicate')

    const [monaco] = await search(harness, viewer.token, 'Monaco')
    const saved = await saveCandidate(harness, viewer.token, monaco!, 'Coast')
    expect(saved.region).toBeNull()
    expect(canonicalSpotlightArea(saved)).toEqual({
      country: 'MC',
      region: null,
      city: null,
    })

    const forecastsBefore = double.stats.forecast
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    const fourth = await save(harness, viewer.token, chicago!.candidateToken, 'Fourth')
    expect(fourth.status).toBe(400)
    expect(exactRequestErrorSchema.parse(fourth.body).code).toBe('location_limit_reached')
    expect(double.stats.forecast).toBe(forecastsBefore)
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(3)
  })

  it('1.2b-INT-05 keeps same name, region and country at distinct coordinates as two keys', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)

    const twins = await search(harness, viewer.token, 'Twinbrook')
    expect(twins).toHaveLength(2)
    const first = await saveCandidate(harness, viewer.token, twins[0]!, 'North')
    const second = await saveCandidate(harness, viewer.token, twins[1]!, 'South')
    expect(first.locationKey).not.toBe(second.locationKey)
  })

  it('1.2b-INT-06 refuses tampered, foreign-environment and expired tokens with 400', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    const secret = resolveLocationCandidateSecret()!
    const place = {
      city: 'Chicago',
      region: 'Illinois',
      country: 'US',
      latitude: 41.878,
      longitude: -87.63,
    }
    const [payload, signature] = chicago!.candidateToken.split('.')
    const edited = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      unknown
    >
    edited.latitude = 0
    const tokens = [
      `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`,
      encodeLocationCandidate(
        place,
        'another-environment-secret-0123456789abc',
        harness.clock.now()
      ),
      encodeLocationCandidate(
        place,
        secret,
        new Date(harness.clock.now().getTime() - LOCATION_CANDIDATE_TTL_MS - 1000)
      ),
    ]

    for (const token of tokens) {
      const response = await save(harness, viewer.token, token)
      expect(response.status).toBe(400)
      expect(exactRequestErrorSchema.parse(response.body).code).toBe('invalid_candidate')
    }
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(0)
  })

  it('1.2b-INT-07 saves a replayed token for the caller only', async () => {
    const harness = await harnessFor('openweather')
    const issuer = await member(harness)
    const replayer = await member(harness)
    const [chicago] = await search(harness, issuer.token, 'Chicago')

    await saveCandidate(harness, replayer.token, chicago!)

    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: issuer.id } })
    ).toBe(0)
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: replayer.id } })
    ).toBe(1)
  })

  it('1.2b-INT-08 saves nothing when the save forecast fails or returns an invalid timezone', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)

    for (const q of ['Failtown', 'Badzone']) {
      const [candidate] = await search(harness, viewer.token, q)
      const response = await save(harness, viewer.token, candidate!.candidateToken)
      expect(response.status).toBe(503)
      expect(exactUnavailableSchema.parse(response.body)).toMatchObject({
        code: 'provider_unavailable',
        retryable: true,
      })
    }
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(0)
    expect(
      await harness.prisma.weatherSnapshot.count({
        where: { location_key: { contains: 'failtown' } },
      })
    ).toBe(0)
  })

  it('1.2b-INT-09 gives a localized and an English display the same key, and folds Unicode', async () => {
    const harness = await harnessFor('openweather')
    const german = await member(harness)
    const english = await member(harness)

    const [de] = await search(harness, german.token, 'Moscow', 'de-DE')
    const [en] = await search(harness, english.token, 'Moscow', 'en-US')
    expect(de?.displayLabel).toBe('Moskau, Moscow, Russland')
    expect(en?.displayLabel).toBe('Moscow, Russia')
    const first = await saveCandidate(harness, german.token, de!)
    const second = await saveCandidate(harness, english.token, en!)
    expect(first.locationKey).toBe(second.locationKey)

    const [istanbul] = await search(harness, english.token, 'İstanbul', 'tr-TR')
    expect(istanbul?.displayLabel).toBe('İstanbul, Türkiye')
    const savedIstanbul = await saveCandidate(
      harness,
      english.token,
      istanbul!,
      'Bosphorus'
    )
    expect(savedIstanbul).toMatchObject({
      city: 'İstanbul',
      region: 'İstanbul',
      country: 'TR',
    })
    expect(canonicalSpotlightArea(savedIstanbul)).toEqual({
      country: 'TR',
      region: 'istanbul',
      city: 'istanbul',
    })

    const [saoPaulo] = await search(harness, english.token, 'Sao Paulo')
    const savedSaoPaulo = await saveCandidate(
      harness,
      english.token,
      saoPaulo!,
      'Avenida'
    )
    expect(savedSaoPaulo).toMatchObject({ city: 'São Paulo', country: 'BR' })
    expect(canonicalSpotlightArea(savedSaoPaulo).city).toBe('sao paulo')
  })

  it('1.2b-INT-10 drops an unresolvable WeatherAPI country and saves through WeatherAPI', async () => {
    const harness = await harnessFor('weatherapi')
    const viewer = await member(harness)

    expect(await search(harness, viewer.token, 'Atlantis')).toEqual([])
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    expect(chicago).toMatchObject({ country: 'US', region: 'Illinois' })
    const location = await saveCandidate(harness, viewer.token, chicago!)
    expect(location.timezone).toBe('America/Chicago')
    const snapshot = await harness.prisma.weatherSnapshot.findFirst({
      where: { location_key: location.locationKey, provider: 'weatherapi' },
    })
    expect(snapshot?.temperature).toBe(SENTINEL_TEMPERATURE_C)
  })

  it('1.2b-INT-11 enqueues a refresh when a legacy location without a snapshot becomes primary, and on delete promotion', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    const searched = await saveCandidate(harness, viewer.token, chicago!)
    // Exactly five minutes old is still fresh. Provider HTTP timestamps stay
    // real; only the snapshot under this boundary test uses the controlled clock.
    await harness.prisma.weatherSnapshot.updateMany({
      where: { location_key: searched.locationKey },
      data: { fetched_at: new Date(harness.clock.now().getTime() - 5 * 60_000) },
    })
    const legacyKey = `cc12b-legacy-${randomUUID().slice(0, 8)}`
    const legacy = await request(httpTestUrl(harness.app))
      .post('/api/v1/locations')
      .set(headers(viewer.token))
      .send({
        label: 'Legacy',
        locationKey: legacyKey,
        latitude: 40.1,
        longitude: -75.2,
        timezone: 'America/New_York',
        city: 'Legacyville',
      })
    expect(legacy.status).toBe(201)
    const legacyId = (legacy.body as { data: { id: string } }).data.id

    const switched = await request(httpTestUrl(harness.app))
      .post(`/api/v1/locations/${legacyId}/primary`)
      .set(headers(viewer.token))
    expect(switched.status).toBe(200)

    const jobId = createWeatherLocationJobId(legacyKey, harness.clock.now(), 5)
    const job = await harness.queue.getJob(jobId)
    expect(job?.data).toEqual({
      type: 'location',
      target: {
        locationKey: legacyKey,
        locationName: 'Legacyville',
        latitude: 40.1,
        longitude: -75.2,
      },
    })
    expect(harness.captured.at(-1)).toEqual({
      event: 'location_switched',
      properties: {},
    })

    // The searched location has a fresh snapshot, so promoting it enqueues nothing.
    const deleted = await request(httpTestUrl(harness.app))
      .delete(`/api/v1/locations/${legacyId}`)
      .set(headers(viewer.token))
    expect(deleted.status).toBe(200)
    const list = listSavedLocationsResponseSchema.parse(
      (
        await request(httpTestUrl(harness.app))
          .get('/api/v1/locations')
          .set(headers(viewer.token))
      ).body
    ).data
    expect(list).toEqual([expect.objectContaining({ id: searched.id, isPrimary: true })])
    expect(
      await harness.queue.getJob(
        createWeatherLocationJobId(searched.locationKey, harness.clock.now(), 5)
      )
    ).toBeUndefined()

    // Promotion one millisecond later must refresh in the next job bucket.
    const relegacy = await request(httpTestUrl(harness.app))
      .post('/api/v1/locations')
      .set(headers(viewer.token))
      .send({
        label: 'Legacy two',
        locationKey: `${legacyKey}-2`,
        latitude: 40.2,
        longitude: -75.3,
        timezone: 'America/New_York',
      })
    const secondId = (relegacy.body as { data: { id: string } }).data.id
    expect(relegacy.status).toBe(201)
    await request(httpTestUrl(harness.app))
      .post(`/api/v1/locations/${secondId}/primary`)
      .set(headers(viewer.token))
      .expect(200)
    const previousBucketJobId = createWeatherLocationJobId(
      searched.locationKey,
      harness.clock.now(),
      5
    )
    harness.clock.advance(1)
    await request(httpTestUrl(harness.app))
      .delete(`/api/v1/locations/${secondId}`)
      .set(headers(viewer.token))
      .expect(200)
    expect(await harness.queue.getJob(previousBucketJobId)).toBeUndefined()
    expect(
      await harness.queue.getJob(
        createWeatherLocationJobId(searched.locationKey, harness.clock.now(), 5)
      )
    ).toBeDefined()
  })

  it('1.2b-INT-12 returns 404 when switching to a foreign location', async () => {
    const harness = await harnessFor('openweather')
    const owner = await member(harness)
    const stranger = await member(harness)
    const [chicago] = await search(harness, owner.token, 'Chicago')
    const location = await saveCandidate(harness, owner.token, chicago!)

    const response = await request(httpTestUrl(harness.app))
      .post(`/api/v1/locations/${location.id}/primary`)
      .set(headers(stranger.token))
    expect(response.status).toBe(404)
  })

  it('1.2b-INT-13 refuses the 31st search in a minute with the shared 429 and Retry-After', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    // Hold the final millisecond of a window while real HTTP calls complete.

    for (let index = 0; index < 30; index += 1) {
      await search(harness, viewer.token, 'Chicago')
    }
    const refused = await request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q: 'Chicago' })
      .set(headers(viewer.token))

    expect(refused.status).toBe(429)
    expect(Number(refused.headers['retry-after'])).toBe(1)
    expect(tooManyRequestsHttpErrorSchema.parse(refused.body).statusCode).toBe(429)
    harness.clock.advance(1)
    await search(harness, viewer.token, 'Chicago')
    expect(
      await harness.prisma.locationSearchWindow.findUnique({
        where: { user_id: viewer.id },
      })
    ).toMatchObject({ searches: 1, window_start: harness.clock.now() })
  }, 30_000)

  it('1.2b-INT-14 fails closed with 503 on both endpoints when the secret is missing in a deployed environment', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TEST_ENV', '')
    vi.stubEnv('LOCATION_CANDIDATE_SECRET', '')

    const searched = await request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q: 'Chicago' })
      .set(headers(viewer.token))
    const saved = await save(harness, viewer.token, chicago!.candidateToken)

    for (const response of [searched, saved]) {
      expect(response.status).toBe(503)
      expect(exactUnavailableSchema.parse(response.body).code).toBe(
        'location_service_unavailable'
      )
    }
  })

  it('1.2b-INT-15 correlates real HTTP location analytics to the member HMAC and excludes private data from events and new logs', async () => {
    const secret = 'location-privacy-test-secret-at-least-32-bytes'
    vi.stubEnv('ANALYTICS_ID_SECRET', secret)
    const harness = await harnessFor('openweather', true)
    const viewer = await member(harness)
    const bystander = await member(harness)
    const subject = (userId: string) =>
      createHmac('sha256', secret).update(userId).digest('base64url')
    const keys: string[] = []
    capturedLogLines.length = 0

    async function add(token: string, query: string) {
      const [candidate] = await search(harness, token, query)
      const saved = await saveCandidate(harness, token, candidate!)
      keys.push(saved.locationKey)
      return saved
    }

    try {
      // Unrelated real events deliberately coexist with the journey under test.
      // They must never satisfy a missing capture for this member.
      await add(bystander.token, 'Chicago')
      const other = await add(bystander.token, 'Monaco')
      await request(httpTestUrl(harness.app))
        .post(`/api/v1/locations/${other.id}/primary`)
        .set(headers(bystander.token))
        .expect(200)
      await search(harness, bystander.token, 'Nowhere special')

      expect(await search(harness, viewer.token, 'Nowhere special')).toEqual([])
      await request(httpTestUrl(harness.app))
        .get('/api/v1/locations/search')
        .query({ q: 'Provider down' })
        .set(headers(viewer.token))
        .expect(503)
      const [failing] = await search(harness, viewer.token, 'Failtown')
      expect((await save(harness, viewer.token, failing!.candidateToken)).status).toBe(
        503
      )

      const first = await add(viewer.token, 'Chicago')
      const second = await add(viewer.token, 'Monaco')
      await request(httpTestUrl(harness.app))
        .post(`/api/v1/locations/${second.id}/primary`)
        .set(headers(viewer.token))
        .expect(200)

      // Exercise the new enqueue-failure log during delete promotion. Its error
      // deliberately contains private values, which the logger must exclude.
      await harness.prisma.weatherSnapshot.updateMany({
        where: { location_key: first.locationKey },
        data: { fetched_at: new Date(harness.clock.now().getTime() - 300_001) },
      })
      vi.spyOn(
        harness.app.get(WeatherRefreshQueue),
        'enqueueLocationRefresh'
      ).mockRejectedValueOnce(
        new Error(`Chicago 41.878 ${viewer.id} ${first.locationKey}`)
      )
      await request(httpTestUrl(harness.app))
        .delete(`/api/v1/locations/${second.id}`)
        .set(headers(viewer.token))
        .expect(200)
      expect(
        await harness.prisma.savedLocation.findUnique({ where: { id: first.id } })
      ).toMatchObject({ is_primary: true })

      const expected = [
        {
          event: 'location_search_failed',
          properties: {
            platform: 'web',
            outcome: 'no_results',
            result_count: 0,
            $ip: null,
          },
        },
        {
          event: 'location_search_failed',
          properties: {
            platform: 'web',
            outcome: 'provider_unavailable',
            result_count: 0,
            $ip: null,
          },
        },
        {
          event: 'location_saved',
          properties: {
            platform: 'mobile',
            outcome: 'forecast_unavailable',
            result_count: 0,
            $ip: null,
          },
        },
        {
          event: 'location_saved',
          properties: {
            platform: 'mobile',
            outcome: 'saved',
            result_count: 1,
            $ip: null,
          },
        },
        {
          event: 'location_saved',
          properties: {
            platform: 'mobile',
            outcome: 'saved',
            result_count: 2,
            $ip: null,
          },
        },
        { event: 'location_switched', properties: { $ip: null } },
      ].map((event) => ({ ...event, distinctId: subject(viewer.id) }))
      const assertJourney = (events: AnalyticsCaptureEvent[]) => {
        expect(events.filter((event) => event.distinctId === subject(viewer.id))).toEqual(
          expected
        )
      }
      assertJourney(harness.analytics)
      const unrelated = harness.analytics.filter(
        (event) => event.distinctId === subject(bystander.id)
      )
      expect(unrelated.map((event) => event.event)).toEqual([
        'location_saved',
        'location_saved',
        'location_switched',
        'location_search_failed',
      ])
      // Negative control: suppress all journey captures while preserving genuine
      // unrelated saved, switched and failed-search events. The proof must fail.
      expect(() => assertJourney(unrelated)).toThrow()

      const rows = harness.telemetryRows
      expect(rows).toHaveLength(harness.analytics.length)
      for (const row of rows) {
        expect(row.user_id).toBeNull()
        expect(Object.keys(row.properties as object).sort()).toEqual(
          row.event_type === 'location_switched'
            ? []
            : ['outcome', 'platform', 'result_count']
        )
      }

      const logs = capturedLogLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) =>
          ['location-capture', 'location-preferences'].includes(String(line.feature))
        )
      expect(logs.map((line) => line.message)).toEqual([
        'location search failed',
        'location save forecast failed',
        'primary location refresh enqueue failed',
      ])
      const serialized = JSON.stringify({
        events: harness.analytics,
        rows: rows.map((row) => ({
          user_id: row.user_id,
          event_type: row.event_type,
          properties: row.properties,
        })),
        logs,
      })
      for (const privateValue of [
        'Nowhere special',
        'Provider down',
        'Failtown',
        'Chicago',
        'Illinois',
        'Monaco',
        'Home',
        '41.878',
        '-87.63',
        '43.738',
        '7.425',
        viewer.id,
        bystander.id,
        ...keys,
      ]) {
        expect(serialized.toLowerCase()).not.toContain(privateValue.toLowerCase())
      }
    } finally {
      // Pseudonymous rows have no user FK, so member cleanup cannot remove them.
      const rows = harness.telemetryRows
      await harness.prisma.telemetryEvent.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      })
    }
  })

  it('1.2b-INT-16 clears the Maestro member to zero locations around the flow and restores the baseline after', async () => {
    const harness = await harnessFor('openweather')
    const member1 = await member(harness)
    const bystander = await member(harness)
    const place = sentinelPlace('int16')
    const suffix = coordinateKeySuffix(place.lat, place.lon)
    for (const viewer of [member1, bystander]) {
      await restoreMobileE2EBaselineLocation(harness.prisma, viewer.id)
    }
    const [sentinel] = await search(harness, member1.token, 'Sentinel int16')
    const saved = await saveCandidate(harness, member1.token, sentinel!)
    expect(saved.locationKey.endsWith(suffix)).toBe(true)

    await clearMobileE2ELocations(harness.prisma, member1.id, suffix)

    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: member1.id } })
    ).toBe(0)
    expect(
      await harness.prisma.weatherSnapshot.count({
        where: { location_key: { endsWith: suffix } },
      })
    ).toBe(0)
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: bystander.id } })
    ).toBe(1)

    await restoreMobileE2EBaselineLocation(harness.prisma, member1.id)
    expect(
      await harness.prisma.savedLocation.findMany({
        where: { user_id: member1.id },
        select: { location_key: true, is_primary: true, city: true },
      })
    ).toEqual([
      {
        location_key: MOBILE_E2E_BASELINE_LOCATION.location_key,
        is_primary: true,
        city: 'Chicago',
      },
    ])
    await expect(clearMobileE2ELocations(harness.prisma, member1.id, '')).rejects.toThrow(
      'sentinel key suffix'
    )
    await expect(restoreMobileE2EBaselineLocation(harness.prisma, ' ')).rejects.toThrow(
      'requires a member ID'
    )
  })
  it('1.2b-INT-17 a save that loses the location-limit race leaves no snapshot behind', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const springfields = await search(harness, viewer.token, 'Springfield')
    await saveCandidate(harness, viewer.token, springfields[0]!, 'Capital')
    await saveCandidate(harness, viewer.token, springfields[1]!, 'Ozarks')

    // Two places no run has saved, so neither key has a snapshot yet. Both
    // saves pass the pre-forecast limit check at two locations; the
    // repository's per-member lock lets exactly one become the third.
    const nonce = randomUUID().replace(/-/g, '').slice(0, 10)
    const suffixes = ['a', 'b'].map((side) => {
      const place = sentinelPlace(`race${side}${nonce}`)
      return coordinateKeySuffix(place.lat, place.lon)
    })
    const [first] = await search(harness, viewer.token, `Sentinel racea${nonce}`)
    const [second] = await search(harness, viewer.token, `Sentinel raceb${nonce}`)
    const responses = await Promise.all([
      save(harness, viewer.token, first!.candidateToken, 'First'),
      save(harness, viewer.token, second!.candidateToken, 'Second'),
    ])

    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([201, 400])
    const loser = responses.find((response) => response.status === 400)!
    expect(exactRequestErrorSchema.parse(loser.body).code).toBe('location_limit_reached')
    const winner = createSavedLocationFromSearchResponseSchema.parse(
      responses.find((response) => response.status === 201)!.body
    ).data
    snapshotKeys.add(winner.locationKey)

    const snapshots = await harness.prisma.weatherSnapshot.findMany({
      where: {
        OR: suffixes.map((suffix) => ({ location_key: { endsWith: suffix } })),
      },
      select: { location_key: true },
    })
    // The winner's snapshot committed with its location; the loser's rolled back.
    expect(snapshots.map((snapshot) => snapshot.location_key)).toEqual([
      winner.locationKey,
    ])
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(3)
  })
})
