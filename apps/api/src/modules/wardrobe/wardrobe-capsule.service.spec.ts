/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off their mock object, which is the established pattern for these suites. */
import { describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  HttpException,
  PreconditionFailedException,
} from '@nestjs/common'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import type { RitualService } from '../personalization/ritual.service.js'
import type { WardrobeAccessService } from './wardrobe-access.service.js'
import type { CapsuleTelemetryOutbox } from './wardrobe-capsule.outbox.js'
import type {
  CapsuleWithGarmentJoins,
  WardrobeCapsuleRepository,
} from './wardrobe-capsule.repository.js'
import {
  computeCapsulePayloadHash,
  formatCapsuleETag,
  parseIfMatchHeader,
  WardrobeCapsuleService,
} from './wardrobe-capsule.service.js'
import type { WardrobeStorage } from './wardrobe-storage.adapter.js'

const CAPSULE_ID = 'capsule-1'

function garmentJoin(id: string, order: number, overrides: Record<string, unknown> = {}) {
  return {
    garment_id: id,
    garment_order: order,
    garment: {
      id,
      category: order === 0 ? 'top' : 'bottom',
      material: 'cotton',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      object_path: `user-1/${id}.png`,
      ...overrides,
    },
  }
}

/**
 * A deliberately partial row: only the fields the service actually reads.
 * Returning the full Prisma payload would add 30 irrelevant columns to every
 * fixture without strengthening a single assertion.
 */
function capsuleRow(overrides: Record<string, unknown> = {}): CapsuleWithGarmentJoins {
  return {
    id: CAPSULE_ID,
    user_id: 'user-1',
    name: 'Work',
    description: 'Office',
    occasions: ['casual', 'work'],
    is_favorite: false,
    revision: 1,
    created_at: new Date('2026-08-05T10:00:00Z'),
    updated_at: new Date('2026-08-05T10:00:00Z'),
    garment_joins: [garmentJoin('garment-1', 0), garmentJoin('garment-2', 1)],
    ...overrides,
  } as unknown as CapsuleWithGarmentJoins
}

describe('WardrobeCapsuleService', () => {
  const createMockRepo = () =>
    ({
      createCapsule: vi
        .fn()
        .mockResolvedValue({ capsule: capsuleRow(), isReplay: false }),
      listCapsules: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findCapsuleById: vi.fn().mockResolvedValue(capsuleRow()),
      updateCapsule: vi.fn().mockResolvedValue({
        capsule: capsuleRow(),
        isNoOp: false,
        changedFields: ['name'],
      }),
      setFavoriteStatus: vi
        .fn()
        .mockResolvedValue({ capsule: capsuleRow(), isNoOp: false }),
      deleteCapsule: vi.fn().mockResolvedValue({ acceptedRevision: 1 }),
    }) as unknown as WardrobeCapsuleRepository

  const createMockAccessService = () =>
    ({
      assertReadAccess: vi.fn().mockResolvedValue({ actorRole: 'owner' }),
      assertWriteAccess: vi.fn().mockResolvedValue({ actorRole: 'owner' }),
    }) as unknown as WardrobeAccessService

  const createMockOutbox = () =>
    ({
      dispatchAfterCommit: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CapsuleTelemetryOutbox

  const createMockRitual = () =>
    ({ invalidateUserCache: vi.fn().mockResolvedValue(true) }) as unknown as RitualService

  const createMockStorage = () =>
    ({
      signReadUrl: vi.fn().mockResolvedValue('https://example.test/signed.png'),
    }) as unknown as WardrobeStorage

  const createMockAnalytics = () => ({ capture: vi.fn() }) as unknown as AnalyticsClient

  function createService(overrides: Partial<Record<string, unknown>> = {}) {
    const repo = (overrides.repo as WardrobeCapsuleRepository) ?? createMockRepo()
    const accessService =
      (overrides.accessService as WardrobeAccessService) ?? createMockAccessService()
    const outbox = (overrides.outbox as CapsuleTelemetryOutbox) ?? createMockOutbox()
    const ritualService = (overrides.ritualService as RitualService) ?? createMockRitual()
    const storage = (overrides.storage as WardrobeStorage) ?? createMockStorage()
    const analytics = (overrides.analytics as AnalyticsClient) ?? createMockAnalytics()

    return {
      service: new WardrobeCapsuleService(
        repo,
        accessService,
        outbox,
        ritualService,
        storage,
        analytics
      ),
      repo,
      accessService,
      outbox,
      ritualService,
      storage,
      analytics,
    }
  }

  const actor: RequestAuthContext = { token: 't', userId: 'user-1', role: 'teen' }

  describe('parseIfMatchHeader', () => {
    /**
     * Regression for the defect where the server emitted
     * `"capsule:<id>:<revision>"` but the parser only accepted a bare integer,
     * so any client echoing the ETag it was given received a permanent 412.
     */
    it('4.3-UNIT-SVC-01 accepts the entity tag the server itself issues', () => {
      const etag = formatCapsuleETag(CAPSULE_ID, 7)
      expect(etag).toBe('"capsule:capsule-1:7"')
      expect(parseIfMatchHeader(etag, CAPSULE_ID)).toBe(7)
    })

    it('4.3-UNIT-SVC-02 treats the wildcard as matching any current state', () => {
      expect(parseIfMatchHeader('*', CAPSULE_ID)).toBeNull()
    })

    it('4.3-UNIT-SVC-03 accepts a list when any member names this capsule', () => {
      const header = `"capsule:other:3", ${formatCapsuleETag(CAPSULE_ID, 4)}`
      expect(parseIfMatchHeader(header, CAPSULE_ID)).toBe(4)
    })

    it('4.3-UNIT-SVC-04 rejects an entity tag that names a different capsule', () => {
      expect(() =>
        parseIfMatchHeader(formatCapsuleETag('some-other-capsule', 1), CAPSULE_ID)
      ).toThrow(PreconditionFailedException)
    })

    it('4.3-UNIT-SVC-05 rejects a weak validator, which is not usable with If-Match', () => {
      expect(() =>
        parseIfMatchHeader(`W/${formatCapsuleETag(CAPSULE_ID, 1)}`, CAPSULE_ID)
      ).toThrow(PreconditionFailedException)
    })

    it('4.3-UNIT-SVC-06 rejects a bare revision number that carries no resource identity', () => {
      expect(() => parseIfMatchHeader('"5"', CAPSULE_ID)).toThrow(
        PreconditionFailedException
      )
    })

    it('4.3-UNIT-SVC-07 requires the precondition to be present at all', () => {
      expect(() => parseIfMatchHeader(undefined, CAPSULE_ID)).toThrow(HttpException)
    })

    it('4.3-UNIT-SVC-08 rejects a malformed header', () => {
      expect(() => parseIfMatchHeader('invalid', CAPSULE_ID)).toThrow(
        PreconditionFailedException
      )
    })
  })

  describe('computeCapsulePayloadHash', () => {
    it('4.3-UNIT-SVC-09 is independent of occasion array order', () => {
      expect(
        computeCapsulePayloadHash({
          name: 'Capsule A',
          occasions: ['work', 'casual'],
          garmentIds: ['g-1', 'g-2'],
        })
      ).toBe(
        computeCapsulePayloadHash({
          name: 'Capsule A',
          occasions: ['casual', 'work'],
          garmentIds: ['g-1', 'g-2'],
        })
      )
    })

    /** Canonically equivalent Unicode must replay the same capsule, not conflict. */
    it('4.3-UNIT-SVC-10 treats NFC and NFD spellings of the same name as identical', () => {
      // Precomposed U+00E9, versus 'e' followed by combining acute U+0301.
      const composed = 'caf\u00e9'
      const decomposed = 'cafe\u0301'
      expect(composed).not.toBe(decomposed)

      const nfc = computeCapsulePayloadHash({
        name: composed,
        occasions: ['work'],
        garmentIds: ['g-1', 'g-2'],
      })
      const nfd = computeCapsulePayloadHash({
        name: decomposed,
        occasions: ['work'],
        garmentIds: ['g-1', 'g-2'],
      })
      expect(nfc).toBe(nfd)
    })

    /** An omitted description and an empty one are the same canonical state. */
    it('4.3-UNIT-SVC-11 treats an empty description as absent', () => {
      expect(
        computeCapsulePayloadHash({
          name: 'A',
          description: '   ',
          occasions: ['work'],
          garmentIds: ['g-1', 'g-2'],
        })
      ).toBe(
        computeCapsulePayloadHash({
          name: 'A',
          occasions: ['work'],
          garmentIds: ['g-1', 'g-2'],
        })
      )
    })

    it('4.3-UNIT-SVC-12 rejects a whitespace-only name rather than hashing an empty string', () => {
      expect(() =>
        computeCapsulePayloadHash({
          name: '   ',
          occasions: ['work'],
          garmentIds: ['g-1', 'g-2'],
        })
      ).toThrow(BadRequestException)
    })
  })

  describe('createCapsule', () => {
    it('4.3-UNIT-SVC-13 returns the capsule and dispatches exactly one durable claim', async () => {
      const { service, outbox, ritualService } = createService()

      const result = await service.createCapsule(actor, 'user-1', {
        name: 'Work',
        occasions: ['work'],
        garmentIds: ['garment-1', 'garment-2'],
        isFavorite: false,
      })

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(result.isReplay).toBe(false)
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledTimes(1)
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledWith({
        ownerUserId: 'user-1',
        capsuleId: CAPSULE_ID,
        revision: 1,
        eventName: 'wardrobe_capsule_created',
      })
      expect(ritualService.invalidateUserCache).toHaveBeenCalledWith('user-1')
    })

    /** A replay must not emit a second creation event. */
    it('4.3-UNIT-SVC-14 emits nothing on an idempotent replay', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.createCapsule).mockResolvedValue({
        capsule: capsuleRow(),
        isReplay: true,
      })
      const { service, outbox } = createService({ repo })

      const result = await service.createCapsule(actor, 'user-1', {
        name: 'Work',
        occasions: ['work'],
        garmentIds: ['garment-1', 'garment-2'],
        isFavorite: false,
      })

      expect(result.isReplay).toBe(true)
      expect(outbox.dispatchAfterCommit).not.toHaveBeenCalled()
    })
  })

  describe('response projection', () => {
    /**
     * Retention retains join rows for purged garments. Their details must not be
     * served back; only the count is reported.
     */
    it('4.3-UNIT-SVC-15 excludes unavailable garments and reports them as a count', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.findCapsuleById).mockResolvedValue(
        capsuleRow({
          garment_joins: [
            garmentJoin('garment-1', 0),
            garmentJoin('garment-2', 1, {
              retention_status: 'deletion_pending',
              upload_status: 'failed',
            }),
          ],
        })
      )
      const { service } = createService({ repo })

      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)

      expect(data.garments).toHaveLength(1)
      expect(data.garments[0]?.id).toBe('garment-1')
      expect(data.unavailableGarmentCount).toBe(1)
      expect(data.availabilityStatus).toBe('needs_repair')
    })

    /** A garment that never finished uploading is not available either. */
    it('4.3-UNIT-SVC-16 treats a non-ready upload as unavailable even when retention is active', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.findCapsuleById).mockResolvedValue(
        capsuleRow({
          garment_joins: [
            garmentJoin('garment-1', 0),
            garmentJoin('garment-2', 1, { upload_status: 'processing' }),
          ],
        })
      )
      const { service } = createService({ repo })

      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)

      expect(data.unavailableGarmentCount).toBe(1)
      expect(data.availabilityStatus).toBe('needs_repair')
    })

    it('4.3-UNIT-SVC-17 emits occasions in canonical enum order', async () => {
      const { service } = createService()
      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)
      expect(data.occasions).toEqual(['work', 'casual'])
    })

    /** A storage outage must degrade to a missing image, not a failed request. */
    it('4.3-UNIT-SVC-18 still returns the capsule when image signing fails', async () => {
      const storage = {
        signReadUrl: vi.fn().mockRejectedValue(new Error('supabase down')),
      } as unknown as WardrobeStorage
      const { service } = createService({ storage })

      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)

      expect(data.garments).toHaveLength(2)
      expect(data.garments[0]?.imageAccess).toBeNull()
    })

    /** One signing call per distinct object path, not one per join. */
    it('4.3-UNIT-SVC-19 signs each distinct object path once', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.listCapsules).mockResolvedValue({
        items: [capsuleRow(), capsuleRow({ id: 'capsule-2' })],
        total: 2,
      } as never)
      const storage = createMockStorage()
      const { service } = createService({ repo, storage })

      await service.listCapsules(actor, 'user-1', { limit: 20, offset: 0 })

      expect(storage.signReadUrl).toHaveBeenCalledTimes(2)
    })
  })

  describe('deleteCapsule', () => {
    it('4.3-UNIT-SVC-20 claims the delete against the final accepted revision', async () => {
      const { service, outbox } = createService()

      await service.deleteCapsule(
        actor,
        'user-1',
        CAPSULE_ID,
        formatCapsuleETag(CAPSULE_ID, 1)
      )

      expect(outbox.dispatchAfterCommit).toHaveBeenCalledWith({
        ownerUserId: 'user-1',
        capsuleId: CAPSULE_ID,
        revision: 1,
        eventName: 'wardrobe_capsule_deleted',
      })
    })
  })
})
