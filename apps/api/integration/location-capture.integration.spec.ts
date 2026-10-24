import { httpTestUrl } from '../src/testing/loopback-http-app.js'
import { classifyClimateBand, canonicalSpotlightArea } from '@couture/utils'
import request from 'supertest'
import { expect, it } from 'vitest'
import { SENTINEL_TEMPERATURE_C } from '../../../scripts/weather-provider-double.mjs'
import {
  coordinateKeySuffix,
  DOUBLE_DAILY_DAYS,
  DOUBLE_DAILY_MAX_C,
  DOUBLE_DAILY_MIN_C,
} from '../../../scripts/lib/weather-provider-double-data.mjs'
import { encodeLocationCandidate } from '../src/modules/location-preferences/location-candidate-token'
import { WeatherQueryService } from '../src/modules/weather/weather-query.service'
import {
  parseDailySummaries,
  WeatherRepository,
} from '../src/modules/weather/weather.repository'
import {
  CANDIDATE_LIFETIME_MS,
  DEADLINE_EARLY_SLACK_MS,
  DEADLINE_MARGIN_MS,
  describeRealDatabase,
  exactRequestErrorSchema,
  exactUnavailableSchema,
  headers,
  PROVIDER_DEADLINE_MS,
  sentinel,
  useLocationCaptureSuite,
} from './helpers/location-capture-harness'

/** The double answers 48 future hours, the provider's full window; each is a segment. */
const DOUBLE_HOURLY_SEGMENTS = 48

/**
 * Story 1.2b: search and save against a real migrated database, a real Redis
 * queue and the deterministic provider double. The lifecycle half (refresh,
 * limits, privacy, races) lives in location-capture.lifecycle.integration.spec.ts.
 */
describeRealDatabase(
  'Location capture real-database integration: search and save',
  () => {
    const suite = useLocationCaptureSuite()
    const { harnessFor, member, search, searchRequest, save, saveCandidate } = suite

    it('1.2b-INT-01 searches, saves the first location as primary and persists its snapshot', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      // A place only this run can save: no other run's snapshot can satisfy the
      // lookups below.
      const place = sentinel('int01')

      const candidates = await search(harness, viewer.token, place.query, 'fr-FR')
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        country: 'US',
        city: 'Sentinelville',
        region: 'Sentinel County',
        displayLabel: 'Sentinelleville, Sentinel County, États-Unis',
      })

      const forecastsBefore = suite.double.stats.forecast
      const location = await saveCandidate(harness, viewer.token, candidates[0]!)
      // One forecast call per save: it supplies the timezone and the snapshot.
      expect(suite.double.stats.forecast).toBe(forecastsBefore + 1)
      expect(location).toMatchObject({
        isPrimary: true,
        timezone: 'America/Denver',
        city: 'Sentinelville',
        region: 'Sentinel County',
        country: 'US',
        locationKey: place.locationKey,
      })

      const snapshots = await harness.prisma.weatherSnapshot.findMany({
        where: { location_key: location.locationKey },
        include: { segments: true },
      })
      expect(snapshots).toHaveLength(1)
      const [snapshot] = snapshots
      expect(snapshot?.temperature).toBe(SENTINEL_TEMPERATURE_C)
      expect(snapshot?.segments).toHaveLength(DOUBLE_HOURLY_SEGMENTS)
      // The daily projection Community reads the climate band from.
      const daily = parseDailySummaries(snapshot!.daily_summaries)
      expect(daily).toHaveLength(DOUBLE_DAILY_DAYS)
      expect(daily[0]).toMatchObject({
        temperatureMin: DOUBLE_DAILY_MIN_C,
        temperatureMax: DOUBLE_DAILY_MAX_C,
      })
      expect(classifyClimateBand(daily)).not.toBeNull()

      const latest = await new WeatherQueryService(
        new WeatherRepository(harness.prisma)
      ).getLatestWeather(location.locationKey)
      expect(latest.status).toBe('fresh')

      expect(canonicalSpotlightArea(location)).toEqual({
        country: 'US',
        region: 'sentinel county',
        city: 'sentinelville',
      })
    })

    it('1.2b-INT-02 refuses a short query with 400 before any provider call', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      const before = suite.double.stats.geocoding

      const response = await searchRequest(harness, viewer.token, 'C')

      expect(response.status).toBe(400)
      expect(exactRequestErrorSchema.parse(response.body).code).toBe('invalid_request')
      expect(suite.double.stats.geocoding).toBe(before)
    })

    it('1.2b-INT-03 answers a typed retryable 503 for a provider that fails or exceeds 3 seconds', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)

      for (const q of ['Provider down', 'Provider slow']) {
        const startedAt = Date.now()
        const response = await searchRequest(harness, viewer.token, q)
        const elapsed = Date.now() - startedAt
        expect(response.status).toBe(503)
        expect(exactUnavailableSchema.parse(response.body)).toMatchObject({
          code: 'provider_unavailable',
          retryable: true,
        })
        expect(elapsed).toBeLessThan(PROVIDER_DEADLINE_MS + DEADLINE_MARGIN_MS)
        if (q === 'Provider slow') {
          // The slow double answers after 4 s: a shorter deadline gives up early.
          expect(elapsed).toBeGreaterThanOrEqual(
            PROVIDER_DEADLINE_MS - DEADLINE_EARLY_SLACK_MS
          )
        }
      }
      expect(harness.captured.map((entry) => entry.properties)).toEqual([
        { platform: 'web', outcome: 'provider_unavailable', resultCount: 0 },
        { platform: 'web', outcome: 'provider_timeout', resultCount: 0 },
      ])
    }, 15_000)

    it('1.2b-INT-04a keeps same-name cities in different regions as two keys and refuses a duplicate', async () => {
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
      expect(illinois.locationKey).toBe('springfield-illinois-us-39-782n-89-650w')
      expect(missouri.locationKey).toBe('springfield-missouri-us-37-209n-93-292w')

      const duplicate = await save(
        harness,
        viewer.token,
        springfields[0]!.candidateToken,
        'Again'
      )
      expect(duplicate.status).toBe(400)
      expect(exactRequestErrorSchema.parse(duplicate.body).code).toBe(
        'location_duplicate'
      )
      expect(
        await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
      ).toBe(2)
    })

    it('1.2b-INT-04b saves a place with no region and resolves its spotlight at country level', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)

      const [monaco] = await search(harness, viewer.token, 'Monaco')
      const saved = await saveCandidate(harness, viewer.token, monaco!, 'Coast')

      expect(saved.region).toBeNull()
      expect(canonicalSpotlightArea(saved)).toEqual({
        country: 'MC',
        region: null,
        city: null,
      })
    })

    it('1.2b-INT-04c refuses a fourth location before any forecast call', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      const springfields = await search(harness, viewer.token, 'Springfield')
      const [monaco] = await search(harness, viewer.token, 'Monaco')
      for (const candidate of [...springfields, monaco!]) {
        await saveCandidate(harness, viewer.token, candidate, candidate.city)
      }

      const forecastsBefore = suite.double.stats.forecast
      const [chicago] = await search(harness, viewer.token, 'Chicago')
      const fourth = await save(harness, viewer.token, chicago!.candidateToken, 'Fourth')

      expect(fourth.status).toBe(400)
      expect(exactRequestErrorSchema.parse(fourth.body).code).toBe(
        'location_limit_reached'
      )
      expect(suite.double.stats.forecast).toBe(forecastsBefore)
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

    it('1.2b-INT-06 refuses tampered and foreign-environment tokens with 400', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      const [chicago] = await search(harness, viewer.token, 'Chicago')
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
      ]

      for (const token of tokens) {
        const response = await save(harness, viewer.token, token)
        expect(response.status).toBe(400)
        expect(exactRequestErrorSchema.parse(response.body).code).toBe(
          'invalid_candidate'
        )
      }
      expect(
        await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
      ).toBe(0)
    })

    it('1.2b-INT-06b keeps a searched token savable for 15 minutes and refuses it after', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      const [kept] = await search(harness, viewer.token, 'Chicago')
      const [expired] = await search(harness, viewer.token, 'Monaco')

      harness.clock.advance(CANDIDATE_LIFETIME_MS - 1)
      await saveCandidate(harness, viewer.token, kept!)
      harness.clock.advance(1)
      const refused = await save(harness, viewer.token, expired!.candidateToken)

      expect(refused.status).toBe(400)
      expect(exactRequestErrorSchema.parse(refused.body).code).toBe('invalid_candidate')
      expect(
        await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
      ).toBe(1)
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

    it('1.2b-INT-08 saves nothing when the save forecast fails, returns an invalid timezone or exceeds 3 seconds', async () => {
      const harness = await harnessFor('openweather')
      const viewer = await member(harness)
      const queries = ['Failtown', 'Badzone', 'Slowtown'] as const
      const candidates = [
        ...(await search(harness, viewer.token, queries[0])),
        ...(await search(harness, viewer.token, queries[1])),
        ...(await search(harness, viewer.token, queries[2])),
      ]
      // These keys are shared by every run, so count what this test adds.
      const byKey = {
        OR: candidates.map((candidate) => ({
          location_key: {
            endsWith: coordinateKeySuffix(candidate.latitude, candidate.longitude),
          },
        })),
      }
      const persisted = async () => ({
        snapshots: await harness.prisma.weatherSnapshot.count({ where: byKey }),
        ingestionStates: await harness.prisma.weatherIngestionState.count({
          where: byKey,
        }),
      })
      expect(candidates.map((candidate) => candidate.city)).toEqual(queries)
      const before = await persisted()

      for (const [index, query] of queries.entries()) {
        const candidate = candidates[index]!
        const startedAt = Date.now()
        const response = await save(harness, viewer.token, candidate.candidateToken)
        const elapsed = Date.now() - startedAt
        expect(response.status).toBe(503)
        expect(exactUnavailableSchema.parse(response.body)).toMatchObject({
          code: 'provider_unavailable',
          retryable: true,
        })
        if (query === 'Slowtown') {
          // The slow double answers after 4 s; the save gives up at 3.
          expect(elapsed).toBeGreaterThanOrEqual(
            PROVIDER_DEADLINE_MS - DEADLINE_EARLY_SLACK_MS
          )
          expect(elapsed).toBeLessThan(PROVIDER_DEADLINE_MS + DEADLINE_MARGIN_MS)
        }
      }
      expect(
        await harness.prisma.savedLocation.count({ where: { user_id: viewer.id } })
      ).toBe(0)
      // Badzone's forecast arrives whole and only fails validation: nothing of
      // it may be persisted either.
      expect(await persisted()).toEqual(before)
    }, 15_000)

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
      const place = sentinel('int10')

      expect(await search(harness, viewer.token, 'Atlantis')).toEqual([])
      const [candidate] = await search(harness, viewer.token, place.query)
      expect(candidate).toMatchObject({ country: 'US', region: 'Sentinel County' })
      const location = await saveCandidate(harness, viewer.token, candidate!)
      expect(location.timezone).toBe('America/Denver')
      const snapshots = await harness.prisma.weatherSnapshot.findMany({
        where: { location_key: place.locationKey },
      })
      expect(snapshots).toEqual([
        expect.objectContaining({
          provider: 'weatherapi',
          temperature: SENTINEL_TEMPERATURE_C,
        }),
      ])
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
  }
)
