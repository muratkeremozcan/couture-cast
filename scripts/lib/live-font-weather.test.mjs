// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling on Antigravity r30 item 1: the run ages the harness location's weather snapshot past
// the hour, through the harness's own local database only.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  ageWeatherSnapshot,
  AGED_WEATHER_BANNER,
  harnessDatabaseUrl,
  WEATHER_AGE_MINUTES,
} from './live-font-weather.mjs'

const DATABASE = `tea_community_${'a1'.repeat(16)}`
const owned = (url) => ({ DATABASE_URL: url })
const NOW = Date.parse('2026-11-13T20:00:00.000Z')

/** A database runner that records each statement and answers with `rows` or throws `error`. */
function fakeQuery({ rows = 1, error } = {}) {
  const calls = []
  const query = async (url, sql, params) => {
    calls.push({ url, sql, params })
    if (error) throw error
    return rows
  }
  return { query, calls }
}

describe('harnessDatabaseUrl', () => {
  test("takes the harness's own database on a loopback host", () => {
    for (const host of ['127.0.0.1:54322', 'localhost:5432'])
      for (const scheme of ['postgresql', 'postgres'])
        assert.equal(
          harnessDatabaseUrl(owned(`${scheme}://postgres:pw@${host}/${DATABASE}`)),
          `${scheme}://postgres:pw@${host}/${DATABASE}`
        )
  })

  test('refuses another host, the default database, or no URL, and never echoes the URL', () => {
    const refused = (pattern) => (error) =>
      error.code === 'live_font_harness_database_required' &&
      pattern.test(error.message) &&
      !/pw@/.test(error.message)
    for (const [url, pattern] of [
      [
        `postgresql://postgres:pw@db.example.com:5432/${DATABASE}`,
        /host db\.example\.com is not local/,
      ],
      [
        `postgresql://postgres:pw@10.0.0.5:54322/${DATABASE}`,
        /host 10\.0\.0\.5 is not local/,
      ],
      [
        'postgresql://postgres:pw@127.0.0.1:54322/postgres',
        /database postgres is not a harness/,
      ],
      ['postgresql://postgres:pw@127.0.0.1:54322/', /database missing is not a harness/],
      [
        `postgresql://postgres:pw@127.0.0.1:54322/${DATABASE}x`,
        /is not a harness database/,
      ],
      [
        `postgresql://postgres:pw@127.0.0.1:54322/${DATABASE}?host=db.example.com`,
        /connection options in the URL are not allowed/,
      ],
      [
        `postgresql://postgres:pw@127.0.0.1:54322/${DATABASE}?host=/var/run/postgresql`,
        /connection options in the URL are not allowed/,
      ],
      [`http://postgres:pw@127.0.0.1:54322/${DATABASE}`, /scheme http: is not postgres/],
      ['not a url', /DATABASE_URL unreadable/],
      [undefined, /DATABASE_URL unreadable/],
    ])
      assert.throws(() => harnessDatabaseUrl(owned(url)), refused(pattern), String(url))
    assert.throws(() => harnessDatabaseUrl(undefined), {
      code: 'live_font_harness_database_required',
    })
  })
})

describe('ageWeatherSnapshot', () => {
  const url = `postgresql://postgres:pw@127.0.0.1:54322/${DATABASE}`

  test('sets fetched_at two hours back for the harness location and reports the banner', async () => {
    const { query, calls } = fakeQuery({ rows: 1 })
    const result = await ageWeatherSnapshot({ ownedEnv: owned(url), query, now: NOW })
    assert.equal(WEATHER_AGE_MINUTES, 120)
    assert.deepEqual(calls, [
      {
        url,
        sql: 'UPDATE "WeatherSnapshot" SET "fetched_at" = $1 WHERE "location_key" = $2',
        params: [new Date('2026-11-13T18:00:00.000Z'), 'san-francisco-ca'],
      },
    ])
    assert.deepEqual(result, {
      weatherBanner: AGED_WEATHER_BANNER,
      weatherAging: {
        locationKey: 'san-francisco-ca',
        ageMinutes: 120,
        fetchedAt: '2026-11-13T18:00:00.000Z',
        snapshots: 1,
      },
    })
    assert.equal(AGED_WEATHER_BANNER, 'out-of-date')
  })

  test('a non-local or non-harness URL is refused before any statement runs', async () => {
    for (const bad of [
      `postgresql://postgres:pw@db.example.com/${DATABASE}`,
      'postgresql://postgres:pw@127.0.0.1:54322/postgres',
    ]) {
      const { query, calls } = fakeQuery()
      await assert.rejects(
        ageWeatherSnapshot({ ownedEnv: owned(bad), query, now: NOW }),
        {
          code: 'live_font_harness_database_required',
        }
      )
      assert.deepEqual(calls, [])
    }
  })

  test('a failed statement or no snapshot to age fails coded', async () => {
    const failing = fakeQuery({
      error: new Error('connect ECONNREFUSED 127.0.0.1:54322'),
    })
    await assert.rejects(
      ageWeatherSnapshot({ ownedEnv: owned(url), query: failing.query, now: NOW }),
      (error) =>
        error.code === 'live_font_weather_aging_failed' &&
        /ECONNREFUSED/.test(error.message)
    )
    const empty = fakeQuery({ rows: 0 })
    await assert.rejects(
      ageWeatherSnapshot({ ownedEnv: owned(url), query: empty.query, now: NOW }),
      (error) =>
        error.code === 'live_font_weather_aging_failed' &&
        /no snapshot for san-francisco-ca/.test(error.message)
    )
  })
})
