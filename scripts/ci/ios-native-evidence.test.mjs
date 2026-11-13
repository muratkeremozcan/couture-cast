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
  EVIDENCE_WORKFLOW,
  STATUS_CONTEXT,
  dispatchCompleted,
  dispatchedCommit,
  evaluateEvidence,
  pullRequest,
  runCommit,
  statusGuardProblems,
} from './ios-native-evidence.mjs'
import {
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  nativeIosChanges,
  pushPaths,
} from './ios-native-inputs.mjs'

const inputs = pushPaths(fs.readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
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
  display_title: `iOS native ${head}`,
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
    assert.deepEqual(inputs, workflow.on.push.paths)
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
    // The pull request's own branch copy of the workflow ran, not main's.
    'a dispatch from another branch': [run({ head_branch: 'feat/x' })],
    'a run name that is not this commit': [run({ display_title: `iOS native ${head}x` })],
    'a run name without the commit': [run({ display_title: 'iOS native' })],
    'a pull_request run in place of the dispatch': [run({ event: 'pull_request' })],
    'a push run in place of the dispatch': [run({ event: 'push' })],
    'a nightly run in place of the dispatch': [run({ event: 'schedule' })],
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
      new RegExp(`dispatch ios-native.yml from main with sha ${head}`, 'i')
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

describe('only the evidence workflow may post its status', () => {
  const added = (lines) =>
    `@@ -1,1 +1,3 @@\n ${'unchanged'}\n${lines.map((line) => `+${line}`).join('\n')}`
  const fixtures = {
    'a new workflow that posts the context': file(
      '.github/workflows/sneaky.yml',
      added([
        '      - run: gh api repos/o/r/statuses/$SHA -f context=ios-native-evidence -f state=success',
      ]),
      { status: 'added' }
    ),
    'an edited workflow that adds statuses: write': file(
      '.github/workflows/pr-checks.yml',
      added(['    permissions:', '      statuses: write'])
    ),
    'an edited workflow that adds a quoted statuses write': file(
      '.github/workflows/pr-checks.yml',
      added(["    permissions: { contents: read, statuses: 'write' }"])
    ),
    'an edited workflow that grants write-all': file(
      '.github/workflows/pr-checks.yml',
      added(['permissions: write-all'])
    ),
    'a local action that posts the context': file(
      '.github/actions/install/action.yml',
      added(['        context: ios-native-evidence'])
    ),
    'a workflow diff too large to read': file(
      '.github/workflows/pr-checks.yml',
      undefined,
      {
        patch: undefined,
      }
    ),
  }
  for (const [name, entry] of Object.entries(fixtures))
    test(`${name} fails, even with no native iOS input`, () => {
      assert.equal(statusGuardProblems([entry]).length, 1, name)
      const result = verdict([run()], [entry])
      assert.equal(result.state, 'failure', name)
      assert.match(
        result.detail,
        new RegExp(`Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}`)
      )
    })

  test('the evidence workflow itself, removed lines and unchanged renames pass', () => {
    assert.deepEqual(
      statusGuardProblems([
        file(
          EVIDENCE_WORKFLOW,
          added(['      statuses: write', '-f context=ios-native-evidence'])
        ),
        file(
          '.github/workflows/pr-gate.yml',
          '@@ -1,2 +1,1 @@\n-      statuses: write\n context'
        ),
        file('.github/workflows/old.yml', undefined, {
          status: 'renamed',
          changes: 0,
          patch: undefined,
        }),
        file('.github/workflows/gone.yml', undefined, {
          status: 'removed',
          patch: undefined,
        }),
        file('docs/ci.md', added(['statuses: write ios-native-evidence'])),
      ]),
      []
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
    assert.equal(runCommit({ display_title: `iOS native ${head}` }), head)
  })
})

// The jobs against a fake GitHub API: open pull requests, their files, the ios-native runs, and
// the statuses posted.
function fakeGitHub({
  pulls = [],
  files = {},
  runs = [],
  contents = {},
  mergeBase = older,
}) {
  const posted = []
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    const reply = (body) => ({ ok: true, status: 200, json: async () => body })
    if (init.method === 'POST' && /\/statuses\//.test(pathname)) {
      posted.push({ sha: pathname.split('/').pop(), ...JSON.parse(init.body) })
      return { ok: true, status: 201, json: async () => ({}) }
    }
    if (/\/pulls\/\d+\/files$/.test(pathname)) {
      const number = Number(pathname.split('/').at(-2))
      return reply(searchParams.get('page') === '1' ? (files[number] ?? []) : [])
    }
    if (/\/pulls$/.test(pathname))
      return reply(searchParams.get('page') === '1' ? pulls : [])
    if (/\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/.test(pathname))
      return reply({ merge_base_commit: { sha: mergeBase } })
    const content = /\/contents\/(.+)$/.exec(pathname)
    if (content) {
      assert.equal(init.headers.accept, 'application/vnd.github.raw+json')
      const text = contents[searchParams.get('ref')]?.[content[1]]
      return text == null
        ? { ok: false, status: 404, text: async () => '' }
        : { ok: true, status: 200, text: async () => text }
    }
    if (pathname.endsWith('/actions/workflows/ios-native.yml/runs')) {
      assert.equal(searchParams.get('event'), 'workflow_dispatch')
      return reply({ workflow_runs: runs })
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchImpl, posted }
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

// SL-11: the shared dependency files count only for what apps/mobile installs, read at the merge
// base and the head commit, the two ends of the pull request's own diff.
describe('a pull request that changes the shared dependency files', () => {
  const lock = (expo, next) => ({
    lockfileVersion: 3,
    packages: {
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
    assert.deepEqual(on.workflow_run.workflows, ['iOS native'])
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
      EVENT: 'workflow_dispatch',
      BRANCH: 'main',
      TITLE: `iOS native ${head}`,
    }
    const call = post(row, base)
    assert.ok(call.includes(`repos/o/r/statuses/${head}`))
    assert.ok(call.includes('state=failure'))
    for (const patch of [
      { EVENT: 'push' },
      { EVENT: 'schedule' },
      { BRANCH: 'feat/x' },
      { TITLE: 'iOS native main' },
      { TITLE: `iOS native ${head} extra` },
    ])
      assert.equal(post(row, { ...base, ...patch }), null, JSON.stringify(patch))
  })
})
