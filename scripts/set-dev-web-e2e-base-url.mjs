#!/usr/bin/env node
// Cross-platform wrapper: resolves the dev Preview URL and runs the given command with DEV_WEB_E2E_BASE_URL and TEST_ENV=dev set.
import { execFileSync } from 'node:child_process'
import process from 'node:process'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function resolveUrl() {
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

  // Derive API preview URL when Vercel slugs are provided.
  let apiPreviewUrl = process.env.DEV_API_BASE_URL
  const apiProjectSlug = process.env.VERCEL_API_PROJECT_SLUG
  const teamSlug = process.env.VERCEL_TEAM_SLUG
  const webProjectSlug = process.env.VERCEL_WEB_PROJECT_SLUG

  if (!apiPreviewUrl && apiProjectSlug && teamSlug && webProjectSlug) {
    try {
      const parsed = new URL(url)
      const teamEscaped = teamSlug.replace(/\./g, '\\.')
      const regex = new RegExp(
        `^${webProjectSlug}-git-([^.]+)-${teamEscaped}`,
        'i'
      )
      const match = parsed.hostname.match(regex)
      const branchSlug = match?.[1]
      if (branchSlug) {
        apiPreviewUrl = `https://${apiProjectSlug}-git-${branchSlug}-${teamSlug}.vercel.app`
      } else {
        // Handle hashed preview hostnames: <webSlug>-<id>-<team>.vercel.app → swap slug
        const hashRegex = new RegExp(
          `^${webProjectSlug}-([^.]+)-${teamEscaped}`,
          'i'
        )
        const hashMatch = parsed.hostname.match(hashRegex)
        const hashId = hashMatch?.[1]
        if (hashId) {
          apiPreviewUrl = `https://${apiProjectSlug}-${hashId}-${teamSlug}.vercel.app`
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
