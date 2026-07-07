import { Injectable, Inject, Optional } from '@nestjs/common'

import { createBaseLogger } from '../../logger/pino.config.js'
import { OpenWeatherProvider } from './providers/openweather.provider.js'
import { WeatherApiProvider } from './providers/weatherapi.provider.js'
import { WeatherProviderError } from './providers/weather-provider.error.js'
import type { IWeatherProvider } from './providers/weather-provider.interface.js'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
  WeatherProviderName,
} from './providers/weather.types.js'
import {
  WeatherQueryService,
  type LatestWeatherResult,
  type WeatherClock,
  systemWeatherClock,
} from './weather-query.service.js'
import {
  WeatherRepository,
  type WeatherSnapshotWithSegments,
} from './weather.repository.js'

const PRIMARY_RETRY_DELAYS_MS = [5000, 15000] as const

type WeatherLogger = {
  info(message: string, values?: Record<string, unknown>): void
  warn(message: string, values?: Record<string, unknown>): void
  error(message: string, values?: Record<string, unknown>): void
}

type WeatherMeter = {
  recordProviderRequest?(
    provider: WeatherProviderName,
    outcome: string,
    durationMs: number,
    statusClass?: string
  ): void
  recordRateLimit?(provider: WeatherProviderName): void
  recordIngestion?(outcome: string): void
}

export type WeatherSleeper = (ms: number, signal: AbortSignal) => Promise<void>

export type WeatherIngestionResult =
  | {
      outcome: 'persisted'
      provider: WeatherProviderName
      snapshot: WeatherSnapshotWithSegments
    }
  | {
      outcome: 'fallback'
      fallback: LatestWeatherResult
    }

export interface WeatherIngestionServiceOptions {
  primaryProvider: IWeatherProvider
  secondaryProvider: IWeatherProvider
  repository: WeatherRepository
  queryService: WeatherQueryService
  sleeper?: WeatherSleeper
  logger?: WeatherLogger
  meter?: WeatherMeter
}

function defaultSleeper(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(toAbortError(signal.reason))
      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(toAbortError(signal.reason))
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }

  return new Error('Weather sleep aborted')
}

function statusClassFor(error: WeatherProviderError): string | undefined {
  return error.statusCode ? `${Math.floor(error.statusCode / 100)}xx` : undefined
}

function toProviderError(
  provider: WeatherProviderName,
  error: unknown,
  signal?: AbortSignal
): WeatherProviderError {
  if (error instanceof WeatherProviderError) {
    return error
  }

  const errorName = error instanceof Error ? error.name : ''
  if (signal?.aborted || errorName === 'AbortError' || errorName === 'AbortSignal') {
    return new WeatherProviderError(`${provider} request was aborted`, {
      provider,
      kind: 'aborted',
      cause: error,
    })
  }

  return new WeatherProviderError(`${provider} provider failed`, {
    provider,
    kind: 'network',
    cause: error,
  })
}

function shouldRetryPrimary(error: WeatherProviderError): boolean {
  return error.kind === 'timeout' || error.kind === 'retryable_http'
}

function shouldAbortIngestion(error: WeatherProviderError): boolean {
  return error.kind === 'aborted' || error.kind === 'invalid_target'
}

@Injectable()
export class WeatherIngestionService {
  private readonly primaryProvider: IWeatherProvider
  private readonly secondaryProvider: IWeatherProvider
  private readonly repository: WeatherRepository
  private readonly queryService: WeatherQueryService
  private readonly clock: WeatherClock
  private readonly sleeper: WeatherSleeper
  private readonly logger: WeatherLogger
  private readonly meter: WeatherMeter

  constructor(
    @Inject(OpenWeatherProvider) primaryProvider: IWeatherProvider,
    @Inject(WeatherApiProvider) secondaryProvider: IWeatherProvider,
    @Inject(WeatherRepository) repository: WeatherRepository,
    @Inject(WeatherQueryService) queryService: WeatherQueryService,
    @Inject('WeatherClock') @Optional() clock?: WeatherClock,
    @Inject('WeatherSleeper') @Optional() sleeper?: WeatherSleeper,
    @Inject('WeatherLogger') @Optional() logger?: WeatherLogger,
    @Inject('WeatherMeter') @Optional() meter?: WeatherMeter
  ) {
    this.primaryProvider = primaryProvider
    this.secondaryProvider = secondaryProvider
    this.repository = repository
    this.queryService = queryService
    this.clock = clock ?? systemWeatherClock
    this.sleeper = sleeper ?? defaultSleeper
    this.logger = logger ?? createBaseLogger().child({ feature: 'weather-ingestion' })
    this.meter = meter ?? {}
  }

  async ingestTarget(
    target: WeatherIngestionTarget,
    signal: AbortSignal = new AbortController().signal
  ): Promise<WeatherIngestionResult> {
    const forecast = await this.fetchWithFailover(target, signal)

    if (forecast) {
      const snapshot = await this.repository.persistForecast(forecast)
      this.meter.recordIngestion?.('persisted')
      this.logger.info('weather ingestion persisted', {
        provider: forecast.provider,
        outcome: 'persisted',
      })
      return {
        outcome: 'persisted',
        provider: forecast.provider,
        snapshot,
      }
    }

    const fallback = await this.queryService.getLatestWeather(target.locationKey, {
      liveProviderFailed: true,
    })
    this.meter.recordIngestion?.('fallback')
    this.logger.warn('weather ingestion using fallback', {
      outcome: fallback.status,
    })
    return {
      outcome: 'fallback',
      fallback,
    }
  }

  private async fetchWithFailover(
    target: WeatherIngestionTarget,
    signal: AbortSignal
  ): Promise<NormalizedWeatherForecast | null> {
    let lastPrimaryError: WeatherProviderError | null = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await this.sleeper(PRIMARY_RETRY_DELAYS_MS[attempt - 1]!, signal)
      }

      try {
        return await this.fetchProvider(
          'openweather',
          this.primaryProvider,
          target,
          signal
        )
      } catch (error) {
        const providerError = toProviderError('openweather', error, signal)
        lastPrimaryError = providerError
        this.recordProviderFailure(providerError, attempt + 1)

        if (shouldAbortIngestion(providerError)) {
          throw providerError
        }

        if (providerError.kind === 'rate_limit') {
          this.meter.recordRateLimit?.('openweather')
          break
        }

        if (!shouldRetryPrimary(providerError)) {
          break
        }
      }
    }

    return this.trySecondary(target, signal, lastPrimaryError)
  }

  private async trySecondary(
    target: WeatherIngestionTarget,
    signal: AbortSignal,
    lastPrimaryError: WeatherProviderError | null
  ): Promise<NormalizedWeatherForecast | null> {
    this.logger.warn('weather provider failover', {
      fromProvider: 'openweather',
      toProvider: 'weatherapi',
      reason: lastPrimaryError?.kind,
      statusClass: lastPrimaryError ? statusClassFor(lastPrimaryError) : undefined,
    })

    try {
      return await this.fetchProvider(
        'weatherapi',
        this.secondaryProvider,
        target,
        signal
      )
    } catch (error) {
      const providerError = toProviderError('weatherapi', error, signal)
      this.recordProviderFailure(providerError, 1)

      if (shouldAbortIngestion(providerError)) {
        throw providerError
      }

      return null
    }
  }

  private async fetchProvider(
    provider: WeatherProviderName,
    weatherProvider: IWeatherProvider,
    target: WeatherIngestionTarget,
    signal: AbortSignal
  ): Promise<NormalizedWeatherForecast> {
    const startedAt = performance.now()

    try {
      const forecast = await weatherProvider.fetchForecast(target, signal)
      this.meter.recordProviderRequest?.(
        provider,
        'success',
        performance.now() - startedAt
      )
      return forecast
    } catch (error) {
      const providerError = toProviderError(provider, error)
      this.meter.recordProviderRequest?.(
        provider,
        providerError.kind,
        performance.now() - startedAt,
        statusClassFor(providerError)
      )
      throw providerError
    }
  }

  private recordProviderFailure(error: WeatherProviderError, attempt: number): void {
    this.logger.warn('weather provider request failed', {
      provider: error.provider,
      outcome: error.kind,
      statusClass: statusClassFor(error),
      attempt,
    })
  }
}
