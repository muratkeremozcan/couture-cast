import { listenHttpApp, httpTestUrl } from './helpers/loopback-http-app.js'
import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createSavedLocationFromSearchResponseSchema,
  listSavedLocationsResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchResponseSchema,
  locationUnavailableResponseSchema,
  tooManyRequestsHttpErrorSchema,
  type LocationSearchCandidate,
} from '@couture/api-client/contracts/http'
import { canonicalSpotlightArea } from '@couture/utils'
import {
  SENTINEL_TEMPERATURE_C,
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../scripts/weather-provider-double.mjs'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis'
import type { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import {
  encodeLocationCandidate,
  LOCATION_CANDIDATE_TTL_MS,
  resolveLocationCandidateSecret,
} from '../src/modules/location-preferences/location-candidate-token'
import {
  LOCATION_CAPTURE_CLOCK,
  LOCATION_FORECAST_PROVIDER,
  LOCATION_GEOCODER,
  LocationCaptureService,
} from '../src/modules/location-preferences/location-capture.service'
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

/**
 * Story 1.2b: the capture path against a real migrated database, a real Redis
 * queue and the deterministic provider double. CI sets
 * LOCATION_PREFERENCES_REAL_DB_INTEGRATION=true, and then a failed schema probe
 * fails this suite; it never skips.
 */
const runRealDatabase = process.env.LOCATION_PREFERENCES_REAL_DB_INTEGRATION === 'true'
const describeRealDatabase = runRealDatabase ? describe : describe.skip

type Mode = 'openweather' | 'weatherapi'

interface Harness {
  app: INestApplication
  prisma: PrismaClient
  queue: Queue
  captured: { event: string; properties: unknown }[]
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
  double: WeatherProviderDouble
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
      { provide: PrismaClient, useValue: prisma },
      PrismaLocationPreferencesRepository,
      LocationPreferencesService,
      LocationCaptureService,
      WeatherRepository,
      WeatherRefreshQueue,
      { provide: WEATHER_REFRESH_QUEUE_OPTIONS, useValue: { prefix } },
      { provide: LOCATION_GEOCODER, useValue: geocoder },
      { provide: LOCATION_FORECAST_PROVIDER, useValue: forecastProvider },
      { provide: LOCATION_CAPTURE_CLOCK, useValue: { now: () => new Date() } },
      {
        provide: GuardianConsentStateService,
        useValue: auth.guardianConsentStateService,
      },
      {
        provide: TelemetryService,
        useValue: {
          captureEvent: vi.fn((_userId: string, event: string, properties: unknown) => {
            captured.push({ event, properties })
            return Promise.resolve()
          }),
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

  async function harnessFor(mode: Mode): Promise<Harness> {
    const harness = await createHarness(mode, double)
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
    return locationSearchResponseSchema.parse(response.body).data
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
    expect(locationRequestErrorResponseSchema.parse(response.body).code).toBe(
      'invalid_request'
    )
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
      expect(locationUnavailableResponseSchema.parse(response.body)).toMatchObject({
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
    expect(locationRequestErrorResponseSchema.parse(duplicate.body).code).toBe(
      'location_duplicate'
    )

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
    expect(locationRequestErrorResponseSchema.parse(fourth.body).code).toBe(
      'location_limit_reached'
    )
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
        new Date()
      ),
      encodeLocationCandidate(
        place,
        secret,
        new Date(Date.now() - LOCATION_CANDIDATE_TTL_MS - 1000)
      ),
    ]

    for (const token of tokens) {
      const response = await save(harness, viewer.token, token)
      expect(response.status).toBe(400)
      expect(locationRequestErrorResponseSchema.parse(response.body).code).toBe(
        'invalid_candidate'
      )
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
      expect(locationUnavailableResponseSchema.parse(response.body)).toMatchObject({
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
    expect(en?.displayLabel).toBe('Moscow, Moscow, Russia')
    const first = await saveCandidate(harness, german.token, de!)
    const second = await saveCandidate(harness, english.token, en!)
    expect(first.locationKey).toBe(second.locationKey)

    const [istanbul] = await search(harness, english.token, 'İstanbul', 'tr-TR')
    expect(istanbul?.displayLabel).toBe('İstanbul, İstanbul, Türkiye')
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

    const jobId = createWeatherLocationJobId(legacyKey, new Date(), 5)
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
        createWeatherLocationJobId(searched.locationKey, new Date(), 5)
      )
    ).toBeUndefined()

    // A stale promoted primary is refreshed.
    await harness.prisma.weatherSnapshot.updateMany({
      where: { location_key: searched.locationKey },
      data: { fetched_at: new Date(Date.now() - 6 * 60_000) },
    })
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
    await request(httpTestUrl(harness.app))
      .post(`/api/v1/locations/${secondId}/primary`)
      .set(headers(viewer.token))
    await request(httpTestUrl(harness.app))
      .delete(`/api/v1/locations/${secondId}`)
      .set(headers(viewer.token))
    expect(
      await harness.queue.getJob(
        createWeatherLocationJobId(searched.locationKey, new Date(), 5)
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
    // Start at the top of a window so all 31 land in one minute.
    const secondsIntoMinute = new Date().getUTCSeconds()
    if (secondsIntoMinute > 50) {
      await new Promise((resolve) => setTimeout(resolve, (61 - secondsIntoMinute) * 1000))
    }

    for (let index = 0; index < 30; index += 1) {
      await search(harness, viewer.token, 'Chicago')
    }
    const refused = await request(httpTestUrl(harness.app))
      .get('/api/v1/locations/search')
      .query({ q: 'Chicago' })
      .set(headers(viewer.token))

    expect(refused.status).toBe(429)
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(tooManyRequestsHttpErrorSchema.parse(refused.body).statusCode).toBe(429)
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
      expect(locationUnavailableResponseSchema.parse(response.body).code).toBe(
        'location_service_unavailable'
      )
    }
  })

  it('1.2b-INT-15 keeps query text, coordinates, place names and keys out of analytics', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const [chicago] = await search(harness, viewer.token, 'Chicago')
    await saveCandidate(harness, viewer.token, chicago!)
    await search(harness, viewer.token, 'Nowhere special').catch(() => [])

    const serialized = JSON.stringify(harness.captured)
    expect(harness.captured.map((entry) => entry.event)).toEqual([
      'location_saved',
      'location_search_failed',
    ])
    expect(serialized).not.toMatch(/chicago|illinois|nowhere|41\.8|87\.6|-us-|home/i)
  })
})
