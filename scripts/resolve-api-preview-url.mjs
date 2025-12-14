#!/usr/bin/env node
/**
 * Resolve the latest Vercel Preview deployment URL for the API project.
 * Prints the URL to stdout; all other messages go to stderr.
 *
 * This queries Vercel API directly instead of deriving from web URL,
 * because web and API deployments have different hashes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
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

function env(name) {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
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

function getBranch() {
  const fromEnv =
    env('GITHUB_HEAD_REF') ??
    env('VERCEL_GIT_COMMIT_REF') ??
    env('GIT_BRANCH') ??
    env('BRANCH')
  if (fromEnv) return fromEnv

  // Try GITHUB_REF (refs/heads/branch-name or refs/pull/123/merge)
  const ghRef = env('GITHUB_REF')
  if (ghRef) {
    const match = ghRef.match(/^refs\/heads\/(.+)$/)
    if (match) return match[1]
    // For PRs, try to get the head ref
    const prMatch = ghRef.match(/^refs\/pull\/(\d+)/)
    if (prMatch && env('GITHUB_HEAD_REF')) {
      return env('GITHUB_HEAD_REF')
    }
  }

  const fromGit = runGit('git rev-parse --abbrev-ref HEAD')
  if (fromGit && fromGit !== 'HEAD') return fromGit

  return undefined
}

function slugifyBranch(value) {
  if (!value) return undefined
  const normalized = value
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

function runVercelDeployments(project, team, metaKey, metaValue, limit = 10) {
  const args = ['vercel', 'deployments', project, '--json', '--limit', String(limit)]
  if (team) {
    args.push('--scope', team)
  }
  if (metaKey && metaValue) {
    args.push('--meta', `${metaKey}=${metaValue}`)
  }
  try {
    logDebug(`Running: npx ${args.join(' ')}`)
    const output = execFileSync('npx', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    return JSON.parse(output)
  } catch (error) {
    logDebug(`vercel deployments failed: ${error.stderr?.toString() ?? error.message}`)
    return undefined
  }
}

async function isApiEndpoint(url) {
  // Verify this is actually an API endpoint (returns JSON, not HTML)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const testUrl = `${url}/api/health`
    logDebug(`Verifying API endpoint: ${testUrl}`)
    const res = await fetch(testUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    const contentType = res.headers.get('content-type') || ''
    // If it returns JSON or is at least not HTML, it's likely the API
    if (contentType.includes('application/json')) {
      logDebug(`Verified: ${url} returns JSON`)
      return true
    }

    // Also accept if the root returns JSON
    const rootRes = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    const rootContentType = rootRes.headers.get('content-type') || ''
    if (rootContentType.includes('application/json')) {
      logDebug(`Verified: ${url} root returns JSON`)
      return true
    }

    // If we get HTML, this is probably the web app, not the API
    if (contentType.includes('text/html') || rootContentType.includes('text/html')) {
      logDebug(`Warning: ${url} returns HTML, likely not the API`)
      return false
    }

    // Accept other responses (might be API returning different content type)
    return true
  } catch (error) {
    logDebug(`API verification failed for ${url}: ${error.message}`)
    // If fetch fails, still return the URL - might be a network issue
    return true
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

async function findApiUrlFromVercel(project, team, branch) {
  if (!project) return undefined

  const branchSlug = slugifyBranch(branch)
  logDebug(
    `Looking for API deployment: project=${project}, team=${team}, branch=${branch}, slug=${branchSlug}`
  )

  // Try filtering by branch metadata
  const candidates = []

  if (branch) {
    const byRef = runVercelDeployments(project, team, 'githubCommitRef', branch, 10)
    if (byRef && Array.isArray(byRef)) {
      candidates.push(...byRef)
    }

    if (branchSlug && branchSlug !== branch) {
      const bySlug = runVercelDeployments(
        project,
        team,
        'githubCommitRef',
        branchSlug,
        10
      )
      if (bySlug && Array.isArray(bySlug)) {
        candidates.push(...bySlug)
      }
    }
  }

  // Also try without metadata filter as fallback
  if (candidates.length === 0) {
    const any = runVercelDeployments(project, team, undefined, undefined, 10)
    if (any && Array.isArray(any)) {
      candidates.push(...any)
    }
  }

  // Find first deployment with a URL and state=READY
  for (const deployment of candidates) {
    if (!deployment?.url) continue
    if (deployment.state && deployment.state !== 'READY') continue

    const url = deployment.url.startsWith('http')
      ? deployment.url
      : `https://${deployment.url}`
    logDebug(`Candidate API URL: ${url} (state: ${deployment.state || 'unknown'})`)

    // Verify it's actually an API endpoint
    if (await isApiEndpoint(url)) {
      return url
    }
  }

  return undefined
}

async function main() {
  // Check for manual override first
  const manual = env('DEV_API_BASE_URL') ?? env('VERCEL_API_BASE_URL')
  if (manual) {
    logDebug(`Using manual API URL: ${manual}`)
    process.stdout.write(manual)
    return
  }

  const apiProject = env('VERCEL_API_PROJECT_SLUG')
  const team = env('VERCEL_TEAM_SLUG')

  if (!apiProject) {
    fail('VERCEL_API_PROJECT_SLUG is required')
  }

  if (!env('VERCEL_TOKEN')) {
    fail('VERCEL_TOKEN is required to query Vercel API')
  }

  const branch = getBranch()
  logDebug(`Resolving API Preview URL for branch: ${branch || '(unknown)'}`)

  // Try to find the API deployment URL
  const url = await findApiUrlFromVercel(apiProject, team, branch)

  if (!url) {
    // Fall back to deterministic branch URL pattern
    const branchSlug = slugifyBranch(branch)
    if (branchSlug && team) {
      const deterministic = `https://${apiProject}-git-${branchSlug}-${team}.vercel.app`
      logDebug(`Falling back to deterministic URL: ${deterministic}`)
      if (await isApiEndpoint(deterministic)) {
        process.stdout.write(deterministic)
        return
      }
    }
    fail(`No API deployment found for project "${apiProject}"`)
  }

  process.stdout.write(url)
}

await main()
