// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import type { PrismaClient, SavedLook } from '@prisma/client'
import { createSavedLookInputSchema } from '@couture/api-client/contracts/http'
import { describe, expect, it, vi } from 'vitest'
import type { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import type { WardrobeStorage } from './wardrobe-storage.adapter.js'
import {
  computeSavedLookPayloadHash,
  formatSavedLookETag,
  parseSavedLookIfMatchHeader,
  WardrobeSavedLookService,
} from './wardrobe-saved-look.service.js'

const ACTOR: RequestAuthContext = {
  userId: 'user-1',
  role: 'guardian',
  token: 'tok-1',
}

function makeSavedLookRow(overrides: Partial<SavedLook> = {}): SavedLook {
  const now = new Date('2026-11-22T01:00:00.000Z')
  return {
    id: 'sl-1',
    user_id: 'user-1',
    source: 'style_piece',
    look_id: 'look-01',
    weather: 'warm-rainy',
    title: null,
    anchor_garment_id: 'garment-1',
    anchor_snapshot: {
      garmentId: 'garment-1',
      category: 'top',
      comfortRange: 'mild',
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: 'garment-1',
        label: null,
      },
      {
        slotIndex: 1,
        category: 'bottom',
        kind: 'catalog',
        itemId: 'sample:g:bottom-1',
        label: null,
      },
      {
        slotIndex: 2,
        category: 'shoes',
        kind: 'catalog',
        itemId: 'sample:g:loafers',
        label: null,
      },
    ],
    swaps: { shoes: 'sample:g:loafers' },
    collection: null,
    comfort: null,
    revision: 0,
    idempotency_key: '11111111-1111-4111-8111-111111111111',
    idempotency_payload_hash: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeStylePieceInput() {
  return {
    source: 'style_piece' as const,
    lookId: 'look-01',
    weather: 'warm-rainy',
    anchorGarmentId: 'garment-1',
    anchorSnapshot: {
      garmentId: 'garment-1',
      category: 'top' as const,
      comfortRange: 'mild' as const,
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top' as const,
        kind: 'garment' as const,
        itemId: 'garment-1',
      },
      {
        slotIndex: 1,
        category: 'bottom' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:bottom-1',
      },
      {
        slotIndex: 2,
        category: 'shoes' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:loafers',
      },
    ],
    swaps: { shoes: 'sample:g:loafers' },
  }
}

function makeHomeSampleInput() {
  return {
    source: 'home_sample' as const,
    lookId: 'look-02',
    weather: 'mild-dry',
    composition: [
      {
        slotIndex: 0,
        category: 'top' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:top-1',
      },
      {
        slotIndex: 1,
        category: 'bottom' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:bottom-1',
      },
      {
        slotIndex: 2,
        category: 'shoes' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:shoes-1',
      },
    ],
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral' as const,
      windTolerance: 'medium' as const,
      precipPreparedness: 'medium' as const,
    },
  }
}

function createHarness() {
  const prisma = {
    savedLook: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    garmentItem: {
      findMany: vi.fn(),
    },
  }
  const signReadUrl = vi.fn().mockResolvedValue('https://storage.example.test/signed.png')
  const storage = { signReadUrl } as unknown as WardrobeStorage
  const canTeenAccess = vi.fn().mockResolvedValue(true)
  const guardianConsentStateService = {
    canTeenAccess,
  } as unknown as GuardianConsentStateService
  const service = new WardrobeSavedLookService(
    prisma as unknown as PrismaClient,
    storage,
    guardianConsentStateService
  )
  return { prisma, storage, signReadUrl, canTeenAccess, service }
}

describe('WardrobeSavedLookService', () => {
  it('formats and parses strong ETags and If-Match headers', () => {
    expect(formatSavedLookETag('sl-1', 2)).toBe('"saved-look:sl-1:2"')
    expect(parseSavedLookIfMatchHeader('*', 'sl-1')).toBeNull()
    expect(parseSavedLookIfMatchHeader('"saved-look:sl-1:3"', 'sl-1')).toBe(3)
    expect(
      parseSavedLookIfMatchHeader('W/"saved-look:sl-1:3", "saved-look:sl-1:4"', 'sl-1')
    ).toBe(4)

    expect(() => parseSavedLookIfMatchHeader(undefined, 'sl-1')).toThrow(HttpException)
    try {
      parseSavedLookIfMatchHeader('   ', 'sl-1')
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(HttpStatus.PRECONDITION_REQUIRED)
    }

    expect(() => parseSavedLookIfMatchHeader('W/"saved-look:sl-1:0"', 'sl-1')).toThrow(
      PreconditionFailedException
    )
    expect(() => parseSavedLookIfMatchHeader('"saved-look:other:0"', 'sl-1')).toThrow(
      PreconditionFailedException
    )
    expect(() => parseSavedLookIfMatchHeader('"capsule:sl-1:0"', 'sl-1')).toThrow(
      PreconditionFailedException
    )
  })

  it('produces identical payload hashes regardless of swap key or slot ordering', () => {
    const first = makeStylePieceInput()
    const reordered = {
      ...first,
      composition: [...first.composition].reverse(),
      swaps: { shoes: 'sample:g:loafers' },
    }
    expect(computeSavedLookPayloadHash(first)).toBe(
      computeSavedLookPayloadHash(reordered)
    )
  })

  it('creates a style_piece saved look with authoritative snapshot and signed photo', async () => {
    const { prisma, signReadUrl, service } = createHarness()
    const input = makeStylePieceInput()
    const row = makeSavedLookRow({
      idempotency_payload_hash: computeSavedLookPayloadHash(input),
    })

    prisma.savedLook.findUnique.mockResolvedValue(null)
    prisma.garmentItem.findMany
      .mockResolvedValueOnce([
        { id: 'garment-1', category: 'top', comfort_range: 'mild' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'garment-1',
          user_id: 'user-1',
          category: 'top',
          comfort_range: 'mild',
          upload_status: 'ready',
          retention_status: 'active',
          object_path: 'wardrobe/user-1/garment-1.png',
        },
      ])
    prisma.savedLook.create.mockResolvedValue(row)

    const result = await service.createSavedLook(
      ACTOR,
      input,
      '11111111-1111-4111-8111-111111111111'
    )

    expect(result.isReplay).toBe(false)
    expect(result.data.availabilityStatus).toBe('ready')
    expect(result.data.composition[0]?.imageAccess?.url).toBe(
      'https://storage.example.test/signed.png'
    )
    expect(signReadUrl).toHaveBeenCalledWith('wardrobe/user-1/garment-1.png', 900)
  })

  it('replays idempotently with matching payload hash and rejects mismatched payload with 409', async () => {
    const { prisma, service } = createHarness()
    const input = makeHomeSampleInput()
    const hash = computeSavedLookPayloadHash(input)
    const row = makeSavedLookRow({
      source: 'home_sample',
      look_id: 'look-02',
      weather: 'mild-dry',
      anchor_garment_id: null,
      anchor_snapshot: null,
      composition: input.composition,
      swaps: {},
      collection: 'all',
      comfort: input.comfort,
      idempotency_payload_hash: hash,
    })

    prisma.savedLook.findUnique.mockResolvedValueOnce(row)
    const replayed = await service.createSavedLook(
      ACTOR,
      input,
      '11111111-1111-4111-8111-111111111111'
    )
    expect(replayed.isReplay).toBe(true)
    expect(prisma.savedLook.create).not.toHaveBeenCalled()

    prisma.savedLook.findUnique.mockResolvedValueOnce(row)
    await expect(
      service.createSavedLook(
        ACTOR,
        { ...input, weather: 'cool-windy' },
        '11111111-1111-4111-8111-111111111111'
      )
    ).rejects.toThrow(ConflictException)
  })

  it('recovers from concurrent P2002 idempotency race by re-reading existing row', async () => {
    const { prisma, service } = createHarness()
    const input = makeHomeSampleInput()
    const row = makeSavedLookRow({
      source: 'home_sample',
      look_id: 'look-02',
      weather: 'mild-dry',
      anchor_garment_id: null,
      anchor_snapshot: null,
      composition: input.composition,
      swaps: {},
      collection: 'all',
      comfort: input.comfort,
      idempotency_payload_hash: computeSavedLookPayloadHash(input),
    })

    prisma.savedLook.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    prisma.savedLook.create.mockRejectedValueOnce({ code: 'P2002' })

    const result = await service.createSavedLook(
      ACTOR,
      input,
      '11111111-1111-4111-8111-111111111111'
    )
    expect(result.isReplay).toBe(true)
    expect(result.data.id).toBe('sl-1')
  })

  it('rejects cross-account or non-ready garment references with 404 GARMENT_NOT_FOUND', async () => {
    const { prisma, service } = createHarness()
    prisma.savedLook.findUnique.mockResolvedValue(null)
    prisma.garmentItem.findMany.mockResolvedValueOnce([])

    await expect(service.createSavedLook(ACTOR, makeStylePieceInput())).rejects.toThrow(
      NotFoundException
    )
    expect(prisma.savedLook.create).not.toHaveBeenCalled()
  })

  it('derives missing_garment, needs_review, and photo-unavailable states cleanly without failing reads', async () => {
    const { prisma, signReadUrl, service } = createHarness()
    const missingRow = makeSavedLookRow({ id: 'sl-missing', anchor_garment_id: 'g-gone' })
    const reviewRow = makeSavedLookRow({
      id: 'sl-review',
      anchor_garment_id: 'g-changed',
      anchor_snapshot: { garmentId: 'g-changed', category: 'top', comfortRange: 'mild' },
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: 'g-changed',
          label: null,
        },
        {
          slotIndex: 1,
          category: 'shoes',
          kind: 'catalog',
          itemId: 'sample:g:loafers',
          label: null,
        },
      ],
    })

    prisma.savedLook.findMany.mockResolvedValueOnce([missingRow, reviewRow])
    prisma.savedLook.count.mockResolvedValueOnce(2)
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      {
        id: 'g-changed',
        user_id: 'user-1',
        category: 'outerwear',
        comfort_range: 'cold',
        upload_status: 'ready',
        retention_status: 'active',
        object_path: 'wardrobe/user-1/g-changed.png',
      },
    ])
    signReadUrl.mockRejectedValueOnce(new Error('storage offline'))

    const result = await service.listSavedLooks(ACTOR, { limit: 50, offset: 0 })
    expect(result.total).toBe(2)

    const missingLook = result.data.find((item) => item.id === 'sl-missing')!
    expect(missingLook.availabilityStatus).toBe('missing_garment')
    expect(missingLook.missingGarmentIds).toContain('g-gone')
    expect(missingLook.composition[0]?.missing).toBe(true)

    const reviewLook = result.data.find((item) => item.id === 'sl-review')!
    expect(reviewLook.availabilityStatus).toBe('needs_review')
    expect(reviewLook.needsReviewReasons).toEqual([
      'category_changed',
      'comfort_range_changed',
    ])
    expect(reviewLook.composition[0]?.imageAccess).toBeNull()
  })

  it('enforces ownership and If-Match revision checks on get and delete', async () => {
    const { prisma, service } = createHarness()
    prisma.savedLook.findFirst.mockResolvedValueOnce(null)
    await expect(service.getSavedLook(ACTOR, 'missing-id')).rejects.toThrow(
      NotFoundException
    )

    prisma.savedLook.findFirst.mockResolvedValueOnce({ id: 'sl-1', revision: 2 })
    await expect(
      service.deleteSavedLook(ACTOR, 'sl-1', '"saved-look:sl-1:1"')
    ).rejects.toThrow(PreconditionFailedException)

    prisma.savedLook.findFirst.mockResolvedValueOnce({ id: 'sl-1', revision: 2 })
    prisma.savedLook.deleteMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      service.deleteSavedLook(ACTOR, 'sl-1', '"saved-look:sl-1:2"')
    ).resolves.toBeUndefined()
  })

  it('blocks guardian-pending teens from photo URL signing and style_piece creation while allowing home_sample', async () => {
    const { prisma, signReadUrl, canTeenAccess, service } = createHarness()
    const pendingTeen: RequestAuthContext = {
      userId: 'teen-pending',
      role: 'teen',
      token: 'tok-teen',
    }
    canTeenAccess.mockResolvedValue(false)

    await expect(
      service.createSavedLook(pendingTeen, makeStylePieceInput())
    ).rejects.toThrow(ForbiddenException)

    prisma.savedLook.findMany.mockResolvedValueOnce([
      makeSavedLookRow({ user_id: 'teen-pending' }),
    ])
    prisma.savedLook.count.mockResolvedValueOnce(1)
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      {
        id: 'garment-1',
        user_id: 'teen-pending',
        category: 'top',
        comfort_range: 'mild',
        upload_status: 'ready',
        retention_status: 'active',
        object_path: 'wardrobe/teen-pending/garment-1.png',
      },
    ])

    const listed = await service.listSavedLooks(pendingTeen, { limit: 50, offset: 0 })
    expect(listed.data[0]?.composition[0]?.imageAccess).toBeNull()
    expect(signReadUrl).not.toHaveBeenCalled()

    const emojiTitle = '🧥'.repeat(45)
    const parsedInput = createSavedLookInputSchema.parse({
      ...makeHomeSampleInput(),
      title: emojiTitle,
    })
    prisma.savedLook.create.mockResolvedValueOnce(
      makeSavedLookRow({
        id: 'sl-home-teen',
        user_id: 'teen-pending',
        source: 'home_sample',
        look_id: 'look-02',
        weather: 'mild-dry',
        title: emojiTitle,
        anchor_garment_id: null,
        anchor_snapshot: null,
        composition: parsedInput.composition.map((slot) => ({ ...slot, label: null })),
        swaps: {},
        collection: 'all',
        comfort: parsedInput.comfort ?? null,
      })
    )

    const created = await service.createSavedLook(pendingTeen, parsedInput)
    expect(created.data.title).toBe(emojiTitle)
    expect(created.data.source).toBe('home_sample')
  })
})
