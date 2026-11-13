// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15: one question two iOS skips share (scripts/ci/ios-native-inputs.mjs passingRun): has
// an iOS run on main already passed on this commit? A dispatch of such a commit fails in
// ios-dispatch-gate, naming the run, and the nightly run skips it. Both are skips, so each fixture
// below that is not a whole pass, or cannot be read, must answer no and let the iOS jobs run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  DISPATCH_FILE,
  REPO,
  SHA,
  iosJobs,
  iosRun,
  runsApi,
} from './fixtures/ios-runs-github.mjs'
import {
  IOS_DISPATCH_WORKFLOW,
  IOS_JOBS_WORKFLOW,
  IOS_NATIVE_WORKFLOW,
  dispatchGate,
  passingRun,
  pushChanges,
  runJobs,
  runJobsPassed,
} from './ios-native-inputs.mjs'

const passing = (kind, patch = {}) => {
  const run = iosRun(kind, patch)
  return { run, jobs: { [run.id]: iosJobs(kind) } }
}
const find = (runs, jobs, extra = {}) =>
  passingRun({
    repository: REPO,
    sha: SHA,
    token: 'token',
    fetchImpl: runsApi({ runs, jobs, ...extra }).fetchImpl,
  })

describe('a passing iOS run on main for a commit', () => {
  for (const kind of ['push', 'schedule', 'dispatch'])
    test(`a ${kind} run whose every job passed counts`, async () => {
      const { run, jobs } = passing(kind)
      assert.equal((await find([run], jobs))?.id, run.id)
    })

  test('a merge run that ios-changes stopped (run=false) never counts', async () => {
    const run = iosRun('push')
    const jobs = {
      [run.id]: [
        { name: 'ios-changes', conclusion: 'success' },
        { name: 'ios-native', conclusion: 'skipped' },
      ],
    }
    assert.equal(await find([run], jobs), null)
  })

  // RUNS-03: the required jobs come from main's workflow files, every matrix instance included.
  test("the required jobs are main's workflow files, each shard included", async () => {
    const { requiredJobs } = await import('./ios-native-inputs.mjs')
    const called = [
      'ios-native / ios-build',
      'ios-native / ios-shard (1)',
      'ios-native / ios-shard (2)',
      'ios-native / ios-shard (3)',
      'ios-native / ios-shard (4)',
      'ios-native / ios-expo-go',
      'ios-native / iOS app build',
      'ios-native / ios-evidence',
    ]
    const read = (file) => fs.readFileSync(file, 'utf8')
    assert.deepEqual(
      requiredJobs(read(IOS_NATIVE_WORKFLOW), read(IOS_JOBS_WORKFLOW)).sort(),
      ['ios-changes', ...called].sort()
    )
    assert.deepEqual(
      requiredJobs(read(IOS_DISPATCH_WORKFLOW), read(IOS_JOBS_WORKFLOW)).sort(),
      ['ios-cache-proof', 'ios-dispatch-gate', ...called].sort()
    )
    // The same jobs a YAML parser reads, the matrix included.
    const jobs = parse(read(IOS_JOBS_WORKFLOW)).jobs
    assert.deepEqual(jobs['ios-shard'].strategy.matrix.shard, [1, 2, 3, 4])
  })

  test('a matrix this reader cannot list throws, so each caller fails closed', async () => {
    const { requiredJobs } = await import('./ios-native-inputs.mjs')
    const caller =
      'jobs:\n  ios-native:\n    uses: ./.github/workflows/ios-native-jobs.yml\n'
    for (const matrix of [
      '        include:\n          - shard: 1\n',
      '        shard: ${{ fromJSON(inputs.shards) }}\n',
    ])
      assert.throws(
        () =>
          requiredJobs(
            caller,
            `jobs:\n  ios-shard:\n    strategy:\n      matrix:\n${matrix}    runs-on: macos-15\n`
          ),
        /cannot list/
      )
    assert.throws(() => requiredJobs('jobs:\n  other:\n    runs-on: x\n', ''), /calls/)
  })

  test('a run missing one required job never counts', async () => {
    for (const [kind, missing] of [
      ['dispatch', 'ios-native / ios-shard (3)'],
      ['dispatch', 'ios-cache-proof'],
      ['dispatch', 'ios-dispatch-gate'],
      ['push', 'ios-changes'],
      ['push', 'ios-native / ios-shard (2)'],
      ['schedule', 'ios-native / ios-build'],
    ]) {
      const run = iosRun(kind)
      const jobs = iosJobs(kind).filter((job) => job.name !== missing)
      assert.equal(
        await find([run], { [run.id]: jobs }),
        null,
        `${kind} without ${missing}`
      )
    }
  })

  // A run from before a matrix change shows another shard count: the predicate fails, which
  // only costs a rerun.
  test('a run from before a matrix change never counts', async () => {
    const run = iosRun('push')
    const jobs = iosJobs('push').filter(
      (job) => job.name !== 'ios-native / ios-shard (4)'
    )
    assert.equal(await find([run], { [run.id]: jobs }), null)
  })

  test('a skipped, cancelled, failed or missing job never counts', async () => {
    const broken = {
      push: [
        { 'ios-native / ios-build': { conclusion: 'skipped' } },
        { 'ios-native / ios-shard (3)': { conclusion: 'cancelled' } },
        { 'ios-native / ios-expo-go': { conclusion: 'failure' } },
        { 'ios-changes': { conclusion: 'skipped' } },
        { 'ios-native / ios-evidence': { conclusion: null, status: 'in_progress' } },
      ],
      dispatch: [
        { 'ios-native / ios-shard (1)': { conclusion: 'skipped' } },
        { 'ios-native / iOS app build': { conclusion: 'cancelled' } },
        { 'ios-dispatch-gate': { conclusion: 'failure' } },
        { 'ios-cache-proof': { conclusion: 'skipped' } },
      ],
    }
    for (const [kind, patches] of Object.entries(broken))
      for (const patch of patches) {
        const run = iosRun(kind)
        assert.equal(
          await find([run], { [run.id]: iosJobs(kind, patch) }),
          null,
          `${kind} ${JSON.stringify(patch)}`
        )
      }
    for (const kind of ['push', 'dispatch']) {
      const run = iosRun(kind)
      const jobs = iosJobs(kind).filter((job) => job.name !== 'ios-native / ios-evidence')
      assert.equal(
        await find([run], { [run.id]: jobs }),
        null,
        `${kind} without ios-evidence`
      )
    }
    assert.equal(runJobsPassed([], []), false)
    assert.equal(runJobsPassed([], ['ios-changes']), false)
  })

  test('a cancelled run, another commit, branch, repository or workflow never counts', async () => {
    const others = [
      iosRun('push', { conclusion: 'cancelled' }),
      iosRun('push', { conclusion: 'failure' }),
      iosRun('push', { status: 'in_progress', conclusion: null }),
      iosRun('push', { head_sha: 'b'.repeat(40) }),
      iosRun('schedule', { head_branch: 'feat/x' }),
      iosRun('push', { head_repository: { full_name: 'fork/r' } }),
      iosRun('push', { event: 'workflow_dispatch' }),
      iosRun('dispatch', { display_title: `iOS native ${'b'.repeat(40)}` }),
      iosRun('dispatch', { head_branch: 'feat/x' }),
      iosRun('dispatch', { event: 'push' }),
      iosRun('dispatch', { path: '.github/workflows/pr-mobile-e2e.yml' }),
    ]
    const jobs = Object.fromEntries(
      others.map((run) => [
        run.id,
        iosJobs(run.path === DISPATCH_FILE ? 'dispatch' : 'push'),
      ])
    )
    // The listing ignores its query here, so the reader's own checks reject each one.
    assert.equal(await find(others, jobs, { loose: true }), null)
  })

  test('the jobs are read across pages: a failure on page two never counts', async () => {
    const shards = Array.from(
      { length: 100 },
      (_, index) => `ios-native / ios-shard (${index + 5})`
    )
    const run = iosRun('push')
    const failing = iosJobs(
      'push',
      { [shards.at(-1)]: { conclusion: 'failure' } },
      shards
    )
    assert.ok(failing.length > 100)
    const api = runsApi({ runs: [run], jobs: { [run.id]: failing } })
    assert.equal(
      await passingRun({
        repository: REPO,
        sha: SHA,
        token: 't',
        fetchImpl: api.fetchImpl,
      }),
      null
    )
    assert.ok(api.requested.some((request) => /\/jobs\?.*page=2/.test(request)))
    assert.equal(
      (await find([run], { [run.id]: iosJobs('push', {}, shards) }))?.id,
      run.id
    )
  })

  // The pages together hold fewer jobs than total_count: a lost job could be one that failed.
  test('a jobs listing shorter than its total_count throws', async () => {
    const { run, jobs } = passing('push')
    const totals = { [run.id]: jobs[run.id].length + 1 }
    const api = runsApi({ runs: [run], jobs, totals })
    await assert.rejects(
      runJobs({ repository: REPO, id: run.id, token: 't', fetchImpl: api.fetchImpl }),
      new RegExp(`run ${run.id} listed ${jobs[run.id].length} of ${totals[run.id]} jobs`)
    )
    await assert.rejects(find([run], jobs, { totals }), /listed \d+ of \d+ jobs/)
  })

  test('the newest passing run is the one named', async () => {
    const older = passing('push', { created_at: '2026-11-13T08:00:00Z' })
    const newer = passing('dispatch', { created_at: '2026-11-13T12:00:00Z' })
    assert.equal(
      (await find([older.run, newer.run], { ...older.jobs, ...newer.jobs }))?.id,
      newer.run.id
    )
  })

  test('a read error throws, for each caller to run the iOS jobs', async () => {
    const { run, jobs } = passing('push')
    for (const deny of [
      /\/workflows\/ios-native\.yml\/runs$/,
      /\/workflows\/ios-native-dispatch\.yml\/runs$/,
      /\/commits\//,
      /\/jobs$/,
    ])
      await assert.rejects(
        find([run], jobs, { deny: [deny] }),
        /answered 403/,
        String(deny)
      )
  })
})

// Both callers run the iOS jobs unless a whole pass is found: a passing run whose jobs listing is
// shorter than its total_count is no whole pass.
const shortListing = () => {
  const { run, jobs } = passing('push')
  return runsApi({ runs: [run], jobs, totals: { [run.id]: jobs[run.id].length + 1 } })
}
const env = { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'token', SHA }
const quietly = async (t, body) => {
  const lines = []
  t.mock.method(console, 'log', (line) => lines.push(String(line)))
  return { result: await body(), lines }
}

describe('ios-dispatch-gate', () => {
  test('its sparse checkout of main holds every module the gate imports, and nothing installs', () => {
    const gate = parse(fs.readFileSync(IOS_DISPATCH_WORKFLOW, 'utf8')).jobs[
      'ios-dispatch-gate'
    ]
    const sparse = gate.steps[0].with['sparse-checkout'].trim().split('\n')
    const imported = new Set(['scripts/ci/ios-native-inputs.mjs'])
    for (const file of imported)
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from '(\.\/[\w.-]+)'/g))
        imported.add(path.posix.join('scripts/ci', match[1]))
    for (const file of imported) assert.ok(sparse.includes(`/${file}`), file)
    assert.ok(sparse.includes('/.nvmrc'))
    // runGraphs reads the three workflow files from main's checkout.
    for (const file of [IOS_NATIVE_WORKFLOW, IOS_DISPATCH_WORKFLOW, IOS_JOBS_WORKFLOW])
      assert.ok(sparse.includes(`/${file}`), file)
    assert.ok(!gate.steps.some((row) => /npm (ci|install)/.test(row.run ?? '')))
  })

  test('a commit with a passing run stops the dispatch, naming that run', async (t) => {
    const { run, jobs } = passing('push')
    const { result, lines } = await quietly(t, () =>
      dispatchGate({ env, fetchImpl: runsApi({ runs: [run], jobs }).fetchImpl })
    )
    assert.equal(result, false)
    assert.ok(
      lines.some((line) => line.startsWith('::error::') && line.includes(run.html_url))
    )
  })

  test('no passing run, or a read error, lets the dispatch run', async (t) => {
    const stopped = iosRun('push')
    const fixtures = [
      runsApi(),
      runsApi({
        runs: [stopped],
        jobs: {
          [stopped.id]: iosJobs('push', {
            'ios-native / ios-build': { conclusion: 'skipped' },
          }),
        },
      }),
      runsApi({ runs: [stopped], deny: [/\/jobs$/] }),
      shortListing(),
    ]
    for (const api of fixtures) {
      const { result } = await quietly(t, () =>
        dispatchGate({ env, fetchImpl: api.fetchImpl })
      )
      assert.equal(result, true)
    }
  })
})

describe('the nightly decision', () => {
  const nightly = (t, api) =>
    quietly(t, () =>
      pushChanges({
        env: { ...env, EVENT: 'schedule' },
        fetchImpl: api.fetchImpl,
        run: () => {
          throw new Error('the nightly run reads no diff')
        },
      })
    )

  test('a commit with a passing merge, nightly or dispatch run skips the nightly run', async (t) => {
    for (const kind of ['push', 'schedule', 'dispatch']) {
      const { run, jobs } = passing(kind)
      const { result, lines } = await nightly(t, runsApi({ runs: [run], jobs }))
      assert.equal(result, false, kind)
      assert.ok(
        lines.some((line) => line.includes(run.html_url)),
        kind
      )
    }
  })

  test('no passing run, a stopped merge run, or a read error runs it', async (t) => {
    const stopped = iosRun('push')
    for (const api of [
      runsApi(),
      runsApi({
        runs: [stopped],
        jobs: {
          [stopped.id]: [
            { name: 'ios-changes', conclusion: 'success' },
            { name: 'ios-native', conclusion: 'skipped' },
          ],
        },
      }),
      runsApi({ runs: [stopped], deny: [/\/runs$/] }),
      shortListing(),
    ])
      assert.equal((await nightly(t, api)).result, true)
  })
})
