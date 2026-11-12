#!/usr/bin/env node
/**
 * Provides the preview deployment of one Vercel project for the commit under test.
 *
 * Git pushes to branches other than main create no Vercel deployment (`git.deploymentEnabled`
 * in each project's vercel.json): on the Hobby plan every deployment, an ignored one included,
 * counts toward the 100 a day, and pushes no preview check needed used them up. CI calls this
 * only when the preview checks need the branch (scripts/vercel-preview-inputs.mjs).
 *
 * A preview deployment this script created on the branch for the same build inputs (a hash of
 * every tracked file the project builds from) and the same project configuration (its preview
 * environment variables and build settings) is adopted, ready or still building; otherwise it
 * creates one from the exact commit and waits for it, within one deadline for the job. It never
 * cancels a deployment. Either way it returns that deployment's own URL, id and commit, which the
 * health wait and the e2e run use as they are.
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
    // Vercel gives a variable's target as a list or as one string.
    .filter((env) => [env.target ?? []].flat().includes('preview'))
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

/** Marks the deployments this script creates; only those are ever adopted. */
export const PREVIEW_SOURCE = 'rwf-vercel-preview-ready'

/**
 * @typedef {{
 *   id?: string, uid?: string, url?: string, readyState?: string, state?: string,
 *   readyStateReason?: string | null, errorMessage?: string | null, target?: string | null,
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
 *   deadline: number,
 *   list: () => Promise<Deployment[]>,
 *   create: (body: Record<string, unknown>) => Promise<Deployment>,
 *   get: (id: string) => Promise<Deployment>,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   intervalMs?: number,
 *   log?: (message: string) => void,
 * }} DeployInput
 */

/** States of a deployment that may still become ready. */
const IN_FLIGHT = new Set(['QUEUED', 'INITIALIZING', 'BUILDING'])

const idOf = (deployment) => deployment.uid ?? deployment.id ?? ''
const stateOf = (deployment) => deployment.readyState ?? deployment.state ?? ''
const createdOf = (deployment) => deployment.created ?? deployment.createdAt ?? 0

/**
 * A failed request worth repeating: a rate limit, a server error, a request that ran out of
 * time or a connection that failed. Any other 4xx answer will not change on a retry.
 */
function transient(error) {
  const status = /** @type {{ status?: unknown }} */ (error)?.status
  if (typeof status === 'number') return status === 429 || status >= 500
  const name = /** @type {{ name?: unknown }} */ (error)?.name
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    (error instanceof TypeError && error.message === 'fetch failed')
  )
}

/**
 * How long to wait before polling again: one interval, or until the reset a rate-limited answer
 * announced when that is later.
 */
function retryWait(error, intervalMs, now) {
  const retryAt = /** @type {{ retryAt?: unknown }} */ (error)?.retryAt
  if (typeof retryAt !== 'number' || retryAt - now() <= intervalMs)
    return { ms: intervalMs, announced: false }
  return { ms: retryAt - now(), announced: true }
}

/**
 * When a refused request may be sent again, as an epoch time in ms: the latest of Retry-After
 * (seconds or an HTTP date), X-RateLimit-Reset (epoch seconds) and the body's error.limit
 * reset (epoch seconds) or resetMs, as Vercel documents for rate limits. Undefined without any.
 * @param {Headers} headers @param {unknown} parsed @param {() => number} now
 */
function announcedRetryAt(headers, parsed, now) {
  const times = []
  const retryAfter = headers.get('retry-after')?.trim()
  if (retryAfter && /^\d+$/.test(retryAfter))
    times.push(now() + Number(retryAfter) * 1000)
  else if (retryAfter && Number.isFinite(Date.parse(retryAfter)))
    times.push(Date.parse(retryAfter))
  const resetHeader = Number(headers.get('x-ratelimit-reset'))
  if (resetHeader > 0) times.push(resetHeader * 1000)
  const limit =
    /** @type {{ error?: { limit?: { reset?: unknown, resetMs?: unknown } } }} */ (parsed)
      ?.error?.limit
  if (typeof limit?.resetMs === 'number') times.push(limit.resetMs)
  if (typeof limit?.reset === 'number') times.push(limit.reset * 1000)
  return times.length ? Math.max(...times) : undefined
}

/**
 * Polls one deployment until it is ready, failing on an error, a cancel or the deadline. A
 * transient failure of the poll itself is retried while the deadline allows, since the build
 * carries on regardless.
 */
async function untilReady(id, targetSha, settings) {
  const { project, sha, get, now, sleep, intervalMs, deadline, log } = settings
  for (;;) {
    let deployment
    try {
      deployment = await get(id)
    } catch (error) {
      if (!transient(error)) throw error
      const wait = retryWait(error, intervalMs, now)
      if (deadline - now() <= wait.ms) {
        if (wait.announced)
          throw new Error(
            `${project}: Vercel rate limits polling ${id} for ${Math.ceil(wait.ms / 1000)} s more, past this job's deadline (${Math.max(0, Math.round((deadline - now()) / 1000))} s left)`,
            { cause: error }
          )
        throw error
      }
      log(
        `${project}: polling ${id} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${Math.round(wait.ms / 1000)} s`
      )
      await sleep(wait.ms)
      continue
    }
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
    const left = deadline - now()
    if (left <= intervalMs)
      throw new Error(
        state === 'QUEUED'
          ? `${project}: deployment ${id} for ${targetSha} is still QUEUED as this job's 20 minutes run out. Hobby builds one deployment at a time, so it waits behind another build; rerun once that build finishes.`
          : `${project}: deployment ${id} for ${targetSha} is still ${state} as this job's 20 minutes run out.`
      )
    log(`${project}: ${id} is ${state}; ${Math.round(left / 1000)} s left`)
    await sleep(intervalMs)
  }
}

/**
 * Adopts a deployment this script created for the same inputs and configuration (ready, or still
 * building), or creates one. It never cancels a deployment: another run may still be using it,
 * and two runs racing to create cost one duplicate build at most.
 * @param {DeployInput} input
 * @returns {Promise<{ id: string, url: string, sha: string, reused: boolean }>}
 */
export async function previewDeployment(input) {
  const settings = {
    ...input,
    force: input.force === true,
    now: input.now ?? (() => Date.now()),
    sleep: input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    intervalMs: input.intervalMs ?? 15_000,
    log: input.log ?? (() => undefined),
  }
  const { project, branch, sha, inputs, config, force, log } = settings
  if (!force) {
    const ours = (await settings.list())
      .filter(
        (deployment) =>
          (deployment.target ?? 'preview') === 'preview' &&
          deployment.meta?.ccPreviewSource === PREVIEW_SOURCE &&
          deployment.meta?.githubCommitRef === branch &&
          deployment.meta?.ccPreviewInputs === inputs &&
          deployment.meta?.ccPreviewConfig === config &&
          /^[a-f0-9]{40}$/.test(deployment.meta?.githubCommitSha ?? '')
      )
      .sort((a, b) => createdOf(b) - createdOf(a))
    const ready = ours.find((deployment) => stateOf(deployment) === 'READY')
    const building = ours.find((deployment) => IN_FLIGHT.has(stateOf(deployment)))
    const adopted = ready ?? building
    if (adopted) {
      const adoptedSha = /** @type {string} */ (adopted.meta?.githubCommitSha)
      log(
        `${project}: ${ready ? 'reusing' : 'adopting'} ${idOf(adopted)} (${adoptedSha}), built from the same inputs and configuration`
      )
      return untilReady(idOf(adopted), adoptedSha, settings)
    }
  }
  const created = await settings.create({
    name: settings.projectName,
    project: settings.projectId,
    gitSource: { type: 'github', repoId: settings.repoId, ref: branch, sha },
    meta: {
      ccPreviewSource: PREVIEW_SOURCE,
      ccPreviewInputs: inputs,
      ccPreviewConfig: config,
    },
  })
  const id = idOf(created)
  if (!id) throw new Error(`${project}: Vercel created no deployment for ${sha}`)
  log(`${project}: created ${id} for ${sha}${force ? ' (forced)' : ''}`)
  return untilReady(id, sha, settings)
}

/** Vercel's REST API, every request bounded by the job deadline and 30 s. */
function vercelClient(token, fetchImpl, deadline, now) {
  return async (method, pathAndQuery, body) => {
    const budget = Math.min(30_000, deadline - now())
    if (budget <= 0)
      throw new Error(
        `Vercel ${method} ${pathAndQuery.split('?')[0]}: the job's deadline passed`
      )
    const response = await fetchImpl(`https://api.vercel.com${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(budget),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (response.ok) return JSON.parse(await response.text())
    // The status came with the headers, so it stands even when the body cannot be read: a 403
    // whose body times out is still a 403, never a retryable timeout.
    let text
    try {
      text = await response.text()
    } catch (error) {
      text = `(the body could not be read: ${error instanceof Error ? error.name : 'error'})`
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    const message = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 300)
    throw Object.assign(
      new Error(
        `Vercel ${method} ${pathAndQuery.split('?')[0]} answered ${response.status}: ${message}`
      ),
      {
        status: response.status,
        retryAt: announcedRetryAt(response.headers, parsed, now),
      }
    )
  }
}

/**
 * The CI step: provides `project`'s preview from the environment the workflow sets.
 * PREVIEW_JOB_STARTED_MS is when the job began, so setup counts against its 20 minutes.
 * @param {'web' | 'api'} project @param {NodeJS.ProcessEnv} env
 * @param {{ fetchImpl?: typeof fetch, cwd?: string, now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void }} [options]
 */
export async function run(project, env, options = {}) {
  const {
    fetchImpl = fetch,
    cwd = repoRoot,
    now = () => Date.now(),
    sleep,
    log,
  } = options
  const required = (name) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
  }
  const started = Number(env.PREVIEW_JOB_STARTED_MS) || now()
  // The job is capped at 20 minutes; the deploy gives up 45 s before, with room to report.
  const deadline = started + 20 * 60_000 - 45_000
  const api = vercelClient(required('VERCEL_TOKEN'), fetchImpl, deadline, now)
  const branch = required('GIT_REF')
  const sha = required('EXPECTED_SHA')
  const force = env.FORCE_BUILD === 'true'
  const slug = required(
    project === 'web' ? 'VERCEL_WEB_PROJECT_SLUG' : 'VERCEL_API_PROJECT_SLUG'
  )
  const team = await api('GET', `/v2/teams/${required('VERCEL_TEAM_SLUG')}`)
  const scope = new URLSearchParams({ teamId: team.id })
  const projectData = await api('GET', `/v9/projects/${slug}?${scope}`)
  const envs = await api('GET', `/v9/projects/${projectData.id}/env?${scope}`)
  const repoId = projectData.link?.repoId
  if (!repoId) throw new Error(`${slug} is not linked to a Git repository`)
  return previewDeployment({
    project,
    branch,
    sha,
    inputs: inputsHash(cwd, project),
    config: configIdentity(projectData, envs.envs ?? [], branch),
    force,
    repoId,
    projectId: projectData.id,
    projectName: projectData.name,
    deadline,
    now,
    ...(sleep ? { sleep } : {}),
    ...(log ? { log } : {}),
    list: async () => {
      const query = new URLSearchParams({
        teamId: team.id,
        projectId: projectData.id,
        state: 'READY,BUILDING,QUEUED,INITIALIZING',
        'meta-githubCommitRef': branch,
        limit: '50',
      })
      return (await api('GET', `/v6/deployments?${query}`)).deployments ?? []
    },
    // Creating runs only when no deployment matches, so it always needs a new build:
    // forceNew=1 stops Vercel returning an earlier deployment of the commit.
    create: (body) => api('POST', `/v13/deployments?forceNew=1&${scope}`, body),
    get: (id) => api('GET', `/v13/deployments/${id}?${scope}`),
  })
}

async function main() {
  const project = /** @type {'web' | 'api'} */ (process.argv[2])
  const result = await run(project, process.env, {
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
