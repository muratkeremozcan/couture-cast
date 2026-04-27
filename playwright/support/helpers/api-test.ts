// Centralizes Playwright API-test environment, identity, and payload helpers so specs
// do not duplicate environment guards or generated user data.
import type { TestInfo } from '@playwright/test'

export type ApiRole = 'guardian' | 'teen' | 'moderator' | 'admin'
export type ApiRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiResponsePayload<TBody = unknown> = {
  status: number
  body: TBody
}

export type ApiRequestFixture = (params: {
  method: ApiRequestMethod
  path: string
  baseUrl: string
  body?: unknown
  headers?: Record<string, string>
}) => Promise<ApiResponsePayload>

export type SignupPayload = {
  email: string
  birthdate: string
}

type ResolveApiBaseUrlOptions = {
  overrideEnvVar?: string
  fallback?: string
  requireValue?: boolean
}

export function projectMetadata(testInfo: TestInfo): Record<string, string> {
  return (testInfo.project.metadata ?? {}) as Record<string, string>
}

export function isProdEnvironment(testInfo: TestInfo): boolean {
  return projectMetadata(testInfo).environment === 'prod'
}

export function isNonLocalEnvironment(testInfo: TestInfo): boolean {
  return projectMetadata(testInfo).environment !== 'local'
}

export function resolveApiBaseUrl(
  testInfo: TestInfo,
  options: ResolveApiBaseUrlOptions = {}
): string {
  const metadata = projectMetadata(testInfo)
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
  return [
    prefix,
    runStamp,
    `w${testInfo.workerIndex}`,
    `p${testInfo.parallelIndex}`,
    `r${testInfo.repeatEachIndex}`,
    `retry${testInfo.retry}`,
    slugify(testInfo.title),
  ].join('-')
}

export function createBirthdate(yearsAgo: number, today = new Date()): string {
  const birthdate = new Date(
    Date.UTC(
      today.getUTCFullYear() - yearsAgo,
      today.getUTCMonth(),
      today.getUTCDate(),
      12
    )
  )

  return birthdate.toISOString().slice(0, 10)
}

export function createSignupPayload(
  testInfo: TestInfo,
  age: number,
  prefix: string
): SignupPayload {
  return {
    email: `${buildUniqueId(prefix, testInfo)}@example.com`,
    birthdate: createBirthdate(age),
  }
}

export function createTeenSignupPayload(
  testInfo: TestInfo,
  prefix: string,
  age = 15
): SignupPayload {
  return createSignupPayload(testInfo, age, prefix)
}

export function createGuardianEmail(testInfo: TestInfo, prefix: string): string {
  return `${buildUniqueId(prefix, testInfo)}@example.com`
}

export function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return ''
  }

  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

export function extractInvitationToken(invitationLink: string): string {
  const token = new URL(invitationLink).searchParams.get('token')
  if (!token) {
    throw new Error('Guardian invitation link did not contain a token')
  }

  return token
}
