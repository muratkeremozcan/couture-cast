// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6 and C-13: ios-native.yml runs the iOS work that cannot fit a pull request, on
// main, nightly and on demand for one commit. Each control below breaks one rule and must be
// rejected; the committed workflow must pass all of them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  IOS_NATIVE_WORKFLOW,
  JOBS,
  RUN_NAME,
  iosNativeProblems,
  missingHelpers,
} from './ios-native-workflow.mjs'

const text = fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')
const source = parse(text)
// A JSON round trip breaks the sharing YAML aliases create, so one job can be mutated alone.
const fresh = () => JSON.parse(JSON.stringify(source))
const step = (job, predicate) => job.steps.find(predicate)
const rejected = (title, expected, change) =>
  test(`${title} is rejected`, () => {
    const workflow = fresh()
    change(workflow.jobs, workflow)
    const problems = iosNativeProblems(workflow)
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      problems.join('\n') || 'no problem raised'
    )
  })

describe('ios-native workflow validator', () => {
  test('the committed workflow passes', () => {
    assert.deepEqual(iosNativeProblems(source), [])
  })

  // C-13: every script and local action the workflow calls exists at this commit, so a push or
  // a scheduled run cannot fail on a helper only a later change adds.
  test('every helper the workflow calls exists at this commit', () => {
    assert.deepEqual(missingHelpers(text), [])
    assert.deepEqual(
      missingHelpers(
        'run: node scripts/ci/not-here.mjs\nuses: ./.github/actions/not-here\n'
      ),
      ['scripts/ci/not-here.mjs', './.github/actions/not-here/action.yml']
    )
  })

  test('one build, four parallel shards and Expo Go on its client, and the Release app beside them', () => {
    assert.deepEqual(Object.keys(source.jobs).sort(), [...JOBS].sort())
    assert.equal(source.jobs['ios-build'].needs, undefined)
    assert.deepEqual(source.jobs['ios-shard'].strategy.matrix.shard, [1, 2, 3, 4])
    assert.deepEqual(source.jobs['ios-shard'].needs, 'ios-build')
    assert.deepEqual(source.jobs['ios-expo-go'].needs, 'ios-build')
    assert.equal(source.jobs['ios-app-build'].needs, undefined)
  })

  // Triggers and the commit a run tests.
  rejected('a pull_request trigger', /never runs on a pull request/, (_, w) => {
    w.on.pull_request = {}
  })
  rejected('a pull_request_target trigger', /never runs on a pull request/, (_, w) => {
    w.on.pull_request_target = {}
  })
  rejected('an unfiltered merge trigger', /filtered by its native iOS inputs/, (_, w) => {
    delete w.on.push.paths
  })
  rejected('no nightly run', /nightly schedule/, (_, w) => {
    delete w.on.schedule
  })
  rejected('an optional sha', /required sha input/, (_, w) => {
    w.on.workflow_dispatch.inputs.sha.required = false
  })
  rejected('a second dispatch input', /exactly one commit/, (_, w) => {
    w.on.workflow_dispatch.inputs.ref = { type: 'string', required: false }
  })
  rejected('a run name without the commit', /run name must be/, (_, w) => {
    w['run-name'] = 'iOS native'
  })
  for (const name of JOBS) {
    rejected(
      `${name} checking out the default ref`,
      new RegExp(`${name}: check out the dispatched commit`),
      (jobs) => {
        delete jobs[name].steps[0].with
      }
    )
    rejected(
      `${name} without the commit proof`,
      new RegExp(`${name}: the second step must fail unless HEAD`),
      (jobs) => {
        jobs[name].steps.splice(1, 1)
      }
    )
    rejected(
      `${name} proving another commit`,
      new RegExp(`${name}: the second step must fail unless HEAD`),
      (jobs) => {
        jobs[name].steps[1].env.SHA = '${{ github.sha }}'
      }
    )
  }
  for (const name of ['ios-build', 'ios-shard', 'ios-expo-go', 'ios-app-build']) {
    rejected(
      `${name} on macos-15`,
      new RegExp(`${name}: macos-26 runner required`),
      (jobs) => {
        jobs[name]['runs-on'] = 'macos-15'
      }
    )
    rejected(
      `${name} on the image default Xcode`,
      new RegExp(`${name}: select Xcode 26.4 or later`),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter((row) => row.id !== 'xcode')
      }
    )
    rejected(
      `${name} accepting Xcode 26.3`,
      new RegExp(`${name}: select Xcode 26.4`),
      (jobs) => {
        const row = step(jobs[name], (item) => item.id === 'xcode')
        row.run = row.run.replace('-ge 4 ]', '-ge 3 ]')
      }
    )
  }

  // Shape.
  rejected(
    'a shard that waits on nothing',
    /ios-shard must need exactly ios-build/,
    (jobs) => {
      delete jobs['ios-shard'].needs
    }
  )
  rejected(
    'Expo Go after the shards',
    /ios-expo-go must need exactly ios-build/,
    (jobs) => {
      jobs['ios-expo-go'].needs = ['ios-build', 'ios-shard']
    }
  )
  rejected('a build that waits on something', /ios-build starts the run/, (jobs) => {
    jobs['ios-build'].needs = ['ios-app-build']
  })
  rejected('two shards', /every shard of the iOS plan/, (jobs) => {
    jobs['ios-shard'].strategy.matrix.shard = [1, 2]
  })
  rejected(
    'a shard matrix that cancels its siblings',
    /every shard of the iOS plan/,
    (jobs) => {
      delete jobs['ios-shard'].strategy['fail-fast']
    }
  )
  rejected('a shorter shard limit', /keeps its 70-minute limit/, (jobs) => {
    jobs['ios-shard']['timeout-minutes'] = 45
  })
  rejected('a shard command without its shard', /receive its shard/, (jobs) => {
    const row = step(jobs['ios-shard'], (item) => item.run?.includes('--shard "$shard"'))
    row.run = row.run.replace('--shard "$shard"', '')
  })
  rejected(
    'a shard running the Expo Go proof',
    /no shard runs the Expo Go proof/,
    (jobs) => {
      const row = step(jobs['ios-shard'], (item) => item.name === 'iOS shard flows')
      row.run += '\nnode scripts/run-story68-native.mjs expo-go-proof --platform ios\n'
    }
  )
  rejected(
    'evidence skipped after a failed shard',
    /ios-evidence must run after any/,
    (jobs) => {
      delete jobs['ios-evidence'].if
    }
  )
  rejected(
    'evidence that ignores the shard result',
    /ios-evidence must run after any/,
    (jobs) => {
      jobs['ios-evidence'].steps = jobs['ios-evidence'].steps.filter(
        (row) => !row.run?.includes('CC68_SHARD_RESULT')
      )
    }
  )
  rejected('Expo Go without its proof', /runs the proof once/, (jobs) => {
    jobs['ios-expo-go'].steps = jobs['ios-expo-go'].steps.filter(
      (row) => !row.run?.includes('expo-go-proof')
    )
  })
  rejected('Expo Go without the PNG guards', /PNG guards/, (jobs) => {
    jobs['ios-expo-go'].steps = jobs['ios-expo-go'].steps.filter(
      (row) => !row.run?.includes('swift test --package-path')
    )
  })
  rejected(
    'a Debug app for the focus check',
    /Release app and its accessibility-focus/,
    (jobs) => {
      const row = step(jobs['ios-app-build'], (item) =>
        item.run?.includes('-configuration Release')
      )
      row.run = row.run.replace('-configuration Release', '-configuration Debug')
    }
  )

  // The client.
  rejected(
    'a client keyed by something else',
    /keyed by scripts\/ci\/native-build-cache/,
    (jobs) => {
      step(jobs['ios-build'], (row) => row.id === 'native_key').run =
        'echo "key=cc68-ios-${{ github.sha }}" >> "$GITHUB_OUTPUT"'
    }
  )
  rejected(
    'a build that ignores the cache',
    /build only when the key is not cached/,
    (jobs) => {
      step(jobs['ios-build'], (row) => row.id === 'java').if = '${{ !cancelled() }}'
    }
  )
  rejected(
    'caching the client before its scan',
    /secret-scanned before it is cached/,
    (jobs) => {
      const steps = jobs['ios-build'].steps
      steps.splice(
        steps.findIndex((row) => row.id === 'app_scan'),
        1
      )
    }
  )
  rejected(
    'a scan without the harness directory',
    /secret-scanned before it is cached/,
    (jobs) => {
      const row = step(jobs['ios-build'], (item) => item.id === 'app_scan')
      row.run = row.run.replace(' "$CC68_HARNESS_DIR"', '')
    }
  )
  rejected(
    'a build that does not prove its saved key',
    /prove the saved key exists/,
    (jobs) => {
      const steps = jobs['ios-build'].steps
      steps.splice(
        steps.findIndex((row) => row.with?.['fail-on-cache-miss'] === true),
        1
      )
    }
  )
  for (const name of ['ios-shard', 'ios-expo-go'])
    rejected(
      `${name} restoring without failing on a miss`,
      new RegExp(`${name}: restore exactly the key ios-build resolved`),
      (jobs) => {
        delete step(jobs[name], (row) => row.with?.['fail-on-cache-miss'] === true).with[
          'fail-on-cache-miss'
        ]
      }
    )
  rejected('the client as an artifact', /upload only closed evidence/, (jobs) => {
    jobs['ios-build'].steps.push({
      if: 'always()',
      uses: 'actions/upload-artifact@v4',
      with: { name: 'client', path: '/tmp/cc68-ios-build', 'if-no-files-found': 'error' },
    })
  })
  rejected('a shard downloading an artifact', /travels by cache only/, (jobs) => {
    jobs['ios-shard'].steps.push({ uses: 'actions/download-artifact@v4' })
  })

  // Runtimes.
  for (const name of ['ios-build', 'ios-shard', 'ios-expo-go']) {
    rejected(
      `${name} without the harness env`,
      new RegExp(`${name}: the harness directory`),
      (jobs) => {
        delete jobs[name].env
      }
    )
    rejected(
      `${name} skipping cleanup after a failure`,
      new RegExp(`${name}: .*cleanup.mjs must always run`),
      (jobs) => {
        step(
          jobs[name],
          (row) => row.run === 'node scripts/e2e-share-card/cleanup.mjs'
        ).if = 'success()'
      }
    )
    rejected(
      `${name} starting Metro without its platform`,
      /every Metro start must pass/,
      (jobs) => {
        jobs[name].steps.push({
          run: 'node scripts/run-story68-native.mjs metro > /tmp/m.log',
        })
      }
    )
  }
})

describe('the commit proof', () => {
  const proof = source.jobs['ios-build'].steps[1]
  const run = (head, sha) => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-native-proof-'))
    try {
      const bin = path.join(scratch, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env bash\necho ${head}\n`, {
        mode: 0o755,
      })
      return spawnSync('bash', ['-e', '-c', proof.run], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SHA: sha },
      }).status
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  }
  const head = 'a'.repeat(40)

  test('passes only when HEAD is exactly the full commit named', () => {
    assert.equal(run(head, head), 0)
    assert.notEqual(run(head, 'b'.repeat(40)), 0, 'another commit checked out')
    assert.notEqual(run(head, 'a'.repeat(7)), 0, 'a short SHA')
    assert.notEqual(run(head, 'main'), 0, 'a branch name')
    assert.notEqual(run(head, ''), 0, 'nothing')
  })

  test('the run name carries the same commit the jobs prove', () => {
    assert.equal(source['run-name'], RUN_NAME)
    for (const name of JOBS)
      assert.equal(source.jobs[name].steps[1].env.SHA, '${{ inputs.sha || github.sha }}')
  })
})

describe('the Xcode selection', () => {
  const xcode = step(source.jobs['ios-build'], (row) => row.id === 'xcode')
  const select = (installed) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-select-'))
    try {
      const bin = path.join(root, 'bin')
      fs.mkdirSync(bin)
      for (const [name, body] of Object.entries({
        sudo: 'exit 0',
        xcodebuild: 'echo Xcode',
        xcrun: 'echo 26.4',
      }))
        fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, {
          mode: 0o755,
        })
      for (const name of installed) fs.mkdirSync(path.join(root, name))
      const env = path.join(root, 'github-env')
      fs.writeFileSync(env, '')
      const status = spawnSync('bash', ['-c', xcode.run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          XCODE_ROOT: root,
          GITHUB_ENV: env,
        },
      }).status
      return { status, env: fs.readFileSync(env, 'utf8').replaceAll(root, '').trim() }
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
    assert.equal(picked.env, 'DEVELOPER_DIR=/Xcode_26.10.app/Contents/Developer')
    assert.equal(
      select(['Xcode_26.4.app', 'Xcode_26.4.1.app']).env,
      'DEVELOPER_DIR=/Xcode_26.4.1.app/Contents/Developer'
    )
    assert.notEqual(select(['Xcode_16.4.app', 'Xcode_26.3.app']).status, 0)
    assert.notEqual(select(['Xcode_27.0.app']).status, 0)
    assert.notEqual(select([]).status, 0)
  })

  test('every macOS job runs the same selection', () => {
    for (const name of ['ios-shard', 'ios-expo-go', 'ios-app-build'])
      assert.equal(
        step(source.jobs[name], (row) => row.id === 'xcode').run,
        xcode.run,
        name
      )
  })
})
