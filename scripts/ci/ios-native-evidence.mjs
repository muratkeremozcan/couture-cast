#!/usr/bin/env node
// Story 6.15 D1 and D6, test design C-11: a pull request that changes a native iOS input merges
// only with iOS evidence on its exact head commit. That evidence is a successful run of
// ios-native.yml, dispatched from main (so main's copy of the workflow ran, never one the pull
// request edited) with `sha` set to the head commit. The runs API does not return dispatch inputs,
// so the run name carries the commit ("iOS native <sha>"), and every job of the run fails unless it
// checked out exactly that commit. A new push moves the head, so the check goes red again until
// the new head is dispatched.
//
//   check   (pull_request) fails unless the head commit has that evidence or needs none.
//   rerun   (workflow_run of ios-native.yml) re-runs the failed check of every open pull request
//           whose head commit that dispatch tested, so the check turns green without a new push.
//
// The jobs run this file from a sparse checkout with no install: it imports Node built-ins and the
// lane map, which imports Node built-ins only.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LANES, matchesAny } from './lanes.mjs'

export const WORKFLOW_FILE = 'ios-native.yml'
export const EVIDENCE_WORKFLOW_FILE = 'ios-native-evidence.yml'
export const RUN_NAME_PREFIX = 'iOS native '
const COMMIT = /^[0-9a-f]{40}$/

/** The commit a run says it tested, from its name; null for any other name. */
export function runCommit(run) {
  const title = String(run?.display_title ?? run?.name ?? '')
  if (!title.startsWith(RUN_NAME_PREFIX)) return null
  const sha = title.slice(RUN_NAME_PREFIX.length)
  return COMMIT.test(sha) ? sha : null
}

/** The changed files that ios-native.yml builds, runs or reads. */
export function nativeIosChanges(files) {
  return files.filter((file) => matchesAny(file, LANES['ios-native'].inputs))
}

/**
 * Whether a pull request's head commit has its iOS evidence. Only a workflow_dispatch run from
 * main whose name carries exactly the head commit counts; the newest such run decides, and it
 * must have completed with success.
 * @returns {{ ok: boolean, reason: string, run?: object }}
 */
export function evaluateEvidence({ headSha, files, runs }) {
  if (!COMMIT.test(headSha ?? ''))
    return { ok: false, reason: 'the pull request head commit is unknown' }
  if (!files) return { ok: false, reason: 'the changed files could not be read' }
  const changed = nativeIosChanges(files)
  if (changed.length === 0)
    return {
      ok: true,
      reason: 'no native iOS input changed, so no iOS evidence is needed',
    }
  const what = `${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''} changed`
  const dispatch = `dispatch ios-native.yml from main with sha ${headSha}`
  const candidates = (runs ?? [])
    .filter(
      (run) =>
        run.event === 'workflow_dispatch' &&
        run.head_branch === 'main' &&
        runCommit(run) === headSha
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const [latest] = candidates
  if (!latest)
    return {
      ok: false,
      reason: `${what}; no ios-native run tested ${headSha}: ${dispatch}`,
    }
  const where = `run ${latest.id} (${latest.html_url ?? 'no link'})`
  if (latest.status !== 'completed')
    return {
      ok: false,
      reason: `${what}; ${where} is ${latest.status}; this check re-runs when it completes`,
      run: latest,
    }
  if (latest.conclusion !== 'success')
    return {
      ok: false,
      reason: `${what}; ${where} ended ${latest.conclusion}: fix it and ${dispatch}`,
      run: latest,
    }
  return { ok: true, reason: `${what}; ${where} passed on ${headSha}`, run: latest }
}

async function api(path, { token, fetchImpl = fetch, method = 'GET' }) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`)
  return response.status === 204 || method !== 'GET' ? null : response.json()
}

/** Every file between the pull request's base and head, old paths of renames included. */
async function changedFiles({ repository, base, head, ...options }) {
  const files = []
  for (let page = 1; page <= 30; page++) {
    const body = await api(
      `/repos/${repository}/compare/${base}...${head}?per_page=100&page=${page}`,
      options
    )
    const entries = body.files ?? []
    for (const entry of entries)
      files.push(
        entry.filename,
        ...(entry.previous_filename ? [entry.previous_filename] : [])
      )
    if (entries.length < 100) return files
  }
  // The comparison stops listing files at 3000; treat the rest as native iOS changes.
  return [...files, 'package-lock.json']
}

/** The dispatch runs of ios-native.yml on main, newest first, up to 300. */
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

/** The pull_request check: exits 1 unless the head commit has its evidence or needs none. */
export async function check({ env = process.env, fetchImpl } = {}) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const pr = payload.pull_request
  const options = {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
  }
  let files = null
  let runs = []
  try {
    files = await changedFiles({ ...options, base: pr?.base?.sha, head: pr?.head?.sha })
    runs = await dispatchRuns(options)
  } catch (error) {
    console.log(`::error::Could not read the evidence: ${error.message}`)
  }
  const verdict = evaluateEvidence({ headSha: pr?.head?.sha, files, runs })
  const line = `${verdict.ok ? 'iOS evidence: ' : '::error::iOS evidence missing: '}${verdict.reason}`
  console.log(line)
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### iOS native evidence\n\n${verdict.reason}\n`
    )
  return verdict.ok ? 0 : 1
}

/** After a dispatch completes: re-run the failed evidence check of each pull request it tested. */
export async function rerun({ env = process.env, fetchImpl } = {}) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const run = payload.workflow_run
  const sha = runCommit(run)
  if (run?.event !== 'workflow_dispatch' || run?.head_branch !== 'main' || !sha) {
    console.log('Not a dispatch from main naming a commit; nothing to re-run.')
    return 0
  }
  const options = {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    fetchImpl,
  }
  const pulls =
    (await api(`/repos/${options.repository}/commits/${sha}/pulls`, options)) ?? []
  for (const pull of pulls.filter(
    (item) => item.state === 'open' && item.head?.sha === sha
  )) {
    const body = await api(
      `/repos/${options.repository}/actions/workflows/${EVIDENCE_WORKFLOW_FILE}/runs?event=pull_request&head_sha=${sha}&per_page=20`,
      options
    )
    const [latest] = (body.workflow_runs ?? []).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    )
    if (latest?.status === 'completed' && latest.conclusion !== 'success') {
      await api(
        `/repos/${options.repository}/actions/runs/${latest.id}/rerun-failed-jobs`,
        {
          ...options,
          method: 'POST',
        }
      )
      console.log(`Re-ran the evidence check of #${pull.number} (run ${latest.id}).`)
    } else console.log(`#${pull.number}: no failed evidence check to re-run.`)
  }
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const mode = process.argv[2]
  if (!['check', 'rerun'].includes(mode)) {
    console.error('usage: ios-native-evidence.mjs check | rerun')
    process.exitCode = 2
  } else process.exitCode = await (mode === 'check' ? check() : rerun())
}
