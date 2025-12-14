#!/usr/bin/env node
// Cross-platform wrapper: resolves the dev Preview URL and runs the given command with DEV_WEB_E2E_BASE_URL and TEST_ENV=dev set.
import { execFileSync } from 'node:child_process'
import process from 'node:process'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function resolveUrl() {
  const manual = process.env.DEV_WEB_E2E_BASE_URL || process.env.DEV_WEB_BASE_URL
  if (manual) return manual
  try {
    const output = execFileSync(
      process.execPath,
      ['./scripts/resolve-vercel-preview-url.mjs'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
      }
    )
    const lines = output.trim().split(/\r?\n/)
    return lines[lines.length - 1].trim()
  } catch (error) {
    fail(error?.message || 'Failed to resolve Preview URL')
  }
}

function main() {
  const command = process.argv.slice(2).join(' ')
  if (!command) {
    fail('Usage: node scripts/set-dev-web-e2e-base-url.mjs \"<command to run>\"')
  }

  const url = resolveUrl()
  if (!url) {
    fail('Failed to resolve Preview URL (empty output)')
  }

  // Derive API preview URL when Vercel slugs are provided (with sane defaults for CI).
  let apiPreviewUrl = process.env.DEV_API_BASE_URL || process.env.VERCEL_API_BASE_URL
  const apiProjectSlug = process.env.VERCEL_API_PROJECT_SLUG || 'couture-cast-api'
  const teamSlug = process.env.VERCEL_TEAM_SLUG || 'muratkeremozcans-projects'

  function deriveApiFromWebHost(hostname, apiSlug, team) {
    const suffix = `${team}.vercel.app`
    if (!hostname.endsWith(suffix)) return undefined
    const prefix = hostname.slice(0, -(suffix.length + 1)) // strip "-<team>.vercel.app"
    if (prefix.includes('-git-')) {
      const branch = prefix.split('-git-').pop()
      return `https://${apiSlug}-git-${branch}-${team}.vercel.app`
    }
    const hashId = prefix.includes('-') ? prefix.split('-').pop() : prefix
    return `https://${apiSlug}-${hashId}-${team}.vercel.app`
  }

  if (!apiPreviewUrl && apiProjectSlug && teamSlug) {
    try {
      const parsed = new URL(url)
      apiPreviewUrl = deriveApiFromWebHost(parsed.hostname, apiProjectSlug, teamSlug)

      // Fallback to branch-based host when host parsing fails.
      if (!apiPreviewUrl) {
        const ref = process.env.GITHUB_REF || process.env.GITHUB_HEAD_REF
        if (ref) {
          const branchSlug = ref
            .replace(/^refs\/heads\//, '')
            .replace(/^refs\/pull\//, '')
            .replace(/\/merge$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '')
          if (branchSlug) {
            apiPreviewUrl = `https://${apiProjectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const env = {
    ...process.env,
    DEV_WEB_E2E_BASE_URL: url,
    ...(apiPreviewUrl
      ? {
          DEV_API_BASE_URL: apiPreviewUrl,
          VERCEL_API_BASE_URL: apiPreviewUrl,
          VERCEL_API_BRANCH_URL: apiPreviewUrl,
        }
      : {}),
    TEST_ENV: 'dev',
  }
  try {
    execFileSync(command.split(' ')[0], command.split(' ').slice(1), {
      stdio: 'inherit',
      env,
      shell: true,
    })
  } catch (error) {
    process.exit(error?.status ?? 1)
  }
}

main()
