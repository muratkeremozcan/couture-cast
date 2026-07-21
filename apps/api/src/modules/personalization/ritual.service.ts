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

export const RITUAL_REDIS_CLIENT = Symbol('RITUAL_REDIS_CLIENT')

import { WeatherQueryService } from '../weather/weather-query.service.js'
import { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import type { WeatherSnapshotWithSegments } from '../weather/weather.repository.js'
import type {
  ScenarioName,
  ScenarioOutfit,
  WeatherAlert,
  WeatherCondition,
  WeatherProvider,
  RitualResponse,
  WindTolerance,
  PrecipPreparedness,
} from '../../contracts/http.js'

const formattersMap = new Map<string, Intl.DateTimeFormat>()

function getHourInTimezone(date: Date, timezone: string): number {
  const key = `hour-${timezone}`
  let formatter = formattersMap.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
    formattersMap.set(key, formatter)
  }
  return parseInt(formatter.format(date), 10)
}

function getLocalDateString(date: Date, timezone: string): string {
  const key = `date-${timezone}`
  let formatter = formattersMap.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formattersMap.set(key, formatter)
  }
  return formatter.format(date)
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

// Wind threshold limits in meters per second (m/s) based on wind tolerance setting
const WIND_THRESHOLD_M_S: Record<WindTolerance, number> = {
  low: 3, // Sensitive to wind; flag wind-blocking layer at lower speeds
  medium: 5, // Moderate tolerance
  high: 8, // High tolerance; flag only in high wind speeds
} as const

// Precipitation probability threshold (0.0 to 1.0) based on preparedness setting
const PRECIP_PROB_THRESHOLD: Record<PrecipPreparedness, number> = {
  high: 0.2, // Highly prepared/cautious; suggest outerwear/umbrella for low probability
  medium: 0.4, // Moderate caution
  low: 0.7, // Low caution; suggest only for high probability
} as const

// Precipitation amount threshold in millimeters (mm) based on preparedness setting
const PRECIP_AMOUNT_THRESHOLD_MM: Record<PrecipPreparedness, number> = {
  high: 0.1, // Cautious; suggest for very light rain
  medium: 0.5, // Moderate
  low: 2.0, // High threshold; suggest only for heavier rain
} as const

function getWindThreshold(windTolerance: WindTolerance): number {
  return WIND_THRESHOLD_M_S[windTolerance]
}

function getRainProbThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_PROB_THRESHOLD[precipPreparedness]
}

function getRainAmountThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_AMOUNT_THRESHOLD_MM[precipPreparedness]
}

const BADGE_MAPPING = [
  { keyword: 'wind', key: 'wind_layer', label: 'Wind layer' },
  { keyword: 'rain', key: 'rain_ready', label: 'Rain-ready' },
  { keyword: 'evening', key: 'evening_chill', label: 'Evening chill' },
  { keyword: 'chill', key: 'evening_chill', label: 'Evening chill' },
  { keyword: 'commute', key: 'commute_warmth', label: 'Commute warmth' },
  { keyword: 'warmth', key: 'commute_warmth', label: 'Commute warmth' },
  { keyword: 'sun', key: 'sun_protection', label: 'Sun protection' },
  { keyword: 'protection', key: 'sun_protection', label: 'Sun protection' },
  { keyword: 'light', key: 'light_layers', label: 'Light layers' },
  { keyword: 'layer', key: 'light_layers', label: 'Light layers' },
  { keyword: 'breathable', key: 'breathable_comfort', label: 'Breathable comfort' },
  { keyword: 'comfort', key: 'breathable_comfort', label: 'Breathable comfort' },
] as const

function mapRawBadgeToCanonical(badge: {
  key?: string
  label?: string
  bullets?: string[]
}): { key: string; label: string; bullets: string[] } {
  const inputLabel = badge.label || ''
  const inputKey = badge.key || ''
  const searchStr = (inputKey || inputLabel).toLowerCase().replace(/[\s-_]+/g, '')

  const match = BADGE_MAPPING.find((item) => searchStr.includes(item.keyword))
  const key = match ? match.key : 'daily_base'
  const label = match ? match.label : 'Daily base'

  const bullets = Array.isArray(badge.bullets)
    ? badge.bullets.filter((b): b is string => typeof b === 'string')
    : []

  return { key, label, bullets }
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
    private readonly redis: Redis
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
    locationId?: string
  ): Promise<RitualResponse['data']> {
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

    // 2. Load Comfort Preferences and Weather Snapshot
    const [comfortPrefs, weatherResult] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(selectedLocation.locationKey),
    ])

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
              provider: 'mock-provider',
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

    // Determine target date and hour
    const now = new Date()
    const currentLocalHour = getHourInTimezone(now, timezone)
    let targetTime = now.getTime()
    if (currentLocalHour >= 8) {
      targetTime += 24 * 60 * 60 * 1000
    }
    let targetLocalDateStr = getLocalDateString(new Date(targetTime), timezone)
    const originalTargetLocalDateStr = targetLocalDateStr

    // Get latest garment update timestamp for staleness check
    let latestGarment: GarmentItem | null = null
    if (this.prisma.garmentItem.findFirst) {
      latestGarment = await this.prisma.garmentItem.findFirst({
        where: { user_id: userId },
        orderBy: { updated_at: 'desc' },
      })
    }
    const wardrobeUpdatedAt = latestGarment?.updated_at ?? new Date(0)
    const stalenessThreshold = new Date(
      Math.max(comfortUpdatedAt.getTime(), wardrobeUpdatedAt.getTime())
    )

    // 3. Check Redis Cache using target date in cache key
    const cacheKey = `ritual:${userId}:${selectedLocation.locationKey}:${targetLocalDateStr}`
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
          data: RitualResponse['data']
        }
        const cachedFetchedAt = cachedPayload.weather.fetchedAt
        const cachedGeneratedAt = new Date(cachedPayload.generatedAt)

        if (
          cachedFetchedAt === weatherSnapshot.fetched_at.toISOString() &&
          cachedGeneratedAt.getTime() >= stalenessThreshold.getTime()
        ) {
          return cachedPayload.data
        }
      } catch {
        // Fallback to recalculation on parse failure
      }
    }

    // 4. Find timezone-aligned forecast segments for a single target date
    const segments = weatherSnapshot.segments
    let morningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 8
    )
    let middaySegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 13
    )
    let eveningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 19
    )

    // Fallback: If segments for targetLocalDateStr are not found (e.g. database seed/data is stale),
    // fall back to using the latest date present in the segments array.
    if ((!morningSegment || !middaySegment || !eveningSegment) && segments.length > 0) {
      const segmentDates = segments.map((s) =>
        getLocalDateString(s.forecast_at, timezone)
      )
      const uniqueDates = [...new Set(segmentDates)]
      for (const fallbackDate of uniqueDates.reverse()) {
        const fallbackMorning = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 8
        )
        const fallbackMidday = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 13
        )
        const fallbackEvening = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 19
        )
        if (fallbackMorning && fallbackMidday && fallbackEvening) {
          morningSegment = fallbackMorning
          middaySegment = fallbackMidday
          eveningSegment = fallbackEvening
          targetLocalDateStr = fallbackDate
          break
        }
      }
    }

    // Self-heal: existing segments have no date with full morning/midday/evening coverage
    // (e.g. stale staging seed data). Refresh a contiguous 48h window anchored to now
    // rather than surfacing a 500 for a condition the app can recover from.
    if ((!morningSegment || !middaySegment || !eveningSegment) && isTestEnv) {
      await this.upsertMockForecastSegments(weatherSnapshot.id, new Date())
      const refreshedSnapshot = await this.prisma.weatherSnapshot.findUniqueOrThrow({
        where: { id: weatherSnapshot.id },
        include: { segments: true },
      })
      weatherSnapshot = refreshedSnapshot
      targetLocalDateStr = originalTargetLocalDateStr
      morningSegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 8
      )
      middaySegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 13
      )
      eveningSegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 19
      )
    }

    if (!morningSegment || !middaySegment || !eveningSegment) {
      throw new InternalServerErrorException(
        'Required daily scenario forecast segments (morning, midday, evening) not found in weather snapshot.'
      )
    }

    const targetScenarios: { scenario: ScenarioName; segment: typeof morningSegment }[] =
      [
        { scenario: 'morning', segment: morningSegment },
        { scenario: 'midday', segment: middaySegment },
        { scenario: 'evening', segment: eveningSegment },
      ]

    // 5. Query user garments
    const userGarments = await this.prisma.garmentItem.findMany({
      where: { user_id: userId },
    })

    // 6. Build or retrieve outfit recommendations
    const outfits: ScenarioOutfit[] = []
    for (const { scenario, segment } of targetScenarios) {
      let recommendation: OutfitRecommendation | null =
        await this.prisma.outfitRecommendation.findFirst({
          where: {
            user_id: userId,
            forecast_segment_id: segment.id,
            scenario,
          },
        })

      const isStale =
        recommendation &&
        recommendation.created_at.getTime() < stalenessThreshold.getTime()

      if (!recommendation || isStale) {
        // Generate recommendation
        let adjustedFeelsLike = segment.feels_like
        if (runsColdWarm === 'cold') {
          adjustedFeelsLike -= 3
        } else if (runsColdWarm === 'warm') {
          adjustedFeelsLike += 3
        }

        // Category matching rules
        let requiredCategories: string[] = []
        if (adjustedFeelsLike < 15) {
          requiredCategories = ['outerwear', 'top', 'bottom', 'shoes']
        } else {
          // If dress is available in user closet, use dress + shoes, otherwise top + bottom + shoes
          const hasDress = userGarments.some((g) => g.category === 'dress')
          if (hasDress) {
            requiredCategories = ['dress', 'shoes']
          } else {
            requiredCategories = ['top', 'bottom', 'shoes']
          }
        }

        // Comfort range matching
        let targetComfortRange = 'mild'
        if (adjustedFeelsLike < 10) {
          targetComfortRange = 'cold'
        } else if (adjustedFeelsLike < 15) {
          targetComfortRange = 'cool'
        } else if (adjustedFeelsLike < 20) {
          targetComfortRange = 'mild'
        } else if (adjustedFeelsLike < 25) {
          targetComfortRange = 'warm'
        } else {
          targetComfortRange = 'hot'
        }

        // Choose garments
        const garmentIds = requiredCategories.map((category) => {
          const candidates = userGarments.filter((g) => g.category === category)
          if (candidates.length === 0) {
            return `default-${category}`
          }

          // Exact match
          const exact = candidates.find((g) => g.comfort_range === targetComfortRange)
          if (exact) return exact.id

          // Close matches
          const closeMatches: Record<string, string[]> = {
            cold: ['cool'],
            cool: ['mild', 'cold'],
            mild: ['cool', 'warm'],
            warm: ['mild', 'hot'],
            hot: ['warm'],
          }
          const preferences = closeMatches[targetComfortRange] || []
          for (const pref of preferences) {
            const match = candidates.find((g) => g.comfort_range === pref)
            if (match) return match.id
          }

          return candidates[0]!.id
        })

        // Rounded values for consistent trigger logic and display formatting
        const roundedAdjustedFeelsLike = Math.round(adjustedFeelsLike)

        const getFeelsLikeDesc = (raw: number, adjusted: number) => {
          const roundedRaw = Math.round(raw)
          const roundedAdj = Math.round(adjusted)
          if (roundedRaw === roundedAdj) {
            return `${roundedRaw}°C`
          }
          return `${roundedRaw}°C (adjusted to ${roundedAdj}°C)`
        }

        // Reasoning badges
        // Story 2.3 Task 2 step 1 owner: refactor dynamic badge generation and interpolation
        const badgesList: { key: string; label: string; bullets: string[] }[] = []

        // Wind tolerance trigger
        const windThreshold = getWindThreshold(windTolerance)
        if (segment.wind_speed > windThreshold) {
          const windSpeedFormatted = Math.round(segment.wind_speed * 10) / 10
          badgesList.push({
            key: 'wind_layer',
            label: 'Wind layer',
            bullets: [
              `Wind speed is ${windSpeedFormatted} m/s, which exceeds your wind tolerance threshold of ${windThreshold} m/s.`,
            ],
          })
        }

        // Rain preparation trigger
        const rainProbThreshold = getRainProbThreshold(precipPreparedness)
        const rainAmountThreshold = getRainAmountThreshold(precipPreparedness)
        const roundedProb = Math.round(segment.precipitation_probability * 100)
        const roundedProbThreshold = Math.round(rainProbThreshold * 100)
        const roundedAmount = Math.round(segment.precipitation_amount * 10) / 10
        const roundedAmountThreshold = Math.round(rainAmountThreshold * 10) / 10

        if (
          roundedProb > roundedProbThreshold ||
          roundedAmount > roundedAmountThreshold
        ) {
          const rainBullets: string[] = []
          if (roundedProb > roundedProbThreshold) {
            rainBullets.push(
              `Precipitation probability is ${roundedProb}%, which exceeds your threshold of ${roundedProbThreshold}%.`
            )
          }
          if (roundedAmount > roundedAmountThreshold) {
            rainBullets.push(
              `Precipitation amount is ${roundedAmount} mm, which exceeds your threshold of ${roundedAmountThreshold} mm.`
            )
          }
          badgesList.push({
            key: 'rain_ready',
            label: 'Rain-ready',
            bullets: rainBullets,
          })
        }

        // Evening chill trigger
        if (scenario === 'evening' && roundedAdjustedFeelsLike < 15) {
          badgesList.push({
            key: 'evening_chill',
            label: 'Evening chill',
            bullets: [
              `Evening feels-like temperature is ${getFeelsLikeDesc(
                segment.feels_like,
                adjustedFeelsLike
              )}, which is below the evening chill threshold of 15°C.`,
            ],
          })
        }

        // Default scenario / temperature badges
        if (badgesList.length === 0) {
          if (scenario === 'morning' && roundedAdjustedFeelsLike < 12) {
            badgesList.push({
              key: 'commute_warmth',
              label: 'Commute warmth',
              bullets: [
                `Morning feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is below the commute warmth threshold of 12°C.`,
              ],
            })
          } else if (segment.condition === 'clear' && roundedAdjustedFeelsLike >= 22) {
            badgesList.push({
              key: 'sun_protection',
              label: 'Sun protection',
              bullets: [
                `Skies are clear and feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is at or above 22°C.`,
              ],
            })
          } else if (roundedAdjustedFeelsLike >= 15 && roundedAdjustedFeelsLike < 22) {
            badgesList.push({
              key: 'light_layers',
              label: 'Light layers',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is between 15°C and 22°C.`,
              ],
            })
          } else if (roundedAdjustedFeelsLike >= 25) {
            badgesList.push({
              key: 'breathable_comfort',
              label: 'Breathable comfort',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is at or above 25°C.`,
              ],
            })
          } else {
            badgesList.push({
              key: 'daily_base',
              label: 'Daily base',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}.`,
              ],
            })
          }
        }

        // Write to database
        if (recommendation) {
          try {
            recommendation = await this.prisma.outfitRecommendation.update({
              where: { id: recommendation.id },
              data: {
                garment_ids: garmentIds,
                reasoning_badges: badgesList,
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
                garment_ids: garmentIds,
                reasoning_badges: badgesList,
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

      // Generate dynamic comfort notes for the response
      let adjustedFeelsLike = segment.feels_like
      if (runsColdWarm === 'cold') {
        adjustedFeelsLike -= 3
      } else if (runsColdWarm === 'warm') {
        adjustedFeelsLike += 3
      }

      const notes: string[] = []
      notes.push(
        `Feels like ${Math.round(segment.feels_like)}°C (${
          runsColdWarm !== 'neutral'
            ? `adjusted to ${Math.round(adjustedFeelsLike)}°C for comfort`
            : 'neutral preference'
        }).`
      )

      if (adjustedFeelsLike < 10) {
        notes.push('It is cold, so a heavy coat or extra warmth is recommended.')
      } else if (adjustedFeelsLike < 15) {
        notes.push('Chilly conditions today; outerwear is recommended.')
      } else if (adjustedFeelsLike < 20) {
        notes.push('Mild and pleasant day; light layers will keep you comfortable.')
      } else if (adjustedFeelsLike < 25) {
        notes.push('Warm day; a standard top and bottom or dress is perfect.')
      } else {
        notes.push('Hot weather; light, breathable garments are best.')
      }

      const windLimit = getWindThreshold(windTolerance)
      if (segment.wind_speed > windLimit) {
        notes.push(
          `Winds are high at ${segment.wind_speed} m/s, so we suggest a wind-blocking layer.`
        )
      }

      const rainProbLimit = getRainProbThreshold(precipPreparedness)
      if (segment.precipitation_probability > rainProbLimit) {
        notes.push(
          'Rain is likely. We recommend bringing an umbrella or rain-resistant outerwear.'
        )
      }

      const comfortNotes = notes.join(' ')

      const rec = recommendation

      outfits.push({
        id: rec.id,
        scenario: rec.scenario as ScenarioName,
        garmentIds: (rec.garment_ids as string[]) || [],
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
          .map((badge) => mapRawBadgeToCanonical(badge)),
        comfortNotes: comfortNotes,
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
  async invalidateUserCache(userId: string): Promise<void> {
    try {
      const matchPattern = `ritual:${userId}:*`
      let cursor = '0'
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          matchPattern,
          'COUNT',
          100
        )
        cursor = nextCursor
        if (keys.length > 0) {
          await this.redis.del(keys)
        }
      } while (cursor !== '0')
    } catch (err) {
      this.logger.warn(
        `Redis cache invalidation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  async onModuleDestroy() {
    await this.redis.quit()
  }
}
