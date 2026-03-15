import { execSync } from 'node:child_process'

/**
 * Shared git metadata resolver for API runtime responses.
 *
 * Why this file exists:
 * - Preview health endpoints need to report which commit and branch a live API
 *   deployment is serving.
 * - Local dev and some test paths do not have Vercel-provided env vars, so we
 *   need a Git fallback to keep the response useful outside hosted deploys.
 *
 * Resolution order:
 * 1. Trust deployment/build env vars first because they describe the exact
 *    artifact Vercel built.
 * 2. Fall back to local Git commands when running from a checked-out repo.
 * 3. Return "unknown" only when neither signal exists.
 */
function tryGit(command: string) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function firstNonEmpty(...values: (string | undefined)[]) {
  return values.find((value) => value && value !== 'unknown')
}

export function resolveGitMetadata(): { gitSha: string; gitBranch: string } {
  // Deployment env vars are the most trustworthy source because they reflect
  // the artifact that is actually serving traffic, not merely the current repo state.
  const gitSha =
    firstNonEmpty(
      process.env.BUILD_GIT_SHA,
      process.env.VERCEL_GIT_COMMIT_SHA,
      process.env.COMMIT_SHA,
      process.env.GITHUB_SHA,
      process.env.GIT_COMMIT
    ) ?? tryGit('git rev-parse HEAD')

  // Branch metadata follows the same policy: prefer deployment-provided values,
  // then ask Git locally for dev/test runs.
  const gitBranch =
    firstNonEmpty(
      process.env.BUILD_GIT_BRANCH,
      process.env.VERCEL_GIT_COMMIT_REF,
      process.env.GITHUB_HEAD_REF,
      process.env.GIT_BRANCH,
      process.env.BRANCH
    ) ?? tryGit('git rev-parse --abbrev-ref HEAD')

  return {
    gitSha: gitSha ?? 'unknown',
    gitBranch: gitBranch ?? 'unknown',
  }
}
