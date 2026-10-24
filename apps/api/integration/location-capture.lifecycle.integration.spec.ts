import { httpTestUrl } from '../src/testing/loopback-http-app.js'
import { InternalServerErrorException } from '@nestjs/common'
import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import { expect, it, vi } from 'vitest'
import {
  createSavedLocationFromSearchResponseSchema,
  listSavedLocationsResponseSchema,
  tooManyRequestsHttpErrorSchema,
} from '@couture/api-client/contracts/http'
import { SENTINEL_TEMPERATURE_C } from '../../../scripts/weather-provider-double.mjs'
import type * as PinoConfig from '../src/logger/pino.config.js'
import type { AnalyticsCaptureEvent } from '../src/analytics/analytics.service'
import {
  PrismaLocationPreferencesRepository,
  SavedLocationLimitExceededError,
} from '../src/modules/location-preferences/location-preferences.repository'
import { LocationPreferencesService } from '../src/modules/location-preferences/location-preferences.service'
import { RitualService } from '../src/modules/personalization/ritual.service'
import { createWeatherLocationJobId } from '../src/modules/weather/weather-processor'
import { WeatherQueryService } from '../src/modules/weather/weather-query.service'
import { WeatherRefreshQueue } from '../src/modules/weather/weather-refresh.queue'
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
import {
  describeRealDatabase,
  exactRequestErrorSchema,
  exactUnavailableSchema,
  headers,
  PRIMARY_REFRESH_STALE_MS,
  REFRESH_BUCKET_MINUTES,
  sentinel,
  useLocationCaptureSuite,
} from './helpers/location-capture-harness'

/**
 * Story 1.2b: what happens around a saved location against the real database,
 * Redis queue and provider double: refresh on promotion, the search limit,
 * fail-closed secrets, analytics privacy, the Maestro member reset, and the
 * races the per-member lock settles.
 */

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

describeRealDatabase('Location capture real-database integration: lifecycle', () => {
  const suite = useLocationCaptureSuite()
  const { harnessFor, member, search, searchRequest, save, saveCandidate } = suite

  it('1.2b-INT-11 enqueues a refresh when a legacy location without a snapshot becomes primary, and on delete promotion', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const place = sentinel('int11')
    const [candidate] = await search(harness, viewer.token, place.query)
    const searched = await saveCandidate(harness, viewer.token, candidate!)
    const jobIdAt = (locationKey: string) =>
      createWeatherLocationJobId(locationKey, harness.clock.now(), REFRESH_BUCKET_MINUTES)
    // Exactly five minutes old is still fresh. Provider HTTP timestamps stay
    // real; only the snapshot under this boundary test uses the controlled clock.
    // The key is this run's own, so no other run's snapshot moves with it.
    await harness.prisma.weatherSnapshot.updateMany({
      where: { location_key: searched.locationKey },
      data: {
        fetched_at: new Date(harness.clock.now().getTime() - PRIMARY_REFRESH_STALE_MS),
      },
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

    const job = await harness.queue.getJob(jobIdAt(legacyKey))
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
    expect(await harness.queue.getJob(jobIdAt(searched.locationKey))).toBeUndefined()

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
    const previousBucketJobId = jobIdAt(searched.locationKey)
    harness.clock.advance(1)
    await request(httpTestUrl(harness.app))
      .delete(`/api/v1/locations/${secondId}`)
      .set(headers(viewer.token))
      .expect(200)
    expect(await harness.queue.getJob(previousBucketJobId)).toBeUndefined()
    expect(await harness.queue.getJob(jobIdAt(searched.locationKey))).toBeDefined()
  })

  it('1.2b-INT-13 refuses the 31st search in a minute with the shared 429 and Retry-After', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    // Half a minute into the 12:05 window, so 30 seconds remain: a wrong
    // Retry-After cannot hide behind the one-second floor.
    harness.clock.advance(30_001)

    for (let index = 0; index < 30; index += 1) {
      await search(harness, viewer.token, 'Chicago')
    }
    const geocodingBefore = suite.double.stats.geocoding
    const refused = await searchRequest(harness, viewer.token, 'Chicago')

    expect(refused.status).toBe(429)
    expect(Number(refused.headers['retry-after'])).toBe(30)
    expect(tooManyRequestsHttpErrorSchema.parse(refused.body).statusCode).toBe(429)
    // Refused before the provider: a limited member spends no provider quota.
    expect(suite.double.stats.geocoding).toBe(geocodingBefore)

    harness.clock.advance(30_000)
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
    const statsBefore = { ...suite.double.stats }

    const searched = await searchRequest(harness, viewer.token, 'Chicago')
    const saved = await save(harness, viewer.token, chicago!.candidateToken)

    for (const response of [searched, saved]) {
      expect(response.status).toBe(503)
      expect(exactUnavailableSchema.parse(response.body).code).toBe(
        'location_service_unavailable'
      )
    }
    expect(suite.double.stats).toEqual(statsBefore)
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(0)
  })

  it('1.2b-INT-15 correlates real HTTP location analytics to the member HMAC and excludes private data from events and new logs', async () => {
    const secret = 'location-privacy-test-secret-at-least-32-bytes'
    vi.stubEnv('ANALYTICS_ID_SECRET', secret)
    const harness = await harnessFor('openweather', true)
    const viewer = await member(harness)
    const bystander = await member(harness)
    const home = sentinel('int15')
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
      await searchRequest(harness, viewer.token, 'Provider down').expect(503)
      const [failing] = await search(harness, viewer.token, 'Failtown')
      expect((await save(harness, viewer.token, failing!.candidateToken)).status).toBe(
        503
      )

      // The member's first location is this run's own place, so making its
      // snapshot stale cannot disturb another run.
      const first = await add(viewer.token, home.query)
      const second = await add(viewer.token, 'Monaco')
      await request(httpTestUrl(harness.app))
        .post(`/api/v1/locations/${second.id}/primary`)
        .set(headers(viewer.token))
        .expect(200)

      // Exercise the new enqueue-failure log during delete promotion. Its error
      // deliberately contains private values, which the logger must exclude.
      await harness.prisma.weatherSnapshot.updateMany({
        where: { location_key: first.locationKey },
        data: {
          fetched_at: new Date(
            harness.clock.now().getTime() - PRIMARY_REFRESH_STALE_MS - 1
          ),
        },
      })
      vi.spyOn(
        harness.app.get(WeatherRefreshQueue),
        'enqueueLocationRefresh'
      ).mockRejectedValueOnce(
        new Error(`Sentinelville ${first.latitude} ${viewer.id} ${first.locationKey}`)
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

      // Each durable row, in capture order, with the only property keys it may
      // carry: saves and failed searches keep three coarse fields, a switch none.
      const coarseKeys = ['outcome', 'platform', 'result_count']
      const expectedRows: [eventType: string, propertyKeys: string[]][] = [
        // The bystander's saves, switch and empty search.
        ['location_saved', coarseKeys],
        ['location_saved', coarseKeys],
        ['location_switched', []],
        ['location_search_failed', coarseKeys],
        // The member's journey, in the order `expected` lists it.
        ['location_search_failed', coarseKeys],
        ['location_search_failed', coarseKeys],
        ['location_saved', coarseKeys],
        ['location_saved', coarseKeys],
        ['location_saved', coarseKeys],
        ['location_switched', []],
      ]
      const rows = harness.telemetryRows
      expect(rows).toHaveLength(harness.analytics.length)
      expect(rows).toHaveLength(expectedRows.length)
      for (const [index, [eventType, propertyKeys]] of expectedRows.entries()) {
        const row = rows[index]!
        expect(row.user_id).toBeNull()
        expect(row.event_type).toBe(eventType)
        expect(Object.keys(row.properties as object).sort()).toEqual(propertyKeys)
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
        'Sentinelville',
        'Sentinel County',
        'Monaco',
        'Home',
        '41.878',
        '-87.63',
        String(first.latitude),
        String(first.longitude),
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
    const [sentinelCandidate] = await search(harness, member1.token, 'Sentinel int16')
    const saved = await saveCandidate(harness, member1.token, sentinelCandidate!)
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

    // Two places no run has saved, so neither key has a snapshot yet.
    const places = [sentinel('racea'), sentinel('raceb')]
    const [first] = await search(harness, viewer.token, places[0]!.query)
    const [second] = await search(harness, viewer.token, places[1]!.query)

    // Hold both forecasts at the provider until both saves are inside it. Only
    // then have both passed the pre-forecast limit check at two locations, so
    // the race for the third is settled by the repository's lock and nothing
    // else.
    const barrier = harness.holdForecasts(2)
    const pending = Promise.all([
      save(harness, viewer.token, first!.candidateToken, 'First'),
      save(harness, viewer.token, second!.candidateToken, 'Second'),
    ])
    try {
      await barrier.arrived
      expect(barrier.arrivals()).toBe(2)
    } finally {
      barrier.release()
    }
    const responses = await pending

    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([201, 400])
    const loser = responses.find((response) => response.status === 400)!
    expect(exactRequestErrorSchema.parse(loser.body).code).toBe('location_limit_reached')
    const winner = createSavedLocationFromSearchResponseSchema.parse(
      responses.find((response) => response.status === 201)!.body
    ).data
    suite.trackSnapshotKey(winner.locationKey)

    const snapshots = await harness.prisma.weatherSnapshot.findMany({
      where: {
        OR: places.map((place) => ({ location_key: { endsWith: place.suffix } })),
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
  }, 15_000)

  it('1.2b-INT-18 keeps three locations and one primary when six creates race for one member', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const repository = new PrismaLocationPreferencesRepository(harness.prisma)
    const nonce = randomUUID().slice(0, 8)

    // Straight at the repository: no forecast call staggers the transactions,
    // so all six reach the lock together.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        repository.create(viewer.id, {
          label: `Race ${index}`,
          locationKey: `cc12b-race-${nonce}-${index}`,
          latitude: 10 + index,
          longitude: 10,
          timezone: 'UTC',
        })
      )
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
    const refusals = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : []
    )
    expect(refusals).toHaveLength(3)
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(SavedLocationLimitExceededError)
    }
    expect(
      await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
    ).toBe(3)
    expect(
      await harness.prisma.savedLocation.count({
        where: { user_id: viewer.id, is_primary: true },
      })
    ).toBe(1)
  })

  it('1.2b-INT-19 lets exactly 30 of 35 parallel searches through in one window', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const geocodingBefore = suite.double.stats.geocoding

    const responses = await Promise.all(
      Array.from({ length: 35 }, () => searchRequest(harness, viewer.token, 'Chicago'))
    )

    const statuses = responses.map((response) => response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(30)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
    expect(suite.double.stats.geocoding - geocodingBefore).toBe(30)
    expect(
      await harness.prisma.locationSearchWindow.findUnique({
        where: { user_id: viewer.id },
      })
    ).toMatchObject({ searches: 35 })
  }, 30_000)

  it('1.2b-INT-20 the ritual reads the saved forecast and never the test-env fallback for a searched location', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    const place = sentinel('int20')
    const [candidate] = await search(harness, viewer.token, place.query)
    const saved = await saveCandidate(harness, viewer.token, candidate!)
    const ritual = new RitualService(
      harness.prisma,
      new WeatherQueryService(new WeatherRepository(harness.prisma)),
      harness.app.get(LocationPreferencesService),
      {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
      } as never,
      { capture: vi.fn() } as never
    )

    try {
      const ready = await ritual.getOrCreateRitual(viewer.id)
      expect(ready.weather.current.temperature).toBe(SENTINEL_TEMPERATURE_C)

      // With the saved snapshot gone, a local test run would normally invent
      // synthetic weather. A searched location must refuse it.
      const snapshot = { location_key: saved.locationKey }
      await harness.prisma.forecastSegment.deleteMany({
        where: { weather_snapshot: snapshot },
      })
      await harness.prisma.weatherSnapshot.deleteMany({ where: snapshot })
      await expect(ritual.getOrCreateRitual(viewer.id)).rejects.toBeInstanceOf(
        InternalServerErrorException
      )
      expect(await harness.prisma.weatherSnapshot.count({ where: snapshot })).toBe(0)
    } finally {
      // Recommendations do not cascade with the member.
      await harness.prisma.outfitRecommendation.deleteMany({
        where: { user_id: viewer.id },
      })
    }
  })

  it('1.2b-INT-21 removes the member search window with the member', async () => {
    const harness = await harnessFor('openweather')
    const viewer = await member(harness)
    await search(harness, viewer.token, 'Chicago')
    const window = { where: { user_id: viewer.id } }
    expect(await harness.prisma.locationSearchWindow.count(window)).toBe(1)

    await harness.prisma.user.delete({ where: { id: viewer.id } })

    expect(await harness.prisma.locationSearchWindow.count(window)).toBe(0)
  })
})
