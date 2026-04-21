import type { TestInfo } from '@playwright/test'

export type ApiRole = 'guardian' | 'teen' | 'moderator' | 'admin'

type ResolveApiBaseUrlOptions = {
  overrideEnvVar?: string
  fallback?: string
  requireValue?: boolean
}

export function resolveApiBaseUrl(
  testInfo: TestInfo,
  options: ResolveApiBaseUrlOptions = {}
): string {
  const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
  const envOverride = options.overrideEnvVar
    ? process.env[options.overrideEnvVar]?.trim()
    : undefined
  const baseUrl =
    envOverride || metadata.apiBaseUrl || process.env.API_BASE_URL || options.fallback

  if (!baseUrl && options.requireValue !== false) {
    throw new Error(
      'Missing apiBaseUrl. Configure Playwright project metadata or API_BASE_URL.'
    )
  }

  return baseUrl ?? ''
}

export function authHeaders(userId: string, role: ApiRole): Record<string, string> {
  return {
    authorization: `Bearer test-token-${role}`,
    'x-user-id': userId,
    'x-user-role': role,
  }
}

const runStamp = process.env.PW_TEST_RUN_ID?.trim() || `pid-${process.pid}`

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 36)
}

export function buildUniqueId(prefix: string, testInfo: TestInfo): string {
  return `${prefix}-${runStamp}-${testInfo.parallelIndex}-${testInfo.retry}-${slugify(testInfo.title)}`
}
