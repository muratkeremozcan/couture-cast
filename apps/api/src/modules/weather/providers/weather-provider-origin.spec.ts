import { describe, expect, it } from 'vitest'
import {
  isProductionRuntime,
  OPENWEATHER_DEFAULT_ORIGIN,
  resolveWeatherProviderOrigin,
  WEATHERAPI_DEFAULT_ORIGIN,
} from './weather-provider-origin'

describe('resolveWeatherProviderOrigin', () => {
  it('1.2b-UNIT-ORIGIN-01 uses the live origins when no override is set', () => {
    expect(resolveWeatherProviderOrigin('openweather', { TEST_ENV: 'local' })).toBe(
      OPENWEATHER_DEFAULT_ORIGIN
    )
    expect(resolveWeatherProviderOrigin('weatherapi', { TEST_ENV: 'local' })).toBe(
      WEATHERAPI_DEFAULT_ORIGIN
    )
  })

  it('1.2b-UNIT-ORIGIN-02 honors overrides outside production', () => {
    expect(
      resolveWeatherProviderOrigin('openweather', {
        TEST_ENV: 'local',
        OPENWEATHER_API_ORIGIN: 'http://127.0.0.1:4010/',
      })
    ).toBe('http://127.0.0.1:4010')
    expect(
      resolveWeatherProviderOrigin('weatherapi', {
        VERCEL_ENV: 'preview',
        WEATHERAPI_API_ORIGIN: 'http://127.0.0.1:4010',
      })
    ).toBe('http://127.0.0.1:4010')
  })

  it.each([
    { VERCEL_ENV: 'production', TEST_ENV: 'local' },
    { APP_ENV: 'prod' },
    { NODE_ENV: 'production' },
    // A Vercel production deployment wins over any other declared environment.
    { VERCEL_ENV: 'production', APP_ENV: 'preview' },
    { VERCEL_ENV: 'production', DEPLOY_ENV: 'local', TEST_ENV: 'local' },
    { VERCEL_ENV: 'production', APP_ENV: 'development', DEPLOY_ENV: 'preview' },
    { APP_ENV: 'preview', DEPLOY_ENV: 'production' },
  ])('1.2b-UNIT-ORIGIN-03 ignores overrides in production %j', (env) => {
    expect(
      resolveWeatherProviderOrigin('openweather', {
        ...env,
        OPENWEATHER_API_ORIGIN: 'http://127.0.0.1:4010',
      })
    ).toBe(OPENWEATHER_DEFAULT_ORIGIN)
  })

  it('1.2b-UNIT-ORIGIN-04 classifies runtimes', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production', TEST_ENV: 'local' })).toBe(false)
    expect(isProductionRuntime({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toBe(
      false
    )
    expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false)
    expect(isProductionRuntime({ DEPLOY_ENV: 'production', NODE_ENV: 'test' })).toBe(true)
  })
})
