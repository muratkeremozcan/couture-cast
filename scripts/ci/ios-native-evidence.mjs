#!/usr/bin/env node
// Story 6.15 D1 and D6, test design C-11: a pull request that changes a native iOS input merges
// only with iOS evidence on its exact head commit. That evidence is a successful run of
// ios-native-dispatch.yml, dispatched from main with `sha` set to the head commit, so main's copy
// of the workflow ran, under a read-only cache. Only that file counts: ios-native.yml's merge and
// nightly runs test main. The runs API does not return dispatch inputs, so the run name carries
// the commit ("iOS native <sha>"), every job of the run fails unless it checked out exactly that
// commit, and the run's own commit must be on refs/heads/main.
//
// ios-native-evidence.yml runs this file from main. On pull_request_target it judges the head
// commit named in the event payload and posts the verdict as the `ios-native-evidence` commit
// status on that commit; when an ios-native-dispatch.yml run completes, it judges every open pull
// request whose head that dispatch tested and posts the same status again. A new push moves the
// head, which has no status until it is judged. Only the evidence workflow may post that status:
// a pull request whose workflows or local actions could post it, or grant the permission to,
// fails here and in PR Gate (gate-guard).
//
//   pull-request        writes the state and description outputs the workflow posts.
//   dispatch-completed  posts the status on each open pull request the completed dispatch tested.
//   gate-guard          (pr-gate.yml) fails the gate status of an open pull request whose head
//                       holds such a workflow.
//
// The jobs run this file from a sparse checkout of main with no install: it imports Node
// built-ins and scripts/ci/ios-native-inputs.mjs, which decides what a native iOS change is.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DISPATCH_GATE_JOB,
  IOS_JOBS_WORKFLOW,
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  NATIVE_BINDING,
  ROOT_MANIFEST,
  bindingCandidate,
  dependencyChanges,
  evidenceInputs,
  githubApi as api,
  nativeIosChanges,
  pushPaths,
  runGraphs,
  runJobs,
  runJobsPassed,
} from './ios-native-inputs.mjs'

export const EVIDENCE_WORKFLOW = '.github/workflows/ios-native-evidence.yml'
export const STATUS_CONTEXT = 'ios-native-evidence'
export const RUN_NAME_PREFIX = 'iOS native '
export const DISPATCH_WORKFLOW = '.github/workflows/ios-native-dispatch.yml'
export const GATE_STATUS = 'gate'
const WORKFLOW_FILE = 'ios-native-dispatch.yml'
const COMMIT = /^[0-9a-f]{40}$/
// The largest mobile source the judge reads for a native binding; a larger one fails closed.
const BINDING_BLOB_LIMIT = 1024 * 1024
// GitHub rejects a commit status description longer than this.
export const DESCRIPTION_LIMIT = 140

/** The commit a run says it tested, from its name; null for any other name. */
export function runCommit(run) {
  const title = String(run?.display_title ?? '')
  if (!title.startsWith(RUN_NAME_PREFIX)) return null
  const sha = title.slice(RUN_NAME_PREFIX.length)
  return COMMIT.test(sha) ? sha : null
}

/** The commit a completed run tested when it is evidence at all: a dispatch from main naming one. */
export function dispatchedCommit(run) {
  if (
    run?.path !== DISPATCH_WORKFLOW ||
    run?.event !== 'workflow_dispatch' ||
    run?.head_branch !== 'main'
  )
    return null
  return runCommit(run)
}

// Only the evidence workflow may post the status or hold a permission that could. The guard reads
// every workflow and local action file at the head that differs from main's, renamed ones
// included, whole: a workflow's permissions are parsed as YAML (quoted keys, flow mappings and
// aliases resolve as GitHub reads them) and fail on statuses or checks write and write-all, and
// any such file that names the status context fails too.
//
// The evidence workflow posts the status itself, so it may name the context and hold the grant;
// its copy at the head fails when a trigger other than pull_request_target or
// workflow_run could run it before the merge (those two run main's copy).
//
// Its boundary: it blocks a pull request that adds a status-capable grant or names the context in
// a workflow or local action. It cannot read intent in a helper script a workflow calls, so the
// workflows that already hold statuses: write stay limited to trusted code on their trusted
// paths: ios-native-evidence.yml runs main's copy (pull_request_target and workflow_run), and
// pr-gate.yml's workflow_run path runs main's copy. pr-gate.yml's pull_request path runs the pull
// request's copy, so a pull request that edits pr-gate.yml differs from main and fails this guard.
const GUARDED_FILE = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/
const WORKFLOW_FILE_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/
const CONTEXT = new RegExp(`(?<![\\w./-])${STATUS_CONTEXT}(?![\\w./-])`)
const STATUS_SCOPES = ['statuses', 'checks']
// The triggers that run main's copy of a workflow: pull_request_target runs the base branch's
// file, workflow_run the default branch's.
const MAIN_COPY_TRIGGERS = ['pull_request_target', 'workflow_run']

/** A workflow as GitHub reads it, through yq on the runner: aliases and merge keys resolved. */
export function yqParse(text) {
  return JSON.parse(
    execFileSync('yq', ['-o=json', 'explode(.)', '-'], { input: text, encoding: 'utf8' })
  )
}

/** The status-capable grants in one parsed workflow: workflow and job permissions. */
export function statusGrants(workflow) {
  const grants = []
  const blocks = [
    ['the workflow', workflow?.permissions],
    ...Object.entries(workflow?.jobs ?? {}).map(([name, job]) => [
      `job ${name}`,
      job?.permissions,
    ]),
  ]
  for (const [where, permissions] of blocks) {
    if (permissions === 'write-all') grants.push(`${where} grants write-all`)
    if (permissions && typeof permissions === 'object')
      for (const scope of STATUS_SCOPES)
        if (permissions[scope] === 'write') grants.push(`${where} grants ${scope}: write`)
  }
  return grants
}

/** The triggers of a parsed workflow, or null when its `on` has no shape GitHub reads. */
export function workflowTriggers(workflow) {
  // yq on the runner keeps the key `on`; a YAML 1.1 reader turns it into true.
  const on = workflow?.on ?? workflow?.true
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.every((name) => typeof name === 'string') ? on : null
  if (on && typeof on === 'object') return Object.keys(on)
  return null
}

/** Why the evidence workflow at the head could run before the merge. */
function evidenceWorkflowProblems(workflow) {
  const triggers = workflowTriggers(workflow)
  if (!triggers?.length)
    return [`${EVIDENCE_WORKFLOW} declares no trigger the guard can read`]
  return triggers
    .filter((name) => !MAIN_COPY_TRIGGERS.includes(name))
    .map(
      (name) =>
        `${EVIDENCE_WORKFLOW} runs on ${name}; its triggers may only be ${MAIN_COPY_TRIGGERS.join(' and ')}`
    )
}

/**
 * The workflow and local action files at the head commit whose content differs from main's at
 * the same path: added, edited and renamed ones, the evidence workflow included. Each tree is a
 * git trees API listing.
 */
export function changedGuardedFiles(headTree, mainTree) {
  const main = new Map(
    (mainTree ?? [])
      .filter((entry) => entry.type === 'blob')
      .map((entry) => [entry.path, entry.sha])
  )
  return (headTree ?? []).filter(
    (entry) =>
      entry.type === 'blob' &&
      GUARDED_FILE.test(entry.path) &&
      main.get(entry.path) !== entry.sha
  )
}

/** Why these whole files could post the evidence status; `files` holds `{ path, text }`. */
export function workflowGuardProblems(files, { parseYaml = yqParse } = {}) {
  const problems = []
  for (const file of files) {
    const evidence = file.path === EVIDENCE_WORKFLOW
    if (!evidence && CONTEXT.test(file.text))
      problems.push(`${file.path} names the ${STATUS_CONTEXT} context`)
    if (!WORKFLOW_FILE_PATH.test(file.path)) continue
    let workflow
    try {
      workflow = parseYaml(file.text)
    } catch (error) {
      problems.push(`${file.path} could not be parsed: ${error.message.split('\n')[0]}`)
      continue
    }
    if (evidence) problems.push(...evidenceWorkflowProblems(workflow))
    else
      for (const grant of statusGrants(workflow)) problems.push(`${file.path}: ${grant}`)
  }
  return problems
}

/**
 * The paths that differ between two git trees API listings: added, removed and edited files, and
 * both paths of a rename.
 */
export function treeChanges(baseTree, headTree) {
  const files = (tree) =>
    new Map(
      (tree ?? [])
        .filter((entry) => entry.type !== 'tree')
        .map((entry) => [entry.path, entry.sha])
    )
  const base = files(baseTree)
  const head = files(headTree)
  return [...new Set([...base.keys(), ...head.keys()])]
    .filter((path) => base.get(path) !== head.get(path))
    .sort()
}

const fit = (text) =>
  text.length <= DESCRIPTION_LIMIT ? text : `${text.slice(0, DESCRIPTION_LIMIT - 3)}...`

/**
 * The status a pull request head gets. Only a workflow_dispatch run from main whose name carries
 * exactly the head commit counts; the newest such run decides, and its own commit must be on
 * refs/heads/main (`fromMain`). `dependencies` says whether the shared dependency files changed
 * what iOS installs (scripts/ci/ios-native-inputs.mjs); `guard` lists the workflows at the head
 * that could post this status; `bindings` lists the changed mobile sources that bind a native
 * module at the head or the merge base; `incomplete` says why the diff could not be read whole.
 * @returns {{ state: 'success' | 'pending' | 'failure', description: string, detail: string }}
 */
export function evaluateEvidence({
  headSha,
  files,
  runs,
  inputs,
  dependencies,
  guard = [],
  bindings = [],
  incomplete = null,
}) {
  const verdict = (state, detail, description = detail) => ({
    state,
    description: fit(description),
    detail,
  })
  if (!COMMIT.test(headSha ?? '')) return verdict('failure', 'The head commit is unknown')
  // An incomplete diff could hide a native or workflow change, so it never passes.
  if (incomplete)
    return verdict(
      'failure',
      `The changed files of ${headSha} could not all be read: ${incomplete}`,
      `The changed files could not all be read: ${incomplete}`
    )
  if (!files) return verdict('failure', 'The changed files could not be read')
  if (guard === null) return verdict('failure', 'The workflow files could not be read')
  if (guard.length)
    return verdict(
      'failure',
      `Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}: ${guard.join('; ')}`,
      guard.join('; ')
    )
  const listed = nativeIosChanges(files, inputs, dependencies)
  const changed = [...listed, ...bindings.filter((file) => !listed.includes(file))]
  if (changed.length === 0) return verdict('success', 'No native iOS input changed')
  const what = `${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''} changed`
  const [latest] = (runs ?? [])
    .filter((run) => dispatchedCommit(run) === headSha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  if (!latest)
    return verdict(
      'failure',
      `${what}; no ios-native run tested ${headSha}: dispatch ios-native-dispatch.yml from main with sha ${headSha}`,
      `Dispatch ios-native-dispatch.yml from main with sha ${headSha}`
    )
  const where = `ios-native run ${latest.id}`
  if (latest.fromMain !== true)
    return verdict(
      'failure',
      `${what}; ${where} (${latest.html_url}) ran from a ref named main whose commit ${latest.head_sha} is not on refs/heads/main`,
      `${where} did not run from refs/heads/main; dispatch ios-native-dispatch.yml from the main branch`
    )
  if (latest.status !== 'completed')
    return verdict(
      'pending',
      `${what}; ${where} (${latest.html_url}) is ${latest.status}`,
      `${where} is ${latest.status}; this status updates when it completes`
    )
  if (latest.conclusion !== 'success')
    return verdict(
      'failure',
      `${what}; ${where} (${latest.html_url}) ended ${latest.conclusion}`,
      `${where} ended ${latest.conclusion}: fix it and dispatch ios-native-dispatch.yml again`
    )
  // A run can succeed with skipped jobs; only one whose every iOS job passed is evidence.
  if (latest.jobsPassed !== true)
    return verdict(
      'failure',
      `${what}; ${where} (${latest.html_url}) succeeded with an iOS job that did not pass`,
      `${where} succeeded with an iOS job skipped or missing: dispatch ios-native-dispatch.yml again`
    )
  return verdict('success', `${what}; ${where} (${latest.html_url}) passed on ${headSha}`)
}

/**
 * The dispatch runs of ios-native-dispatch.yml, newest first, down to the newest one whose name
 * carries `headSha`. A dispatch of a commit comes after the commit, so the search starts a day
 * before its committer date and pages to the end.
 */
async function dispatchRuns({ repository, headSha, ...options }) {
  const commit = await api(`/repos/${repository}/commits/${headSha}`, options)
  const date = Date.parse(commit?.commit?.committer?.date ?? '')
  const since = Number.isFinite(date)
    ? `&created=${encodeURIComponent(`>=${new Date(date - 86_400_000).toISOString().slice(0, 10)}`)}`
    : ''
  const runs = []
  for (let page = 1; ; page++) {
    const body = await api(
      `/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=100&page=${page}${since}`,
      options
    )
    const entries = body.workflow_runs ?? []
    runs.push(...entries)
    if (entries.length < 100) return runs
  }
}

/** Whether a run's own commit is on refs/heads/main: a branch named main, never a tag. */
async function onMain({ repository, sha, ...options }) {
  const compare = await api(
    `/repos/${repository}/compare/refs/heads/main...${sha}`,
    options
  )
  return ['identical', 'behind'].includes(compare?.status)
}

/** The newest dispatch of `headSha`, marked with whether it ran from refs/heads/main. */
async function evidenceRuns(options) {
  const runs = (await dispatchRuns(options))
    .filter((run) => dispatchedCommit(run) === options.headSha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  for (const run of runs) {
    if (run.status === 'completed') {
      const jobs = await runJobs({ ...options, id: run.id })
      // The dispatch gate stops a dispatch of a commit that already passed: that run is no one's
      // evidence, and the earlier one still decides.
      if (
        jobs.some((job) => job.name === DISPATCH_GATE_JOB && job.conclusion !== 'success')
      )
        continue
      run.jobsPassed = runJobsPassed(jobs, options.graphs.dispatch, { dispatch: true })
    }
    run.fromMain = await onMain({ ...options, sha: run.head_sha })
    return [run]
  }
  return []
}

/** A recursive git trees API listing, or null when it is missing or truncated. */
async function wholeTree({ repository, sha, ...options }) {
  if (!COMMIT.test(sha ?? '')) return null
  const body = await api(`/repos/${repository}/git/trees/${sha}?recursive=1`, options)
  return body && !body.truncated ? body.tree : null
}

/**
 * The immutable trees one judgment reads: the head commit the event names, main, and, with a base
 * commit, the merge base of base...head. Every one is addressed by commit, so a later push to the
 * pull request cannot change what this judgment sees.
 */
async function snapshot({ repository, baseSha, headSha, ...options }) {
  const main = await api(`/repos/${repository}/git/ref/heads/main`, options)
  const mergeBase =
    baseSha === undefined
      ? undefined
      : (await api(`/repos/${repository}/compare/${baseSha}...${headSha}`, options))
          ?.merge_base_commit?.sha
  const [head, mainTree, base] = await Promise.all(
    [headSha, main?.object?.sha, mergeBase].map((sha) =>
      wholeTree({ ...options, repository, sha })
    )
  )
  const unread = [
    ['the head commit', head],
    ['main', mainTree],
    ...(baseSha === undefined ? [] : [['the merge base', base]]),
  ]
    .filter(([, tree]) => tree === null)
    .map(([name]) => name)
  return {
    mergeBase,
    head,
    main: mainTree,
    base,
    incomplete: unread.length
      ? `the trees of ${unread.join(', ')} are missing or truncated`
      : null,
  }
}

/** The workflows and local actions at the head that could post the evidence status. */
async function guardProblems({ repository, trees, parseYaml, ...options }) {
  const files = []
  for (const entry of changedGuardedFiles(trees.head, trees.main)) {
    const blob = await api(`/repos/${repository}/git/blobs/${entry.sha}`, options)
    files.push({
      path: entry.path,
      text: Buffer.from(blob?.content ?? '', 'base64').toString('utf8'),
    })
  }
  return workflowGuardProblems(files, parseYaml ? { parseYaml } : {})
}

/** A blob's text, or null when the API did not return it whole or it is over the limit. */
async function blobText({ repository, sha, ...options }) {
  const blob = await api(`/repos/${repository}/git/blobs/${sha}`, options)
  if (
    blob?.encoding !== 'base64' ||
    !Number.isInteger(blob.size) ||
    blob.size > BINDING_BLOB_LIMIT
  )
    return null
  const bytes = Buffer.from(blob.content ?? '', 'base64')
  return bytes.length === blob.size ? bytes.toString('utf8') : null
}

/**
 * C14-01: the changed mobile sources that bind a native module at the head commit or, for an
 * edit, a deletion or the old path of a rename, at the merge base. The content is data read by
 * blob through main's copy of NATIVE_BINDING, so a pull request that adds a binding and edits
 * the lists needs its dispatch all the same. `incomplete` names a blob that could not be read.
 */
async function nativeBindings({ repository, trees, files, ...options }) {
  const blobs = (tree) =>
    new Map(
      (tree ?? [])
        .filter((entry) => entry.type === 'blob')
        .map((entry) => [entry.path, entry.sha])
    )
  const sides = [blobs(trees.head), blobs(trees.base)]
  const texts = new Map()
  const bindings = []
  for (const file of files.filter(bindingCandidate))
    for (const sha of new Set(sides.map((side) => side.get(file)).filter(Boolean))) {
      if (!texts.has(sha)) texts.set(sha, await blobText({ ...options, repository, sha }))
      const text = texts.get(sha)
      if (text === null)
        return { bindings, incomplete: `the content of ${file} could not be read whole` }
      if (NATIVE_BINDING.test(text)) {
        bindings.push(file)
        break
      }
    }
  return { bindings, incomplete: null }
}

/**
 * Whether the shared dependency files changed what iOS installs, read at the merge base and the
 * head commit, the two ends of the pull request's own diff.
 */
async function headDependencies({
  repository,
  mergeBase,
  headSha,
  files,
  jobsText,
  ...options
}) {
  if (!files.includes(LOCKFILE) && !files.includes(ROOT_MANIFEST)) return {}
  const sides = { before: mergeBase, after: headSha }
  const read = (side, file) =>
    api(`/repos/${repository}/contents/${file}?ref=${sides[side]}`, {
      ...options,
      raw: true,
    })
  return dependencyChanges(read, jobsText)
}

/** The verdict for one pull request head, from main's copy of the rules and immutable reads. */
async function judge({ headSha, baseSha, ...options }) {
  const jobsText = readFileSync(IOS_JOBS_WORKFLOW, 'utf8')
  const inputs = evidenceInputs(pushPaths(readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')))
  try {
    if (!COMMIT.test(baseSha ?? ''))
      throw new Error(`the base commit ${baseSha} is unknown`)
    const trees = await snapshot({ ...options, baseSha, headSha })
    if (trees.incomplete)
      return evaluateEvidence({ headSha, inputs, incomplete: trees.incomplete })
    const files = treeChanges(trees.base, trees.head)
    const guard = await guardProblems({ ...options, trees })
    // The jobs a whole dispatch runs, from main's copies of the dispatch and jobs files.
    const runs = await evidenceRuns({ ...options, headSha, graphs: runGraphs() })
    const dependencies = await headDependencies({
      ...options,
      mergeBase: trees.mergeBase,
      headSha,
      files,
      jobsText,
    })
    // A listed input already needs the dispatch, so the content is read only when none changed.
    const { bindings, incomplete } = nativeIosChanges(files, inputs, dependencies).length
      ? { bindings: [], incomplete: null }
      : await nativeBindings({ ...options, trees, files })
    return evaluateEvidence({
      headSha,
      files,
      runs,
      inputs,
      dependencies,
      guard,
      bindings,
      incomplete,
    })
  } catch (error) {
    console.log(`::error::Could not read the evidence: ${error.message}`)
    return evaluateEvidence({ headSha, files: null, runs: [], inputs })
  }
}

function report(env, number, headSha, verdict) {
  console.log(`#${number} ${headSha}: ${verdict.state}: ${verdict.detail}`)
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### iOS native evidence for #${number}\n\n${verdict.state}: ${verdict.detail}\n`
    )
}

const oneLine = (text) => text.replace(/[\r\n]+/g, ' ')

/**
 * pull_request_target: the verdict for the head commit the event names, as the step outputs
 * `state` and `description`. The live head may have moved since; that push gets its own event.
 */
export async function pullRequest({ env = process.env, fetchImpl, parseYaml } = {}) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const pull = payload.pull_request
  const headSha = pull?.head?.sha
  const verdict = await judge({
    headSha,
    baseSha: pull?.base?.sha,
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
    parseYaml,
  })
  report(env, pull?.number, headSha, verdict)
  if (env.GITHUB_OUTPUT)
    appendFileSync(
      env.GITHUB_OUTPUT,
      `state=${verdict.state}\ndescription=${oneLine(verdict.description)}\n`
    )
  return verdict
}

/** The open pull requests whose head is `sha`. */
async function openPullsWithHead({ repository, sha, ...options }) {
  const pulls = []
  for (let page = 1; ; page++) {
    const entries = await api(
      `/repos/${repository}/pulls?state=open&per_page=100&page=${page}`,
      options
    )
    pulls.push(...entries)
    if (entries.length < 100) return pulls.filter((pull) => pull.head?.sha === sha)
  }
}

/**
 * pr-gate.yml, after PR Gate posts its verdict: when an open pull request's head holds a workflow
 * that could post the evidence status, the gate status on that head turns to failure, so a job
 * that posts the evidence status after the judge still cannot unblock the merge. A read that
 * fails turns it to failure too, since PR Gate's own verdict may already be success; a failure
 * this cannot post fails the step, and pr-gate.yml's fallback step posts it.
 */
export async function gateGuard({ env = process.env, fetchImpl, parseYaml } = {}) {
  const sha = env.HEAD_SHA ?? ''
  const options = {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
    parseYaml,
  }
  const failGate = (description) =>
    api(`/repos/${options.repository}/statuses/${sha}`, {
      ...options,
      method: 'POST',
      body: {
        state: 'failure',
        context: GATE_STATUS,
        description: fit(description),
        target_url: `${env.GITHUB_SERVER_URL}/${options.repository}/actions/runs/${env.GITHUB_RUN_ID}`,
      },
    })
  if (!COMMIT.test(sha)) {
    console.log(`No head commit (${sha || 'none'}); nothing to guard.`)
    return []
  }
  let problems
  try {
    if ((await openPullsWithHead({ ...options, sha })).length === 0) {
      console.log(`No open pull request has head ${sha}; nothing to guard.`)
      return []
    }
    const trees = await snapshot({ ...options, headSha: sha })
    problems = trees.incomplete
      ? [`the workflow files could not all be read: ${trees.incomplete}`]
      : await guardProblems({ ...options, trees })
  } catch (error) {
    const reason = `The iOS evidence guard could not read the head: ${error.message}`
    console.log(`::error::${reason}`)
    await failGate(reason)
    return [reason]
  }
  if (problems.length === 0) {
    console.log(`No workflow at ${sha} can post ${STATUS_CONTEXT}.`)
    return []
  }
  console.log(
    `::error::Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}: ${problems.join('; ')}`
  )
  await failGate(`A workflow could post ${STATUS_CONTEXT}: ${problems.join('; ')}`)
  return problems
}

/**
 * workflow_run of ios-native-dispatch.yml: when the completed run is a dispatch of that file from
 * main naming a commit, judge each open pull request whose head is that commit again and post its
 * status. Any other run is no one's evidence and posts nothing.
 */
export async function dispatchCompleted({
  env = process.env,
  fetchImpl,
  parseYaml,
} = {}) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const sha = dispatchedCommit(payload.workflow_run)
  if (!sha) {
    console.log('Not a dispatch from main naming a commit; no status to post.')
    return []
  }
  const options = {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
    parseYaml,
  }
  const posted = []
  for (const pull of await openPullsWithHead({ ...options, sha })) {
    const verdict = await judge({
      ...options,
      headSha: sha,
      baseSha: pull.base?.sha,
    })
    report(env, pull.number, sha, verdict)
    await api(`/repos/${options.repository}/statuses/${sha}`, {
      ...options,
      method: 'POST',
      body: {
        state: verdict.state,
        context: STATUS_CONTEXT,
        description: verdict.description,
        target_url: `${env.GITHUB_SERVER_URL}/${options.repository}/actions/runs/${env.GITHUB_RUN_ID}`,
      },
    })
    posted.push({ number: pull.number, state: verdict.state })
  }
  if (posted.length === 0) console.log(`No open pull request has head ${sha}.`)
  return posted
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const mode = process.argv[2]
  if (mode === 'pull-request') await pullRequest()
  else if (mode === 'dispatch-completed') await dispatchCompleted()
  else if (mode === 'gate-guard') await gateGuard()
  else {
    console.error(
      'usage: ios-native-evidence.mjs pull-request | dispatch-completed | gate-guard'
    )
    process.exitCode = 2
  }
}
