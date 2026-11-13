// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6: a pull request runs at most one macOS job, pr-apple-native.yml's apple-native,
// and only when the ios-unit or watchos lane is selected; each of its steps runs only for its own
// lane, every test step fails when nothing ran, and the watchOS suite runs only on macOS with
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
const triggers = (workflow) => {
  const on = workflow.on ?? workflow[true]
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on
  return Object.keys(on ?? {})
}
const job = workflows['pr-apple-native.yml'].jobs['apple-native']
const lane = (id) => `fromJSON(needs.lanes.outputs.plan)['${id}']`
const stepNamed = (name) => job.steps.find((step) => step.name === name)

describe('the one macOS pull request job', () => {
  test('no other job a pull request runs takes a macOS runner', () => {
    const mac = []
    for (const [file, workflow] of Object.entries(workflows)) {
      if (!triggers(workflow).includes('pull_request')) continue
      for (const [id, candidate] of Object.entries(workflow.jobs ?? {})) {
        const runner = JSON.stringify(candidate['runs-on'] ?? '')
        const skippedOnPullRequests = /github\.event_name != 'pull_request'/.test(
          String(candidate.if ?? '')
        )
        if (/macos/.test(runner) && !skippedOnPullRequests) mac.push(`${file}:${id}`)
      }
    }
    assert.deepEqual(mac, ['pr-apple-native.yml:apple-native'])
  })

  test('runs when either of its lanes does, on macos-15 within the 20-minute ceiling', () => {
    assert.equal(job.if, `${lane('ios-unit')} || ${lane('watchos')}`)
    assert.deepEqual([job.needs].flat(), ['lanes'])
    assert.equal(job['runs-on'], 'macos-15')
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20)
    assert.equal(job['continue-on-error'], undefined)
    assert.ok(job.steps.every((step) => step['continue-on-error'] === undefined))
  })

  test('each test step runs only for its own lane', () => {
    const unit = [
      'Share module LinkPresentation header tests',
      'XCTest for the focus target UIKit decisions',
    ]
    for (const name of unit) assert.match(stepNamed(name).if, /\['ios-unit'\]/, name)
    for (const name of unit)
      assert.doesNotMatch(stepNamed(name).if, /\['watchos'\]/, name)
    const watch = stepNamed('Validate watchOS prebuild')
    assert.match(watch.if, /\['watchos'\]/)
    assert.doesNotMatch(watch.if, /\['ios-unit'\]/)
  })

  // Story 6.15 D6: the Foundation-only rules run on Linux; macOS runs only the tests that need
  // Apple frameworks, so each Swift test runs in exactly one place.
  test('macOS runs only the Apple-framework tests and Linux runs every rules package', () => {
    const mac = job.steps.filter((step) =>
      /swift test|xcodebuild test/.test(step.run ?? '')
    )
    assert.deepEqual(
      mac.map((step) => [
        step['working-directory'],
        /--filter ShareCardShareMetadataTests|-only-testing:AccessibilityFocusTargetTests/.test(
          step.run
        ),
      ]),
      [
        ['apps/mobile/modules/share-card-native-share/ios', true],
        ['apps/mobile/modules/accessibility-focus/ios', true],
      ]
    )
    const linux = workflows['pr-apple-native.yml'].jobs['swift-linux']
    assert.equal(linux.if, lane('ios-unit'))
    assert.equal(linux['runs-on'], 'ubuntu-latest')
    assert.match(linux.container, /^swift:\d+\.\d+\.\d+-noble$/)
    assert.ok(linux['timeout-minutes'] <= 20)
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
    const steps = ['apple-native', 'swift-linux'].flatMap((id) =>
      workflows['pr-apple-native.yml'].jobs[id].steps.filter((row) =>
        /swift test|xcodebuild test/.test(row.run ?? '')
      )
    )
    assert.equal(steps.length, 5)
    for (const step of steps) {
      const tool = step.run.includes('xcodebuild test') ? 'xcodebuild' : 'swift'
      const stubs = (body) =>
        tool === 'xcodebuild'
          ? { xcodebuild: body, xcrun: 'echo "    iPhone 16 Pro (ID) (Shutdown)"' }
          : // taskset -c 0 COMMAND: run the command on the stub PATH.
            { swift: body, taskset: 'shift 2; exec "$@"' }
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
  test('runs only on macOS, and always with WATCHOS_REQUIRE_BUILD=1', () => {
    assert.deepEqual(watchSuiteJobs(workflows), {
      runs: ['pr-apple-native.yml:apple-native'],
      wrong: [],
    })
  })

  test('an ubuntu job or a job without the flag is caught', () => {
    const run = 'npm run test:watchos-prebuild --workspace mobile'
    const fixture = {
      'watchos-native.yml': {
        jobs: { 'watchos-native': { 'runs-on': 'ubuntu-latest', steps: [{ run }] } },
      },
      'unflagged.yml': { jobs: { mac: { 'runs-on': 'macos-15', steps: [{ run }] } } },
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
            'runs-on': 'macos-15',
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

  test('installs its dependencies only when its lane runs', () => {
    const install = stepNamed('Install dependencies')
    assert.match(install.if, /\['watchos'\]/)
    assert.match(
      stepNamed('Validate watchOS prebuild').if,
      /steps\.deps\.outcome == 'success'/
    )
  })
})
