import type { WeatherProviderName } from './weather.types.js'

export type WeatherProviderFailureKind =
  | 'aborted'
  | 'invalid_configuration'
  | 'invalid_response'
  | 'invalid_target'
  | 'network'
  | 'non_retryable_http'
  | 'rate_limit'
  | 'retryable_http'
  | 'timeout'

interface WeatherProviderErrorOptions {
  provider: WeatherProviderName
  kind: WeatherProviderFailureKind
  statusCode?: number
  cause?: unknown
}

export class WeatherProviderError extends Error {
  readonly provider: WeatherProviderName
  readonly kind: WeatherProviderFailureKind
  readonly statusCode?: number

  constructor(message: string, options: WeatherProviderErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'WeatherProviderError'
    this.provider = options.provider
    this.kind = options.kind
    this.statusCode = options.statusCode
  }
}

export function classifyFetchFailure(
  provider: WeatherProviderName,
  error: unknown,
  signal?: AbortSignal
): WeatherProviderError {
  const errorName = error instanceof Error ? error.name : ''
  const abortReasonName =
    typeof signal?.reason === 'string'
      ? signal.reason
      : signal?.reason instanceof Error
        ? signal.reason.name
        : ''

  if (errorName === 'TimeoutError' || abortReasonName === 'TimeoutError') {
    return new WeatherProviderError(`${provider} request timed out`, {
      provider,
      kind: 'timeout',
      cause: error,
    })
  }

  if (signal?.aborted || errorName === 'AbortError') {
    return new WeatherProviderError(`${provider} request was aborted`, {
      provider,
      kind: 'aborted',
      cause: error,
    })
  }

  return new WeatherProviderError(`${provider} request failed`, {
    provider,
    kind: 'network',
    cause: error,
  })
}

export function classifyHttpFailure(
  provider: WeatherProviderName,
  statusCode: number
): WeatherProviderError {
  if (statusCode === 429) {
    return new WeatherProviderError(`${provider} rate limit exceeded`, {
      provider,
      kind: 'rate_limit',
      statusCode,
    })
  }

  const kind =
    statusCode === 408 || statusCode >= 500 ? 'retryable_http' : 'non_retryable_http'
  return new WeatherProviderError(`${provider} returned HTTP ${statusCode}`, {
    provider,
    kind,
    statusCode,
  })
}
