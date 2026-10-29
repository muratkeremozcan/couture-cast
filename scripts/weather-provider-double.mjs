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
// `Flaky search <nonce>` and `Flaky save <nonce>` fail once per nonce and then
// recover, so a test can press retry and see it succeed.
//
// `/__double/stats` counts provider calls per endpoint and `/__double/requests`
// lists what each one asked for (the query, the coordinates), both read-only,
// so a harness outside this process can prove which place a forecast was
// fetched for.
import fs from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import {
  DOUBLE_DAILY_DAYS,
  DOUBLE_DAILY_MAX_C,
  DOUBLE_DAILY_MIN_C,
  DOUBLE_PLACES,
  DOUBLE_SLOW_DELAY_MS,
  FLAKY_SAVE_PREFIX,
  FLAKY_SEARCH_PREFIX,
  flakySavePlace,
  fold,
  isFlakySaveCoordinate,
  sentinelPlace,
  SENTINEL_OPENWEATHER_CONDITION_ID,
  SENTINEL_TEMPERATURE_C,
  SENTINEL_WEATHERAPI_CONDITION_CODE,
} from './lib/weather-provider-double-data.mjs'

export * from './lib/weather-provider-double-data.mjs'

function nonceAfter(prefix, folded) {
  return new RegExp(`^${fold(prefix)}\\s+([a-z0-9-]+)$`).exec(folded)?.[1] ?? null
}

function geocode(query) {
  const folded = fold(query)
  const sentinel =
    nonceAfter('sentinel', folded) ?? nonceAfter(FLAKY_SEARCH_PREFIX, folded)
  if (sentinel) return [sentinelPlace(sentinel)]
  const flakySave = nonceAfter(FLAKY_SAVE_PREFIX, folded)
  if (flakySave) return [flakySavePlace(flakySave)]
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
    daily: Array.from({ length: DOUBLE_DAILY_DAYS }, (_, index) => ({
      dt: hourStart + index * 86400,
      temp: { min: DOUBLE_DAILY_MIN_C, max: DOUBLE_DAILY_MAX_C },
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
        maxtemp_c: DOUBLE_DAILY_MAX_C,
        mintemp_c: DOUBLE_DAILY_MIN_C,
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
const OPENWEATHER_PATHS = new Set(['/geo/1.0/direct', '/data/3.0/onecall'])

/** The newest entries the request log keeps per endpoint. */
export const DOUBLE_REQUEST_LOG_LIMIT = 500

/**
 * Appends one entry, numbered by the endpoint's call count (`seq` 1 is the
 * first call since start or reset), so a reader that noted the count before
 * an action can take exactly the entries that action caused.
 */
function logRequest(log, entry) {
  log.push(entry)
  if (log.length > DOUBLE_REQUEST_LOG_LIMIT) log.shift()
}

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

/** True the first time a fail-once key is seen, false on every later call. */
function failsOnce(failedOnce, key) {
  if (failedOnce.has(key)) return false
  failedOnce.add(key)
  return true
}

async function handleGeocoding(url, response, failedOnce) {
  const query = url.searchParams.get('q') ?? ''
  const folded = fold(query)
  if (folded === 'provider down') return send(response, 500, { message: 'down' })
  const flakySearch = nonceAfter(FLAKY_SEARCH_PREFIX, folded)
  if (flakySearch && failsOnce(failedOnce, `search:${flakySearch}`)) {
    return send(response, 500, { message: 'down once' })
  }
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

/** Catalog places answer their own zone; every sentinel place is in Denver's. */
function forecastTimezone(place) {
  if (place?.forecast === 'bad_timezone') return 'Mars/Olympus'
  return place?.timezone ?? 'America/Denver'
}

async function handleForecast(url, response, nowSeconds, failedOnce) {
  const [lat, lon] = forecastCoordinates(url)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return send(response, 400, { message: 'bad coordinates' })
  }
  if (
    isFlakySaveCoordinate(lat, lon) &&
    failsOnce(failedOnce, `forecast:${lat.toFixed(4)},${lon.toFixed(4)}`)
  ) {
    return send(response, 503, { message: 'down once' })
  }
  const place = placeAt(lat, lon)
  if (place?.forecast === 'fail') return send(response, 503, { message: 'down' })
  if (place?.forecast === 'slow') await delay(DOUBLE_SLOW_DELAY_MS)
  const timezone = forecastTimezone(place)
  return send(
    response,
    200,
    url.pathname === '/data/3.0/onecall'
      ? openWeatherForecast(lat, lon, timezone, nowSeconds)
      : weatherApiForecast(lat, lon, timezone, nowSeconds)
  )
}

function handleControl(url, response, { stats, requests, failedOnce }) {
  if (url.pathname === '/__double/reset') {
    stats.geocoding = 0
    stats.forecast = 0
    requests.geocoding.length = 0
    requests.forecast.length = 0
    failedOnce.clear()
  }
  if (url.pathname === '/__double/health') return send(response, 200, { ok: true })
  if (url.pathname === '/__double/requests') return send(response, 200, requests)
  return send(response, 200, stats)
}

async function handle(request, response, { stats, requests, now, failedOnce }) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname.startsWith('/__double/')) {
    return handleControl(url, response, { stats, requests, failedOnce })
  }

  const isGeocoding = GEOCODING_PATHS.has(url.pathname)
  if (!isGeocoding && !FORECAST_PATHS.has(url.pathname)) {
    return send(response, 404, { message: 'not found' })
  }
  if (!url.searchParams.get('appid') && !url.searchParams.get('key')) {
    return send(response, 401, { message: 'missing key' })
  }
  const provider = OPENWEATHER_PATHS.has(url.pathname) ? 'openweather' : 'weatherapi'
  if (isGeocoding) {
    stats.geocoding += 1
    logRequest(requests.geocoding, {
      seq: stats.geocoding,
      provider,
      query: url.searchParams.get('q') ?? '',
    })
    return handleGeocoding(url, response, failedOnce)
  }
  stats.forecast += 1
  const [latitude, longitude] = forecastCoordinates(url)
  logRequest(requests.forecast, { seq: stats.forecast, provider, latitude, longitude })
  return handleForecast(url, response, Math.floor(now() / 1000), failedOnce)
}

/**
 * Starts the double on 127.0.0.1. `stats` counts provider calls per endpoint so
 * tests can prove a refused request never reached a provider; `requests` logs
 * what each call asked for.
 */
export async function startWeatherProviderDouble({
  port = 0,
  now = () => Date.now(),
} = {}) {
  const stats = { geocoding: 0, forecast: 0 }
  const requests = { geocoding: [], forecast: [] }
  // Fail-once keys already served, so the second call for a nonce recovers.
  const failedOnce = new Set()
  const sockets = new Set()

  const server = createServer((request, response) => {
    handle(request, response, { stats, requests, now, failedOnce }).catch((error) => {
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
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

if (
  import.meta.url ===
  pathToFileURL(process.argv[1] ? fs.realpathSync(process.argv[1]) : '').href
) {
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
