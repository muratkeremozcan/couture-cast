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
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  IOS_JOBS_WORKFLOW,
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  dependencyChanges,
  evidenceInputs,
  nativeIosChanges,
  pushPaths,
} from './ios-native-inputs.mjs'

export const EVIDENCE_WORKFLOW = '.github/workflows/ios-native-evidence.yml'
export const STATUS_CONTEXT = 'ios-native-evidence'
export const RUN_NAME_PREFIX = 'iOS native '
export const DISPATCH_WORKFLOW = '.github/workflows/ios-native-dispatch.yml'
export const GATE_STATUS = 'gate'
const WORKFLOW_FILE = 'ios-native-dispatch.yml'
const COMMIT = /^[0-9a-f]{40}$/
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

// Only the evidence workflow may post the status or hold a permission that could. A pull
// request's own workflows run with its edits (pr-gate.yml on pull_request among them), so every
// workflow and local action file at its head that differs from main's, renamed ones included, is
// read whole.
const GUARDED_FILE = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/
const GRANTS = [
  [/["']?\bstatuses\b["']?\s*:\s*["']?write\b/, 'statuses: write'],
  [/["']?\bchecks\b["']?\s*:\s*["']?write\b/, 'checks: write'],
  [/\bwrite-all\b/, 'write-all'],
  [
    new RegExp(`(?<![\\w./-])${STATUS_CONTEXT}(?![\\w./-])`),
    `the ${STATUS_CONTEXT} context`,
  ],
]

/**
 * The workflow and local action files at the head commit whose content differs from main's at
 * the same path: added, edited and renamed ones. Each tree is a git trees API listing.
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
      entry.path !== EVIDENCE_WORKFLOW &&
      main.get(entry.path) !== entry.sha
  )
}

/** Why these whole files could post the evidence status; `files` holds `{ path, text }`. */
export function workflowGuardProblems(files) {
  const problems = []
  for (const file of files)
    for (const [pattern, what] of GRANTS)
      if (pattern.test(file.text)) problems.push(`${file.path} holds ${what}`)
  return problems
}

const fit = (text) =>
  text.length <= DESCRIPTION_LIMIT ? text : `${text.slice(0, DESCRIPTION_LIMIT - 3)}...`

/**
 * The status a pull request head gets. Only a workflow_dispatch run from main whose name carries
 * exactly the head commit counts; the newest such run decides, and its own commit must be on
 * refs/heads/main (`fromMain`). `dependencies` says whether the shared dependency files changed
 * what iOS installs (scripts/ci/ios-native-inputs.mjs); `guard` lists the workflows at the head
 * that could post this status.
 * @returns {{ state: 'success' | 'pending' | 'failure', description: string, detail: string }}
 */
export function evaluateEvidence({
  headSha,
  files,
  runs,
  inputs,
  dependencies,
  guard = [],
}) {
  const verdict = (state, detail, description = detail) => ({
    state,
    description: fit(description),
    detail,
  })
  if (!COMMIT.test(headSha ?? '')) return verdict('failure', 'The head commit is unknown')
  if (!files) return verdict('failure', 'The changed files could not be read')
  if (guard === null) return verdict('failure', 'The workflow files could not be read')
  if (guard.length)
    return verdict(
      'failure',
      `Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}: ${guard.join('; ')}`,
      guard.join('; ')
    )
  const changed = nativeIosChanges(files, inputs, dependencies)
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
  return verdict('success', `${what}; ${where} (${latest.html_url}) passed on ${headSha}`)
}

async function api(
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

/** Every file of a pull request with its patch; GitHub lists at most 3000. */
async function pullFiles({ repository, number, ...options }) {
  const files = []
  for (let page = 1; page <= 30; page++) {
    const entries = await api(
      `/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`,
      options
    )
    files.push(...entries)
    if (entries.length < 100) return files
  }
  // Past 3000 files the list stops; judge the rest as a native iOS change with an unread diff.
  return [...files, { filename: 'package-lock.json', status: 'modified' }]
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
    if (entries.some((run) => dispatchedCommit(run) === headSha) || entries.length < 100)
      return runs
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
  const runs = await dispatchRuns(options)
  const [latest] = runs
    .filter((run) => dispatchedCommit(run) === options.headSha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  if (latest) latest.fromMain = await onMain({ ...options, sha: latest.head_sha })
  return latest ? [latest] : []
}

/** The workflows and local actions at `headSha` that could post the evidence status. */
async function guardProblems({ repository, headSha, ...options }) {
  const main = await api(`/repos/${repository}/git/ref/heads/main`, options)
  const [headTree, mainTree] = await Promise.all(
    [headSha, main?.object?.sha].map((sha) =>
      api(`/repos/${repository}/git/trees/${sha}?recursive=1`, options)
    )
  )
  if (!headTree || !mainTree || headTree.truncated || mainTree.truncated)
    return ['the workflow files at the head commit could not all be listed']
  const files = []
  for (const entry of changedGuardedFiles(headTree.tree, mainTree.tree)) {
    const blob = await api(`/repos/${repository}/git/blobs/${entry.sha}`, options)
    files.push({
      path: entry.path,
      text: Buffer.from(blob?.content ?? '', 'base64').toString('utf8'),
    })
  }
  return workflowGuardProblems(files)
}

/**
 * Whether the shared dependency files changed what iOS installs, comparing the merge base with
 * the head commit, as the pull request's file list does.
 */
async function pullDependencies({
  repository,
  baseSha,
  headSha,
  files,
  jobsText,
  ...options
}) {
  const names = files.flatMap((file) => [file.filename, file.previous_filename])
  if (!names.includes(LOCKFILE) && !names.includes(ROOT_MANIFEST)) return {}
  const compare = await api(
    `/repos/${repository}/compare/${baseSha}...${headSha}`,
    options
  )
  const sides = { before: compare?.merge_base_commit?.sha, after: headSha }
  const read = (side, file) =>
    sides[side]
      ? api(`/repos/${repository}/contents/${file}?ref=${sides[side]}`, {
          ...options,
          raw: true,
        })
      : null
  return dependencyChanges(read, jobsText)
}

/** The verdict for one pull request head, from main's copy of the rules. */
async function judge({ headSha, baseSha, number, ...options }) {
  const jobsText = readFileSync(IOS_JOBS_WORKFLOW, 'utf8')
  let files = null
  let runs = []
  let dependencies = {}
  let guard = null
  try {
    files = await pullFiles({ ...options, number })
    guard = await guardProblems({ ...options, headSha })
    runs = await evidenceRuns({ ...options, headSha })
    dependencies = await pullDependencies({
      ...options,
      baseSha,
      headSha,
      files,
      jobsText,
    })
  } catch (error) {
    console.log(`::error::Could not read the evidence: ${error.message}`)
    files = null
  }
  const inputs = evidenceInputs(pushPaths(readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')))
  return evaluateEvidence({ headSha, files, runs, inputs, dependencies, guard })
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
export async function pullRequest({ env = process.env, fetchImpl } = {}) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const pull = payload.pull_request
  const headSha = pull?.head?.sha
  const verdict = await judge({
    headSha,
    baseSha: pull?.base?.sha,
    number: pull?.number,
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
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
 * that posts the evidence status after the judge still cannot unblock the merge.
 */
export async function gateGuard({ env = process.env, fetchImpl } = {}) {
  const sha = env.HEAD_SHA ?? ''
  const options = {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
  }
  if (!COMMIT.test(sha) || (await openPullsWithHead({ ...options, sha })).length === 0) {
    console.log(`No open pull request has head ${sha}; nothing to guard.`)
    return []
  }
  const problems = await guardProblems({ ...options, headSha: sha })
  if (problems.length === 0) {
    console.log(`No workflow at ${sha} can post ${STATUS_CONTEXT}.`)
    return []
  }
  console.log(
    `::error::Only ${EVIDENCE_WORKFLOW} may post ${STATUS_CONTEXT}: ${problems.join('; ')}`
  )
  await api(`/repos/${options.repository}/statuses/${sha}`, {
    ...options,
    method: 'POST',
    body: {
      state: 'failure',
      context: GATE_STATUS,
      description: fit(`A workflow could post ${STATUS_CONTEXT}: ${problems.join('; ')}`),
      target_url: `${env.GITHUB_SERVER_URL}/${options.repository}/actions/runs/${env.GITHUB_RUN_ID}`,
    },
  })
  return problems
}

/**
 * workflow_run of ios-native-dispatch.yml: when the completed run is a dispatch of that file from
 * main naming a commit, judge each open pull request whose head is that commit again and post its
 * status. Any other run is no one's evidence and posts nothing.
 */
export async function dispatchCompleted({ env = process.env, fetchImpl } = {}) {
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
  }
  const posted = []
  for (const pull of await openPullsWithHead({ ...options, sha })) {
    const verdict = await judge({
      ...options,
      headSha: sha,
      baseSha: pull.base?.sha,
      number: pull.number,
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
