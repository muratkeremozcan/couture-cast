import type { NextConfig } from 'next'
import { execSync } from 'node:child_process'

function safeGit(cmd: string) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

const buildGitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COMMIT_SHA ??
  safeGit('git rev-parse HEAD')
const buildGitBranch =
  process.env.VERCEL_GIT_COMMIT_REF ??
  process.env.GIT_BRANCH ??
  safeGit('git rev-parse --abbrev-ref HEAD')

const nextConfig: NextConfig = {
  env: {
    BUILD_GIT_SHA: buildGitSha ?? '',
    BUILD_GIT_BRANCH: buildGitBranch ?? '',
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
