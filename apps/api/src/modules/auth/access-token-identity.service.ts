import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { Request } from 'express'
import { API_ROLES, type ApiRole } from './security.types.js'

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
    const k6Match = /^k6-([a-zA-Z0-9_-]+)-([a-zA-Z0-9_-]+)$/.exec(token)
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
      process.env.TEST_ENV === 'local' || process.env.TEST_ENV === 'preview'
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
