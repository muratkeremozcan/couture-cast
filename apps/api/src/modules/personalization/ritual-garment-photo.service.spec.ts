// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import type { PrismaClient } from '@prisma/client'
import { buildWardrobeObjectPath } from '@couture/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import { RitualGarmentPhotoService } from './ritual-garment-photo.service.js'

const teen: RequestAuthContext = { userId: 'teen-1', token: 'fixture', role: 'teen' }
const topId = '11111111-1111-4111-8111-111111111111'
const bottomId = '22222222-2222-4222-8222-222222222222'
const shoesId = '33333333-3333-4333-8333-333333333333'
const topPath = buildWardrobeObjectPath(teen.userId, 'garment', topId, 'png')
const bottomPath = buildWardrobeObjectPath(teen.userId, 'garment', bottomId, 'png')
const foreignPath = buildWardrobeObjectPath('another-member', 'garment', shoesId, 'png')
const signedUrl = 'https://storage.example.test/top.png?token=fixture'

function harness(accountStatus: string) {
  const findUnique = vi.fn().mockResolvedValue({
    profile: {
      preferences: { compliance: { accountStatus, guardianConsentRequired: true } },
    },
  })
  const findMany = vi.fn().mockResolvedValue([
    { id: topId, user_id: teen.userId, category: 'top', object_path: topPath },
    { id: bottomId, user_id: teen.userId, category: 'bottom', object_path: bottomPath },
    { id: shoesId, user_id: teen.userId, category: 'shoes', object_path: foreignPath },
  ])
  const signReadUrl = vi.fn((path: string) =>
    path === bottomPath
      ? Promise.reject(new Error('Fixture photo is unavailable'))
      : Promise.resolve(signedUrl)
  )
  const prisma = {
    user: { findUnique },
    garmentItem: { findMany },
  } as unknown as PrismaClient
  const guardian = new GuardianConsentStateService(prisma)
  const photos = new RitualGarmentPhotoService(
    prisma,
    { signReadUrl } as unknown as WardrobeStorage,
    guardian
  )
  return { photos, guardian, findMany, signReadUrl }
}

describe('Today ritual garment photo access', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('[7.14-PIC-002] pending teens can reach Today with policy off and receive a catalog-only ritual', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'off')
    const { photos, guardian, findMany, signReadUrl } = harness(
      'pending_guardian_consent'
    )

    await expect(guardian.canTeenAccess(teen.userId)).resolves.toBe(true)
    await expect(photos.resolve(teen, [{ garmentIds: [topId] }])).resolves.toBeNull()
    expect(findMany).not.toHaveBeenCalled()
    expect(signReadUrl).not.toHaveBeenCalled()
  })

  it('[7.14-PIC-001/002] batches owned active recommendations and isolates signing failures', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'off')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T15:00:00.000Z'))
    const { photos, findMany, signReadUrl } = harness('active')

    const result = await photos.resolve(teen, [
      { garmentIds: [topId, 'default-outerwear', bottomId] },
      { garmentIds: [topId, shoesId] },
    ])

    expect(findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: {
          id: { in: [topId, bottomId, shoesId] },
          user_id: teen.userId,
          upload_status: 'ready',
          retention_status: 'active',
          deletion_requested_at: null,
        },
      })
    )
    expect(signReadUrl.mock.calls).toEqual([
      [topPath, 900],
      [bottomPath, 900],
    ])
    expect(result).toEqual(
      new Map([
        [
          topId,
          {
            id: topId,
            category: 'top',
            imageAccess: { url: signedUrl, expiresAt: '2026-11-20T15:15:00.000Z' },
          },
        ],
        [bottomId, { id: bottomId, category: 'bottom' }],
        [shoesId, { id: shoesId, category: 'shoes' }],
      ])
    )
  })
})
