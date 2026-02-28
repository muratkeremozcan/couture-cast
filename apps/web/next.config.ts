import type { NextConfig } from 'next'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { resolveGitMetadata } from './git-metadata'

const rootDir = path.resolve(__dirname, '../..')
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
  '.env',
]

for (const file of rootEnvFiles) {
  loadEnv({ path: path.join(rootDir, file), override: false, quiet: true })
}

const { gitSha: buildGitSha, gitBranch: buildGitBranch } = resolveGitMetadata()
const posthogKey =
  process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || ''
const posthogHost =
  process.env.POSTHOG_HOST ||
  process.env.NEXT_PUBLIC_POSTHOG_HOST ||
  'https://us.i.posthog.com'
const posthogAssetsHost = posthogHost.includes('.i.posthog.com')
  ? posthogHost.replace('.i.posthog.com', '-assets.i.posthog.com')
  : 'https://us-assets.i.posthog.com'

const nextConfig: NextConfig = {
  env: {
    BUILD_GIT_SHA: buildGitSha ?? '',
    BUILD_GIT_BRANCH: buildGitBranch ?? '',
    NEXT_PUBLIC_POSTHOG_KEY: posthogKey,
    NEXT_PUBLIC_POSTHOG_HOST: posthogHost,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  rewrites() {
    return Promise.resolve([
      {
        source: '/ingest/static/:path*',
        destination: `${posthogAssetsHost}/static/:path*`,
      },
      {
        source: '/ingest/:path*',
        destination: `${posthogHost}/:path*`,
      },
    ])
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}

export default nextConfig
