// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 C-11: a pull request that changes a native iOS input needs a successful ios-native.yml
// dispatch from main whose name carries its current head commit. Each fixture below is a way that
// evidence can be missing or wrong, and each must fail the check.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  EVIDENCE_WORKFLOW_FILE,
  check,
  evaluateEvidence,
  nativeIosChanges,
  rerun,
  runCommit,
} from './ios-native-evidence.mjs'

const head = 'a'.repeat(40)
const older = 'b'.repeat(40)
const native = ['apps/mobile/package.json', 'apps/mobile/src/screens/home.tsx']
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
const verdict = (runs, files = native) => evaluateEvidence({ headSha: head, files, runs })

describe('the iOS evidence a pull request head needs', () => {
  test('a successful dispatch from main naming the head commit passes', () => {
    assert.equal(verdict([run()]).ok, true)
  })

  test('a pull request that changes no native iOS input needs none', () => {
    const result = verdict(
      [],
      ['apps/mobile/src/screens/home.tsx', 'apps/api/src/main.ts']
    )
    assert.equal(result.ok, true)
    assert.match(result.reason, /no native iOS input changed/)
  })

  // C-11 fixtures: each must fail.
  const failures = {
    'no run': [],
    'a run on an older commit': [run({ display_title: `iOS native ${older}` })],
    'a failed run': [run({ conclusion: 'failure' })],
    'a cancelled run': [run({ conclusion: 'cancelled' })],
    'a run still in progress': [run({ status: 'in_progress', conclusion: null })],
    'a queued run': [run({ status: 'queued', conclusion: null })],
    // The pull request's own branch copy of the workflow ran, not main's.
    'a dispatch from another branch': [
      run({ head_branch: 'feat/story-6-15-expo-sdk-58' }),
    ],
    'a pull_request run in place of the dispatch': [run({ event: 'pull_request' })],
    'a push run in place of the dispatch': [run({ event: 'push' })],
    'a scheduled run in place of the dispatch': [run({ event: 'schedule' })],
    // The jobs' commit proof fails a run whose checkout disagrees with its name.
    'a run whose checkout disagreed with its name': [run({ conclusion: 'failure' })],
    'a run name with a short commit': [
      run({ display_title: `iOS native ${head.slice(0, 7)}` }),
    ],
    'a run name with another prefix': [run({ display_title: `iOS ${head}` })],
    // The newest run decides: an older success does not cover a newer failure.
    'a success followed by a newer failure': [
      run({ created_at: '2026-11-13T09:00:00Z' }),
      run({ conclusion: 'failure', created_at: '2026-11-13T11:00:00Z' }),
    ],
    'a success followed by a newer run still in progress': [
      run({ created_at: '2026-11-13T09:00:00Z' }),
      run({
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-11-13T11:00:00Z',
      }),
    ],
  }
  for (const [name, runs] of Object.entries(failures))
    test(`${name} fails`, () => {
      const result = verdict(runs)
      assert.equal(result.ok, false, result.reason)
      assert.match(result.reason, /changed;/)
    })

  test('a run still going says the check re-runs when it completes', () => {
    for (const status of ['in_progress', 'queued'])
      assert.match(
        verdict([run({ status, conclusion: null })]).reason,
        new RegExp(`is ${status}; this check re-runs when it completes`)
      )
    assert.match(
      verdict([run({ conclusion: 'failure' })]).reason,
      /ended failure: fix it and dispatch/
    )
  })

  test('an unreadable diff or head fails', () => {
    assert.equal(
      evaluateEvidence({ headSha: head, files: null, runs: [run()] }).ok,
      false
    )
    assert.equal(
      evaluateEvidence({ headSha: 'main', files: native, runs: [run()] }).ok,
      false
    )
  })

  test('a new push needs its own dispatch: the old head’s success does not carry over', () => {
    const newHead = 'c'.repeat(40)
    const result = evaluateEvidence({ headSha: newHead, files: native, runs: [run()] })
    assert.equal(result.ok, false)
    assert.match(result.reason, new RegExp(`sha ${newHead}`))
  })

  test('the native iOS inputs are the ios-native lane inputs, the SDK version bump included', () => {
    assert.deepEqual(nativeIosChanges(['apps/mobile/package.json']), [
      'apps/mobile/package.json',
    ])
    assert.deepEqual(nativeIosChanges(['apps/mobile/plugins/with-watchos.test.js']), [])
    assert.deepEqual(nativeIosChanges(['docs/guide.md', 'apps/web/src/app/page.tsx']), [])
  })

  test('the run name is the only place the commit is read from', () => {
    assert.equal(runCommit({ display_title: `iOS native ${head}` }), head)
    assert.equal(runCommit({ display_title: `iOS native ${head}x` }), null)
    assert.equal(runCommit({ display_title: 'iOS native' }), null)
  })
})

describe('the evidence jobs', () => {
  const scratch = (t, payload) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-evidence-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'event.json')
    fs.writeFileSync(file, JSON.stringify(payload))
    return { GITHUB_EVENT_PATH: file, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }
  }
  const respond = (routes) => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`)
      for (const [pattern, body] of routes)
        if (url.includes(pattern))
          return body === 204 ? new Response(null, { status: 204 }) : Response.json(body)
      return new Response('', { status: 404 })
    }
    return { fetchImpl, calls }
  }

  test('check passes on the head’s dispatch and fails without it', async (t) => {
    const env = scratch(t, {
      pull_request: { number: 7, base: { sha: older }, head: { sha: head } },
    })
    const files = ['/compare/', { files: [{ filename: 'apps/mobile/package.json' }] }]
    const passing = respond([
      files,
      ['/runs?event=workflow_dispatch', { workflow_runs: [run()] }],
    ])
    assert.equal(await check({ env, fetchImpl: passing.fetchImpl }), 0)
    assert.ok(passing.calls.some((call) => call.includes(`/compare/${older}...${head}`)))
    assert.ok(passing.calls.some((call) => call.includes('branch=main')))
    const missing = respond([
      files,
      ['/runs?event=workflow_dispatch', { workflow_runs: [] }],
    ])
    assert.equal(await check({ env, fetchImpl: missing.fetchImpl }), 1)
    // An API failure is no evidence.
    assert.equal(await check({ env, fetchImpl: respond([]).fetchImpl }), 1)
  })

  test('rerun re-runs the failed check of the open pull request the dispatch tested', async (t) => {
    const env = scratch(t, { workflow_run: run() })
    const { fetchImpl, calls } = respond([
      [`/commits/${head}/pulls`, [{ number: 7, state: 'open', head: { sha: head } }]],
      [
        `/workflows/${EVIDENCE_WORKFLOW_FILE}/runs`,
        {
          workflow_runs: [
            {
              id: 99,
              status: 'completed',
              conclusion: 'failure',
              created_at: '2026-11-13T09:00:00Z',
            },
          ],
        },
      ],
      ['/rerun-failed-jobs', 204],
    ])
    assert.equal(await rerun({ env, fetchImpl }), 0)
    assert.ok(calls.includes('POST /repos/o/r/actions/runs/99/rerun-failed-jobs'))
  })

  test('rerun ignores runs that are not a dispatch from main', async (t) => {
    for (const patch of [
      { event: 'push' },
      { head_branch: 'feature' },
      { display_title: 'iOS native' },
    ]) {
      const env = scratch(t, { workflow_run: run(patch) })
      const { fetchImpl, calls } = respond([])
      assert.equal(await rerun({ env, fetchImpl }), 0)
      assert.deepEqual(calls, [])
    }
  })

  test('the workflow runs the check on every pull request head and re-runs it after a dispatch', () => {
    const workflow = parse(
      fs.readFileSync(`.github/workflows/${EVIDENCE_WORKFLOW_FILE}`, 'utf8')
    )
    const on = workflow.on ?? workflow[true]
    assert.deepEqual(on.pull_request.types, ['opened', 'synchronize', 'reopened'])
    assert.deepEqual(on.workflow_run.workflows, ['iOS native'])
    assert.deepEqual(on.workflow_run.types, ['completed'])
    const checkJob = workflow.jobs['ios-native-evidence']
    assert.equal(checkJob.if, "github.event_name == 'pull_request'")
    assert.ok(checkJob['timeout-minutes'] <= 5)
    assert.ok(
      checkJob.steps.some(
        (step) => step.run === 'node scripts/ci/ios-native-evidence.mjs check'
      )
    )
    const rerunJob = workflow.jobs['rerun-evidence']
    assert.equal(rerunJob.if, "github.event_name == 'workflow_run'")
    assert.deepEqual(rerunJob.permissions, {
      actions: 'write',
      contents: 'read',
      'pull-requests': 'read',
    })
    // The check runs the base branch's copy, so a pull request cannot loosen the check it must
    // pass; only while the base has none does it fall back to the pull request's copy.
    assert.equal(checkJob.steps[0].with.ref, '${{ github.event.pull_request.base.sha }}')
    assert.equal(
      checkJob.steps[1].if,
      "hashFiles('scripts/ci/ios-native-evidence.mjs') == ''"
    )
    // A workflow_run job runs main's copy.
    assert.equal(rerunJob.steps[0].with?.ref, undefined)
  })
})
