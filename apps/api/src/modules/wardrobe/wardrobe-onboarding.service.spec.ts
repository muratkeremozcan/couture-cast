/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions read vi.fn() members off their mock object and nest expect.objectContaining(), which is the established pattern for these suites. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictException, PreconditionFailedException } from '@nestjs/common'
import type { PrismaClient, WardrobeOnboardingState } from '@prisma/client'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
import {
  formatOnboardingETag,
  parseOnboardingIfMatchHeader,
  WardrobeOnboardingService,
} from './wardrobe-onboarding.service.js'

describe('formatOnboardingETag / parseOnboardingIfMatchHeader', () => {
  it('4.4-UNIT-01 formats and round-trips a strong entity tag', () => {
    const tag = formatOnboardingETag('user-1', 3)
    expect(tag).toBe('"onboarding:user-1:3"')
    expect(parseOnboardingIfMatchHeader(tag, 'user-1')).toBe(3)
  })

  it('4.4-UNIT-01 treats "*" as matching any current revision', () => {
    expect(parseOnboardingIfMatchHeader('*', 'user-1')).toBeNull()
  })

  it('4.4-UNIT-01 throws 428 PRECONDITION_REQUIRED when the header is missing or blank', () => {
    expect(() => parseOnboardingIfMatchHeader(undefined, 'user-1')).toThrowError(
      'PRECONDITION_REQUIRED'
    )
    expect(() => parseOnboardingIfMatchHeader('   ', 'user-1')).toThrowError(
      'PRECONDITION_REQUIRED'
    )
  })

  it('4.4-UNIT-01 rejects a weak validator', () => {
    expect(() =>
      parseOnboardingIfMatchHeader('W/"onboarding:user-1:1"', 'user-1')
    ).toThrowError(PreconditionFailedException)
  })

  it('4.4-UNIT-01 rejects an entity tag naming a different user', () => {
    expect(() =>
      parseOnboardingIfMatchHeader('"onboarding:someone-else:1"', 'user-1')
    ).toThrowError(PreconditionFailedException)
  })

  it('4.4-UNIT-01 rejects a malformed tag body', () => {
    expect(() => parseOnboardingIfMatchHeader('"garbage"', 'user-1')).toThrowError(
      PreconditionFailedException
    )
  })

  it('4.4-UNIT-01 accepts the first matching candidate in a comma-separated list', () => {
    expect(
      parseOnboardingIfMatchHeader(
        '"onboarding:someone-else:9", "onboarding:user-1:2"',
        'user-1'
      )
    ).toBe(2)
  })
})

const USER_ID = 'user-1'

/** A deliberately partial row: only the columns the service actually reads. */
const ROW_COMPLETED_AT = new Date('2026-08-09T10:30:00Z')

/**
 * `status`, `current_step` and `completed_at` move together in a real row: the
 * terminal step is exactly the completed status, and only a completed row
 * carries a completion timestamp. A test sets whichever of the three its case is
 * about, so the factory fills in the others rather than making every call site
 * restate the invariant. The response contract now rejects the combinations this
 * prevents.
 */
function stateRow(overrides: Partial<WardrobeOnboardingState> = {}) {
  const isTerminal =
    overrides.current_step === 'complete' || overrides.status === 'completed'
  const derived: Record<string, unknown> = {}
  if (isTerminal) {
    if (!('status' in overrides)) derived.status = 'completed'
    if (!('current_step' in overrides)) derived.current_step = 'complete'
    if (!('completed_at' in overrides)) derived.completed_at = ROW_COMPLETED_AT
  }

  return {
    user_id: USER_ID,
    status: 'in_progress',
    current_step: 'capture',
    used_starter_wardrobe: false,
    garments_captured_count: 0,
    started_at: new Date('2026-08-09T10:00:00Z'),
    completed_at: null,
    revision: 1,
    started_telemetry_emitted_at: new Date('2026-08-09T10:00:00Z'),
    completed_telemetry_emitted_at: null,
    ...overrides,
    ...derived,
  } as unknown as WardrobeOnboardingState
}

describe('WardrobeOnboardingService.advanceStep', () => {
  const findUnique = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const updateMany = vi.fn()
  const garmentCount = vi.fn().mockResolvedValue(0)
  const silhouetteFindUnique = vi.fn().mockResolvedValue(null)

  const prisma = {
    wardrobeOnboardingState: { findUnique, create, update, updateMany },
    garmentItem: { count: garmentCount },
    silhouetteProfile: { findUnique: silhouetteFindUnique },
    $executeRaw: vi.fn(),
    $transaction: vi.fn((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(prisma as unknown as PrismaClient)
    ),
  } as unknown as PrismaClient

  const capture = vi.fn()
  const analytics = { capture } as unknown as AnalyticsClient
  let service: WardrobeOnboardingService

  beforeEach(() => {
    vi.clearAllMocks()
    garmentCount.mockResolvedValue(0)
    silhouetteFindUnique.mockResolvedValue(null)
    updateMany.mockResolvedValue({ count: 0 })
    service = new WardrobeOnboardingService(prisma, analytics)
  })

  it('4.4-UNIT-14 creates the first row and emits the started event once', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockResolvedValueOnce(stateRow({ revision: 1 }))
    updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 0), {
      targetStep: 'capture',
    })

    expect(result.isNoOp).toBe(false)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: USER_ID,
          current_step: 'capture',
          status: 'in_progress',
          revision: 1,
        }),
      })
    )
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('4.4-UNIT-14 rejects a first transition that is not forward-reachable', async () => {
    findUnique.mockResolvedValueOnce(null)

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 0), {
        targetStep: 'silhouette',
      })
    ).rejects.toBeInstanceOf(ConflictException)
    expect(create).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-14 rejects a non-zero expected revision before any row exists', async () => {
    findUnique.mockResolvedValueOnce(null)

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 2), {
        targetStep: 'capture',
      })
    ).rejects.toBeInstanceOf(PreconditionFailedException)
  })

  it('4.4-UNIT-14 rejects a stale revision against an existing row', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ revision: 5 }))

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
        targetStep: 'tagging',
      })
    ).rejects.toBeInstanceOf(PreconditionFailedException)
    expect(update).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-14 rejects a backwards transition', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'silhouette' }))

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
        targetStep: 'capture',
      })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('4.4-UNIT-14 rejects skipping tagging without the starter wardrobe', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
        targetStep: 'silhouette',
      })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('4.4-UNIT-14 rejects entering tagging on the starter-wardrobe path', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))

    await expect(
      service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
        targetStep: 'tagging',
        usedStarterWardrobe: true,
      })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('4.4-UNIT-14 recomputes the garment count server-side at the silhouette step', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'tagging' }))
    garmentCount.mockResolvedValueOnce(7)
    update.mockResolvedValueOnce(stateRow({ current_step: 'silhouette', revision: 2 }))

    await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'silhouette',
    })

    expect(garmentCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER_ID,
          upload_status: { in: ['awaiting_tags', 'ready'] },
          retention_status: 'active',
        }),
      })
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ garments_captured_count: 7 }),
      })
    )
  })

  it('4.4-UNIT-14 keeps a recorded starter-wardrobe flag when a later step omits it', async () => {
    findUnique.mockResolvedValueOnce(
      stateRow({ current_step: 'silhouette', used_starter_wardrobe: true })
    )
    update.mockResolvedValueOnce(
      stateRow({ current_step: 'complete', used_starter_wardrobe: true, revision: 2 })
    )

    await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'complete',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ used_starter_wardrobe: true }),
      })
    )
  })

  it('4.4-UNIT-14 treats an identical transition as a no-op replay', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))

    const result = await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'capture',
    })

    expect(result.isNoOp).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-14 still runs the telemetry claim on a no-op replay', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))
    updateMany.mockResolvedValueOnce({ count: 1 })

    await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'capture',
    })

    // The claim is what recovers an event lost to a crash between commit and
    // emission; skipping it on replay dropped that event permanently.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: USER_ID, started_telemetry_emitted_at: null },
      })
    )
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('4.4-UNIT-14 emits the completed event with the persisted silhouette mode', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'silhouette' }))
    update.mockResolvedValueOnce(
      stateRow({
        current_step: 'complete',
        status: 'completed',
        completed_at: new Date('2026-08-09T10:05:00Z'),
        garments_captured_count: 3,
        revision: 2,
      })
    )
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    silhouetteFindUnique.mockResolvedValueOnce({ mode: 'my_form' })

    await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'complete',
    })

    expect(capture).toHaveBeenCalledTimes(1)
    const event = capture.mock.calls[0]?.[0] as {
      properties: Record<string, unknown>
    }
    expect(event.properties).toMatchObject({
      silhouette_mode: 'my_form',
      garment_count: 3,
      duration_ms: 300_000,
    })
  })

  it('4.4-UNIT-14 releases the telemetry claim when the analytics handoff throws', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))
    updateMany.mockResolvedValueOnce({ count: 1 })
    capture.mockImplementationOnce(() => {
      throw new Error('analytics down')
    })

    await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'capture',
    })

    // Leaving the guard stamped would claim an event that was never emitted
    // and make it unrecoverable on any later replay.
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { user_id: USER_ID },
      data: { started_telemetry_emitted_at: null },
    })
  })

  it('4.4-UNIT-14 does not let a telemetry failure fail the transition', async () => {
    findUnique.mockResolvedValueOnce(stateRow({ current_step: 'capture' }))
    update.mockResolvedValueOnce(stateRow({ current_step: 'tagging', revision: 2 }))
    updateMany.mockRejectedValue(new Error('db blip'))

    const result = await service.advanceStep(USER_ID, formatOnboardingETag(USER_ID, 1), {
      targetStep: 'tagging',
    })

    // Telemetry is best-effort; the state transition is the contract.
    expect(result.response.data.currentStep).toBe('tagging')
    expect(result.response.data.revision).toBe(2)
  })
})
