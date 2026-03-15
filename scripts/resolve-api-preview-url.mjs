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

// Load env (optional for local dev) - CI passes env vars directly
try {
  const { config } = await import('dotenv')
  const envSuffix = (process.env.TEST_ENV ?? 'dev').toLowerCase()
  const envFiles = [`.env.${envSuffix}`, '.env']
  for (const file of envFiles) {
    const full = path.resolve(process.cwd(), file)
    if (fs.existsSync(full)) {
      config({ path: full })
      break
    }
  }
} catch {
  // dotenv not available (CI) - env vars passed via workflow
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

async function findDeploymentUrl(projectId, teamId, branch) {
  const searchParams = new URLSearchParams({
    projectId,
    state: 'READY',
    limit: '20',
  })
  if (teamId) searchParams.set('teamId', teamId)
  const branchSlug = slugifyBranch(branch)
  if (branch) searchParams.set('meta', `githubCommitRef=${branch}`)
  const url = `https://api.vercel.com/v6/deployments?${searchParams.toString()}`
  const result = await fetchJson(url)
  const deployments = result?.deployments ?? []
  const expectedSha =
    env('EXPECTED_SHA') ??
    env('GITHUB_SHA') ??
    env('VERCEL_GIT_COMMIT_SHA') ??
    env('COMMIT_SHA')
  // Commit matching is the critical safeguard for preview E2E: after a PR push,
  // the newest READY deployment on a branch is not always the one Playwright should test.
  const matchingDeployments =
    expectedSha === undefined
      ? deployments
      : deployments.filter((deployment) => {
          const deploymentSha = deployment?.meta?.githubCommitSha
          return (
            typeof deploymentSha === 'string' && deploymentSha.startsWith(expectedSha)
          )
        })

  if (expectedSha && matchingDeployments.length > 0) {
    logDebug(
      `Preferring API deployment with commit SHA ${expectedSha.slice(0, 7)} (${matchingDeployments.length} match(es))`
    )
  }

  const candidates = matchingDeployments.length > 0 ? matchingDeployments : deployments
  for (const deployment of candidates) {
    if (!deployment?.url) continue
    if (deployment.state && deployment.state !== 'READY') continue
    const metaRef = deployment.meta?.githubCommitRef
    if (branch && metaRef && metaRef !== branch && metaRef !== branchSlug) continue
    logDebug(
      `Checking API deployment: ${deployment.url} (sha=${deployment.meta?.githubCommitSha || 'unknown'})`
    )
    return deployment.url.startsWith('https://')
      ? deployment.url
      : `https://${deployment.url}`
  }
  return undefined
}

function deterministicUrl(projectSlug, branchSlug, teamSlug) {
  if (!projectSlug || !branchSlug || !teamSlug) return undefined
  return `https://${projectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
}

async function main() {
  const manual = env('DEV_API_BASE_URL') ?? env('VERCEL_API_BASE_URL')
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

await main()
