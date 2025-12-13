import type { NextConfig } from 'next'
import { resolveGitMetadata } from './git-metadata'

const { gitSha: buildGitSha, gitBranch: buildGitBranch } = resolveGitMetadata()

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
