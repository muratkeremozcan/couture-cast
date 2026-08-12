// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off their mock object, which is the established pattern for these suites. */
import { describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  HttpException,
  NotFoundException,
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

    /**
     * `Number()` happily returns 1e21 for a 21-digit revision. Accepting it would
     * compare the stored revision against a value no row can ever hold, so the
     * precondition must fail rather than silently never match.
     */
    it('4.3-UNIT-SVC-08a rejects a revision beyond the safe integer range', () => {
      expect(() =>
        parseIfMatchHeader('"capsule:capsule-1:999999999999999999999"', CAPSULE_ID)
      ).toThrow(PreconditionFailedException)
    })

    it('4.3-UNIT-SVC-08b rejects an empty header the same as an absent one', () => {
      expect(() => parseIfMatchHeader('   ', CAPSULE_ID)).toThrow(HttpException)
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

    /**
     * A guardian acting on a teen's wardrobe must be recorded on the audit row.
     * Owner actions carry no audit actor because the owner is already the subject.
     */
    it('4.3-UNIT-SVC-21 records the acting guardian on a non-owner delete', async () => {
      const accessService = {
        assertReadAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
        assertWriteAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
      } as unknown as WardrobeAccessService
      const { service, repo } = createService({ accessService })

      await service.deleteCapsule(
        { token: 't', userId: 'guardian-9', role: 'guardian' },
        'user-1',
        CAPSULE_ID,
        '*'
      )

      expect(repo.deleteCapsule).toHaveBeenCalledWith(
        'user-1',
        CAPSULE_ID,
        null,
        { actorUserId: 'guardian-9', actorRole: 'guardian' },
        expect.anything()
      )
    })
  })

  /**
   * The repository invokes `buildPayload` inside the same transaction that writes
   * the row, so the outbox claim and the analytics body cannot diverge. These
   * builders are only ever called from there, which is why the mocks below drive
   * them explicitly.
   */
  describe('telemetry payload builders', () => {
    type PayloadBuilder = {
      eventName: string
      buildPayload: (
        capsule: CapsuleWithGarmentJoins,
        changedFields?: string[]
      ) => Record<string, unknown>
    }

    function capturingRepo() {
      const built: Record<string, unknown>[] = []
      const capture = (options: PayloadBuilder, changedFields?: string[]) => {
        built.push(options.buildPayload(capsuleRow(), changedFields))
      }
      const repo = {
        createCapsule: vi.fn((...args: unknown[]) => {
          capture(args[5] as PayloadBuilder)
          return Promise.resolve({ capsule: capsuleRow(), isReplay: false })
        }),
        listCapsules: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        findCapsuleById: vi.fn().mockResolvedValue(capsuleRow()),
        updateCapsule: vi.fn((...args: unknown[]) => {
          capture(args[5] as PayloadBuilder, ['name'])
          return Promise.resolve({
            capsule: capsuleRow(),
            isNoOp: false,
            changedFields: ['name'],
          })
        }),
        setFavoriteStatus: vi.fn((...args: unknown[]) => {
          capture(args[5] as PayloadBuilder)
          return Promise.resolve({ capsule: capsuleRow(), isNoOp: false })
        }),
        deleteCapsule: vi.fn((...args: unknown[]) => {
          capture(args[4] as PayloadBuilder)
          return Promise.resolve({ acceptedRevision: 1 })
        }),
      } as unknown as WardrobeCapsuleRepository

      return { repo, built }
    }

    it('4.3-UNIT-SVC-38 builds a created event from the persisted capsule', async () => {
      const { repo, built } = capturingRepo()
      const { service } = createService({ repo })

      await service.createCapsule(actor, 'user-1', {
        name: 'Work',
        occasions: ['work'],
        garmentIds: ['garment-1', 'garment-2'],
      })

      expect(built[0]).toMatchObject({
        distinctId: 'user-1',
        event: 'wardrobe_capsule_created',
        properties: {
          capsule_id: CAPSULE_ID,
          garment_count: 2,
          occasions: ['work', 'casual'],
          is_favorite: false,
          actor_role: 'owner',
        },
      })
    })

    it('4.3-UNIT-SVC-39 builds an updated event carrying the changed fields', async () => {
      const { repo, built } = capturingRepo()
      const { service } = createService({ repo })

      await service.updateCapsule(actor, 'user-1', CAPSULE_ID, '*', { name: 'Renamed' })

      expect(built[0]).toMatchObject({
        event: 'wardrobe_capsule_updated',
        properties: {
          capsule_id: CAPSULE_ID,
          changed_fields: ['name'],
          garment_count: 2,
        },
      })
    })

    /** The event records what was asked for, not what the row happened to hold. */
    it('4.3-UNIT-SVC-40 builds a favorite event from the requested state', async () => {
      const { repo, built } = capturingRepo()
      const { service } = createService({ repo })

      await service.setFavoriteStatus(actor, 'user-1', CAPSULE_ID, '*', {
        isFavorite: true,
      })

      expect(built[0]).toMatchObject({
        event: 'wardrobe_capsule_favorite_changed',
        properties: { capsule_id: CAPSULE_ID, requested_state: true },
      })
    })

    it('4.3-UNIT-SVC-41 builds a deleted event from the request, not the vanished row', async () => {
      const { repo, built } = capturingRepo()
      const { service } = createService({ repo })

      await service.deleteCapsule(actor, 'user-1', CAPSULE_ID, '*')

      expect(built[0]).toMatchObject({
        distinctId: 'user-1',
        event: 'wardrobe_capsule_deleted',
        properties: { capsule_id: CAPSULE_ID, actor_role: 'owner' },
      })
    })
  })

  describe('cache invalidation is best-effort', () => {
    /**
     * The capsule revision, not Redis, is what guarantees freshness. A refused
     * invalidation must therefore not fail a mutation the database already
     * committed.
     */
    it('4.3-UNIT-SVC-22 completes the create when the cache clear reports failure', async () => {
      const ritualService = {
        invalidateUserCache: vi.fn().mockResolvedValue(false),
      } as unknown as RitualService
      const { service, outbox } = createService({ ritualService })

      const result = await service.createCapsule(actor, 'user-1', {
        name: 'Work',
        occasions: ['work'],
        garmentIds: ['garment-1', 'garment-2'],
        isFavorite: false,
      })

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledTimes(1)
    })

    it('4.3-UNIT-SVC-23 completes the create when the cache clear throws', async () => {
      const ritualService = {
        invalidateUserCache: vi.fn().mockRejectedValue(new Error('redis down')),
      } as unknown as RitualService
      const { service, outbox } = createService({ ritualService })

      const result = await service.createCapsule(actor, 'user-1', {
        name: 'Work',
        occasions: ['work'],
        garmentIds: ['garment-1', 'garment-2'],
        isFavorite: false,
      })

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledTimes(1)
    })

    /** A rejection that is not an `Error` must still be logged, not rethrown. */
    it('4.3-UNIT-SVC-24 completes the create when the cache clear rejects a non-Error', async () => {
      const ritualService = {
        invalidateUserCache: vi.fn().mockRejectedValue('redis exploded'),
      } as unknown as RitualService
      const { service } = createService({ ritualService })

      await expect(
        service.createCapsule(actor, 'user-1', {
          name: 'Work',
          occasions: ['work'],
          garmentIds: ['garment-1', 'garment-2'],
          isFavorite: false,
        })
      ).resolves.toMatchObject({ isReplay: false })
    })
  })

  describe('createCapsule idempotency and audit', () => {
    /** The payload hash is only computed when a key exists to attach it to. */
    it('4.3-UNIT-SVC-25 attaches a payload hash only when an idempotency key is supplied', async () => {
      const { service, repo } = createService()
      const input = {
        name: 'Work',
        occasions: ['work' as const],
        garmentIds: ['garment-1', 'garment-2'],
        isFavorite: false,
      }

      await service.createCapsule(actor, 'user-1', input, 'key-1')

      const [, , , hashWithKey] = vi.mocked(repo.createCapsule).mock.calls[0] ?? []
      expect(hashWithKey).toBe(computeCapsulePayloadHash(input))

      await service.createCapsule(actor, 'user-1', input)

      const [, , , hashWithoutKey] = vi.mocked(repo.createCapsule).mock.calls[1] ?? []
      expect(hashWithoutKey).toBeUndefined()
    })

    it('4.3-UNIT-SVC-26 records the acting guardian on a non-owner create', async () => {
      const accessService = {
        assertReadAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
        assertWriteAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
      } as unknown as WardrobeAccessService
      const { service, repo } = createService({ accessService })

      await service.createCapsule(
        { token: 't', userId: 'guardian-9', role: 'guardian' },
        'user-1',
        { name: 'Work', occasions: ['work'], garmentIds: ['garment-1', 'garment-2'] }
      )

      const [, , , , auditActor] = vi.mocked(repo.createCapsule).mock.calls[0] ?? []
      expect(auditActor).toEqual({ actorUserId: 'guardian-9', actorRole: 'guardian' })
    })
  })

  describe('listCapsules', () => {
    /**
     * The contract defaults are the pagination the client sees. Echoing back
     * `undefined` would make the response fail its own list schema.
     */
    it('4.3-UNIT-SVC-27 echoes the contract default page when the query omits it', async () => {
      const { service } = createService()

      const result = await service.listCapsules(
        actor,
        'user-1',
        {} as Parameters<typeof service.listCapsules>[2]
      )

      expect(result).toMatchObject({ total: 0, limit: 20, offset: 0 })
    })
  })

  describe('getCapsule', () => {
    it('4.3-UNIT-SVC-28 reports a missing capsule as not found', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.findCapsuleById).mockResolvedValue(null)
      const { service } = createService({ repo })

      await expect(service.getCapsule(actor, 'user-1', CAPSULE_ID)).rejects.toThrow(
        NotFoundException
      )
    })

    /**
     * A garment can be `ready` and still have no stored object after a storage
     * migration. It stays in the capsule with a null image rather than vanishing.
     */
    it('4.3-UNIT-SVC-29 returns an available garment with no stored object as image-less', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.findCapsuleById).mockResolvedValue(
        capsuleRow({
          garment_joins: [garmentJoin('garment-1', 0, { object_path: null })],
        })
      )
      const { service } = createService({ repo })

      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)

      expect(data.garments).toHaveLength(1)
      expect(data.garments[0]?.imageAccess).toBeNull()
      expect(data.unavailableGarmentCount).toBe(0)
    })

    /** A signing failure that is not an `Error` must degrade the same way. */
    it('4.3-UNIT-SVC-30 still returns the capsule when signing rejects a non-Error', async () => {
      const storage = {
        signReadUrl: vi.fn().mockRejectedValue('supabase exploded'),
      } as unknown as WardrobeStorage
      const { service } = createService({ storage })

      const { data } = await service.getCapsule(actor, 'user-1', CAPSULE_ID)

      expect(data.garments[0]?.imageAccess).toBeNull()
    })
  })

  describe('updateCapsule', () => {
    it('4.3-UNIT-SVC-31 forwards the parsed revision and dispatches one claim', async () => {
      const { service, repo, outbox, ritualService } = createService()

      const result = await service.updateCapsule(
        actor,
        'user-1',
        CAPSULE_ID,
        formatCapsuleETag(CAPSULE_ID, 1),
        { name: 'Renamed' }
      )

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(vi.mocked(repo.updateCapsule).mock.calls[0]?.[2]).toBe(1)
      expect(ritualService.invalidateUserCache).toHaveBeenCalledWith('user-1')
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledWith({
        ownerUserId: 'user-1',
        capsuleId: CAPSULE_ID,
        revision: 1,
        eventName: 'wardrobe_capsule_updated',
      })
    })

    /** A canonical no-op writes no row, so there is no revision to announce. */
    it('4.3-UNIT-SVC-32 dispatches nothing when the update is a canonical no-op', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.updateCapsule).mockResolvedValue({
        capsule: capsuleRow(),
        isNoOp: true,
        changedFields: [],
      } as never)
      const { service, outbox, ritualService } = createService({ repo })

      const result = await service.updateCapsule(actor, 'user-1', CAPSULE_ID, '*', {
        name: 'Work',
      })

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(outbox.dispatchAfterCommit).not.toHaveBeenCalled()
      expect(ritualService.invalidateUserCache).not.toHaveBeenCalled()
    })

    it('4.3-UNIT-SVC-33 records the acting guardian on a non-owner update', async () => {
      const accessService = {
        assertReadAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
        assertWriteAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
      } as unknown as WardrobeAccessService
      const { service, repo } = createService({ accessService })

      await service.updateCapsule(
        { token: 't', userId: 'guardian-9', role: 'guardian' },
        'user-1',
        CAPSULE_ID,
        '*',
        { name: 'Renamed' }
      )

      expect(vi.mocked(repo.updateCapsule).mock.calls[0]?.[4]).toEqual({
        actorUserId: 'guardian-9',
        actorRole: 'guardian',
      })
    })

    it('4.3-UNIT-SVC-34 refuses an update with no precondition', async () => {
      const { service, repo } = createService()

      await expect(
        service.updateCapsule(actor, 'user-1', CAPSULE_ID, undefined, { name: 'X' })
      ).rejects.toThrow(HttpException)
      expect(repo.updateCapsule).not.toHaveBeenCalled()
    })
  })

  describe('setFavoriteStatus', () => {
    it('4.3-UNIT-SVC-35 forwards the requested state and dispatches one claim', async () => {
      const { service, repo, outbox } = createService()

      const result = await service.setFavoriteStatus(
        actor,
        'user-1',
        CAPSULE_ID,
        formatCapsuleETag(CAPSULE_ID, 1),
        { isFavorite: true }
      )

      expect(result.data.id).toBe(CAPSULE_ID)
      expect(vi.mocked(repo.setFavoriteStatus).mock.calls[0]?.[3]).toBe(true)
      expect(outbox.dispatchAfterCommit).toHaveBeenCalledWith({
        ownerUserId: 'user-1',
        capsuleId: CAPSULE_ID,
        revision: 1,
        eventName: 'wardrobe_capsule_favorite_changed',
      })
    })

    /** Favoriting an already-favorite capsule changes nothing to announce. */
    it('4.3-UNIT-SVC-36 dispatches nothing when the favorite state is unchanged', async () => {
      const repo = createMockRepo()
      vi.mocked(repo.setFavoriteStatus).mockResolvedValue({
        capsule: capsuleRow(),
        isNoOp: true,
      } as never)
      const { service, outbox, ritualService } = createService({ repo })

      await service.setFavoriteStatus(actor, 'user-1', CAPSULE_ID, '*', {
        isFavorite: false,
      })

      expect(outbox.dispatchAfterCommit).not.toHaveBeenCalled()
      expect(ritualService.invalidateUserCache).not.toHaveBeenCalled()
    })

    it('4.3-UNIT-SVC-37 records the acting guardian on a non-owner favorite change', async () => {
      const accessService = {
        assertReadAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
        assertWriteAccess: vi.fn().mockResolvedValue({ actorRole: 'guardian' }),
      } as unknown as WardrobeAccessService
      const { service, repo } = createService({ accessService })

      await service.setFavoriteStatus(
        { token: 't', userId: 'guardian-9', role: 'guardian' },
        'user-1',
        CAPSULE_ID,
        '*',
        { isFavorite: true }
      )

      expect(vi.mocked(repo.setFavoriteStatus).mock.calls[0]?.[4]).toEqual({
        actorUserId: 'guardian-9',
        actorRole: 'guardian',
      })
    })
  })
})
