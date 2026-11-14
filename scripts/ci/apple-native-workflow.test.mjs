// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6, with the owner rule of 2026-11-13: no macOS job runs on a pull request or a
// merge (pr-job-ceilings.test.mjs fails any). pr-apple-native.yml runs the Foundation-only Swift
// rules and the iOS flow syntax on Linux, each on its own lane, and every Swift test step fails
// when nothing ran. The watchOS suite runs only on macOS, nightly in watchos-native.yml, with
// WATCHOS_REQUIRE_BUILD=1, so its native builds can never be skipped in silence.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { runWithStubs, xctestSummary } from './workflow-step-stubs.mjs'

const workflowsDir = '.github/workflows'
const workflows = Object.fromEntries(
  fs
    .readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => [file, parse(fs.readFileSync(path.join(workflowsDir, file), 'utf8'))])
)
const lane = (id) => `fromJSON(needs.lanes.outputs.plan)['${id}']`
const linux = workflows['pr-apple-native.yml'].jobs['swift-linux']

describe('the Linux Swift rules job', () => {
  test('pr-apple-native.yml runs only Linux jobs', () => {
    for (const [id, candidate] of Object.entries(workflows['pr-apple-native.yml'].jobs))
      assert.equal(candidate['runs-on'], 'ubuntu-latest', id)
  })

  test('runs every rules package on its lane, one CPU per test run', () => {
    assert.equal(linux.if, lane('ios-unit'))
    assert.deepEqual([linux.needs].flat(), ['lanes'])
    assert.match(linux.container, /^swift:\d+\.\d+\.\d+-noble$/)
    assert.ok(linux['timeout-minutes'] > 0 && linux['timeout-minutes'] <= 20)
    assert.equal(linux['continue-on-error'], undefined)
    assert.ok(linux.steps.every((step) => step['continue-on-error'] === undefined))
    assert.deepEqual(
      linux.steps
        .filter((step) => /swift test/.test(step.run ?? ''))
        .map((step) => [
          step['working-directory'],
          step.run.includes('taskset -c 0 swift test --skip-build 2>&1'),
        ]),
      [
        ['apps/mobile/modules/share-card-native-share/ios', true],
        ['apps/mobile/modules/share-card-photo-save/ios', true],
        ['apps/mobile/modules/accessibility-focus/ios', true],
      ]
    )
  })

  test('each test step passes with tests and fails on zero tests, all skipped or a failure', () => {
    const steps = linux.steps.filter((row) => /swift test/.test(row.run ?? ''))
    assert.equal(steps.length, 3)
    // taskset -c 0 COMMAND: run the command on the stub PATH.
    const stubs = (body) => ({ swift: body, taskset: 'shift 2; exec "$@"' })
    for (const step of steps) {
      for (const count of [1, 21])
        assert.equal(
          runWithStubs(step, stubs(xctestSummary(count))),
          0,
          `${step.name}: ${count}`
        )
      assert.equal(
        runWithStubs(step, stubs(xctestSummary(21, 0, 20))),
        0,
        `${step.name}: one ran`
      )
      for (const body of [
        xctestSummary(0),
        'echo "no summary"',
        'exit 0',
        xctestSummary(21, 0, 21),
        xctestSummary(1, 0, 1),
      ])
        assert.notEqual(runWithStubs(step, stubs(body)), 0, `${step.name}: ${body}`)
      assert.notEqual(
        runWithStubs(step, stubs(xctestSummary(21, 1))),
        0,
        `${step.name}: failure`
      )
    }
  })
})

/** Every job that runs the watchOS suite, and the ones that run it off macOS or without the flag. */
function watchSuiteJobs(all) {
  const runs = []
  const wrong = []
  for (const [file, workflow] of Object.entries(all))
    for (const [id, candidate] of Object.entries(workflow.jobs ?? {}))
      for (const step of candidate.steps ?? [])
        if (/test:watchos-prebuild|with-watchos\.test\.js/.test(step.run ?? '')) {
          runs.push(`${file}:${id}`)
          const flag =
            step.env?.WATCHOS_REQUIRE_BUILD ?? candidate.env?.WATCHOS_REQUIRE_BUILD
          if (!/macos/.test(JSON.stringify(candidate['runs-on'] ?? '')) || flag !== '1')
            wrong.push(`${file}:${id}`)
        }
  return { runs, wrong }
}

describe('the watchOS prebuild suite', () => {
  test('runs only on macOS, nightly, and always with WATCHOS_REQUIRE_BUILD=1', () => {
    assert.deepEqual(watchSuiteJobs(workflows), {
      runs: ['watchos-native.yml:watchos-native'],
      wrong: [],
    })
    const on = workflows['watchos-native.yml'].on ?? workflows['watchos-native.yml'][true]
    assert.deepEqual(Object.keys(on).sort(), ['schedule', 'workflow_dispatch'])
  })

  test('an ubuntu job or a job without the flag is caught', () => {
    const run = 'npm run test:watchos-prebuild --workspace mobile'
    const fixture = {
      'watchos-native.yml': {
        jobs: { 'watchos-native': { 'runs-on': 'ubuntu-latest', steps: [{ run }] } },
      },
      'unflagged.yml': { jobs: { mac: { 'runs-on': 'macos-26', steps: [{ run }] } } },
      'linux-flagged.yml': {
        jobs: {
          linux: {
            'runs-on': 'ubuntu-latest',
            steps: [{ run, env: { WATCHOS_REQUIRE_BUILD: '1' } }],
          },
        },
      },
      'flagged.yml': {
        jobs: {
          mac: {
            'runs-on': 'macos-26',
            env: { WATCHOS_REQUIRE_BUILD: '1' },
            steps: [{ run }],
          },
        },
      },
    }
    assert.deepEqual(watchSuiteJobs(fixture).wrong, [
      'watchos-native.yml:watchos-native',
      'unflagged.yml:mac',
      'linux-flagged.yml:linux',
    ])
  })
})

// Story 6.15 C-07: the Linux Swift targets import no Apple-only framework, so a new import is
// caught here, by name, before the Linux build fails on it. Each package's Linux sources come
// from the `#if os(Linux)` branch of its Package.swift.
const APPLE_ONLY = [
  'UIKit',
  'AppKit',
  'Photos',
  'PhotosUI',
  'SwiftUI',
  'AVFoundation',
  'UniformTypeIdentifiers',
  'LinkPresentation',
  'ExpoModulesCore',
  'CryptoKit',
  'CoreGraphics',
]
const MODULES = 'apps/mobile/modules'

/** The string literals of `let <name> = [...]` in a manifest fragment. */
const listNamed = (text, name) => {
  const match = new RegExp(`let ${name}(?::[^=]+)? = \\[([^\\]]*)\\]`).exec(text)
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : null
}

/** The Swift files each package compiles on Linux, and whether it builds the CoreGraphics shim. */
function linuxSources(packageDir) {
  const manifest = fs.readFileSync(path.join(packageDir, 'Package.swift'), 'utf8')
  const linux = /#if os\(Linux\)\n([\s\S]*?)\n#else/.exec(manifest)?.[1] ?? ''
  const swiftIn = (dir) =>
    fs
      .readdirSync(path.join(packageDir, dir), { recursive: true })
      .filter((file) => file.endsWith('.swift'))
      .map((file) => path.join(dir, file))
  let sources
  let tests
  if (packageDir.endsWith('share-card-native-share/ios')) {
    sources = listNamed(manifest, 'coreSources')
    const appleOnly = listNamed(linux, 'appleOnlyTests')
    tests = swiftIn('Tests').filter((file) => !appleOnly.includes(path.basename(file)))
  } else if (packageDir.endsWith('share-card-photo-save/ios')) {
    sources = [...manifest.matchAll(/(?<![a-z])sources: \[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((s) => s[1])
    )
    tests = swiftIn('Tests')
  } else {
    sources = listNamed(linux, 'targetSources')
    tests = swiftIn('Tests/AccessibilityFocusRulesTests')
  }
  const shim = /\.target\(name: "CoreGraphics", path: "LinuxShims\/CoreGraphics"\)/.test(
    linux
  )
  return {
    files: [...sources, ...tests, ...(shim ? swiftIn('LinuxShims') : [])],
    shim,
  }
}

/** Apple-only imports outside a `#if canImport(<same module>)` block. */
function appleOnlyImports(source, { shim }) {
  const found = []
  const guards = []
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    const condition = /^#if (.*)$/.exec(trimmed)
    if (condition) guards.push(condition[1])
    else if (trimmed.startsWith('#else')) guards.push(`!${guards.pop()}`)
    else if (trimmed.startsWith('#endif')) guards.pop()
    const imported = /^(?:@testable |@_exported )?import (\w+)/.exec(trimmed)?.[1]
    if (!imported || !APPLE_ONLY.includes(imported)) continue
    if (guards.includes(`canImport(${imported})`)) continue
    if (imported === 'CoreGraphics' && shim) continue
    found.push(imported)
  }
  return found
}

describe('the Linux Swift targets', () => {
  const packages = [
    'share-card-native-share',
    'share-card-photo-save',
    'accessibility-focus',
  ].map((name) => path.join(MODULES, name, 'ios'))

  test('import no Apple-only framework outside its canImport guard', () => {
    const banned = []
    let files = 0
    for (const dir of packages) {
      const { files: sources, shim } = linuxSources(dir)
      assert.ok(sources.length >= 2, dir)
      for (const file of sources) {
        files++
        const text = fs.readFileSync(path.join(dir, file), 'utf8')
        for (const name of appleOnlyImports(text, { shim }))
          banned.push(`${dir}/${file}: ${name}`)
      }
    }
    assert.deepEqual(banned, [])
    assert.ok(files >= 12, `${files} Linux sources read`)
  })

  test('the Linux source lists leave out the Apple glue', () => {
    const share = linuxSources(packages[0]).files
    assert.ok(!share.includes('ShareCardShareLinkMetadata.swift'))
    assert.ok(!share.includes('Tests/ShareCardShareMetadataTests.swift'))
    assert.ok(share.includes('ShareCardShareFile.swift'))
    const focus = linuxSources(packages[2]).files
    assert.deepEqual(
      focus.filter((file) => !file.startsWith('Tests/')),
      ['AccessibilityFocusRules.swift']
    )
  })

  test('the rule catches an unguarded or wrongly guarded Apple import', () => {
    assert.deepEqual(
      appleOnlyImports('import Foundation\nimport UIKit\n', { shim: false }),
      ['UIKit']
    )
    assert.deepEqual(appleOnlyImports('import CryptoKit\n', { shim: false }), [
      'CryptoKit',
    ])
    assert.deepEqual(
      appleOnlyImports(
        '#if canImport(CryptoKit)\nimport CryptoKit\n#else\nimport Crypto\n#endif\n',
        {
          shim: false,
        }
      ),
      []
    )
    // Guarded by another module's availability: still an Apple import on Linux.
    assert.deepEqual(
      appleOnlyImports('#if canImport(Darwin)\nimport Photos\n#endif\n', { shim: false }),
      ['Photos']
    )
    // The else branch of its own guard is the Linux side.
    assert.deepEqual(
      appleOnlyImports('#if canImport(UIKit)\n#else\nimport UIKit\n#endif\n', {
        shim: false,
      }),
      ['UIKit']
    )
    assert.deepEqual(
      appleOnlyImports('@testable import LinkPresentation\n', { shim: false }),
      ['LinkPresentation']
    )
    assert.deepEqual(appleOnlyImports('import CoreGraphics\n', { shim: false }), [
      'CoreGraphics',
    ])
    assert.deepEqual(appleOnlyImports('import CoreGraphics\n', { shim: true }), [])
  })
})

// Story 6.15 C-12: the watchOS prebuild test must assert its native builds ran; without that call
// a deleted build block passes in silence even with WATCHOS_REQUIRE_BUILD=1.
const WATCH_TEST = 'apps/mobile/plugins/with-watchos.test.js'

/** The problems in the watchOS prebuild test's body: what it must call for the flag to bite. */
function watchBuildProblems(source) {
  const start = source.indexOf(
    "'clean Expo prebuild generates watchOS app and complication targets'"
  )
  const end = source.indexOf('\ntest(', start + 1)
  const body = start < 0 ? '' : source.slice(start, end < 0 ? undefined : end)
  const problems = []
  if (!body) problems.push('prebuild test missing')
  if (!/\n\s+assertNativeBuildsRan\(builds\)\n/.test(body))
    problems.push('assertNativeBuildsRan(builds) not called')
  for (const target of ['WatchWidget', 'WatchApp'])
    if (!body.includes(`buildWatchTarget(t, fixtureRoot, '${target}'`))
      problems.push(`${target} build missing`)
  if (!/if \(nativeBuildsRun\(\)\) \{/.test(body))
    problems.push('nativeBuildsRun() gate missing')
  return problems
}

describe('the watchOS suite under WATCHOS_REQUIRE_BUILD', () => {
  const source = fs.readFileSync(WATCH_TEST, 'utf8')

  test('builds both watch targets and asserts that they ran', () => {
    assert.deepEqual(watchBuildProblems(source), [])
    // The Swift behavior tests use the same gate.
    assert.match(
      source,
      /if \(!nativeBuildsRun\(\)\) \{\n\s+t\.skip\('Swift behavior tests require macOS'\)/
    )
  })

  test('deleting the build block and its assertion is caught', () => {
    const withoutAssertion = source.replace(
      /\n\s+assertNativeBuildsRan\(builds\)\n/,
      '\n'
    )
    assert.ok(
      watchBuildProblems(withoutAssertion).includes(
        'assertNativeBuildsRan(builds) not called'
      )
    )
    const start = source.indexOf('    const builds = []')
    const end = source.indexOf('    assertNativeBuildsRan(builds)\n')
    const withoutBlock =
      source.slice(0, start) +
      source.slice(end + '    assertNativeBuildsRan(builds)\n'.length)
    assert.ok(
      watchBuildProblems(withoutBlock).length >= 3,
      watchBuildProblems(withoutBlock).join(', ')
    )
  })
})

// TEA SL-04: the checks that fit a pull request run on Linux there, beside ios-native-jobs.yml.
describe('the iOS checks shifted onto Linux pull request jobs', () => {
  const jobs = workflows['pr-apple-native.yml'].jobs

  test('swift-linux runs the header semantics controls', () => {
    const step = jobs['swift-linux'].steps.find(
      (row) => row.run === 'bash scripts/ci/share-card-header-semantics.sh'
    )
    assert.ok(step)
    assert.ok(step['timeout-minutes'] <= 10)
    // On Linux the controls compile against the share module's CoreGraphics shim.
    const script = fs.readFileSync('scripts/ci/share-card-header-semantics.sh', 'utf8')
    assert.match(script, /LinuxShims\/CoreGraphics\/CoreGraphics\.swift/)
  })

  test('ios-flow-syntax checks the iOS flows with the pinned CLI on its own lane', () => {
    const job = jobs['ios-flow-syntax']
    assert.equal(job.if, lane('ios-flow-syntax'))
    assert.equal(job['runs-on'], 'ubuntu-latest')
    assert.ok(job['timeout-minutes'] <= 20)
    const runs = job.steps.map((row) => row.run ?? '')
    const install = runs.indexOf('node scripts/maestro-install.mjs')
    const check = runs.indexOf('node scripts/ci/maestro-check-flows.mjs')
    assert.ok(install >= 0 && check > install)
    assert.ok(!runs.some((run) => /npm (ci|install)/.test(run)), 'no dependency install')
    // That holds only while both scripts import Node built-ins and repository files.
    for (const file of [
      'scripts/maestro-install.mjs',
      'scripts/ci/maestro-check-flows.mjs',
    ]) {
      const imports = [
        ...fs.readFileSync(file, 'utf8').matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm),
      ].map((m) => m[1])
      for (const specifier of imports)
        assert.match(specifier, /^(node:|\.)/, `${file}: ${specifier}`)
    }
  })
})
