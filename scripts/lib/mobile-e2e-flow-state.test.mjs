// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): the runner's verdict on what the weather provider double saw
// while maestro/location-use-my-location.yaml ran, and the saved-location hooks around that flow.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  LOCATION_CAPTURE_FLOW,
  mobileE2EFlowStateHooks,
  USE_MY_LOCATION_DEVICE,
  USE_MY_LOCATION_FLOW,
  USE_MY_LOCATION_ROUNDED,
  useMyLocationWeatherDoubleCause,
} from './mobile-e2e-flow-state.mjs'
import { reversePlaces } from './weather-provider-double-data.mjs'

const before = { geocoding: 4 }
const reverse = (seq, latitude, longitude, query = '') => ({
  seq,
  provider: 'openweather',
  query,
  latitude,
  longitude,
})

describe('Use my location weather double verdict', () => {
  test('the rounded device position resolves to the double catalog Chicago', () => {
    assert.equal(
      reversePlaces(
        USE_MY_LOCATION_ROUNDED.latitude,
        USE_MY_LOCATION_ROUNDED.longitude
      )[0]?.name,
      'Chicago'
    )
    assert.equal(Math.round(USE_MY_LOCATION_DEVICE.latitude * 100) / 100, 41.87)
    assert.equal(Math.round(USE_MY_LOCATION_DEVICE.longitude * 100) / 100, -87.64)
  })

  test('passes when a reverse lookup arrived at exactly the rounded position', () => {
    const requests = {
      geocoding: [
        reverse(3, USE_MY_LOCATION_DEVICE.latitude, USE_MY_LOCATION_DEVICE.longitude),
        { seq: 5, provider: 'openweather', query: 'Sentinel probe' },
        reverse(6, 41.87, -87.64),
      ],
    }
    // seq 3 came before the flow, so the precise position in it is not this flow's.
    assert.equal(useMyLocationWeatherDoubleCause({ before, requests }), undefined)
  })

  test('fails when no reverse lookup happened during the flow', () => {
    assert.equal(
      useMyLocationWeatherDoubleCause({
        before,
        requests: { geocoding: [{ seq: 5, provider: 'openweather', query: 'Chicago' }] },
      }),
      'weather provider double saw no reverse lookup during the flow'
    )
  })

  test('fails when the precise device position reached the provider', () => {
    assert.equal(
      useMyLocationWeatherDoubleCause({
        before,
        requests: {
          geocoding: [
            reverse(5, USE_MY_LOCATION_DEVICE.latitude, USE_MY_LOCATION_DEVICE.longitude),
          ],
        },
      }),
      'the precise device position reached the weather provider; the app must round it first'
    )
    // The WeatherAPI form carries the position in its query.
    assert.match(
      useMyLocationWeatherDoubleCause({
        before,
        requests: {
          geocoding: [
            reverse(5, 41.87, -87.64),
            {
              seq: 6,
              provider: 'weatherapi',
              query: `${USE_MY_LOCATION_DEVICE.latitude},${USE_MY_LOCATION_DEVICE.longitude}`,
            },
          ],
        },
      }) ?? '',
      /precise device position/
    )
  })

  test('passes a reduced-accuracy fix the OS moved, rounded to two decimals, near Chicago', () => {
    // Coarse location answered a fix a few hundred metres from the injected position.
    assert.equal(
      useMyLocationWeatherDoubleCause({
        before,
        requests: { geocoding: [reverse(5, 41.9, -87.68)] },
      }),
      undefined
    )
  })

  /** No failure reason may carry a position: the runner logs it in CI. */
  const expectNoPosition = (cause, ...values) => {
    for (const value of values)
      assert.ok(!cause.includes(String(value)), `${cause} names ${value}`)
    assert.doesNotMatch(cause, /\d+\.\d+/)
  }

  test('fails when a lookup carried more than two decimals, without naming it', () => {
    const cause = useMyLocationWeatherDoubleCause({
      before,
      requests: { geocoding: [reverse(5, 41.873, -87.64)] },
    })
    assert.equal(cause, '1 of 1 reverse lookups carried more than two decimals')
    expectNoPosition(cause, 41.873, -87.64)
  })

  test('checks every lookup on both axes: a valid Chicago first does not excuse a later longitude', () => {
    const cause = useMyLocationWeatherDoubleCause({
      before,
      requests: {
        geocoding: [reverse(5, 41.87, -87.64), reverse(6, 41.87, -87.6412)],
      },
    })
    assert.equal(cause, '1 of 2 reverse lookups carried more than two decimals')
    expectNoPosition(cause, 41.87, -87.6412)
  })

  test('fails when no lookup resolved to the city the flow saves, without naming them', () => {
    const cause = useMyLocationWeatherDoubleCause({
      before,
      requests: { geocoding: [reverse(5, 40.71, -74.01)] },
    })
    assert.equal(cause, 'none of 1 reverse lookups resolved to Chicago')
    expectNoPosition(cause, 40.71, -74.01)
  })
})

describe('Use my location flow state hooks', () => {
  test('clear and restore saved locations like location capture', async () => {
    const hooks = mobileE2EFlowStateHooks({
      locationSentinelKeySuffix: '-sentinel',
      cleanupComments: () => Promise.resolve(),
    })
    assert.ok(hooks[USE_MY_LOCATION_FLOW])
    const calls = []
    const prisma = {
      savedLocation: {
        deleteMany: (args) => (calls.push(['savedLocation.deleteMany', args]), args),
        create: (args) => (calls.push(['savedLocation.create', args.data.label]), args),
      },
      forecastSegment: { deleteMany: (args) => (calls.push(['forecastSegment']), args) },
      weatherSnapshot: { deleteMany: (args) => (calls.push(['weatherSnapshot']), args) },
      $transaction: async (operations) => operations,
    }
    await hooks[USE_MY_LOCATION_FLOW].before(prisma, 'member-1')
    assert.deepEqual(calls[0], [
      'savedLocation.deleteMany',
      { where: { user_id: 'member-1' } },
    ])
    calls.length = 0
    await hooks[USE_MY_LOCATION_FLOW].after(prisma, 'member-1')
    assert.deepEqual(calls, [
      ['savedLocation.deleteMany', { where: { user_id: 'member-1' } }],
      ['savedLocation.create', 'Chicago'],
    ])
    assert.equal(
      hooks[USE_MY_LOCATION_FLOW].after.toString(),
      hooks[LOCATION_CAPTURE_FLOW].after.toString()
    )
  })
})
