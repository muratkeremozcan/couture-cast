// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6: the one iOS job on main, nightly and dispatch keeps every guard the five macOS
// jobs it replaced had. Each control below breaks one rule and must be rejected.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  IOS_NATIVE_JOB,
  IOS_NATIVE_WORKFLOW,
  RUNTIME_SCRIPT,
  iosNativeProblems,
} from './ios-native-workflow.mjs'
import { runWithStubs, xctestSummary } from './workflow-step-stubs.mjs'
import { shardsOf } from './native-matrix-shards.mjs'

const source = parse(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
const runtimeScript = fs.readFileSync(RUNTIME_SCRIPT, 'utf8')
const fresh = () => JSON.parse(JSON.stringify(source))
const mutate = (change, script = runtimeScript) => {
  const workflow = fresh()
  change(workflow.jobs[IOS_NATIVE_JOB].steps, workflow)
  return iosNativeProblems(workflow, { runtimeScript: script })
}
/** A control that changes only the runtime script. */
const unchanged = (steps) => steps
const byId = (steps, id) => steps.find((step) => step.id === id)
const byRun = (steps, text) => steps.find((step) => step.run?.includes(text))
const rejected = (title, expected, change, script) =>
  test(`${title} is rejected`, () => {
    const problems = mutate(change, script)
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      problems.join('\n') || 'no problem raised'
    )
  })

describe('ios-native workflow validator', () => {
  test('the committed workflow passes', () => {
    assert.deepEqual(iosNativeProblems(source, { runtimeScript }), [])
  })

  rejected('a pull_request trigger', /stay off pull requests/, (_, workflow) => {
    workflow.on.pull_request = {}
  })
  rejected('an unfiltered merge trigger', /filtered by its native iOS inputs/, (_, w) => {
    delete w.on.push.paths
  })
  rejected('no nightly run', /nightly schedule/, (_, workflow) => {
    delete workflow.on.schedule
  })
  rejected('a dispatch without a ref', /optional ref/, (_, workflow) => {
    workflow.on.workflow_dispatch = null
  })
  rejected('a second job', /exactly one job/, (_, workflow) => {
    workflow.jobs.extra = { 'runs-on': 'macos-26', steps: [] }
  })
  rejected('the macos-15 runner', /macos-26 runner required/, (_, workflow) => {
    workflow.jobs[IOS_NATIVE_JOB]['runs-on'] = 'macos-15'
  })
  rejected('a limit past the hosted job limit', /hosted job limit/, (_, workflow) => {
    workflow.jobs[IOS_NATIVE_JOB]['timeout-minutes'] = 400
  })
  rejected('a hidden step failure', /failures must remain visible/, (steps) => {
    byId(steps, 'shard_2')['continue-on-error'] = true
  })
  rejected('a checkout of the default ref', /dispatched ref/, (steps) => {
    delete steps[0].with
  })
  rejected('the image default Xcode', /Xcode 26.4 or later/, (steps) => {
    byId(steps, 'xcode').run = 'xcodebuild -version'
  })
  rejected('Xcode 26.3 accepted', /Xcode 26.4 or later/, (steps) => {
    byId(steps, 'xcode').run = byId(steps, 'xcode').run.replace('-ge 4', '-ge 3')
  })
  rejected(
    'a build before the Xcode selection',
    /selected before anything builds/,
    (steps) => {
      const at = steps.findIndex((step) => step.id === 'xcode')
      const [xcode] = steps.splice(at, 1)
      steps.splice(steps.findIndex((step) => step.id === 'release_build') + 1, 0, xcode)
    }
  )
  rejected('a second prebuild', /prebuild the iOS project once/, (steps) => {
    steps.splice(
      steps.findIndex((step) => step.id === 'native_build'),
      0,
      { run: 'node scripts/run-story68-native.mjs prebuild --platform ios' }
    )
  })
  rejected('a Debug build for the focus check', /Release app build/, (steps) => {
    byId(steps, 'release_build').run = byId(steps, 'release_build').run.replace(
      ' --configuration Release',
      ''
    )
  })
  rejected('no accessibility-focus check', /Release app build/, (steps) => {
    steps.splice(
      steps.findIndex((step) => step.id === 'focus_check'),
      1
    )
  })
  rejected('a client keyed by something else', /keyed by scripts/, (steps) => {
    byId(steps, 'native_key').run =
      'echo "key=cc68-ios-${{ github.sha }}" >> "$GITHUB_OUTPUT"'
  })
  rejected('a build that ignores the cache', /build it only on a miss/, (steps) => {
    byId(steps, 'native_build').if =
      "${{ !cancelled() && steps.build_window.outcome == 'success' }}"
  })
  rejected('a lookup that restores nothing', /build it only on a miss/, (steps) => {
    byId(steps, 'native_cache').with['lookup-only'] = true
  })
  rejected('saving the client before the scan', /secret-scanned before/, (steps) => {
    const at = steps.findIndex(
      (step) =>
        step.uses === 'actions/cache/save@v4' && step.with?.key?.includes('native_key')
    )
    const [save] = steps.splice(at, 1)
    steps.splice(
      steps.findIndex((step) => step.id === 'app_scan'),
      0,
      save
    )
  })
  rejected('a scan without the harness directory', /secret-scanned before/, (steps) => {
    byId(steps, 'app_scan').run = byId(steps, 'app_scan').run.replace(
      ' "$CC68_HARNESS_DIR"',
      ''
    )
  })
  rejected('installing an unscanned client', /only a restored client/, (steps) => {
    byId(steps, 'client').if =
      "${{ !cancelled() && (steps.native_cache.outputs.cache-hit == 'true' || steps.native_build.outcome == 'success') }}"
  })
  rejected('uploading the client', /only closed evidence is uploaded/, (steps) => {
    steps.push({
      if: 'always()',
      uses: 'actions/upload-artifact@v4',
      with: { name: 'cc68-ios-app', path: '/tmp/cc68-ios-build' },
    })
  })
  for (const shard of shardsOf('ios')) {
    rejected(
      `shard ${shard} removed`,
      new RegExp(`shard ${shard}: every command`),
      (steps) => {
        steps.splice(
          steps.findIndex((step) => step.id === `shard_${shard}`),
          1
        )
      }
    )
    rejected(
      `shard ${shard} without its shard`,
      new RegExp(`shard ${shard}: every command`),
      (steps) => {
        byId(steps, `shard_${shard}`).run = byId(steps, `shard_${shard}`).run.replace(
          ' --shard "$shard"',
          ''
        )
      }
    )
    rejected(
      `shard ${shard} on a shorter budget`,
      new RegExp(`shard ${shard}: the flows keep`),
      (steps) => {
        byId(steps, `shard_${shard}`)['timeout-minutes'] = 45
      }
    )
    rejected(
      `shard ${shard} sharing the previous runtime`,
      new RegExp(`shard ${shard}: start its own runtime`),
      (steps) => {
        steps.splice(
          steps.findIndex((step) => step.id === `shard_${shard}_runtime`),
          1
        )
      }
    )
    rejected(
      `shard ${shard} evidence that may be missing`,
      new RegExp(`shard ${shard}: evidence upload must fail closed`),
      (steps) => {
        steps.find((step) => step.with?.name === `share-card-ios-shard-${shard}`).with[
          'if-no-files-found'
        ] = 'warn'
      }
    )
    rejected(
      `shard ${shard} cleanup skipped after a failure`,
      new RegExp(`shard ${shard}: owned cleanup must always run`),
      (steps) => {
        byRun(steps, `native-ios-runtime.sh stop shard-${shard}`).if =
          '${{ steps.shard_' + shard + ".outcome == 'success' }}"
      }
    )
  }
  rejected(
    'a shard running the Expo Go proof',
    /must not run the Expo Go proof/,
    (steps) => {
      byId(steps, 'shard_3').run +=
        '\nnode scripts/run-story68-native.mjs expo-go-proof --platform ios\n'
    }
  )
  rejected('a merge that accepts a skipped shard', /every shard must run/, (steps) => {
    const merge = byRun(steps, 'native-ios-shards.mjs merge')
    merge.env.CC68_SHARD_OUTCOMES = '${{ steps.shard_1.outcome }}'
  })
  rejected('a merge that ignores shard outcomes', /every shard must run/, (steps) => {
    const merge = byRun(steps, 'native-ios-shards.mjs merge')
    merge.run = 'node scripts/ci/native-ios-shards.mjs merge "$RUNNER_TEMP/ios-shards"'
  })
  rejected('an Expo Go proof with a shard', /without a shard/, (steps) => {
    byId(steps, 'expo_go').run = byId(steps, 'expo_go').run.replace(
      '--device "$device"',
      '--device "$device" --shard 2/4'
    )
  })
  rejected('an Expo Go job without the PNG guards', /PNG guards/, (steps) => {
    steps.splice(
      steps.findIndex((step) => step.id === 'png_file_guards'),
      1
    )
  })
  rejected('a Supabase stack left running', /always stops last/, (steps) => {
    steps.pop()
  })
  rejected(
    'a Metro start without its platform in the runtime script',
    /pass --platform ios/,
    unchanged,
    runtimeScript.replace(
      'node scripts/run-story68-native.mjs metro --platform ios >',
      'node scripts/run-story68-native.mjs metro >'
    )
  )
  rejected(
    'a runtime script that never cleans up',
    /provisions, cleans up and deletes/,
    unchanged,
    runtimeScript.replace('node scripts/e2e-share-card/cleanup.mjs', 'true')
  )
})

describe('ios-native photo-save guard', () => {
  const guard = byId(source.jobs[IOS_NATIVE_JOB].steps, 'png_file_guards')

  test('passes on any nonzero count and fails on zero tests, a skip or a failure', () => {
    // A literal count breaks the lane whenever the suite grows.
    assert.doesNotMatch(guard.run, /Executed \d+ tests/)
    for (const count of [1, 4, 5, 21])
      assert.equal(
        runWithStubs(guard, { swift: xctestSummary(count) }),
        0,
        `${count} tests`
      )
    const skipped =
      'echo "\t Executed 5 tests, with 1 test skipped and 0 failures (0 unexpected) in 0.1 (0.1) seconds"'
    for (const body of [xctestSummary(0), 'echo "no summary"', 'exit 0', skipped])
      assert.notEqual(runWithStubs(guard, { swift: body }), 0, body)
    assert.notEqual(runWithStubs(guard, { swift: xctestSummary(5, 1) }), 0, 'failure')
    // A failure summary from a tool that still exits zero.
    assert.notEqual(
      runWithStubs(guard, { swift: xctestSummary(5, 1).replace(/exit \d+$/, 'exit 0') }),
      0,
      'failure with exit 0'
    )
  })
})

describe('the Xcode selection', () => {
  const step = byId(source.jobs[IOS_NATIVE_JOB].steps, 'xcode')
  // Runs the step over fake Xcode bundles with stub sudo, xcodebuild and xcrun; returns its
  // status and what it wrote to GITHUB_ENV.
  const select = (installed) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-select-'))
    try {
      for (const name of installed) fs.mkdirSync(path.join(root, name))
      const env = path.join(root, 'github-env')
      fs.writeFileSync(env, '')
      const status = runWithStubs(
        step,
        { sudo: 'exit 0', xcodebuild: 'echo Xcode', xcrun: 'echo 26.4' },
        { env: { XCODE_ROOT: root, GITHUB_ENV: env } }
      )
      return { status, env: fs.readFileSync(env, 'utf8').replaceAll(root, '') }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }

  test('selects the newest Xcode 26.x at 26.4 or later and refuses older ones', () => {
    const picked = select([
      'Xcode_16.4.app',
      'Xcode_26.3.app',
      'Xcode_26.4.app',
      'Xcode_26.10.app',
      'Xcode_26.4.1.app',
      'Xcode_27.0.app',
    ])
    assert.equal(picked.status, 0)
    assert.equal(picked.env.trim(), 'DEVELOPER_DIR=/Xcode_26.10.app/Contents/Developer')
    assert.equal(
      select(['Xcode_26.4.app', 'Xcode_26.4.1.app']).env.trim(),
      'DEVELOPER_DIR=/Xcode_26.4.1.app/Contents/Developer'
    )
    assert.notEqual(select(['Xcode_16.4.app', 'Xcode_26.3.app']).status, 0)
    assert.notEqual(select(['Xcode_27.0.app']).status, 0)
    assert.notEqual(select([]).status, 0)
  })
})
