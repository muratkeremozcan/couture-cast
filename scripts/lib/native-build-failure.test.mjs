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

  // Nightly run 44298434117, iOS live font scale (settings): the Release build exited 65 after
  // 358 s and the record read classification unknown with no failed task, because only Gradle's
  // `> Task ... FAILED` lines were read. xcodebuild lists its failed commands after a header.
  test('names the failed xcodebuild commands by target and classifies the xcodebuild causes', () => {
    const ios = { ...base, platform: 'ios', configuration: 'Release', status: 65 }
    const log = [
      `CompileC /tmp/${personal}.o (in target 'CoutureCastStory68' from project 'CoutureCastStory68')`,
      'error: Command PhaseScriptExecution failed with a nonzero exit code',
      '** BUILD FAILED **',
      '',
      'The following build commands failed:',
      `\tPhaseScriptExecution [CP-User]\\ [Hermes]\\ Replace\\ Hermes /tmp/${personal}.sh (in target 'hermes-engine' from project 'Pods')`,
      "\tPhaseScriptExecution Bundle\\ React\\ Native\\ code\\ and\\ images /tmp/Script-1.sh (in target 'CoutureCastStory68' from project 'CoutureCastStory68')",
      `\tSwiftCompile normal arm64 /tmp/a.swift (in target '${personal}' from project 'Pods')`,
      "\tPhaseScriptExecution Bundle\\ React\\ Native\\ code\\ and\\ images /tmp/Script-1.sh (in target 'CoutureCastStory68' from project 'CoutureCastStory68')",
      '(4 failures)',
      "\tLd /tmp/x (in target 'after-the-list' from project 'Pods')",
    ].join('\n')
    const record = summarizeNativeBuildFailure({ ...ios, log })
    assert.deepEqual(record, {
      platform: 'ios',
      configuration: 'Release',
      durationMs: 529000,
      exitCode: 65,
      signal: null,
      classification: 'scriptphase',
      failedTasks: [
        'PhaseScriptExecution@hermes-engine',
        'PhaseScriptExecution@CoutureCastStory68',
      ],
    })
    assert.equal(JSON.stringify(record).includes('Avery'), false)
    assertNativeBuildFailure(record)
    const classify = (text) =>
      summarizeNativeBuildFailure({ ...ios, log: text }).classification
    assert.equal(
      classify('/tmp/App/AppDelegate.swift:12:5: error: cannot find type'),
      'swift'
    )
    assert.equal(
      classify('xcodebuild: error: Unable to find a destination matching'),
      'xcodebuild'
    )
    // Without the header nothing is read as a failed command.
    assert.deepEqual(
      summarizeNativeBuildFailure({
        ...ios,
        log: "\tLd /tmp/x (in target 'Pods-App' from project 'Pods')",
      }).failedTasks,
      []
    )
    for (const task of ['Ld@', '@Pods', 'ld@Pods', 'Ld@a b', `Ld@${'a'.repeat(61)}`])
      assert.throws(() => assertNativeBuildFailure({ ...record, failedTasks: [task] }), {
        message: 'invalid_native_build_failure',
      })
  })

  // Codex review of cb8b22d2: xcodebuild escapes the spaces in multi-word command names
  // (`SwiftDriver\ Compilation`), and the first parser stopped the list at that entry, so a Swift
  // build failure kept its empty record and lost every supported command after it.
  test('reads escaped xcodebuild command names and keeps reading the list to its footer', () => {
    const ios = { ...base, platform: 'ios', configuration: 'Release', status: 65 }
    const log = [
      '** BUILD FAILED **',
      '',
      'The following build commands failed:',
      "\tSwiftDriver\\ Compilation normal arm64 com.apple.xcode.tools.swift.compiler (in target 'ExpoModulesCore' from project 'Pods')",
      `\tBuilding workspace ${personal} with scheme CoutureCastStory68`,
      "\tSwiftDriver\\ Compilation\\ Requirements normal arm64 com.apple.xcode.tools.swift.compiler (in target 'CoutureCastStory68' from project 'CoutureCastStory68')",
      "\tPhaseScriptExecution [CP-User]\\ [Hermes]\\ Replace\\ Hermes /tmp/a.sh (in target 'hermes-engine' from project 'Pods')",
      '(4 failures)',
      "\tLd /tmp/x (in target 'after-the-list' from project 'Pods')",
    ].join('\n')
    const record = summarizeNativeBuildFailure({ ...ios, log })
    assert.deepEqual(record.failedTasks, [
      'SwiftDriverCompilation@ExpoModulesCore',
      'SwiftDriverCompilationRequirements@CoutureCastStory68',
      'PhaseScriptExecution@hermes-engine',
    ])
    assert.equal(JSON.stringify(record).includes('Avery'), false)
    assertNativeBuildFailure(record)
    // A list with no footer ends at the first line that is not an indented entry.
    assert.deepEqual(
      summarizeNativeBuildFailure({
        ...ios,
        log: [
          'The following build commands failed:',
          "\tSwiftDriver\\ Compilation normal arm64 x (in target 'A' from project 'Pods')",
          "Ld /tmp/x (in target 'not-listed' from project 'Pods')",
          "\tLd /tmp/y (in target 'not-listed-either' from project 'Pods')",
        ].join('\n'),
      }).failedTasks,
      ['SwiftDriverCompilation@A']
    )
    // A joined name past the 41-character identifier bound is dropped, never truncated.
    assert.deepEqual(
      summarizeNativeBuildFailure({
        ...ios,
        log: [
          'The following build commands failed:',
          `\tSwiftDriver\\ ${'Compilation\\ '.repeat(4)}Requirements x (in target 'A' from project 'Pods')`,
          "\tLd /tmp/x (in target 'B' from project 'Pods')",
          '(2 failures)',
        ].join('\n'),
      }).failedTasks,
      ['Ld@B']
    )
  })

  // Codex review of cb8b22d2: CocoaPods generates Swift sources under `Target Support Files`, so a
  // compiler error at one of them carries a path with spaces, and `^\S+\.swift` left it unknown.
  test('classifies a Swift error at a path with spaces', () => {
    const ios = { ...base, platform: 'ios', configuration: 'Release', status: 65 }
    const classify = (text) =>
      summarizeNativeBuildFailure({ ...ios, log: text }).classification
    assert.equal(
      classify(
        '/Users/runner/work/couture-cast/couture-cast/apps/mobile/ios/Pods/Target Support Files/Pods-CoutureCastStory68/ExpoModulesProvider.swift:12:5: error: cannot find type'
      ),
      'swift'
    )
    // The error suffix stays required: a warning at the same path is not a Swift error.
    assert.equal(
      classify(
        '/tmp/Target Support Files/Pods-CoutureCastStory68/ExpoModulesProvider.swift:12:5: warning: unused'
      ),
      'unknown'
    )
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
