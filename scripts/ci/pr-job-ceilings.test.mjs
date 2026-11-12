// Story 6.14 follow-up: no job a pull request runs may take longer than 20 minutes. A job
// with no timeout-minutes gets GitHub's 360. A job skipped on pull requests must say so with
// an explicit `github.event_name != 'pull_request'` condition, and is listed here, so no PR
// lane is skipped silently. Reusable workflows are followed with the inputs their PR caller
// passes.
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
      // Only a job whose whole condition is the pull request exclusion is skipped there.
      const condition = String(job.if ?? '')
        .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
        .trim()
      if (
        [NOT_ON_PULL_REQUEST, `always() && ${NOT_ON_PULL_REQUEST}`].includes(condition)
      ) {
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
    'pr-share-card-native.yml:android36-controls',
    'pr-share-card-native.yml:android36-interaction',
    'pr-share-card-native.yml:android36-matrix-evidence',
    'pr-share-card-native.yml:android36-native-matrix',
    'pr-share-card-native.yml:android36-original',
    'pr-share-card-native.yml:android36-release-font',
    'pr-share-card-native.yml:original-resource',
    'pr-share-card-native.yml:original-resource-evidence',
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
