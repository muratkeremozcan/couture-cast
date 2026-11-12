import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS, checkFlows } from './maestro-check-flows.mjs'

const workflow = parse(fs.readFileSync('.github/workflows/ios-native.yml', 'utf8'))

test('every checked flow exists', () => {
  for (const flow of CHECKED_FLOWS) assert.ok(fs.existsSync(flow), flow)
})

test('a binary that rejects a flow is reported with the flow name', () => {
  const failures = checkFlows(['maestro/story68/prefs-failed.yaml'], '/usr/bin/false')
  assert.equal(failures.length, 1)
  assert.match(failures[0], /^maestro\/story68\/prefs-failed\.yaml:/)
})

test('a binary that accepts every flow reports nothing', () => {
  assert.deepEqual(checkFlows(CHECKED_FLOWS, '/usr/bin/true'), [])
})

// The iOS checks that need no client run after the Expo Go proof in ios-native.yml, on every
// device run. Maestro comes with the Expo Go segment's runtime (scripts/ci/native-ios-runtime.sh).
test('the Expo Go segment runs the check after Maestro is installed, on every device run', () => {
  const steps = workflow.jobs['ios-native'].steps
  const install = steps.findIndex(
    (row) =>
      row.id === 'runtime' && row.run === 'bash scripts/ci/native-ios-runtime.sh start'
  )
  const check = steps.findIndex((row) =>
    row.run?.includes('node scripts/ci/maestro-check-flows.mjs')
  )
  assert.ok(install >= 0 && check > install)
  assert.match(
    fs.readFileSync('scripts/ci/native-ios-runtime.sh', 'utf8'),
    /\n {4}node scripts\/maestro-install\.mjs\n/
  )
  assert.match(
    steps[check].if,
    /^\$\{\{ !cancelled\(\) && steps\.runtime\.outcome == 'success' \}\}$/
  )
})
