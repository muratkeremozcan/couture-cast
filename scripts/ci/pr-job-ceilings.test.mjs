// Story 6.14 follow-up: no job a pull request runs may take longer than 20 minutes. A job
// with no timeout-minutes gets GitHub's 360. A job skipped on pull requests must say so with
// an explicit `github.event_name != 'pull_request'` condition, and is listed here, so no PR
// lane is skipped silently. Reusable workflows are followed with the inputs their PR caller
// passes.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const CEILING = 20
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = path.join(root, '.github/workflows')
const load = (file) => parse(readFileSync(path.join(dir, file), 'utf8'))
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
function pullRequestJobs() {
  const jobs = []
  const skipped = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
    const workflow = load(file)
    const on = workflow.on ?? workflow[true]
    if (!on || typeof on !== 'object' || !('pull_request' in on)) continue
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
        const called = load(path.basename(job.uses))
        const callerInputs = Object.fromEntries(
          Object.entries(job.with ?? {}).map(([key, value]) => [key, value])
        )
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
  ])
})
