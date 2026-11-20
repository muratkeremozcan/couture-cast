// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SilhouettePhotoProcessor } from './silhouette-photo.processor'
import {
  buildSilhouettePhotoJobId,
  silhouetteSessionFromJobId,
} from './silhouette-photo-processing.queue'
import type { SilhouettePhotoModerationEngine } from './silhouette-photo-moderation.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

/** Upload session ids are server-minted UUIDs; B replaced A on the same profile. */
const SESSION_A = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
const SESSION_B = '9f8e7d6c-5b4a-4398-8776-655443322110'

/** A processing My Form row whose path is the session's own photo. */
function processingRow(userId: string, sessionId = SESSION_A, overrides = {}) {
  return {
    id: 'p1',
    user_id: userId,
    my_form_object_path: `wardrobe/${userId}/silhouette/${sessionId}.png`,
    my_form_upload_session_id: sessionId,
    my_form_status: 'processing',
    ...overrides,
  }
}

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

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockModerationEventCreate.mockResolvedValue({ id: 'moderation-1' })
  })

  it('4.4-UNIT-06 skips a profile that is not currently processing', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await processor.process('missing', SESSION_A)
    expect(mockDownload).not.toHaveBeenCalled()

    mockFindUnique.mockResolvedValueOnce(
      processingRow('u1', SESSION_A, { my_form_status: 'ready' })
    )
    await processor.process('p1', SESSION_A)
    expect(mockDownload).not.toHaveBeenCalled()
  })

  // Review round 1, 2026-11-19: never read an object that is not the member's own photo.
  it('fails a profile whose path names another member photo without reading it', async () => {
    mockFindUnique.mockResolvedValueOnce(
      processingRow('u1', SESSION_A, {
        my_form_object_path: `wardrobe/u2/silhouette/${SESSION_A}.png`,
      })
    )

    await processor.process('p1', SESSION_A)

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockModerate).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        my_form_status: 'processing',
        my_form_upload_session_id: SESSION_A,
      },
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: 'storage_error',
        revision: { increment: 1 },
      },
    })
  })

  /** Round 3 (Codex C2-2): the exact object id, a sibling session's photo included. */
  it("fails a profile whose path names the member's photo of another session without reading it", async () => {
    mockFindUnique.mockResolvedValueOnce(
      processingRow('u1', SESSION_B, {
        my_form_object_path: `wardrobe/u1/silhouette/${SESSION_A}.png`,
      })
    )

    await processor.process('p1', SESSION_B)

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: {
          id: 'p1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_B,
        },
      })
    )
  })

  it('4.4-UNIT-06 marks a ready verdict ready and switches mode to my_form', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('u1'))
    mockModerate.mockResolvedValueOnce({ outcome: 'ready' })

    await processor.process('p1', SESSION_A)

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        user_id: 'u1',
        my_form_object_path: `wardrobe/u1/silhouette/${SESSION_A}.png`,
        my_form_upload_session_id: SESSION_A,
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
    mockFindUnique.mockResolvedValueOnce(processingRow('u1'))
    mockModerate.mockResolvedValueOnce({ outcome: 'contrast' })

    await processor.process('p1', SESSION_A)

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

  it('4.4-UNIT-06 writes a ModerationEvent and one EventEnvelope per active guardian on privacy_violation for a teen under policy required_13_15', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'required_13_15')
    mockFindUnique.mockResolvedValueOnce(processingRow('teen-1'))
    mockModerate.mockResolvedValueOnce({ outcome: 'privacy_violation' })
    mockGuardianConsentFindMany.mockResolvedValueOnce([
      { guardian_id: 'g1', guardian: { email: 'guardian1@example.test' } },
      { guardian_id: 'g2', guardian: { email: 'guardian2@example.test' } },
    ])
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'teen-1',
      email: 'teen1@example.test',
    })

    await processor.process('p1', SESSION_A)

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

  // TEA sign-off F-3: while guardian consent is off a granted row reaches no guardian.
  it('A-OFF-GUARDIAN-ACCESS under policy off marks the failure and mails no granted guardian', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'off')
    mockFindUnique.mockResolvedValueOnce(processingRow('teen-1'))
    mockModerate.mockResolvedValueOnce({ outcome: 'privacy_violation' })
    mockGuardianConsentFindMany.mockResolvedValueOnce([
      { guardian_id: 'g1', guardian: { email: 'guardian1@example.test' } },
    ])

    await processor.process('p1', SESSION_A)

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          my_form_status: 'failed',
          my_form_failure_reason: 'privacy_violation',
        }),
      })
    )
    expect(mockGuardianConsentFindMany).not.toHaveBeenCalled()
    expect(mockModerationEventCreate).not.toHaveBeenCalled()
    expect(mockEventEnvelopeCreateMany).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 does not write a ModerationEvent for a privacy_violation with no active guardian', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('adult-1'))
    mockModerate.mockResolvedValueOnce({ outcome: 'privacy_violation' })
    mockGuardianConsentFindMany.mockResolvedValueOnce([])

    await processor.process('p1', SESSION_A)

    expect(mockModerationEventCreate).not.toHaveBeenCalled()
    expect(mockEventEnvelopeCreate).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 lets a genuine storage fault propagate instead of writing a terminal status', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('u1'))
    mockDownload.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(processor.process('p1', SESSION_A)).rejects.toThrow(
      'storage unavailable'
    )
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-06 markFailed writes the two-argument reason and bumps revision', async () => {
    await processor.markFailed('p1', 'timeout', SESSION_A)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        my_form_status: 'processing',
        my_form_upload_session_id: SESSION_A,
      },
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: 'timeout',
        revision: { increment: 1 },
      },
    })
  })

  /**
   * Round 4 (Codex C3-6) replaces the status-only guard a legacy job kept: a job whose session
   * cannot be recovered could otherwise fail whatever photo the profile is processing now.
   */
  it('markFailed for a job whose session is unknown writes nothing', async () => {
    await processor.markFailed('p1', 'timeout', null)

    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('a job whose session is unknown exits without reading or writing anything', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('u1', SESSION_A))

    await processor.process('p1', null)

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockModerate).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  /**
   * Round 4 (Codex C3-6): a job enqueued before the payload carried its session (or by a
   * producer that now sends only the profile id, so an older consumer still accepts it) names
   * its session in its deterministic job id. Job A starting after replacement B reached
   * processing recovers its own session A and writes nothing.
   */
  it('a legacy job starting after a replacement recovers its own session from the job id and writes nothing', async () => {
    const sessionOfJob = silhouetteSessionFromJobId({
      id: buildSilhouettePhotoJobId('p1', SESSION_A),
      data: { silhouetteProfileId: 'p1' },
    })
    expect(sessionOfJob).toBe(SESSION_A)
    mockFindUnique.mockResolvedValueOnce(processingRow('u1', SESSION_B))

    await processor.process('p1', sessionOfJob)

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('a legacy job that matches the processing session completes under that session guard', async () => {
    const sessionOfJob = silhouetteSessionFromJobId({
      id: buildSilhouettePhotoJobId('p1', SESSION_A),
      data: { silhouetteProfileId: 'p1' },
    })
    mockFindUnique.mockResolvedValueOnce(processingRow('u1', SESSION_A))
    mockModerate.mockResolvedValueOnce({ outcome: 'ready' })

    await processor.process('p1', sessionOfJob)

    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: expect.objectContaining({ my_form_upload_session_id: SESSION_A }),
        data: expect.objectContaining({ my_form_status: 'ready' }),
      })
    )
  })

  /**
   * Round 4 (Codex C3-6): job A's last attempt threw after replacement B reached processing;
   * retry exhaustion carries A's own session into markFailed, which matches no row.
   */
  it('retry exhaustion of an old job after a replacement is fenced on the old session', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })

    await processor.markFailed('p1', 'timeout', SESSION_A)

    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: {
          id: 'p1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_A,
        },
      })
    )
  })

  /**
   * Round 3 (Codex C2-7): the member replaced the photo (session B is processing) before job A
   * finished. A's result is not B's, so A writes nothing and leaves B for B's own job.
   */
  it('an old job finishing after a replacement reached processing writes nothing', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('u1', SESSION_B))

    await processor.process('p1', SESSION_A)

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockModerate).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('fences a verdict on the job session, so a replacement made mid-moderation is untouched', async () => {
    mockFindUnique.mockResolvedValueOnce(processingRow('u1', SESSION_A))
    mockModerate.mockResolvedValueOnce({ outcome: 'contrast' })
    // The replacement landed while A was moderating: the fenced write matches no row.
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })

    await processor.process('p1', SESSION_A)

    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: expect.objectContaining({
          my_form_upload_session_id: SESSION_A,
          my_form_status: 'processing',
        }),
      })
    )
  })

  it('markFailed for an old job is fenced on its own session, never the newer one', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })

    await processor.markFailed('p1', 'storage_error', SESSION_A)

    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'p1',
        my_form_status: 'processing',
        my_form_upload_session_id: SESSION_A,
      },
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: 'storage_error',
        revision: { increment: 1 },
      },
    })
  })
})
