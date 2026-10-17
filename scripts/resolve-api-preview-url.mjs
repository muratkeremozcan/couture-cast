#!/usr/bin/env node
/**
 * Resolve the API Preview URL that matches the branch or commit under test.
 *
 * Why this file exists:
 * - Web and API deploy as separate Vercel projects, so the web preview URL
 *   cannot be transformed into the API preview URL.
 * - Branch-only matching is not strong enough during rapid PR pushes because
 *   multiple READY API deployments can exist for the same branch.
 *
 * Resolution order:
 * 1. Respect an explicit API URL override from the caller.
 * 2. Query Vercel for the API project and fetch READY deployments.
 * 3. Prefer deployments whose commit SHA matches EXPECTED_SHA/GITHUB_SHA.
 * 4. Fall back to a deterministic branch alias only if the API query cannot
 *    produce a better answer.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Load env files for local Preview runs; CI passes env vars directly. Called from
 * main() so importing this module (for tests) leaves process.env alone.
 */
async function loadLocalEnv() {
  try {
    const { config } = await import('dotenv')
    const envSuffix = (process.env.TEST_ENV ?? 'preview').toLowerCase()
    const envFiles = [`.env.${envSuffix}`, '.env']
    for (const file of envFiles) {
      const full = path.resolve(process.cwd(), file)
      if (fs.existsSync(full)) {
        // quiet: dotenv v17 announces itself on stdout, which would corrupt the URL this
        // script contracts to print there and CI captures by command substitution.
        config({ path: full, quiet: true })
        break
      }
    }
  } catch {
    // dotenv not available (CI) - env vars passed via workflow
  }
}

function logDebug(message) {
  if (process.env.DEBUG) {
    console.error(message)
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function env(name) {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function slugifyBranch(branch) {
  if (!branch) return undefined
  const normalized = branch
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/pull\//, '')
    .replace(/\/merge$/, '')
    .trim()
    .toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug || undefined
}

async function fetchJson(url) {
  const token = env('VERCEL_TOKEN')
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  logDebug(`Fetching Vercel API: ${url}`)
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    logDebug(`Vercel API error: ${response.status} ${response.statusText}`)
    throw new Error(
      `Vercel API request failed (${url}): ${response.status} ${response.statusText} ${body}`
    )
  }
  return response.json()
}

async function resolveTeamId(teamSlug) {
  if (!teamSlug) return undefined
  const url = `https://api.vercel.com/v1/teams/${teamSlug}`
  const result = await fetchJson(url)
  return result?.id
}

async function resolveProjectId(projectSlug, teamId) {
  const baseUrl = `https://api.vercel.com/v9/projects/${projectSlug}`
  const url = new URL(baseUrl)
  if (teamId) {
    url.searchParams.set('teamId', teamId)
  }
  const result = await fetchJson(url.toString())
  return result?.id
}

function getCanonicalDeploymentUrl(deployment) {
  if (!deployment?.url) return undefined
  return deployment.url.startsWith('https://')
    ? deployment.url
    : `https://${deployment.url}`
}

function getGitBranchAliasUrl(deployment) {
  if (!Array.isArray(deployment?.alias)) return undefined

  const gitBranchAlias = deployment.alias.find(
    (alias) => typeof alias === 'string' && alias.includes('-git-')
  )

  if (!gitBranchAlias) return undefined

  return gitBranchAlias.startsWith('https://')
    ? gitBranchAlias
    : `https://${gitBranchAlias}`
}

/**
 * Non-negative number of seconds from an env var; anything else gives the
 * default, so a typo such as "10m" cannot turn the poll into an endless loop.
 */
function secondsFromEnv(name, fallback) {
  const value = Number(env(name))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * List deployments, polling while an explicit EXPECTED_SHA has no deployment yet.
 * Right after a push Vercel may not list it, and the caller waits for that exact
 * commit, so settling early for the branch alias only moves the wait elsewhere.
 * A failed request is retried until the deadline instead of ending the poll.
 * @param {() => Promise<Array<Record<string, any>>>} listDeployments
 * @param {string | undefined} expectedSha
 * @param {boolean} poll
 */
export async function listDeploymentsAwaitingSha(listDeployments, expectedSha, poll) {
  const timeoutMs = poll ? secondsFromEnv('RESOLVE_SHA_TIMEOUT_SECONDS', 600) * 1000 : 0
  const intervalMs = secondsFromEnv('RESOLVE_SHA_INTERVAL_SECONDS', 15) * 1000
  const deadline = Date.now() + timeoutMs
  const matchesSha = (deployment) =>
    typeof deployment?.meta?.githubCommitSha === 'string' &&
    deployment.meta.githubCommitSha.startsWith(expectedSha)
  for (;;) {
    const outOfTime = !poll || Date.now() + intervalMs > deadline
    let deployments
    try {
      deployments = await listDeployments()
    } catch (error) {
      if (outOfTime) throw error
      logDebug(`Vercel deployments request failed; retrying (${error.message})`)
    }
    if (deployments && (!expectedSha || deployments.some(matchesSha) || outOfTime)) {
      return deployments
    }
    if (deployments) {
      logDebug(`No API deployment for SHA ${expectedSha.slice(0, 7)} yet; checking again`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

async function findDeploymentUrl(projectId, teamId, branch) {
  const searchParams = new URLSearchParams({
    projectId,
    limit: '20',
  })
  if (teamId) searchParams.set('teamId', teamId)
  const branchSlug = slugifyBranch(branch)
  if (branch) searchParams.set('meta', `githubCommitRef=${branch}`)
  const url = `https://api.vercel.com/v6/deployments?${searchParams.toString()}`
  const expectedSha =
    env('EXPECTED_SHA') ??
    env('GITHUB_SHA') ??
    env('VERCEL_GIT_COMMIT_SHA') ??
    env('COMMIT_SHA')
  const matchesSha = (deployment) => {
    const deploymentSha = deployment?.meta?.githubCommitSha
    return typeof deploymentSha === 'string' && deploymentSha.startsWith(expectedSha)
  }

  const deployments = await listDeploymentsAwaitingSha(
    async () => (await fetchJson(url))?.deployments ?? [],
    expectedSha,
    Boolean(env('EXPECTED_SHA'))
  )

  // Commit matching is the critical safeguard for preview E2E: after a PR push,
  // the newest READY deployment on a branch is not always the one Playwright should test.
  const matchingDeployments =
    expectedSha === undefined ? deployments : deployments.filter(matchesSha)

  if (expectedSha && matchingDeployments.length > 0) {
    logDebug(
      `Preferring API deployment with commit SHA ${expectedSha.slice(0, 7)} (${matchingDeployments.length} match(es))`
    )

    for (const deployment of matchingDeployments) {
      const url = getCanonicalDeploymentUrl(deployment)
      if (!url) continue

      logDebug(`Using exact API deployment URL for expected SHA: ${url}`)
      return url
    }
  }

  // If the exact deployment is not visible yet, do not pin a stale canonical
  // deployment URL from the same branch. Use the mutable git-branch alias so
  // the waiter can observe the alias switch to the new deployment when Vercel
  // finishes the rollout.
  const branchCandidates = deployments.filter((deployment) => {
    const metaRef = deployment.meta?.githubCommitRef
    return !branch || !metaRef || metaRef === branch || metaRef === branchSlug
  })

  for (const deployment of branchCandidates) {
    const aliasUrl = getGitBranchAliasUrl(deployment)
    if (!aliasUrl) continue

    logDebug(`Using git-branch alias URL while waiting for expected SHA: ${aliasUrl}`)
    return aliasUrl
  }

  return undefined
}

function deterministicUrl(projectSlug, branchSlug, teamSlug) {
  if (!projectSlug || !branchSlug || !teamSlug) return undefined
  return `https://${projectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
}

async function main() {
  await loadLocalEnv()
  const manual = env('PREVIEW_API_BASE_URL') ?? env('VERCEL_API_BASE_URL')
  if (manual) {
    logDebug(`Using manual API URL: ${manual}`)
    process.stdout.write(manual)
    return
  }

  const token = env('VERCEL_TOKEN')
  const projectSlug = env('VERCEL_API_PROJECT_SLUG')
  const teamSlug = env('VERCEL_TEAM_SLUG')

  if (!token) fail('VERCEL_TOKEN is required to query Vercel API')
  if (!projectSlug) fail('VERCEL_API_PROJECT_SLUG is required')

  const branch =
    env('GITHUB_HEAD_REF') ??
    env('VERCEL_GIT_COMMIT_REF') ??
    env('GIT_BRANCH') ??
    env('BRANCH')
  const branchSlug = slugifyBranch(branch) ?? 'main'

  logDebug(`Resolving API URL for project: ${projectSlug}, branch: ${branch}`)

  const teamId = await resolveTeamId(teamSlug)
  logDebug(`Team ID: ${teamId}`)

  const projectId = await resolveProjectId(projectSlug, teamId)
  if (!projectId) fail(`Unable to resolve project ID for ${projectSlug}`)
  logDebug(`Project ID: ${projectId}`)

  // Prefer the exact deployment URL Vercel reports over a guessed hostname.
  const deploymentUrl = await findDeploymentUrl(projectId, teamId, branch)
  if (deploymentUrl) {
    logDebug(`Found deployment URL: ${deploymentUrl}`)
    process.stdout.write(deploymentUrl)
    return
  }

  // Deterministic aliases are a useful fallback, but they are weaker than the
  // explicit deployment lookup above because they do not prove the commit SHA.
  logDebug('No deployment found via API, trying deterministic URL')
  const fallback = deterministicUrl(projectSlug, branchSlug, teamSlug)
  if (fallback) {
    logDebug(`Using fallback deterministic URL: ${fallback}`)
    process.stdout.write(fallback)
    return
  }

  fail(`Could not resolve preview URL for ${projectSlug}`)
}

// Run only as a script, so tests can import the helpers without resolving anything.
// import.meta.main also holds when the script is reached through a symlink.
if (import.meta.main) {
  await main()
}
