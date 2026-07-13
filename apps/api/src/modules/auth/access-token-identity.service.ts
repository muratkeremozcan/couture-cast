import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
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

  async resolveIdentity(rawToken: string): Promise<AccessTokenIdentity> {
    const token = rawToken.trim()
    const supabaseUrl = process.env.SUPABASE_URL?.trim()
    const anonKey = process.env.SUPABASE_ANON_KEY?.trim()

    if (!token || !supabaseUrl || !anonKey) {
      throw invalidAccessToken()
    }

    let response: Response
    try {
      response = await fetch(
        new URL('/auth/v1/user', `${supabaseUrl.replace(/\/$/, '')}/`).toString(),
        {
          method: 'GET',
          headers: {
            apikey: anonKey,
            authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(5_000),
        }
      )
    } catch {
      throw invalidAccessToken()
    }

    if (!response.ok) {
      throw invalidAccessToken()
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw invalidAccessToken()
    }

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

    const parsedEmail = z.string().trim().email().safeParse(identity.data.email)
    if (!parsedEmail.success || !hasVerifiedEmailEvidence(identity.data)) {
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

    return { userId: user.id, role }
  }

  async resolveUserId(rawToken: string): Promise<string> {
    return (await this.resolveIdentity(rawToken)).userId
  }
}
