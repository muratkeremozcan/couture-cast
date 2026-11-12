#!/usr/bin/env node
/**
 * Provides the preview deployment of one Vercel project for the commit under test.
 *
 * Git pushes to branches other than main create no Vercel deployment (`git.deploymentEnabled`
 * in each project's vercel.json): on the Hobby plan every deployment, an ignored one included,
 * counts toward the 100 a day, and pushes no preview check needed used them up. CI calls this
 * only when the preview checks need the branch (scripts/vercel-preview-inputs.mjs).
 *
 * A ready deployment of this branch is reused when this script created it for the same build
 * inputs (a hash of every tracked file the project builds from) and the same project
 * configuration (its preview environment variables and build settings); otherwise it creates
 * one from the exact commit and waits for it. Either way it returns that deployment's own URL,
 * id and commit, which the health wait and the e2e run use as they are.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsHash } from './vercel-preview-inputs.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Build settings that change what a deployment of the same source serves. */
const BUILD_SETTINGS = [
  'framework',
  'buildCommand',
  'installCommand',
  'outputDirectory',
  'rootDirectory',
  'nodeVersion',
  'devCommand',
]

/**
 * The configuration a preview build of `branch` reads: each preview variable that applies to
 * it, by id and last update (values stay encrypted), and the project's build settings.
 * @param {Record<string, unknown>} project @param {Array<Record<string, unknown>>} envs
 * @param {string} branch
 */
export function configIdentity(project, envs, branch) {
  const variables = envs
    .filter((env) => Array.isArray(env.target) && env.target.includes('preview'))
    .filter((env) => !env.gitBranch || env.gitBranch === branch)
    .map((env) => [env.key, env.id, env.updatedAt ?? env.createdAt, env.gitBranch ?? ''])
    .sort(
      (a, b) =>
        String(a[0]).localeCompare(String(b[0])) ||
        String(a[1]).localeCompare(String(b[1]))
    )
  const settings = BUILD_SETTINGS.map((key) => [key, project[key] ?? null])
  return createHash('sha256')
    .update(JSON.stringify({ variables, settings }))
    .digest('hex')
}

/**
 * @typedef {{
 *   id?: string, uid?: string, url?: string, readyState?: string, state?: string,
 *   readyStateReason?: string | null, errorMessage?: string | null, created?: number,
 *   meta?: Record<string, string>,
 * }} Deployment
 * @typedef {{
 *   project: 'web' | 'api',
 *   branch: string,
 *   sha: string,
 *   inputs: string,
 *   config: string,
 *   repoId: string | number,
 *   projectId: string,
 *   projectName: string,
 *   listReady: () => Promise<Deployment[]>,
 *   create: (body: Record<string, unknown>) => Promise<Deployment>,
 *   get: (id: string) => Promise<Deployment>,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   intervalMs?: number,
 *   log?: (message: string) => void,
 * }} DeployInput
 */

const idOf = (deployment) => deployment.uid ?? deployment.id ?? ''

/**
 * @param {DeployInput} input
 * @returns {Promise<{ id: string, url: string, sha: string, reused: boolean }>}
 */
export async function previewDeployment({
  project,
  branch,
  sha,
  inputs,
  config,
  repoId,
  projectId,
  projectName,
  listReady,
  create,
  get,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 76,
  intervalMs = 15_000,
  log = () => undefined,
}) {
  const reusable = (await listReady())
    .filter(
      (deployment) =>
        (deployment.readyState ?? deployment.state) === 'READY' &&
        deployment.meta?.githubCommitRef === branch &&
        deployment.meta?.ccPreviewInputs === inputs &&
        deployment.meta?.ccPreviewConfig === config &&
        /^[a-f0-9]{40}$/.test(deployment.meta?.githubCommitSha ?? '')
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]
  if (reusable) {
    const reused = {
      id: idOf(reusable),
      url: `https://${reusable.url}`,
      sha: /** @type {string} */ (reusable.meta?.githubCommitSha),
      reused: true,
    }
    log(
      `${project}: reusing ${reused.url} (${reused.sha}), built from the same inputs and configuration`
    )
    return reused
  }
  const created = await create({
    name: projectName,
    project: projectId,
    gitSource: { type: 'github', repoId, ref: branch, sha },
    meta: { ccPreviewInputs: inputs, ccPreviewConfig: config },
  })
  const id = idOf(created)
  if (!id) throw new Error(`${project}: Vercel created no deployment for ${sha}`)
  log(`${project}: created ${id} for ${sha}`)
  for (let attempt = 1; ; attempt++) {
    const deployment = await get(id)
    const state = deployment.readyState ?? deployment.state
    if (state === 'READY')
      return { id, url: `https://${deployment.url}`, sha, reused: false }
    if (state === 'ERROR' || state === 'CANCELED')
      throw new Error(
        `${project}: deployment ${id} for ${sha} ended ${state}: ${deployment.readyStateReason ?? deployment.errorMessage ?? 'no reason given'}`
      )
    // 76 polls 15 s apart keep this inside the 20 minutes a PR job may take.
    if (attempt >= attempts)
      throw new Error(
        `${project}: deployment ${id} for ${sha} is still ${state} after ${(attempts * intervalMs) / 60_000} minutes`
      )
    log(`${project}: ${id} is ${state} (attempt ${attempt}/${attempts})`)
    await sleep(intervalMs)
  }
}

async function vercelApi(token, method, pathAndQuery, body) {
  const response = await fetch(`https://api.vercel.com${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      message = parsed.error?.message ?? parsed.message ?? message
    } catch {
      // keep the raw text
    }
    throw new Error(
      `Vercel ${method} ${pathAndQuery.split('?')[0]} answered ${response.status}: ${message}`
    )
  }
  return JSON.parse(text)
}

async function main() {
  const project = /** @type {'web' | 'api'} */ (process.argv[2])
  const env = (name) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
  }
  const token = env('VERCEL_TOKEN')
  const branch = env('GIT_REF')
  const sha = env('EXPECTED_SHA')
  const slug = env(
    project === 'web' ? 'VERCEL_WEB_PROJECT_SLUG' : 'VERCEL_API_PROJECT_SLUG'
  )
  const team = await vercelApi(token, 'GET', `/v2/teams/${env('VERCEL_TEAM_SLUG')}`)
  const scope = new URLSearchParams({ teamId: team.id })
  const projectData = await vercelApi(token, 'GET', `/v9/projects/${slug}?${scope}`)
  const envs = await vercelApi(
    token,
    'GET',
    `/v9/projects/${projectData.id}/env?${scope}`
  )
  const repoId = projectData.link?.repoId
  if (!repoId) throw new Error(`${slug} is not linked to a Git repository`)
  const result = await previewDeployment({
    project,
    branch,
    sha,
    inputs: inputsHash(repoRoot, project),
    config: configIdentity(projectData, envs.envs ?? [], branch),
    repoId,
    projectId: projectData.id,
    projectName: projectData.name,
    listReady: async () => {
      const query = new URLSearchParams({
        teamId: team.id,
        projectId: projectData.id,
        state: 'READY',
        'meta-githubCommitRef': branch,
        limit: '50',
      })
      return (await vercelApi(token, 'GET', `/v6/deployments?${query}`)).deployments ?? []
    },
    create: (body) => vercelApi(token, 'POST', `/v13/deployments?${scope}`, body),
    get: (id) => vercelApi(token, 'GET', `/v13/deployments/${id}?${scope}`),
    log: (message) => console.error(message),
  })
  console.log(
    `${project}: ${result.url} serves ${result.sha} (${result.reused ? 'reused' : 'built'}, ${result.id})`
  )
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${project}_url=${result.url}\n${project}_sha=${result.sha}\n${project}_id=${result.id}\n`
    )
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
