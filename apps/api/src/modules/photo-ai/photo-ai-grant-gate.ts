import { Inject, Injectable } from '@nestjs/common'
import type {
  PhotoAiFeature,
  PhotoAiInputClass,
} from '@couture/api-client/contracts/http'
import { calculateAge } from '@couture/utils'
import { Prisma, PrismaClient, type PhotoAiGrant } from '@prisma/client'
import {
  interactiveTransaction,
  singleRunTransaction,
} from '../../prisma/prisma-client.js'
import { isActiveAccount } from '../auth/guardian-consent-state.service.js'
import { activeGuardianConsentWhere } from '../guardian/guardian-participation.js'
import { PhotoAiAttemptRegistry } from './photo-ai-attempt-registry.js'
import {
  PHOTO_AI_POLICY,
  type PhotoAiAgeBand,
  type PhotoAiPolicy,
} from './photo-ai-policy.js'

export type PhotoAiGrantScope = Readonly<{
  grantId: string
  feature: PhotoAiFeature
  inputClass: PhotoAiInputClass
  provider: string
}>

type VerifiedGrant = {
  tx: Prisma.TransactionClient
  expiresAt: Date
}

async function lockMemberBeforePhotoRows(tx: Prisma.TransactionClient, memberId: string) {
  // GuardianService and Community photo writers take this key exclusively before their row locks.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('community_member:' || ${memberId}))`
}

async function lockOwnedGrant(
  tx: Prisma.TransactionClient,
  memberId: string,
  grantId: string
) {
  const [grant] = await tx.$queryRaw<PhotoAiGrant[]>`
    SELECT * FROM "PhotoAiGrant" WHERE "id" = ${grantId} AND "user_id" = ${memberId}
    FOR UPDATE
  `
  return grant
}

function ageBand(age: number): PhotoAiAgeBand {
  if (age >= 18) return '18+'
  if (age >= 16) return '16-17'
  return '13-15'
}

function currentDecision(decidedAt: Date | null, since: Date, now: Date) {
  return decidedAt !== null && decidedAt >= since && decidedAt <= now
}

function matchesGrant(
  grant: PhotoAiGrant | undefined,
  scope: PhotoAiGrantScope,
  policyVersion: string
): grant is PhotoAiGrant {
  return (
    grant !== undefined &&
    grant.revoked_at === null &&
    grant.feature === scope.feature &&
    grant.input_class === scope.inputClass &&
    grant.provider === scope.provider &&
    grant.policy_version === policyVersion
  )
}

@Injectable()
export class PhotoAiGrantGate {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(PHOTO_AI_POLICY) private readonly policy: PhotoAiPolicy,
    @Inject(PhotoAiAttemptRegistry)
    private readonly attempts = new PhotoAiAttemptRegistry()
  ) {}

  list(memberId: string) {
    return this.prisma.photoAiGrant.findMany({
      where: { user_id: memberId, revoked_at: null, expires_at: { gt: new Date() } },
      orderBy: [{ granted_at: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        feature: true,
        input_class: true,
        provider: true,
        policy_version: true,
        expires_at: true,
      },
    })
  }

  async revoke(memberId: string, grantId: string): Promise<void> {
    const owned = await interactiveTransaction(this.prisma, async (tx) => {
      await lockMemberBeforePhotoRows(tx, memberId)
      const grant = await lockOwnedGrant(tx, memberId, grantId)
      if (!grant) return false
      if (!grant.revoked_at) {
        await tx.photoAiGrant.update({
          where: { id: grant.id },
          data: { revoked_at: new Date() },
        })
      }
      return true
    })
    if (owned) this.attempts.abort(memberId, grantId)
  }

  trackAttempt(memberId: string, grantId: string, attempt: AbortController): () => void {
    return this.attempts.track(memberId, grantId, attempt)
  }

  /** The callback holds the grant, account and any applicable guardian relationship locks. */
  async withGrant<T>(
    memberId: string,
    scope: PhotoAiGrantScope,
    work: (verified: VerifiedGrant) => Promise<T | null>
  ): Promise<T | null> {
    const feature = this.policy.features[scope.feature]
    if (
      !feature ||
      feature.inputClass !== scope.inputClass ||
      !this.policy.approvedProcessors.some(
        (approval) =>
          approval.feature === scope.feature &&
          approval.inputClass === scope.inputClass &&
          approval.provider === scope.provider &&
          approval.policyVersion === feature.policyVersion
      )
    )
      return null

    // Dispatch can start inside the transaction. Replaying it could send a second photo.
    return singleRunTransaction(
      this.prisma,
      async (tx) => {
        await lockMemberBeforePhotoRows(tx, memberId)
        const grant = await lockOwnedGrant(tx, memberId, scope.grantId)
        if (!matchesGrant(grant, scope, feature.policyVersion)) return null

        const relationship = await this.lockActiveGuardianConsent(tx, grant)
        const [profile] = await tx.$queryRaw<
          { birthdate: Date | null; preferences: Prisma.JsonValue | null }[]
        >`
        SELECT "birthdate", "preferences" FROM "UserProfile" WHERE "user_id" = ${memberId}
        FOR SHARE
      `
        const now = new Date()
        if (
          !profile?.birthdate ||
          !isActiveAccount(profile.preferences) ||
          grant.granted_at > now ||
          grant.expires_at <= now
        )
          return null

        const age = calculateAge(profile.birthdate, now)
        if (age < 13 || !feature.ageBands[ageBand(age)]) return null
        const ageAtGrant = calculateAge(profile.birthdate, grant.granted_at)
        if (age >= 18) {
          if (ageAtGrant < 18) return null
        } else if (
          !relationship ||
          ageAtGrant < 13 ||
          !currentDecision(
            grant.teen_assented_at,
            relationship.consent_granted_at,
            now
          ) ||
          !currentDecision(
            grant.guardian_approved_at,
            relationship.consent_granted_at,
            now
          )
        ) {
          return null
        }

        return work({ tx, expiresAt: grant.expires_at })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )
  }

  private async lockActiveGuardianConsent(
    tx: Prisma.TransactionClient,
    grant: PhotoAiGrant
  ) {
    const id = grant.guardian_consent_id
    if (!id) return null
    const [relationship] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "GuardianConsent" WHERE "id" = ${id} AND "teen_id" = ${grant.user_id}
      FOR SHARE
    `
    if (!relationship) return null
    return tx.guardianConsent.findUnique({
      where: { id, ...activeGuardianConsentWhere },
      select: { consent_granted_at: true },
    })
  }
}
