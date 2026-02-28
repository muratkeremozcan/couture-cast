import type { NextConfig } from 'next'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveGitMetadata } from './git-metadata'

const rootDir = path.resolve(__dirname, '../..')
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
  '.env',
]

// Load root `.env*` files when present; CI-injected env vars always win.
// Parsed manually to avoid a runtime dotenv dependency in Vercel builds.
for (const file of rootEnvFiles) {
  const fullPath = path.join(rootDir, file)
  if (!existsSync(fullPath)) continue

  const content = readFileSync(fullPath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const equalIndex = line.indexOf('=')
    if (equalIndex <= 0) continue

    const key = line.slice(0, equalIndex).trim()
    if (!key || process.env[key] !== undefined) continue

    let value = line.slice(equalIndex + 1).trim()
    const isWrappedWithDoubleQuotes =
      value.length >= 2 &&
      value.charCodeAt(0) === 34 &&
      value.charCodeAt(value.length - 1) === 34
    const isWrappedWithSingleQuotes =
      value.length >= 2 &&
      value.charCodeAt(0) === 39 &&
      value.charCodeAt(value.length - 1) === 39

    if (isWrappedWithDoubleQuotes || isWrappedWithSingleQuotes) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

const { gitSha: buildGitSha, gitBranch: buildGitBranch } = resolveGitMetadata()
// Prefer canonical POSTHOG_* vars; keep NEXT_PUBLIC_* fallback.
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
