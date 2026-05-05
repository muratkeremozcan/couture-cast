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
import { DEFAULT_AUTH_SESSION_COOKIE_NAME, resolveAuthSessionIdentity } from './identity'

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
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
  // Local has no real login endpoint yet; derive a deterministic identity from
  // authOptions.userIdentifier so auth-session can cache one state per user.
  const identity = resolveAuthSessionIdentity(options)
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
        value: identity.token,
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
