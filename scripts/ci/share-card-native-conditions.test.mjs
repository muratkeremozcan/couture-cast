import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { evaluateApprovedCondition } from './workflow-step-shadowing.mjs'

const workflow = parse(
  fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
)
const job = workflow.jobs['original-resource']
const steps = job.steps
const matrix = job.strategy.matrix
const step = (name) => {
  const found = steps.find((row) => row.name === name)
  assert.ok(found, name)
  return found
}
const suites = step('Verify share-card harness and plugin suites')
const bridge = step(
  'Verify localized native accessibility announcements and focus bridge'
)
const runs = (row, platform, outcomes) =>
  evaluateApprovedCondition(row.if, { matrix, row: { platform }, outcomes })

describe('share-card native step conditions', () => {
  for (const platform of ['android'])
    for (const [failure, outcomes] of [
      ['the runtime', { install: 'success', supabase: 'failure', runtime: 'skipped' }],
      [
        'browser provisioning',
        {
          install: 'success',
          runtime: 'success',
          browser_deps: 'failure',
        },
      ],
    ])
      test(`on ${platform}, a failed ${failure} skips the bridge but not the harness suites`, () => {
        assert.equal(runs(suites, platform, outcomes), true)
        assert.equal(runs(bridge, platform, outcomes), false)
      })

  test('the harness suites run before Java, Supabase and the runtime, skipping only on a failed install', () => {
    const index = (predicate) => steps.findIndex(predicate)
    assert.ok(
      steps.indexOf(suites) > index((row) => row.uses === './.github/actions/install')
    )
    assert.ok(
      steps.indexOf(suites) < index((row) => row.uses === 'actions/setup-java@v4')
    )
    assert.equal(runs(suites, 'android', { install: 'failure' }), false)
    assert.equal(
      evaluateApprovedCondition(suites.if, {
        matrix,
        row: { platform: 'android' },
        outcomes: { install: 'success' },
        cancelled: true,
      }),
      false
    )
  })

  test('the bridge still runs once its runtime and platform browser succeeded', () => {
    assert.equal(
      runs(bridge, 'android', { runtime: 'success', browser_deps: 'success' }),
      true
    )
    assert.equal(
      runs(bridge, 'android', { runtime: 'success', browser_deps: 'failure' }),
      false
    )
  })

  test('the iOS build bridge runs once its runtime and browser succeeded', () => {
    const iosBridge = workflow.jobs['ios-build'].steps.find(
      (row) => row.name === bridge.name
    )
    const iosRuns = (outcomes) =>
      evaluateApprovedCondition(iosBridge.if, { matrix: undefined, row: {}, outcomes })
    assert.equal(iosRuns({ runtime: 'success', ios_browser: 'success' }), true)
    assert.equal(iosRuns({ runtime: 'success', ios_browser: 'failure' }), false)
    assert.equal(iosRuns({ runtime: 'failure', ios_browser: 'success' }), false)
  })
})
