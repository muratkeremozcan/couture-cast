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

  // RUNS-01: the deciding run is the newest completed one that ran its iOS jobs; a gate-stopped
  // dispatch or a run=false run never decides, and a cancelled run is never a pass.
  test('a later run that ran its iOS jobs and failed or was cancelled decides: no pass', async () => {
    const P = passing('dispatch', { created_at: '2026-11-13T09:00:00Z' })
    for (const [conclusion, patch] of [
      ['failure', { 'ios-native / ios-shard (2)': { conclusion: 'failure' } }],
      ['cancelled', { 'ios-native / ios-evidence': { conclusion: 'cancelled' } }],
      ['cancelled', {}],
    ]) {
      const later = iosRun('push', { created_at: '2026-11-13T10:00:00Z', conclusion })
      assert.equal(
        await find([later, P.run], { ...P.jobs, [later.id]: iosJobs('push', patch) }),
        null,
        `${conclusion} ${JSON.stringify(patch)}`
      )
    }
  })

  test('a later gate-stopped dispatch, run=false run or run in progress never decides', async () => {
    const P = passing('dispatch', { created_at: '2026-11-13T09:00:00Z' })
    const stopped = iosRun('dispatch', {
      created_at: '2026-11-13T10:00:00Z',
      conclusion: 'failure',
    })
    const skippedNightly = iosRun('schedule', { created_at: '2026-11-13T11:00:00Z' })
    const running = iosRun('push', {
      created_at: '2026-11-13T12:00:00Z',
      status: 'in_progress',
      conclusion: null,
    })
    const jobs = {
      ...P.jobs,
      [stopped.id]: iosJobs(
        'dispatch',
        Object.fromEntries(
          iosJobs('dispatch').map((job) => [
            job.name,
            { conclusion: job.name === 'ios-dispatch-gate' ? 'failure' : 'skipped' },
          ])
        )
      ),
      [skippedNightly.id]: [
        { name: 'ios-changes', conclusion: 'success' },
        { name: 'ios-native', conclusion: 'skipped' },
      ],
      [running.id]: iosJobs('push', {
        'ios-native / ios-evidence': { conclusion: null },
      }),
    }
    assert.equal(
      (await find([running, skippedNightly, stopped, P.run], jobs))?.id,
      P.run.id
    )
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

// RUNS-02: a merge compares HEAD with the newest ancestor whose merge or nightly run ran its iOS
// jobs, whatever it concluded and in progress included, so a run that replaced a pending one
// still tests that run's change. Any read error, no such commit, or no ancestor runs everything.
describe('the merge decision', () => {
  const A = 'b'.repeat(40)
  const B = 'e'.repeat(40)
  const O = 'f'.repeat(40)
  const N = '9'.repeat(40)
  const HEAD = 'c'.repeat(40)
  const merge = async (
    t,
    {
      runs = [],
      jobs = {},
      diffs = {},
      before = B,
      currentJobs = [{ name: 'ios-changes', conclusion: null }],
      ...extra
    }
  ) => {
    const current = iosRun('push', {
      head_sha: HEAD,
      status: 'in_progress',
      conclusion: null,
    })
    const api = runsApi({
      runs: [current, ...runs],
      jobs: { ...jobs, [current.id]: currentJobs },
      ...extra,
    })
    const compared = []
    const git = (args) => {
      if (args[0] === 'fetch') return ''
      if (args[0] === 'diff') {
        compared.push(args[3])
        return `${(diffs[args[3]] ?? []).join('\n')}\n`
      }
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
    const { result } = await quietly(t, () =>
      pushChanges({
        env: {
          ...env,
          SHA: HEAD,
          EVENT: 'push',
          BEFORE: before,
          GITHUB_RUN_ID: String(current.id),
        },
        fetchImpl: api.fetchImpl,
        run: git,
      })
    )
    return { result, compared }
  }
  const tested = (sha, patch = {}, jobPatch = {}) => {
    const run = iosRun('push', { head_sha: sha, ...patch })
    return { run, jobs: { [run.id]: iosJobs('push', jobPatch) } }
  }
  const stoppedRun = (sha, created_at) => {
    const run = iosRun('push', { head_sha: sha, created_at })
    return {
      run,
      jobs: {
        [run.id]: [
          { name: 'ios-changes', conclusion: 'success' },
          { name: 'ios-native', conclusion: 'skipped' },
        ],
      },
    }
  }

  test("inverted order: C replaced B's pending run, so C tests B's change too", async (t) => {
    const a = tested(A, { created_at: '2026-11-13T08:00:00Z' })
    // B's run was pending when C's run replaced it: cancelled, with no job.
    const b = iosRun('push', {
      head_sha: B,
      created_at: '2026-11-13T09:00:00Z',
      conclusion: 'cancelled',
    })
    const { result, compared } = await merge(t, {
      runs: [b, a.run],
      jobs: { ...a.jobs, [b.id]: [] },
      diffs: {
        [A]: ['apps/mobile/src/hooks/use-forecast.ts', 'docs/ci.md'],
        [B]: ['docs/ci.md'],
      },
    })
    assert.deepEqual(compared, [A])
    assert.equal(result, true)
  })

  test('a base whose run failed is still the tested base', async (t) => {
    const failed = tested(
      A,
      { created_at: '2026-11-13T09:00:00Z', conclusion: 'failure' },
      {
        'ios-native / ios-shard (1)': { conclusion: 'failure' },
      }
    )
    const older = tested(O, { created_at: '2026-11-13T08:00:00Z' })
    const { result, compared } = await merge(t, {
      runs: [failed.run, older.run],
      jobs: { ...failed.jobs, ...older.jobs },
      diffs: { [A]: ['docs/ci.md'], [O]: ['apps/mobile/src/x.ts'] },
    })
    assert.deepEqual(compared, [A])
    assert.equal(result, false)
  })

  test('a run=false run is no base, and a run in progress that ran its iOS jobs is one', async (t) => {
    const a = tested(A, { created_at: '2026-11-13T08:00:00Z' })
    const r = stoppedRun(B, '2026-11-13T09:00:00Z')
    const viaStopped = await merge(t, {
      runs: [r.run, a.run],
      jobs: { ...a.jobs, ...r.jobs },
      diffs: { [A]: ['apps/mobile/src/x.ts'], [B]: ['docs/ci.md'] },
    })
    assert.deepEqual(viaStopped.compared, [A])
    assert.equal(viaStopped.result, true)
    const nightly = iosRun('schedule', {
      head_sha: B,
      created_at: '2026-11-13T10:00:00Z',
      status: 'in_progress',
      conclusion: null,
    })
    const running = await merge(t, {
      runs: [nightly, a.run],
      jobs: {
        ...a.jobs,
        [nightly.id]: iosJobs('schedule', {
          'ios-native / ios-evidence': { conclusion: null },
        }),
      },
      diffs: { [A]: ['apps/mobile/src/x.ts'], [B]: ['docs/ci.md'] },
    })
    assert.deepEqual(running.compared, [B])
    assert.equal(running.result, false)
  })

  test('a base that is no ancestor is passed over, and with none left everything runs', async (t) => {
    const n = tested(N, { created_at: '2026-11-13T09:00:00Z' })
    const a = tested(A, { created_at: '2026-11-13T08:00:00Z' })
    const passedOver = await merge(t, {
      runs: [n.run, a.run],
      jobs: { ...n.jobs, ...a.jobs },
      ancestry: { [N]: 'diverged' },
      diffs: { [A]: ['docs/ci.md'], [N]: ['docs/ci.md'] },
    })
    assert.deepEqual(passedOver.compared, [A])
    assert.equal(passedOver.result, false)
    const only = await merge(t, {
      runs: [n.run],
      jobs: n.jobs,
      ancestry: { [N]: 'diverged' },
      diffs: { [N]: ['docs/ci.md'] },
    })
    assert.deepEqual(only.compared, [])
    assert.equal(only.result, true)
  })

  // A re-run lists the iOS jobs its first attempt ran, so without its own exclusion it would be
  // its own, identical base and decide run=false.
  test('a re-run of a merge whose first attempt ran its iOS jobs is no base of itself', async (t) => {
    const a = tested(A, { created_at: '2026-11-13T08:00:00Z' })
    const { result, compared } = await merge(t, {
      runs: [a.run],
      jobs: a.jobs,
      currentJobs: iosJobs('push', { 'ios-changes': { conclusion: null } }),
      diffs: { [A]: ['apps/mobile/src/x.ts'], [HEAD]: [] },
    })
    assert.deepEqual(compared, [A])
    assert.equal(result, true)
  })

  test('no tested commit, or a read error, runs everything', async (t) => {
    const a = tested(A)
    for (const extra of [
      { runs: [] },
      { runs: [a.run], jobs: a.jobs, deny: [/\/actions\/workflows\//] },
      { runs: [a.run], jobs: a.jobs, deny: [/\/jobs$/] },
      { runs: [a.run], jobs: a.jobs, deny: [/\/compare\//] },
    ]) {
      const { result, compared } = await merge(t, {
        diffs: { [A]: ['docs/ci.md'] },
        ...extra,
      })
      assert.equal(result, true, JSON.stringify(extra.deny ?? 'none'))
      assert.deepEqual(compared, [])
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
