import { NextResponse } from 'next/server'
import { execSync } from 'node:child_process'

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

function resolveGitMetadata(): { gitSha: string; gitBranch: string } {
  const gitSha =
    firstNonEmpty(
      process.env.BUILD_GIT_SHA,
      process.env.VERCEL_GIT_COMMIT_SHA,
      process.env.COMMIT_SHA,
      process.env.GIT_COMMIT
    ) ?? tryGit('git rev-parse HEAD')

  const gitBranch =
    firstNonEmpty(
      process.env.BUILD_GIT_BRANCH,
      process.env.VERCEL_GIT_COMMIT_REF,
      process.env.GIT_BRANCH,
      process.env.BRANCH
    ) ?? tryGit('git rev-parse --abbrev-ref HEAD')

  return {
    gitSha: gitSha ?? 'unknown',
    gitBranch: gitBranch ?? 'unknown',
  }
}

export function GET() {
  const { gitSha, gitBranch } = resolveGitMetadata()

  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
  const deployUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined

  return NextResponse.json({
    status: 'ok',
    service: 'couturecast-web',
    environment,
    gitSha,
    gitBranch,
    deployUrl,
    timestamp: new Date().toISOString(),
  })
}
