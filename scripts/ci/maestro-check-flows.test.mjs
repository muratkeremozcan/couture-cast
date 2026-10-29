import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { CHECKED_FLOWS, checkFlows } from './maestro-check-flows.mjs'

const workflow = parse(
  fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
)

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

test('the iOS build job runs the check after Maestro is installed and before the build', () => {
  const steps = workflow.jobs['ios-build'].steps
  const install = steps.findIndex((row) => row.run?.includes('maestro-install.mjs'))
  const check = steps.findIndex((row) =>
    row.run?.includes('node scripts/ci/maestro-check-flows.mjs')
  )
  const build = steps.findIndex((row) =>
    row.run?.includes('run-story68-native.mjs build --platform ios')
  )
  assert.ok(install >= 0 && check > install && build > check)
})
