#!/usr/bin/env node
// Story 6.15 D1 and D6, test design C-11: a pull request that changes a native iOS input merges
// only with iOS evidence on its exact head commit. That evidence is a successful run of
// ios-native.yml dispatched from main (so main's copy of the workflow ran, never one the pull
// request edited) with `sha` set to the head commit. The runs API does not return dispatch inputs,
// so the run name carries the commit ("iOS native <sha>"), and every job of the run fails unless it
// checked out exactly that commit.
//
// ios-native-evidence.yml runs this file from main, never from the pull request: on
// pull_request_target it judges the head commit named in the event payload and posts the verdict
// as the `ios-native-evidence` commit status on that commit; when an ios-native.yml dispatch
// completes, it judges every open pull request whose head that dispatch tested and posts the same
// status again. A new push moves the head, which has no status until it is judged.
//
//   pull-request        writes the state and description outputs the workflow posts.
//   dispatch-completed  posts the status on each open pull request the completed dispatch tested.
//
// The jobs run this file from a sparse checkout of main with no install: it imports Node
// built-ins and scripts/ci/ios-native-inputs.mjs, which decides what a native iOS change is.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  IOS_NATIVE_WORKFLOW,
  LOCKFILE,
  ROOT_MANIFEST,
  dependencyChanges,
  nativeIosChanges,
  pushPaths,
} from './ios-native-inputs.mjs'

export const EVIDENCE_WORKFLOW = '.github/workflows/ios-native-evidence.yml'
export const STATUS_CONTEXT = 'ios-native-evidence'
export const RUN_NAME_PREFIX = 'iOS native '
const WORKFLOW_FILE = 'ios-native.yml'
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
  if (run?.event !== 'workflow_dispatch' || run?.head_branch !== 'main') return null
  return runCommit(run)
}

// Only the evidence workflow may post the status or hold the permission to post one. A pull
// request's own workflows run with its edits, so a diff that grants them that is refused here.
const GUARDED = /^\.github\/(workflows|actions)\//
const GRANTS = [
  [/\bstatuses\s*:\s*['"]?write\b/, 'statuses: write'],
  [/\bwrite-all\b/, 'write-all'],
  [new RegExp(`\\b${STATUS_CONTEXT}\\b`), `the ${STATUS_CONTEXT} context`],
]

/** Why the diff could let a workflow other than the evidence workflow post its status. */
export function statusGuardProblems(files) {
  const problems = []
  for (const file of files) {
    if (!GUARDED.test(file.filename) || file.filename === EVIDENCE_WORKFLOW) continue
    if (file.status === 'removed' || (file.status === 'renamed' && !file.changes))
      continue
    if (typeof file.patch !== 'string') {
      problems.push(`${file.filename}: its diff is too large to read`)
      continue
    }
    const added = file.patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n')
    for (const [pattern, what] of GRANTS)
      if (pattern.test(added)) problems.push(`${file.filename} adds ${what}`)
  }
  return problems
}

const fit = (text) =>
  text.length <= DESCRIPTION_LIMIT ? text : `${text.slice(0, DESCRIPTION_LIMIT - 3)}...`

/**
 * The status a pull request head gets. Only a workflow_dispatch run from main whose name carries
 * exactly the head commit counts; the newest such run decides. `dependencies` says whether the
 * shared dependency files changed what iOS installs (scripts/ci/ios-native-inputs.mjs).
 * @returns {{ state: 'success' | 'pending' | 'failure', description: string, detail: string }}
 */
export function evaluateEvidence({ headSha, files, runs, inputs, dependencies }) {
  const verdict = (state, detail, description = detail) => ({
    state,
    description: fit(description),
    detail,
  })
  if (!COMMIT.test(headSha ?? '')) return verdict('failure', 'The head commit is unknown')
  if (!files) return verdict('failure', 'The changed files could not be read')
  const guard = statusGuardProblems(files)
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
      `${what}; no ios-native run tested ${headSha}: dispatch ios-native.yml from main with sha ${headSha}`,
      `Dispatch ios-native.yml from main with sha ${headSha}`
    )
  const where = `ios-native run ${latest.id}`
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
      `${where} ended ${latest.conclusion}: fix it and dispatch ios-native.yml again`
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

/** The newest dispatch runs of ios-native.yml on main, up to 300. */
async function dispatchRuns({ repository, ...options }) {
  const runs = []
  for (let page = 1; page <= 3; page++) {
    const body = await api(
      `/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=main&per_page=100&page=${page}`,
      options
    )
    runs.push(...(body.workflow_runs ?? []))
    if ((body.workflow_runs ?? []).length < 100) break
  }
  return runs
}

const workflowText = () => readFileSync(IOS_NATIVE_WORKFLOW, 'utf8')

/**
 * Whether the shared dependency files changed what iOS installs, comparing the merge base with
 * the head commit, as the pull request's file list does.
 */
async function pullDependencies({
  repository,
  baseSha,
  headSha,
  files,
  text,
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
  return dependencyChanges(read, text)
}

/** The verdict for one pull request head, from main's copy of the rules. */
async function judge({ headSha, baseSha, number, ...options }) {
  const text = workflowText()
  let files = null
  let runs = []
  let dependencies = {}
  try {
    files = await pullFiles({ ...options, number })
    runs = await dispatchRuns(options)
    dependencies = await pullDependencies({ ...options, baseSha, headSha, files, text })
  } catch (error) {
    console.log(`::error::Could not read the evidence: ${error.message}`)
    files = null
  }
  return evaluateEvidence({ headSha, files, runs, inputs: pushPaths(text), dependencies })
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

/**
 * workflow_run of ios-native.yml: when the completed run is a dispatch from main naming a commit,
 * judge each open pull request whose head is that commit again and post its status. Any other
 * run is no one's evidence and posts nothing.
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
  const pulls = []
  for (let page = 1; page <= 10; page++) {
    const entries = await api(
      `/repos/${options.repository}/pulls?state=open&per_page=100&page=${page}`,
      options
    )
    pulls.push(...entries)
    if (entries.length < 100) break
  }
  const posted = []
  for (const pull of pulls.filter((item) => item.head?.sha === sha)) {
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
  else {
    console.error('usage: ios-native-evidence.mjs pull-request | dispatch-completed')
    process.exitCode = 2
  }
}
