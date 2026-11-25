// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): the runner's verdict on what the weather provider double saw
// while maestro/location-use-my-location.yaml ran, and the saved-location hooks around that flow.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  GARMENT_DELETE_FLOW,
  garmentDeleteFixtureId,
  LOCATION_CAPTURE_FLOW,
  mobileE2EFlowStateHooks,
  settleMobileE2EFlowState,
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

// Story 7.6 test plan 7.6-MAE-001: the garment delete flow deletes its own dress, never a shared
// seeded garment or another dress, and leaves nothing behind for the next attempt or the next
// flow. After a passing flow its verify hook proves the DELETE landed.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
describe('Garment delete flow state hooks', () => {
  const member = 'member-1'
  const fixtureId = garmentDeleteFixtureId(member)
  const fixturePath = `wardrobe/${member}/${fixtureId}.png`
  const fixtureRemoval = [
    ['wardrobeObjectDeletion.deleteMany', { where: { object_path: fixturePath } }],
    ['garmentItem.deleteMany', { where: { id: fixtureId, user_id: member } }],
  ]
  const fixtureRead = [
    'garmentItem.findFirst',
    { where: { id: fixtureId, user_id: member }, select: { retention_status: true } },
  ]

  /**
   * `statuses` answers the after hook's reads of the fixture in order (null: no row);
   * `failCleanup` makes the cleanup transaction reject.
   */
  const recordingPrisma = ({ statuses = [], failCleanup = false } = {}) => {
    const calls = []
    const prisma = {
      garmentItem: {
        findFirst: async (args) => {
          calls.push(['garmentItem.findFirst', args])
          const status = statuses.length > 1 ? statuses.shift() : statuses[0]
          return status === null || status === undefined
            ? null
            : { retention_status: status }
        },
        deleteMany: (args) => (calls.push(['garmentItem.deleteMany', args]), args),
        create: async (args) => (
          calls.push(['garmentItem.create', args.data]),
          args.data
        ),
      },
      wardrobeObjectDeletion: {
        deleteMany: (args) => (
          calls.push(['wardrobeObjectDeletion.deleteMany', args]),
          args
        ),
      },
      $transaction: async (operations) => {
        if (failCleanup) throw new Error('database unavailable')
        return operations
      },
    }
    return { prisma, calls }
  }
  const sleeps = []
  const hooks = mobileE2EFlowStateHooks({
    locationSentinelKeySuffix: '-sentinel',
    cleanupComments: () => Promise.resolve(),
    garmentDeleteSettle: {
      timeoutMs: 60_000,
      intervalMs: 250,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    },
  })
  const expired = mobileE2EFlowStateHooks({
    locationSentinelKeySuffix: '-sentinel',
    cleanupComments: () => Promise.resolve(),
    garmentDeleteSettle: { timeoutMs: 0, sleep: () => Promise.resolve() },
  })

  test('the fixture ID is a UUID reserved per member and stable across attempts', () => {
    assert.match(
      fixtureId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    assert.equal(garmentDeleteFixtureId(member), fixtureId)
    assert.notEqual(garmentDeleteFixtureId('member-2'), fixtureId)
  })

  test('before clears a leftover fixture by its exact ID and key, then seeds one ready dress', async () => {
    const { prisma, calls } = recordingPrisma()

    await hooks[GARMENT_DELETE_FLOW].before(prisma, member)

    assert.deepEqual(calls.slice(0, 2), fixtureRemoval)
    const [kind, data] = calls[2]
    assert.equal(kind, 'garmentItem.create')
    assert.equal(data.id, fixtureId)
    assert.equal(data.user_id, member)
    assert.equal(data.category, 'dress')
    assert.equal(data.upload_status, 'ready')
    assert.equal(data.retention_status, 'active')
    assert.equal(data.object_path, fixturePath)
    assert.equal(calls.length, 3)
  })

  const settle = (hookSet, prisma, passed) =>
    settleMobileE2EFlowState(hookSet[GARMENT_DELETE_FLOW], prisma, member, { passed })

  test('a passing flow waits for its in-flight DELETE to land, then removes only the fixture', async () => {
    sleeps.length = 0
    const { prisma, calls } = recordingPrisma({
      statuses: ['active', 'active', 'deletion_pending'],
    })

    await settle(hooks, prisma, true)

    assert.deepEqual(sleeps, [250, 250])
    assert.deepEqual(calls, [fixtureRead, fixtureRead, fixtureRead, ...fixtureRemoval])
  })

  test('a failed flow is only cleaned up: it already has its cause', async () => {
    const { prisma, calls } = recordingPrisma({ statuses: ['active'] })

    await settle(expired, prisma, false)

    assert.deepEqual(calls, fixtureRemoval)
  })

  test('a passing flow fails with the fixture still active at the deadline, and still removes it', async () => {
    const { prisma, calls } = recordingPrisma({ statuses: ['active'] })

    await assert.rejects(settle(expired, prisma, true), (error) => {
      assert.match(error.message, /^garment_delete_not_committed: /)
      assert.match(error.message, /still active at the 0 ms deadline/)
      return true
    })
    assert.deepEqual(calls.slice(-2), fixtureRemoval)
  })

  test('the check names a fixture that something else removed', async () => {
    const { prisma } = recordingPrisma({ statuses: [null] })
    await assert.rejects(
      settle(hooks, prisma, true),
      /^Error: garment_delete_fixture_missing: /
    )
  })

  test('when the check and the cleanup both fail, both causes are reported', async () => {
    const { prisma } = recordingPrisma({ statuses: ['active'], failCleanup: true })

    await assert.rejects(settle(expired, prisma, true), (error) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 2)
      assert.match(error.errors[0].message, /^garment_delete_not_committed: /)
      assert.equal(error.errors[1].message, 'database unavailable')
      assert.match(error.message, /cleanup also failed: database unavailable/)
      return true
    })
  })

  test('a cleanup failure alone is reported as itself', async () => {
    const { prisma } = recordingPrisma({
      statuses: ['deletion_pending'],
      failCleanup: true,
    })
    await assert.rejects(settle(hooks, prisma, true), { message: 'database unavailable' })
  })

  test('after alone removes only the fixture, as suites that run every hook expect', async () => {
    const { prisma, calls } = recordingPrisma({ statuses: ['active'] })
    await hooks[GARMENT_DELETE_FLOW].after(prisma, member)
    assert.deepEqual(calls, fixtureRemoval)
  })

  test('refuses to run without a member, so it can never match every member', async () => {
    const { prisma } = recordingPrisma()
    await assert.rejects(
      hooks[GARMENT_DELETE_FLOW].before(prisma, '  '),
      /requires a member ID/
    )
    await assert.rejects(
      hooks[GARMENT_DELETE_FLOW].after(prisma, ''),
      /requires a member ID/
    )
    await assert.rejects(
      hooks[GARMENT_DELETE_FLOW].verify(prisma, ''),
      /requires a member ID/
    )
  })
})
