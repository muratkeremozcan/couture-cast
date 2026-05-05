import type { AuthOptions } from '@seontechnologies/playwright-utils/auth-session'
import type { ApiRole } from '../helpers/api-test'

export const DEFAULT_AUTH_SESSION_COOKIE_NAME = 'couturecast-e2e-auth'

export type AuthSessionRole = ApiRole

export type AuthSessionIdentity = {
  role: AuthSessionRole
  token: string
  userId: string
  userIdentifier: string
}

const ROLE_ALIASES: Record<string, AuthSessionRole> = {
  admin: 'admin',
  guardian: 'guardian',
  moderator: 'moderator',
  teen: 'teen',
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

function envToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
}

function identityEnv(userIdentifier: string, suffix: string): string | undefined {
  return (
    env(`AUTH_SESSION_${envToken(userIdentifier)}_${suffix}`) ??
    env(`AUTH_SESSION_${suffix}`)
  )
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')

  return slug || 'default'
}

function resolveRole(userIdentifier: string): AuthSessionRole {
  const normalized = slugify(userIdentifier)
  const leadingRole = normalized.split('-')[0]
  const role = leadingRole ? ROLE_ALIASES[leadingRole] : undefined

  if (role) {
    return role
  }

  return 'guardian'
}

function resolveUserId(userIdentifier: string, role: AuthSessionRole): string {
  const configuredUserId = identityEnv(userIdentifier, 'USER_ID')
  if (configuredUserId) {
    return configuredUserId
  }

  return `${role}-e2e-${slugify(userIdentifier)}`
}

/**
 * Maps playwright-utils `authOptions.userIdentifier` to the deterministic
 * local-only identity used when synthesizing auth-session storage state.
 *
 * This is not app auth logic. It exists so local browser specs can exercise the
 * shared auth-session fixture without a real login endpoint.
 */
export function resolveAuthSessionIdentity(
  options: Partial<AuthOptions> = {}
): AuthSessionIdentity {
  const userIdentifier = options.userIdentifier?.trim() || 'guardian'
  const role = resolveRole(userIdentifier)
  const userId = resolveUserId(userIdentifier, role)
  const token = identityEnv(userIdentifier, 'TOKEN') ?? `test-token-${role}`

  return {
    role,
    token,
    userId,
    userIdentifier,
  }
}
