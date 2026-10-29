export declare const SENTINEL_TEMPERATURE_C: number
export declare const SENTINEL_OPENWEATHER_CONDITION_ID: number
export declare const SENTINEL_WEATHERAPI_CONDITION_CODE: number
export declare const SENTINEL_CONDITION: 'drizzle'
export declare const DOUBLE_SLOW_DELAY_MS: number
export declare const DOUBLE_DAILY_DAYS: number
export declare const DOUBLE_DAILY_MIN_C: number
export declare const DOUBLE_DAILY_MAX_C: number
export declare const FLAKY_SEARCH_PREFIX: 'Flaky search'
export declare const FLAKY_SAVE_PREFIX: 'Flaky save'

export interface WeatherProviderDoublePlace {
  name: string
  state: string | null
  country: string | null
  weatherApiCountry: string
  lat: number
  lon: number
  timezone: string
  localNames?: Record<string, string>
  forecast?: 'fail' | 'bad_timezone' | 'slow'
}

export declare const DOUBLE_PLACES: readonly WeatherProviderDoublePlace[]
export declare function fold(value: string): string
export declare function sentinelPlace(nonce: string): WeatherProviderDoublePlace
export declare function flakySavePlace(nonce: string): WeatherProviderDoublePlace
export declare function isFlakySaveCoordinate(
  latitude: number,
  longitude: number
): boolean
export declare function coordinateKeySuffix(latitude: number, longitude: number): string
export declare const NATIVE_JOURNEY_TEMPERATURE_C: number
export declare function nativeJourneyTemperature(): number
