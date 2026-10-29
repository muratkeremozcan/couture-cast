import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  NATIVE_JOURNEY_TEMPERATURE_C,
  nativeJourneyTemperature,
  startWeatherProviderDouble,
} from '../weather-provider-double.mjs'

const runner = fs.readFileSync(
  new URL('../run-story68-native.mjs', import.meta.url),
  'utf8'
)

async function hourly(options) {
  const double = await startWeatherProviderDouble(options)
  try {
    const open = await (
      await fetch(`${double.origin}/data/3.0/onecall?lat=37.7&lon=-122.4&appid=k`)
    ).json()
    const api = await (
      await fetch(`${double.origin}/v1/forecast.json?q=37.7,-122.4&key=k`)
    ).json()
    return {
      open: open.hourly.map((hour) => hour.temp),
      openFeels: open.hourly.map((hour) => hour.feels_like),
      api: api.forecast.forecastday.flatMap((day) => day.hour.map((hour) => hour.temp_c)),
    }
  } finally {
    await double.close()
  }
}

test('the default forecast still swings with the hour, which the other lanes rely on', async () => {
  const series = await hourly({ now: () => Date.UTC(2026, 9, 29, 13, 20) })
  assert.ok(Math.min(...series.open) < 14 && Math.max(...series.open) > 23)
})

test('the pinned forecast is one temperature for every hour on both providers', async () => {
  const series = await hourly({
    now: () => Date.UTC(2026, 9, 29, 13, 20),
    temperatureAt: nativeJourneyTemperature,
  })
  assert.equal(series.open.length, 48)
  for (const value of [...series.open, ...series.api])
    assert.equal(value, NATIVE_JOURNEY_TEMPERATURE_C)
  for (const value of series.openFeels)
    assert.equal(value, NATIVE_JOURNEY_TEMPERATURE_C - 1)
})

test('the native journeys serve the pinned forecast', () => {
  const serve = runner.slice(runner.indexOf("command === 'serve'"))
  assert.match(
    serve.slice(0, serve.indexOf('const api = child(')),
    /startWeatherProviderDouble\(\{[^}]*temperatureAt: nativeJourneyTemperature/s
  )
})
