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
  statusGrants,
  treeChanges,
  workflowGuardProblems,
} from './ios-native-evidence.mjs'
import {
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  dispatchGate,
  evidenceInputs,
  nativeIosChanges,
  pushPaths,
} from './ios-native-inputs.mjs'

const pushInputs = pushPaths(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
const inputs = evidenceInputs(pushInputs)
const head = 'a'.repeat(40)
const older = 'b'.repeat(40)
const newer = 'e'.repeat(40)
const BASE = 'c'.repeat(40)
// The guard reads workflows the way yq does on the runner; the tests use the yaml package.
const parseYaml = (text) => parse(text, { merge: true })
const nativePaths = ['apps/mobile/package.json', 'apps/mobile/src/screens/home.tsx']
// Codex r3 IOS-R3-01: an evidence workflow whose pull_request trigger runs the pull request's copy.
const guardProbe =
  'name: harmless data-only fixture\non: [pull_request]\njobs:\n  writer:\n    runs-on: ubuntu-latest\n    permissions: { statuses: write }\n    steps:\n      - run: printf harmless-marker\n'
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
  head_repository: { full_name: 'o/r' },
  path: DISPATCH_WORKFLOW,
  display_title: `iOS native ${head}`,
  head_sha: 'f'.repeat(40),
  fromMain: true,
  jobsPassed: true,
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

  // C-14: probe PR 218 changed apps/mobile/metro.config.js alone and passed. The iOS shards build
  // the Release bundle, so the bundler configuration needs the dispatch.
  test('a metro.config.js-only change needs a dispatch of its head commit', async () => {
    const github = fakeGitHub({ diff: ['apps/mobile/metro.config.js'] })
    const result = await judgeEvent(github)
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /apps\/mobile\/metro\.config\.js changed/)
    const dispatched = fakeGitHub({
      diff: ['apps/mobile/metro.config.js'],
      runs: [run()],
    })
    assert.equal((await judgeEvent(dispatched)).state, 'success')
  })

  // C-14 P1: a module's types.ts is the contract index.native.ts casts the native module to, and
  // its package.json is the autolinking entry, so a change to either alone needs the dispatch.
  for (const changed of [
    'apps/mobile/modules/share-card-photo-save/types.ts',
    'apps/mobile/modules/modal-system-bars/package.json',
  ])
    test(`a change to ${changed} alone needs a dispatch of its head commit`, async () => {
      const result = await judgeEvent(fakeGitHub({ diff: [changed] }))
      assert.equal(result.state, 'failure')
      assert.ok(result.detail.includes(`${changed} changed`), result.detail)
      const dispatched = fakeGitHub({ diff: [changed], runs: [run()] })
      assert.equal((await judgeEvent(dispatched)).state, 'success')
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
// read whole, renamed ones included, the evidence workflow among them (IOS-R3-01).
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
        EVIDENCE_WORKFLOW,
        '.github/actions/install/action.yml',
        '.github/actions/new/action.yaml',
      ]
    )
  })

  // IOS-R3-01: a pull request's copy of the evidence workflow runs before the merge as soon as one
  // of its triggers runs the pull request's copy, so every trigger must be one that runs main's.
  const evidenceText = fs.readFileSync(EVIDENCE_WORKFLOW, 'utf8')
  const evidence = (text) =>
    workflowGuardProblems([{ path: EVIDENCE_WORKFLOW, text }], { parseYaml })
  test("the evidence workflow, edited or not, passes while every trigger runs main's copy", () => {
    assert.deepEqual(evidence(evidenceText), [])
    assert.deepEqual(
      evidence(evidenceText.replaceAll('timeout-minutes: 5', 'timeout-minutes: 6')),
      []
    )
    assert.deepEqual(evidence('on: [pull_request_target, workflow_run]\njobs: {}\n'), [])
  })

  const triggers = {
    "Codex's probe: a pull_request list and a statuses: write job": [
      guardProbe,
      'runs on pull_request',
    ],
    'a pull_request key beside pull_request_target': [
      evidenceText.replace('on:\n', 'on:\n  pull_request:\n'),
      'runs on pull_request',
    ],
    'a workflow_call key': [
      evidenceText.replace('on:\n', 'on:\n  workflow_call:\n'),
      'runs on workflow_call',
    ],
    'a push string': ['on: push\njobs: {}\n', 'runs on push'],
    'a workflow_dispatch entry in a list': [
      'on: [pull_request_target, workflow_dispatch]\njobs: {}\n',
      'runs on workflow_dispatch',
    ],
    'no trigger at all': ['jobs: {}\n', 'declares no trigger'],
    'a trigger of another shape': ['on: 7\njobs: {}\n', 'declares no trigger'],
  }
  for (const [name, [text, message]] of Object.entries(triggers))
    test(`an evidence workflow with ${name} fails`, () => {
      const problems = evidence(text)
      assert.equal(problems.length, 1, problems.join('\n'))
      assert.ok(problems[0].startsWith(`${EVIDENCE_WORKFLOW} `), problems[0])
      assert.ok(problems[0].includes(message), problems[0])
    })

  const sneaky = (text) =>
    workflowGuardProblems([{ path: '.github/workflows/sneaky.yml', text }], { parseYaml })
  const fixtures = {
    'a zero-change rename of a workflow that holds statuses: write': [
      'permissions:\n  statuses: write\n',
      'the workflow grants statuses: write',
    ],
    'a quoted statuses key in a flow mapping': [
      'permissions: {"statuses": "write"}\njobs: {}\n',
      'the workflow grants statuses: write',
    ],
    'a single-quoted statuses key': [
      "permissions: { contents: read, 'statuses': 'write' }\n",
      'the workflow grants statuses: write',
    ],
    'a grant through an alias': [
      'x-grant: &grant\n  statuses: write\njobs:\n  a:\n    permissions: *grant\n',
      'job a grants statuses: write',
    ],
    'a grant through a merge key': [
      'x-grant: &grant\n  checks: write\njobs:\n  a:\n    permissions:\n      <<: *grant\n      contents: read\n',
      'job a grants checks: write',
    ],
    'write-all': ['permissions: write-all\n', 'the workflow grants write-all'],
    'checks: write on a job': [
      'jobs:\n  a:\n    permissions:\n      checks: write\n',
      'job a grants checks: write',
    ],
    'the context string': [
      'jobs:\n  a:\n    steps:\n      - run: gh api repos/o/r/statuses/$SHA -f context=ios-native-evidence -f state=success\n',
      'names the ios-native-evidence context',
    ],
  }
  for (const [name, [text, message]] of Object.entries(fixtures))
    test(`a workflow with ${name} fails, even with no native iOS input`, () => {
      const problems = sneaky(text)
      assert.equal(problems.length, 1, problems.join('\n'))
      assert.ok(problems[0].includes(message), problems[0])
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

  test('a local action naming the context fails; read grants, file paths and an unreadable tree are told apart', () => {
    assert.deepEqual(
      workflowGuardProblems(
        [
          {
            path: '.github/actions/x/action.yml',
            text: 'runs:\n  steps:\n    - run: echo ios-native-evidence\n',
          },
        ],
        { parseYaml }
      ),
      ['.github/actions/x/action.yml names the ios-native-evidence context']
    )
    assert.deepEqual(
      sneaky(
        'jobs:\n  a:\n    permissions:\n      statuses: read\n      checks: read\n    steps:\n      - run: node scripts/ci/ios-native-evidence.mjs\n'
      ),
      []
    )
    assert.match(sneaky('jobs: [unclosed\n')[0], /could not be parsed/)
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
    assert.deepEqual(workflowGuardProblems(files, { parseYaml }), [])
    // pr-gate.yml publishes the gate status; a pull request that edits it is read whole.
    assert.deepEqual(
      statusGrants(parseYaml(fs.readFileSync('.github/workflows/pr-gate.yml', 'utf8'))),
      ['job watch grants statuses: write']
    )
  })

  const yq = spawnSync('yq', ['--version']).status === 0
  test(
    'yq on the runner reads permissions as the yaml package does',
    { skip: !yq && 'no yq here' },
    async () => {
      const { yqParse } = await import('./ios-native-evidence.mjs')
      for (const [text] of Object.values(fixtures))
        assert.deepEqual(statusGrants(yqParse(text)), statusGrants(parseYaml(text)))
      for (const text of [evidenceText, ...Object.values(triggers).map(([body]) => body)])
        assert.deepEqual(
          workflowGuardProblems([{ path: EVIDENCE_WORKFLOW, text }], {
            parseYaml: yqParse,
          }),
          evidence(text)
        )
    }
  )
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

// The jobs against a fake GitHub API: open pull requests, the live pull request file list (which
// the judge must not read), the trees at the merge base, each head and main, the dispatch runs
// (100 a page), the commits on main, and the statuses posted.
const MAIN_SHA = 'd'.repeat(40)
function fakeGitHub({
  pulls = [],
  diff = nativePaths,
  diffs = {},
  liveFiles = () => [],
  runs = [],
  contents = {},
  mergeBase = older,
  trees = {},
  truncated = [],
  blobs = {},
  onMain = () => 'behind',
  deny = [],
  jobs = {},
  jobTotals = {},
}) {
  const posted = []
  const requested = []
  const everyPath = [...new Set([diff, ...Object.values(diffs)].flat())]
  const treeOf = (sha) => {
    if (trees[sha]) return trees[sha]
    if (sha === MAIN_SHA) return []
    const changed = new Set(sha === mergeBase ? [] : (diffs[sha] ?? diff))
    return everyPath.map((path) => ({
      path,
      sha: changed.has(path) ? `head-${sha}` : 'base',
      type: 'blob',
    }))
  }
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
    [/\/pulls\/(\d+)\/files$/, (match, query) => reply(liveFiles(query.page))],
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
    // A run's jobs, 100 a page: a passing dispatch unless `jobs` names the run.
    [
      /\/actions\/runs\/(\d+)\/jobs$/,
      (match, query) => {
        const all = jobs[match[1]] ?? dispatchJobs()
        return reply({
          total_count: jobTotals[match[1]] ?? all.length,
          jobs: all.slice((query.page - 1) * 100, query.page * 100),
        })
      },
    ],
    [
      /\/git\/trees\/([0-9a-f]{40})$/,
      (match) =>
        reply({ tree: treeOf(match[1]), truncated: truncated.includes(match[1]) }),
    ],
    [
      /\/git\/blobs\/(.+)$/,
      // A string is the blob's text; an object is the API's answer as it stands.
      (match) => {
        const blob = blobs[match[1]] ?? ''
        if (typeof blob === 'object') return reply(blob)
        const bytes = Buffer.from(blob)
        return reply({
          content: bytes.toString('base64'),
          encoding: 'base64',
          size: bytes.length,
        })
      },
    ],
    [
      /\/contents\/(.+)$/,
      (match, query, init) => {
        assert.equal(init.headers.accept, 'application/vnd.github.raw+json')
        return raw(contents[query.ref]?.[match[1]])
      },
    ],
    // The gate also reads ios-native.yml's runs of the commit: none here.
    [/\/actions\/workflows\/ios-native\.yml\/runs$/, () => reply({ workflow_runs: [] })],
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
    // A token without access: every request to a denied path answers 403.
    if (deny.some((pattern) => pattern.test(pathname)))
      return { ok: false, status: 403, json: async () => ({}) }
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
// The jobs of a dispatch whose every iOS job passed, as the real workflows list them: the gate,
// the cache proof and the four shards; ios-build is skipped on a dispatch.
const dispatchJobs = (patch = {}) =>
  [
    'ios-dispatch-gate',
    'ios-cache-proof',
    'ios-native / ios-build',
    'ios-native / ios-shard (1)',
    'ios-native / ios-shard (2)',
    'ios-native / ios-shard (3)',
    'ios-native / ios-shard (4)',
    'ios-native / ios-expo-go',
    'ios-native / iOS app build',
    'ios-native / ios-evidence',
  ].map((name) => ({
    name,
    conclusion: name === 'ios-native / ios-build' ? 'skipped' : 'success',
    ...patch[name],
  }))
const pullEvent = (sha = head) => ({
  pull_request: { number: 5, head: { sha }, base: { sha: BASE } },
})
const judgeEvent = (github, sha = head) =>
  withEvent(pullEvent(sha), (env) =>
    pullRequest({ env, fetchImpl: github.fetchImpl, parseYaml })
  )

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
  test('judges the head commit named in the event payload, from immutable trees', async () => {
    const github = fakeGitHub({ runs: [run()] })
    await withEvent(pullEvent(), async (env, output) => {
      const result = await pullRequest({ env, fetchImpl: github.fetchImpl, parseYaml })
      assert.equal(result.state, 'success')
      assert.match(output(), /^state=success\ndescription=.+\n$/)
    })
    assert.ok(!github.requested.some((request) => /\/pulls\/\d+\/files/.test(request)))
  })

  test('a new head with no dispatch yet fails', async () => {
    const github = fakeGitHub({ runs: [run()] })
    await withEvent(pullEvent(newer), async (env, output) => {
      await pullRequest({ env, fetchImpl: github.fetchImpl, parseYaml })
      assert.match(output(), /^state=failure\n/)
    })
  })

  test('an event without its base commit fails', async () => {
    const github = fakeGitHub({ runs: [run()] })
    const result = await withEvent(
      { pull_request: { number: 5, head: { sha: head } } },
      (env) => pullRequest({ env, fetchImpl: github.fetchImpl, parseYaml })
    )
    assert.equal(result.state, 'failure')
  })
})

// IOS-R2-01: the diff belongs to the commit the event names. A delayed judgment of A, after the
// pull request moved to a docs-only B, still judges A's native change.
describe('the diff of the judged commit', () => {
  test('a delayed judgment of A reads A, while the live pull request shows B docs-only', async () => {
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: newer } }],
      diffs: { [head]: nativePaths, [newer]: ['docs/readme.md'] },
      liveFiles: () => [file('docs/readme.md')],
    })
    const result = await judgeEvent(github)
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /apps\/mobile\/package\.json/)
  })

  test('a head change while the live file list pages makes no difference', async () => {
    const pages = {
      1: Array.from({ length: 100 }, (_, index) => file(`docs/${index}.md`)),
      2: [file('README.md')],
    }
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: newer } }],
      liveFiles: (page) => pages[page] ?? [],
    })
    assert.equal((await judgeEvent(github)).state, 'failure')
    assert.ok(!github.requested.some((request) => /\/pulls\/\d+\/files/.test(request)))
  })

  test('the changed paths of two trees: added, removed, edited, and both ends of a rename', () => {
    const blob = (path, sha) => ({ path, sha, type: 'blob' })
    assert.deepEqual(
      treeChanges(
        [
          blob('a', '1'),
          blob('b', '1'),
          blob('old', '7'),
          { path: 'dir', sha: 't', type: 'tree' },
        ],
        [
          blob('a', '1'),
          blob('b', '2'),
          blob('new', '7'),
          blob('c', '3'),
          { path: 'dir', sha: 'u', type: 'tree' },
        ]
      ),
      ['b', 'c', 'new', 'old']
    )
  })
})

// IOS-R2-02: a diff that cannot be read whole never passes, and a large one has no cap.
describe('large and incomplete diffs', () => {
  const docs = Array.from({ length: 3500 }, (_, index) => `docs/page-${index}.md`)
  const sameDependencies = {
    contents: {
      [older]: {
        [LOCKFILE]: '{"lockfileVersion":3,"packages":{"":{},"apps/mobile":{}}}',
        [ROOT_MANIFEST]: '{}',
      },
      [head]: {
        [LOCKFILE]: '{"lockfileVersion":3,"packages":{"":{},"apps/mobile":{}}}',
        [ROOT_MANIFEST]: '{}',
      },
    },
  }

  test('a truncated tree fails with unchanged dependency files', async () => {
    for (const sha of [head, older, MAIN_SHA]) {
      const github = fakeGitHub({
        diff: [LOCKFILE, ROOT_MANIFEST, 'docs/a.md'],
        truncated: [sha],
        ...sameDependencies,
      })
      const result = await judgeEvent(github)
      assert.equal(result.state, 'failure', sha)
      assert.match(result.detail, /could not all be read/)
    }
  })

  test('3,000 and 3,500 changed docs pass; a native or workflow file after them needs its check', async () => {
    assert.equal(
      (await judgeEvent(fakeGitHub({ diff: docs.slice(0, 3000), ...sameDependencies })))
        .state,
      'success'
    )
    assert.equal(
      (await judgeEvent(fakeGitHub({ diff: docs, ...sameDependencies }))).state,
      'success'
    )
    const native = await judgeEvent(
      fakeGitHub({
        diff: [...docs, LOCKFILE, 'apps/mobile/modules/x/ios/Late.swift'],
        ...sameDependencies,
      })
    )
    assert.equal(native.state, 'failure')
    assert.match(native.detail, /Late\.swift/)
    const workflow = await judgeEvent(
      fakeGitHub({
        diff: docs,
        trees: {
          [head]: [
            ...docs.map((path) => ({ path, sha: 'h', type: 'blob' })),
            { path: '.github/workflows/zz-late.yml', sha: 'late1', type: 'blob' },
          ],
        },
        blobs: { late1: 'permissions:\n  statuses: write\n' },
        ...sameDependencies,
      })
    )
    assert.equal(workflow.state, 'failure')
    assert.match(workflow.detail, /zz-late\.yml/)
  })
})

// C14-01: main's copy of the judge reads the content of each changed mobile source file at the
// head commit and the merge base, so a pull request that adds a native binding outside the lists,
// and edits the lists in the same change, still needs its dispatch: the rules that judge it are
// main's, and the pull request's edit to them is only data here.
describe('native bindings read from the head commit and the merge base', () => {
  const blob = (path, sha) => ({ path, sha, type: 'blob' })
  const caller = 'apps/mobile/src/lib/new-native-contract.native.ts'
  const screen = 'apps/mobile/app/(tabs)/index.tsx'
  const texts = {
    caller1:
      "import { requireNativeModule } from 'expo-modules-core'\nexport default requireNativeModule('NewContract')\n",
    plain1: 'export const Home = () => null\n',
    plain2: 'export const Home = () => null // edited\n',
    // The pull request's own list update, which main's judge never runs.
    policy2: `export const EVIDENCE_JS_PATHS = ['${caller}']\n`,
    policy1: 'export const EVIDENCE_JS_PATHS = []\n',
    bound1:
      "import { NativeModules } from 'react-native'\nexport const b = NativeModules.B\n",
    test1: "import { NativeModules } from 'react-native'\nNativeModules.B\n",
  }
  const judged = (base, headTree, extra = {}) =>
    judgeEvent(
      fakeGitHub({
        trees: { [older]: base, [head]: headTree },
        blobs: { ...texts, ...extra.blobs },
        ...extra,
      })
    )

  test("Codex's two revisions: a new caller plus the pull request's list update fails without a dispatch", async () => {
    const base = [
      blob(screen, 'plain1'),
      blob('scripts/ci/ios-native-inputs.mjs', 'policy1'),
    ]
    const headTree = [
      blob(caller, 'caller1'),
      blob(screen, 'plain2'),
      blob('scripts/ci/ios-native-inputs.mjs', 'policy2'),
    ]
    assert.equal((await judged(base, headTree)).state, 'failure')
    assert.equal((await judged(base, headTree, { runs: [run()] })).state, 'success')
  })

  test('a new caller outside every list fails on its content alone, and passes with a dispatch', async () => {
    const base = [blob(screen, 'plain1')]
    const headTree = [blob(caller, 'caller1'), blob(screen, 'plain2')]
    const result = await judged(base, headTree)
    assert.equal(result.state, 'failure')
    assert.ok(result.detail.includes(`${caller} changed`), result.detail)
    assert.equal((await judged(base, headTree, { runs: [run()] })).state, 'success')
  })

  // C14-R2-01: each native binding API on its own, in a new caller no evidence path lists and with
  // no classifier file changed, so only the content read can fail it.
  const bindingCalls = {
    requireNativeModule:
      "import { requireNativeModule } from 'expo-modules-core'\nexport default requireNativeModule('NewCaller')\n",
    requireOptionalNativeModule:
      "import { requireOptionalNativeModule } from 'expo-modules-core'\nexport default requireOptionalNativeModule('NewCaller')\n",
    requireNativeView:
      "import { requireNativeView } from 'expo'\nexport const View = requireNativeView('NewCaller')\n",
    requireNativeViewManager:
      "import { requireNativeViewManager } from 'expo-modules-core'\nexport const View = requireNativeViewManager('NewCaller')\n",
    requireNativeComponent:
      "import { requireNativeComponent } from 'react-native'\nexport const View = requireNativeComponent('NewCaller')\n",
    NativeModules:
      "import { NativeModules } from 'react-native'\nexport default NativeModules.NewCaller\n",
    TurboModuleRegistry:
      "import { TurboModuleRegistry } from 'react-native'\nexport default TurboModuleRegistry.getEnforcing('NewCaller')\n",
  }
  for (const [call, text] of Object.entries(bindingCalls))
    test(`a new caller of ${call} fails without a dispatch and passes with one`, async () => {
      const newCaller = 'apps/mobile/src/lib/new-caller.ts'
      const base = [blob(screen, 'plain1')]
      const headTree = [blob(newCaller, 'new1'), blob(screen, 'plain1')]
      const blobs = { new1: text }
      const without = await judged(base, headTree, { blobs })
      assert.equal(without.state, 'failure', without.detail)
      assert.ok(without.detail.includes(`${newCaller} changed`), without.detail)
      const dispatched = await judged(base, headTree, { blobs, runs: [run()] })
      assert.equal(dispatched.state, 'success', dispatched.detail)
    })

  test('a binding removed by an edit, a deletion or a rename counts from the merge base', async () => {
    const bound = 'apps/mobile/src/lib/battery.ts'
    for (const [name, base, headTree] of [
      ['edited away', [blob(bound, 'bound1')], [blob(bound, 'plain1')]],
      [
        'deleted',
        [blob(bound, 'bound1'), blob(screen, 'plain1')],
        [blob(screen, 'plain1')],
      ],
      [
        'renamed',
        [blob(bound, 'bound1')],
        [blob('apps/mobile/src/lib/power.ts', 'bound1')],
      ],
    ]) {
      const result = await judged(base, headTree)
      assert.equal(result.state, 'failure', name)
      assert.ok(result.detail.includes(bound), `${name}: ${result.detail}`)
    }
  })

  test('a test that mentions a native module, or a change with no binding, needs no dispatch', async () => {
    const base = [blob(screen, 'plain1')]
    for (const headTree of [
      [blob(screen, 'plain2')],
      [blob(screen, 'plain1'), blob('apps/mobile/src/lib/battery.test.ts', 'test1')],
      [
        blob(screen, 'plain1'),
        blob('apps/mobile/src/test-utils/mocks/native.js', 'test1'),
      ],
      [blob(screen, 'plain1'), blob('apps/web/lib/native.ts', 'bound1')],
    ])
      assert.equal(
        (await judged(base, headTree)).state,
        'success',
        JSON.stringify(headTree)
      )
  })

  // Each fixture breaks one condition and keeps the others valid, so each check is the one that
  // fails it: the content is plain, whole base64 with a matching size unless the case says so.
  const MIB = 1024 * 1024
  const sized = (bytes, patch = {}) => ({
    content: bytes.toString('base64'),
    encoding: 'base64',
    size: bytes.length,
    ...patch,
  })
  const padded = (head, length) =>
    Buffer.concat([
      Buffer.from(head),
      Buffer.alloc(length - Buffer.byteLength(head), 'a'),
    ])

  test('a blob it cannot read whole fails closed', async () => {
    const base = [blob(screen, 'plain1')]
    const headTree = [blob(screen, 'plain2')]
    const bytes = Buffer.from(texts.plain2)
    for (const [name, extra] of [
      ['a 403', { deny: [/\/git\/blobs\//] }],
      [
        'a short read',
        { blobs: { plain2: sized(bytes.subarray(0, 5), { size: bytes.length }) } },
      ],
      ['a blob over 1 MiB', { blobs: { plain2: sized(padded('// ', MIB + 1)) } }],
      ['another encoding', { blobs: { plain2: sized(bytes, { encoding: 'utf-8' }) } }],
    ]) {
      const result = await judged(base, headTree, extra)
      assert.equal(result.state, 'failure', name)
      assert.match(result.detail, /could not (all )?be read/, name)
    }
  })

  test('a blob of exactly 1 MiB is read: plain passes, a binding needs a dispatch', async () => {
    const base = [blob(screen, 'plain1')]
    const headTree = [blob(screen, 'plain2')]
    const plain = await judged(base, headTree, {
      blobs: { plain2: sized(padded('// ', MIB)) },
    })
    assert.equal(plain.state, 'success', plain.detail)
    const bound = await judged(base, headTree, {
      blobs: { plain2: sized(padded('NativeModules.B\n// ', MIB)) },
    })
    assert.equal(bound.state, 'failure')
    assert.ok(bound.detail.includes(`${screen} changed`), bound.detail)
  })
})

describe('the evidence runs the pull_request_target job reads', () => {
  // A dispatch can conclude success with jobs skipped; only one whose every iOS job passed counts,
  // and a dispatch ios-dispatch-gate stopped is no one's evidence, so an earlier pass still
  // decides.
  test('a successful dispatch whose iOS jobs were skipped, cancelled or missing fails', async () => {
    for (const patch of [
      { 'ios-native / ios-shard (1)': { conclusion: 'skipped' } },
      { 'ios-native / ios-expo-go': { conclusion: 'cancelled' } },
      { 'ios-native / ios-evidence': { conclusion: 'skipped' } },
      { 'ios-cache-proof': { conclusion: 'skipped' } },
    ]) {
      const dispatched = run()
      const result = await judgeEvent(
        fakeGitHub({ runs: [dispatched], jobs: { [dispatched.id]: dispatchJobs(patch) } })
      )
      assert.equal(result.state, 'failure', JSON.stringify(patch))
      assert.match(result.detail, /an iOS job that did not pass/)
    }
    const empty = run()
    const result = await judgeEvent(
      fakeGitHub({ runs: [empty], jobs: { [empty.id]: [] } })
    )
    assert.equal(result.state, 'failure')
  })

  // RUNS-03: a dispatch shows every job main's dispatch file and jobs file run, each shard of
  // the matrix included; a partial graph is no evidence. A dispatch from before a matrix change
  // fails, so it needs a new dispatch.
  test('a dispatch missing a shard, the cache proof or the gate fails', async () => {
    for (const missing of [
      'ios-native / ios-shard (3)',
      'ios-cache-proof',
      'ios-dispatch-gate',
      'ios-native / ios-build',
    ]) {
      const dispatched = run()
      const jobs = dispatchJobs().filter((job) => job.name !== missing)
      const result = await judgeEvent(
        fakeGitHub({ runs: [dispatched], jobs: { [dispatched.id]: jobs } })
      )
      assert.equal(result.state, 'failure', missing)
    }
    const whole = run()
    assert.equal(
      (
        await judgeEvent(
          fakeGitHub({ runs: [whole], jobs: { [whole.id]: dispatchJobs() } })
        )
      ).state,
      'success'
    )
  })

  test('a dispatch from before a matrix change fails and needs a new dispatch', async () => {
    const before = run()
    const threeShards = dispatchJobs().filter(
      (job) => job.name !== 'ios-native / ios-shard (4)'
    )
    const result = await judgeEvent(
      fakeGitHub({ runs: [before], jobs: { [before.id]: threeShards } })
    )
    assert.equal(result.state, 'failure')
  })

  // RUNS-01: the dispatch gate and the judge pick the same deciding run, the newest one that ran
  // its iOS jobs, so a later real failure is never hidden behind an earlier pass: pass P, failed
  // D, a fresh dispatch E in progress, then E passes.
  test('pass, then a later real failure: a fresh dispatch runs, and its pass turns the evidence green', async () => {
    const quietly = async (body) => {
      const log = console.log
      console.log = () => undefined
      try {
        return await body()
      } finally {
        console.log = log
      }
    }
    const P = run({ created_at: '2026-11-13T09:00:00Z' })
    const D = run({ created_at: '2026-11-13T10:00:00Z', conclusion: 'failure' })
    const E = run({
      created_at: '2026-11-13T11:00:00Z',
      status: 'in_progress',
      conclusion: null,
    })
    const failedJobs = dispatchJobs({
      'ios-native / ios-shard (2)': { conclusion: 'failure' },
    })
    const runningJobs = dispatchJobs(
      Object.fromEntries(
        dispatchJobs()
          .filter(
            (job) => job.name.startsWith('ios-native / ') && job.conclusion !== 'skipped'
          )
          .map((job) => [job.name, { status: 'in_progress', conclusion: null }])
      )
    )
    const state = (runs, jobs) => {
      const github = fakeGitHub({ runs, jobs })
      return Promise.all([
        judgeEvent(github),
        quietly(() =>
          dispatchGate({
            env: { SHA: head, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'token' },
            fetchImpl: github.fetchImpl,
          })
        ),
      ])
    }
    const [afterD, dispatchAfterD] = await state([D, P], { [D.id]: failedJobs })
    assert.equal(afterD.state, 'failure', afterD.detail)
    assert.equal(
      dispatchAfterD,
      true,
      'the gate lets a fresh dispatch run after a real failure'
    )
    const [whileE] = await state([E, D, P], { [D.id]: failedJobs, [E.id]: runningJobs })
    assert.equal(whileE.state, 'pending', whileE.detail)
    const passedE = { ...E, status: 'completed', conclusion: 'success' }
    const [afterE, dispatchAfterE] = await state([passedE, D, P], { [D.id]: failedJobs })
    assert.equal(afterE.state, 'success', afterE.detail)
    assert.ok(afterE.detail.includes(`run ${E.id} `), afterE.detail)
    assert.equal(dispatchAfterE, false, 'the next dispatch is stopped')
  })

  test('a cancelled run is never a deciding pass', async () => {
    const P = run({ created_at: '2026-11-13T09:00:00Z' })
    const C = run({ created_at: '2026-11-13T10:00:00Z', conclusion: 'cancelled' })
    const cancelledJobs = dispatchJobs({
      'ios-native / ios-evidence': { conclusion: 'cancelled' },
    })
    const github = fakeGitHub({ runs: [C, P], jobs: { [C.id]: cancelledJobs } })
    assert.equal((await judgeEvent(github)).state, 'failure')
    const log = console.log
    console.log = () => undefined
    try {
      assert.equal(
        await dispatchGate({
          env: { SHA: head, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'token' },
          fetchImpl: github.fetchImpl,
        }),
        true
      )
    } finally {
      console.log = log
    }
  })

  test('a dispatch the gate stopped passes over to the earlier pass, and alone is no evidence', async () => {
    const passed = run({ created_at: '2026-11-13T09:00:00Z' })
    const stopped = run({ created_at: '2026-11-13T11:00:00Z', conclusion: 'failure' })
    // The gate failed, so every other job of the dispatch was skipped.
    const stoppedJobs = dispatchJobs(
      Object.fromEntries(
        dispatchJobs().map(({ name }) => [
          name,
          { conclusion: name === 'ios-dispatch-gate' ? 'failure' : 'skipped' },
        ])
      )
    )
    const both = await judgeEvent(
      fakeGitHub({ runs: [stopped, passed], jobs: { [stopped.id]: stoppedJobs } })
    )
    assert.equal(both.state, 'success', both.detail)
    assert.ok(both.detail.includes(`run ${passed.id} `), both.detail)
    const alone = await judgeEvent(
      fakeGitHub({ runs: [stopped], jobs: { [stopped.id]: stoppedJobs } })
    )
    assert.equal(alone.state, 'failure')
    assert.match(alone.detail, /no ios-native run tested/)
    // A newer dispatch that failed on its own still decides.
    const failed = run({ created_at: '2026-11-13T11:00:00Z', conclusion: 'failure' })
    assert.equal(
      (await judgeEvent(fakeGitHub({ runs: [failed, passed] }))).state,
      'failure'
    )
  })

  // The jobs pages together hold fewer jobs than total_count says: a job the listing lost could
  // be one that failed, so the judge fails closed.
  test('a jobs listing shorter than its total_count fails', async () => {
    const dispatched = run()
    const result = await judgeEvent(
      fakeGitHub({
        runs: [dispatched],
        jobTotals: { [dispatched.id]: dispatchJobs().length + 1 },
      })
    )
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /could not be read/)
  })

  test('a read error on the jobs fails', async () => {
    const result = await judgeEvent(fakeGitHub({ runs: [run()], deny: [/\/jobs$/] }))
    assert.equal(result.state, 'failure')
  })

  // Code review 5: the run's own commit must be on the branch main.
  test('a dispatch whose commit is not on refs/heads/main fails', async () => {
    for (const status of ['diverged', 'ahead']) {
      const github = fakeGitHub({ runs: [run()], onMain: () => status })
      assert.equal((await judgeEvent(github)).state, 'failure', status)
    }
    const github = fakeGitHub({ runs: [run()], onMain: () => 'identical' })
    assert.equal((await judgeEvent(github)).state, 'success')
  })

  // Code review 6: no cap on how far back the evidence is.
  test('evidence past the third page of runs is found', async () => {
    const others = Array.from({ length: 350 }, (_, index) =>
      run({ display_title: `iOS native ${index.toString(16).padStart(40, '0')}` })
    )
    const github = fakeGitHub({ runs: [...others, run()] })
    assert.equal((await judgeEvent(github)).state, 'success')
    assert.ok(github.requested.some((request) => /page=4/.test(request)))
  })

  test('a workflow at the head that could post the status fails the head', async () => {
    const github = fakeGitHub({
      diff: ['README.md'],
      trees: {
        [head]: [{ path: '.github/workflows/renamed.yml', sha: 'old1', type: 'blob' }],
        [MAIN_SHA]: [{ path: '.github/workflows/old.yml', sha: 'old1', type: 'blob' }],
      },
      blobs: { old1: 'permissions:\n  statuses: write\n' },
    })
    const result = await judgeEvent(github)
    assert.equal(result.state, 'failure')
    assert.match(result.detail, /renamed\.yml: the workflow grants statuses: write/)
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
      rogue1:
        'jobs:\n  a:\n    steps:\n      - run: gh api repos/o/r/statuses/$SHA -f context=ios-native-evidence\n',
    },
  }
  const guard = async (github, sha = head) =>
    withEvent({}, (env) =>
      gateGuard({
        env: { ...env, HEAD_SHA: sha },
        fetchImpl: github.fetchImpl,
        parseYaml,
      })
    )

  test('fails the gate status of an open pull request whose head could post the evidence', async () => {
    const github = fakeGitHub({ pulls: [{ number: 5, head: { sha: head } }], ...rogue })
    assert.deepEqual(await guard(github), [
      '.github/workflows/rogue.yml names the ios-native-evidence context',
    ])
    assert.deepEqual(
      github.posted.map(({ sha, state, context }) => ({ sha, state, context })),
      [{ sha: head, state: 'failure', context: GATE_STATUS }]
    )
  })

  test('a head tree it cannot read whole fails the gate too', async () => {
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: head } }],
      truncated: [head],
    })
    assert.match((await guard(github))[0], /could not all be read/)
    assert.equal(github.posted[0].state, 'failure')
  })

  test('posts nothing for a clean head, or a commit no open pull request heads', async () => {
    const clean = fakeGitHub({ pulls: [{ number: 5, head: { sha: head } }] })
    assert.deepEqual(await guard(clean), [])
    assert.deepEqual(clean.posted, [])
    const orphan = fakeGitHub({ pulls: [{ number: 5, head: { sha: older } }], ...rogue })
    assert.deepEqual(await guard(orphan), [])
    assert.deepEqual(orphan.posted, [])
  })

  // IOS-R3-01: Codex's probe, an evidence workflow at the head that runs on pull_request, fails
  // the head in the judge and the gate in PR Gate.
  const evidenceProbe = {
    trees: {
      [head]: [{ path: EVIDENCE_WORKFLOW, sha: 'evidence2', type: 'blob' }],
      [MAIN_SHA]: [{ path: EVIDENCE_WORKFLOW, sha: 'evidence1', type: 'blob' }],
    },
    blobs: { evidence2: guardProbe },
  }
  test('an evidence workflow at the head that runs on pull_request fails the judge and the gate', async () => {
    const judged = await judgeEvent(fakeGitHub({ diff: ['README.md'], ...evidenceProbe }))
    assert.equal(judged.state, 'failure')
    assert.match(judged.detail, /ios-native-evidence\.yml runs on pull_request/)
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: head } }],
      ...evidenceProbe,
    })
    const problems = await guard(github)
    assert.equal(problems.length, 1, problems.join('\n'))
    assert.match(problems[0], /ios-native-evidence\.yml runs on pull_request/)
    assert.deepEqual(
      github.posted.map(({ sha, state, context }) => ({ sha, state, context })),
      [{ sha: head, state: 'failure', context: GATE_STATUS }]
    )
  })

  test("an edited evidence workflow whose triggers run main's copy passes both", async () => {
    const edited = fs
      .readFileSync(EVIDENCE_WORKFLOW, 'utf8')
      .replaceAll('timeout-minutes: 5', 'timeout-minutes: 6')
    const fixture = { ...evidenceProbe, blobs: { evidence2: edited } }
    assert.equal(
      (await judgeEvent(fakeGitHub({ diff: ['README.md'], ...fixture }))).state,
      'success'
    )
    const github = fakeGitHub({ pulls: [{ number: 5, head: { sha: head } }], ...fixture })
    assert.deepEqual(await guard(github), [])
    assert.deepEqual(github.posted, [])
  })

  // IOS-R3-02: PR Gate posts its own verdict first, so a guard that cannot read must still end
  // with gate=failure on the head.
  const gatePosts = (github, sha = head) =>
    github.posted.filter((row) => row.sha === sha && row.context === GATE_STATUS)
  const publisherSuccess = (github) =>
    github.posted.push({ sha: head, state: 'success', context: GATE_STATUS })
  test('PR Gate success, then a guard read error, ends with gate=failure', async () => {
    for (const deny of [
      [/\/git\/ref\/heads\/main$/],
      [/\/git\/trees\//],
      [/\/git\/blobs\//],
      [/\/pulls$/],
      [/^\/repos\/o\/r\/(?!statuses\/)/],
    ]) {
      const github = fakeGitHub({
        pulls: [{ number: 5, head: { sha: head } }],
        ...rogue,
        deny,
      })
      publisherSuccess(github)
      const problems = await guard(github)
      const last = gatePosts(github).at(-1)
      assert.equal(last.state, 'failure', String(deny))
      assert.match(last.description, /could not read/, String(deny))
      assert.match(problems[0], /answered 403/, String(deny))
    }
  })

  test('a guard that cannot post its failure fails its step, so the fallback step posts', async () => {
    const github = fakeGitHub({
      pulls: [{ number: 5, head: { sha: head } }],
      deny: [/\/git\/ref\/heads\/main$/, /\/statuses\//],
    })
    await assert.rejects(guard(github), /answered 403/)
  })

  // TEA P2: the guard step fails closed. It skips only when main's commit holds no guard.
  const gateSteps = () =>
    parse(fs.readFileSync('.github/workflows/pr-gate.yml', 'utf8')).jobs.watch.steps
  const guardStep = () => gateSteps().find((row) => row.id === 'guard')
  const fallbackStep = () => gateSteps().at(-1)
  const runGuardStep = ({ checkout, file, listed, gitFails = false }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-guard-'))
    try {
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(bin)
      fs.writeFileSync(
        path.join(bin, 'git'),
        `#!/usr/bin/env bash\n${gitFails ? 'exit 128' : ''}\nif [ "$1" = ls-tree ]; then ${listed ? 'echo scripts/ci/ios-native-evidence.mjs' : 'true'}; else echo ${MAIN_SHA}; fi\n`,
        { mode: 0o755 }
      )
      fs.writeFileSync(
        path.join(bin, 'node'),
        '#!/usr/bin/env bash\necho "guard ran: $*"\n',
        { mode: 0o755 }
      )
      if (file) {
        fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true })
        fs.writeFileSync(path.join(dir, 'scripts/ci/ios-native-evidence.mjs'), '')
      }
      return spawnSync('bash', ['-e', '-c', guardStep().run], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CHECKOUT: checkout },
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('a checkout that failed, was skipped or was cancelled fails the guard step', () => {
    assert.equal(guardStep().env.CHECKOUT, '${{ steps.guard_checkout.outcome }}')
    for (const checkout of ['failure', 'skipped', 'cancelled', ''])
      assert.notEqual(
        runGuardStep({ checkout, file: false, listed: false }).status,
        0,
        checkout
      )
  })

  test('a guard on main that is missing from the checkout fails the guard step', () => {
    const result = runGuardStep({ checkout: 'success', file: false, listed: true })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /is on main at .* but missing from the checkout/)
    assert.notEqual(
      runGuardStep({ checkout: 'success', file: false, gitFails: true }).status,
      0
    )
  })

  test('only a main without the guard, the pull request that adds it, skips with a message', () => {
    const result = runGuardStep({ checkout: 'success', file: false, listed: false })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /has no iOS evidence guard yet/)
    const ran = runGuardStep({ checkout: 'success', file: true, listed: true })
    assert.equal(ran.status, 0)
    assert.match(
      ran.stdout,
      /guard ran: scripts\/ci\/ios-native-evidence\.mjs gate-guard/
    )
  })

  test("pr-gate.yml runs main's guard after its verdict, on every event", () => {
    const workflow = parse(fs.readFileSync('.github/workflows/pr-gate.yml', 'utf8'))
    const job = workflow.jobs.watch
    const names = job.steps.map((row) => row.uses ?? row.name)
    const gate = names.findIndex((name) =>
      String(name).startsWith('muratkeremozcan/pr-gate')
    )
    const [checkout, run, fallback] = job.steps.slice(gate + 1)
    assert.ok(gate >= 0 && job.steps.length === gate + 4)
    assert.equal(checkout.if, 'always()')
    assert.equal(checkout.id, 'guard_checkout')
    assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
    assert.equal(checkout.with['persist-credentials'], false)
    assert.equal(run.if, 'always()')
    assert.equal(run.id, 'guard')
    assert.match(run.run, /node "\$guard" gate-guard/)
    const headSha =
      '${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha }}'
    assert.equal(run.env.HEAD_SHA, headSha)
    assert.equal(fallback.if, FALLBACK_IF)
    assert.equal(fallback.env.HEAD_SHA, headSha)
    assert.equal(fallback.env.OUTCOME, '${{ steps.guard.outcome }}')
    assert.equal(fallback.env.GH_TOKEN, '${{ github.token }}')
    assert.equal(job.permissions['pull-requests'], 'read')
    assert.equal(job.permissions.statuses, 'write')
  })

  // IOS-R3-02: the status sequence on one head, against fake git, node and gh: PR Gate's success,
  // then the guard step, then the fallback step whenever the guard step did not succeed. The
  // fallback's condition is checked as text and evaluated here from the guard step's outcome.
  const FALLBACK_IF = "always() && steps.guard.outcome != 'success'"
  // A fake gh: a status POST is logged; a GET pages through `pulls`, the pull requests the
  // repository holds, the way the API does (30 a page unless per_page says otherwise, the next page
  // only with --paginate), and applies --jq to each page with jq. A commit's association list
  // holds every pull request that contains the commit, whatever its state.
  const fakeGh = (log, fixture) =>
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      "const { execFileSync } = require('node:child_process')",
      'const args = process.argv.slice(2)',
      `const fixture = ${JSON.stringify(fixture)}`,
      "if (args.includes('POST')) {",
      '  const field = (name) => args.find((arg) => arg.startsWith(`${name}=`)).slice(name.length + 1)',
      "  const sha = args[args.indexOf('POST') + 1].split('/').pop()",
      `  fs.appendFileSync(${JSON.stringify(log)}, \`\${sha} \${field('context')} \${field('state')}\\n\`)`,
      '  process.exit(0)',
      '}',
      'if (fixture.fails) process.exit(1)',
      "const url = new URL(args.find((arg) => arg.startsWith('repos/')), 'https://api.github.com/')",
      'const commit = /\\/commits\\/([0-9a-f]{40})\\/pulls$/.exec(url.pathname)?.[1]',
      "const state = url.searchParams.get('state') ?? (commit ? 'all' : 'open')",
      "const rows = fixture.pulls.filter((pull) => (commit ? pull.commits.includes(commit) : true) && (state === 'all' || pull.state === state))",
      "const per = Number(url.searchParams.get('per_page') ?? 30)",
      "const jq = args.includes('--jq') ? args[args.indexOf('--jq') + 1] : '.'",
      "for (let page = 0; page === 0 || (args.includes('--paginate') && page * per < rows.length); page++)",
      "  process.stdout.write(execFileSync('jq', ['-r', jq], { input: JSON.stringify(rows.slice(page * per, (page + 1) * per)) }))",
    ].join('\n')
  const pull = (number, state, sha) => ({ number, state, head: { sha }, commits: [sha] })
  const sequence = ({
    checkout = 'success',
    node = 'exit 0',
    timeout,
    pulls = { pulls: [pull(5, 'open', head)] },
    sha = head,
  }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-sequence-'))
    try {
      const bin = path.join(dir, 'bin')
      const log = path.join(dir, 'statuses')
      fs.mkdirSync(bin)
      fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'scripts/ci/ios-native-evidence.mjs'), '')
      fs.writeFileSync(log, `${sha} gate success\n`)
      const stub = (name, body) =>
        fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, {
          mode: 0o755,
        })
      stub('git', `echo ${MAIN_SHA}`)
      stub('node', node)
      fs.writeFileSync(path.join(bin, 'gh'), fakeGh(log, pulls), { mode: 0o755 })
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CHECKOUT: checkout,
        HEAD_SHA: sha,
        GH_REPO: 'o/r',
        TARGET: 'https://github.com/o/r/actions/runs/7',
      }
      const guarded = spawnSync('bash', ['-e', '-c', guardStep().run], {
        cwd: dir,
        encoding: 'utf8',
        env,
        timeout,
      })
      const outcome = guarded.signal
        ? 'cancelled'
        : guarded.status === 0
          ? 'success'
          : 'failure'
      assert.equal(fallbackStep().if, FALLBACK_IF)
      const fallback =
        outcome === 'success'
          ? null
          : spawnSync('bash', ['-e', '-c', fallbackStep().run], {
              cwd: dir,
              encoding: 'utf8',
              env: { ...env, OUTCOME: outcome },
            })
      const gates = fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.startsWith(`${sha} gate `))
      return { outcome, fallback, last: gates.at(-1), gates }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('a checkout failure after PR Gate success ends with gate=failure', () => {
    for (const checkout of ['failure', 'cancelled', 'skipped', '']) {
      const result = sequence({ checkout })
      assert.equal(result.outcome, 'failure', checkout)
      assert.equal(result.fallback.status, 0, result.fallback.stderr)
      assert.equal(result.last, `${head} gate failure`, checkout)
    }
  })

  test('a guard that crashes on a read error or times out ends with gate=failure', () => {
    const crashed = sequence({
      node: 'echo "GET /git/ref/heads/main answered 403" >&2; exit 1',
    })
    assert.equal(crashed.outcome, 'failure')
    assert.equal(crashed.last, `${head} gate failure`)
    const timedOut = sequence({ node: 'exec sleep 5 > /dev/null 2>&1', timeout: 500 })
    assert.equal(timedOut.outcome, 'cancelled')
    assert.equal(timedOut.last, `${head} gate failure`)
  })

  test('an unreadable pull request list still fails the gate; a commit no pull request heads posts nothing', () => {
    assert.equal(
      sequence({ checkout: 'failure', pulls: { fails: true } }).last,
      `${head} gate failure`
    )
    const orphan = sequence({
      checkout: 'failure',
      pulls: { pulls: [pull(5, 'open', older), pull(6, 'closed', head)] },
    })
    assert.equal(orphan.fallback.status, 0, orphan.fallback.stderr)
    assert.deepEqual(orphan.gates, [`${head} gate success`])
  })

  // IOS-R4-01: absence of an open pull request on the head is proven across every page. Page one
  // of the commit's associations holds 30 closed or merged pull requests, and the open one whose
  // head is the commit comes after them, behind 100 other open pull requests.
  test('an open pull request on a later page still fails the gate', () => {
    const history = Array.from({ length: 30 }, (_, index) =>
      pull(100 + index, 'closed', head)
    )
    const others = Array.from({ length: 100 }, (_, index) =>
      pull(200 + index, 'open', index.toString(16).padStart(40, '0'))
    )
    const result = sequence({
      checkout: 'failure',
      pulls: { pulls: [...history, ...others, pull(5, 'open', head)] },
    })
    assert.equal(result.fallback.status, 0, result.fallback.stderr)
    assert.equal(result.last, `${head} gate failure`)
    // A pull request that once had the commit as its head, and has moved on, is no match.
    const moved = sequence({
      checkout: 'failure',
      pulls: {
        pulls: [...history, ...others, { ...pull(5, 'open', newer), commits: [head] }],
      },
    })
    assert.deepEqual(moved.gates, [`${head} gate success`])
  })

  test('a guard that finished leaves the gate to its verdict, and a missing head commit fails the fallback', () => {
    const clean = sequence({})
    assert.equal(clean.outcome, 'success')
    assert.equal(clean.fallback, null)
    assert.deepEqual(clean.gates, [`${head} gate success`])
    for (const sha of ['', 'main', `${head}0`])
      assert.notEqual(sequence({ checkout: 'failure', sha }).fallback.status, 0, sha)
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
  const judge = async (after, manifest = {}, before = {}) => {
    const github = fakeGitHub({
      diff: [LOCKFILE, ROOT_MANIFEST],
      contents: {
        [older]: {
          [LOCKFILE]: JSON.stringify(lock('58.0.0', '15.0.0')),
          [ROOT_MANIFEST]: JSON.stringify(before),
        },
        [head]: {
          [LOCKFILE]: JSON.stringify(after),
          [ROOT_MANIFEST]: JSON.stringify(manifest),
        },
      },
    })
    return judgeEvent(github)
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
      diff: [LOCKFILE],
      contents: { [head]: { [LOCKFILE]: '{}' } },
    })
    assert.equal((await judgeEvent(github)).state, 'failure')
  })

  // IOS-R2-03: a root lifecycle script alone, or a root script one runs, needs the evidence.
  test('a root prepare script alone needs it, and so does a root script a hook runs', async () => {
    const same = lock('58.0.0', '15.0.0')
    assert.equal((await judge(same, { scripts: { prepare: 'husky' } })).state, 'failure')
    assert.equal((await judge(same, { scripts: { lint: 'eslint .' } })).state, 'success')
  })

  // IOS-R3-03: npm ci runs preprepare and postprepare around prepare, so a hook alone, added,
  // edited or removed, needs the evidence with an unchanged lockfile, and so does a root script
  // either one runs.
  test('a preprepare or postprepare hook alone, added, edited or removed, needs it', async () => {
    const same = lock('58.0.0', '15.0.0')
    for (const hook of ['preprepare', 'postprepare']) {
      const cases = {
        added: [{ scripts: { [hook]: 'printf harmless-hook-marker' } }, {}],
        edited: [
          { scripts: { [hook]: 'printf b' } },
          { scripts: { [hook]: 'printf a' } },
        ],
        removed: [{}, { scripts: { [hook]: 'printf a' } }],
        'a root script it runs, edited': [
          { scripts: { [hook]: 'npm run setup:hooks', 'setup:hooks': 'printf b' } },
          { scripts: { [hook]: 'npm run setup:hooks', 'setup:hooks': 'printf a' } },
        ],
      }
      for (const [name, [after, before]] of Object.entries(cases)) {
        const result = await judge(same, after, before)
        assert.equal(result.state, 'failure', `${hook} ${name}`)
        assert.match(result.detail, /package\.json/, `${hook} ${name}`)
      }
    }
  })
})

describe('the workflow_run job', () => {
  const pulls = [
    { number: 5, head: { sha: head }, base: { sha: BASE } },
    { number: 6, head: { sha: newer }, base: { sha: BASE } },
  ]
  const after = async (completed, runs = [completed]) => {
    const github = fakeGitHub({ pulls, runs })
    await withEvent({ workflow_run: completed }, (env) =>
      dispatchCompleted({ env, fetchImpl: github.fetchImpl, parseYaml })
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
      display_title: `iOS native ${'9'.repeat(40)}`,
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
      // runGraphs reads main's dispatch and jobs files for the jobs a whole dispatch runs.
      assert.ok(sparse.includes('/.github/workflows/ios-native-dispatch.yml'))
      assert.ok(sparse.includes('/.github/workflows/ios-native-jobs.yml'))
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
