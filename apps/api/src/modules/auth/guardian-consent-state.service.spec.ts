import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
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
  it('fails closed when the teen user record is missing', async () => {
    const { service } = createService(undefined)

    await expect(service.canTeenAccess('teen-missing')).resolves.toBe(false)
  })

  it('fails closed when the teen profile is missing', async () => {
    const { service } = createService(null)

    await expect(service.canTeenAccess('teen-without-profile')).resolves.toBe(false)
  })

  it('fails closed when the teen account is not active', async () => {
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
