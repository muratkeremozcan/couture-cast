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

/**
 * Project settings that change what a build of the same source produces: how it is installed,
 * built and output, which files outside the root directory it can read, whether system
 * variables are exposed, its Node version, Git LFS, and its function and build resources.
 */
export const BUILD_SETTINGS = [
  'framework',
  'buildCommand',
  'installCommand',
  'outputDirectory',
  'rootDirectory',
  'nodeVersion',
  'sourceFilesOutsideRootDirectory',
  'autoExposeSystemEnvs',
  'gitLFS',
  'serverlessFunctionRegion',
  'resourceConfig',
  'defaultResourceConfig',
]

/** JSON with object keys sorted, so equal settings always hash alike. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    )
  return value ?? null
}

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
  const settings = BUILD_SETTINGS.map((key) => [key, stable(project[key])])
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
 *   force?: boolean,
 *   repoId: string | number,
 *   projectId: string,
 *   projectName: string,
 *   list: () => Promise<Deployment[]>,
 *   create: (body: Record<string, unknown>) => Promise<Deployment>,
 *   get: (id: string) => Promise<Deployment>,
 *   cancel: (id: string) => Promise<unknown>,
 *   sleep?: (ms: number) => Promise<void>,
 *   attempts?: number,
 *   intervalMs?: number,
 *   log?: (message: string) => void,
 * }} DeployInput
 */

/** States of a deployment that may still become ready. */
const IN_FLIGHT = new Set(['QUEUED', 'INITIALIZING', 'BUILDING'])

const idOf = (deployment) => deployment.uid ?? deployment.id ?? ''
const stateOf = (deployment) => deployment.readyState ?? deployment.state ?? ''
const oldestFirst = (a, b) =>
  (a.created ?? 0) - (b.created ?? 0) || idOf(a).localeCompare(idOf(b))

/** Cancels builds on the branch that this run supersedes. */
async function cancelSuperseded(ours, keep, { project, cancel, log }) {
  for (const stale of ours.filter((d) => IN_FLIGHT.has(stateOf(d)) && !keep(d))) {
    log(
      `${project}: canceling superseded ${idOf(stale)} (${stale.meta?.githubCommitSha})`
    )
    await cancel(idOf(stale)).catch((error) =>
      log(
        `${project}: could not cancel ${idOf(stale)}: ${error instanceof Error ? error.message : error}`
      )
    )
  }
}

/** Creates a deployment, then keeps the older of two that runs racing each other created. */
async function createOnce(input, matches) {
  const { project, branch, sha, inputs, config, force, repoId, projectId, projectName } =
    input
  const { list, create, cancel, log } = input
  const created = await create({
    name: projectName,
    project: projectId,
    gitSource: { type: 'github', repoId, ref: branch, sha },
    meta: { ccPreviewInputs: inputs, ccPreviewConfig: config },
  })
  if (!idOf(created))
    throw new Error(`${project}: Vercel created no deployment for ${sha}`)
  const own = { ...created, meta: { githubCommitSha: sha, ...created.meta } }
  log(`${project}: created ${idOf(own)} for ${sha}`)
  if (force) return own
  const twin = (await list())
    .filter(
      (d) =>
        d.meta?.githubCommitRef === branch &&
        IN_FLIGHT.has(stateOf(d)) &&
        matches(d) &&
        idOf(d) !== idOf(own)
    )
    .concat([{ ...own, created: own.created ?? Number.MAX_SAFE_INTEGER }])
    .sort(oldestFirst)[0]
  if (!twin || idOf(twin) === idOf(own)) return own
  log(`${project}: ${idOf(twin)} already builds the same inputs; canceling ${idOf(own)}`)
  await cancel(idOf(own)).catch(() => undefined)
  return twin
}

/** Polls one deployment until it is ready, failing on an error, a cancel or the budget. */
async function untilReady(
  target,
  { project, sha, get, sleep, attempts, intervalMs, log }
) {
  const id = idOf(target)
  const targetSha = /** @type {string} */ (target.meta?.githubCommitSha ?? sha)
  for (let attempt = 1; ; attempt++) {
    const deployment = await get(id)
    const state = stateOf(deployment)
    if (state === 'READY')
      return {
        id,
        url: `https://${deployment.url}`,
        sha: targetSha,
        reused: targetSha !== sha,
      }
    if (state === 'ERROR' || state === 'CANCELED')
      throw new Error(
        `${project}: deployment ${id} for ${targetSha} ended ${state}: ${deployment.readyStateReason ?? deployment.errorMessage ?? 'no reason given'}`
      )
    // 72 polls 15 s apart, with setup and request time, keep the job inside its 20 minutes.
    if (attempt >= attempts)
      throw new Error(
        `${project}: deployment ${id} for ${targetSha} is still ${state} after ${(attempts * intervalMs) / 60_000} minutes`
      )
    log(`${project}: ${id} is ${state} (attempt ${attempt}/${attempts})`)
    await sleep(intervalMs)
  }
}

/**
 * @param {DeployInput} input
 * @returns {Promise<{ id: string, url: string, sha: string, reused: boolean }>}
 */
export async function previewDeployment(input) {
  const settings = {
    force: false,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts: 72,
    intervalMs: 15_000,
    log: () => undefined,
    ...input,
  }
  const { project, branch, inputs, config, force, list, log } = settings
  // Only deployments this script created on this branch carry the identity it compares.
  const ours = (await list()).filter(
    (deployment) =>
      deployment.meta?.githubCommitRef === branch &&
      typeof deployment.meta?.ccPreviewInputs === 'string' &&
      /^[a-f0-9]{40}$/.test(deployment.meta?.githubCommitSha ?? '')
  )
  const matches = (deployment) =>
    deployment.meta?.ccPreviewInputs === inputs &&
    deployment.meta?.ccPreviewConfig === config
  // A cancelled Actions run leaves its Vercel build running, and Hobby builds one at a time.
  await cancelSuperseded(ours, (d) => !force && matches(d), settings)
  if (!force) {
    const ready = ours
      .filter((d) => stateOf(d) === 'READY' && matches(d))
      .sort(oldestFirst)
      .at(-1)
    if (ready) {
      log(`${project}: reusing https://${ready.url} (${ready.meta?.githubCommitSha})`)
      return {
        id: idOf(ready),
        url: `https://${ready.url}`,
        sha: /** @type {string} */ (ready.meta?.githubCommitSha),
        reused: true,
      }
    }
    const building = ours
      .filter((d) => IN_FLIGHT.has(stateOf(d)) && matches(d))
      .sort(oldestFirst)[0]
    if (building) {
      log(`${project}: adopting ${idOf(building)}, already building the same inputs`)
      return untilReady(building, settings)
    }
  }
  return untilReady(await createOnce(settings, matches), settings)
}

async function vercelApi(token, method, pathAndQuery, body) {
  const response = await fetch(`https://api.vercel.com${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // A hung request must not eat the job's budget.
    signal: AbortSignal.timeout(30_000),
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
    force: process.env.FORCE_BUILD === 'true',
    list: async () => {
      const query = new URLSearchParams({
        teamId: team.id,
        projectId: projectData.id,
        state: 'READY,BUILDING,QUEUED,INITIALIZING',
        'meta-githubCommitRef': branch,
        limit: '50',
      })
      return (await vercelApi(token, 'GET', `/v6/deployments?${query}`)).deployments ?? []
    },
    create: (body) => vercelApi(token, 'POST', `/v13/deployments?${scope}`, body),
    get: (id) => vercelApi(token, 'GET', `/v13/deployments/${id}?${scope}`),
    cancel: (id) => vercelApi(token, 'PATCH', `/v12/deployments/${id}/cancel?${scope}`),
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
