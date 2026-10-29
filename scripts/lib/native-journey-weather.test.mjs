import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  NATIVE_JOURNEY_FEELS_LIKE_C,
  NATIVE_JOURNEY_LOCATION_KEY,
  NATIVE_JOURNEY_TEMPERATURE_C,
  pinNativeJourneyWeather,
} from './native-journey-weather.mjs'

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const fakePrisma = (count) => {
  const calls = []
  return {
    calls,
    forecastSegment: {
      updateMany: async (args) => {
        calls.push(args)
        return { count }
      },
    },
  }
}

test('the pin flattens every segment of the harness location snapshot to one warm value', async () => {
  const prisma = fakePrisma(48)
  assert.equal(await pinNativeJourneyWeather(prisma), 48)
  assert.deepEqual(prisma.calls, [
    {
      where: { weather_snapshot: { location_key: 'san-francisco-ca' } },
      data: { temperature: 20, feels_like: 19 },
    },
  ])
  assert.equal(NATIVE_JOURNEY_TEMPERATURE_C - 1, NATIVE_JOURNEY_FEELS_LIKE_C)
})

test('a database the seed did not reach fails the journey instead of running on the mock fallback', async () => {
  await assert.rejects(
    pinNativeJourneyWeather(fakePrisma(0)),
    /native_journey_weather_missing/
  )
})

test('the pinned location is the saved location the harness account gets', () => {
  const prepare = read('scripts/e2e-share-card/prepare.mjs')
  assert.match(prepare, new RegExp(`location_key: '${NATIVE_JOURNEY_LOCATION_KEY}'`))
})

test('prepare pins the weather once the seed has run and before any account or outfit exists', () => {
  const prepare = read('scripts/e2e-share-card/prepare.mjs')
  const seed = prepare.indexOf("'packages/db/prisma/seeds/index.ts'")
  const pin = prepare.indexOf('await pinNativeJourneyWeather(prisma)')
  const account = prepare.indexOf('await prisma.user.create(')
  assert.ok(seed > 0 && pin > seed && account > pin)
  assert.match(
    prepare,
    /import \{ pinNativeJourneyWeather \} from '..\/lib\/native-journey-weather\.mjs'/
  )
})
