#!/usr/bin/env node
// Story 6.15 D6, SL-11 and C-14: which changes the iOS jobs must test after a merge
// (ios-native.yml's push trigger) and before it (scripts/ci/ios-native-evidence.mjs).
//
//   push paths       ios-native.yml's list: the native iOS inputs, and every file of apps/mobile
//                    and packages/* the Release bundle can hold (PUSH_ONLY_PATHS), so a
//                    JavaScript-only merge runs iOS on main.
//   evidence inputs  what a pull request needs a head-commit dispatch for (evidenceInputs): the
//                    push paths without PUSH_ONLY_PATHS and the workflow and action files, plus the
//                    JavaScript half of each native contract and the bundler configuration
//                    (EVIDENCE_JS_PATHS). Every evidence input is a push path.
//
// Two of the paths are shared with every workspace, so a path match alone would send a web-only
// dependency bump through a 75-minute iOS run:
//
//   package-lock.json  counts when an entry it changed is one the iOS jobs install and run, which
//                      the lockfile alone tells: the root dependencies and development tools
//                      (playwright, prisma, tsx), apps/mobile, and every packages/* workspace
//                      except packages/db, each with everything it resolves and links.
//   package.json       counts when a root field every install reads changed (workspaces,
//                      overrides, engines, packageManager, dependencies, devDependencies), a
//                      lifecycle script npm ci runs (preprepare and postprepare included), or a
//                      root script the iOS jobs run, with its pre and post hooks, and every root
//                      script any of those runs.
//
// apps/api and packages/db are left out: browser-acceptance in pr-share-card-native.yml builds
// the API, runs node scripts/run-story68-native.mjs serve and the story68-api-entry guard on every
// pull request the share-card lane wakes for them, and ios-native-inputs.test.mjs pins that.
// apps/web stays out of every iOS run. A file whose before or after content cannot be read
// counts, so an unknown runs iOS.
//
// The dispatch that gives a pull request its evidence runs main's copy of the iOS workflows and no
// local action, so a pull request's edits to .github/workflows and .github/actions are not
// evidence inputs (evidenceInputs). Their pull request coverage is the workflow validator and
// helper tests that node-test-gate native-harness runs on the Linux pull request jobs, then the
// first push run on main.
//
// It also answers one question both iOS workflows skip on (passingRun): has an iOS run on main
// already passed on this commit? A merge or nightly run of ios-native.yml for the commit, or a
// dispatch of ios-native-dispatch.yml naming it, counts when the run and every one of its jobs
// succeeded. Both uses are skips, so a read error answers no and the iOS jobs run.
//
//   push-changes   (ios-changes job) writes run=true unless no push path changed (dependency files
//                  by their closure) since the newest ancestor a merge or nightly run tested
//                  (testedBase), or the deciding run on the nightly commit passed.
//   dispatch-gate  (ios-native-dispatch.yml) fails the dispatch, naming the run, when the deciding
//                  run on the commit passed (decidingRun), so a stopped dispatch never reads as
//                  evidence; after a later failure, a fresh dispatch runs.
//
// It imports Node built-ins and the lane map, which imports Node built-ins only, so it runs from a
// sparse checkout with no install, as ios-native-evidence.mjs and PR Gate's guard import it.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { matchesAny } from './lanes.mjs'

export const IOS_NATIVE_WORKFLOW = '.github/workflows/ios-native.yml'
export const IOS_DISPATCH_WORKFLOW = '.github/workflows/ios-native-dispatch.yml'
// The dispatch's first job: it stops a dispatch of a commit that already passed.
export const DISPATCH_GATE_JOB = 'ios-dispatch-gate'
// A dispatch builds each consumer's client in the consumer, so it skips this one called job.
const DISPATCH_SKIPPED_JOB = 'ios-native / ios-build'
// The jobs both iOS workflows call, whose root npm scripts an iOS run executes.
export const IOS_JOBS_WORKFLOW = '.github/workflows/ios-native-jobs.yml'
export const LOCKFILE = 'package-lock.json'
export const ROOT_MANIFEST = 'package.json'
export const MOBILE_WORKSPACE = 'apps/mobile'
// The JavaScript of apps/mobile and the shared packages, minus packages/db, tests and Markdown: a
// merge that changes it runs iOS, and a pull request that changes it needs no dispatch unless the
// file is also an evidence input. It comes first in the push paths, so the native entries after
// it still count their own tests (apps/mobile/native-tests).
export const PUSH_ONLY_PATHS = [
  'apps/mobile/**',
  'packages/**',
  '!packages/db/**',
  '!apps/mobile/**/*.test.*',
  '!apps/mobile/**/*.spec.*',
  '!apps/mobile/**/*.md',
  '!packages/**/*.test.*',
  '!packages/**/*.spec.*',
  '!packages/**/*.md',
]
// The JavaScript a pull request needs a dispatch for: every file of a native module (its entries,
// its types.ts contract, its package.json autolinking entry and nested sources), minus its
// Android half and the tests and Markdown the push paths leave out too, with ios/** whole as
// before; the callers that bind a native module (ios-native-inputs.test.mjs derives them from
// the tree and fails on a caller outside this list, and the judge reads every changed mobile
// source for a binding, nativeBinding); and the bundler configuration the iOS shards' Release
// bundle is built with. The list comes after every negation of the push paths, so the last
// match still decides.
export const EVIDENCE_JS_PATHS = [
  'apps/mobile/modules/*/**',
  '!apps/mobile/modules/*/android/**',
  '!apps/mobile/modules/**/*.test.*',
  '!apps/mobile/modules/**/*.spec.*',
  '!apps/mobile/modules/**/*.md',
  'apps/mobile/modules/*/ios/**',
  'apps/mobile/src/lib/share-card-save.native.ts',
  'apps/mobile/src/lib/share-card-share.native.ts',
  'apps/mobile/src/lib/widget-share.ts',
  'apps/mobile/metro.config.js',
  'apps/mobile/babel.config.cjs',
]
// C14-01: the calls that bind JavaScript to a native module or view. The judge reads each changed
// mobile source at the head commit and the merge base with main's copy of this rule, so a new
// binding needs a dispatch even when its pull request also edits the lists above.
export const NATIVE_BINDING =
  /\b(requireNativeModule|requireOptionalNativeModule|requireNativeView|requireNativeViewManager|requireNativeComponent|NativeModules|TurboModuleRegistry)\b/

/** A mobile source file that could bind a native module: JavaScript or TypeScript, no test. */
export function bindingCandidate(file) {
  return (
    /^apps\/mobile\/.+\.(ts|tsx|js|jsx|cjs|mjs)$/.test(file) &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !file.startsWith('apps/mobile/src/test-utils/')
  )
}

// The workspaces whose dependency changes skip iOS evidence (see the header).
export const EVIDENCE_EXEMPT_WORKSPACES = ['apps/web', 'apps/api', 'packages/db']
export const ROOT_FIELDS = [
  'workspaces',
  'overrides',
  'engines',
  'packageManager',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
]
// The root scripts npm ci runs on its own, in its order (docs.npmjs.com, Scripts, "npm ci").
export const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
]
const COMMIT = /^[0-9a-f]{40}$/

/**
 * The push paths of ios-native.yml, read without a YAML parser: they are the native iOS inputs,
 * and a merge to main runs the workflow when one of them changes.
 */
export function pushPaths(text) {
  const lines = text.split('\n')
  const push = lines.findIndex((line) => line === '  push:')
  const start = lines.findIndex((line, index) => index > push && line === '    paths:')
  if (push < 0 || start < 0) throw new Error('ios-native.yml has no push paths')
  const paths = []
  for (const line of lines.slice(start + 1)) {
    const match = /^ {6}- '([^']+)'$/.exec(line)
    if (!match) break
    paths.push(match[1])
  }
  if (paths.length === 0) throw new Error('ios-native.yml has no push paths')
  return paths
}

/** Where `name` resolves from the package at lockfile key `from`, by Node's lookup. */
function resolvePackage(packages, from, name) {
  let base = from
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
    if (candidate in packages) return candidate
    if (!base) return null
    const index = base.lastIndexOf('/node_modules/')
    base = index === -1 ? '' : base.slice(0, index)
  }
}

/** The names a lockfile entry depends on; a workspace's development dependencies install too. */
function dependencyNames(key, entry) {
  const workspace = !key.startsWith('node_modules/') && !key.includes('/node_modules/')
  return new Set([
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}),
    ...(workspace ? Object.keys(entry.devDependencies ?? {}) : []),
  ])
}

/** The workspaces whose dependencies the iOS jobs install and run: the root, apps/mobile, packages. */
function nativeRoots(packages) {
  return [
    '',
    MOBILE_WORKSPACE,
    ...Object.keys(packages).filter(
      (key) => /^packages\/[^/]+$/.test(key) && !EVIDENCE_EXEMPT_WORKSPACES.includes(key)
    ),
  ]
}

/**
 * The lockfile keys the iOS jobs install and run: the root, apps/mobile and the packages/*
 * workspaces except packages/db, every package they resolve, and every workspace they link,
 * each workspace with its development dependencies too. Null for a lockfile this cannot read.
 */
export function nativeClosure(lock) {
  const packages = lock?.packages
  if (
    !packages ||
    typeof packages !== 'object' ||
    !packages[''] ||
    !packages[MOBILE_WORKSPACE]
  )
    return null
  const seen = new Set()
  const stack = nativeRoots(packages)
  while (stack.length) {
    const key = stack.pop()
    if (seen.has(key)) continue
    seen.add(key)
    const entry = packages[key] ?? {}
    if (entry.link && typeof entry.resolved === 'string') {
      stack.push(entry.resolved)
      continue
    }
    for (const name of dependencyNames(key, entry)) {
      const found = resolvePackage(packages, key, name)
      if (found) stack.push(found)
    }
  }
  return seen
}

/** The changed lockfile entries the iOS jobs install before or after; null when unreadable. */
export function nativeLockChanges(before, after) {
  const was = nativeClosure(before)
  const now = nativeClosure(after)
  if (!was || !now) return null
  const keys = new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])
  return [...keys]
    .filter(
      (key) =>
        (was.has(key) || now.has(key)) &&
        JSON.stringify(before.packages[key]) !== JSON.stringify(after.packages[key])
    )
    .sort()
}

/** The root scripts ios-native.yml runs, and the root scripts those run in turn. */
export function rootScriptsRun(jobsText, manifest) {
  const runs = (text) =>
    [...String(text).matchAll(/\bnpm run ([\w:.-]+)([^\n&|;]*)/g)]
      .filter((match) => !/(?:^|\s)(--workspace|-w)\b/.test(match[2]))
      .map((match) => match[1])
  const names = new Set()
  const stack = runs(jobsText)
  while (stack.length) {
    const name = stack.pop()
    if (names.has(name)) continue
    names.add(name)
    stack.push(...runs(manifest?.scripts?.[name] ?? ''))
  }
  return [...names].sort()
}

/**
 * Every root script an iOS run executes: the lifecycle scripts npm ci runs, the root scripts the
 * jobs run, the pre and post hooks of each, and the root scripts any of those run in turn.
 */
export function rootScriptClosure(jobsText, manifest) {
  const scripts = manifest?.scripts ?? {}
  const names = new Set()
  const stack = [...LIFECYCLE_SCRIPTS, ...rootScriptsRun(jobsText, {})]
  while (stack.length) {
    const name = stack.pop()
    if (names.has(name)) continue
    names.add(name)
    // npm runs pre<name> and post<name> around a script it runs; a missing name runs nothing.
    if (!LIFECYCLE_SCRIPTS.includes(name) && name in scripts)
      stack.push(`pre${name}`, `post${name}`)
    stack.push(...rootScriptsRun(scripts[name] ?? '', {}))
  }
  return [...names].sort()
}

/**
 * What changed in the root manifest that an iOS run reads: the install-wide fields and every
 * root script rootScriptClosure finds on either side. Null when unreadable.
 */
export function rootManifestChanges(before, after, jobsText) {
  if (!before || !after) return null
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
  const fields = ROOT_FIELDS.filter((field) => differs(before[field], after[field]))
  const scripts = [
    ...new Set([
      ...rootScriptClosure(jobsText, before),
      ...rootScriptClosure(jobsText, after),
    ]),
  ]
    .filter((name) => differs(before.scripts?.[name], after.scripts?.[name]))
    .sort()
    .map((name) => `scripts.${name}`)
  return [...fields, ...scripts]
}

const parseJson = (text) => {
  try {
    return text == null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Whether each shared dependency file changed something an iOS run installs or runs, from its
 * content before and after: `{ 'package-lock.json': boolean, 'package.json': boolean }`.
 * `read(side, file)` returns the text, or null when the file is missing or unreadable.
 */
export async function dependencyChanges(read, jobsText) {
  const [lockBefore, lockAfter, rootBefore, rootAfter] = await Promise.all([
    read('before', LOCKFILE),
    read('after', LOCKFILE),
    read('before', ROOT_MANIFEST),
    read('after', ROOT_MANIFEST),
  ])
  const lock = nativeLockChanges(parseJson(lockBefore), parseJson(lockAfter))
  const root = rootManifestChanges(parseJson(rootBefore), parseJson(rootAfter), jobsText)
  return {
    [LOCKFILE]: lock === null || lock.length > 0,
    [ROOT_MANIFEST]: root === null || root.length > 0,
  }
}

/**
 * The inputs a pull request needs a dispatch for: the push paths without PUSH_ONLY_PATHS and
 * without the workflow and local action files, since a dispatch runs main's copy of the workflows
 * and no local action, then EVIDENCE_JS_PATHS.
 */
export function evidenceInputs(inputs) {
  return [
    ...inputs.filter(
      (glob) =>
        !PUSH_ONLY_PATHS.includes(glob) &&
        !/^!?\.github\/(workflows|actions)\//.test(glob)
    ),
    ...EVIDENCE_JS_PATHS,
  ]
}

/**
 * The changed paths, old paths of renames included, that ios-native.yml builds, runs or reads.
 * `dependencies` says whether each shared dependency file changed what iOS installs; a file it
 * does not answer for counts on its path alone.
 */
export function nativeIosChanges(files, inputs, dependencies = {}) {
  return files
    .flatMap((file) =>
      typeof file === 'string' ? [file] : [file.filename, file.previous_filename]
    )
    .filter(Boolean)
    .filter((name) => matchesAny(name, inputs) && dependencies[name] !== false)
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** One GitHub API call, retried on 429 and 5xx; with `raw`, a 404 answers null. */
export async function githubApi(
  path,
  { token, fetchImpl = fetch, method = 'GET', body, raw = false }
) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok)
      return response.status === 204 ? null : raw ? response.text() : response.json()
    if (raw && response.status === 404) return null
    if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(response.status))
      throw new Error(`${method} ${path} answered ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
  }
}

/** Every job of one run, the latest attempt of each, read page by page. */
export async function runJobs({ repository, id, ...options }) {
  const jobs = []
  for (let page = 1; ; page++) {
    const body = await githubApi(
      `/repos/${repository}/actions/runs/${id}/jobs?filter=latest&per_page=100&page=${page}`,
      options
    )
    const entries = body?.jobs ?? []
    jobs.push(...entries)
    if (entries.length < 100) {
      if (Number.isInteger(body?.total_count) && jobs.length !== body.total_count)
        throw new Error(`run ${id} listed ${jobs.length} of ${body.total_count} jobs`)
      return jobs
    }
  }
}

/**
 * The jobs of a workflow file, read without a YAML parser from its top-level `jobs:`: each job's
 * id, display name, the workflow it calls and the values of a one-key list matrix. A matrix of
 * another shape throws, so a caller fails closed.
 */
export function workflowJobs(text) {
  const lines = String(text).split('\n')
  const start = lines.indexOf('jobs:')
  if (start < 0) throw new Error('the workflow has no jobs')
  const jobs = []
  let job = null
  let matrix = false
  for (const line of lines.slice(start + 1)) {
    if (/^[\w-]+:/.test(line)) break
    const id = /^ {2}([\w-]+):\s*$/.exec(line)
    if (id) {
      job = { id: id[1], name: id[1], uses: null, matrix: null }
      jobs.push(job)
      matrix = false
      continue
    }
    if (!job) continue
    const field = /^ {4}(name|uses): ['"]?(.+?)['"]?\s*$/.exec(line)
    if (field) job[field[1]] = field[2]
    if (/^ {6}matrix:\s*$/.test(line)) matrix = true
    else if (matrix && /^ {8}\S/.test(line)) {
      const values = /^ {8}[\w-]+: \[([^\]]*)\]\s*$/.exec(line)
      if (!values || job.matrix)
        throw new Error(`job ${job.id} has a matrix this reader cannot list`)
      job.matrix = values[1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    } else if (matrix && /^ {0,6}\S/.test(line)) matrix = false
  }
  return jobs
}

/**
 * The name of every job a whole run of `callerText` shows in the jobs API: the caller's own jobs,
 * then each job of ios-native-jobs.yml under the call ("ios-native / ios-shard (2)"), one per
 * matrix value.
 */
export function requiredJobs(callerText, jobsText) {
  const caller = workflowJobs(callerText)
  const calls = caller.filter((job) => job.uses === `./${IOS_JOBS_WORKFLOW}`)
  if (calls.length !== 1)
    throw new Error(`the workflow calls ${IOS_JOBS_WORKFLOW} ${calls.length} times`)
  const prefix = `${calls[0].name} / `
  return [
    ...caller.filter((job) => job !== calls[0]).map((job) => job.name),
    ...workflowJobs(jobsText).flatMap((job) =>
      job.matrix
        ? job.matrix.map((value) => `${prefix}${job.name} (${value})`)
        : [`${prefix}${job.name}`]
    ),
  ]
}

/**
 * The jobs a whole run shows, from the trusted copies of the three iOS workflows in the
 * checkout: `push` for ios-native.yml, `dispatch` for ios-native-dispatch.yml.
 */
export function runGraphs(read = (file) => readFileSync(file, 'utf8')) {
  const jobsText = read(IOS_JOBS_WORKFLOW)
  return {
    push: requiredJobs(read(IOS_NATIVE_WORKFLOW), jobsText),
    dispatch: requiredJobs(read(IOS_DISPATCH_WORKFLOW), jobsText),
  }
}

/**
 * Whether a completed iOS run is a whole pass: every job in `required` is listed, and every listed
 * job succeeded. A skipped, cancelled, failed or missing job never counts; a dispatch skips
 * ios-build by design.
 */
export function runJobsPassed(jobs, required, { dispatch = false } = {}) {
  const passed = (job) =>
    job?.conclusion === 'success' ||
    (dispatch && job?.name === DISPATCH_SKIPPED_JOB && job.conclusion === 'skipped')
  return (
    required.length > 0 &&
    jobs.every(passed) &&
    required.every((name) => jobs.some((job) => job?.name === name))
  )
}

/** Whether a run ran its iOS jobs: one called job that was not skipped, finished or not. */
export function ranNativeJobs(jobs) {
  return jobs.some(
    (job) =>
      String(job?.name ?? '').startsWith('ios-native / ') && job.conclusion !== 'skipped'
  )
}

/**
 * RUNS-R2-01: whether a job executed: a runner took it and one of its steps started. A queued job
 * already carries started_at with no runner and no steps, and a job cancelled before a runner
 * took it has neither, so neither executed.
 */
export function jobExecuted(job) {
  return (
    (job?.runner_id != null || job?.runner_name != null) &&
    Array.isArray(job?.steps) &&
    job.steps.some((step) => ['in_progress', 'completed'].includes(step?.status))
  )
}

/** Whether one of a run's iOS jobs executed (jobExecuted). */
export function executedNativeJobs(jobs) {
  return jobs.some(
    (job) => String(job?.name ?? '').startsWith('ios-native / ') && jobExecuted(job)
  )
}

/**
 * The deciding run of a commit, shared by the dispatch gate, the nightly decision and the
 * evidence judge: the newest run, from `runs` newest first, that ran its iOS jobs. A dispatch
 * the gate stopped and a run whose ios-changes decided run=false ran none, so the run before
 * them decides. A run in progress is skipped, or with `pending` it decides unless its gate
 * already stopped it: the evidence judge stays pending on a dispatch past the gate even while its
 * iOS jobs are queued, since a pending verdict never passes a pull request. `jobsOf(run)` reads a
 * run's jobs. Returns `{ run, jobs }` or null.
 */
export async function decidingRun(runs, jobsOf, { pending = false } = {}) {
  for (const run of runs) {
    if (run.status !== 'completed' && !pending) continue
    const jobs = await jobsOf(run)
    if (run.status !== 'completed') {
      const stopped = jobs.some(
        (job) =>
          job?.name === DISPATCH_GATE_JOB &&
          job.conclusion &&
          job.conclusion !== 'success'
      )
      if (!stopped) return { run, jobs }
    } else if (ranNativeJobs(jobs)) return { run, jobs }
  }
  return null
}

/** Every run one workflow runs listing returns, page by page. */
async function listRuns(path, options) {
  const runs = []
  for (let page = 1; ; page++) {
    const body = await githubApi(`${path}&per_page=100&page=${page}`, options)
    const entries = body?.workflow_runs ?? []
    runs.push(...entries)
    if (entries.length < 100) return runs
  }
}

/**
 * The deciding iOS run on main for commit `sha` when it passed, or null. The candidates are the
 * push and schedule runs of ios-native.yml whose commit is `sha` and the dispatches of
 * ios-native-dispatch.yml from main named "iOS native <sha>", from this repository; the newest
 * completed one that ran its iOS jobs decides (decidingRun), so a later failure or cancellation
 * is never hidden behind an earlier pass. It passed when it concluded success with every job
 * passed (runJobsPassed). A read error throws; each caller then runs the iOS jobs.
 */
export async function passingRun({ repository, sha, graphs = runGraphs(), ...options }) {
  if (!COMMIT.test(sha ?? '')) return null
  const ours = (run) =>
    run?.head_branch === 'main' && run?.head_repository?.full_name === repository
  const pushed = await listRuns(
    `/repos/${repository}/actions/workflows/ios-native.yml/runs?head_sha=${sha}`,
    options
  )
  const commit = await githubApi(`/repos/${repository}/commits/${sha}`, options)
  const date = Date.parse(commit?.commit?.committer?.date ?? '')
  if (!Number.isFinite(date)) throw new Error(`the commit ${sha} has no date`)
  const since = new Date(date - 86_400_000).toISOString().slice(0, 10)
  const dispatched = await listRuns(
    `/repos/${repository}/actions/workflows/ios-native-dispatch.yml/runs?event=workflow_dispatch&branch=main&created=${encodeURIComponent(`>=${since}`)}`,
    options
  )
  const candidates = [
    ...pushed.filter(
      (run) =>
        ours(run) &&
        run.path === IOS_NATIVE_WORKFLOW &&
        ['push', 'schedule'].includes(run.event) &&
        run.head_sha === sha
    ),
    ...dispatched.filter(
      (run) =>
        ours(run) &&
        run.path === IOS_DISPATCH_WORKFLOW &&
        run.event === 'workflow_dispatch' &&
        run.display_title === `iOS native ${sha}`
    ),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const deciding = await decidingRun(candidates, (run) =>
    runJobs({ ...options, repository, id: run.id })
  )
  if (!deciding || deciding.run.conclusion !== 'success') return null
  const dispatch = deciding.run.event === 'workflow_dispatch'
  return runJobsPassed(deciding.jobs, dispatch ? graphs.dispatch : graphs.push, {
    dispatch,
  })
    ? deciding.run
    : null
}

/**
 * ios-native-dispatch.yml's first job: false, which fails the dispatch, when an iOS run on main
 * already passed on the commit; true otherwise, a read error included.
 */
export async function dispatchGate({ env = process.env, fetchImpl } = {}) {
  const sha = env.SHA ?? ''
  let passed
  try {
    passed = await passingRun({
      repository: env.GITHUB_REPOSITORY,
      sha,
      token: env.GITHUB_TOKEN,
      fetchImpl,
    })
  } catch (error) {
    console.log(
      `::warning::Could not read the iOS runs of ${sha} (${error.message}); the dispatch runs.`
    )
    return true
  }
  if (!passed) {
    console.log(`No iOS run on main passed on ${sha}; the dispatch runs.`)
    return true
  }
  console.log(
    `::error::iOS run ${passed.id} (${passed.html_url}) already passed on ${sha}, so this dispatch stops here; that run is the commit's iOS evidence.`
  )
  return false
}

// The pages of ios-native.yml runs searched for the last tested commit; past them, run everything.
const BASE_PAGES = 3

/**
 * RUNS-02: the newest ancestor of `sha` whose merge or nightly run of ios-native.yml executed one
 * of its iOS jobs (executedNativeJobs), in progress included, or null. A queued job or one
 * cancelled before it started tested nothing, so its commit is no base (RUNS-R2-01). A completed
 * run that was cancelled, by hand or otherwise, never finished testing its change, so it is no
 * base either; one that failed is. A merge compares with it, so a run that replaced a pending run
 * in the group also tests that run's change. A read error throws.
 */
export async function testedBase({ repository, sha, runId, ...options }) {
  for (let page = 1; page <= BASE_PAGES; page++) {
    const body = await githubApi(
      `/repos/${repository}/actions/workflows/ios-native.yml/runs?branch=main&per_page=100&page=${page}`,
      options
    )
    const entries = body?.workflow_runs ?? []
    const runs = entries
      .filter(
        (run) =>
          String(run.id) !== String(runId) &&
          run.head_branch === 'main' &&
          run.head_repository?.full_name === repository &&
          run.path === IOS_NATIVE_WORKFLOW &&
          ['push', 'schedule'].includes(run.event) &&
          COMMIT.test(run.head_sha ?? '') &&
          !(run.status === 'completed' && run.conclusion === 'cancelled')
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    for (const run of runs) {
      if (!executedNativeJobs(await runJobs({ ...options, repository, id: run.id })))
        continue
      const compare = await githubApi(
        `/repos/${repository}/compare/${run.head_sha}...${sha}`,
        options
      )
      if (['ahead', 'identical'].includes(compare?.status)) return run.head_sha
    }
    if (entries.length < 100) return null
  }
  return null
}

/**
 * The ios-changes job: run=true unless a merge to main changed no native iOS input since the last
 * tested commit, or the deciding iOS run on the nightly commit passed.
 */
export async function pushChanges({ env = process.env, run = git, fetchImpl } = {}) {
  const decide = (answer, why) => {
    console.log(why)
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${answer}\n`)
    return answer
  }
  if (env.EVENT === 'schedule') {
    try {
      const passed = await passingRun({
        repository: env.GITHUB_REPOSITORY,
        sha: env.SHA,
        token: env.GITHUB_TOKEN,
        fetchImpl,
      })
      if (passed)
        return decide(
          false,
          `iOS run ${passed.id} (${passed.html_url}) already passed on ${env.SHA}; the nightly run skips it.`
        )
      return decide(
        true,
        `No iOS run on main passed on ${env.SHA}; the nightly run tests it.`
      )
    } catch (error) {
      return decide(
        true,
        `Could not read the iOS runs of ${env.SHA} (${error.message}); the nightly run tests it.`
      )
    }
  }
  if (env.EVENT !== 'push') return decide(true, `A ${env.EVENT} run tests its commit.`)
  let before
  try {
    before = await testedBase({
      repository: env.GITHUB_REPOSITORY,
      sha: env.SHA,
      runId: env.GITHUB_RUN_ID,
      token: env.GITHUB_TOKEN,
      fetchImpl,
    })
  } catch (error) {
    return decide(
      true,
      `Could not find the last commit the iOS jobs tested (${error.message}); run everything.`
    )
  }
  if (!before)
    return decide(true, 'No ancestor on main ran the iOS jobs; run everything.')
  console.log(`Comparing with ${before}, the last commit a merge or nightly run tested.`)
  try {
    run(['fetch', '--no-tags', '--depth=1', 'origin', before])
    const files = run(['diff', '--name-only', '--no-renames', before, 'HEAD'])
      .split('\n')
      .filter(Boolean)
    const inputs = pushPaths(readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
    const show = (side, file) => {
      try {
        return run(['show', `${side === 'before' ? before : 'HEAD'}:${file}`])
      } catch {
        return null
      }
    }
    const dependencies = await dependencyChanges(
      show,
      readFileSync(IOS_JOBS_WORKFLOW, 'utf8')
    )
    const changed = nativeIosChanges(files, inputs, dependencies)
    return changed.length
      ? decide(true, `Native iOS inputs changed: ${changed.join(', ')}`)
      : decide(false, 'No native iOS input changed; the nightly run covers the rest.')
  } catch (error) {
    return decide(
      true,
      `Could not compare with ${before} (${error.message}); run everything.`
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  if (process.argv[2] === 'push-changes') await pushChanges()
  else if (process.argv[2] === 'dispatch-gate') {
    if (!(await dispatchGate())) process.exitCode = 1
  } else {
    console.error('usage: ios-native-inputs.mjs push-changes | dispatch-gate')
    process.exitCode = 2
  }
}
