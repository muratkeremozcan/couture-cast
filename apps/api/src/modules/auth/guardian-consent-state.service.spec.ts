import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuardianConsentStateService } from './guardian-consent-state.service'

function createService(
  profile: { preferences: Record<string, unknown> | null } | null | undefined
) {
  const findUnique = vi.fn().mockResolvedValue(profile === undefined ? null : { profile })
  const prisma = {
    user: {
      findUnique,
    },
  } as unknown as PrismaClient

  return {
    findUnique,
    service: new GuardianConsentStateService(prisma),
  }
}

describe('GuardianConsentStateService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fails closed when the teen user record is missing', async () => {
    const { service } = createService(undefined)

    await expect(service.canTeenAccess('teen-missing')).resolves.toBe(false)
  })

  it('fails closed when the teen profile is missing', async () => {
    const { service } = createService(null)

    await expect(service.canTeenAccess('teen-without-profile')).resolves.toBe(false)
  })

  it('under policy required_13_15 fails closed while the teen waits on a guardian', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'required_13_15')
    const { service } = createService({
      preferences: {
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
        },
      },
    })

    await expect(service.canTeenAccess('teen-pending')).resolves.toBe(false)
  })

  it('under policy off (the default) lets a teen still marked as waiting through', async () => {
    const { service } = createService({
      preferences: {
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
        },
      },
    })

    await expect(service.canTeenAccess('teen-pending')).resolves.toBe(true)
  })

  it.each(['off', 'required_13_15'])(
    'under policy %s fails closed for any other non-active status',
    async (policy) => {
      vi.stubEnv('GUARDIAN_CONSENT_POLICY', policy)
      for (const preferences of [
        { compliance: { accountStatus: 'blocked_underage' } },
        { compliance: { accountStatus: 'suspended' } },
        { compliance: {} },
        null,
      ]) {
        const { service } = createService({ preferences })
        await expect(service.canTeenAccess('teen-other')).resolves.toBe(false)
      }
    }
  )

  it('allows access when the teen account is active and consent is no longer required', async () => {
    const { service } = createService({
      preferences: {
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
        },
      },
    })

    await expect(service.canTeenAccess('teen-active')).resolves.toBe(true)
  })

  it('serves repeated lookups from cache within the ttl window', async () => {
    const { findUnique, service } = createService({
      preferences: {
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
        },
      },
    })

    await expect(service.canTeenAccess('teen-active')).resolves.toBe(true)
    await expect(service.canTeenAccess('teen-active')).resolves.toBe(true)
    expect(findUnique).toHaveBeenCalledOnce()
  })
})
