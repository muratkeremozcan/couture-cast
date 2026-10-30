import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import {
  assertShareCardJobs,
  pullRequestShareCardJobs,
  requiredShareCardJobs,
} from './share-card-job-gate.mjs'

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
const cli = (value, event) =>
  spawnSync(process.execPath, ['scripts/ci/share-card-job-gate.mjs'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...(value === undefined ? {} : { CC68_JOB_RESULTS: value }),
      ...(event === undefined ? {} : { CC68_EVENT_NAME: event }),
    },
  })

describe('share-card aggregate job gate', () => {
  test('requires the Android lane, the browser lane, all three Android36 partitions, the three iOS shard jobs and the Expo Go proof', () => {
    assert.deepEqual([...requiredShareCardJobs].sort(), [
      'android36-interaction',
      'android36-native-matrix',
      'android36-original',
      'browser-acceptance',
      'ios-build',
      'ios-evidence',
      'ios-expo-go',
      'ios-shard',
      'original-resource',
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
        'android36-interaction',
        'android36-native-matrix',
        'android36-original',
        'ios-build',
        'ios-evidence',
        'ios-expo-go',
        'ios-shard',
        'original-resource',
      ])
    })

    test('passes when the browser lane succeeded and every device lane was skipped', () => {
      assert.deepEqual(
        assertShareCardJobs(pullRequestResults(), 'pull_request'),
        requiredShareCardJobs
      )
      const ok = cli(JSON.stringify(pullRequestResults()), 'pull_request')
      assert.equal(ok.status, 0, ok.stderr)
      assert.match(ok.stdout, /Required share-card jobs passed/)
    })

    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      test(`${outcome} browser-acceptance fails on a pull request`, () => {
        const value = pullRequestResults({ 'browser-acceptance': outcome })
        assert.throws(
          () => assertShareCardJobs(value, 'pull_request'),
          /failed: browser-acceptance$/
        )
        assert.equal(cli(JSON.stringify(value), 'pull_request').status, 1)
      })
    }

    for (const name of deviceLanes)
      for (const outcome of ['success', 'failure', 'cancelled']) {
        test(`${outcome} ${name} fails on a pull request: it must be skipped`, () => {
          const value = pullRequestResults({ [name]: outcome })
          assert.throws(
            () => assertShareCardJobs(value, 'pull_request'),
            new RegExp(`failed: ${name}$`)
          )
          assert.equal(cli(JSON.stringify(value), 'pull_request').status, 1)
        })
      }
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

    test('the pull request skip pattern fails without the pull_request event', () => {
      for (const event of ['push', 'schedule', 'workflow_dispatch', 'Pull_Request', ''])
        assert.throws(() => assertShareCardJobs(pullRequestResults(), event))
      assert.equal(cli(JSON.stringify(pullRequestResults())).status, 1)
    })
  })
})
