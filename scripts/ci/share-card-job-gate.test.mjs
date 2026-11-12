// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import {
  assertShareCardJobs,
  laneJobName,
  pullRequestShareCardJobs,
  requiredShareCardJobs,
  shareCardLane,
} from './share-card-job-gate.mjs'
import { LANES } from './lanes.mjs'

const results = (override = {}) =>
  Object.fromEntries(
    requiredShareCardJobs.map((name) => [name, { result: override[name] ?? 'success' }])
  )
const deviceLanes = requiredShareCardJobs.filter(
  (name) => !pullRequestShareCardJobs.includes(name)
)
// On a pull request the device lanes are skipped by their job-level condition.
const pullRequestResults = (override = {}) =>
  results(
    Object.fromEntries([
      ...deviceLanes.map((name) => [name, 'skipped']),
      ...Object.entries(override),
    ])
  )
// The lanes job's plan for a pull request whose diff runs, or skips, the browser lane.
const browserRuns = { [shareCardLane]: true, maestro: false }
const browserSkipped = { [shareCardLane]: false, maestro: true }
// The workflow's needs always include the lanes job; a test that names no lanes result gets a
// successful one, as every run where the plan exists does.
const withLanes = (value) => {
  try {
    const parsed = JSON.parse(value)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      !(laneJobName in parsed)
    )
      return JSON.stringify({ ...parsed, [laneJobName]: { result: 'success' } })
  } catch {
    // Malformed input stays as it is: those cases test the refusal.
  }
  return value
}
const cli = (value, event, plan) =>
  spawnSync(process.execPath, ['scripts/ci/share-card-job-gate.mjs'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...(value === undefined ? {} : { CC68_JOB_RESULTS: withLanes(value) }),
      ...(event === undefined ? {} : { CC68_EVENT_NAME: event }),
      ...(plan === undefined ? {} : { CC68_LANE_PLAN: JSON.stringify(plan) }),
    },
  })

describe('share-card aggregate job gate', () => {
  test('requires both API32 shards and their evidence, the browser lane, the five Android36 partitions, the Android36 matrix shard evidence, the three iOS shard jobs and the Expo Go proof', () => {
    assert.deepEqual([...requiredShareCardJobs].sort(), [
      'android36-controls',
      'android36-interaction',
      'android36-matrix-evidence',
      'android36-native-matrix',
      'android36-original',
      'android36-release-font',
      'browser-acceptance',
      'ios-build',
      'ios-evidence',
      'ios-expo-go',
      'ios-shard',
      'original-resource',
      'original-resource-evidence',
    ])
  })

  test('passes only when every required job succeeded', () => {
    assert.deepEqual(assertShareCardJobs(results(), 'push'), requiredShareCardJobs)
    const ok = cli(JSON.stringify(results()), 'push')
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /Required share-card jobs passed/)
  })

  for (const name of requiredShareCardJobs)
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      test(`${outcome} ${name} fails the helper and the CLI`, () => {
        const value = results({ [name]: outcome })
        assert.throws(
          () => assertShareCardJobs(value, 'push'),
          new RegExp(`failed: ${name}$`)
        )
        const run = cli(JSON.stringify(value), 'push')
        assert.equal(run.status, 1)
        assert.ok(run.stderr.includes(name))
      })
    }

  for (const name of requiredShareCardJobs)
    test(`a missing ${name} result is refused`, () => {
      const value = results()
      delete value[name]
      assert.throws(
        () => assertShareCardJobs(value, 'push'),
        /share_card_job_results_invalid/
      )
      assert.equal(cli(JSON.stringify(value), 'push').status, 1)
    })

  test('an empty result of any required job fails', () => {
    for (const name of requiredShareCardJobs) {
      const value = results()
      value[name] = {}
      assert.throws(() => assertShareCardJobs(value, 'push'), new RegExp(name))
      value[name] = null
      assert.throws(() => assertShareCardJobs(value, 'push'), new RegExp(name))
    }
  })

  test('extra, malformed or absent results are refused without echoing supplied values', () => {
    const secret = 'cc68-secret-marker'
    for (const raw of [
      JSON.stringify({ ...results(), [secret]: { result: 'success' } }),
      JSON.stringify([results()]),
      JSON.stringify(null),
      JSON.stringify('success'),
      `{${secret}`,
      '',
      undefined,
    ]) {
      const run = cli(raw, 'push')
      assert.equal(run.status, 1)
      assert.equal(run.stderr.trim(), 'share_card_job_results_invalid')
      assert.equal(run.stdout.includes(secret) || run.stderr.includes(secret), false)
    }
  })

  test('a success lookalike does not pass', () => {
    for (const result of ['Success', 'success ', 'successful', true, 1])
      assert.throws(() =>
        assertShareCardJobs(results({ 'original-resource': result }), 'push')
      )
  })

  describe('pull_request', () => {
    test('only the browser lane runs on a pull request', () => {
      assert.deepEqual([...pullRequestShareCardJobs], ['browser-acceptance'])
      assert.deepEqual(deviceLanes.sort(), [
        'android36-controls',
        'android36-interaction',
        'android36-matrix-evidence',
        'android36-native-matrix',
        'android36-original',
        'android36-release-font',
        'ios-build',
        'ios-evidence',
        'ios-expo-go',
        'ios-shard',
        'original-resource',
        'original-resource-evidence',
      ])
    })

    test('passes when the browser lane succeeded and every device lane was skipped', () => {
      assert.deepEqual(
        assertShareCardJobs(pullRequestResults(), 'pull_request', browserRuns),
        requiredShareCardJobs
      )
      const ok = cli(JSON.stringify(pullRequestResults()), 'pull_request', browserRuns)
      assert.equal(ok.status, 0, ok.stderr)
      assert.match(ok.stdout, /Required share-card jobs passed/)
    })

    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      test(`${outcome} browser-acceptance fails on a pull request`, () => {
        const value = pullRequestResults({ 'browser-acceptance': outcome })
        assert.throws(
          () => assertShareCardJobs(value, 'pull_request', browserRuns),
          /failed: browser-acceptance$/
        )
        assert.equal(cli(JSON.stringify(value), 'pull_request', browserRuns).status, 1)
      })
    }

    for (const name of deviceLanes)
      for (const outcome of ['success', 'failure', 'cancelled']) {
        test(`${outcome} ${name} fails on a pull request: it must be skipped`, () => {
          const value = pullRequestResults({ [name]: outcome })
          assert.throws(
            () => assertShareCardJobs(value, 'pull_request', browserRuns),
            new RegExp(`failed: ${name}$`)
          )
          assert.equal(cli(JSON.stringify(value), 'pull_request', browserRuns).status, 1)
        })
      }
  })

  describe('the lane plan on a pull request', () => {
    test('names a lane that gates browser-acceptance in this workflow', () => {
      assert.equal(LANES[shareCardLane].workflow, 'pr-share-card-native.yml')
      assert.deepEqual(LANES[shareCardLane].jobs, [...pullRequestShareCardJobs])
    })

    test('a browser lane the plan skipped passes when it was skipped', () => {
      const value = pullRequestResults({ 'browser-acceptance': 'skipped' })
      assert.deepEqual(
        assertShareCardJobs(value, 'pull_request', browserSkipped),
        requiredShareCardJobs
      )
      const ok = cli(JSON.stringify(value), 'pull_request', browserSkipped)
      assert.equal(ok.status, 0, ok.stderr)
    })

    for (const outcome of ['success', 'failure', 'cancelled'])
      test(`a browser lane the plan skipped fails when it reports ${outcome}`, () => {
        const value = pullRequestResults({ 'browser-acceptance': outcome })
        assert.throws(
          () => assertShareCardJobs(value, 'pull_request', browserSkipped),
          /failed: browser-acceptance$/
        )
      })

    test('a plan that skips the browser lane still requires every device lane skipped', () => {
      for (const name of deviceLanes)
        assert.throws(
          () =>
            assertShareCardJobs(
              pullRequestResults({ 'browser-acceptance': 'skipped', [name]: 'success' }),
              'pull_request',
              browserSkipped
            ),
          new RegExp(`failed: ${name}$`)
        )
    })

    test('a missing or unreadable plan fails a pull request without echoing it', () => {
      const secret = 'cc68-secret-marker'
      for (const plan of [
        undefined,
        null,
        [],
        'share-card',
        {},
        { [shareCardLane]: 'false' },
      ])
        assert.throws(
          () => assertShareCardJobs(pullRequestResults(), 'pull_request', plan),
          /share_card_lane_plan_invalid/
        )
      for (const raw of ['', `{${secret}`, 'null']) {
        const run = spawnSync(process.execPath, ['scripts/ci/share-card-job-gate.mjs'], {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            CC68_JOB_RESULTS: withLanes(JSON.stringify(pullRequestResults())),
            CC68_EVENT_NAME: 'pull_request',
            CC68_LANE_PLAN: raw,
          },
        })
        assert.equal(run.status, 1)
        assert.equal(run.stderr.trim(), 'share_card_lane_plan_invalid')
        assert.equal(run.stdout.includes(secret) || run.stderr.includes(secret), false)
      }
    })

    test('the CLI reads the plan from its own variable and ignores the lanes job result', () => {
      const value = {
        ...pullRequestResults({ 'browser-acceptance': 'skipped' }),
        [laneJobName]: { result: 'success', outputs: { plan: '{}' } },
      }
      const ok = cli(JSON.stringify(value), 'pull_request', browserSkipped)
      assert.equal(ok.status, 0, ok.stderr)
    })
  })

  describe('every other event requires every lane', () => {
    for (const event of [
      'push',
      'schedule',
      'workflow_dispatch',
      'merge_group',
      undefined,
    ])
      for (const name of deviceLanes)
        test(`a skipped ${name} fails on ${event}`, () => {
          const value = results({ [name]: 'skipped' })
          assert.throws(
            () => assertShareCardJobs(value, event),
            new RegExp(`failed: ${name}$`)
          )
          assert.equal(cli(JSON.stringify(value), event).status, 1)
        })

    for (const event of ['push', 'schedule', 'workflow_dispatch'])
      test(`all lanes successful passes on ${event}`, () => {
        assert.deepEqual(assertShareCardJobs(results(), event), requiredShareCardJobs)
        assert.equal(cli(JSON.stringify(results()), event).status, 0)
      })

    // The plan runs every lane off a pull request; a plan that says otherwise skips nothing.
    for (const event of ['push', 'schedule', 'workflow_dispatch'])
      test(`a plan skipping the browser lane does not excuse it on ${event}`, () => {
        assert.throws(
          () =>
            assertShareCardJobs(
              results({ 'browser-acceptance': 'skipped' }),
              event,
              browserSkipped
            ),
          /failed: browser-acceptance$/
        )
        assert.equal(
          cli(
            JSON.stringify(results({ 'browser-acceptance': 'skipped' })),
            event,
            browserSkipped
          ).status,
          1
        )
      })

    test('the pull request skip pattern fails without the pull_request event', () => {
      for (const event of ['push', 'schedule', 'workflow_dispatch', 'Pull_Request', ''])
        assert.throws(() => assertShareCardJobs(pullRequestResults(), event, browserRuns))
      assert.equal(
        cli(JSON.stringify(pullRequestResults()), undefined, browserRuns).status,
        1
      )
    })
  })
})

describe('the lanes job result (PR 212 review)', () => {
  // A lanes job can fail after writing its plan output (the summary write comes later), so a
  // plan that skips the browser lane must not pass the gate unless the lanes job succeeded.
  for (const lanes of ['failure', 'cancelled', 'skipped'])
    test(`a ${lanes} lanes job fails the gate even with a readable plan`, () => {
      const run = cli(
        JSON.stringify({
          ...pullRequestResults({ 'browser-acceptance': 'skipped' }),
          [laneJobName]: { result: lanes },
        }),
        'pull_request',
        browserSkipped
      )
      assert.equal(run.status, 1)
      assert.equal(run.stderr.trim(), 'share_card_lanes_job_failed')
    })

  test('a successful lanes job and a planned skip pass', () => {
    const run = cli(
      JSON.stringify({
        ...pullRequestResults({ 'browser-acceptance': 'skipped' }),
        [laneJobName]: { result: 'success' },
      }),
      'pull_request',
      browserSkipped
    )
    assert.equal(run.status, 0, run.stderr)
  })
})
