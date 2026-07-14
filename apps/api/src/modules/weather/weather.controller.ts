import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'

interface AuthenticatedRequest extends Request {
  auth?: {
    userId?: string
  }
}
import {
  latestWeatherResponseSchema,
  type LatestWeatherResponse,
  type WeatherAlert,
  type WeatherCondition,
  type WeatherProvider,
} from '../../contracts/http'
import { RequestAuthGuard } from '../auth/security.guards'
import { TelemetryService } from '../telemetry/telemetry.service'
import { WeatherQueryService, type LatestWeatherResult } from './weather-query.service'
import type { WeatherSnapshotWithSegments } from './weather.repository'

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toWeatherAlerts(alerts: unknown): WeatherAlert[] {
  if (!Array.isArray(alerts)) {
    return []
  }

  return alerts.map((alert): WeatherAlert => {
    const persistedAlert = alert as {
      event: string
      description: string
      start: Date | string
      end: Date | string
      severity?: WeatherAlert['severity']
    }

    return {
      event: persistedAlert.event,
      description: persistedAlert.description,
      start: toIsoTimestamp(persistedAlert.start),
      end: toIsoTimestamp(persistedAlert.end),
      severity: persistedAlert.severity,
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

function toResponse(result: LatestWeatherResult): LatestWeatherResponse {
  if (result.status === 'unavailable') {
    return {
      data: {
        status: 'unavailable',
        weather: null,
        message: result.message,
      },
    }
  }

  if (result.status === 'fresh') {
    return {
      data: {
        status: 'fresh',
        weather: toWeatherSnapshot(result.data),
      },
    }
  }

  if (result.status === 'cached') {
    return {
      data: {
        status: 'cached',
        weather: toWeatherSnapshot(result.data),
        message: result.message,
      },
    }
  }

  return {
    data: {
      status: 'stale',
      weather: toWeatherSnapshot(result.data),
      message: result.message,
    },
  }
}

@Controller('/api/v1/weather')
export class WeatherController {
  constructor(
    @Inject(WeatherQueryService)
    private readonly weatherQueryService: WeatherQueryService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService
  ) {}

  @Get()
  @UseGuards(RequestAuthGuard)
  getLatestWeatherMissingLocationKey(): never {
    throw new BadRequestException('Invalid weather location key')
  }

  @Get(':locationKey')
  @UseGuards(RequestAuthGuard)
  async getLatestWeather(
    @Param('locationKey') locationKey: string,
    @Req() req: AuthenticatedRequest
  ): Promise<LatestWeatherResponse> {
    const normalizedLocationKey = locationKey.trim()
    if (!normalizedLocationKey) {
      throw new BadRequestException('Invalid weather location key')
    }

    const result = await this.weatherQueryService.getLatestWeather(normalizedLocationKey)
    const response = latestWeatherResponseSchema.parse(toResponse(result))

    const userId: string | null = req.auth?.userId ?? null
    if (userId) {
      await this.telemetryService.captureEvent(userId, 'forecast_viewed', {
        userId,
        locationKey: normalizedLocationKey,
        status: 'success',
      })
    }

    return response
  }
}
