#!/usr/bin/env node
// Story 1.2b: a local deterministic double for both weather providers'
// geocoding and forecast endpoints. Acceptance lanes point the API at it with
// OPENWEATHER_API_ORIGIN and WEATHERAPI_API_ORIGIN, so no test ever reaches a
// live provider.
//
// Every forecast carries the sentinel current temperature and condition below.
// The ritual's synthetic test weather is 68 degrees and clear, so a ritual that
// reports the sentinel can only have consumed the forecast persisted at save.
//
// `Sentinel <nonce>` geocodes to one place whose coordinates derive from the
// nonce, so each run saves a location key that has never had a snapshot.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

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

function fold(value) {
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

function geocode(query) {
  const folded = fold(query)
  const sentinel = /^sentinel\s+([a-z0-9-]+)$/.exec(folded)
  if (sentinel) return [sentinelPlace(sentinel[1])]
  if (folded.length < 2) return []
  return DOUBLE_PLACES.filter((place) => fold(place.name).startsWith(folded)).slice(0, 5)
}

function placeAt(lat, lon) {
  const all = [...DOUBLE_PLACES]
  return all.find(
    (place) => Math.abs(place.lat - lat) < 0.01 && Math.abs(place.lon - lon) < 0.01
  )
}

function hourlyTemperature(index) {
  return Math.round((18 + 6 * Math.sin(index / 4)) * 10) / 10
}

function utcDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

function openWeatherForecast(lat, lon, timezone, nowSeconds) {
  const hourStart = Math.floor(nowSeconds / 3600) * 3600
  const condition = {
    id: SENTINEL_OPENWEATHER_CONDITION_ID,
    main: 'Drizzle',
    description: 'light drizzle',
  }
  return {
    lat,
    lon,
    timezone,
    timezone_offset: 0,
    current: {
      dt: nowSeconds,
      temp: SENTINEL_TEMPERATURE_C,
      feels_like: SENTINEL_TEMPERATURE_C - 1,
      humidity: 70,
      wind_speed: 3,
      weather: [condition],
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      dt: hourStart + index * 3600,
      temp: hourlyTemperature(index),
      feels_like: hourlyTemperature(index) - 1,
      pop: 0.2,
      wind_speed: 3,
      wind_gust: 5,
      weather: [condition],
    })),
    daily: Array.from({ length: 8 }, (_, index) => ({
      dt: hourStart + index * 86400,
      temp: { min: 14, max: 24 },
      feels_like: { day: 22, night: 13, eve: 19, morn: 15 },
      pop: 0.2,
      wind_speed: 3,
      weather: [condition],
    })),
  }
}

function weatherApiForecast(lat, lon, timezone, nowSeconds) {
  const hourStart = Math.floor(nowSeconds / 3600) * 3600
  const condition = { text: 'Light drizzle', code: SENTINEL_WEATHERAPI_CONDITION_CODE }
  const days = Array.from({ length: 3 }, (_, dayIndex) => {
    const dayStart = hourStart + dayIndex * 86400
    return {
      date: utcDate(dayStart),
      day: {
        maxtemp_c: 24,
        mintemp_c: 14,
        maxwind_kph: 12,
        totalprecip_mm: 0.4,
        daily_chance_of_rain: 20,
        daily_chance_of_snow: 0,
        condition,
      },
      hour: Array.from({ length: 24 }, (_, hourIndex) => {
        const index = dayIndex * 24 + hourIndex
        return {
          time_epoch: hourStart + index * 3600,
          temp_c: hourlyTemperature(index),
          feelslike_c: hourlyTemperature(index) - 1,
          chance_of_rain: 20,
          chance_of_snow: 0,
          precip_mm: 0.1,
          wind_kph: 11,
          gust_kph: 18,
          condition,
        }
      }),
    }
  })
  return {
    location: { lat, lon, tz_id: timezone },
    current: {
      last_updated_epoch: nowSeconds,
      temp_c: SENTINEL_TEMPERATURE_C,
      feelslike_c: SENTINEL_TEMPERATURE_C - 1,
      humidity: 70,
      wind_kph: 11,
      condition,
    },
    forecast: { forecastday: days },
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const GEOCODING_PATHS = new Set(['/geo/1.0/direct', '/v1/search.json'])
const FORECAST_PATHS = new Set(['/data/3.0/onecall', '/v1/forecast.json'])

function openWeatherGeocodingBody(places) {
  return places
    .filter((place) => place.country)
    .map((place) => ({
      name: place.name,
      ...(place.localNames ? { local_names: place.localNames } : {}),
      lat: place.lat,
      lon: place.lon,
      country: place.country,
      ...(place.state ? { state: place.state } : {}),
    }))
}

function weatherApiSearchBody(places) {
  return places.map((place, index) => ({
    id: index + 1,
    name: place.name,
    region: place.state ?? '',
    country: place.weatherApiCountry,
    lat: place.lat,
    lon: place.lon,
    url: fold(place.name).replace(/\s+/g, '-'),
  }))
}

async function handleGeocoding(url, response) {
  const query = url.searchParams.get('q') ?? ''
  const folded = fold(query)
  if (folded === 'provider down') return send(response, 500, { message: 'down' })
  if (folded === 'provider slow') await delay(DOUBLE_SLOW_DELAY_MS)
  const places = geocode(query)
  return send(
    response,
    200,
    url.pathname === '/geo/1.0/direct'
      ? openWeatherGeocodingBody(places)
      : weatherApiSearchBody(places)
  )
}

function forecastCoordinates(url) {
  if (url.pathname === '/data/3.0/onecall') {
    return [Number(url.searchParams.get('lat')), Number(url.searchParams.get('lon'))]
  }
  const [lat, lon] = (url.searchParams.get('q') ?? '').split(',')
  return [Number(lat), Number(lon)]
}

function forecastTimezone(place, lon) {
  if (place?.forecast === 'bad_timezone') return 'Mars/Olympus'
  if (place) return place.timezone
  return lon < -100 ? 'America/Denver' : 'America/Chicago'
}

async function handleForecast(url, response, nowSeconds) {
  const [lat, lon] = forecastCoordinates(url)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return send(response, 400, { message: 'bad coordinates' })
  }
  const place = placeAt(lat, lon)
  if (place?.forecast === 'fail') return send(response, 503, { message: 'down' })
  if (place?.forecast === 'slow') await delay(DOUBLE_SLOW_DELAY_MS)
  const timezone = forecastTimezone(place, lon)
  return send(
    response,
    200,
    url.pathname === '/data/3.0/onecall'
      ? openWeatherForecast(lat, lon, timezone, nowSeconds)
      : weatherApiForecast(lat, lon, timezone, nowSeconds)
  )
}

function handleControl(url, response, stats) {
  if (url.pathname === '/__double/reset') {
    stats.geocoding = 0
    stats.forecast = 0
  }
  if (url.pathname === '/__double/health') return send(response, 200, { ok: true })
  return send(response, 200, stats)
}

async function handle(request, response, { stats, now }) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname.startsWith('/__double/')) return handleControl(url, response, stats)

  const isGeocoding = GEOCODING_PATHS.has(url.pathname)
  if (!isGeocoding && !FORECAST_PATHS.has(url.pathname)) {
    return send(response, 404, { message: 'not found' })
  }
  if (!url.searchParams.get('appid') && !url.searchParams.get('key')) {
    return send(response, 401, { message: 'missing key' })
  }
  if (isGeocoding) {
    stats.geocoding += 1
    return handleGeocoding(url, response)
  }
  stats.forecast += 1
  return handleForecast(url, response, Math.floor(now() / 1000))
}

/**
 * Starts the double on 127.0.0.1. `stats` counts provider calls per endpoint so
 * tests can prove a refused request never reached a provider.
 */
export async function startWeatherProviderDouble({
  port = 0,
  now = () => Date.now(),
} = {}) {
  const stats = { geocoding: 0, forecast: 0 }
  const sockets = new Set()

  const server = createServer((request, response) => {
    handle(request, response, { stats, now }).catch((error) => {
      send(response, 500, { message: error instanceof Error ? error.message : 'error' })
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  return {
    origin,
    port: address.port,
    stats,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const portArgIndex = process.argv.indexOf('--port')
  const port = portArgIndex > -1 ? Number(process.argv[portArgIndex + 1]) : 0
  const double = await startWeatherProviderDouble({ port })
  process.stdout.write(`${JSON.stringify({ event: 'ready', origin: double.origin })}\n`)
  process.send?.({ event: 'ready', origin: double.origin, port: double.port })
  const stop = () => {
    void double.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
