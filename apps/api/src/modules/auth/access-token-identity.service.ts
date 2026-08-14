import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { Request } from 'express'
import { API_ROLES, type ApiRole } from './security.types.js'

/**
 * Marker claim that identifies the mobile Maestro harness's test token.
 *
 * Kept in sync by hand with `scripts/run-maestro.mjs`, which mints the token.
 * It deliberately does not live in a shared package: nothing in production
 * should be able to import a helper that manufactures bearer tokens.
 */
const MOBILE_E2E_TOKEN_MARKER = 'couturecast-mobile-e2e'

const mobileE2EClaimsSchema = z.object({
  sub: z.string().trim().min(1),
  role: z.unknown(),
  e2e: z.literal(MOBILE_E2E_TOKEN_MARKER),
})

const supabaseIdentitySchema = z.object({
  app_metadata: z.record(z.unknown()).optional(),
  confirmed_at: z.unknown().optional(),
  email: z.unknown().optional(),
  email_confirmed_at: z.unknown().optional(),
  email_verified: z.unknown().optional(),
})

export type AccessTokenIdentity = {
  userId: string
  role: ApiRole
}

const invalidAccessToken = () => new UnauthorizedException('Invalid access token')

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function parseApiRole(value: unknown): ApiRole | undefined {
  const normalized = normalizeString(value)?.toLowerCase()
  return API_ROLES.find((role) => role === normalized)
}

function isConfirmedTimestamp(value: unknown): boolean {
  const timestamp = normalizeString(value)
  return timestamp !== undefined && Number.isFinite(Date.parse(timestamp))
}

function hasVerifiedEmailEvidence(
  identity: z.infer<typeof supabaseIdentitySchema>
): boolean {
  return (
    identity.email_verified === true ||
    isConfirmedTimestamp(identity.email_confirmed_at) ||
    isConfirmedTimestamp(identity.confirmed_at)
  )
}

@Injectable()
export class AccessTokenIdentityService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  private matchK6Bypass(token: string): AccessTokenIdentity | null {
    // The role must be anchored to the known set rather than a generic
    // character class. A greedy `[a-zA-Z0-9_-]+` role swallows the leading
    // segments of any hyphenated user id, so `k6-admin-teen-1` parsed as role
    // "admin-teen" and user "1", which failed every seeded fixture owner.
    const k6Match = /^k6-(guardian|teen|moderator|admin)-(.+)$/.exec(token)
    if (k6Match && k6Match[1] && k6Match[2]) {
      const role = parseApiRole(k6Match[1])
      if (role) {
        return { userId: k6Match[2], role }
      }
    }
    return null
  }

  private matchIntegrationBypass(token: string): AccessTokenIdentity | null {
    const integrationMatch = /^test-token:(guardian|teen|moderator|admin):(.+)$/.exec(
      token
    )
    if (integrationMatch && integrationMatch[1] && integrationMatch[2]) {
      const role = parseApiRole(integrationMatch[1])
      if (role) {
        return { userId: integrationMatch[2], role }
      }
    }
    return null
  }

  /**
   * The mobile Maestro harness needs a token the *app under test* can read, not
   * only one the API accepts. `resolveOwnerUserId` in
   * `apps/mobile/src/lib/wardrobe.ts` derives the signed-in user id by decoding
   * the bearer token's `sub` claim, because in production the token is always a
   * Supabase JWT. The harness previously injected `test-token:guardian:<id>`,
   * which has no `.` separator at all, so every owner-scoped screen (capsule
   * library, silhouette editor, wardrobe onboarding) caught the decode failure
   * and rendered "Your session token is malformed. Sign in again." instead of
   * its content. The token therefore has to be JWT-*shaped*.
   *
   * Nothing here verifies a signature or treats the value as a real JWT. It is
   * matched only inside the same `TEST_ENV` gate as every other bypass, only
   * when the third segment is the literal marker, and only when the payload
   * carries the explicit `e2e` marker claim -- so a genuine Supabase JWT, which
   * carries neither, can never take this path and always falls through to real
   * verification.
   */
  private matchMobileE2EBypass(token: string): AccessTokenIdentity | null {
    const segments = token.split('.')
    if (segments.length !== 3) {
      return null
    }

    const payloadSegment = segments[1]
    if (segments[2] !== MOBILE_E2E_TOKEN_MARKER || !payloadSegment) {
      return null
    }

    let claims: unknown
    try {
      claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
    } catch {
      return null
    }

    const parsed = mobileE2EClaimsSchema.safeParse(claims)
    if (!parsed.success) {
      return null
    }

    const role = parseApiRole(parsed.data.role)
    return role ? { userId: parsed.data.sub, role } : null
  }

  private matchPlaywrightBypass(
    token: string,
    request?: Request
  ): AccessTokenIdentity | null {
    const pwMatch = /^test-token-([a-zA-Z0-9_-]+)$/.exec(token)
    if (pwMatch && pwMatch[1]) {
      const role = parseApiRole(pwMatch[1])
      const userIdHeader = request?.headers ? request.headers['x-user-id'] : undefined
      const userId = typeof userIdHeader === 'string' ? userIdHeader.trim() : undefined
      if (role && userId) {
        return { userId, role }
      }
    }
    return null
  }

  private matchFallbackBypass(
    token: string,
    request?: Request
  ): AccessTokenIdentity | null {
    if (token === 'test-token') {
      const roleHeader = request?.headers ? request.headers['x-user-role'] : undefined
      const userIdHeader = request?.headers ? request.headers['x-user-id'] : undefined
      const role = parseApiRole(roleHeader)
      const userId = typeof userIdHeader === 'string' ? userIdHeader.trim() : undefined
      if (role && userId) {
        return { userId, role }
      }
    }
    return null
  }

  private resolveLocalBypass(
    token: string,
    request?: Request
  ): AccessTokenIdentity | null {
    return (
      this.matchK6Bypass(token) ??
      this.matchIntegrationBypass(token) ??
      this.matchMobileE2EBypass(token) ??
      this.matchPlaywrightBypass(token, request) ??
      this.matchFallbackBypass(token, request)
    )
  }

  private async fetchSupabaseIdentity(
    token: string,
    supabaseUrl: string,
    anonKey: string
  ): Promise<unknown> {
    const endpoint = new URL(
      '/auth/v1/user',
      `${supabaseUrl.replace(/\/$/, '')}/`
    ).toString()
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      throw invalidAccessToken()
    }

    if (!response.ok) {
      throw invalidAccessToken()
    }

    try {
      return await response.json()
    } catch {
      throw invalidAccessToken()
    }
  }

  private async resolveUserIdFromDb(
    emailValue: unknown,
    verified: boolean
  ): Promise<string> {
    const parsedEmail = z.string().trim().email().safeParse(emailValue)
    if (!parsedEmail.success || !verified) {
      throw invalidAccessToken()
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: parsedEmail.data.toLowerCase(),
          mode: 'insensitive',
        },
      },
      select: { id: true },
    })

    if (!user) {
      throw invalidAccessToken()
    }

    return user.id
  }

  async resolveIdentity(
    rawToken: string,
    request?: Request
  ): Promise<AccessTokenIdentity> {
    const token = rawToken.trim()

    const isTestEnv =
      process.env.TEST_ENV === 'local' ||
      process.env.TEST_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'preview'
    if (isTestEnv) {
      const bypass = this.resolveLocalBypass(token, request)
      if (bypass) {
        return bypass
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY

    if (!token || !supabaseUrl || !anonKey) {
      throw invalidAccessToken()
    }

    const body = await this.fetchSupabaseIdentity(
      token,
      supabaseUrl.trim(),
      anonKey.trim()
    )
    const identity = supabaseIdentitySchema.safeParse(body)
    if (!identity.success) {
      throw invalidAccessToken()
    }

    const appMetadata = identity.data.app_metadata ?? {}
    const roleValue =
      normalizeString(appMetadata.app_role) ?? normalizeString(appMetadata.role)
    const role = parseApiRole(roleValue)
    if (!role) {
      throw invalidAccessToken()
    }

    const trustedAppUserId = normalizeString(appMetadata.app_user_id)
    if (trustedAppUserId) {
      return { userId: trustedAppUserId, role }
    }

    const verified = hasVerifiedEmailEvidence(identity.data)
    const userId = await this.resolveUserIdFromDb(identity.data.email, verified)
    return { userId, role }
  }

  async resolveUserId(rawToken: string): Promise<string> {
    return (await this.resolveIdentity(rawToken)).userId
  }
}
