import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { assertShareCardJobs, requiredShareCardJobs } from './share-card-job-gate.mjs'

const results = (override = {}) =>
  Object.fromEntries(
    requiredShareCardJobs.map((name) => [name, { result: override[name] ?? 'success' }])
  )
const cli = (value) =>
  spawnSync(process.execPath, ['scripts/ci/share-card-job-gate.mjs'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...(value === undefined ? {} : { CC68_JOB_RESULTS: value }),
    },
  })

describe('share-card aggregate job gate', () => {
  test('requires the Android lane, the browser lane, all three Android36 partitions and the three iOS shard jobs', () => {
    assert.deepEqual([...requiredShareCardJobs].sort(), [
      'android36-interaction',
      'android36-native-matrix',
      'android36-original',
      'browser-acceptance',
      'ios-build',
      'ios-evidence',
      'ios-shard',
      'original-resource',
    ])
  })

  test('passes only when every required job succeeded', () => {
    assert.deepEqual(assertShareCardJobs(results()), requiredShareCardJobs)
    const ok = cli(JSON.stringify(results()))
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /Required share-card jobs passed/)
  })

  for (const name of requiredShareCardJobs)
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      test(`${outcome} ${name} fails the helper and the CLI`, () => {
        const value = results({ [name]: outcome })
        assert.throws(() => assertShareCardJobs(value), new RegExp(`failed: ${name}$`))
        const run = cli(JSON.stringify(value))
        assert.equal(run.status, 1)
        assert.ok(run.stderr.includes(name))
      })
    }

  for (const name of requiredShareCardJobs)
    test(`a missing ${name} result is refused`, () => {
      const value = results()
      delete value[name]
      assert.throws(() => assertShareCardJobs(value), /share_card_job_results_invalid/)
      assert.equal(cli(JSON.stringify(value)).status, 1)
    })

  test('an empty result of any required job fails', () => {
    for (const name of requiredShareCardJobs) {
      const value = results()
      value[name] = {}
      assert.throws(() => assertShareCardJobs(value), new RegExp(name))
      value[name] = null
      assert.throws(() => assertShareCardJobs(value), new RegExp(name))
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
      const run = cli(raw)
      assert.equal(run.status, 1)
      assert.equal(run.stderr.trim(), 'share_card_job_results_invalid')
      assert.equal(run.stdout.includes(secret) || run.stderr.includes(secret), false)
    }
  })

  test('a success lookalike does not pass', () => {
    for (const result of ['Success', 'success ', 'successful', true, 1])
      assert.throws(() => assertShareCardJobs(results({ 'original-resource': result })))
  })
})
