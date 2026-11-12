#!/usr/bin/env node
/**
 * Which commit the preview wait must find serving for one Vercel project.
 *
 * Normally the commit under test. When the project's ignored build step skipped that commit
 * (scripts/vercel-preview-inputs.mjs --ignore), Vercel reports the commit status
 * "Canceled by Ignored Build Step" with state success, and the branch's latest ready deployment
 * of the project stands in for it, once its inputs are confirmed unchanged here. A failed,
 * errored or rate-limited build reports state failure or error, and the wait fails on it.
 * A superseded deployment is not ignored and never stands in.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsChanged, projectBuildPaths } from './vercel-preview-inputs.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The description Vercel sets on the commit status of a build its ignore step skipped. */
export const IGNORED_DESCRIPTION = 'Canceled by Ignored Build Step'

/**
 * @typedef {{ context: string, state: string, description?: string | null }} CommitStatus
 * @typedef {{ sha: string, url: string, created: number }} ReadyDeployment
 * @typedef {{
 *   project: 'web' | 'api',
 *   projectSlug: string,
 *   expectedSha: string,
 *   cwd?: string,
 *   statuses: () => Promise<CommitStatus[]>,
 *   readyDeployments: () => Promise<ReadyDeployment[]>,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   intervalMs?: number,
 *   log?: (message: string) => void,
 * }} TargetInput
 */

/**
 * @param {TargetInput} input
 * @returns {Promise<{ sha: string, reason: string }>}
 */
export async function previewTarget({
  project,
  projectSlug,
  expectedSha,
  cwd = repoRoot,
  statuses,
  readyDeployments,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 76,
  intervalMs = 15_000,
  log = () => undefined,
}) {
  const paths = projectBuildPaths[project]
  if (!paths) throw new Error(`Unknown preview project ${JSON.stringify(project)}`)
  const context = `Vercel – ${projectSlug}`
  for (let attempt = 1; ; attempt++) {
    // GitHub lists a commit's statuses newest first.
    const status = (await statuses()).find((entry) => entry.context === context)
    if (status?.state === 'failure' || status?.state === 'error')
      throw new Error(
        `${context} for ${expectedSha} reported ${status.state}: ${status.description ?? 'no description'}`
      )
    if (status?.state === 'success' && status.description === IGNORED_DESCRIPTION)
      return standIn({ project, context, expectedSha, cwd, paths, readyDeployments, log })
    if (status?.state === 'success')
      return { sha: expectedSha, reason: `${context} built ${expectedSha}` }
    // Pending while queued, building or before the ignore step decides; a queued build
    // (Hobby builds one at a time) can wait minutes, so only a final status decides. 76 polls
    // 15 s apart keep the wait inside the 20 minutes the web build wait allowed before.
    if (attempt >= attempts)
      throw new Error(
        `${context} for ${expectedSha} is ${status ? `still ${status.state}` : 'not reported'} after ${(attempts * intervalMs) / 60_000} minutes`
      )
    log(`${context}: ${status?.state ?? 'no status'} (attempt ${attempt}/${attempts})`)
    await sleep(intervalMs)
  }
}

/** @param {{ project: string, context: string, expectedSha: string, cwd: string, paths: string[], readyDeployments: () => Promise<ReadyDeployment[]>, log: (m: string) => void }} input */
async function standIn({
  project,
  context,
  expectedSha,
  cwd,
  paths,
  readyDeployments,
  log,
}) {
  const ready = (await readyDeployments())
    .filter((deployment) => deployment.sha !== expectedSha)
    .sort((a, b) => b.created - a.created)
  const latest = ready[0]
  if (!latest)
    throw new Error(
      `${context} skipped ${expectedSha}, but this branch has no ready ${project} deployment to stand in`
    )
  const diff = inputsChanged(cwd, latest.sha, expectedSha, paths)
  if ('reason' in diff)
    throw new Error(
      `${context}: cannot compare ${latest.sha} with ${expectedSha}: ${diff.reason}`
    )
  if (diff.changed.length)
    throw new Error(
      `${context} skipped ${expectedSha}, but ${project} inputs changed since its latest ready deployment ${latest.sha}: ${diff.changed.slice(0, 5).join(', ')}`
    )
  log(
    `${context} skipped ${expectedSha}; ${latest.url} at ${latest.sha} has the same inputs`
  )
  return {
    sha: latest.sha,
    reason: `${context} skipped ${expectedSha}; ${latest.sha} has the same ${project} inputs`,
  }
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url.split('?')[0]} answered ${response.status}`)
  return response.json()
}

async function main() {
  const project = /** @type {'web' | 'api'} */ (process.argv[2])
  const env = (name) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
  }
  const expectedSha = env('EXPECTED_SHA')
  const branch = env('GIT_REF')
  const repository = env('GITHUB_REPOSITORY')
  const projectSlug = env(
    project === 'web' ? 'VERCEL_WEB_PROJECT_SLUG' : 'VERCEL_API_PROJECT_SLUG'
  )
  const github = {
    Authorization: `Bearer ${env('GH_TOKEN')}`,
    Accept: 'application/vnd.github+json',
  }
  const vercel = { Authorization: `Bearer ${env('VERCEL_TOKEN')}` }
  const teamSlug = env('VERCEL_TEAM_SLUG')
  const target = await previewTarget({
    project,
    projectSlug,
    expectedSha,
    statuses: () =>
      getJson(
        `https://api.github.com/repos/${repository}/commits/${expectedSha}/statuses?per_page=100`,
        github
      ),
    readyDeployments: async () => {
      // The slug works in the path, as in resolve-vercel-preview-url.mjs.
      const team = await getJson(`https://api.vercel.com/v2/teams/${teamSlug}`, vercel)
      const scope = new URLSearchParams({ teamId: team.id })
      const { id } = await getJson(
        `https://api.vercel.com/v9/projects/${projectSlug}?${scope}`,
        vercel
      )
      const query = new URLSearchParams({
        teamId: team.id,
        projectId: id,
        state: 'READY',
        target: 'preview',
        'meta-githubCommitRef': branch,
        limit: '20',
      })
      const data = await getJson(`https://api.vercel.com/v6/deployments?${query}`, vercel)
      return (data.deployments ?? [])
        .filter((deployment) => deployment.meta?.githubCommitRef === branch)
        .map((deployment) => ({
          sha: deployment.meta.githubCommitSha,
          url: `https://${deployment.url}`,
          created: deployment.created,
        }))
    },
    log: (message) => console.error(message),
  })
  console.log(`${project} target: ${target.sha} (${target.reason})`)
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${project}_sha=${target.sha}\n`)
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
