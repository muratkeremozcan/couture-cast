// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createService,
  activeCompliancePreferences,
  seedUser,
  registerGuardianServiceLifecycle,
} from '../../testing/guardian/guardian-service.fixture'

describe('GuardianService upload eligibility', () => {
  registerGuardianServiceLifecycle()

  describe('assertWardrobeUploadAllowed', () => {
    const AGE_REFERENCE_DATE = new Date('2026-04-22T03:00:00.000Z')

    const birthdateForAge = (age: number) =>
      new Date(
        Date.UTC(
          AGE_REFERENCE_DATE.getUTCFullYear() - age,
          AGE_REFERENCE_DATE.getUTCMonth(),
          AGE_REFERENCE_DATE.getUTCDate() - 1
        )
      )

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(AGE_REFERENCE_DATE)
    })

    // THESE THREE CASES USED TO ASSERT THE HOLE. The guard began with
    // `if (role !== 'teen') return`, and the tests asserted that a non-teen
    // claim skipped the consent tables entirely — which is exactly how an
    // under-13 account whose token carried any other role published to a public
    // feed unchecked. The role claim is read verbatim from Supabase
    // `app_metadata.app_role` and is never derived from a birthdate, so it is
    // not evidence of age in either direction. What the guard must do for these
    // roles is resolve the stored age and then allow the upload, which is a
    // different assertion from not looking at all.
    it.each([undefined, 'adult', 'guardian'])(
      'resolves age from the stored profile rather than trusting the %s role claim, and allows an adult',
      async (role) => {
        const { prisma, service } = createService()
        seedUser(prisma, {
          id: 'user-1',
          email: 'adult.user@example.com',
          preferences: activeCompliancePreferences(),
          birthdate: birthdateForAge(30),
        })

        await expect(
          service.assertWardrobeUploadAllowed('user-1', role)
        ).resolves.toBeUndefined()
        expect(prisma.user.findUnique).toHaveBeenCalled()
      }
    )

    it.each([undefined, 'adult'])(
      'refuses an under-13 account carrying the %s role claim',
      async (role) => {
        // The whole point of the finding: the claim said "not a teen" and the
        // stored birthdate says otherwise, and the birthdate wins.
        const { service, prisma } = createService()
        seedUser(prisma, {
          id: 'user-under-13',
          email: 'child.user@example.com',
          preferences: activeCompliancePreferences(),
          birthdate: birthdateForAge(11),
        })

        await expect(
          service.assertWardrobeUploadAllowed('user-under-13', role)
        ).rejects.toThrow(ForbiddenException)
      }
    )

    it('refuses an account with no birthdate on file, whatever the claim says', async () => {
      // Fails closed. Signup has always written a birthdate, so this is an
      // account that predates it or was created outside it, and an unknown age
      // on a public surface cannot be treated as an adult without reopening the
      // hole one layer down.
      const { service, prisma } = createService()
      seedUser(prisma, {
        id: 'user-no-birthdate',
        email: 'legacy.nobirthdate@example.com',
        preferences: activeCompliancePreferences(),
        birthdate: null,
      })

      await expect(
        service.assertWardrobeUploadAllowed('user-no-birthdate', 'adult')
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows an adult whose preferences carry no compliance block at all', async () => {
      // The age check runs BEFORE the compliance check. `accountStatus` is a
      // guardian-consent state and is meaningless for an adult; reading it first
      // would refuse every legacy account whose preferences predate the
      // compliance block, which is a lockout unrelated to age.
      const { service, prisma } = createService()
      seedUser(prisma, {
        id: 'user-legacy-adult',
        email: 'legacy.adult@example.com',
        preferences: null,
        birthdate: birthdateForAge(41),
      })

      await expect(
        service.assertWardrobeUploadAllowed('user-legacy-adult', undefined)
      ).resolves.toBeUndefined()
    })

    it('denies uploads when the teen account does not exist', async () => {
      const { service } = createService()

      await expect(service.assertWardrobeUploadAllowed('ghost', 'teen')).rejects.toThrow(
        ForbiddenException
      )
    })

    it('denies uploads when the teen has no profile row', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-profile',
        email: 'teen.noprofile@example.com',
        withProfile: false,
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-no-profile', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it('denies uploads when the profile carries no birthdate', async () => {
      // Without a birthdate the age gate cannot be evaluated, so it must fail closed.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-birthdate',
        email: 'teen.nobirthdate@example.com',
        preferences: activeCompliancePreferences(),
        birthdate: null,
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-no-birthdate', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it.each(['pending_guardian_consent', 'suspended', undefined])(
      'denies uploads while the account status is %s',
      async (accountStatus) => {
        const { prisma, service } = createService()
        seedUser(prisma, {
          id: 'teen-inactive',
          email: 'teen.inactive@example.com',
          birthdate: birthdateForAge(14),
          preferences: { compliance: { accountStatus } },
        })

        await expect(
          service.assertWardrobeUploadAllowed('teen-inactive', 'teen')
        ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      }
    )

    it('denies uploads for under-13 accounts even with an active guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-under-13',
        email: 'teen.under13@example.com',
        birthdate: birthdateForAge(12),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-x:teen-under-13', {
        guardian_id: 'guardian-x',
        teen_id: 'teen-under-13',
        consent_level: 'full_access',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: null,
        ip_address: null,
        revoked_ip_address: null,
        status: 'granted',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-under-13', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it.each([13, 15])(
      'denies uploads for a %s-year-old with no active guardian consent',
      async (age) => {
        const { prisma, service } = createService()
        seedUser(prisma, {
          id: 'teen-unconsented',
          email: 'teen.unconsented@example.com',
          birthdate: birthdateForAge(age),
          preferences: activeCompliancePreferences(),
        })

        await expect(
          service.assertWardrobeUploadAllowed('teen-unconsented', 'teen')
        ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      }
    )

    it('denies uploads for a 13-15 year old whose only consent has been revoked', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-revoked',
        email: 'teen.revoked@example.com',
        birthdate: birthdateForAge(14),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-y:teen-revoked', {
        guardian_id: 'guardian-y',
        teen_id: 'teen-revoked',
        consent_level: 'full_access',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: new Date('2026-03-01T00:00:00.000Z'),
        ip_address: null,
        revoked_ip_address: null,
        status: 'revoked',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-revoked', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it('allows uploads for a 13-15 year old with an active guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-consented',
        email: 'teen.consented@example.com',
        birthdate: birthdateForAge(14),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-z:teen-consented', {
        guardian_id: 'guardian-z',
        teen_id: 'teen-consented',
        consent_level: 'read_only',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: null,
        ip_address: null,
        revoked_ip_address: null,
        status: 'granted',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-consented', 'teen')
      ).resolves.toBeUndefined()
    })

    it('allows uploads at 16 and over without any guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-16',
        email: 'teen.16@example.com',
        birthdate: birthdateForAge(16),
        preferences: activeCompliancePreferences(),
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-16', 'teen')
      ).resolves.toBeUndefined()
    })
  })
})
