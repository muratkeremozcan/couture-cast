// Story 6.14 follow-up: no job a pull request runs may take longer than 20 minutes. A job
// with no timeout-minutes gets GitHub's 360. A job skipped on pull requests must say so with
// an explicit `github.event_name != 'pull_request'` condition, or the nightly-only one, and is
// listed here, so no PR lane is skipped silently. Reusable workflows are followed with the
// inputs their PR caller passes.
//
// Owner rule, 2026-11-13: PR feedback within 15 minutes, 20 at most, queue included. No macOS
// job runs on a pull request or a merge to main, since the macOS queue alone can pass that; it
// runs nightly and on demand, under the nightly-only condition below.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const CEILING = 20
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = path.join(root, '.github/workflows')
const load = (directory, file) => parse(readFileSync(path.join(directory, file), 'utf8'))
const isWorkflow = (name) => /\.ya?ml$/.test(name)

/** Whether a workflow's `on` (string, list or map) includes the pull_request event. */
export function runsOnPullRequest(on) {
  if (typeof on === 'string') return on === 'pull_request'
  if (Array.isArray(on)) return on.includes('pull_request')
  return !!on && typeof on === 'object' && 'pull_request' in on
}
const NOT_ON_PULL_REQUEST = "github.event_name != 'pull_request'"
export const NIGHTLY_ONLY =
  "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
const SKIPPED_ON_PULL_REQUEST = [
  NOT_ON_PULL_REQUEST,
  `always() && ${NOT_ON_PULL_REQUEST}`,
  NIGHTLY_ONLY,
  `always() && (${NIGHTLY_ONLY})`,
]
const NIGHTLY_CONDITIONS = [NIGHTLY_ONLY, `always() && (${NIGHTLY_ONLY})`]
/** A job's `if` without its ${{ }} wrapper. */
const conditionOf = (job) =>
  String(job?.if ?? '')
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .trim()
/** The events a workflow's `on` (string, list or map) names. */
const eventsOf = (on) =>
  typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {})

/** A timeout-minutes value with `inputs.<name>` taken from the caller (&&, ||, == only). */
function minutes(value, inputs) {
  if (typeof value === 'number') return value
  if (value === undefined) return 360
  const body = String(value).replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
  const js = body
    .replace(/inputs\.([A-Za-z_][\w-]*)/g, (_, name) =>
      JSON.stringify(inputs[name] ?? '')
    )
    .replace(/==/g, '===')
  if (!/^[\s\w'".=|&!()-]*$/.test(js)) throw new Error(`cannot read timeout ${value}`)
  return Number(Function(`return (${js})`)())
}

/** Jobs a pull_request event can run, with each one's ceiling in minutes. */
function pullRequestJobs(directory = dir) {
  const jobs = []
  const skipped = []
  for (const file of readdirSync(directory).filter(isWorkflow)) {
    const workflow = load(directory, file)
    if (!runsOnPullRequest(workflow.on ?? workflow[true])) continue
    const visit = (name, job, inputs, via) => {
      const id = `${via}:${name}`
      // Only a job whose whole condition is a pull request exclusion is skipped there.
      if (SKIPPED_ON_PULL_REQUEST.includes(conditionOf(job))) {
        skipped.push(id)
        return
      }
      if (typeof job.uses === 'string' && job.uses.startsWith('./.github/workflows/')) {
        const called = load(directory, path.basename(job.uses))
        // An input the caller leaves out takes the reusable workflow's default.
        const declared = (called.on ?? called[true])?.workflow_call?.inputs ?? {}
        const callerInputs = {
          ...Object.fromEntries(
            Object.entries(declared)
              .filter(([, input]) => input && 'default' in input)
              .map(([key, input]) => [key, input.default])
          ),
          ...(job.with ?? {}),
        }
        for (const [inner, innerJob] of Object.entries(called.jobs ?? {}))
          visit(inner, innerJob, callerInputs, `${id} > ${path.basename(job.uses)}`)
        return
      }
      jobs.push({ id, ceiling: minutes(job['timeout-minutes'], inputs) })
    }
    for (const [name, job] of Object.entries(workflow.jobs ?? {}))
      visit(name, job, {}, file)
  }
  return { jobs, skipped }
}

test(`every job a pull request runs stops within ${CEILING} minutes`, () => {
  const { jobs } = pullRequestJobs()
  assert.ok(jobs.length > 30, `found only ${jobs.length} pull request jobs`)
  const over = jobs
    .filter(({ ceiling }) => !(ceiling > 0 && ceiling <= CEILING))
    .map(({ id, ceiling }) => `${id}: ${ceiling}`)
  assert.deepEqual(over, [])
})

test('the jobs skipped on pull requests are exactly the device and release lanes', () => {
  assert.deepEqual(pullRequestJobs().skipped.sort(), [
    'pr-accessibility-focus.yml:ios',
    'pr-accessibility-focus.yml:ios-app-build',
    'pr-share-card-native.yml:android36-controls',
    'pr-share-card-native.yml:android36-interaction',
    'pr-share-card-native.yml:android36-matrix-evidence',
    'pr-share-card-native.yml:android36-native-matrix',
    'pr-share-card-native.yml:android36-original',
    'pr-share-card-native.yml:android36-release-font',
    'pr-share-card-native.yml:ios-build',
    'pr-share-card-native.yml:ios-evidence',
    'pr-share-card-native.yml:ios-expo-go',
    'pr-share-card-native.yml:ios-shard',
    'pr-share-card-native.yml:original-resource',
    'pr-share-card-native.yml:original-resource-evidence',
    'pr-share-native-unit.yml:swift',
  ])
})

/**
 * Whether a job's runner is a macOS image: in the runner expression itself, in a matrix value it
 * reads, or in an input it reads, with the caller's value or the input's default.
 */
function runsOnMacos(job, inputs = {}) {
  const runsOn = JSON.stringify(job?.['runs-on'] ?? '')
  if (/macos/i.test(runsOn)) return true
  if (
    /matrix\./.test(runsOn) &&
    /macos/i.test(JSON.stringify(job?.strategy?.matrix ?? ''))
  )
    return true
  return [...runsOn.matchAll(/inputs\.([A-Za-z_][\w-]*)/g)].some(([, name]) =>
    /macos/i.test(String(inputs[name] ?? ''))
  )
}

/** A caller's inputs for a reusable workflow, its declared defaults filled in. */
function inputsFor(called, job) {
  const declared = (called.on ?? called[true])?.workflow_call?.inputs ?? {}
  return {
    ...Object.fromEntries(
      Object.entries(declared)
        .filter(([, input]) => input && 'default' in input)
        .map(([key, input]) => [key, input.default])
    ),
    ...(job.with ?? {}),
  }
}

/**
 * Jobs that put a macOS runner on a pull request or a merge to main: a macOS job, or a call to
 * a reusable workflow holding one at any depth, in a workflow triggered by pull_request,
 * pull_request_target or push, unless a job on the path runs only nightly and on demand.
 */
function macosOnPullRequestOrPush(directory = dir) {
  const offenders = []
  const visit = (name, job, inputs, via, depth) => {
    if (NIGHTLY_CONDITIONS.includes(conditionOf(job))) return
    if (typeof job.uses === 'string' && job.uses.startsWith('./.github/workflows/')) {
      if (depth > 10) throw new Error(`reusable workflow chain too deep at ${via}`)
      const called = load(directory, path.basename(job.uses))
      const callerInputs = inputsFor(called, job)
      for (const [inner, innerJob] of Object.entries(called.jobs ?? {}))
        visit(
          inner,
          innerJob,
          callerInputs,
          `${via}:${name} > ${path.basename(job.uses)}`,
          depth + 1
        )
      return
    }
    if (runsOnMacos(job, inputs)) offenders.push(`${via}:${name}`)
  }
  for (const file of readdirSync(directory).filter(isWorkflow)) {
    const workflow = load(directory, file)
    const events = eventsOf(workflow.on ?? workflow[true])
    if (
      !events.some((event) =>
        ['pull_request', 'pull_request_target', 'push'].includes(event)
      )
    )
      continue
    for (const [name, job] of Object.entries(workflow.jobs ?? {}))
      visit(name, job, {}, file, 0)
  }
  return offenders
}

test('no macOS job runs on a pull request or a merge to main', () => {
  assert.deepEqual(macosOnPullRequestOrPush(), [])
})

test('a macOS job on a pull request, a merge or a matrix is caught; nightly-only passes', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pr-job-macos-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const job = (extra = '') =>
    `jobs:\n  mac:\n${extra}    runs-on: macos-15\n    timeout-minutes: 10\n    steps: [{ run: echo }]\n`
  const files = {
    'pr.yml': `on: pull_request\n${job()}`,
    'push.yml': `on:\n  push:\n    branches: [main]\n${job()}`,
    'skip-pr-only.yml': `on: [pull_request, push]\n${job("    if: github.event_name != 'pull_request'\n")}`,
    'nightly-gated.yml': `on: [pull_request, push, schedule]\n${job(`    if: \${{ ${NIGHTLY_ONLY} }}\n`)}`,
    'nightly.yml': `on:\n  schedule:\n    - cron: '0 5 * * *'\n  workflow_dispatch:\n${job()}`,
    'matrix.yml': [
      'on: pull_request',
      'jobs:',
      '  both:',
      '    strategy:',
      '      matrix:',
      '        os: [ubuntu-latest, macos-15]',
      '    runs-on: ${{ matrix.os }}',
      '    timeout-minutes: 10',
      '    steps: [{ run: echo }]',
      '',
    ].join('\n'),
    'caller.yml':
      'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/called.yml\n',
    'called.yml': `on: workflow_call\n${job()}`,
    'target.yml': `on: pull_request_target\n${job()}`,
    'evidence-gated.yml': `on: push\n${job(`    if: \${{ always() && (${NIGHTLY_ONLY}) }}\n`)}`,
    'two-hop.yml':
      'on: push\njobs:\n  outer:\n    uses: ./.github/workflows/middle.yml\n',
    'middle.yml':
      'on: workflow_call\njobs:\n  inner:\n    uses: ./.github/workflows/called.yml\n',
    'by-input.yml':
      'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/runner-input.yml\n    with: { runner: macos-15 }\n',
    'by-default.yml':
      'on: push\njobs:\n  call:\n    uses: ./.github/workflows/runner-input.yml\n',
    'linux-input.yml':
      'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/runner-input.yml\n    with: { runner: ubuntu-latest }\n',
    'runner-input.yml': [
      'on:',
      '  workflow_call:',
      '    inputs:',
      '      runner: { type: string, default: macos-26 }',
      'jobs:',
      '  work:',
      '    runs-on: ${{ inputs.runner }}',
      '    timeout-minutes: 10',
      '    steps: [{ run: echo }]',
      '',
    ].join('\n'),
  }
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(directory, name), body)
  assert.deepEqual(macosOnPullRequestOrPush(directory).sort(), [
    'by-default.yml:call > runner-input.yml:work',
    'by-input.yml:call > runner-input.yml:work',
    'caller.yml:call > called.yml:mac',
    'matrix.yml:both',
    'pr.yml:mac',
    'push.yml:mac',
    'skip-pr-only.yml:mac',
    'target.yml:mac',
    'two-hop.yml:outer > middle.yml:inner > called.yml:mac',
  ])
})

/** The offenders in a directory holding just these workflow files. */
function overIn(t, files) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pr-job-ceilings-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(directory, name), body)
  return pullRequestJobs(directory)
    .jobs.filter(({ ceiling }) => !(ceiling > 0 && ceiling <= CEILING))
    .map(({ id }) => id)
}

const unbounded =
  'jobs:\n  slow:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo }]\n'

test('every way of writing a pull request trigger is checked', (t) => {
  assert.deepEqual(
    overIn(t, {
      'string.yml': `on: pull_request\n${unbounded}`,
      'list.yml': `on: [push, pull_request]\n${unbounded}`,
      'map.yaml': `on:\n  pull_request:\n    branches: [main]\n${unbounded}`,
      'push-only.yml': `on: [push]\n${unbounded}`,
    }).sort(),
    ['list.yml:slow', 'map.yaml:slow', 'string.yml:slow']
  )
})

test('a reusable workflow input the caller omits takes its declared default', (t) => {
  assert.deepEqual(
    overIn(t, {
      'caller.yml':
        'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/called.yml\n',
      'called.yml': [
        'on:',
        '  workflow_call:',
        '    inputs:',
        '      long: { type: boolean, default: true }',
        'jobs:',
        '  work:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: ${{ inputs.long && 60 || 10 }}',
        '    steps: [{ run: echo }]',
        '',
      ].join('\n'),
    }),
    ['caller.yml:call > called.yml:work']
  )
})
