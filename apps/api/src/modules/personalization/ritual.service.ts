import {
  Inject,
  Injectable,
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

function getWindThreshold(windTolerance: string): number {
  return windTolerance === 'low' ? 3 : windTolerance === 'medium' ? 5 : 8
}

function getRainProbThreshold(precipPreparedness: string): number {
  return precipPreparedness === 'high' ? 0.2 : precipPreparedness === 'medium' ? 0.4 : 0.7
}

function getRainAmountThreshold(precipPreparedness: string): number {
  return precipPreparedness === 'high' ? 0.1 : precipPreparedness === 'medium' ? 0.5 : 2.0
}

@Injectable()
export class RitualService implements OnModuleDestroy {
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

    // 2. Load Comfort Preferences and Weather Snapshot
    const [comfortPrefs, weatherResult] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(selectedLocation.locationKey),
    ])

    if (weatherResult.status === 'unavailable' || !weatherResult.data) {
      throw new InternalServerErrorException(
        weatherResult.message || 'Weather data is temporarily unavailable.'
      )
    }

    const weatherSnapshot = weatherResult.data
    const timezone = weatherSnapshot.timezone

    const runsColdWarm = comfortPrefs?.runs_cold_warm ?? 'neutral'
    const windTolerance = comfortPrefs?.wind_tolerance ?? 'medium'
    const precipPreparedness = comfortPrefs?.precip_preparedness ?? 'medium'
    const comfortUpdatedAt = comfortPrefs?.updated_at ?? new Date(0)

    // 3. Check Redis Cache
    const cacheKey = `ritual:${userId}:${selectedLocation.locationKey}`
    let cachedString: string | null = null
    try {
      cachedString = await this.redis.get(cacheKey)
    } catch (err) {
      console.warn(`Redis cache get failed for key "${cacheKey}":`, err)
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
          cachedGeneratedAt.getTime() >= comfortUpdatedAt.getTime()
        ) {
          // Also check if any user garment was updated after the cache was generated
          let latestGarment: GarmentItem | null = null
          if (this.prisma.garmentItem.findFirst) {
            latestGarment = await this.prisma.garmentItem.findFirst({
              where: { user_id: userId },
              orderBy: { updated_at: 'desc' },
            })
          }
          if (
            !latestGarment ||
            latestGarment.updated_at.getTime() <= cachedGeneratedAt.getTime()
          ) {
            return cachedPayload.data
          }
        }
      } catch {
        // Fallback to recalculation on parse failure
      }
    }

    // 4. Find timezone-aligned forecast segments for a single target date
    const now = new Date()
    const currentLocalHour = getHourInTimezone(now, timezone)

    // Shift the entire outfit coverage to tomorrow if current hour is 8:00 AM local time or later
    let targetTime = now.getTime()
    if (currentLocalHour >= 8) {
      targetTime += 24 * 60 * 60 * 1000
    }
    const targetLocalDateStr = getLocalDateString(new Date(targetTime), timezone)

    const segments = weatherSnapshot.segments
    const morningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 8
    )
    const middaySegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 13
    )
    const eveningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 19
    )

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

      if (
        recommendation &&
        recommendation.created_at.getTime() < comfortUpdatedAt.getTime()
      ) {
        recommendation = null
      }

      if (!recommendation) {
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

        // Reasoning badges
        const badgesList: { label: string }[] = []

        // Wind tolerance trigger
        const windThreshold = getWindThreshold(windTolerance)
        if (segment.wind_speed > windThreshold) {
          badgesList.push({ label: 'Wind layer' })
        }

        // Rain preparation trigger
        const rainProbThreshold = getRainProbThreshold(precipPreparedness)
        const rainAmountThreshold = getRainAmountThreshold(precipPreparedness)
        if (
          segment.precipitation_probability > rainProbThreshold ||
          segment.precipitation_amount > rainAmountThreshold
        ) {
          badgesList.push({ label: 'Rain-ready' })
        }

        // Evening chill trigger
        if (scenario === 'evening' && adjustedFeelsLike < 15) {
          badgesList.push({ label: 'Evening chill' })
        }

        // Default scenario / temperature badges
        if (badgesList.length === 0) {
          if (scenario === 'morning' && adjustedFeelsLike < 12) {
            badgesList.push({ label: 'Commute warmth' })
          } else if (segment.condition === 'clear' && adjustedFeelsLike >= 22) {
            badgesList.push({ label: 'Sun protection' })
          } else if (adjustedFeelsLike >= 15 && adjustedFeelsLike < 22) {
            badgesList.push({ label: 'Light layers' })
          } else if (adjustedFeelsLike >= 25) {
            badgesList.push({ label: 'Breathable comfort' })
          } else {
            badgesList.push({ label: 'Daily base' })
          }
        }

        // Write to database
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
        reasoningBadges: (rec.reasoning_badges as { label: string }[]) || [],
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
      console.warn(`Redis cache set failed for key "${cacheKey}":`, err)
    }

    return responseData
  }

  async onModuleDestroy() {
    await this.redis.quit()
  }
}
