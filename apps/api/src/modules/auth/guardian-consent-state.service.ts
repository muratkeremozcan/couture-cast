import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

type CachedTeenAccessState = {
  allowed: boolean
  expiresAt: number
}

type TeenProfileLookup = {
  profile: {
    preferences: Prisma.JsonValue | null
  } | null
} | null

const TEEN_ACCESS_CACHE_TTL_MS = 30_000

function extractComplianceState(
  preferences: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {}
  }

  const compliance = (preferences as Record<string, unknown>).compliance
  if (!compliance || typeof compliance !== 'object' || Array.isArray(compliance)) {
    return {}
  }

  return compliance as Record<string, unknown>
}

export function requiresGuardianConsent(
  preferences: Prisma.JsonValue | null | undefined
) {
  const compliance = extractComplianceState(preferences)
  return (
    compliance.accountStatus === 'pending_guardian_consent' &&
    (compliance.guardianConsentRequired === true ||
      compliance.guardianConsentRequired === 'true')
  )
}

@Injectable()
export class GuardianConsentStateService {
  private readonly logger = new Logger(GuardianConsentStateService.name)
  private readonly teenAccessCache = new Map<string, CachedTeenAccessState>()

  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async canTeenAccess(userId: string) {
    const now = Date.now()
    const cached = this.teenAccessCache.get(userId)
    if (cached && cached.expiresAt > now) {
      return cached.allowed
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        profile: {
          select: {
            preferences: true,
          },
        },
      },
    })

    const allowed = this.resolveTeenAccess(userId, user)
    this.teenAccessCache.set(userId, {
      allowed,
      expiresAt: now + TEEN_ACCESS_CACHE_TTL_MS,
    })

    return allowed
  }

  markTeenAccessGranted(userId: string) {
    this.teenAccessCache.set(userId, {
      allowed: true,
      expiresAt: Date.now() + TEEN_ACCESS_CACHE_TTL_MS,
    })
  }

  markTeenAccessRevoked(userId: string) {
    this.teenAccessCache.set(userId, {
      allowed: false,
      expiresAt: Date.now() + TEEN_ACCESS_CACHE_TTL_MS,
    })
  }

  invalidateTeenAccess(userId: string) {
    this.teenAccessCache.delete(userId)
  }

  clearCache() {
    this.teenAccessCache.clear()
  }

  private resolveTeenAccess(userId: string, user: TeenProfileLookup) {
    if (!user) {
      this.logger.warn(
        `Blocking teen request for "${userId}" because the user record was not found`
      )
      return false
    }

    if (!user.profile) {
      this.logger.warn(
        `Blocking teen request for "${userId}" because the profile record is missing`
      )
      return false
    }

    const compliance = extractComplianceState(user.profile.preferences)
    if (compliance.accountStatus !== 'active') {
      const accountStatus =
        typeof compliance.accountStatus === 'string'
          ? compliance.accountStatus
          : 'unknown'
      this.logger.warn(
        `Blocking teen request for "${userId}" because account status is "${accountStatus}"`
      )
      return false
    }

    if (requiresGuardianConsent(user.profile.preferences)) {
      this.logger.warn(
        `Blocking teen request for "${userId}" because guardian consent is still required`
      )
      return false
    }

    return true
  }
}
