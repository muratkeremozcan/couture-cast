// Story 1.2b: the weather provider double's deterministic data, shared with the
// specs that assert on it. No `import.meta` here, so Playwright's transform can
// load it; the server and its CLI live in `weather-provider-double.mjs`.
import { createHash } from 'node:crypto'

export const SENTINEL_TEMPERATURE_C = 31
export const SENTINEL_OPENWEATHER_CONDITION_ID = 300
export const SENTINEL_WEATHERAPI_CONDITION_CODE = 1153
export const SENTINEL_CONDITION = 'drizzle'
export const DOUBLE_SLOW_DELAY_MS = 4000

const US = 'United States of America'

/** OpenWeather names; `weatherApiCountry` is how WeatherAPI spells the country. */
export const DOUBLE_PLACES = [
  {
    name: 'Chicago',
    state: 'Illinois',
    country: 'US',
    weatherApiCountry: US,
    lat: 41.8781,
    lon: -87.6298,
    timezone: 'America/Chicago',
    localNames: { en: 'Chicago', fr: 'Chicago', ja: 'シカゴ', tr: 'Şikago' },
  },
  {
    name: 'Springfield',
    state: 'Illinois',
    country: 'US',
    weatherApiCountry: US,
    lat: 39.7817,
    lon: -89.6501,
    timezone: 'America/Chicago',
  },
  {
    name: 'Springfield',
    state: 'Missouri',
    country: 'US',
    weatherApiCountry: US,
    lat: 37.209,
    lon: -93.2923,
    timezone: 'America/Chicago',
  },
  {
    name: 'Moscow',
    state: 'Moscow',
    country: 'RU',
    weatherApiCountry: 'Russia',
    lat: 55.7558,
    lon: 37.6173,
    timezone: 'Europe/Moscow',
    localNames: {
      en: 'Moscow',
      ja: 'モスクワ',
      de: 'Moskau',
      fr: 'Moscou',
      ru: 'Москва',
    },
  },
  {
    name: 'İstanbul',
    state: 'İstanbul',
    country: 'TR',
    weatherApiCountry: 'Turkey',
    lat: 41.0082,
    lon: 28.9784,
    timezone: 'Europe/Istanbul',
    localNames: { en: 'Istanbul', tr: 'İstanbul' },
  },
  {
    name: 'São Paulo',
    state: 'São Paulo',
    country: 'BR',
    weatherApiCountry: 'Brazil',
    lat: -23.5505,
    lon: -46.6333,
    timezone: 'America/Sao_Paulo',
  },
  {
    name: 'Monaco',
    state: null,
    country: 'MC',
    weatherApiCountry: 'Monaco',
    lat: 43.7384,
    lon: 7.4246,
    timezone: 'Europe/Monaco',
  },
  {
    name: 'Twinbrook',
    state: 'Maryland',
    country: 'US',
    weatherApiCountry: US,
    lat: 39.0,
    lon: -77.1,
    timezone: 'America/New_York',
  },
  {
    name: 'Twinbrook',
    state: 'Maryland',
    country: 'US',
    weatherApiCountry: US,
    lat: 39.6,
    lon: -77.6,
    timezone: 'America/New_York',
  },
  {
    name: 'Atlantis City',
    state: 'Lost Coast',
    country: null,
    weatherApiCountry: 'Atlantis',
    lat: 10.5,
    lon: -30.5,
    timezone: 'Atlantic/Azores',
  },
  // Forecast behaviours keyed by coordinates: provider down, invalid timezone, slow.
  {
    name: 'Failtown',
    state: 'Kansas',
    country: 'US',
    weatherApiCountry: US,
    lat: 1.111,
    lon: 1.111,
    timezone: 'UTC',
    forecast: 'fail',
  },
  {
    name: 'Badzone',
    state: 'Nevada',
    country: 'US',
    weatherApiCountry: US,
    lat: 2.222,
    lon: 2.222,
    timezone: 'UTC',
    forecast: 'bad_timezone',
  },
  {
    name: 'Slowtown',
    state: 'Ohio',
    country: 'US',
    weatherApiCountry: US,
    lat: 3.333,
    lon: 3.333,
    timezone: 'UTC',
    forecast: 'slow',
  },
]

export function fold(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .trim()
}

/** Deterministic coordinates per nonce: latitude 20 to 50, longitude -80 to -120. */
export function sentinelPlace(nonce) {
  const digest = createHash('sha256').update(fold(nonce)).digest()
  const lat = Math.round((20 + (digest.readUInt32BE(0) % 30000) / 1000) * 10000) / 10000
  const lon = -Math.round((80 + (digest.readUInt32BE(4) % 40000) / 1000) * 10000) / 10000
  return {
    name: 'Sentinelville',
    state: 'Sentinel County',
    country: 'US',
    weatherApiCountry: US,
    lat,
    lon,
    timezone: 'America/Denver',
    localNames: { en: 'Sentinelville', fr: 'Sentinelleville' },
  }
}

/** The coordinate suffix a saved-location key ends with: `41-871n-87-631w`. */
export function coordinateKeySuffix(latitude, longitude) {
  const round = (value) => {
    const rounded = Math.round(value * 1000) / 1000
    return Object.is(rounded, -0) ? 0 : rounded
  }
  const lat = round(latitude)
  const lon = round(longitude)
  const latPart = `${Math.abs(lat).toFixed(3)}${lat < 0 ? 's' : 'n'}`
  const lonPart = `${Math.abs(lon).toFixed(3)}${lon < 0 ? 'w' : 'e'}`
  return `${latPart}-${lonPart}`.replace(/\./g, '-')
}
