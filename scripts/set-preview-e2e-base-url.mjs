#!/usr/bin/env node
// Cross-platform wrapper: resolves the Vercel Preview URL and runs a command
// with PREVIEW_* URL variables and TEST_ENV=preview set.
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function resolveWebUrl() {
  const manual =
    process.env.PREVIEW_WEB_E2E_BASE_URL ||
    process.env.PREVIEW_WEB_BASE_URL
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

function resolveApiUrl() {
  const manual =
    process.env.PREVIEW_API_BASE_URL ||
    process.env.VERCEL_API_BASE_URL
  if (manual) return manual

  try {
    const output = execFileSync(
      process.execPath,
      ['./scripts/resolve-api-preview-url.mjs'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
        env: process.env,
      }
    )
    const lines = output.trim().split(/\r?\n/)
    return lines[lines.length - 1].trim()
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`API URL resolution failed: ${error?.message || 'unknown error'}`)
    }
    return undefined
  }
}

function loadPreviewEnv() {
  const previewEnvPath = path.resolve(process.cwd(), '.env.preview')
  loadEnv({ path: previewEnvPath, quiet: true })
}

function main() {
  loadPreviewEnv()

  const command = process.argv.slice(2).join(' ')
  if (!command) {
    fail('Usage: node scripts/set-preview-e2e-base-url.mjs "<command to run>"')
  }

  const url = resolveWebUrl()
  if (!url) {
    fail('Failed to resolve Preview URL (empty output)')
  }

  const apiPreviewUrl = resolveApiUrl()
  if (process.env.DEBUG && apiPreviewUrl) {
    console.error(`Resolved API URL: ${apiPreviewUrl}`)
  }

  const env = {
    ...process.env,
    PREVIEW_WEB_E2E_BASE_URL: url,
    ...(apiPreviewUrl
      ? {
          PREVIEW_API_BASE_URL: apiPreviewUrl,
          VERCEL_API_BASE_URL: apiPreviewUrl,
          VERCEL_API_BRANCH_URL: apiPreviewUrl,
        }
      : {}),
    TEST_ENV: 'preview',
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
