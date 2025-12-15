#!/usr/bin/env node
/**
 * Resolve the latest successful Vercel Preview deployment URL for the current branch.
 * Prints the URL to stdout; all other messages go to stderr.
 *
 * Requirements:
 * - gh CLI installed and authenticated (`gh auth status`)
 * - Branch pushed to GitHub so Vercel has created a Preview deployment
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import dotenv from 'dotenv'

// Load env (prefer .env.<TEST_ENV>, then .env)
const envSuffix = (process.env.TEST_ENV ?? 'dev').toLowerCase()
const envFiles = [`.env.${envSuffix}`, '.env']
for (const file of envFiles) {
  const full = path.resolve(process.cwd(), file)
  if (fs.existsSync(full)) {
    dotenv.config({ path: full })
    break
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

function runGit(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

async function isReachable(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    // Vercel often responds with redirects; HEAD can also be disallowed.
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    })

    // Treat redirects and auth-gated responses as "reachable".
    if (res.ok) return true
    if ([301, 302, 303, 307, 308].includes(res.status)) return true
    if ([401, 403].includes(res.status)) return true
    if (res.status === 405) return true // Method Not Allowed (HEAD disabled) still means the host exists.

    return false
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

function env(name) {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseOrigin() {
  const origin = runGit('git config --get remote.origin.url')
  if (!origin) {
    fail('Could not determine git remote origin.')
  }

  const sshMatch = origin.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?/)
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }

  const httpsMatch = origin.match(/https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?/)
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] }
  }

  fail(`Unrecognized origin format: ${origin}`)
}

function runGh(args) {
  try {
    const output = execFileSync('gh', ['api', '-X', 'GET', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(output)
  } catch (error) {
    if (error.stdout) {
      logDebug(error.stdout.toString())
    }
    if (error.stderr) {
      logDebug(error.stderr.toString())
    }
    fail('gh api failed. Ensure gh CLI is installed and authenticated.')
  }
}

function ensureBranchExists(owner, repo, branch) {
  try {
    runGh([`/repos/${owner}/${repo}/branches/${branch}`])
    return true
  } catch {
    fail(
      `Branch "${branch}" not found on GitHub. Push it first so Vercel can create a Preview deployment.`
    )
  }
}

function getBranch() {
  const fromEnv =
    env('GITHUB_HEAD_REF') ??
    env('VERCEL_GIT_COMMIT_REF') ??
    env('GIT_BRANCH') ??
    env('BRANCH')
  if (fromEnv) return fromEnv

  const fromGit = runGit('git rev-parse --abbrev-ref HEAD')
  if (fromGit && fromGit !== 'HEAD') return fromGit

  fail('Could not determine current branch (git HEAD is detached?).')
}

function slugifyVercelGitRef(value) {
  const normalized = value
    .replace(/^refs\/heads\//, '')
    .trim()
    .toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug || 'main'
}

function getDeploymentStatuses(owner, repo, deploymentId) {
  return runGh([
    `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`,
    `-F`,
    `per_page=5`,
  ])
}

function findSuccessUrlFromDeployment(owner, repo, deploymentId) {
  const statuses = getDeploymentStatuses(owner, repo, deploymentId)
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return undefined
  }
  const success = statuses.find((status) => status.state === 'success')
  return success?.environment_url || success?.target_url
}

function findUrlFromDeployments(owner, repo, deployments) {
  if (!Array.isArray(deployments)) return undefined
  for (const deployment of deployments) {
    const url = findSuccessUrlFromDeployment(owner, repo, deployment.id)
    if (url) return url
  }
  return undefined
}

async function fetchVercelApi(path, params = {}) {
  const token = env('VERCEL_TOKEN')
  if (!token) {
    logDebug('VERCEL_TOKEN not set, skipping Vercel API query')
    return undefined
  }

  const url = new URL(`https://api.vercel.com${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }

  try {
    logDebug(`Fetching Vercel API: ${url.pathname}${url.search}`)
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      logDebug(`Vercel API error: ${response.status} ${response.statusText}`)
      return undefined
    }

    return await response.json()
  } catch (error) {
    logDebug(`Vercel API fetch failed: ${error.message}`)
    return undefined
  }
}

async function getVercelTeamId(teamSlug) {
  if (!teamSlug) return undefined

  // Try to get team info - the slug can be used in the URL path
  const data = await fetchVercelApi(`/v2/teams/${teamSlug}`)
  return data?.id
}

async function getVercelProjectId(projectSlug, teamId) {
  const params = {}
  if (teamId) params.teamId = teamId

  const data = await fetchVercelApi(`/v9/projects/${projectSlug}`, params)
  return data?.id
}

async function fetchVercelDeployments(projectId, teamId, branch, limit = 10) {
  if (!projectId) return []

  const params = {
    projectId,
    state: 'READY',
    limit: String(limit),
  }
  if (teamId) params.teamId = teamId
  if (branch) params['meta-githubCommitRef'] = branch

  const data = await fetchVercelApi('/v6/deployments', params)
  return data?.deployments ?? []
}

async function findUrlFromVercel(projectSlug, teamSlug, branch) {
  if (!projectSlug) return undefined

  logDebug(
    `Querying Vercel API for project: ${projectSlug}, team: ${teamSlug}, branch: ${branch}`
  )

  // Resolve team slug to ID
  const teamId = teamSlug ? await getVercelTeamId(teamSlug) : undefined
  if (teamSlug && !teamId) {
    logDebug(`Could not resolve team ID for "${teamSlug}"`)
    // Continue without team ID - might still work for personal accounts
  } else if (teamId) {
    logDebug(`Team ID: ${teamId}`)
  }

  const projectId = await getVercelProjectId(projectSlug, teamId)
  if (!projectId) {
    logDebug(`Could not resolve project ID for ${projectSlug}`)
    return undefined
  }

  logDebug(`Project ID: ${projectId}`)

  const branchSlug = slugifyVercelGitRef(branch)

  // Try with original branch name first
  let deployments = await fetchVercelDeployments(projectId, teamId, branch, 10)

  // Try with slugified branch name if original didn't work
  if (deployments.length === 0 && branchSlug && branchSlug !== branch) {
    logDebug(`No deployments for "${branch}", trying "${branchSlug}"`)
    deployments = await fetchVercelDeployments(projectId, teamId, branchSlug, 10)
  }

  // Try without branch filter as fallback
  if (deployments.length === 0) {
    logDebug('No branch-specific deployments, fetching any recent deployments')
    deployments = await fetchVercelDeployments(projectId, teamId, undefined, 10)
  }

  if (deployments.length === 0) {
    logDebug('No deployments found')
    return undefined
  }

  // Find first deployment with a URL
  for (const deployment of deployments) {
    if (deployment?.url) {
      const url = deployment.url.startsWith('http')
        ? deployment.url
        : `https://${deployment.url}`
      logDebug(`Found deployment URL: ${url}`)
      return url
    }
  }

  return undefined
}

function getPreviewDeploymentsForBranch(owner, repo, branch) {
  const deployments = runGh([
    `/repos/${owner}/${repo}/deployments`,
    `-F`,
    `ref=${branch}`,
    `-F`,
    `environment=Preview`,
    `-F`,
    `per_page=10`,
  ])

  return Array.isArray(deployments) ? deployments : []
}

function getAnyPreviewDeployments(owner, repo) {
  const deployments = runGh([
    `/repos/${owner}/${repo}/deployments`,
    `-F`,
    `environment=Preview`,
    `-F`,
    `per_page=20`,
  ])

  return Array.isArray(deployments) ? deployments : []
}

async function main() {
  const manual =
    env('DEV_WEB_E2E_BASE_URL') ??
    env('VERCEL_PREVIEW_URL') ??
    env('VERCEL_BRANCH_ALIAS_URL')
  if (manual) {
    process.stdout.write(manual)
    return
  }

  const branch = getBranch()
  const { owner, repo } = parseOrigin()

  logDebug(`Resolving Preview URL for ${owner}/${repo}@${branch}`)
  ensureBranchExists(owner, repo, branch)

  // Deterministic hostname attempt first (matches Vercel pattern).
  const branchSlug = slugifyVercelGitRef(branch)
  const projectSlug = env('VERCEL_WEB_PROJECT_SLUG')
  const teamSlug = env('VERCEL_TEAM_SLUG')
  if (projectSlug && teamSlug) {
    const deterministic = `https://${projectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
    logDebug(`Trying deterministic Preview hostname: ${deterministic}`)
    if (await isReachable(deterministic)) {
      process.stdout.write(deterministic)
      return
    }

    // Some Vercel branch hostnames truncate the branch portion; try a shorter slug as a fallback guess.
    const shortSlug = branchSlug.slice(0, 12)
    if (shortSlug && shortSlug !== branchSlug) {
      const shorter = `https://${projectSlug}-git-${shortSlug}-${teamSlug}.vercel.app`
      logDebug(`Trying shortened deterministic hostname: ${shorter}`)
      if (await isReachable(shorter)) {
        process.stdout.write(shorter)
        return
      }
    }
  }

  // First, try branch-scoped Preview deployments.
  const branchDeployments = getPreviewDeploymentsForBranch(owner, repo, branch)
  let url = findUrlFromDeployments(owner, repo, branchDeployments)

  // If GH lacked URLs, try Vercel API directly.
  if (!url) {
    const vercelProject =
      env('VERCEL_PROJECT') ??
      env('VERCEL_PROJECT_NAME') ??
      env('VERCEL_WEB_PROJECT_SLUG')
    const vercelTeam =
      env('VERCEL_TEAM') ?? env('VERCEL_TEAM_ID') ?? env('VERCEL_TEAM_SLUG')
    if (vercelProject && env('VERCEL_TOKEN')) {
      logDebug(`Attempting Vercel API resolution for project "${vercelProject}"`)
      const vercelUrl = await findUrlFromVercel(vercelProject, vercelTeam, branch)
      if (vercelUrl) {
        process.stdout.write(vercelUrl)
        return
      }
    }
  }

  const strict =
    env('VERCEL_PREVIEW_STRICT') === '1' || env('VERCEL_PREVIEW_STRICT') === 'true'

  // If we can see deployments for the branch but none of their statuses include a URL,
  // you almost certainly want to provide an explicit alias rather than falling back to some other branch.
  if (!url && strict) {
    fail(
      [
        `Strict mode: no URL found in GitHub deployment statuses for branch "${branch}".`,
        'Provide one of:',
        '- VERCEL_BRANCH_ALIAS_URL=https://<your-preview>.vercel.app',
        '- VERCEL_PREVIEW_URL=https://<your-preview>.vercel.app',
        '- DEV_WEB_E2E_BASE_URL=https://<your-preview>.vercel.app',
        'Or disable strict mode by unsetting VERCEL_PREVIEW_STRICT.',
      ].join('\n')
    )
  }

  // Fallback: any latest Preview deployment (e.g., when Vercel truncates branch names or ref differs)
  if (!url) {
    logDebug(
      'No branch-scoped Preview with URL found; falling back to latest Preview deployment.'
    )
    const deployments = getAnyPreviewDeployments(owner, repo)
    url = findUrlFromDeployments(owner, repo, deployments)
  }

  if (!url) {
    fail(
      `No Preview deployments found for branch "${branch}". Push a commit and wait for Vercel to create one.`
    )
  }

  process.stdout.write(url)
}

await main()
