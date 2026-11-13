// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 D6, C-13 and IOS-01/02/03: the iOS jobs run off the pull request path, from
// ios-native.yml on a merge and nightly and from ios-native-dispatch.yml for a commit that has not
// merged, with a read-only cache. Each control below breaks one rule and must be rejected, each by
// its own predicate; the committed workflows must pass all of them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  helperProblems,
  inputCoverageProblems,
  npmCalls,
  scriptReads,
} from './ios-native-helpers.mjs'
import {
  CLIENT_ARTIFACT,
  DISPATCH_WORKFLOW,
  JOBS_WORKFLOW,
  MANDATORY,
  PROOF,
  PUSH_WORKFLOW,
  RUNNERS,
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
const P = PUSH_WORKFLOW
const D = DISPATCH_WORKFLOW
const J = JOBS_WORKFLOW
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
    const label = choice === '16.4' ? '16.4' : '26.4 or later'
    const other = { 'macos-26': 'macos-15', 'macos-15': 'macos-26' }[RUNNERS[name]]
    rejected(
      `${name} on ${other}`,
      new RegExp(`${name}: ${RUNNERS[name]} runner required`),
      (jobs) => {
        jobs[name]['runs-on'] = other
      }
    )
    rejected(
      `${name} on the image default Xcode`,
      new RegExp(`${name}: select Xcode ${label} by name`),
      (jobs) => {
        jobs[name].steps = jobs[name].steps.filter((row) => row.id !== 'xcode')
      }
    )
    rejected(
      `${name} choosing the other Xcode`,
      new RegExp(`${name}: select Xcode ${label} by name`),
      (jobs) => {
        step(jobs[name], (item) => item.id === 'xcode').env.XCODE =
          choice === '16.4' ? '26.4+' : '16.4'
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
    assert.equal(source[D].jobs['ios-native'].uses, `./${J}`)
  })

  // Triggers and the commit a run tests.
  for (const file of [P, D, J]) {
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
  rejected(
    'a dispatch trigger on ios-native.yml',
    /only on a merge to main and nightly/,
    (_, files) => {
      onOf(files[P]).workflow_dispatch = {
        inputs: { sha: { required: true, type: 'string' } },
      }
    }
  )
  rejected(
    'an unfiltered merge trigger',
    /filtered by its native iOS inputs/,
    (_, files) => {
      delete onOf(files[P]).push.paths
    }
  )
  rejected(
    'a merge filter without the jobs file',
    /filtered by its native iOS inputs/,
    (_, files) => {
      onOf(files[P]).push.paths = onOf(files[P]).push.paths.filter((glob) => glob !== J)
    }
  )
  rejected('no nightly run', /one nightly schedule/, (_, files) => {
    delete onOf(files[P]).schedule
  })
  // IOS-02: five valid cron fields alone also accept a yearly run.
  for (const cron of ['23 3 1 1 *', '23 3 * * 1', '*/5 * * * *', '23 3 */2 * *'])
    rejected(`a schedule of ${cron}`, /one nightly schedule/, (_, files) => {
      onOf(files[P]).schedule = [{ cron }]
    })
  rejected('an optional sha', /required sha input/, (_, files) => {
    onOf(files[D]).workflow_dispatch.inputs.sha.required = false
  })
  rejected('a second dispatch input', /exactly one commit/, (_, files) => {
    onOf(files[D]).workflow_dispatch.inputs.ref = { type: 'string', required: false }
  })
  rejected(
    'a dispatch run name without the commit',
    /run name must be "iOS native \$\{\{ inputs.sha/,
    (_, files) => {
      files[D]['run-name'] = 'iOS native'
    }
  )
  rejected(
    'a merge run name without the commit',
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

  // IOS-01: a dispatch runs a commit that has not merged, so GitHub must hand every job a
  // read-only cache token.
  rejected(
    'a dispatch without a workflow cache-mode',
    /cache-mode: read on the workflow and on every job/,
    (_, files) => {
      delete files[D]['cache-mode']
    }
  )
  for (const job of ['ios-native', 'ios-cache-proof']) {
    rejected(
      `a dispatch job ${job} without its cache-mode`,
      /cache-mode: read on the workflow and on every job/,
      (_, files) => {
        delete files[D].jobs[job]['cache-mode']
      }
    )
    rejected(
      `a dispatch job ${job} with write access`,
      /cache-mode: read on the workflow and on every job/,
      (_, files) => {
        files[D].jobs[job]['cache-mode'] = 'write'
      }
    )
  }
  rejected(
    'a third dispatch job that writes',
    /cache-mode: read on the workflow and on every job/,
    (_, files) => {
      files[D].jobs.extra = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo' }] }
    }
  )
  rejected('a cache-mode in the jobs file', /declares no cache-mode/, (_, files) => {
    files[J]['cache-mode'] = 'write'
  })
  rejected('a cache-mode on one called job', /declares no cache-mode/, (jobs) => {
    jobs['ios-build']['cache-mode'] = 'write'
  })
  rejected(
    'a merge caller that limits the cache',
    /contents: read only, the trusted cache default/,
    (_, files) => {
      files[P]['cache-mode'] = 'read'
    }
  )
  rejected(
    'a dispatch that calls the jobs for another commit',
    /call the jobs for inputs.sha/,
    (_, files) => {
      files[D].jobs['ios-native'].with.sha = '${{ github.sha }}'
    }
  )
  rejected(
    'a merge that calls the jobs for another commit',
    /call the jobs for github.sha/,
    (_, files) => {
      files[P].jobs['ios-native'].with.sha = '${{ github.event.before }}'
    }
  )
  rejected(
    'the merge call skipping a nightly run on ios-changes',
    /skipping only a merge/,
    (_, files) => {
      files[P].jobs['ios-native'].if = "${{ needs.ios-changes.outputs.run == 'true' }}"
    }
  )
  rejected(
    'ios-changes without the commit before the merge',
    /ios-changes: decide from/,
    (_, files) => {
      delete step(files[P].jobs['ios-changes'], (row) => row.id === 'changes').env.BEFORE
    }
  )
  rejected(
    'ios-changes deciding from another script',
    /ios-changes: decide from/,
    (_, files) => {
      step(files[P].jobs['ios-changes'], (row) => row.id === 'changes').run =
        'echo run=true >> "$GITHUB_OUTPUT"'
    }
  )

  // IOS-01: ios-cache-proof stands for the read-only token on every dispatch.
  rejected('no cache proof', /holds the jobs call and ios-cache-proof/, (_, files) => {
    delete files[D].jobs['ios-cache-proof']
  })
  rejected(
    'a cache proof that checks out the commit',
    /ios-cache-proof: actions: read only, no checkout/,
    (_, files) => {
      files[D].jobs['ios-cache-proof'].steps.unshift({ uses: 'actions/checkout@v4' })
    }
  )
  rejected(
    'a cache proof that may write',
    /ios-cache-proof: actions: read only/,
    (_, files) => {
      files[D].jobs['ios-cache-proof'].permissions = { actions: 'write' }
    }
  )
  rejected(
    'a cache proof that never lists the entries after',
    /then fail if any probe entry exists/,
    (_, files) => {
      files[D].jobs['ios-cache-proof'].steps[3].run = 'echo done'
    }
  )
  rejected(
    'a cache proof whose API write cannot fail it',
    /then fail if any probe entry exists/,
    (_, files) => {
      const api = files[D].jobs['ios-cache-proof'].steps[2]
      api.with.script = api.with.script.replace(
        "core.setFailed('The cache service reserved",
        "core.info('The cache service reserved"
      )
    }
  )
  rejected(
    'a cache proof that tries no save',
    /then fail if any probe entry exists/,
    (_, files) => {
      files[D].jobs['ios-cache-proof'].steps[1].uses = 'actions/cache/restore@v5.1.0'
    }
  )
  rejected(
    'a cache proof step that ignores its failure',
    /ios-cache-proof: ".*" must run and be able to fail/,
    (_, files) => {
      files[D].jobs['ios-cache-proof'].steps[3].run += '\ntrue\n'
    }
  )

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
    'contents: write on the dispatch',
    /call the jobs for inputs.sha with contents: read only/,
    (_, files) => {
      files[D].permissions = { contents: 'write' }
    }
  )
  rejected(
    'actions: write on the dispatch call',
    /call the jobs for inputs.sha with contents: read only/,
    (_, files) => {
      files[D].jobs['ios-native'].permissions = { actions: 'write', contents: 'read' }
    }
  )
  rejected(
    'contents: write on the merge caller',
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
    [
      'ios-native.yml ios-changes',
      (files) => files[P].jobs['ios-changes'],
      '${{ github.sha }}',
    ],
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
  }
  const RUN_AS_SCRIPT = ['node', 'bash', 'swift', 'xcodebuild', 'tar']
  // The other commands the mandatory steps call, stubbed to succeed quietly.
  const QUIET = [
    'cat',
    'mv',
    'find',
    'head',
    'xcrun',
    'mkdir',
    'rm',
    'cp',
    'sleep',
    'npx',
    'npm',
  ]
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

// SL-11: the push paths are the native iOS inputs of the merge trigger and the pull request gate,
// so they must cover every script the iOS jobs run or read, and name no scripts/lib file they do
// not read, or a shared helper change would cost a pull request a 75-minute dispatch.
describe('the native iOS inputs cover what the iOS jobs read', () => {
  const libraryFiles = fs.readdirSync('scripts/lib').map((name) => `scripts/lib/${name}`)
  const reads = scriptReads(source[J])
  const coverage = (workflow) => inputCoverageProblems(workflow, { reads, libraryFiles })

  test('every script the iOS jobs read is a push path, and every scripts/lib push path is read', () => {
    assert.deepEqual(coverage(source[P]), [])
    assert.ok(reads.includes('scripts/run-story68-native.mjs'))
    assert.ok(reads.includes('scripts/lib/story68-native-build.mjs'))
    assert.ok(
      reads.includes('scripts/ci/install-dependencies.sh'),
      'a local action’s script'
    )
    assert.ok(!reads.some((file) => file.endsWith('.test.mjs')))
  })

  test('a missing script is reported', () => {
    const files = fresh()
    onOf(files[P]).push.paths = onOf(files[P]).push.paths.filter(
      (glob) => glob !== 'scripts/e2e-real-session/**'
    )
    assert.ok(
      coverage(files[P]).includes(
        'the push paths miss scripts/e2e-real-session/run.mjs, which the iOS jobs read'
      )
    )
  })

  test('scripts/lib as a whole is reported for the helpers no iOS job reads', () => {
    const files = fresh()
    onOf(files[P]).push.paths.splice(-1, 0, 'scripts/lib/**')
    const problems = coverage(files[P])
    assert.ok(
      problems.some((problem) => /name scripts\/lib\/community-/.test(problem)),
      problems.join('\n')
    )
  })

  test('the reads follow imports, scripts named by path, and a local action’s nested actions', () => {
    const tree = {
      '.github/actions/outer/action.yml':
        'runs:\n  steps:\n    - uses: ./.github/actions/inner\n',
      '.github/actions/inner/action.yml': 'run: bash scripts/ci/inner.sh\n',
      'scripts/a.mjs': "import x from './lib/b.mjs'\nspawn('node', ['scripts/c.mjs'])\n",
      'scripts/lib/b.mjs': "import t from './b.test.mjs'\n",
      'scripts/lib/b.test.mjs': "import u from './unreached.mjs'\n",
      'scripts/lib/unreached.mjs': '',
      'scripts/c.mjs': "path.join(dir, 'sibling.mjs')\n",
      'scripts/sibling.mjs': '',
      'scripts/ci/inner.sh': '',
      'scripts/d.json': '["scripts/data-only.mjs"]',
      'scripts/data-only.mjs': '',
    }
    const workflow = {
      jobs: {
        'ios-build': {
          steps: [
            { run: 'node scripts/a.mjs && cat scripts/d.json' },
            { uses: './.github/actions/outer' },
          ],
        },
      },
    }
    assert.deepEqual(
      scriptReads(workflow, {
        read: (file) => tree[file] ?? null,
        exists: (file) => file in tree,
      }),
      [
        'scripts/a.mjs',
        'scripts/c.mjs',
        'scripts/ci/inner.sh',
        'scripts/d.json',
        'scripts/lib/b.mjs',
        'scripts/sibling.mjs',
      ]
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
  const jobs = [
    ...TEST_JOBS.map((name) => [`ios-native-jobs.yml ${name}`, source[J].jobs[name]]),
    ['ios-native.yml ios-changes', source[P].jobs['ios-changes']],
  ]
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
    assert.equal(source[D]['run-name'], 'iOS native ${{ inputs.sha }}')
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
