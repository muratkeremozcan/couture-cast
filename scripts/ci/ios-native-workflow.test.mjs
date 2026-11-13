// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6, C-13 and IOS-01/02/03: the iOS jobs run off the pull request path, from
// ios-native.yml nightly and on a manual dispatch, and from the nightly iOS 26.5 canary. No macOS
// job runs on a pull request or gates a merge (owner rule, 2026-11-13). Each control below breaks
// one rule and must be rejected, each by its own predicate; the committed workflows must pass all
// of them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { helperProblems, npmCalls } from './ios-native-helpers.mjs'
import {
  CANARY_WORKFLOW,
  CLIENT_ARTIFACT,
  IOS_RELEASE_APP,
  JOBS_WORKFLOW,
  LIVE_FONT_ARTIFACT,
  LIVE_FONT_INSTALL,
  LIVE_FONT_JOB,
  LIVE_FONT_PROOF,
  LIVE_FONT_RELEASE_BUILD,
  LIVE_FONT_SCAN,
  LIVE_FONT_SCREENS,
  MACOS_JOBS,
  MANDATORY,
  NIGHTLY_WORKFLOW,
  PROOF,
  TEST_JOBS,
  XCODE_CHOICES,
  disabledCondition,
  iosNativeProblems,
  neutralizedRun,
  readWorkflows,
} from './ios-native-workflow.mjs'
import { CACHE_VERSION, cacheKey } from './native-build-cache.mjs'
import { cacheOutputs } from './native-supabase.mjs'

const source = readWorkflows()
const P = NIGHTLY_WORKFLOW
const J = JOBS_WORKFLOW
const C = CANARY_WORKFLOW
// A JSON round trip breaks the sharing YAML aliases create, so one job can be mutated alone.
const fresh = () => JSON.parse(JSON.stringify(source))
const step = (job, predicate) => job.steps.find(predicate)
const rejected = (title, expected, change) =>
  test(`${title} is rejected`, () => {
    const files = fresh()
    change(files[J].jobs, files)
    const problems = iosNativeProblems(files)
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      problems.join('\n') || 'no problem raised'
    )
  })
const onOf = (workflow) => workflow.on ?? workflow[true]
// The body with every line that carries `line` commented out, continuations included.
const commentOut = (run, line) =>
  run
    .replace(/\s*\\\n\s*/g, ' ')
    .split('\n')
    .map((row) => (row.trim() === line ? `# ${row}` : row))
    .join('\n')

// The client and the Release app build on macos-26 with Xcode 26.4 or later; the shards and Expo
// Go run on macos-15's iOS 18.5 simulator from Xcode 16.4.
function runnerAndXcodeFixtures() {
  for (const [name, choice] of Object.entries(XCODE_CHOICES)) {
    const consumer = choice !== '26.4+'
    const label = consumer ? '16.4, or 26.4 or later under the canary,' : '26.4 or later'
    // A consumer on either fixed runner drops the canary switch; a builder may not leave macos-26.
    const runners = consumer
      ? ['macos-26', 'macos-15', "${{ inputs.ios26-canary && 'macos-15' || 'macos-26' }}"]
      : ['macos-15', "${{ inputs.ios26-canary && 'macos-26' || 'macos-15' }}"]
    for (const runner of runners)
      rejected(
        `${name} on ${runner}`,
        new RegExp(`${name}: .* runner required`),
        (jobs) => {
          jobs[name]['runs-on'] = runner
        }
      )
    rejected(
      `${name} on the image default Xcode`,
      new RegExp(`${name}: select Xcode ${label} by name`),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter((row) => row.id !== 'xcode')
      }
    )
    for (const other of consumer
      ? ['26.4+', '16.4']
      : ['16.4', XCODE_CHOICES['ios-shard']])
      rejected(
        `${name} choosing Xcode ${other}`,
        new RegExp(`${name}: select Xcode ${label} by name`),
        (jobs) => {
          step(jobs[name], (item) => item.id === 'xcode').env.XCODE = other
        }
      )
    for (const [what, from, to] of [
      ['accepting Xcode 26.3', '-ge 4 ]', '-ge 3 ]'],
      ['taking Xcode 16.4 from elsewhere', '"$root/Xcode_16.4.app"', '"/tmp/Xcode.app"'],
      ['without the simulator SDK check', '16.4:18.5 | 26.4+:26.*) ;;', '*) ;;'],
    ])
      rejected(
        `${name} ${what}`,
        new RegExp(`${name}: select Xcode ${label}`),
        (jobs) => {
          const row = step(jobs[name], (item) => item.id === 'xcode')
          row.run = row.run.replaceAll(from, to)
        }
      )
  }
}

// C-16: the nightly canary alone turns on the iOS 26.5 simulator, and it gates nothing.
function canaryFixtures() {
  for (const [title, expected, change] of [
    [
      'a canary on a merge',
      /runs only on its own nightly schedule/,
      (on) => {
        on.push = { branches: ['main'] }
      },
    ],
    [
      'a canary at the nightly minute of ios-native.yml',
      /apart from ios-native.yml/,
      (on, files) => {
        on.schedule = [...onOf(files[P]).schedule]
      },
    ],
    [
      'a weekly canary',
      /runs only on its own nightly schedule/,
      (on) => {
        on.schedule = [{ cron: '47 4 * * 1' }]
      },
    ],
    [
      'a canary on a dispatch',
      /runs only on its own nightly schedule/,
      (on) => {
        on.workflow_dispatch = {}
      },
    ],
  ])
    rejected(title, expected, (_, files) => change(onOf(files[C]), files))
  for (const [title, change] of [
    [
      'a canary that cancels the running one',
      (canary) => {
        canary.concurrency['cancel-in-progress'] = true
      },
    ],
    [
      'a canary sharing the nightly queue',
      (canary) => {
        canary.concurrency.group = 'ios-native-${{ github.event_name }}-${{ github.sha }}'
      },
    ],
    [
      'a canary with write access',
      (canary) => {
        canary.permissions = { contents: 'write' }
      },
    ],
    [
      'a canary with a read-only cache',
      (canary) => {
        canary['cache-mode'] = 'read'
      },
    ],
    [
      'a canary run named like the gating runs',
      (canary) => {
        canary['run-name'] = 'iOS native ${{ github.sha }}'
      },
    ],
  ])
    rejected(title, /ios-native-canary.yml: run name .* one queued canary/, (_, files) =>
      change(files[C])
    )
  for (const [title, change] of [
    [
      'a canary that runs the gating simulator',
      (call) => {
        call.with['ios26-canary'] = false
      },
    ],
    [
      'a canary without the switch',
      (call) => {
        delete call.with['ios26-canary']
      },
    ],
    [
      'a canary of another commit',
      (call) => {
        call.with.sha = '${{ github.event.before }}'
      },
    ],
    [
      'a canary behind a condition',
      (call) => {
        call.if = "${{ github.ref == 'refs/heads/main' }}"
      },
    ],
  ])
    rejected(
      title,
      /one call of the jobs for github.sha with ios26-canary: true/,
      (_, files) => change(files[C].jobs['ios-native-canary'])
    )
  rejected('a second canary job', /one call of the jobs/, (_, files) => {
    files[C].jobs.extra = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo' }] }
  })
  rejected(
    'ios-native.yml passing the canary switch',
    /ios-native.yml never passes ios26-canary/,
    (_, files) => {
      files[P].jobs['ios-native'].with['ios26-canary'] = true
    }
  )
  for (const [title, change] of [
    [
      'a canary switch on by default',
      (input) => {
        input.default = true
      },
    ],
    [
      'a required canary switch',
      (input) => {
        input.required = true
      },
    ],
    [
      'a canary switch as a string',
      (input) => {
        input.type = 'string'
      },
    ],
  ])
    rejected(title, /ios26-canary is an optional boolean, off unless/, (_, files) =>
      change(onOf(files[J]).workflow_call.inputs['ios26-canary'])
    )
  rejected(
    'a third jobs input',
    /runs only when called, for one required sha/,
    (_, files) => {
      onOf(files[J]).workflow_call.inputs.runner = { type: 'string', required: false }
    }
  )
}

describe('ios-native workflows validator', () => {
  test('the committed workflows pass', () => {
    assert.deepEqual(iosNativeProblems(source), [])
  })

  test('one build, four parallel shards and Expo Go on its client, and the Release app beside them', () => {
    const jobs = source[J].jobs
    assert.deepEqual(Object.keys(jobs).sort(), [...TEST_JOBS].sort())
    assert.deepEqual(jobs['ios-shard'].strategy.matrix.shard, [1, 2, 3, 4])
    assert.equal(jobs['ios-shard'].needs, 'ios-build')
    assert.equal(jobs['ios-expo-go'].needs, 'ios-build')
    assert.equal(jobs['ios-app-build'].needs, undefined)
    assert.equal(source[P].jobs['ios-native'].uses, `./${J}`)
  })

  // Triggers and the commit a run tests.
  for (const file of [P, J, C]) {
    rejected(
      `a pull_request trigger on ${file}`,
      /never runs on a pull request/,
      (_, files) => {
        onOf(files[file]).pull_request = {}
      }
    )
    rejected(
      `a pull_request_target trigger on ${file}`,
      /never runs on a pull request/,
      (_, files) => {
        onOf(files[file]).pull_request_target = {}
      }
    )
  }
  // The owner rule: macOS jobs run nightly and on a manual dispatch, never on a merge.
  for (const [title, change] of [
    [
      'a merge trigger on ios-native.yml',
      (on) => {
        on.push = { branches: ['main'] }
      },
    ],
    [
      'a dispatch input on ios-native.yml',
      (on) => {
        on.workflow_dispatch = { inputs: { sha: { required: true, type: 'string' } } }
      },
    ],
    [
      'no dispatch trigger on ios-native.yml',
      (on) => {
        delete on.workflow_dispatch
      },
    ],
  ])
    rejected(
      title,
      /runs only nightly and on a manual dispatch without inputs/,
      (_, files) => change(onOf(files[P]))
    )
  rejected('no nightly run', /one nightly schedule/, (_, files) => {
    delete onOf(files[P]).schedule
  })
  // IOS-02: five valid cron fields alone also accept a yearly run.
  for (const cron of ['23 3 1 1 *', '23 3 * * 1', '*/5 * * * *', '23 3 */2 * *'])
    rejected(`a schedule of ${cron}`, /one nightly schedule/, (_, files) => {
      onOf(files[P]).schedule = [{ cron }]
    })
  rejected(
    'a nightly run name without the commit',
    /run name must be "iOS native \$\{\{ github.sha/,
    (_, files) => {
      files[P]['run-name'] = 'iOS native'
    }
  )
  rejected('the jobs on another trigger', /runs only when called/, (_, files) => {
    onOf(files[J]).push = { branches: ['main'] }
  })
  rejected(
    'the jobs called for an optional sha',
    /runs only when called, for one required sha/,
    (_, files) => {
      onOf(files[J]).workflow_call.inputs.sha.required = false
    }
  )

  rejected('a cache-mode in the jobs file', /declares no cache-mode/, (_, files) => {
    files[J]['cache-mode'] = 'write'
  })
  rejected('a cache-mode on one called job', /declares no cache-mode/, (jobs) => {
    jobs['ios-build']['cache-mode'] = 'write'
  })
  rejected(
    'a nightly caller that limits the cache',
    /contents: read only, the trusted cache default/,
    (_, files) => {
      files[P]['cache-mode'] = 'read'
    }
  )
  rejected(
    'a nightly run that calls the jobs for another commit',
    /call the jobs for github.sha on every run/,
    (_, files) => {
      files[P].jobs['ios-native'].with.sha = '${{ github.event.before }}'
    }
  )
  rejected(
    'a nightly call behind a condition',
    /call the jobs for github.sha on every run/,
    (_, files) => {
      files[P].jobs['ios-native'].if = "${{ github.event_name == 'schedule' }}"
    }
  )
  rejected('a second nightly job', /holds only the jobs call/, (_, files) => {
    files[P].jobs.extra = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo' }] }
  })

  // IOS-02: least privilege.
  rejected(
    'contents: write on the jobs',
    /contents: read only, on every job/,
    (_, files) => {
      files[J].permissions = { contents: 'write' }
    }
  )
  rejected(
    'a called job with its own permissions',
    /contents: read only, on every job/,
    (jobs) => {
      jobs['ios-shard'].permissions = { contents: 'read', actions: 'write' }
    }
  )
  rejected(
    'contents: write on the nightly caller',
    /contents: read only, the trusted cache default/,
    (_, files) => {
      files[P].permissions = { contents: 'write' }
    }
  )

  // IOS-02: every job checks out the commit, then runs the exact shared proof.
  const proofJobs = [
    ...TEST_JOBS.map((name) => [
      name,
      (files) => files[J].jobs[name],
      '${{ inputs.sha }}',
    ]),
  ]
  for (const [name, job, commit] of proofJobs) {
    const pattern = new RegExp(`${name}: the second step must fail unless HEAD`)
    rejected(
      `${name} checking out the default ref`,
      new RegExp(`${name}: check out the commit under test`),
      (_, files) => {
        delete job(files).steps[0].with
      }
    )
    rejected(`${name} without the commit proof`, pattern, (_, files) => {
      job(files).steps.splice(1, 1)
    })
    rejected(`${name} proving another commit`, pattern, (_, files) => {
      job(files).steps[1].env.SHA =
        commit === '${{ github.sha }}' ? '${{ inputs.sha }}' : '${{ github.sha }}'
    })
    rejected(`${name} without the HEAD equality`, pattern, (_, files) => {
      job(files).steps[1].run = `${PROOF.split('\n')[0]}\n`
    })
    rejected(`${name} without the SHA syntax check`, pattern, (_, files) => {
      job(files).steps[1].run = `${PROOF.split('\n')[1]}\n`
    })
    rejected(`${name} with its proof in a here-document`, pattern, (_, files) => {
      job(files).steps[1].run = `cat <<'EOF'\n${PROOF}EOF\ntrue\n`
    })
    rejected(`${name} with its proof commented out`, pattern, (_, files) => {
      job(files).steps[1].run = PROOF.split('\n')
        .map((line) => (line ? `# ${line}` : line))
        .join('\n')
    })
    rejected(`${name} with a disabled proof`, pattern, (_, files) => {
      job(files).steps[1].if = 'false'
    })
    rejected(
      `${name} with a proof that may fail`,
      /failures must remain visible|second step must fail/,
      (_, files) => {
        job(files).steps[1]['continue-on-error'] = true
      }
    )
  }

  runnerAndXcodeFixtures()
  canaryFixtures()

  // IOS-02: each mandatory check exists once, on its own condition, and can fail its job.
  for (const [name, predicate, , required] of MANDATORY) {
    const label = (jobs) => {
      const row = jobs[name].steps.find(predicate)
      return row.name ?? row.id
    }
    const title = label(source[J].jobs)
    rejected(
      `"${title}" in ${name} disabled with if: false`,
      new RegExp(
        `${name}: "${title.replace(/[()]/g, '.')}" (has a condition that disables it|must exist once)`
      ),
      (jobs) => {
        jobs[name].steps.find(predicate).if = false
      }
    )
    rejected(
      `"${title}" in ${name} on a looser condition`,
      new RegExp(`${name}: ".*" must exist once`),
      (jobs) => {
        jobs[name].steps.find(predicate).if = 'always()'
      }
    )
    rejected(
      `"${title}" in ${name} removed`,
      new RegExp(`${name}: "a mandatory check" must exist once`),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter((row) => !predicate(row))
      }
    )
    rejected(
      `"${title}" in ${name} that ignores its status`,
      new RegExp(`${name}: ".*" must exist once`),
      (jobs) => {
        const row = jobs[name].steps.find(predicate)
        row.run = `${row.run}\ntrue\n`
      }
    )
    // IOS-R2-04: each required line commented out, with output that looks like success.
    for (const line of required)
      rejected(
        `"${title}" in ${name} with ${line.slice(0, 40)} commented out and a printf`,
        new RegExp(`${name}: ".*" does not execute`),
        (jobs) => {
          const row = jobs[name].steps.find(predicate)
          row.run = `${commentOut(row.run, line)}printf 'ok\\n'\n`
        }
      )
    if (required.some((line) => !line.startsWith('set ') && !line.startsWith('if ')))
      rejected(
        `"${title}" in ${name} inside an if block that never runs`,
        new RegExp(`${name}: ".*" does not execute`),
        (jobs) => {
          const row = jobs[name].steps.find(predicate)
          row.run = `if false; then\n${row.run}\nfi\n`
        }
      )
  }
  rejected(
    'the PNG guards without pipefail',
    /hides a failure in its pipeline/,
    (jobs) => {
      const row = step(jobs['ios-expo-go'], (item) => item.id === 'png_file_guards')
      row.run = row.run.replace('set -euo pipefail\n', 'set -eu\n')
    }
  )
  rejected('a mandatory check sent to the background', /does not execute/, (jobs) => {
    const row = step(jobs['ios-expo-go'], (item) => item.run?.includes('bridge-a11y.mjs'))
    row.run = 'node scripts/e2e-share-card/bridge-a11y.mjs &\n'
  })
  rejected('a job disabled with if: false', /the job's condition disables it/, (jobs) => {
    jobs['ios-app-build'].if = false
  })
  rejected(
    'a step disabled with if: ${{ false }}',
    /has a condition that disables it/,
    (jobs) => {
      step(
        jobs['ios-shard'],
        (row) => row.name === 'Select and scan closed evidence'
      ).if = '${{ false }}'
    }
  )

  // Shape.
  rejected(
    'a shard that waits on nothing',
    /ios-shard must need exactly ios-build/,
    (jobs) => {
      delete jobs['ios-shard'].needs
    }
  )
  rejected(
    'a shard without its run condition',
    /ios-shard must need exactly ios-build and run only after it succeeded/,
    (jobs) => {
      delete jobs['ios-shard'].if
    }
  )
  // ios-build runs on every event now, so a skipped build means nothing ran for the consumers.
  for (const name of ['ios-shard', 'ios-expo-go'])
    rejected(
      `${name} running after a skipped ios-build on a dispatch`,
      new RegExp(`${name} must need exactly ios-build and run only after it succeeded`),
      (jobs) => {
        jobs[name].if =
          "${{ !cancelled() && (needs.ios-build.result == 'success' || (github.event_name == 'workflow_dispatch' && needs.ios-build.result == 'skipped')) }}"
      }
    )
  rejected(
    'Expo Go after the shards',
    /ios-expo-go must need exactly ios-build/,
    (jobs) => {
      jobs['ios-expo-go'].needs = ['ios-build', 'ios-shard']
    }
  )
  rejected(
    'ios-build skipped on a dispatch',
    /ios-build starts every run, a dispatch included/,
    (jobs) => {
      jobs['ios-build'].if = "${{ github.event_name != 'workflow_dispatch' }}"
    }
  )
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
  // No consumer builds a client any more, so none needs the dispatch build time on its limit.
  for (const [name, limit] of [
    ['ios-shard', "${{ github.event_name == 'workflow_dispatch' && 110 || 70 }}"],
    ['ios-expo-go', "${{ github.event_name == 'workflow_dispatch' && 95 || 60 }}"],
    ['ios-build', 361],
  ])
    rejected(
      `${name} with a limit of ${limit}`,
      new RegExp(`${name}: limit must be a fixed number of minutes within the hosted`),
      (jobs) => {
        jobs[name]['timeout-minutes'] = limit
      }
    )
  rejected('a shard command without its shard', /receive its shard/, (jobs) => {
    const row = step(jobs['ios-shard'], (item) => item.run?.includes('--shard "$shard"'))
    row.run = row.run.replace('--shard "$shard"', '')
  })
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
      const rows = jobs['ios-build'].steps
      rows.splice(
        rows.findIndex((row) => row.id === 'app_scan'),
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
      const rows = jobs['ios-build'].steps
      rows.splice(
        rows.findIndex((row) => row.with?.['fail-on-cache-miss'] === true),
        1
      )
    }
  )

  // A dispatch: ios-build builds the commit's own client, saves no cache and hands the scanned
  // client to the consumers of its run.
  const handOff = (jobs) =>
    step(jobs['ios-build'], (row) => row.with?.name === CLIENT_ARTIFACT)
  rejected(
    'a dispatch that looks up the client main cached',
    /a dispatch always builds the commit's own client/,
    (jobs) => {
      step(jobs['ios-build'], (row) => row.id === 'native_cache').if =
        "${{ !cancelled() && steps.native_key.outcome == 'success' }}"
    }
  )
  rejected(
    'a dispatch that saves the client',
    /ios-build: "Save the scanned development client of this fingerprint" is reachable from a dispatch/,
    (jobs) => {
      step(jobs['ios-build'], (row) => row.id === 'native_save').if =
        "${{ !cancelled() && steps.app_scan.outcome == 'success' }}"
    }
  )
  rejected(
    'a dispatch that proves a saved key it never saved',
    /prove the saved key exists before the shards need it, except on a dispatch/,
    (jobs) => {
      step(jobs['ios-build'], (row) => row.with?.['fail-on-cache-miss'] === true).if =
        "${{ !cancelled() && steps.native_save.outcome == 'success' }}"
    }
  )
  rejected(
    'the client handed off on every event',
    /upload it once as ios-dev-client/,
    (jobs) => {
      handOff(jobs).if = "${{ !cancelled() && steps.client_pack.outcome == 'success' }}"
    }
  )
  rejected('the client packed before its scan', /after the scan/, (jobs) => {
    const rows = jobs['ios-build'].steps
    const [pack] = rows.splice(
      rows.findIndex((row) => row.id === 'client_pack'),
      1
    )
    rows.splice(
      rows.findIndex((row) => row.id === 'app_scan'),
      0,
      pack
    )
  })
  rejected('the client packed from another path', /after the scan/, (jobs) => {
    step(jobs['ios-build'], (row) => row.id === 'client_pack').env.APP = '/tmp/other.app'
  })
  rejected('a hand-off kept for a week', /kept for one day/, (jobs) => {
    handOff(jobs).with['retention-days'] = 7
  })
  rejected('a hand-off that may be missing', /kept for one day/, (jobs) => {
    handOff(jobs).with['if-no-files-found'] = 'warn'
  })
  rejected('two hand-offs', /upload it once as ios-dev-client/, (jobs) => {
    jobs['ios-build'].steps.push({ ...handOff(jobs) })
  })
  for (const name of ['ios-shard', 'ios-expo-go']) {
    rejected(
      `${name} restoring without failing on a miss`,
      new RegExp(`${name}: restore exactly the key ios-build resolved`),
      (jobs) => {
        delete step(jobs[name], (row) => row.with?.['fail-on-cache-miss'] === true).with[
          'fail-on-cache-miss'
        ]
      }
    )
    rejected(
      `${name} restoring on a dispatch`,
      new RegExp(
        `${name}: restore exactly the key ios-build resolved, fail on a miss, and skip it on a dispatch`
      ),
      (jobs) => {
        delete step(jobs[name], (row) => row.with?.['fail-on-cache-miss'] === true).if
      }
    )
    for (const [what, run] of [
      ['prebuild', 'node scripts/run-story68-native.mjs prebuild --platform ios'],
      ['build', 'node scripts/run-story68-native.mjs build --platform ios'],
      ['build-service window', 'node scripts/ci/native-build-daemons.mjs mark'],
    ])
      rejected(
        `${name} running its own client ${what}`,
        new RegExp(`${name}: install ios-build's scanned client; never build one`),
        (jobs) => {
          jobs[name].steps.splice(5, 0, {
            name: 'Build the client here',
            if: "github.event_name == 'workflow_dispatch'",
            run,
          })
        }
      )
    rejected(
      `${name} without the dispatch client download`,
      new RegExp(`${name}: on a dispatch, download ios-dev-client and unpack it`),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter(
          (row) => row.with?.name !== CLIENT_ARTIFACT
        )
      }
    )
    rejected(
      `${name} downloading the client on every event`,
      new RegExp(`${name}: on a dispatch, download ios-dev-client`),
      (jobs) => {
        delete step(jobs[name], (row) => row.with?.name === CLIENT_ARTIFACT).if
      }
    )
    rejected(
      `${name} unpacking the client at another path`,
      new RegExp(
        `${name}: on a dispatch, download ios-dev-client and unpack it at the path`
      ),
      (jobs) => {
        step(jobs[name], (row) => row.id === 'client_unpack').env.APP = '/tmp/other.app'
      }
    )
    rejected(
      `${name} unpacking the client after the flows start`,
      new RegExp(`${name}: on a dispatch, .* before the flows`),
      (jobs) => {
        const rows = jobs[name].steps
        const [unpack] = rows.splice(
          rows.findIndex((row) => row.id === 'client_unpack'),
          1
        )
        rows.splice(
          rows.findIndex((row) =>
            row.run?.includes('native-ios-startup-probe.mjs --for-native-flow')
          ) + 1,
          0,
          unpack
        )
      }
    )
    // C-16: the Xcode 26 client must fit the macos-15 iOS 18.5 runtime.
    const fits = (row) =>
      String(row.run ?? '').includes('node scripts/ci/native-ios-runtime-fits.mjs')
    rejected(
      `${name} without the client runtime check`,
      new RegExp(
        `${name}: check the client's MinimumOSVersion against the simulator runtime`
      ),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter((row) => !fits(row))
      }
    )
    rejected(
      `${name} checking the runtime only on a dispatch`,
      new RegExp(`${name}: check the client's MinimumOSVersion`),
      (jobs) => {
        step(jobs[name], fits).if = "github.event_name == 'workflow_dispatch'"
      }
    )
    rejected(
      `${name} checking the runtime after the flows start`,
      new RegExp(`${name}: check the client's MinimumOSVersion .* before the flows`),
      (jobs) => {
        const rows = jobs[name].steps
        const [check] = rows.splice(rows.findIndex(fits), 1)
        rows.push(check)
      }
    )
    rejected(
      `${name} downloading another artifact`,
      new RegExp(
        `${name}: download only the shard reports, or on a dispatch the scanned client`
      ),
      (jobs) => {
        jobs[name].steps.push({
          if: "github.event_name == 'workflow_dispatch'",
          uses: 'actions/download-artifact@v4',
          with: { name: 'share-card-ios-build', path: '/tmp/build' },
        })
      }
    )
  }
  rejected('the client as an artifact', /upload only closed evidence/, (jobs) => {
    jobs['ios-shard'].steps.push({
      if: 'always()',
      uses: 'actions/upload-artifact@v4',
      with: { name: 'client', path: '/tmp/cc68-ios-build', 'if-no-files-found': 'error' },
    })
  })
  rejected(
    'a shard downloading every artifact',
    /download only the shard reports, or on a dispatch the scanned client/,
    (jobs) => {
      jobs['ios-shard'].steps.push({ uses: 'actions/download-artifact@v4' })
    }
  )
  rejected(
    'the client uploaded from a shard on a dispatch',
    /ios-shard: upload only closed evidence/,
    (jobs) => {
      jobs['ios-shard'].steps.push({ ...handOff(jobs) })
    }
  )

  // Runtimes.
  for (const name of ['ios-build', 'ios-shard', 'ios-expo-go', LIVE_FONT_JOB]) {
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

// Story 6.15 AC3 on iOS: the live font-scale proof on the Release test build, nightly and on a
// manual dispatch only, failing its job on a nonzero driver exit and uploading its scanned proof.
describe('the iOS live font-scale proof', () => {
  const job = source[J].jobs[LIVE_FONT_JOB]
  const proof = step(job, (row) => row.id === 'live_font')
  const upload = step(job, (row) => row.with?.name === LIVE_FONT_ARTIFACT.name)

  test('runs only from the nightly and dispatch caller, never on a pull request or a merge', () => {
    assert.deepEqual(Object.keys(onOf(source[P])).sort(), [
      'schedule',
      'workflow_dispatch',
    ])
    assert.deepEqual(Object.keys(onOf(source[C])), ['schedule'])
    assert.deepEqual(Object.keys(onOf(source[J])), ['workflow_call'])
    assert.ok(MACOS_JOBS.includes(LIVE_FONT_JOB))
    assert.equal(job['runs-on'], 'macos-26')
    // The canary passes ios26-canary and skips the job; ios-native.yml never passes it.
    assert.equal(job.if, '${{ !inputs.ios26-canary }}')
    assert.equal(source[P].jobs['ios-native'].with['ios26-canary'], undefined)
    assert.equal(source[C].jobs['ios-native-canary'].with['ios26-canary'], true)
    assert.equal(job.needs, undefined)
  })

  test('has fixed limits: 180 minutes for the job, 45 for the build, 120 for the proof', () => {
    assert.equal(job['timeout-minutes'], 180)
    assert.equal(step(job, (row) => row.id === 'release_build')['timeout-minutes'], 45)
    assert.equal(proof['timeout-minutes'], 120)
  })

  test('runs the driver on the Release build of every screen, and its exit decides the job', () => {
    assert.deepEqual(LIVE_FONT_SCREENS, ['home', 'community', 'settings', 'composer'])
    assert.equal(
      LIVE_FONT_PROOF,
      'node scripts/run-live-font-proof.mjs --platform ios --device "$device" --build release --screens home,community,settings,composer --out "$RUNNER_TEMP/live-font-ios"'
    )
    const lines = proof.run.split('\n').map((line) => line.trim())
    // The last command is the driver, so its status is the step's.
    assert.equal(lines.filter(Boolean).at(-1), LIVE_FONT_PROOF)
    assert.equal(proof.if, undefined)
    assert.equal(proof['continue-on-error'], undefined)
    assert.equal(job['continue-on-error'], undefined)
    assert.equal(
      step(job, (row) => row.id === 'release_build').run,
      `${LIVE_FONT_RELEASE_BUILD}`
    )
    assert.ok(LIVE_FONT_INSTALL.endsWith(`--app ${IOS_RELEASE_APP}`))
  })

  test('the step fails when the driver exits nonzero, as bash -e runs it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-live-font-'))
    try {
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(path.join(bin, 'cat'), '#!/bin/sh\necho SIM-UDID\n', {
        mode: 0o755,
      })
      fs.writeFileSync(
        path.join(bin, 'node'),
        `#!/bin/sh\necho "$*" >> "${dir}/calls"\nexit "\${DRIVER_EXIT:-0}"\n`,
        { mode: 0o755 }
      )
      const runProof = (exit) =>
        spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', proof.run], {
          encoding: 'utf8',
          env: { PATH: bin, HOME: dir, RUNNER_TEMP: dir, DRIVER_EXIT: String(exit) },
        }).status
      assert.equal(runProof(0), 0)
      assert.equal(runProof(1), 1)
      const calls = fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n')
      assert.equal(
        calls[0],
        `scripts/run-live-font-proof.mjs --platform ios --device SIM-UDID --build release --screens home,community,settings,composer --out ${dir}/live-font-ios`
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('uploads the proof after its secret scan, on a pass or a failure, for a week', () => {
    assert.deepEqual(upload.with, {
      name: 'ios-live-font-proof',
      path: '${{ runner.temp }}/live-font-ios/',
      'retention-days': 7,
      'if-no-files-found': 'error',
    })
    assert.equal(
      upload.if,
      "${{ !cancelled() && steps.live_font_scan.outcome == 'success' }}"
    )
    const scan = step(job, (row) => row.id === 'live_font_scan')
    assert.equal(scan.run, LIVE_FONT_SCAN)
    assert.equal(scan.if, "${{ !cancelled() && steps.live_font.outcome != 'skipped' }}")
  })

  test('reuses ios-shard’s runtime steps unchanged', () => {
    const shard = source[J].jobs['ios-shard'].steps
    for (const name of [
      'Start the native Supabase stack',
      'Provision the local Storage buckets',
      'Prepare isolated UUID runtime and built renderer',
      'Report owned background service exits',
      'Select and scan closed evidence',
      'Stop the owned native Supabase stack',
    ])
      assert.deepEqual(
        step(job, (row) => row.name === name),
        shard.find((row) => row.name === name),
        name
      )
  })

  for (const [title, expected, change] of [
    [
      'a live font proof under the canary',
      /skip only under the canary/,
      (live) => {
        delete live.if
      },
    ],
    [
      'a live font proof that waits for ios-build',
      /start with the run, beside the builds/,
      (live) => {
        live.needs = 'ios-build'
      },
    ],
    [
      'a live font proof on a Debug build',
      /ios-live-font: ".*" does not execute: node scripts\/run-live-font-proof\.mjs/,
      (live) => {
        const row = step(live, (item) => item.id === 'live_font')
        row.run = row.run.replace(' --build release', ' --build debug')
      },
    ],
    [
      'a live font proof without --build',
      /ios-live-font: ".*" does not execute: node scripts\/run-live-font-proof\.mjs/,
      (live) => {
        const row = step(live, (item) => item.id === 'live_font')
        row.run = row.run.replace(' --build release', '')
      },
    ],
    [
      'a live font proof without the composer',
      /ios-live-font: ".*" does not execute: node scripts\/run-live-font-proof\.mjs/,
      (live) => {
        const row = step(live, (item) => item.id === 'live_font')
        row.run = row.run.replace(',composer', '')
      },
    ],
    [
      'a live font proof on Android',
      /ios-live-font: ".*" does not execute: node scripts\/run-live-font-proof\.mjs/,
      (live) => {
        const row = step(live, (item) => item.id === 'live_font')
        row.run = row.run.replace('--platform ios', '--platform android')
      },
    ],
    [
      'a live font proof whose exit is ignored',
      /ios-live-font: ".*" must exist once/,
      (live) => {
        const row = step(live, (item) => item.id === 'live_font')
        row.run = row.run.replace(
          'composer --out "$RUNNER_TEMP/live-font-ios"',
          'composer --out "$RUNNER_TEMP/live-font-ios" || true'
        )
      },
    ],
    [
      'a live font proof that may fail',
      /ios-live-font: failures must remain visible/,
      (live) => {
        step(live, (item) => item.id === 'live_font')['continue-on-error'] = true
      },
    ],
    [
      'a live font job that may fail',
      /ios-live-font: failures must remain visible/,
      (live) => {
        live['continue-on-error'] = true
      },
    ],
    [
      'a live font proof skipped on a dispatch',
      /ios-live-font: ".*" must exist once/,
      (live) => {
        step(live, (item) => item.id === 'live_font').if =
          "${{ github.event_name != 'workflow_dispatch' }}"
      },
    ],
    [
      'a live font proof without its own limit',
      /the proof needs its own limit, inside the job's/,
      (live) => {
        delete step(live, (item) => item.id === 'live_font')['timeout-minutes']
      },
    ],
    [
      'a live font proof longer than its job',
      /the proof needs its own limit, inside the job's/,
      (live) => {
        step(live, (item) => item.id === 'live_font')['timeout-minutes'] = 180
      },
    ],
    [
      'a live font job without a limit',
      /ios-live-font: limit must be a fixed number of minutes/,
      (live) => {
        delete live['timeout-minutes']
      },
    ],
    [
      'a live font proof of the Debug configuration',
      /ios-live-font: ".*" does not execute: node scripts\/run-story68-native\.mjs build/,
      (live) => {
        const row = step(live, (item) => item.id === 'release_build')
        row.run = row.run.replace('Release', 'Debug')
      },
    ],
    [
      'a live font proof that installs the development client',
      /ios-live-font: ".*" does not execute: node scripts\/ci\/native-ios-startup-probe\.mjs/,
      (live) => {
        const row = step(live, (item) =>
          item.run?.includes('native-ios-startup-probe.mjs')
        )
        row.run = 'node scripts/ci/native-ios-startup-probe.mjs --for-native-flow\n'
      },
    ],
    [
      'a live font proof on the restored development client',
      /never the development client/,
      (live) => {
        live.steps.splice(5, 0, {
          if: "github.event_name != 'workflow_dispatch'",
          uses: 'actions/cache/restore@v5.1.0',
          with: {
            path: '${{ needs.ios-build.outputs.app-path }}',
            key: '${{ needs.ios-build.outputs.app-key }}',
          },
        })
      },
    ],
    [
      'a live font proof run before sign-in',
      /prebuild, build the Release test build, install it, sign in, run the proof/,
      (live) => {
        const rows = live.steps
        const [signin] = rows.splice(
          rows.findIndex((row) => row.id === 'signin'),
          1
        )
        rows.splice(rows.findIndex((row) => row.id === 'live_font') + 1, 0, signin)
      },
    ],
    [
      'a live font proof uploaded before its scan',
      /scan it, then upload it/,
      (live) => {
        const rows = live.steps
        const [scan] = rows.splice(
          rows.findIndex((row) => row.id === 'live_font_scan'),
          1
        )
        rows.push(scan)
      },
    ],
    [
      'a live font proof without its upload',
      /upload the scanned proof once as ios-live-font-proof/,
      (live) => {
        live.steps = live.steps.filter(
          (row) => row.with?.name !== LIVE_FONT_ARTIFACT.name
        )
      },
    ],
    [
      'an unscanned live font proof uploaded on every outcome',
      /ios-live-font: upload only closed evidence/,
      (live) => {
        step(live, (item) => item.with?.name === LIVE_FONT_ARTIFACT.name).if = 'always()'
      },
    ],
    [
      'a live font proof kept for 90 days',
      /ios-live-font: upload only closed evidence/,
      (live) => {
        step(live, (item) => item.with?.name === LIVE_FONT_ARTIFACT.name).with[
          'retention-days'
        ] = 90
      },
    ],
    [
      'a live font proof that may be missing',
      /ios-live-font: upload only closed evidence/,
      (live) => {
        step(live, (item) => item.with?.name === LIVE_FONT_ARTIFACT.name).with[
          'if-no-files-found'
        ] = 'warn'
      },
    ],
    [
      'a live font proof without its secret scan',
      /ios-live-font: "a mandatory check" must exist once/,
      (live) => {
        live.steps = live.steps.filter((row) => row.id !== 'live_font_scan')
      },
    ],
  ])
    rejected(title, expected, (jobs) => change(jobs[LIVE_FONT_JOB]))
})

// IOS-R2-04 at the shell boundary: each mandatory step, run as GitHub runs it (bash -e) with
// every command it calls stubbed, passes when its checks pass and fails when any one fails.
describe('mandatory checks fail their step', () => {
  // The failing stub for each required line: [command, argument pattern, environment].
  const FAILS = {
    ['node scripts/ci/native-ios-app-secret-scan.mjs /tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app "$CC68_HARNESS_DIR"']:
      ['node', 'native-ios-app-secret-scan.mjs'],
    'test -n "$commands"': [null, null, { EMPTY_COMMANDS: '1' }],
    ['xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release -destination \'generic/platform=iOS Simulator\' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build']:
      ['xcodebuild', '-configuration Release'],
    'node scripts/ci/node-test-gate.mjs startup-deadline': [
      'node',
      'node-test-gate.mjs startup-deadline',
    ],
    'node scripts/ci/native-build-cache.mjs key --platform ios >> "$GITHUB_OUTPUT"': [
      'node',
      'native-build-cache.mjs key',
    ],
    'commands=$(node scripts/ci/native-ios-shards.mjs commands "$shard")': [
      'node',
      'native-ios-shards.mjs commands',
    ],
    'node scripts/run-story68-native.mjs "$command" --platform ios --device "$device" --shard "$shard"':
      ['node', 'run-story68-native.mjs share-sheet'],
    'node scripts/run-story68-native.mjs expo-go-proof --platform ios --device "$device"':
      ['node', 'expo-go-proof'],
    'node scripts/ci/node-test-gate.mjs share-card-plugins': [
      'node',
      'node-test-gate.mjs share-card-plugins',
    ],
    'node scripts/ci/node-test-gate.mjs native-harness': [
      'node',
      'node-test-gate.mjs native-harness',
    ],
    'node scripts/ci/maestro-check-flows.mjs': ['node', 'maestro-check-flows.mjs'],
    'node scripts/e2e-share-card/bridge-a11y.mjs': ['node', 'bridge-a11y.mjs'],
    'bash scripts/ci/share-card-header-semantics.sh': [
      'bash',
      'share-card-header-semantics.sh',
    ],
    'swift test --package-path apps/mobile/modules/share-card-photo-save/ios 2>&1 | tee "$RUNNER_TEMP/cc68-png-file-tests.log"':
      ['swift', 'test --package-path'],
    'bash scripts/ci/check-accessibility-focus-builds.sh ios-app "apps/mobile/ios/build/Build/Products/Release-iphonesimulator/$scheme.app/$scheme" apps/mobile/ios':
      ['bash', 'check-accessibility-focus-builds.sh ios-app'],
    'test "$CC68_SHARD_RESULT" = success': [null, null, { CC68_SHARD_RESULT: 'failure' }],
    'node scripts/ci/native-ios-shards.mjs merge /tmp/ios-shards': [
      'node',
      'native-ios-shards.mjs merge',
    ],
    'tar -C "$(dirname "$APP")" -cf "$RUNNER_TEMP/ios-client/client.tar" "$(basename "$APP")"':
      ['tar', '-cf'],
    'tar -C "$(dirname "$APP")" -xf "$RUNNER_TEMP/ios-client/client.tar"': ['tar', '-xf'],
    'test -d "$APP"': [null, null, { APP: '/nonexistent/CoutureCastStory68.app' }],
    'min=$(plutil -extract MinimumOSVersion raw "$APP/Info.plist")': [
      'plutil',
      'MinimumOSVersion',
    ],
    'sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)': [
      'xcrun',
      '--show-sdk-version',
    ],
    'node scripts/ci/native-ios-runtime-fits.mjs "$min" "$sdk"': [
      'node',
      'native-ios-runtime-fits.mjs',
    ],
    [LIVE_FONT_RELEASE_BUILD]: ['node', 'build --platform ios --configuration Release'],
    [LIVE_FONT_INSTALL]: ['node', 'native-ios-startup-probe.mjs'],
    'xcrun simctl launch "$device" com.couturecast.story68': ['xcrun', 'simctl launch'],
    'node scripts/run-story68-native.mjs signin --platform ios --device "$device"': [
      'node',
      'run-story68-native.mjs signin',
    ],
    [LIVE_FONT_PROOF]: ['node', 'run-live-font-proof.mjs'],
    [LIVE_FONT_SCAN]: ['node', 'native-ios-app-secret-scan.mjs'],
  }
  const RUN_AS_SCRIPT = ['node', 'bash', 'swift', 'xcodebuild', 'tar', 'plutil', 'xcrun']
  // The other commands the mandatory steps call, stubbed to succeed quietly.
  const QUIET = ['cat', 'mv', 'find', 'head', 'mkdir', 'rm', 'cp', 'sleep', 'npx', 'npm']
  const runStep = (body, [failing, pattern, env] = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-mandatory-'))
    try {
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(bin)
      for (const command of RUN_AS_SCRIPT) {
        const output =
          command === 'swift'
            ? 'echo "Executed 3 tests, with 0 failures"'
            : command === 'node'
              ? 'case " $* " in *"native-ios-shards.mjs commands"*) [ -n "$EMPTY_COMMANDS" ] || echo share-sheet;; esac'
              : ''
        const fail =
          command === failing ? `case " $* " in *"${pattern}"*) exit 1;; esac` : ''
        fs.writeFileSync(
          path.join(bin, command),
          `#!/bin/sh\n${fail}\n${output}\nexit 0\n`,
          { mode: 0o755 }
        )
      }
      for (const command of QUIET)
        fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      for (const tool of ['grep', 'tail', 'tee', 'dirname', 'basename'])
        fs.symlinkSync(
          spawnSync('/usr/bin/which', [tool], { encoding: 'utf8' }).stdout.trim(),
          path.join(bin, tool)
        )
      for (const file of ['env', 'output']) fs.writeFileSync(path.join(dir, file), '')
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', body], {
        encoding: 'utf8',
        env: {
          PATH: bin,
          HOME: dir,
          RUNNER_TEMP: dir,
          GITHUB_ENV: path.join(dir, 'env'),
          GITHUB_OUTPUT: path.join(dir, 'output'),
          CC68_SHARD_RESULT: 'success',
          APP: dir,
          ...env,
        },
      })
      return result.status
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  for (const [name, predicate, , required] of MANDATORY) {
    const row = source[J].jobs[name].steps.find(predicate)
    const lines = required.filter((line) => FAILS[line])
    if (!row.run || lines.length === 0) continue
    test(`${name}: "${row.name ?? row.id}" fails when its check fails`, () => {
      assert.equal(runStep(row.run), 0, 'every check passing')
      for (const line of lines) {
        assert.notEqual(runStep(row.run, FAILS[line]), 0, line)
      }
    })
  }

  test('every required line of a mandatory command has a failing stub here', () => {
    const lines = MANDATORY.flatMap(([, , , required]) => required).filter(
      (line) => !line.startsWith('set ') && !line.startsWith('if ')
    )
    assert.deepEqual(
      lines.filter((line) => !FAILS[line]),
      []
    )
  })
})

// No save is reachable on a dispatch, even before the read-only token refuses it.
describe('cache steps behind the read-only dispatch', () => {
  for (const job of ['ios-build', 'ios-shard', 'ios-expo-go'])
    for (const service of ['PostgreSQL', 'Redis', 'GoTrue', 'storage-api'])
      rejected(
        `${job} saving ${service} on a dispatch`,
        new RegExp(`${job}: "Save ${service}" is reachable from a dispatch`),
        (jobs) => {
          const row = step(jobs[job], (item) => item.name === `Save ${service}`)
          row.if = row.if.replace("github.event_name != 'workflow_dispatch' && ", '')
          delete jobs[job].if
        }
      )
  rejected(
    'a save guarded by an expression a dispatch can satisfy',
    /reachable from a dispatch/,
    (jobs) => {
      const row = step(jobs['ios-shard'], (item) => item.name === 'Save Redis')
      row.if = row.if.replace(
        "github.event_name != 'workflow_dispatch' &&",
        "(github.event_name != 'workflow_dispatch' || always()) &&"
      )
    }
  )
  rejected(
    'a combined restore-and-save cache step',
    /combined actions\/cache/,
    (jobs) => {
      jobs['ios-shard'].steps.push({
        uses: 'actions/cache@v4',
        with: { path: '/tmp/x', key: '${{ steps.native.outputs.redis-key }}' },
      })
    }
  )
  rejected('actions/cache older than 5.1', /actions\/cache 5.1 or later/, (jobs) => {
    step(jobs['ios-shard'], (item) => item.name === 'Restore Redis').uses =
      'actions/cache/restore@v4'
  })
  rejected('restore-keys on a restore', /no restore-keys/, (jobs) => {
    step(jobs['ios-shard'], (item) => item.name === 'Restore Redis').with[
      'restore-keys'
    ] = 'native-supabase-'
  })
  rejected(
    'a restore of a literal key',
    /restore only exact keys from a step output/,
    (jobs) => {
      step(
        jobs['ios-shard'],
        (row) => row.with?.key === '${{ needs.ios-build.outputs.app-key }}'
      ).with.key = 'cc68-native-ios-${{ github.sha }}'
    }
  )
  rejected(
    'a local action run on a dispatch',
    /local action runs the dispatched commit's own code/,
    (jobs) => {
      delete step(jobs['ios-shard'], (item) => item.uses === './.github/actions/install')
        .if
    }
  )
  rejected(
    'an npm download cache on a dispatch',
    /ios-app-build: .*setup-node.* caches on a dispatch/,
    (jobs) => {
      step(
        jobs['ios-app-build'],
        (item) => item.uses === 'actions/setup-node@v4'
      ).with.cache = 'npm'
    }
  )
  // Antigravity review of PR 224: a substring match let this cache on a dispatch.
  rejected(
    'an npm cache that the dispatch condition only seems to switch off',
    /ios-app-build: .*setup-node.* caches on a dispatch/,
    (jobs) => {
      step(
        jobs['ios-app-build'],
        (item) => item.uses === 'actions/setup-node@v4'
      ).with.cache = "${{ github.event_name != 'workflow_dispatch' || 'npm' }}"
    }
  )
  rejected(
    'setup-go with its default module cache',
    /ios-shard: .*setup-go.* caches on a dispatch/,
    (jobs) => {
      delete step(jobs['ios-shard'], (item) => item.uses === 'actions/setup-go@v5').with
        .cache
    }
  )

  test('the key scripts name keys under fixed prefixes', () => {
    const client = cacheKey({
      platform: 'ios',
      fingerprint: 'a'.repeat(40),
      harnessFiles: {},
      tools: {},
    })
    assert.match(client, new RegExp(`^cc68-native-ios-${CACHE_VERSION}-`))
    const keys = cacheOutputs({
      root: '/tmp/x',
      platform: 'darwin',
      arch: 'arm64',
      release: '24.6.0',
    })
      .filter((line) => line.includes('-key='))
      .map((line) => line.split('=')[1])
    assert.equal(keys.length, 4)
    for (const key of keys) assert.match(key, /^native-supabase-darwin24-arm64-/)
  })
})

describe('disabled conditions and neutralized checks', () => {
  test('a condition no run satisfies is disabled', () => {
    for (const condition of [
      false,
      0,
      '',
      'false',
      '${{ false }}',
      '${{ !always() }}',
      "${{ 0 && steps.a.outcome == 'success' }}",
      'null',
    ])
      assert.equal(disabledCondition(condition), true, String(condition))
    for (const condition of [
      undefined,
      'always()',
      '${{ !cancelled() }}',
      "steps.x.outputs.cache-hit != 'true'",
      "${{ github.event_name != 'workflow_dispatch' }}",
    ])
      assert.equal(disabledCondition(condition), false, String(condition))
  })

  test('a shell body that cannot fail is neutralized', () => {
    for (const run of [
      'bash x.sh || true',
      'bash x.sh\ntrue',
      "cat <<'EOF'\nbash x.sh\nEOF",
      'set +e\nbash x.sh',
      'bash x.sh || :',
      'exit 0',
    ])
      assert.equal(neutralizedRun(run), true, run)
    for (const run of [
      'bash x.sh',
      'count=$(grep x f || true)\ntest "$count" -gt 0',
      'echo "true"',
    ])
      assert.equal(neutralizedRun(run), false, run)
  })
})

// IOS-03 and C-13: every script, npm script, local action and reusable workflow they call exists.
describe('the helpers the workflows call', () => {
  test('every helper the committed workflows call exists at this commit', () => {
    assert.deepEqual(helperProblems(readWorkflows()), [])
  })

  test('npm calls name their script, workspace and flags', () => {
    assert.deepEqual(
      npmCalls(
        'npm run build --workspace api && npm run db:generate\nnpm test -- --x\nnpm run lint --if-present --workspace=web -w x'
      ),
      [
        { name: 'build', workspace: 'api' },
        { name: 'db:generate', workspace: null },
        { name: 'test', workspace: null },
        { name: 'lint', workspace: 'x', ifPresent: true },
      ]
    )
    assert.deepEqual(npmCalls('npm ci\nnpx expo prebuild'), [])
  })

  const tree = {
    'package.json': JSON.stringify({
      workspaces: ['apps/*'],
      scripts: {
        'build:all': 'npm run build --workspace web && npm run gone --workspace web',
      },
    }),
    'apps/web/package.json': JSON.stringify({
      name: 'web',
      scripts: { build: 'node scripts/build.mjs' },
    }),
    'apps/web/scripts/build.mjs': '',
    '.github/actions/outer/action.yml':
      'runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/inner\n    - run: bash "${{ github.action_path }}/../../../scripts/ci/here.sh"\n      shell: bash\n',
    'scripts/ci/here.sh': '',
  }
  const files = {
    read: (file) => tree[file] ?? null,
    exists: (file) => file in tree,
    list: (directory) => (directory === 'apps' ? ['web'] : []),
  }
  const workflow = (run, extra = {}) => ({
    'w.yml': { jobs: { a: { steps: [{ run, ...extra }] } } },
  })

  test('a missing root script is reported', () => {
    assert.deepEqual(helperProblems(workflow('npm run missing-ios-install'), files), [
      'w.yml a: npm run missing-ios-install is not a script in package.json',
    ])
  })

  test('a missing workspace script is reported, also behind a root script', () => {
    assert.deepEqual(helperProblems(workflow('npm run lint --workspace web'), files), [
      'w.yml a: npm run lint is not a script in apps/web/package.json',
    ])
    assert.deepEqual(helperProblems(workflow('npm run build:all'), files), [
      'package.json script build:all: npm run gone is not a script in apps/web/package.json',
    ])
    assert.deepEqual(helperProblems(workflow('npm run build -w nowhere'), files), [
      'w.yml a: npm workspace nowhere does not exist',
    ])
  })

  test('a script runs in its own workspace, and --if-present allows a missing one', () => {
    assert.deepEqual(helperProblems(workflow('npm run build --workspace web'), files), [])
    assert.deepEqual(
      helperProblems(
        workflow('npm run lint --if-present', { 'working-directory': 'apps/web' }),
        files
      ),
      []
    )
    assert.deepEqual(
      helperProblems(
        workflow('npm run build', { 'working-directory': 'apps/web' }),
        files
      ),
      []
    )
  })

  test('a missing nested local action is reported, and an action resolves its own paths', () => {
    assert.deepEqual(
      helperProblems(
        { 'w.yml': { jobs: { a: { steps: [{ uses: './.github/actions/outer' }] } } } },
        files
      ),
      [
        '.github/actions/outer/action.yml: missing local action .github/actions/inner/action.yml',
      ]
    )
  })

  test('a missing script or reusable workflow is reported', () => {
    assert.deepEqual(helperProblems(workflow('node scripts/ci/not-here.mjs'), files), [
      'w.yml a: missing helper scripts/ci/not-here.mjs',
    ])
    assert.deepEqual(
      helperProblems(
        { 'w.yml': { jobs: { a: { uses: './.github/workflows/gone.yml' } } } },
        files
      ),
      ['w.yml a: missing reusable workflow .github/workflows/gone.yml']
    )
  })
})

// IOS-02: the committed proof of every job, run against a fake git.
describe('the commit proof', () => {
  const run = (proof, head, sha) => {
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
  const jobs = TEST_JOBS.map((name) => [
    `ios-native-jobs.yml ${name}`,
    source[J].jobs[name],
  ])
  for (const [name, job] of jobs)
    test(`${name} passes only when HEAD is exactly the full commit named`, () => {
      const proof = job.steps[1]
      assert.equal(run(proof, head, head), 0)
      assert.notEqual(run(proof, head, 'b'.repeat(40)), 0, 'another commit checked out')
      assert.notEqual(run(proof, head, 'a'.repeat(7)), 0, 'a short SHA')
      assert.notEqual(run(proof, head, 'A'.repeat(40)), 0, 'uppercase')
      assert.notEqual(run(proof, head, 'main'), 0, 'a branch name')
      assert.notEqual(run(proof, head, ''), 0, 'nothing')
    })

  test('a proof in a here-document or comments would pass any commit, which the validator refuses', () => {
    const hidden = { run: `cat <<'EOF'\n${PROOF}EOF\ntrue\n` }
    assert.equal(run(hidden, head, 'b'.repeat(40)), 0)
    const commented = {
      run: PROOF.split('\n')
        .map((line) => (line ? `# ${line}` : line))
        .join('\n'),
    }
    assert.equal(run(commented, head, 'b'.repeat(40)), 0)
  })

  test('the run names carry the commit every job proves', () => {
    assert.equal(source[P]['run-name'], 'iOS native ${{ github.sha }}')
    for (const name of TEST_JOBS)
      assert.equal(source[J].jobs[name].steps[1].env.SHA, '${{ inputs.sha }}')
  })
})

describe('the Xcode selection', () => {
  const xcode = step(source[J].jobs['ios-build'], (row) => row.id === 'xcode')
  const select = (installed, choice, sdk) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-select-'))
    try {
      const bin = path.join(root, 'bin')
      fs.mkdirSync(bin)
      for (const [name, body] of Object.entries({
        sudo: 'exit 0',
        xcodebuild: 'echo Xcode',
        xcrun: `echo ${sdk}`,
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
          XCODE: choice,
          GITHUB_ENV: env,
        },
      }).status
      return { status, env: fs.readFileSync(env, 'utf8').replaceAll(root, '').trim() }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
  const everything = [
    'Xcode_16.4.app',
    'Xcode_26.3.app',
    'Xcode_26.4.app',
    'Xcode_26.10.app',
    'Xcode_26.4.1.app',
    'Xcode_27.0.app',
  ]

  test('26.4+ selects the newest Xcode 26.x at 26.4 or later and refuses older ones', () => {
    const picked = select(everything, '26.4+', '26.4')
    assert.equal(picked.status, 0)
    assert.equal(picked.env, 'DEVELOPER_DIR=/Xcode_26.10.app/Contents/Developer')
    assert.equal(
      select(['Xcode_26.4.app', 'Xcode_26.4.1.app'], '26.4+', '26.4').env,
      'DEVELOPER_DIR=/Xcode_26.4.1.app/Contents/Developer'
    )
    assert.notEqual(
      select(['Xcode_16.4.app', 'Xcode_26.3.app'], '26.4+', '26.4').status,
      0
    )
    assert.notEqual(select(['Xcode_27.0.app'], '26.4+', '26.4').status, 0)
    assert.notEqual(select([], '26.4+', '26.4').status, 0)
    assert.notEqual(select(everything, '26.4+', '18.5').status, 0, 'an iOS 18 SDK')
  })

  test('16.4 selects exactly Xcode 16.4 with the iOS 18.5 simulator SDK, or fails', () => {
    const picked = select(everything, '16.4', '18.5')
    assert.equal(picked.status, 0)
    assert.equal(picked.env, 'DEVELOPER_DIR=/Xcode_16.4.app/Contents/Developer')
    assert.notEqual(
      select(['Xcode_16.3.app', 'Xcode_26.4.app'], '16.4', '18.5').status,
      0
    )
    assert.notEqual(select(everything, '16.4', '18.4').status, 0, 'another SDK')
    assert.notEqual(select(everything, '16.4', '26.4').status, 0, 'an iOS 26 SDK')
    assert.notEqual(select(everything, '', '26.4').status, 0, 'no choice')
    assert.notEqual(select(everything, '15.4', '18.5').status, 0, 'an unknown choice')
  })

  test('every macOS job runs the same selection, with its own choice', () => {
    for (const [name, choice] of Object.entries(XCODE_CHOICES)) {
      const row = step(source[J].jobs[name], (item) => item.id === 'xcode')
      assert.equal(row.run, xcode.run, name)
      assert.deepEqual(row.env, { XCODE: choice }, name)
    }
  })
})

// TEA, 2026-11-13 (Antigravity r7): the canary starts only after every chain of the nightly run
// can have ended at its timeouts (ios-live-font alone; ios-build, then the longer of ios-shard
// and ios-expo-go), measured as the cyclic gap from the nightly start, so a schedule across UTC
// midnight is judged right too.
const minutesOfDay = (cron) => {
  const [minute, hour] = cron.split(' ').map(Number)
  return hour * 60 + minute
}
const cyclicGap = (from, to) => (((to - from) % 1440) + 1440) % 1440

test('the iOS canary starts after every nightly job chain can have ended', () => {
  const read = (file) => parse(fs.readFileSync(`.github/workflows/${file}`, 'utf8'))
  const cronOf = (workflow) => (workflow.on ?? workflow[true]).schedule[0].cron
  const jobs = read('ios-native-jobs.yml').jobs
  const timeout = (id) => {
    const value = jobs[id]?.['timeout-minutes']
    assert.ok(Number.isInteger(value) && value > 0, `${id} has a timeout`)
    return value
  }
  const longest = Math.max(
    timeout('ios-live-font'),
    timeout('ios-build') + Math.max(timeout('ios-shard'), timeout('ios-expo-go'))
  )
  const gap = cyclicGap(
    minutesOfDay(cronOf(read('ios-native.yml'))),
    minutesOfDay(cronOf(read('ios-native-canary.yml')))
  )
  assert.ok(
    gap >= longest,
    `the canary starts ${gap} min after the nightly; chains need ${longest}`
  )
})

test('the cyclic gap wraps across UTC midnight', () => {
  assert.equal(cyclicGap(minutesOfDay('23 3 * * *'), minutesOfDay('37 6 * * *')), 194)
  assert.equal(cyclicGap(minutesOfDay('0 23 * * *'), minutesOfDay('30 1 * * *')), 150)
  assert.equal(cyclicGap(minutesOfDay('30 1 * * *'), minutesOfDay('0 23 * * *')), 1290)
})
