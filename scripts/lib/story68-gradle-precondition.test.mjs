import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  GRADLE_WRAPPER_PRECONDITION,
  gradleRunLog,
  requireGradleWrapper,
} from './story68-gradle-precondition.mjs'

const wrapper = '/repo/apps/mobile/android/gradlew'

test('a missing generated wrapper fails with the named precondition, the prebuild command and the JDK', () => {
  assert.throws(
    () =>
      requireGradleWrapper(wrapper, {
        exists: () => false,
        env: { JAVA_HOME: '/jdk-23' },
      }),
    (error) => {
      assert.match(error.message, new RegExp(`^${GRADLE_WRAPPER_PRECONDITION}:`))
      assert.match(error.message, /\/repo\/apps\/mobile\/android\/gradlew/)
      assert.match(error.message, /prebuild --platform android/)
      assert.match(error.message, /Temurin 21/)
      assert.match(error.message, /JAVA_HOME is \/jdk-23/)
      return true
    }
  )
  assert.throws(
    () => requireGradleWrapper(wrapper, { exists: () => false, env: {} }),
    /JAVA_HOME is unset/
  )
})

test('an existing wrapper passes without touching the JDK', () => {
  assert.doesNotThrow(() => requireGradleWrapper(wrapper, { exists: () => true }))
})

test('undefined or non-string stdout or stderr is named instead of becoming NaN', () => {
  const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
  for (const result of [
    { error, status: null },
    { stdout: undefined, stderr: '', error },
    { stdout: '', stderr: undefined },
    { stdout: null, stderr: null },
    { stdout: 1, stderr: 2 },
    undefined,
  ])
    assert.throws(() => gradleRunLog(result), /^Error: gradle_run_produced_no_output:/)
  assert.throws(() => gradleRunLog({ error }), /gradle_run_produced_no_output:ENOENT/)
  assert.equal(gradleRunLog({ stdout: 'out\n', stderr: 'err\n' }), 'out\nerr\n')
  assert.equal(gradleRunLog({ stdout: '', stderr: '' }), '')
})

test('the worklets staging suite checks the wrapper before any build and reads logs through the helper', () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL('./story68-worklets-staging.test.mjs', import.meta.url)),
    'utf8'
  )
  const run = source.slice(source.indexOf('function run(input'))
  assert.ok(run.indexOf('requireGradleWrapper(wrapper)') > 0)
  assert.ok(run.indexOf('requireGradleWrapper(wrapper)') < run.indexOf('spawnSync('))
  assert.match(run, /log: gradleRunLog\(result\)/)
  assert.doesNotMatch(source, /result\.stdout \+ result\.stderr/)
})
