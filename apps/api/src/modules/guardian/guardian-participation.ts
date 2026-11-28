// Story 6.4 owner: one database eligibility rule shared by requests and publication.
import { ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { calculateAge } from '@couture/utils'
import { resolveGuardianConsentPolicy } from '../auth/guardian-consent-policy.js'
import { teenAccessBlocked } from '../auth/guardian-consent-state.service.js'

export const activeGuardianConsentWhere = { status: 'granted', revoked_at: null } as const

export async function assertWardrobeParticipationAllowed(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      teen_roles: { where: activeGuardianConsentWhere },
    },
  })
  const born = user?.profile?.birthdate
  if (!user || !born) throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
  const age = calculateAge(born)
  // Adult access depends on age before teen compliance fields, which adult profiles may omit.
  if (age >= 16) return
  const preferences = user.profile?.preferences
  const compliance =
    preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? preferences.compliance
      : null
  const active =
    compliance &&
    typeof compliance === 'object' &&
    !Array.isArray(compliance) &&
    compliance.accountStatus === 'active'
  if (age < 13) throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
  // Policy off: no 13 to 15 year old waits on a guardian, so neither the consent row nor the
  // waiting status refuses; the guard's own rule decides.
  if (resolveGuardianConsentPolicy() === 'off') {
    if (teenAccessBlocked(preferences, 'off'))
      throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
    return
  }
  if (!active || user.teen_roles.length === 0)
    throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
}
