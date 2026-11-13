// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 C-11 and SL-10: a pull request that changes a native iOS input needs a successful
// ios-native.yml dispatch from main whose name carries its head commit, judged by main's copy of
// the rules and posted as the ios-native-evidence status on that commit. Each fixture below is a
// way the evidence can be missing or wrong, or a way a pull request could post or loosen its own
// verdict, and each must fail.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  DESCRIPTION_LIMIT,
  DISPATCH_WORKFLOW,
  EVIDENCE_WORKFLOW,
  GATE_STATUS,
  STATUS_CONTEXT,
  changedGuardedFiles,
  dispatchCompleted,
  dispatchedCommit,
  evaluateEvidence,
  gateGuard,
  pullRequest,
  runCommit,
  workflowGuardProblems,
} from './ios-native-evidence.mjs'
import {
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  evidenceInputs,
  nativeIosChanges,
  pushPaths,
} from './ios-native-inputs.mjs'

const pushInputs = pushPaths(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
const inputs = evidenceInputs(pushInputs)
const head = 'a'.repeat(40)
const older = 'b'.repeat(40)
const file = (filename, patch = '@@ -1 +1 @@\n-a\n+b', extra = {}) => ({
  filename,
  status: 'modified',
  changes: 2,
  patch,
  ...extra,
})
const native = [
  file('apps/mobile/package.json'),
  file('apps/mobile/src/screens/home.tsx'),
]
let next = 1
const run = (patch = {}) => ({
  id: next++,
  event: 'workflow_dispatch',
  head_branch: 'main',
  path: DISPATCH_WORKFLOW,
  display_title: `iOS native ${head}`,
  head_sha: 'f'.repeat(40),
  fromMain: true,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-13T10:00:00Z',
  html_url: 'https://github.com/o/r/actions/runs/1',
  ...patch,
})
const verdict = (runs, files = native) =>
  evaluateEvidence({ headSha: head, files, runs, inputs })

describe('the native iOS inputs', () => {
  test('are the push paths of ios-native.yml, read without a YAML parser', () => {
    const workflow = parse(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
    assert.deepEqual(pushInputs, workflow.on.push.paths)
  })

  // Code review 4: a dispatch runs main's copy of the iOS workflows and no local action
  // (ios-native-workflow.test.mjs refuses a local action a dispatch can reach), so a pull
  // request's edits to them are tested by the validator on its Linux jobs and by the first
  // push run on main.
  test('a pull request that edits only the iOS workflows or the install action needs no dispatch', () => {
    for (const files of [
      [file('.github/workflows/ios-native-jobs.yml')],
      [file('.github/workflows/ios-native.yml')],
      [file('.github/actions/install/action.yml')],
      [file('.github/actions/node-dependencies/action.yml')],
    ])
      assert.equal(verdict([], files).state, 'success', files[0].filename)
  })

  test('include the old path of a renamed file', () => {
    assert.deepEqual(
      nativeIosChanges(
        [
          file('apps/mobile/legacy.swift', undefined, {
            status: 'renamed',
            previous_filename: 'apps/mobile/modules/share-native/ios/Old.swift',
          }),
        ],
        inputs
      ),
      ['apps/mobile/modules/share-native/ios/Old.swift']
    )
  })
})

describe('the iOS evidence a pull request head needs', () => {
  test('a successful dispatch from main naming the head commit passes', () => {
    assert.equal(verdict([run()]).state, 'success')
  })

  test('a pull request that changes no native iOS input needs none', () => {
    const result = verdict(
      [],
      [file('apps/mobile/src/screens/home.tsx'), file('apps/api/src/main.ts')]
    )
    assert.equal(result.state, 'success')
    assert.match(result.description, /No native iOS input changed/)
  })

  // C-11: each must fail.
  const failures = {
    'no run': [],
    'a run on an older commit': [run({ display_title: `iOS native ${older}` })],
    'a failed run': [run({ conclusion: 'failure' })],
    'a cancelled run': [run({ conclusion: 'cancelled' })],
    'a timed-out run': [run({ conclusion: 'timed_out' })],
    // The pull request's own branch copy of the workflow ran.
    'a dispatch from another branch': [run({ head_branch: 'feat/x' })],
    'a run name that is not this commit': [run({ display_title: `iOS native ${head}x` })],
    'a run name without the commit': [run({ display_title: 'iOS native' })],
    'a pull_request run in place of the dispatch': [run({ event: 'pull_request' })],
    'a push run in place of the dispatch': [run({ event: 'push' })],
    'a nightly run in place of the dispatch': [run({ event: 'schedule' })],
    // Code review 5: head_branch main also names a tag called main.
    'a dispatch from a tag named main': [run({ fromMain: false })],
    // IOS-01: ios-native.yml writes main's caches and tests main's commits alone.
    'a dispatch of ios-native.yml in place of ios-native-dispatch.yml': [
      run({ path: '.github/workflows/ios-native.yml' }),
    ],
    'a dispatch of another workflow with the same run name': [
      run({ path: '.github/workflows/sneaky.yml' }),
    ],
  }
  for (const [name, runs] of Object.entries(failures))
    test(`${name} fails`, () => {
      const result = verdict(runs)
      assert.equal(result.state, 'failure', result.detail)
    })

  test('a run in progress or queued is pending, never success', () => {
    for (const status of ['in_progress', 'queued', 'waiting'])
      assert.equal(verdict([run({ status, conclusion: null })]).state, 'pending', status)
  })

  test('the newest dispatch of the head commit decides', () => {
    assert.equal(
      verdict([
        run({ created_at: '2026-11-13T10:00:00Z' }),
        run({ created_at: '2026-11-13T11:00:00Z', conclusion: 'failure' }),
      ]).state,
      'failure'
    )
    assert.equal(
      verdict([
        run({ created_at: '2026-11-13T09:00:00Z', conclusion: 'failure' }),
        run({ created_at: '2026-11-13T11:00:00Z' }),
      ]).state,
      'success'
    )
  })

  test('a missing head commit or unreadable file list fails', () => {
    assert.equal(
      evaluateEvidence({ headSha: undefined, files: native, runs: [run()], inputs })
        .state,
      'failure'
    )
    assert.equal(
      evaluateEvidence({ headSha: head, files: null, runs: [run()], inputs }).state,
      'failure'
    )
  })

  test('a missing run names the dispatch to make, within the status limit', () => {
    const result = verdict([])
    assert.match(
      result.description,
      new RegExp(`dispatch ios-native-dispatch.yml from main with sha ${head}`, 'i')
    )
    for (const runs of Object.values(failures))
      assert.ok(verdict(runs).description.length <= DESCRIPTION_LIMIT)
  })

  // SL-10: the module and the workflow judging the pull request are main's, so a pull request that
  // edits them still gets main's verdict.
  test('a pull request that edits the evidence workflow or module still needs its evidence', () => {
    const files = [
      file(EVIDENCE_WORKFLOW, '@@ -1 +1 @@\n-x\n+on: pull_request'),
      file('scripts/ci/ios-native-evidence.mjs', '@@ -1 +1 @@\n-x\n+return success'),
      file('apps/mobile/modules/share-native/ios/ShareCardShareFile.swift'),
    ]
    assert.equal(verdict([], files).state, 'failure')
    assert.equal(verdict([run()], files).state, 'success')
  })
})

// Code review 3: every workflow and local action file at the head that differs from main's is
// read whole, renamed ones included.
describe('only the evidence workflow may post its status', () => {
  const blob = (path, sha) => ({ path, sha, type: 'blob' })
  const mainTree = [
    blob('.github/workflows/pr-gate.yml', 'gate1'),
    blob('.github/workflows/pr-checks.yml', 'checks1'),
    blob('.github/workflows/old.yml', 'old1'),
    blob(EVIDENCE_WORKFLOW, 'evidence1'),
    blob('.github/actions/install/action.yml', 'install1'),
    blob('docs/ci.md', 'docs1'),
  ]

  test('the files read are the workflows and local actions that differ from main, renames included', () => {
    const headTree = [
      blob('.github/workflows/pr-gate.yml', 'gate1'),
      blob('.github/workflows/pr-checks.yml', 'checks2'),
      // A zero-change rename: the same blob at a new path.
      blob('.github/workflows/renamed.yml', 'old1'),
      blob(EVIDENCE_WORKFLOW, 'evidence2'),
      blob('.github/actions/install/action.yml', 'install2'),
      blob('.github/actions/new/action.yaml', 'new1'),
      blob('docs/ci.md', 'docs2'),
    ]
    assert.deepEqual(
      changedGuardedFiles(headTree, mainTree).map((entry) => entry.path),
      [
        '.github/workflows/pr-checks.yml',
        '.github/workflows/renamed.yml',
        '.github/actions/install/action.yml',
        '.github/actions/new/action.yaml',
      ]
    )
  })

  const fixtures = {
    'a zero-change rename of a workflow that holds statuses: write':
      'permissions:\n  statuses: write\n',
    'a quoted statuses key': "permissions: { contents: read, 'statuses': 'write' }\n",
    'a double-quoted statuses key': 'permissions:\n  "statuses": "write"\n',
    'write-all': 'permissions: write-all\n',
    'checks: write': 'permissions:\n  checks: write\n',
    'the context string':
      'run: gh api repos/o/r/statuses/$SHA -f context=ios-native-evidence -f state=success\n',
  }
  for (const [name, text] of Object.entries(fixtures))
    test(`a workflow with ${name} fails, even with no native iOS input`, () => {
      const problems = workflowGuardProblems([
        { path: '.github/workflows/sneaky.yml', text },
      ])
      assert.equal(problems.length, 1, name)
      const result = evaluateEvidence({
        headSha: head,
        files: [],
        runs: [],
        inputs,
        guard: problems,
      })
      assert.equal(result.state, 'failure', name)
      assert.match(
        result.detail,
        new RegExp(`Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}`)
      )
    })

  test('a file name with the context, read permissions and an unreadable tree are told apart', () => {
    assert.deepEqual(
      workflowGuardProblems([
        {
          path: 'a.yml',
          text: 'run: node scripts/ci/ios-native-evidence.mjs\npermissions:\n  statuses: read\n  checks: read\n',
        },
      ]),
      []
    )
    assert.equal(
      evaluateEvidence({ headSha: head, files: [], runs: [], inputs, guard: null }).state,
      'failure'
    )
  })

  test('main itself holds no other workflow that could post the status', () => {
    const files = fs
      .readdirSync('.github/workflows')
      .map((name) => `.github/workflows/${name}`)
      .filter(
        (path) => path !== EVIDENCE_WORKFLOW && path !== '.github/workflows/pr-gate.yml'
      )
      .map((path) => ({ path, text: fs.readFileSync(path, 'utf8') }))
    assert.deepEqual(workflowGuardProblems(files), [])
    // pr-gate.yml publishes the gate status; a pull request that edits it is read whole.
    assert.ok(
      workflowGuardProblems([
        {
          path: '.github/workflows/pr-gate.yml',
          text: fs.readFileSync('.github/workflows/pr-gate.yml', 'utf8'),
        },
      ]).includes('.github/workflows/pr-gate.yml holds statuses: write')
    )
  })
})

describe('the completed run a status follows', () => {
  test('only a dispatch from main naming a full commit is anyone’s evidence', () => {
    assert.equal(dispatchedCommit(run()), head)
    assert.equal(dispatchedCommit(run({ event: 'push' })), null)
    assert.equal(dispatchedCommit(run({ event: 'schedule' })), null)
    assert.equal(dispatchedCommit(run({ head_branch: 'feat/x' })), null)
    assert.equal(dispatchedCommit(run({ display_title: 'iOS native main' })), null)
    assert.equal(
      dispatchedCommit(run({ path: '.github/workflows/ios-native.yml' })),
      null
    )
    assert.equal(runCommit({ display_title: `iOS native ${head}` }), head)
  })
})

// The jobs against a fake GitHub API: open pull requests, their files, the trees at the head and
// at main, the dispatch runs (100 a page), the commits on main, and the statuses posted.
const MAIN_SHA = 'd'.repeat(40)
function fakeGitHub({
  pulls = [],
  files = {},
  runs = [],
  contents = {},
  mergeBase = older,
  trees = {},
  blobs = {},
  onMain = () => 'behind',
}) {
  const posted = []
  const requested = []
  const reply = (body) => ({ ok: true, status: 200, json: async () => body })
  const raw = (text) =>
    text == null
      ? { ok: false, status: 404, text: async () => '' }
      : { ok: true, status: 200, text: async () => text }
  // Each route: a path pattern and its answer from the match, the query and the request.
  const routes = [
    [
      /\/statuses\/([0-9a-f]{40})$/,
      (match, query, init) => {
        posted.push({ sha: match[1], ...JSON.parse(init.body) })
        return { ok: true, status: 201, json: async () => ({}) }
      },
    ],
    [
      /\/pulls\/(\d+)\/files$/,
      (match, query) => reply(query.page === 1 ? (files[match[1]] ?? []) : []),
    ],
    [/\/pulls$/, (match, query) => reply(query.page === 1 ? pulls : [])],
    [
      /\/compare\/refs\/heads\/main\.\.\.([0-9a-f]{40})$/,
      (match) => reply({ status: onMain(match[1]) }),
    ],
    [
      /\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/,
      () => reply({ merge_base_commit: { sha: mergeBase } }),
    ],
    [
      /\/commits\/[0-9a-f]{40}$/,
      () => reply({ commit: { committer: { date: '2026-11-12T08:00:00Z' } } }),
    ],
    [/\/git\/ref\/heads\/main$/, () => reply({ object: { sha: MAIN_SHA } })],
    [
      /\/git\/trees\/([0-9a-f]{40})$/,
      (match) => reply({ tree: trees[match[1]] ?? [], truncated: false }),
    ],
    [
      /\/git\/blobs\/(.+)$/,
      (match) =>
        reply({ content: Buffer.from(blobs[match[1]] ?? '').toString('base64') }),
    ],
    [
      /\/contents\/(.+)$/,
      (match, query, init) => {
        assert.equal(init.headers.accept, 'application/vnd.github.raw+json')
        return raw(contents[query.ref]?.[match[1]])
      },
    ],
    [
      /\/actions\/workflows\/ios-native-dispatch\.yml\/runs$/,
      (match, query) => {
        assert.equal(query.event, 'workflow_dispatch')
        assert.equal(query.created, '>=2026-11-11')
        return reply({
          workflow_runs: runs.slice((query.page - 1) * 100, query.page * 100),
        })
      },
    ],
  ]
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    requested.push(`${pathname}?${searchParams}`)
    const query = {
      ...Object.fromEntries(searchParams),
      page: Number(searchParams.get('page') ?? 1),
    }
    for (const [pattern, answer] of routes) {
      const match = pattern.exec(pathname)
      if (match && (init.method === 'POST') === pattern.source.includes('statuses'))
        return answer(match, query, init)
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchImpl, posted, requested }
}

function withEvent(payload, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-native-evidence-'))
  const event = path.join(dir, 'event.json')
  const output = path.join(dir, 'output')
  fs.writeFileSync(event, JSON.stringify(payload))
  fs.writeFileSync(output, '')
  const env = {
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 'token',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_RUN_ID: '7',
  }
  return Promise.resolve(body(env, () => fs.readFileSync(output, 'utf8'))).finally(() =>
    fs.rmSync(dir, { recursive: true, force: true })
  )
}

describe('the pull_request_target job', () => {
  test('judges the head commit named in the event payload, never the live head', async () => {
    // The live pull request has moved to another commit; the event's head has its evidence.
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: older } }],
      files: { 5: native },
      runs: [run()],
    })
    await withEvent(
      { pull_request: { number: 5, head: { sha: head } } },
      async (env, output) => {
        const result = await pullRequest({ env, fetchImpl: github.fetchImpl })
        assert.equal(result.state, 'success')
        assert.match(output(), /^state=success\ndescription=.+\n$/)
      }
    )
  })

  test('a new head with no dispatch yet fails', async () => {
    const github = fakeGitHub({ files: { 5: native }, runs: [run()] })
    await withEvent(
      { pull_request: { number: 5, head: { sha: older } } },
      async (env, output) => {
        await pullRequest({ env, fetchImpl: github.fetchImpl })
        assert.match(output(), /^state=failure\n/)
      }
    )
  })
})

describe('the evidence runs the pull_request_target job reads', () => {
  const judgeWith = (github) =>
    withEvent({ pull_request: { number: 5, head: { sha: head } } }, (env) =>
      pullRequest({ env, fetchImpl: github.fetchImpl })
    )

  // Code review 5: the run's own commit must be on the branch main.
  test('a dispatch whose commit is not on refs/heads/main fails', async () => {
    for (const status of ['diverged', 'ahead']) {
      const github = fakeGitHub({
        files: { 5: native },
        runs: [run()],
        onMain: () => status,
      })
      assert.equal((await judgeWith(github)).state, 'failure', status)
    }
    const github = fakeGitHub({
      files: { 5: native },
      runs: [run()],
      onMain: () => 'identical',
    })
    assert.equal((await judgeWith(github)).state, 'success')
  })

  // Code review 6: no cap on how far back the evidence is.
  test('evidence past the third page of runs is found', async () => {
    const others = Array.from({ length: 350 }, (_, index) =>
      run({ display_title: `iOS native ${index.toString(16).padStart(40, '0')}` })
    )
    const github = fakeGitHub({ files: { 5: native }, runs: [...others, run()] })
    assert.equal((await judgeWith(github)).state, 'success')
    assert.ok(github.requested.some((request) => /page=4/.test(request)))
  })

  test('a workflow at the head that could post the status fails the head', async () => {
    const github = fakeGitHub({
      files: { 5: [file('README.md')] },
      runs: [],
      trees: {
        [head]: [{ path: '.github/workflows/renamed.yml', sha: 'old1', type: 'blob' }],
        [MAIN_SHA]: [{ path: '.github/workflows/old.yml', sha: 'old1', type: 'blob' }],
      },
      blobs: { old1: 'permissions:\n  statuses: write\n' },
    })
    const result = await judgeWith(github)
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /renamed\.yml holds statuses: write/)
  })
})

// Code review 3: PR Gate runs the same guard, from main, after its own verdict, so a job that
// posts the evidence status after the judge cannot unblock the merge.
describe('the PR Gate guard', () => {
  const rogue = {
    trees: {
      [head]: [{ path: '.github/workflows/rogue.yml', sha: 'rogue1', type: 'blob' }],
      [MAIN_SHA]: [],
    },
    blobs: {
      rogue1: 'run: gh api repos/o/r/statuses/$SHA -f context=ios-native-evidence\n',
    },
  }
  const guard = async (github, sha = head) =>
    withEvent({}, (env) =>
      gateGuard({ env: { ...env, HEAD_SHA: sha }, fetchImpl: github.fetchImpl })
    )

  test('fails the gate status of an open pull request whose head could post the evidence', async () => {
    const github = fakeGitHub({ pulls: [{ number: 5, head: { sha: head } }], ...rogue })
    assert.deepEqual(await guard(github), [
      '.github/workflows/rogue.yml holds the ios-native-evidence context',
    ])
    assert.deepEqual(
      github.posted.map(({ sha, state, context }) => ({ sha, state, context })),
      [{ sha: head, state: 'failure', context: GATE_STATUS }]
    )
  })

  test('posts nothing for a clean head, or a commit no open pull request heads', async () => {
    const clean = fakeGitHub({ pulls: [{ number: 5, head: { sha: head } }] })
    assert.deepEqual(await guard(clean), [])
    assert.deepEqual(clean.posted, [])
    const orphan = fakeGitHub({ pulls: [{ number: 5, head: { sha: older } }], ...rogue })
    assert.deepEqual(await guard(orphan), [])
    assert.deepEqual(orphan.posted, [])
  })

  test("pr-gate.yml runs main's guard after its verdict, on every event", () => {
    const workflow = parse(fs.readFileSync('.github/workflows/pr-gate.yml', 'utf8'))
    const job = workflow.jobs.watch
    const names = job.steps.map((row) => row.uses ?? row.name)
    const gate = names.findIndex((name) =>
      String(name).startsWith('muratkeremozcan/pr-gate')
    )
    const [checkout, run] = job.steps.slice(gate + 1)
    assert.ok(gate >= 0 && job.steps.length === gate + 3)
    assert.equal(checkout.if, 'always()')
    assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
    assert.equal(checkout.with['persist-credentials'], false)
    assert.equal(run.if, 'always()')
    assert.match(run.run, /node scripts\/ci\/ios-native-evidence\.mjs gate-guard/)
    assert.equal(
      run.env.HEAD_SHA,
      '${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha }}'
    )
    assert.equal(job.permissions['pull-requests'], 'read')
    assert.equal(job.permissions.statuses, 'write')
  })
})

// SL-11: the shared dependency files count only for what apps/mobile installs, read at the merge
// base and the head commit, the two ends of the pull request's own diff.
describe('a pull request that changes the shared dependency files', () => {
  const lock = (expo, next) => ({
    lockfileVersion: 3,
    packages: {
      '': { workspaces: ['apps/*'] },
      'apps/mobile': { dependencies: { expo: '*' } },
      'apps/web': { dependencies: { next: '*' } },
      'node_modules/expo': { version: expo },
      'node_modules/next': { version: next },
    },
  })
  const judge = async (after) => {
    const github = fakeGitHub({
      files: { 5: [file(LOCKFILE), file(ROOT_MANIFEST)] },
      contents: {
        [older]: {
          [LOCKFILE]: JSON.stringify(lock('58.0.0', '15.0.0')),
          [ROOT_MANIFEST]: '{}',
        },
        [head]: { [LOCKFILE]: JSON.stringify(after), [ROOT_MANIFEST]: '{}' },
      },
    })
    return withEvent(
      { pull_request: { number: 5, head: { sha: head }, base: { sha: 'c'.repeat(40) } } },
      (env) => pullRequest({ env, fetchImpl: github.fetchImpl })
    )
  }

  test('a web-only bump needs no iOS evidence', async () => {
    assert.equal((await judge(lock('58.0.0', '15.1.0'))).state, 'success')
  })

  test('an Expo bump needs it', async () => {
    const result = await judge(lock('58.1.0', '15.0.0'))
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /package-lock\.json/)
  })

  test('a lockfile it cannot read at either end needs it', async () => {
    const github = fakeGitHub({
      files: { 5: [file(LOCKFILE)] },
      contents: { [head]: { [LOCKFILE]: '{}' } },
    })
    const result = await withEvent(
      { pull_request: { number: 5, head: { sha: head }, base: { sha: 'c'.repeat(40) } } },
      (env) => pullRequest({ env, fetchImpl: github.fetchImpl })
    )
    assert.equal(result.state, 'failure')
  })
})

describe('the workflow_run job', () => {
  const pulls = [
    { number: 5, head: { sha: head } },
    { number: 6, head: { sha: older } },
  ]
  const after = async (completed, runs = [completed]) => {
    const github = fakeGitHub({ pulls, files: { 5: native, 6: native }, runs })
    await withEvent({ workflow_run: completed }, (env) =>
      dispatchCompleted({ env, fetchImpl: github.fetchImpl })
    )
    return github.posted
  }

  test('a successful dispatch posts success on the commit its name carries, for its pull request only', async () => {
    const posted = await after(run())
    assert.deepEqual(
      posted.map(({ sha, state, context }) => ({ sha, state, context })),
      [{ sha: head, state: 'success', context: STATUS_CONTEXT }]
    )
    assert.equal(posted[0].target_url, 'https://github.com/o/r/actions/runs/7')
  })

  for (const conclusion of ['failure', 'cancelled'])
    test(`a ${conclusion} dispatch posts failure on that commit`, async () => {
      const posted = await after(run({ conclusion }))
      assert.deepEqual(
        posted.map(({ sha, state }) => ({ sha, state })),
        [{ sha: head, state: 'failure' }]
      )
    })

  const silent = {
    'a push run': run({ event: 'push' }),
    'a nightly run': run({ event: 'schedule' }),
    'a dispatch of ios-native.yml': run({ path: '.github/workflows/ios-native.yml' }),
    'a dispatch from another branch': run({ head_branch: 'feat/x' }),
    'a run whose name is not a commit': run({ display_title: 'iOS native main' }),
    'a dispatch of a commit no open pull request heads': run({
      display_title: `iOS native ${'e'.repeat(40)}`,
    }),
  }
  for (const [name, completed] of Object.entries(silent))
    test(`${name} posts nothing`, async () => {
      assert.deepEqual(await after(completed), [])
    })
})

// The workflow itself: main's copy judges, and the status always lands.
describe('ios-native-evidence.yml', () => {
  const text = fs.readFileSync(EVIDENCE_WORKFLOW, 'utf8')
  const workflow = parse(text)
  const on = workflow.on ?? workflow[true]
  const prJob = workflow.jobs['pull-request']
  const runJob = workflow.jobs['dispatch-completed']

  test('runs on pull_request_target and workflow_run only, never on pull_request', () => {
    assert.deepEqual(Object.keys(on).sort(), ['pull_request_target', 'workflow_run'])
    assert.deepEqual(on.workflow_run.workflows, ['iOS native dispatch'])
    assert.equal(
      parse(fs.readFileSync(DISPATCH_WORKFLOW, 'utf8')).name,
      'iOS native dispatch'
    )
  })

  test('checks out main only, keeps no credentials and reads no secret', () => {
    for (const job of [prJob, runJob]) {
      const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout'))
      assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
      assert.equal(checkout.with['persist-credentials'], false)
      assert.equal(
        job.steps.filter((step) => step.uses?.startsWith('actions/checkout')).length,
        1
      )
    }
    assert.doesNotMatch(text, /secrets\./)
    assert.doesNotMatch(text, /hashFiles|git fetch|git restore|head\.ref/)
    assert.deepEqual(workflow.permissions, {})
    for (const job of [prJob, runJob])
      assert.deepEqual(job.permissions, {
        actions: 'read',
        contents: 'read',
        'pull-requests': 'read',
        statuses: 'write',
      })
  })

  test('the sparse checkout holds every module the judge imports, and nothing installs', () => {
    const imported = new Set(['scripts/ci/ios-native-evidence.mjs'])
    for (const file of imported)
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from '(\.\/[\w.-]+)'/g))
        imported.add(path.posix.join('scripts/ci', match[1]))
    for (const job of [prJob, runJob]) {
      const sparse = job.steps[0].with['sparse-checkout'].trim().split('\n')
      for (const file of imported) assert.ok(sparse.includes(`/${file}`), file)
      assert.ok(sparse.includes(`/${IOS_NATIVE_WORKFLOW}`))
      assert.ok(!job.steps.some((step) => /npm (ci|install)/.test(step.run ?? '')))
    }
  })

  test('the pull request head reaches a step only as data in env', () => {
    for (const job of [prJob, runJob])
      for (const step of job.steps) {
        assert.doesNotMatch(String(step.run ?? ''), /\$\{\{/, step.name)
        assert.doesNotMatch(
          JSON.stringify(step.with ?? {}),
          /pull_request\.head/,
          step.name
        )
      }
  })

  // The status step, against a fake gh.
  const post = (row, env) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-native-status-'))
    try {
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(
        path.join(bin, 'gh'),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${dir}/call"\n`,
        {
          mode: 0o755,
        }
      )
      const result = spawnSync('bash', ['-c', row.run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GH_REPO: 'o/r',
          TARGET: 'https://github.com/o/r/actions/runs/7',
          ...env,
        },
      })
      assert.equal(result.status, 0, result.stderr)
      const call = path.join(dir, 'call')
      return fs.existsSync(call) ? fs.readFileSync(call, 'utf8').split('\n') : null
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('the pull request job always posts, and a job that did not finish posts failure', () => {
    const row = prJob.steps.at(-1)
    assert.equal(row.if, 'always()')
    assert.equal(row.env.SHA, '${{ github.event.pull_request.head.sha }}')
    const verdict = prJob.steps.find((step) => step.id === 'verdict')
    assert.equal(row.env.STATE, '${{ steps.verdict.outputs.state }}')
    assert.match(verdict.run, /ios-native-evidence\.mjs pull-request$/)
    const success = post(row, { SHA: head, STATE: 'success', DESCRIPTION: 'ok' })
    assert.ok(success.includes(`repos/o/r/statuses/${head}`))
    assert.ok(success.includes('state=success'))
    assert.ok(success.includes(`context=${STATUS_CONTEXT}`))
    for (const state of ['', 'error', 'success; rm -rf /']) {
      const call = post(row, { SHA: head, STATE: state, DESCRIPTION: '' })
      assert.ok(call.includes('state=failure'), state)
    }
    const long = post(row, { SHA: head, STATE: 'failure', DESCRIPTION: 'x'.repeat(300) })
    assert.equal(
      long.find((arg) => arg.startsWith('description=')).length,
      'description='.length + 140
    )
  })

  test('a crashed dispatch judgment posts failure only on a dispatch from main naming a commit', () => {
    const row = runJob.steps.at(-1)
    assert.equal(row.if, 'failure() || cancelled()')
    const base = {
      WORKFLOW: DISPATCH_WORKFLOW,
      EVENT: 'workflow_dispatch',
      BRANCH: 'main',
      TITLE: `iOS native ${head}`,
    }
    const call = post(row, base)
    assert.ok(call.includes(`repos/o/r/statuses/${head}`))
    assert.ok(call.includes('state=failure'))
    for (const patch of [
      { WORKFLOW: '.github/workflows/ios-native.yml' },
      { EVENT: 'push' },
      { EVENT: 'schedule' },
      { BRANCH: 'feat/x' },
      { TITLE: 'iOS native main' },
      { TITLE: `iOS native ${head} extra` },
    ])
      assert.equal(post(row, { ...base, ...patch }), null, JSON.stringify(patch))
  })
})
