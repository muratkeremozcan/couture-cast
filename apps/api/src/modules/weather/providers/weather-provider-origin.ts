import { allowsTestOnlySecrets } from '../../../config/runtime-environment.js'
import type { WeatherProviderName } from './weather.types.js'

export const OPENWEATHER_DEFAULT_ORIGIN = 'https://api.openweathermap.org'
export const WEATHERAPI_DEFAULT_ORIGIN = 'https://api.weatherapi.com'

const ORIGIN_OVERRIDE_ENV: Readonly<Record<WeatherProviderName, string>> = {
  openweather: 'OPENWEATHER_API_ORIGIN',
  weatherapi: 'WEATHERAPI_API_ORIGIN',
}

const DEFAULT_ORIGINS: Readonly<Record<WeatherProviderName, string>> = {
  openweather: OPENWEATHER_DEFAULT_ORIGIN,
  weatherapi: WEATHERAPI_DEFAULT_ORIGIN,
}

/**
 * A declared production runtime always wins. Otherwise a local or test runtime,
 * or any other declared environment (preview, development), is non-production.
 * With nothing declared, `NODE_ENV=production` counts as production so an
 * unlabeled deployment fails closed.
 */
export function isProductionRuntime(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  const declared = (env.APP_ENV ?? env.DEPLOY_ENV ?? env.VERCEL_ENV ?? '')
    .trim()
    .toLowerCase()
  if (declared === 'production' || declared === 'prod') return true
  if (allowsTestOnlySecrets(env)) return false
  if (declared) return false
  return env.NODE_ENV === 'production'
}

/**
 * Story 1.2b: acceptance lanes point the providers at a local deterministic
 * double through `OPENWEATHER_API_ORIGIN` and `WEATHERAPI_API_ORIGIN`. The
 * override is ignored in production, so a stray variable can never redirect
 * live weather or geocoding traffic.
 */
export function resolveWeatherProviderOrigin(
  provider: WeatherProviderName,
  env: Readonly<NodeJS.ProcessEnv> = process.env
): string {
  const override = env[ORIGIN_OVERRIDE_ENV[provider]]?.trim()
  if (!override || isProductionRuntime(env)) {
    return DEFAULT_ORIGINS[provider]
  }
  return override.replace(/\/+$/, '')
}
