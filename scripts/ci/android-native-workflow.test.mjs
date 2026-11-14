// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 (Antigravity r6 P3, TEA ruling): android-native.yml runs the release AAB ABI check,
// the minifiedDebuggable evidence and the network-timeout flow nightly and on a manual dispatch,
// never on a pull request or a merge. Each control below breaks one rule and must be rejected;
// the committed workflow and script must pass all of them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  CLIENT_BUILD,
  LIMITS,
  MINIFIED_EVIDENCE,
  NETWORK_JOB,
  NETWORK_SCRIPT,
  RELEASE_ABIS,
  RELEASE_ABI_LIST,
  RELEASE_BUILD,
  RELEASE_JOB,
  androidNativeProblems,
  readAndroidNative,
} from './android-native-workflow.mjs'
import { SHIPPED_ABIS } from './android-release-abis.mjs'
import { STAGED_ABIS } from '../lib/story68-worklets-staging.mjs'

const source = readAndroidNative()
const fresh = () => JSON.parse(JSON.stringify(source.workflow))
const onOf = (workflow) => workflow.on ?? workflow[true]
const step = (job, predicate) => job.steps.find(predicate)
const rejected = (title, expected, change) =>
  test(`${title} is rejected`, () => {
    const workflow = fresh()
    const script = change(workflow, source.script) ?? source.script
    const problems = androidNativeProblems(workflow, script)
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      problems.join('\n') || 'no problem raised'
    )
  })
const release = (workflow) => workflow.jobs[RELEASE_JOB]
const network = (workflow) => workflow.jobs[NETWORK_JOB]

describe('android-native.yml', () => {
  test('the committed workflow and script pass', () => {
    assert.deepEqual(androidNativeProblems(source.workflow, source.script), [])
  })

  test('runs nightly and on a manual dispatch only, on Linux, with fixed limits', () => {
    const { workflow } = source
    assert.deepEqual(Object.keys(onOf(workflow)).sort(), [
      'schedule',
      'workflow_dispatch',
    ])
    assert.deepEqual(Object.keys(workflow.jobs).sort(), [NETWORK_JOB, RELEASE_JOB])
    assert.deepEqual(LIMITS, { [RELEASE_JOB]: 120, [NETWORK_JOB]: 60 })
    for (const [name, limit] of Object.entries(LIMITS)) {
      assert.equal(workflow.jobs[name]['runs-on'], 'ubuntu-latest')
      assert.equal(workflow.jobs[name]['timeout-minutes'], limit)
    }
    assert.equal(
      step(release(workflow), (row) => row.id === 'android_build')['timeout-minutes'],
      100
    )
    assert.equal(
      step(network(workflow), (row) => row.id === 'client_build')['timeout-minutes'],
      35
    )
    assert.equal(
      step(network(workflow), (row) => row.id === 'network_timeout')['timeout-minutes'],
      25
    )
  })

  test('builds the AAB of every ABI and the minifiedDebuggable APK, then checks both', () => {
    const job = release(source.workflow)
    assert.equal(step(job, (row) => row.id === 'android_build').run, RELEASE_BUILD)
    assert.ok(
      step(job, (row) => row.id === 'minified_debuggable').run.includes(MINIFIED_EVIDENCE)
    )
    assert.ok(step(job, (row) => row.id === 'release_abis').run.includes(RELEASE_ABIS))
  })

  // TEA, 2026-11-13: the release run goes through the Worklets staging for the four ABIs the AAB
  // ships, the ABI check expects and the Release staging accepts.
  test('stages and builds exactly the shipped ABIs through the Worklets staging', () => {
    const abis = RELEASE_ABI_LIST.split(',')
    assert.deepEqual([...abis].sort(), [...SHIPPED_ABIS].sort())
    assert.deepEqual(abis, STAGED_ABIS.Release)
    assert.ok(RELEASE_BUILD.startsWith('node scripts/ci/worklets-staged-gradle.mjs '))
    assert.ok(
      RELEASE_BUILD.includes(`--configuration Release --abis ${RELEASE_ABI_LIST} `)
    )
    assert.ok(RELEASE_BUILD.includes(` -PreactNativeArchitectures=${RELEASE_ABI_LIST} `))
    assert.ok(
      RELEASE_BUILD.includes('--evidence "$RUNNER_TEMP/android-release-builds/worklets"')
    )
    const build = step(release(source.workflow), (row) => row.id === 'android_build')
    assert.equal(build['working-directory'], undefined)
    assert.deepEqual(build.env, { NODE_ENV: 'production' })
  })

  test('runs the network-timeout flow from the debug client on an emulator', () => {
    const job = network(source.workflow)
    assert.equal(step(job, (row) => row.id === 'client_build').run, CLIENT_BUILD)
    const flow = step(job, (row) => row.id === 'network_timeout')
    assert.equal(flow.uses, 'reactivecircus/android-emulator-runner@v2')
    assert.equal(flow.with.script, `bash ${NETWORK_SCRIPT}`)
    assert.equal(flow.if, undefined)
  })

  // Triggers.
  for (const [title, change] of [
    ['a pull_request trigger', (on) => (on.pull_request = {})],
    ['a pull_request_target trigger', (on) => (on.pull_request_target = {})],
    ['a merge trigger', (on) => (on.push = { branches: ['main'] })],
    [
      'a dispatch input',
      (on) => (on.workflow_dispatch = { inputs: { ref: { type: 'string' } } }),
    ],
    ['no dispatch', (on) => delete on.workflow_dispatch],
  ])
    rejected(title, /runs only nightly and on a manual dispatch/, (workflow) =>
      change(onOf(workflow))
    )
  for (const cron of ['37 3 * * 1', '*/5 * * * *', '37 3 1 1 *'])
    rejected(`a schedule of ${cron}`, /one nightly schedule/, (workflow) => {
      onOf(workflow).schedule = [{ cron }]
    })
  rejected('write access', /contents: read only/, (workflow) => {
    workflow.permissions = { contents: 'write' }
  })
  rejected('a third job', /holds exactly/, (workflow) => {
    workflow.jobs.extra = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo' }] }
  })
  rejected('a secret in reach', /reads no secret/, (workflow) => {
    step(release(workflow), (row) => row.id === 'android_build').env.TOKEN =
      '${{ secrets.EXPO_TOKEN }}'
  })

  // Each job.
  for (const name of [RELEASE_JOB, NETWORK_JOB]) {
    const job = (workflow) => workflow.jobs[name]
    rejected(
      `${name} on macOS`,
      new RegExp(`${name}: ubuntu-latest runner required`),
      (w) => {
        job(w)['runs-on'] = 'macos-15'
      }
    )
    rejected(`${name} without a limit`, new RegExp(`${name}: limit must be`), (w) => {
      delete job(w)['timeout-minutes']
    })
    rejected(
      `${name} only on a dispatch`,
      new RegExp(`${name}: runs on every nightly`),
      (w) => {
        job(w).if = "github.event_name == 'workflow_dispatch'"
      }
    )
    rejected(
      `${name} that may fail`,
      new RegExp(`${name}: failures must remain visible`),
      (w) => {
        job(w)['continue-on-error'] = true
      }
    )
    rejected(`${name} with a disabled step`, /has a condition that disables it/, (w) => {
      job(w).steps[3].if = 'false'
    })
    rejected(
      `${name} with a step longer than the job`,
      /every step limit stays inside/,
      (w) => {
        job(w).steps.find((row) => row['timeout-minutes'])['timeout-minutes'] = 600
      }
    )
    const upload = (w) =>
      job(w).steps.find((row) => String(row.uses).startsWith('actions/upload-artifact'))
    for (const [what, change] of [
      ['kept for 90 days', (row) => (row.with['retention-days'] = 90)],
      ['kept for the default', (row) => delete row.with['retention-days']],
      ['that may be missing', (row) => (row.with['if-no-files-found'] = 'warn')],
      ['only on success', (row) => (row.if = 'success()')],
    ])
      rejected(
        `${name} evidence ${what}`,
        new RegExp(`${name}: upload its evidence once`),
        (w) => change(upload(w))
      )
    rejected(
      `${name} without evidence`,
      new RegExp(`${name}: upload its evidence once`),
      (w) => {
        job(w).steps = job(w).steps.filter((row) => row !== upload(w))
      }
    )
    rejected(
      `${name} without the prebuild`,
      new RegExp(`${name}: generate the Android project`),
      (w) => {
        job(w).steps = job(w).steps.filter(
          (row) => !String(row.run).includes('expo prebuild')
        )
      }
    )
  }

  // The release builds.
  const build = (w) => step(release(w), (row) => row.id === 'android_build')
  rejected(
    'a release build without the minifiedDebuggable APK',
    /the build .*does not execute/,
    (w) => {
      build(w).run = './gradlew :app:bundleRelease --console=plain\n'
    }
  )
  rejected('a release build without the AAB', /the build .*does not execute/, (w) => {
    build(w).run = './gradlew :app:assembleMinifiedDebuggable --console=plain\n'
  })
  rejected('a release build of one ABI', /every shipped ABI/, (w) => {
    build(w).run = `${RELEASE_BUILD} -PreactNativeArchitectures=x86_64\n`
  })
  rejected(
    'a plain release build without the Worklets staging',
    /the build .*does not execute/,
    (w) => {
      build(w).run =
        './gradlew :app:bundleRelease :app:assembleMinifiedDebuggable --console=plain\n'
      build(w)['working-directory'] = 'apps/mobile/android'
    }
  )
  rejected(
    'a staged release of three ABIs',
    /staging and building every shipped ABI/,
    (w) => {
      build(w).run = RELEASE_BUILD.replaceAll(
        RELEASE_ABI_LIST,
        'armeabi-v7a,arm64-v8a,x86_64'
      )
    }
  )
  rejected(
    'a release build inside apps/mobile/android',
    /from the repository root/,
    (w) => {
      build(w)['working-directory'] = 'apps/mobile/android'
    }
  )
  rejected('a release build whose failure is ignored', /the build must exist/, (w) => {
    build(w).run = `${RELEASE_BUILD} || true\n`
  })
  for (const id of ['minified_debuggable', 'release_abis']) {
    const check = (w) => step(release(w), (row) => row.id === id)
    rejected(`the ${id} check removed`, /must exist/, (w) => {
      release(w).steps = release(w).steps.filter((row) => row.id !== id)
    })
    rejected(`the ${id} check after a failed build`, /must exist, run on/, (w) => {
      check(w).if = 'always()'
    })
    rejected(
      `the ${id} check without pipefail`,
      /hides a failure in its pipeline/,
      (w) => {
        check(w).run = check(w).run.replace('set -euo pipefail\n', '')
      }
    )
    rejected(`the ${id} check commented out`, /does not execute/, (w) => {
      check(w).run = check(w)
        .run.split('\n')
        .map((line) => (line.startsWith('node ') ? `# ${line}` : line))
        .join('\n')
    })
  }
  rejected('the ABI check on the APK', /the ABI check does not execute/, (w) => {
    const row = step(release(w), (item) => item.id === 'release_abis')
    row.run = row.run.replace(
      'bundle/release/app-release.aab',
      'apk/release/app-release.apk'
    )
  })

  // The network-timeout flow.
  const flow = (w) => step(network(w), (row) => row.id === 'network_timeout')
  rejected(
    'the flow skipped after a failed build',
    /run bash scripts\/ci\/android-network-timeout.sh/,
    (w) => {
      flow(w).if = 'always()'
    }
  )
  rejected(
    'another emulator script',
    /run bash scripts\/ci\/android-network-timeout.sh/,
    (w) => {
      flow(w).with.script = 'bash scripts/ci/share-card-android.sh'
    }
  )
  rejected('the flow without Maestro', /install Maestro/, (w) => {
    network(w).steps = network(w).steps.filter(
      (row) => !String(row.run).includes('maestro-install.mjs')
    )
  })
  rejected('a Release client for the flow', /the client build does not execute/, (w) => {
    step(network(w), (row) => row.id === 'client_build').run =
      './gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --console=plain\n'
  })
  for (const [title, from, to, expected] of [
    [
      'a tarpit on another port',
      '--port 4010',
      '--port 4011',
      /does not start: node scripts\/lib\/network-tarpit/,
    ],
    [
      'Metro pointed at a live API',
      'http://10.0.2.2:4010',
      'http://10.0.2.2:4000',
      /does not start: \(cd apps\/mobile/,
    ],
    [
      'the flow on another app',
      'MAESTRO_APP_ID=com.couturecast.app',
      'MAESTRO_APP_ID=com.couturecast.story68',
      /does not execute: "\$HOME\/.maestro/,
    ],
    [
      'the flow on another Metro',
      '10.0.2.2%3A8081',
      '10.0.2.2%3A8089',
      /does not execute: "\$HOME\/.maestro/,
    ],
    [
      'another flow',
      'maestro/network-timeout/dev-client-timeout.yaml',
      'maestro/home.yaml',
      /does not execute: "\$HOME\/.maestro/,
    ],
    ['a lax shell', 'set -euo pipefail', 'set -u', /one strict shell/],
    [
      'a flow whose failure is ignored',
      'maestro/network-timeout/dev-client-timeout.yaml\n',
      'maestro/network-timeout/dev-client-timeout.yaml || true\n',
      /ignore no other status|does not execute/,
    ],
    [
      'no check that the tarpit lives',
      'kill -0 "$tarpit"\n',
      '',
      /does not execute: kill -0/,
    ],
  ])
    rejected(title, expected, (_, script) => {
      assert.ok(script.includes(from), from)
      return script.replace(from, to)
    })
})

// The emulator script as bash runs it, with every command it calls stubbed: it passes when the
// tarpit, Metro and the flow pass, and fails when any one of them does not.
describe('android-network-timeout.sh', () => {
  const script = path.resolve(NETWORK_SCRIPT)
  const run = (env = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-network-timeout-'))
    try {
      const bin = path.join(dir, 'bin')
      const maestroBin = path.join(dir, 'home/.maestro/bin')
      fs.mkdirSync(bin)
      fs.mkdirSync(maestroBin, { recursive: true })
      fs.mkdirSync(path.join(dir, 'work/apps/mobile'), { recursive: true })
      const stub = (file, body) =>
        fs.writeFileSync(
          file,
          `#!/bin/sh\necho "$(basename "$0") $*" >> "${dir}/calls"\n${body}\n`,
          {
            mode: 0o755,
          }
        )
      stub(path.join(bin, 'node'), '[ -n "$TARPIT_DIES" ] && exit 1\nexec /bin/sleep 5')
      // Metro's stub records the env it got and leaves a grandchild, as npx and expo start do.
      stub(
        path.join(bin, 'npx'),
        `echo "metro-env $EXPO_PUBLIC_API_BASE_URL $EXPO_PUBLIC_SUPABASE_URL $EXPO_PUBLIC_SUPABASE_ANON_KEY" >> "${dir}/calls"\n/bin/sleep 30 &\necho $! > "${dir}/metro-child"\nexec /bin/sleep 30`
      )
      stub(
        path.join(bin, 'curl'),
        '[ -n "$METRO_DOWN" ] && exit 7\necho packager-status:running'
      )
      stub(path.join(bin, 'adb'), 'exit 0')
      stub(path.join(bin, 'sleep'), 'exit 0')
      stub(path.join(maestroBin, 'maestro'), 'exit "${MAESTRO_EXIT:-0}"')
      for (const tool of ['grep', 'mkdir', 'seq', 'cp', 'basename', 'cat', 'pgrep'])
        fs.symlinkSync(
          spawnSync('/usr/bin/which', [tool], { encoding: 'utf8' }).stdout.trim(),
          path.join(bin, tool)
        )
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', script], {
        cwd: path.join(dir, 'work'),
        encoding: 'utf8',
        env: {
          PATH: bin,
          HOME: path.join(dir, 'home'),
          NETWORK_TIMEOUT_EVIDENCE: path.join(dir, 'evidence'),
          ...env,
        },
      })
      const calls = fs.existsSync(path.join(dir, 'calls'))
        ? fs.readFileSync(path.join(dir, 'calls'), 'utf8')
        : ''
      const childFile = path.join(dir, 'metro-child')
      const child = fs.existsSync(childFile)
        ? Number(fs.readFileSync(childFile, 'utf8').trim())
        : undefined
      // The group kill is delivered asynchronously and a killed orphan stays visible until init
      // reaps it, so the child gets up to 5 s to disappear (Linux CI saw it still listed at once).
      const alive = (pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      let childAlive = false
      if (child) {
        const deadline = Date.now() + 5000
        while (alive(child) && Date.now() < deadline)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
        childAlive = alive(child)
        if (childAlive) process.kill(child, 'SIGKILL')
      }
      return { status: result.status, calls, childAlive }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('passes when the tarpit, Metro and the flow pass, with the documented arguments', () => {
    const { status, calls, childAlive } = run()
    assert.equal(status, 0)
    // Device runner, leg 3: without a Supabase URL and key the app never sends Home's request.
    assert.match(
      calls,
      /^metro-env http:\/\/10\.0\.2\.2:4010 http:\/\/10\.0\.2\.2:4011 network-timeout-placeholder$/m
    )
    // Stopping Metro stops what it spawned; the local run left expo start holding 8081.
    assert.equal(childAlive, false)
    assert.match(calls, /^node scripts\/lib\/network-tarpit\.mjs --port 4010$/m)
    assert.match(calls, /^npx expo start --dev-client --port 8081$/m)
    assert.match(
      calls,
      /^adb -s emulator-5554 install -r apps\/mobile\/android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk$/m
    )
    assert.match(
      calls,
      /^maestro --device emulator-5554 test -e MAESTRO_APP_ID=com\.couturecast\.app -e APP_URL=mobile:\/\/expo-development-client\/\?url=http%3A%2F%2F10\.0\.2\.2%3A8081 --test-output-dir .*\/evidence\/maestro maestro\/network-timeout\/dev-client-timeout\.yaml$/m
    )
  })

  test('fails when the flow fails', () => {
    assert.notEqual(run({ MAESTRO_EXIT: '1' }).status, 0)
  })

  test('fails before the flow when Metro never comes up', () => {
    const { status, calls } = run({ METRO_DOWN: '1' })
    assert.notEqual(status, 0)
    assert.doesNotMatch(calls, /^maestro /m)
  })

  test('fails before the flow when the tarpit is gone', () => {
    const { status, calls } = run({ TARPIT_DIES: '1' })
    assert.notEqual(status, 0)
    assert.doesNotMatch(calls, /^maestro /m)
  })

  test('requires an evidence directory', () => {
    assert.notEqual(run({ NETWORK_TIMEOUT_EVIDENCE: '' }).status, 0)
  })
})
