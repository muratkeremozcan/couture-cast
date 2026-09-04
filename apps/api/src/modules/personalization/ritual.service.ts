// Step 22 step 3 owner: define localized comfort notes and intercept headers in apps/api/src/modules/personalization/ritual.service.ts
import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  type OnModuleDestroy,
} from '@nestjs/common'
import {
  PrismaClient,
  type OutfitRecommendation,
  type GarmentItem,
  Prisma,
} from '@prisma/client'
import Redis from 'ioredis'
import { invalidateRitualCacheForUser } from './ritual-cache.js'

export const RITUAL_REDIS_CLIENT = Symbol('RITUAL_REDIS_CLIENT')
const RITUAL_GARMENT_CANDIDATE_LIMIT = 1_000
/** Bounds the capsule graph loaded per ritual request the same way garments are bounded. */
const RITUAL_CAPSULE_CANDIDATE_LIMIT = 1_000

import { WeatherQueryService } from '../weather/weather-query.service.js'
import { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import {
  type CapsuleOccasion,
  trackWardrobeCapsuleRecommended,
} from '@couture/api-client'
import type { CapsuleWithJoins } from './capsule-recommendation.engine.js'
// Story 5.5 Decision 1: the pure generation core -- date helpers, comfort
// math, badge generation and localization -- now lives in
// `ritual-generation.engine.ts`. This service keeps only what genuinely
// needs I/O: location resolution, Redis caching, weather-snapshot self-heal,
// and `OutfitRecommendation` persistence.
import {
  badgeTranslations,
  comfortNotesTranslations,
  generateRitualScenarios,
  hourlySegmentToScenarioInput,
  mapRawBadgeToCanonical,
  matchHourlyScenarioSegments,
  resolveRitualAnchorDate,
  type EngineWeatherInput,
} from './ritual-generation.engine.js'
// Re-exported so `ritual.service.spec.ts`'s existing translation-catalog
// parity tests keep importing from this module unchanged.
export { badgeTranslations, comfortNotesTranslations }
import type { WeatherSnapshotWithSegments } from '../weather/weather.repository.js'
import {
  defaultSupportedLocale,
  resolveAcceptLanguage,
  resolveSupportedLocale,
  type RitualResponse,
  type ScenarioName,
  type ScenarioOutfit,
  type SupportedLocale,
  type WeatherAlert,
  type WeatherCondition,
  type WeatherProvider,
} from '../../contracts/http.js'

/**
 * Story 5.1 decision 5: this service produces outfits WITHOUT the commerce
 * block, and `RitualController` adds `shopThisLook` after it returns.
 *
 * The distinction is load-bearing rather than cosmetic. If the field were part
 * of what this service builds, it would land in the Redis payload written at
 * step 8 and in the `OutfitRecommendation` rows, and a user who toggled the
 * opt-out would keep seeing a CTA for the fifteen minutes the cache lives. The
 * types say so explicitly so that a future edit cannot reintroduce it quietly.
 */
export type ScenarioOutfitWithoutCommerce = Omit<ScenarioOutfit, 'shopThisLook'>

export type RitualDataWithoutCommerce = Omit<RitualResponse['data'], 'outfits'> & {
  outfits: ScenarioOutfitWithoutCommerce[]
}

function buildMockForecastSegmentInputs(now: Date) {
  return Array.from({ length: 48 }, (_, offset) => {
    const forecastAt = new Date(now.getTime() + offset * 60 * 60 * 1000)
    return {
      forecast_at: forecastAt,
      hour_offset: offset,
      temperature: 68.0,
      feels_like: 68.0,
      precipitation_probability: 0.0,
      precipitation_amount: 0.0,
      wind_speed: 5.0,
      wind_gust: null,
      condition: 'clear',
      provider_weather_code: 'clear',
    }
  })
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toWeatherAlerts(alerts: unknown): WeatherAlert[] {
  if (!Array.isArray(alerts)) {
    return []
  }

  const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
    minor: 'low',
    low: 'low',
    moderate: 'medium',
    medium: 'medium',
    severe: 'high',
    extreme: 'high',
    high: 'high',
  }

  return alerts.map((alert): WeatherAlert => {
    const persistedAlert = alert as {
      event: string
      description: string
      start: Date | string
      end: Date | string
      severity?: string
    }

    const rawSeverity = persistedAlert.severity?.toLowerCase() ?? 'medium'
    const mappedSeverity = severityMap[rawSeverity] || 'medium'

    return {
      event: persistedAlert.event,
      description: persistedAlert.description,
      start: toIsoTimestamp(persistedAlert.start),
      end: toIsoTimestamp(persistedAlert.end),
      severity: mappedSeverity,
    }
  })
}

function toWeatherSnapshot(snapshot: WeatherSnapshotWithSegments) {
  return {
    locationKey: snapshot.location_key,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    timezone: snapshot.timezone,
    provider: snapshot.provider as WeatherProvider,
    providerUpdatedAt: snapshot.provider_updated_at.toISOString(),
    fetchedAt: snapshot.fetched_at.toISOString(),
    current: {
      temperature: snapshot.temperature,
      condition: snapshot.condition as WeatherCondition,
    },
    hourly: snapshot.segments.map((segment) => ({
      forecastAt: segment.forecast_at.toISOString(),
      temperature: segment.temperature,
      feelsLike: segment.feels_like,
      precipitationProbability: segment.precipitation_probability,
      precipitationAmount: segment.precipitation_amount,
      windSpeed: segment.wind_speed,
      windGust: segment.wind_gust,
      condition: segment.condition as WeatherCondition,
      providerWeatherCode: segment.provider_weather_code,
    })),
    alerts: toWeatherAlerts(snapshot.alerts),
  }
}

@Injectable()
export class RitualService implements OnModuleDestroy {
  private readonly logger = new Logger(RitualService.name)

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(WeatherQueryService)
    private readonly weatherQueryService: WeatherQueryService,
    @Inject(LocationPreferencesService)
    private readonly locationPreferencesService: LocationPreferencesService,
    @Inject(RITUAL_REDIS_CLIENT)
    private readonly redis: Redis,
    @InjectAnalyticsClient()
    private readonly analyticsClient: AnalyticsClient
  ) {}

  // Refreshes a snapshot's forecast segments to a contiguous 48h window anchored to `now`,
  // guaranteeing a day with morning/midday/evening coverage even when existing data is stale.
  private async upsertMockForecastSegments(snapshotId: string, now: Date): Promise<void> {
    await Promise.all(
      buildMockForecastSegmentInputs(now).map((segment, offset) =>
        this.prisma.forecastSegment.upsert({
          where: { id: `${snapshotId}-seg-${offset}` },
          update: segment,
          create: {
            id: `${snapshotId}-seg-${offset}`,
            weather_snapshot_id: snapshotId,
            ...segment,
          },
        })
      )
    )
  }

  // eslint-disable-next-line complexity
  async getOrCreateRitual(
    userId: string,
    locationId?: string,
    acceptLanguage?: string,
    localeOverride?: SupportedLocale,
    occasion?: CapsuleOccasion
  ): Promise<RitualDataWithoutCommerce> {
    // 1. Resolve Location
    const locations = await this.locationPreferencesService.listLocations(userId)
    let selectedLocation = locations.find((l) => l.id === locationId)

    if (locationId && !selectedLocation) {
      throw new BadRequestException('Location preferences not found or not owned by user')
    }

    if (!selectedLocation) {
      selectedLocation = locations.find((l) => l.isPrimary) ?? locations[0]
    }

    if (!selectedLocation) {
      throw new BadRequestException('No location preferences found for user')
    }

    const isTestEnv =
      process.env.TEST_ENV === 'local' ||
      process.env.TEST_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'preview'

    // 2. Load Comfort Preferences, User Profile, and Weather Snapshot
    const [comfortPrefs, userProfile, weatherResult] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.prisma.userProfile.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(selectedLocation.locationKey),
    ])

    /**
     * Authoritative capsule revision for this request. The schema default is
     * 0, so defaulting a missing profile to anything else would make every
     * cached and persisted recommendation compare either always stale or never
     * stale.
     */
    const currentCapsuleRevision = userProfile?.capsule_revision ?? 0

    const savedLocaleCandidate =
      userProfile?.preferences &&
      typeof userProfile.preferences === 'object' &&
      !Array.isArray(userProfile.preferences) &&
      'locale' in userProfile.preferences &&
      typeof userProfile.preferences.locale === 'string'
        ? userProfile.preferences.locale
        : undefined
    const savedLocale = resolveSupportedLocale(savedLocaleCandidate)
    const locale =
      localeOverride ??
      savedLocale ??
      resolveAcceptLanguage(acceptLanguage) ??
      defaultSupportedLocale

    let weatherSnapshot = weatherResult.data

    if (weatherResult.status === 'unavailable' || !weatherResult.data) {
      if (isTestEnv) {
        const now = new Date()
        const providerUpdatedAt = new Date(now.getTime() - 30 * 60 * 1000)
        const timezone = selectedLocation.timezone || 'UTC'

        let snapshot = await this.prisma.weatherSnapshot.findFirst({
          where: { location_key: selectedLocation.locationKey },
          include: { segments: true },
        })

        if (!snapshot) {
          const snapshotId = `mock-wx-${selectedLocation.locationKey}`
          snapshot = await this.prisma.weatherSnapshot.create({
            data: {
              id: snapshotId,
              location: selectedLocation.city || selectedLocation.label || 'Unknown',
              location_key: selectedLocation.locationKey,
              latitude: selectedLocation.latitude ?? 0.0,
              longitude: selectedLocation.longitude ?? 0.0,
              timezone,
              provider: 'openweather',
              provider_updated_at: providerUpdatedAt,
              temperature: 68.0,
              condition: 'clear',
              fetched_at: now,
              segments: {
                create: buildMockForecastSegmentInputs(now).map((segment, offset) => ({
                  id: `${snapshotId}-seg-${offset}`,
                  ...segment,
                })),
              },
            },
            include: { segments: true },
          })
        }

        weatherSnapshot = snapshot
      } else {
        throw new InternalServerErrorException(
          weatherResult.message || 'Weather data is temporarily unavailable.'
        )
      }
    }

    if (!weatherSnapshot) {
      throw new InternalServerErrorException(
        weatherResult.message || 'Weather data is temporarily unavailable.'
      )
    }

    const timezone = weatherSnapshot.timezone

    const runsColdWarm = comfortPrefs?.runs_cold_warm ?? 'neutral'
    const windTolerance = comfortPrefs?.wind_tolerance ?? 'medium'
    const precipPreparedness = comfortPrefs?.precip_preparedness ?? 'medium'
    const comfortUpdatedAt = comfortPrefs?.updated_at ?? new Date(0)

    // Determine target date (Story 5.5 Decision 2's anchor-date helper).
    const now = new Date()
    let targetLocalDateStr = resolveRitualAnchorDate(now, timezone)
    const originalTargetLocalDateStr = targetLocalDateStr

    // Get latest garment update timestamp for staleness check
    let latestGarment: GarmentItem | null = null
    if (this.prisma.garmentItem.findFirst) {
      latestGarment = await this.prisma.garmentItem.findFirst({
        where: {
          user_id: userId,
          retention_status: 'active',
          upload_status: 'ready',
          category: { not: null },
          comfort_range: { not: null },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      })
    }
    const wardrobeUpdatedAt = latestGarment?.updated_at ?? new Date(0)
    const stalenessThreshold = new Date(
      Math.max(comfortUpdatedAt.getTime(), wardrobeUpdatedAt.getTime())
    )

    // 3. Check Redis Cache using target date in cache key
    /**
     * `occasion` changes capsule eligibility, so it is part of the cache
     * identity. Without it the first request of the day pins one occasion's
     * result for every other occasion until the TTL expires.
     */
    const occasionKey = occasion ?? 'any'
    const cacheKey = `ritual:${userId}:${selectedLocation.locationKey}:${targetLocalDateStr}:${locale}:${occasionKey}`
    let cachedString: string | null = null
    try {
      cachedString = await this.redis.get(cacheKey)
    } catch (err) {
      console.warn('Redis cache get failed:', err instanceof Error ? err.message : err)
    }

    if (cachedString) {
      try {
        const cachedPayload = JSON.parse(cachedString) as {
          weather: { fetchedAt: string }
          generatedAt: string
          capsuleRevision?: unknown
          data: RitualDataWithoutCommerce
        }
        const cachedFetchedAt = cachedPayload.weather.fetchedAt
        const cachedGeneratedAt = new Date(cachedPayload.generatedAt)

        /**
         * A missing, malformed, or non-integer cached revision is treated as
         * stale. Without this check the cache short-circuits before the
         * database revision comparison and can serve a capsule the user has
         * already changed or deleted.
         */
        const cachedCapsuleRevision = cachedPayload.capsuleRevision
        const capsuleRevisionFresh =
          typeof cachedCapsuleRevision === 'number' &&
          Number.isInteger(cachedCapsuleRevision) &&
          cachedCapsuleRevision === currentCapsuleRevision

        if (
          cachedFetchedAt === weatherSnapshot.fetched_at.toISOString() &&
          cachedGeneratedAt.getTime() >= stalenessThreshold.getTime() &&
          capsuleRevisionFresh
        ) {
          return cachedPayload.data
        }
      } catch {
        // Fallback to recalculation on parse failure
      }
    }

    // 4. Find timezone-aligned forecast segments for a single target date.
    // Story 5.5 Decision 1/3: the exact-hour match plus fallback-to-most-recent
    // fully-covered-date scan is now the engine's hourly adapter.
    let matched = matchHourlyScenarioSegments(
      weatherSnapshot.segments,
      timezone,
      targetLocalDateStr
    )

    // Self-heal: existing segments have no date with full morning/midday/evening coverage
    // (e.g. stale staging seed data). Refresh a contiguous 48h window anchored to now
    // rather than surfacing a 500 for a condition the app can recover from.
    if (!matched && isTestEnv) {
      await this.upsertMockForecastSegments(weatherSnapshot.id, new Date())
      const refreshedSnapshot = await this.prisma.weatherSnapshot.findUniqueOrThrow({
        where: { id: weatherSnapshot.id },
        include: { segments: true },
      })
      weatherSnapshot = refreshedSnapshot
      matched = matchHourlyScenarioSegments(
        refreshedSnapshot.segments,
        timezone,
        originalTargetLocalDateStr
      )
    }

    if (!matched) {
      throw new InternalServerErrorException(
        'Required daily scenario forecast segments (morning, midday, evening) not found in weather snapshot.'
      )
    }

    targetLocalDateStr = matched.resolvedLocalDate
    const {
      morning: morningSegment,
      midday: middaySegment,
      evening: eveningSegment,
    } = matched

    const targetScenarios: { scenario: ScenarioName; segment: typeof morningSegment }[] =
      [
        { scenario: 'morning', segment: morningSegment },
        { scenario: 'midday', segment: middaySegment },
        { scenario: 'evening', segment: eveningSegment },
      ]

    // 5. Query user garments and capsules
    const [userGarments, userCapsules] = await Promise.all([
      this.prisma.garmentItem.findMany({
        where: {
          user_id: userId,
          retention_status: 'active',
          upload_status: 'ready',
          category: { not: null },
          comfort_range: { not: null },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
        take: RITUAL_GARMENT_CANDIDATE_LIMIT,
      }),
      this.prisma.outfitCapsule?.findMany
        ? this.prisma.outfitCapsule.findMany({
            where: { user_id: userId },
            include: { garment_joins: { include: { garment: true } } },
            orderBy: [{ is_favorite: 'desc' }, { updated_at: 'desc' }, { id: 'asc' }],
            take: RITUAL_CAPSULE_CANDIDATE_LIMIT,
          })
        : Promise.resolve([]),
    ])

    // Story 5.5 Decision 1: one engine call generates all three canonical
    // scenario results. Comfort notes are locale-baked (never persisted, so
    // this is safe); reasoning badges stay in English canonical form for
    // persistence, localized separately below at read time.
    const weatherInput: EngineWeatherInput = {
      status: 'available',
      scenarios: [
        hourlySegmentToScenarioInput('morning', morningSegment),
        hourlySegmentToScenarioInput('midday', middaySegment),
        hourlySegmentToScenarioInput('evening', eveningSegment),
      ],
    }
    const engineResult = generateRitualScenarios({
      userId,
      targetLocalDate: targetLocalDateStr,
      locale,
      comfortPreferences: { runsColdWarm, windTolerance, precipPreparedness },
      eligibleGarments: userGarments,
      eligibleCapsules: userCapsules as unknown as CapsuleWithJoins[],
      weather: weatherInput,
      occasion,
    })

    // 6. Build or retrieve outfit recommendations
    const outfits: ScenarioOutfitWithoutCommerce[] = []
    for (const [scenarioIndex, { scenario, segment }] of targetScenarios.entries()) {
      let recommendation: OutfitRecommendation | null =
        await this.prisma.outfitRecommendation.findFirst({
          where: {
            user_id: userId,
            forecast_segment_id: segment.id,
            scenario,
          },
        })

      let persistedThisRequest = false
      const isStale =
        recommendation &&
        (recommendation.created_at.getTime() < stalenessThreshold.getTime() ||
          recommendation.capsule_revision !== currentCapsuleRevision)

      if (!recommendation || isStale) {
        persistedThisRequest = true
        const generated = engineResult.scenarios[scenarioIndex]!

        // Write to database
        if (recommendation) {
          try {
            recommendation = await this.prisma.outfitRecommendation.update({
              where: { id: recommendation.id },
              data: {
                garment_ids: generated.garmentIds,
                reasoning_badges: generated.reasoningBadges,
                capsule_id: generated.capsuleId,
                capsule_revision: currentCapsuleRevision,
              },
            })
          } catch (error) {
            console.warn(
              'Failed to update stale recommendation:',
              error instanceof Error ? error.message : error
            )
            throw error
          }
        } else {
          try {
            recommendation = await this.prisma.outfitRecommendation.create({
              data: {
                user_id: userId,
                forecast_segment_id: segment.id,
                scenario,
                garment_ids: generated.garmentIds,
                reasoning_badges: generated.reasoningBadges,
                capsule_id: generated.capsuleId,
                capsule_revision: currentCapsuleRevision,
              },
            })
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              recommendation = await this.prisma.outfitRecommendation.findFirst({
                where: {
                  user_id: userId,
                  forecast_segment_id: segment.id,
                  scenario,
                },
              })
              if (!recommendation) {
                throw error
              }
            } else {
              throw error
            }
          }
        }
      }

      const rec = recommendation

      /**
       * Auto-filled garments are derived rather than stored: they are exactly
       * the persisted garments that the capsule itself does not contain.
       */
      const recCapsule = rec.capsule_id
        ? userCapsules.find((capsule) => capsule.id === rec.capsule_id)
        : undefined
      const recGarmentIds = (rec.garment_ids as string[]) || []
      const capsuleGarmentIds = new Set(
        recCapsule?.garment_joins.map((join) => join.garment_id) ?? []
      )
      const autoFilledGarmentIds = recCapsule
        ? recGarmentIds.filter((garmentId) => !capsuleGarmentIds.has(garmentId))
        : []

      if (persistedThisRequest && recCapsule) {
        try {
          this.analyticsClient.capture(
            trackWardrobeCapsuleRecommended({
              analyticsSubjectId: userId,
              capsuleId: recCapsule.id,
              scenario: rec.scenario as ScenarioName,
              completeness: autoFilledGarmentIds.length === 0 ? 'complete' : 'partial',
              autoFilledGarmentCount: autoFilledGarmentIds.length,
              ...(occasion ? { requestedOccasion: occasion } : {}),
            })
          )
        } catch (error) {
          this.logger.warn(
            `Capsule recommendation telemetry failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`
          )
        }
      }

      outfits.push({
        id: rec.id,
        scenario: rec.scenario as ScenarioName,
        // Story 5.1 decision 5: `shopThisLook` is deliberately ABSENT here. Two
        // branches independently fixed the same compile break, one by widening
        // the return type to ScenarioOutfitWithoutCommerce and one by writing
        // `shopThisLook: null` at this line, and the merge silently kept both.
        // Writing the key here puts it in the Redis payload at step 8 and in the
        // persisted OutfitRecommendation rows, which is the cache poisoning the
        // whole assembly-point decision exists to prevent. The controller adds
        // the key after this service returns.
        garmentIds: recGarmentIds,
        capsuleId: recCapsule?.id ?? null,
        capsuleName: recCapsule?.name ?? null,
        autoFilledGarmentIds,
        reasoningBadges: (Array.isArray(rec.reasoning_badges)
          ? (rec.reasoning_badges as unknown as {
              key?: string
              label?: string
              bullets?: string[]
            }[])
          : []
        )
          .filter(
            (badge): badge is { key?: string; label?: string; bullets?: string[] } => {
              return badge !== null && typeof badge === 'object'
            }
          )
          .map((badge) => mapRawBadgeToCanonical(badge, locale)),
        // Story 5.5 Decision 1: comfort notes are locale-baked by the engine
        // and always recomputed for the current request's locale, exactly as
        // before -- never persisted, so a reused recommendation still gets
        // fresh, correctly localized text.
        comfortNotes: engineResult.scenarios[scenarioIndex]!.comfortNotes,
      })
    }

    // 7. Compile Response data
    const generalBadges = Array.from(
      new Set(outfits.flatMap((o) => o.reasoningBadges.map((b) => b.label)))
    )

    const responseData = {
      weather: toWeatherSnapshot(weatherSnapshot),
      outfits,
      badges: generalBadges,
    }

    // 8. Write to Redis Cache
    const cachePayload = {
      generatedAt: new Date().toISOString(),
      weather: responseData.weather,
      capsuleRevision: currentCapsuleRevision,
      data: responseData,
    }
    try {
      await this.redis.set(cacheKey, JSON.stringify(cachePayload), 'EX', 900)
    } catch (err) {
      console.warn('Redis cache set failed:', err instanceof Error ? err.message : err)
    }

    return responseData
  }

  // Story 2.2 Task 2 step 3 owner: implement chunk-based Redis key invalidation
  /**
   * Delegates to {@link invalidateRitualCacheForUser} so the key scheme has one
   * owner. Kept as a method because `RitualService` is the cache's writer and
   * callers reasonably ask it, not a loose function, to clear one.
   */
  async invalidateUserCache(userId: string): Promise<boolean> {
    const invalidated = await invalidateRitualCacheForUser(this.redis, userId)
    if (!invalidated) {
      this.logger.warn(`Redis cache invalidation failed for user ${userId}`)
    }
    return invalidated
  }

  async onModuleDestroy() {
    await this.redis.quit()
  }
}
