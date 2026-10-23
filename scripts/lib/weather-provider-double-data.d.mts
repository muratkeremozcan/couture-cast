export declare const SENTINEL_TEMPERATURE_C: number
export declare const SENTINEL_OPENWEATHER_CONDITION_ID: number
export declare const SENTINEL_WEATHERAPI_CONDITION_CODE: number
export declare const SENTINEL_CONDITION: 'drizzle'
export declare const DOUBLE_SLOW_DELAY_MS: number

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
export declare function coordinateKeySuffix(latitude: number, longitude: number): string
