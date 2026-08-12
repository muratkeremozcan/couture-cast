// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SilhouettePhotoProcessor } from './silhouette-photo.processor'
import type { SilhouettePhotoModerationEngine } from './silhouette-photo-moderation.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

describe('SilhouettePhotoProcessor', () => {
  const mockFindUnique = vi.fn()
  const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockDownload = vi.fn().mockResolvedValue(Buffer.from('sample-photo-bytes'))
  const mockModerate = vi.fn()
  const mockGuardianConsentFindMany = vi.fn().mockResolvedValue([])
  const mockUserFindUnique = vi.fn()
  const mockModerationEventCreate = vi.fn()
  const mockEventEnvelopeCreate = vi.fn()
  const mockEventEnvelopeCreateMany = vi.fn()
  const mockTransaction = vi
    .fn()
    .mockImplementation((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(mockPrisma as unknown as PrismaClient)
    )

  const mockPrisma = {
    silhouetteProfile: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
    guardianConsent: {
      findMany: mockGuardianConsentFindMany,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    moderationEvent: {
      create: mockModerationEventCreate,
    },
    eventEnvelope: {
      create: mockEventEnvelopeCreate,
      createMany: mockEventEnvelopeCreateMany,
    },
    $transaction: mockTransaction,
  } as unknown as PrismaClient

  const mockStorage = { download: mockDownload } as unknown as WardrobeStorage
  const mockEngine = {
    moderate: mockModerate,
  } as unknown as SilhouettePhotoModerationEngine

  const processor = new SilhouettePhotoProcessor(mockPrisma, mockStorage, mockEngine)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockModerationEventCreate.mockResolvedValue({ id: 'moderation-1' })
  })

  it('4.4-UNIT-06 skips a profile that is not currently processing', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await processor.process('missing')
    expect(mockDownload).not.toHaveBeenCalled()

    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      my_form_object_path: 'wardrobe/u1/silhouette/s1.png',
      my_form_status: 'ready',
    })
    await processor.process('p1')
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 marks a ready verdict ready and switches mode to my_form', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      user_id: 'u1',
      my_form_object_path: 'wardrobe/u1/silhouette/s1.png',
      my_form_status: 'processing',
    })
    mockModerate.mockResolvedValueOnce({ outcome: 'ready' })

    await processor.process('p1')

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        user_id: 'u1',
        my_form_object_path: 'wardrobe/u1/silhouette/s1.png',
        my_form_status: 'processing',
      },
      data: {
        my_form_status: 'ready',
        my_form_failure_reason: null,
        mode: 'my_form',
        revision: { increment: 1 },
      },
    })
    expect(mockModerationEventCreate).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 marks a contrast verdict failed without any moderation event', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      user_id: 'u1',
      my_form_object_path: 'wardrobe/u1/silhouette/s1.png',
      my_form_status: 'processing',
    })
    mockModerate.mockResolvedValueOnce({ outcome: 'contrast' })

    await processor.process('p1')

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          my_form_status: 'failed',
          my_form_failure_reason: 'contrast',
        }),
      })
    )
    expect(mockModerationEventCreate).not.toHaveBeenCalled()
    expect(mockGuardianConsentFindMany).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 writes a ModerationEvent and one EventEnvelope per active guardian on privacy_violation for a teen', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      user_id: 'teen-1',
      my_form_object_path: 'wardrobe/teen-1/silhouette/s1.png',
      my_form_status: 'processing',
    })
    mockModerate.mockResolvedValueOnce({ outcome: 'privacy_violation' })
    mockGuardianConsentFindMany.mockResolvedValueOnce([
      { guardian_id: 'g1', guardian: { email: 'guardian1@example.test' } },
      { guardian_id: 'g2', guardian: { email: 'guardian2@example.test' } },
    ])
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'teen-1',
      email: 'teen1@example.test',
    })

    await processor.process('p1')

    expect(mockModerationEventCreate).toHaveBeenCalledWith({
      data: {
        silhouette_profile_id: 'p1',
        action: 'flagged',
        reason: 'privacy_violation',
      },
    })
    expect(mockEventEnvelopeCreateMany).toHaveBeenCalledTimes(1)
    const call = mockEventEnvelopeCreateMany.mock.calls[0]?.[0] as {
      data: {
        channel: string
        user_id: string
        payload: { to: string; flaggedAt: string }
      }[]
    }
    expect(call.data).toHaveLength(2)
    expect(call.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'email.guardian-silhouette-flag',
          user_id: 'teen-1',
          payload: expect.objectContaining({ to: 'guardian1@example.test' }),
        }),
        expect.objectContaining({
          channel: 'email.guardian-silhouette-flag',
          user_id: 'teen-1',
          payload: expect.objectContaining({ to: 'guardian2@example.test' }),
        }),
      ])
    )
    // Every guardian's envelope shares one flaggedAt timestamp rather than
    // one `new Date()` call per iteration, which could otherwise disagree by
    // a few milliseconds across guardians for the same moderation event.
    expect(call.data[0]?.payload.flaggedAt).toBe(call.data[1]?.payload.flaggedAt)
  })

  it('4.4-UNIT-06 does not write a ModerationEvent for a privacy_violation with no active guardian', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      user_id: 'adult-1',
      my_form_object_path: 'wardrobe/adult-1/silhouette/s1.png',
      my_form_status: 'processing',
    })
    mockModerate.mockResolvedValueOnce({ outcome: 'privacy_violation' })
    mockGuardianConsentFindMany.mockResolvedValueOnce([])

    await processor.process('p1')

    expect(mockModerationEventCreate).not.toHaveBeenCalled()
    expect(mockEventEnvelopeCreate).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 lets a genuine storage fault propagate instead of writing a terminal status', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'p1',
      user_id: 'u1',
      my_form_object_path: 'wardrobe/u1/silhouette/s1.png',
      my_form_status: 'processing',
    })
    mockDownload.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(processor.process('p1')).rejects.toThrow('storage unavailable')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 markFailed writes the two-argument reason and bumps revision', async () => {
    await processor.markFailed('p1', 'timeout')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', my_form_status: 'processing' },
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: 'timeout',
        revision: { increment: 1 },
      },
    })
  })
})
