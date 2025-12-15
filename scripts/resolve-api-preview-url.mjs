#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { config as loadEnv } from 'dotenv'

const envSuffix = (process.env.TEST_ENV ?? 'dev').toLowerCase()
const envFiles = [`.env.${envSuffix}`, '.env']
for (const file of envFiles) {
  const full = path.resolve(process.cwd(), file)
  if (fs.existsSync(full)) {
    loadEnv({ path: full })
    break
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
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
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
  for (const deployment of deployments) {
    if (!deployment?.url) continue
    if (deployment.state && deployment.state !== 'READY') continue
    const metaRef = deployment.meta?.githubCommitRef
    if (branch && metaRef && metaRef !== branch && metaRef !== branchSlug) continue
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

  const teamId = await resolveTeamId(teamSlug)
  const projectId = await resolveProjectId(projectSlug, teamId)
  if (!projectId) fail(`Unable to resolve project ID for ${projectSlug}`)

  const deploymentUrl = await findDeploymentUrl(projectId, teamId, branch)
  if (deploymentUrl) {
    process.stdout.write(deploymentUrl)
    return
  }

  const fallback = deterministicUrl(projectSlug, branchSlug, teamSlug)
  if (fallback) {
    process.stdout.write(fallback)
    return
  }

  fail(`Could not resolve preview URL for ${projectSlug}`)
}

await main()
