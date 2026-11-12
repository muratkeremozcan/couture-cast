#!/usr/bin/env node
/**
 * Provides the preview deployment of one Vercel project for the commit under test, and with
 * --production the production deployment of main (productionDeployment below).
 *
 * Git pushes create no Vercel deployment, main included (`git.deploymentEnabled` in each
 * project's vercel.json): on the Hobby plan every deployment, an ignored one included, counts
 * toward the 100 a day, and pushes no check needed used them up. CI calls this
 * only when the preview checks need the branch (scripts/vercel-preview-inputs.mjs).
 *
 * A preview deployment this script created on the branch for the same build inputs (a hash of
 * every tracked file the project builds from) and the same project configuration (its preview
 * environment variables and build settings) is adopted, ready or still building; otherwise it
 * creates one from the exact commit and waits for it, within one deadline for the job. It never
 * cancels a deployment. Either way it returns that deployment's own URL, id and commit, which the
 * health wait and the e2e run use as they are.
 */
import { spawnSync } from 'node:child_process'
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
 * The configuration a build of `branch` for `target` reads: each variable of that target that
 * applies to it, by id and last update (values stay encrypted), and the project's build settings.
 * @param {Record<string, unknown>} project @param {Array<Record<string, unknown>>} envs
 * @param {string} branch @param {'preview' | 'production'} [target]
 */
export function configIdentity(project, envs, branch, target = 'preview') {
  const variables = envs
    // Vercel gives a variable's target as a list or as one string.
    .filter((env) => [env.target ?? []].flat().includes(target))
    .filter((env) => target !== 'preview' || !env.gitBranch || env.gitBranch === branch)
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
  if (name === 'TimeoutError' || name === 'AbortError') return true
  if (error instanceof TypeError && error.message === 'fetch failed') return true
  // Node's fetch reports a connection lost mid-body as `TypeError: terminated`, the socket's
  // own failure on its cause chain. Only those transport codes count; malformed JSON and any
  // other error stay final.
  for (let cause = error, depth = 0; cause && depth < 4; depth++) {
    const code = /** @type {{ code?: unknown }} */ (cause).code
    if (typeof code === 'string' && TRANSPORT_CODES.has(code)) return true
    cause = /** @type {{ cause?: unknown }} */ (cause).cause
  }
  return false
}

/** Connection failures from Node's fetch (undici) and its sockets that a later request can avoid. */
const TRANSPORT_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
])

/**
 * How long to wait before polling again: one interval, or until the reset a rate-limited answer
 * announced when that is later.
 */
function retryWait(error, intervalMs, now) {
  const retryAt = /** @type {{ retryAt?: unknown }} */ (error)?.retryAt
  if (
    typeof retryAt !== 'number' ||
    !Number.isFinite(retryAt) ||
    retryAt - now() <= intervalMs
  )
    return { ms: intervalMs, announced: false }
  return { ms: retryAt - now(), announced: true }
}

/**
 * When a refused request may be sent again, as an epoch time in ms, or undefined when the answer
 * announces nothing. Retry-After (seconds, counted from `receivedAt` when the headers arrived,
 * or an HTTP date) applies to any status. Vercel sends its rate-limit reset on every response,
 * so X-RateLimit-Reset (epoch seconds) and the body's error.limit reset (epoch seconds) or
 * resetMs bar a retry only on a 429. The latest of those that apply wins.
 * @param {number} status @param {Headers} headers @param {unknown} parsed
 * @param {number} receivedAt
 */
function announcedRetryAt(status, headers, parsed, receivedAt) {
  const times = []
  const retryAfter = headers.get('retry-after')?.trim()
  if (retryAfter && /^\d+$/.test(retryAfter))
    times.push(receivedAt + Number(retryAfter) * 1000)
  else if (retryAfter && Number.isFinite(Date.parse(retryAfter)))
    times.push(Date.parse(retryAfter))
  if (status === 429) times.push(...quotaResets(headers, parsed))
  // A value that is not a finite time, such as Infinity or 1e999, announces nothing usable.
  const usable = times.filter((time) => Number.isFinite(time))
  return usable.length ? Math.max(...usable) : undefined
}

/** The rate-limit window's reset from the X-RateLimit-Reset header and the error body, in ms. */
function quotaResets(headers, parsed) {
  const times = []
  const resetHeader = Number(headers.get('x-ratelimit-reset'))
  if (resetHeader > 0) times.push(resetHeader * 1000)
  const limit =
    /** @type {{ error?: { limit?: { reset?: unknown, resetMs?: unknown } } }} */ (parsed)
      ?.error?.limit
  if (typeof limit?.resetMs === 'number') times.push(limit.resetMs)
  if (typeof limit?.reset === 'number') times.push(limit.reset * 1000)
  return times
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
  const settings = withDefaults(input)
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

/** A deploy input with its clock, sleep, poll interval and log filled in. */
function withDefaults(input) {
  return {
    ...input,
    force: input.force === true,
    now: input.now ?? (() => Date.now()),
    sleep: input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    intervalMs: input.intervalMs ?? 15_000,
    log: input.log ?? (() => undefined),
  }
}

/** Marks the production deployments CI creates (pw-e2e-prod.yml). */
export const PRODUCTION_SOURCE = 'pw-e2e-prod'

/**
 * Provides production for main's commit `sha`. Git pushes create no deployment, so this is the
 * only path to production, and each deployment counts toward Hobby's 100 a day: it creates one
 * only when the build inputs or the production configuration changed since the deployment
 * production serves now (`current`, the project's production target, which a dashboard rollback
 * moves without creating a deployment). A commit that changed neither leaves production where
 * it is, and the result names the commit production serves, which the health wait and the
 * production e2e run expect.
 *
 * Production builds of older main commits with other inputs that are still running (their runs
 * were superseded, and Vercel carries on building) are cancelled first: one finishing later
 * would take production back to code this commit replaced. A running build of the same inputs
 * is adopted. A build this step waits for is reported only once the production target serves
 * it; after an Instant Rollback, Vercel stops assigning production to new builds until one is
 * promoted, so the step promotes its build when the target still points elsewhere.
 *
 * `reportOnly` (a manual run off main) creates, cancels and promotes nothing: it reports what
 * production serves.
 * @param {DeployInput & {
 *   current: Deployment | null,
 *   reportOnly?: boolean,
 *   cancel: (id: string) => Promise<unknown>,
 *   promote: (id: string) => Promise<unknown>,
 *   served: () => Promise<Deployment | null>,
 *   isOlder: (sha: string) => Promise<boolean>,
 * }} input
 * @returns {Promise<{ id: string, url: string, sha: string, reused: boolean }>}
 */
export async function productionDeployment(input) {
  const settings = withDefaults(input)
  const { project, inputs, config, force, log } = settings
  const current = stateOf(settings.current ?? {}) === 'READY' ? settings.current : null
  if (settings.reportOnly) {
    if (!current || !/^[a-f0-9]{40}$/.test(shaOf(current)))
      throw new Error(`${project}: production serves no deployment with a known commit`)
    log(
      `${project}: reporting what production serves (${shaOf(current)}); nothing deployed`
    )
    return servedResult(current)
  }
  const same = (deployment) =>
    deployment.meta?.ccProductionSource === PRODUCTION_SOURCE &&
    deployment.meta?.ccProductionInputs === inputs &&
    deployment.meta?.ccProductionConfig === config &&
    /^[a-f0-9]{40}$/.test(shaOf(deployment))
  const inFlight = await cancelOlderBuilds(
    settings,
    (deployment) => !force && same(deployment)
  )
  if (!force && current && same(current)) {
    log(
      `${project}: production already serves ${shaOf(current)}, built from the same inputs and configuration; no deployment created`
    )
    return servedResult(current)
  }
  const adopt = force ? undefined : inFlight.find(same)
  if (adopt)
    log(
      `${project}: adopting production build ${idOf(adopt)} (${shaOf(adopt)}) of the same inputs`
    )
  const { id, targetSha } = adopt
    ? { id: idOf(adopt), targetSha: shaOf(adopt) }
    : await createProduction(settings, current)
  const built = await untilReady(id, targetSha, settings)
  await untilServed(id, settings)
  return built
}

const shaOf = (deployment) => deployment?.meta?.githubCommitSha ?? ''
const servedResult = (deployment) => ({
  id: idOf(deployment),
  url: `https://${deployment.url}`,
  sha: shaOf(deployment),
  reused: true,
})

/**
 * Cancels production builds still running for older main commits, except those `keep` names
 * (same inputs): one finishing later would replace what this commit leaves or makes current. A
 * build from a newer push is that run's to finish. Returns the running builds, newest first.
 */
async function cancelOlderBuilds(settings, keep) {
  const { project, sha, log } = settings
  const inFlight = (await settings.list())
    .filter(
      (deployment) =>
        deployment.target === 'production' && IN_FLIGHT.has(stateOf(deployment))
    )
    .sort((a, b) => createdOf(b) - createdOf(a))
  for (const deployment of inFlight) {
    if (keep(deployment)) continue
    const buildSha = shaOf(deployment)
    if (!buildSha || buildSha === sha || !(await settings.isOlder(buildSha))) continue
    log(
      `${project}: cancelling production build ${idOf(deployment)} of older commit ${buildSha} (other inputs)`
    )
    await settings.cancel(idOf(deployment))
  }
  return inFlight
}

/** Creates the production deployment of `sha`, marked with its inputs and configuration. */
async function createProduction(settings, current) {
  const { project, branch, sha, inputs, config, force, log } = settings
  const created = await settings.create({
    name: settings.projectName,
    project: settings.projectId,
    target: 'production',
    gitSource: { type: 'github', repoId: settings.repoId, ref: branch, sha },
    meta: {
      ccProductionSource: PRODUCTION_SOURCE,
      ccProductionInputs: inputs,
      ccProductionConfig: config,
    },
  })
  const id = idOf(created)
  if (!id)
    throw new Error(`${project}: Vercel created no production deployment for ${sha}`)
  const replaced = current
    ? `; production served ${shaOf(current) || idOf(current)} from other inputs or configuration`
    : ''
  log(
    `${project}: created production deployment ${id} for ${sha}${force ? ' (forced)' : replaced}`
  )
  return { id, targetSha: sha }
}

/**
 * Waits until the production target serves `id`, promoting it when it does not: after an
 * Instant Rollback Vercel leaves production on the rolled-back deployment until one is promoted.
 */
async function untilServed(id, settings) {
  const { project, now, sleep, intervalMs, deadline, log } = settings
  let promoted = false
  for (;;) {
    const target = await settings.served()
    const servedId = target ? idOf(target) : ''
    if (servedId === id) return
    if (!promoted) {
      log(
        `${project}: production serves ${servedId || 'nothing'}, not ${id}; promoting ${id} (domain assignment is off after a rollback)`
      )
      await settings.promote(id)
      promoted = true
      continue
    }
    if (deadline - now() <= intervalMs)
      throw new Error(
        `${project}: production still serves ${servedId || 'nothing'}, not ${id}, after promoting it`
      )
    await sleep(intervalMs)
  }
}

/** Whether `older` is a strict ancestor of `commit` in the checkout (full history). */
function isAncestor(cwd, older, commit) {
  if (older === commit) return false
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, commit], {
    cwd,
    timeout: 30_000,
  })
  return result.status === 0
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
    // A relative Retry-After counts from here, before a slow body can add its own time.
    const receivedAt = now()
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
        retryAt: announcedRetryAt(response.status, response.headers, parsed, receivedAt),
      }
    )
  }
}

/**
 * The CI step: provides `project`'s preview from the environment the workflow sets.
 * PREVIEW_JOB_STARTED_MS is when the job began, so setup counts against its 20 minutes.
 * @param {'web' | 'api'} project @param {NodeJS.ProcessEnv} env
 * @param {{ fetchImpl?: typeof fetch, cwd?: string, now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void, production?: boolean }} [options]
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
  const target = options.production ? 'production' : 'preview'
  const slug = required(
    project === 'web' ? 'VERCEL_WEB_PROJECT_SLUG' : 'VERCEL_API_PROJECT_SLUG'
  )
  const team = await api('GET', `/v2/teams/${required('VERCEL_TEAM_SLUG')}`)
  const scope = new URLSearchParams({ teamId: team.id })
  const projectData = await api('GET', `/v9/projects/${slug}?${scope}`)
  const envs = await api('GET', `/v9/projects/${projectData.id}/env?${scope}`)
  const repoId = projectData.link?.repoId
  if (!repoId) throw new Error(`${slug} is not linked to a Git repository`)
  const provide =
    target === 'production'
      ? (input) =>
          productionDeployment({
            ...input,
            current: projectData.targets?.production ?? null,
            reportOnly: env.PRODUCTION_REPORT_ONLY === 'true',
            cancel: (id) => api('PATCH', `/v12/deployments/${id}/cancel?${scope}`),
            promote: (id) =>
              api('POST', `/v10/projects/${projectData.id}/promote/${id}?${scope}`),
            served: async () =>
              (await api('GET', `/v9/projects/${projectData.id}?${scope}`)).targets
                ?.production ?? null,
            isOlder: (buildSha) => Promise.resolve(isAncestor(cwd, buildSha, sha)),
          })
      : previewDeployment
  return provide({
    project,
    branch,
    sha,
    inputs: inputsHash(cwd, project),
    config: configIdentity(projectData, envs.envs ?? [], branch, target),
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
        ...(target === 'production'
          ? { target: 'production' }
          : { 'meta-githubCommitRef': branch }),
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
  const [project, flag] = /** @type {['web' | 'api', string | undefined]} */ (
    process.argv.slice(2)
  )
  if (!['web', 'api'].includes(project) || (flag && flag !== '--production'))
    throw new Error('usage: vercel-preview-deploy.mjs <web|api> [--production]')
  const result = await run(project, process.env, {
    log: (message) => console.error(message),
    production: flag === '--production',
  })
  console.log(
    `${project}: ${result.url} serves ${result.sha} (${result.reused ? 'reused' : 'built'}, ${result.id})`
  )
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${project}_url=${result.url}\n${project}_sha=${result.sha}\n${project}_id=${result.id}\n${project}_reused=${result.reused}\n`
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
