// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  assertNativeBuildFailure,
  summarizeNativeBuildFailure,
} from './native-build-failure.mjs'

// Dispatch 43693424172 android36-controls: native_build_failed after 529 s, and the Gradle output
// stayed in the private build log, so nothing public named the cause. The build failure now
// publishes a closed record read from that log in memory: failed task paths and fixed
// signatures, never its text.
const personal = 'Avery Example avery@example.test sk_live_secret'
const base = {
  platform: 'android',
  configuration: 'Debug',
  durationMs: 529000,
  status: 1,
  signal: null,
}

describe('native build failure record', () => {
  test('names the failed tasks and the signature, and carries no log text', () => {
    const log = [
      `> Task :app:mergeDebugResources ${personal}`,
      '> Task :react-native-reanimated:compileDebugKotlin FAILED',
      '> Task :app:compileDebugJavaWithJavac FAILED',
      'FAILURE: Build failed with an exception.',
      '* What went wrong:',
      "Execution failed for task ':react-native-reanimated:compileDebugKotlin'.",
      `> A failure occurred while executing ${personal}`,
      '   > java.lang.OutOfMemoryError: Java heap space',
    ].join('\n')
    const record = summarizeNativeBuildFailure({ ...base, log })
    assert.deepEqual(record, {
      platform: 'android',
      configuration: 'Debug',
      durationMs: 529000,
      exitCode: 1,
      signal: null,
      classification: 'outofmemory',
      failedTasks: [
        ':react-native-reanimated:compileDebugKotlin',
        ':app:compileDebugJavaWithJavac',
      ],
    })
    assert.equal(JSON.stringify(record).includes('Avery'), false)
    assertNativeBuildFailure(record)
  })

  test('classifies each fixed signature, a killed build and an unknown log', () => {
    const classify = (log, extra = {}) =>
      summarizeNativeBuildFailure({ ...base, ...extra, log }).classification
    assert.equal(classify('Gradle build daemon disappeared unexpectedly'), 'daemondied')
    assert.equal(classify('java.io.IOException: No space left on device'), 'diskfull')
    assert.equal(
      classify(
        "Could not resolve all files for configuration ':app:debugRuntimeClasspath'."
      ),
      'dependencies'
    )
    assert.equal(classify('e: file:///x/Foo.kt:3:1 Unresolved reference: bar'), 'kotlin')
    assert.equal(
      classify('Compilation failed; see the compiler error output for details.'),
      'java'
    )
    assert.equal(classify('ninja: build stopped: subcommand failed.'), 'native')
    assert.equal(classify('CMake Error at CMakeLists.txt:12'), 'native')
    assert.equal(classify('', { status: null, signal: 'SIGKILL' }), 'killed')
    assert.equal(classify('', { status: 137 }), 'killed')
    assert.equal(classify(personal), 'unknown')
    assert.equal(classify(undefined), 'unknown')
  })

  test('keeps at most ten task paths and only path-shaped ones', () => {
    const log = [
      ...Array.from({ length: 12 }, (_, index) => `> Task :lib${index}:build FAILED`),
      `> Task :app:${personal} FAILED`,
    ].join('\n')
    const { failedTasks } = summarizeNativeBuildFailure({ ...base, log })
    assert.equal(failedTasks.length, 10)
    assert.equal(failedTasks.join('').includes('Avery'), false)
  })

  // CodeRabbit on PR 232: native tasks carry their ABI in brackets.
  test('keeps an ABI-qualified native task, bounded', () => {
    const log = [
      '> Task :app:buildCMakeDebug[arm64-v8a] FAILED',
      '> Task :app:buildCMakeDebug[x86_64] FAILED',
      `> Task :app:buildCMakeDebug[${personal}] FAILED`,
      `> Task :app:buildCMakeDebug[${'a'.repeat(41)}] FAILED`,
    ].join('\n')
    const record = summarizeNativeBuildFailure({ ...base, log })
    assert.deepEqual(record.failedTasks, [
      ':app:buildCMakeDebug[arm64-v8a]',
      ':app:buildCMakeDebug[x86_64]',
    ])
    assertNativeBuildFailure(record)
    for (const task of [
      ':app:a[]',
      ':app:a[x][y]',
      ':app[x]:a',
      `:app:a[${'a'.repeat(41)}]`,
    ])
      assert.throws(() => assertNativeBuildFailure({ ...record, failedTasks: [task] }), {
        message: 'invalid_native_build_failure',
      })
  })

  test('the schema refuses any open field', () => {
    const record = summarizeNativeBuildFailure({ ...base, log: '' })
    assertNativeBuildFailure(record)
    for (const patch of [
      { log: personal },
      { classification: personal },
      { failedTasks: [personal] },
      { failedTasks: [':a b'] },
      { signal: personal },
      { configuration: 'Profile' },
      { platform: 'web' },
      { durationMs: -1 },
      { exitCode: '1' },
    ])
      assert.throws(() => assertNativeBuildFailure({ ...record, ...patch }), {
        message: 'invalid_native_build_failure',
      })
  })
})
