#!/usr/bin/env node
/**
 * Resolve the latest successful Vercel Preview deployment URL for the current branch.
 * Prints the URL to stdout; all other messages go to stderr.
 *
 * Requirements:
 * - gh CLI installed and authenticated (`gh auth status`)
 * - Branch pushed to GitHub so Vercel has created a Preview deployment
 */
import { execFileSync, execSync } from 'node:child_process'

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
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
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
    const output = execFileSync('gh', ['api', ...args], {
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
    process.env.GITHUB_HEAD_REF ??
    process.env.VERCEL_GIT_COMMIT_REF ??
    process.env.GIT_BRANCH ??
    process.env.BRANCH
  if (fromEnv) return fromEnv

  const fromGit = runGit('git rev-parse --abbrev-ref HEAD')
  if (fromGit && fromGit !== 'HEAD') return fromGit

  fail('Could not determine current branch (git HEAD is detached?).')
}

function getLatestPreviewDeployment(owner, repo, branch) {
  const deployments = runGh([
    `/repos/${owner}/${repo}/deployments`,
    `-F`,
    `ref=${branch}`,
    `-F`,
    `environment=Preview`,
    `-F`,
    `per_page=10`,
  ])

  if (!Array.isArray(deployments) || deployments.length === 0) {
    fail(
      `No Preview deployments found for branch "${branch}". Push a commit and wait for Vercel to create one.`
    )
  }

  return deployments[0]
}

function getDeploymentUrl(owner, repo, deploymentId) {
  const statuses = runGh([
    `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`,
    `-F`,
    `per_page=5`,
  ])

  if (!Array.isArray(statuses) || statuses.length === 0) {
    fail('No deployment statuses found yet. Wait for Vercel to finish the deploy.')
  }

  const success = statuses.find((status) => status.state === 'success')
  const url = success?.environment_url || success?.target_url
  if (!url) {
    fail('Deployment succeeded but no environment URL was returned.')
  }

  return url
}

function main() {
  const branch = getBranch()
  const { owner, repo } = parseOrigin()

  logDebug(`Resolving Preview URL for ${owner}/${repo}@${branch}`)
  ensureBranchExists(owner, repo, branch)
  const deployment = getLatestPreviewDeployment(owner, repo, branch)
  const url = getDeploymentUrl(owner, repo, deployment.id)

  process.stdout.write(url)
}

main()
