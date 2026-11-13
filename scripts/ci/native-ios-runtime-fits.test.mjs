import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { runtimeFits } from './native-ios-runtime-fits.mjs'

test('a client runs on a runtime at or above its minimum iOS', () => {
  for (const [minimum, runtime] of [
    ['15.1', '18.5'],
    ['18.5', '18.5'],
    ['18', '18.5'],
    ['18.5.0', '18.5'],
    ['17.0', '26.5'],
  ])
    assert.equal(runtimeFits(minimum, runtime), true, `${minimum} on ${runtime}`)
})

test('a client whose minimum iOS is above the runtime is refused', () => {
  for (const [minimum, runtime] of [
    ['18.6', '18.5'],
    ['19', '18.5'],
    ['26.0', '18.5'],
    ['18.5.1', '18.5'],
  ])
    assert.equal(runtimeFits(minimum, runtime), false, `${minimum} on ${runtime}`)
})

test('a malformed version fails closed', () => {
  for (const [minimum, runtime] of [
    ['', '18.5'],
    ['18.5', ''],
    ['iOS 18', '18.5'],
    ['18.5', '18.5 (22F77)'],
  ])
    assert.throws(() => runtimeFits(minimum, runtime), /ios_version_required/)
})

test('the command names both versions and fails when the client cannot run', () => {
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/ci/native-ios-runtime-fits.mjs', ...args], {
      encoding: 'utf8',
    })
  assert.equal(run('15.1', '18.5').status, 0)
  const refused = run('26.0', '18.5')
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /needs iOS 26\.0, but the simulator runtime is 18\.5/)
  assert.notEqual(run('x', '18.5').status, 0)
})
