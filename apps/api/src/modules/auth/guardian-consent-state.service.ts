import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import type { GuardianConsentPolicy } from '@couture/utils'
import { resolveGuardianConsentPolicy } from './guardian-consent-policy'

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

export function isActiveAccount(preferences: Prisma.JsonValue | null | undefined) {
  return extractComplianceState(preferences).accountStatus === 'active'
}

/**
 * The teen lock RequestAuthGuard applies, as a pure rule. Under `required_13_15` a teen whose
 * account is not active or still needs guardian consent is refused on every signed-in endpoint.
 * Under `off` a teen still waiting on a guardian (`pending_guardian_consent`, revoked included)
 * gets through, and only another non-active status refuses.
 */
export function teenAccessBlocked(
  preferences: Prisma.JsonValue | null | undefined,
  policy: GuardianConsentPolicy = resolveGuardianConsentPolicy()
) {
  const status = extractComplianceState(preferences).accountStatus
  if (policy === 'off')
    return status !== 'active' && status !== 'pending_guardian_consent'
  return status !== 'active' || requiresGuardianConsent(preferences)
}

/**
 * Whether the account is waiting on a guardian and the policy still asks for one: the only case
 * the federated status names `awaiting_guardian`. Any other refusal (a suspended account) is
 * not a guardian wait, and under policy off nothing is.
 */
export function awaitingGuardianConsent(
  preferences: Prisma.JsonValue | null | undefined,
  policy: GuardianConsentPolicy = resolveGuardianConsentPolicy()
) {
  return policy === 'required_13_15' && requiresGuardianConsent(preferences)
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
  private readonly teenNonUploadAccessCache = new Map<string, CachedTeenAccessState>()

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

  /**
   * Non-upload, non-posting member surfaces (such as account-backed saved looks):
   * permits active teens and guardian-pending teens while still blocking suspended
   * or missing-profile accounts.
   */
  async canTeenAccessNonUploadSurface(userId: string) {
    const now = Date.now()
    const cached = this.teenNonUploadAccessCache.get(userId)
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

    const allowed = this.resolveTeenNonUploadAccess(userId, user)
    this.teenNonUploadAccessCache.set(userId, {
      allowed,
      expiresAt: now + TEEN_ACCESS_CACHE_TTL_MS,
    })

    return allowed
  }

  /** Checks current account state for surfaces that require an active teen account. */
  async canTeenAccessActiveSurface(userId: string): Promise<boolean> {
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { preferences: true } } },
    })
    return isActiveAccount(profile?.profile?.preferences)
  }

  canTeenViewPrivateGarmentPhotos(userId: string): Promise<boolean> {
    return this.canTeenAccessActiveSurface(userId)
  }

  markTeenAccessGranted(userId: string) {
    const expiresAt = Date.now() + TEEN_ACCESS_CACHE_TTL_MS
    this.teenAccessCache.set(userId, {
      allowed: true,
      expiresAt,
    })
    this.teenNonUploadAccessCache.set(userId, {
      allowed: true,
      expiresAt,
    })
  }

  markTeenAccessRevoked(userId: string) {
    this.teenAccessCache.set(userId, {
      allowed: false,
      expiresAt: Date.now() + TEEN_ACCESS_CACHE_TTL_MS,
    })
    this.teenNonUploadAccessCache.delete(userId)
  }

  invalidateTeenAccess(userId: string) {
    this.teenAccessCache.delete(userId)
    this.teenNonUploadAccessCache.delete(userId)
  }

  clearCache() {
    this.teenAccessCache.clear()
    this.teenNonUploadAccessCache.clear()
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

    if (teenAccessBlocked(user.profile.preferences)) {
      const { accountStatus } = extractComplianceState(user.profile.preferences)
      this.logger.warn(
        `Blocking teen request for "${userId}" because account status is "${
          typeof accountStatus === 'string' ? accountStatus : 'unknown'
        }"`
      )
      return false
    }

    return true
  }

  private resolveTeenNonUploadAccess(userId: string, user: TeenProfileLookup) {
    if (!user) {
      this.logger.warn(
        `Blocking teen non-upload request for "${userId}" because the user record was not found`
      )
      return false
    }

    if (!user.profile) {
      this.logger.warn(
        `Blocking teen non-upload request for "${userId}" because the profile record is missing`
      )
      return false
    }

    if (teenAccessBlocked(user.profile.preferences, 'off')) {
      const { accountStatus } = extractComplianceState(user.profile.preferences)
      this.logger.warn(
        `Blocking teen non-upload request for "${userId}" because account status is "${
          typeof accountStatus === 'string' ? accountStatus : 'unknown'
        }"`
      )
      return false
    }

    return true
  }
}
