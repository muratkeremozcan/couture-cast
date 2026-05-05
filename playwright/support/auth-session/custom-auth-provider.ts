import fs from 'node:fs'
import {
  AuthSessionManager,
  authStorageInit,
  getStorageDir,
  getTokenFilePath,
  saveStorageState,
  type AuthOptions,
  type AuthProvider,
  type PlaywrightStorageState,
} from '@seontechnologies/playwright-utils/auth-session'
import { resolveEnvironmentConfig } from '../../config/environments'
import type { ApiRole } from '../helpers/api-test'

const DEFAULT_AUTH_SESSION_COOKIE_NAME = 'couturecast-e2e-auth'

const ROLE_ALIASES: Record<string, ApiRole> = {
  admin: 'admin',
  guardian: 'guardian',
  moderator: 'moderator',
  teen: 'teen',
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')

  return slug || 'default'
}

function resolveRole(userIdentifier: string): ApiRole {
  const normalized = slugify(userIdentifier)
  const leadingRole = normalized.split('-')[0]
  const role = leadingRole ? ROLE_ALIASES[leadingRole] : undefined

  if (role) {
    return role
  }

  return 'guardian'
}

/**
 * Resolves the deterministic cookie value used for local auth-session storage.
 *
 * The playwright-utils fixture supplies `authOptions.userIdentifier`; this local
 * provider maps that identifier to the same `test-token-<role>` convention used
 * by API helpers. It is intentionally provider-private and should disappear once
 * local E2E auth can call a real login/token endpoint.
 */
function resolveLocalAuthSessionToken(options: Partial<AuthOptions> = {}): string {
  const userIdentifier = options.userIdentifier?.trim() || 'guardian'
  const role = resolveRole(userIdentifier)

  return `test-token-${role}`
}

function isStorageState(value: unknown): value is PlaywrightStorageState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PlaywrightStorageState>
  return Array.isArray(candidate.cookies) && Array.isArray(candidate.origins)
}

function readStorageState(filePath: string): PlaywrightStorageState {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown

  if (!isStorageState(parsed)) {
    throw new Error(`Auth-session storage state is invalid: ${filePath}`)
  }

  return parsed
}

function getEnvironment(options: Partial<AuthOptions> = {}) {
  return options.environment ?? process.env.TEST_ENV ?? 'local'
}

function getUserIdentifier(options: Partial<AuthOptions> = {}) {
  return options.userIdentifier ?? 'guardian'
}

function getBaseUrl(options: Partial<AuthOptions> = {}) {
  return options.baseUrl ?? resolveEnvironmentConfig(getEnvironment(options)).webBaseUrl
}

function createLocalAuthState(options: Partial<AuthOptions>): PlaywrightStorageState {
  // Local has no real login endpoint yet. Resolve the synthetic cookie value
  // here so playwright-utils can cache one storage state per userIdentifier.
  const token = resolveLocalAuthSessionToken(options)
  const appUrl = new URL(getBaseUrl(options))
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12

  return {
    cookies: [
      {
        domain: appUrl.hostname,
        expires,
        httpOnly: true,
        name: env('AUTH_SESSION_COOKIE_NAME') ?? DEFAULT_AUTH_SESSION_COOKIE_NAME,
        path: '/',
        sameSite: 'Lax',
        secure: appUrl.protocol === 'https:',
        value: token,
      },
    ],
    origins: [],
  }
}

function extractToken(tokenData: Record<string, unknown>) {
  if (typeof tokenData.token === 'string') {
    return tokenData.token
  }

  if (!isStorageState(tokenData)) {
    return null
  }

  const cookieName = env('AUTH_SESSION_COOKIE_NAME') ?? DEFAULT_AUTH_SESSION_COOKIE_NAME
  return tokenData.cookies.find((cookie) => cookie.name === cookieName)?.value ?? null
}

function isJwtExpired(rawToken: string) {
  const payload = rawToken.split('.')[1]
  if (!payload) {
    return false
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown
    }

    return typeof decoded.exp === 'number'
      ? decoded.exp <= Math.floor(Date.now() / 1000) + 60
      : false
  } catch {
    return false
  }
}

function readCachedState(tokenPath: string) {
  if (!fs.existsSync(tokenPath)) {
    return undefined
  }

  const storageState = readStorageState(tokenPath)
  const token = extractToken(storageState)
  return token && !isJwtExpired(token) ? storageState : undefined
}

function authResult(storageState: PlaywrightStorageState) {
  return Promise.resolve(storageState as unknown as Record<string, unknown>)
}

const coutureCastAuthProvider: AuthProvider = {
  getBaseUrl,
  getEnvironment,
  getUserIdentifier,
  extractToken,

  extractCookies(tokenData) {
    return isStorageState(tokenData) ? tokenData.cookies : []
  },

  isTokenExpired: isJwtExpired,

  manageAuthToken(_request, options = {}) {
    const environment = getEnvironment(options)
    const userIdentifier = getUserIdentifier(options)
    const tokenPath = getTokenFilePath({ environment, userIdentifier })
    const cachedState = readCachedState(tokenPath)

    if (cachedState) {
      return authResult(cachedState)
    }

    authStorageInit({ environment, userIdentifier })
    if (environment !== 'local') {
      return Promise.reject(
        new Error(
          'Auth-session local provider only supports TEST_ENV=local. Add a real provider before enabling auth-session for non-local runs.'
        )
      )
    }

    const storageState = createLocalAuthState({
      ...options,
      environment,
      userIdentifier,
    })

    saveStorageState(tokenPath, storageState)
    return authResult(storageState)
  },

  clearToken(options = {}) {
    const environment = getEnvironment(options)
    const userIdentifier = getUserIdentifier(options)
    const storageDir = getStorageDir({ environment, userIdentifier })

    AuthSessionManager.getInstance({ storageDir }).clearToken()
  },
}

export default coutureCastAuthProvider
