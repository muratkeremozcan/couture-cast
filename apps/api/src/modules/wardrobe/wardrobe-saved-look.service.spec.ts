// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
// Learning path Step 87: Style this piece with my own garments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-87-style-this-piece-with-my-own-garments
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
    worn_on: null,
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
    deleted_at: null,
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
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    garmentItem: {
      findMany: vi.fn(),
    },
  }
  const signReadUrl = vi.fn().mockResolvedValue('https://storage.example.test/signed.png')
  const storage = { signReadUrl } as unknown as WardrobeStorage
  const canTeenAccess = vi.fn().mockResolvedValue(true)
  const canTeenViewPrivateGarmentPhotos = vi.fn().mockResolvedValue(true)
  const guardianConsentStateService = {
    canTeenAccess,
    canTeenViewPrivateGarmentPhotos,
  } as unknown as GuardianConsentStateService
  const service = new WardrobeSavedLookService(
    prisma as unknown as PrismaClient,
    storage,
    guardianConsentStateService
  )
  return {
    prisma,
    storage,
    signReadUrl,
    canTeenAccess,
    canTeenViewPrivateGarmentPhotos,
    service,
  }
}

describe('WardrobeSavedLookService', () => {
  it('[7.14-PIC-005] keeps legacy lists compatible and opts Today into the home filter', async () => {
    const { prisma, service } = createHarness()
    const input = createSavedLookInputSchema.parse({
      source: 'today',
      lookId: 'today:2026-11-20:fixture',
      wornOn: '2026-11-20',
      weather: 'clear',
      composition: [
        { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'sample:g:cotton-tee' },
      ],
    })
    const row = makeSavedLookRow({
      source: 'today',
      look_id: input.lookId,
      worn_on: new Date('2026-11-20T00:00:00.000Z'),
      weather: input.weather,
      anchor_garment_id: null,
      anchor_snapshot: null,
      composition: input.composition.map((slot) => ({ ...slot, label: null })),
      swaps: {},
    })
    prisma.savedLook.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row])
    prisma.savedLook.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const legacy = await service.listSavedLooks(ACTOR, { limit: 50, offset: 0 })
    expect(legacy.data).toEqual([])
    expect(prisma.savedLook.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { user_id: ACTOR.userId, deleted_at: null, source: { not: 'today' } },
      })
    )

    const current = await service.listSavedLooks(ACTOR, {
      source: 'home_sample',
      includeToday: 'true',
      limit: 50,
      offset: 0,
    })
    expect(prisma.savedLook.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          user_id: ACTOR.userId,
          deleted_at: null,
          source: { in: ['home_sample', 'today'] },
        },
      })
    )
    expect(current.data).toMatchObject([
      {
        source: 'home_sample',
        wornOn: '2026-11-20',
        availabilityStatus: 'ready',
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'catalog',
            itemId: 'sample:g:cotton-tee',
          },
        ],
      },
    ])
  })

  it('[7.14-PIC-002/005] a pending teen can wear a catalog Today look and cannot attach a garment', async () => {
    const { prisma, service, canTeenViewPrivateGarmentPhotos, signReadUrl } =
      createHarness()
    const teen: RequestAuthContext = { ...ACTOR, role: 'teen' }
    canTeenViewPrivateGarmentPhotos.mockResolvedValue(false)
    const common = {
      source: 'today',
      lookId: 'today:2026-11-20:fixture',
      wornOn: '2026-11-20',
      weather: 'clear',
    }
    const garmentInput = createSavedLookInputSchema.parse({
      ...common,
      composition: [
        { slotIndex: 0, category: 'top', kind: 'garment', itemId: 'garment-1' },
      ],
    })
    await expect(service.createSavedLook(teen, garmentInput)).rejects.toThrow(
      ForbiddenException
    )
    expect(prisma.garmentItem.findMany).not.toHaveBeenCalled()
    expect(prisma.savedLook.create).not.toHaveBeenCalled()

    const catalogInput = createSavedLookInputSchema.parse({
      ...common,
      composition: [
        { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'sample:g:cotton-tee' },
      ],
    })
    prisma.savedLook.create.mockResolvedValueOnce(
      makeSavedLookRow({
        source: 'today',
        look_id: catalogInput.lookId,
        worn_on: new Date('2026-11-20T00:00:00.000Z'),
        weather: catalogInput.weather,
        anchor_garment_id: null,
        anchor_snapshot: null,
        composition: catalogInput.composition.map((slot) => ({ ...slot, label: null })),
        swaps: {},
      })
    )
    const created = await service.createSavedLook(teen, catalogInput)
    expect(prisma.savedLook.create.mock.calls).toMatchObject([
      [
        {
          data: {
            user_id: teen.userId,
            source: 'today',
            worn_on: new Date('2026-11-20T00:00:00.000Z'),
          },
        },
      ],
    ])
    expect(created.data).toMatchObject({ source: 'home_sample', wornOn: '2026-11-20' })
    expect(signReadUrl).not.toHaveBeenCalled()
  })

  it('formats and parses strong ETags and If-Match headers including multi-tag lists', () => {
    expect(formatSavedLookETag('sl-1', 2)).toBe('"saved-look:sl-1:2"')
    expect(parseSavedLookIfMatchHeader('*', 'sl-1')).toBeNull()
    expect(parseSavedLookIfMatchHeader('"saved-look:sl-1:3"', 'sl-1')).toEqual([3])
    expect(
      parseSavedLookIfMatchHeader(
        'W/"saved-look:sl-1:2", "saved-look:sl-1:3", "saved-look:sl-1:4"',
        'sl-1'
      )
    ).toEqual([3, 4])

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

  it.each([
    { reason: 'outside the member’s ready closet', companion: null },
    {
      reason: 'retagged for a different slot',
      companion: { category: 'shoes', comfort_range: 'mild' },
    },
    {
      reason: 'incompatible with the selected weather',
      companion: { category: 'bottom', comfort_range: 'cold' },
    },
    {
      reason: 'missing its comfort tag',
      companion: { category: 'bottom', comfort_range: null },
    },
  ])('[7.30-ACCOUNT] rejects a companion $reason', async ({ companion }) => {
    const { prisma, service, signReadUrl } = createHarness()
    const base = makeStylePieceInput()
    const companionId = 'unavailable-companion'
    const input = createSavedLookInputSchema.parse({
      ...base,
      composition: base.composition.map((slot) =>
        slot.category === 'bottom'
          ? { ...slot, kind: 'garment', itemId: companionId }
          : slot
      ),
    })
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      { id: base.anchorGarmentId, category: 'top', comfort_range: 'mild' },
      ...(companion ? [{ id: companionId, ...companion }] : []),
    ])

    await expect(service.createSavedLook(ACTOR, input)).rejects.toThrow(NotFoundException)

    expect(prisma.garmentItem.findMany.mock.calls).toMatchObject([
      [
        {
          where: {
            user_id: ACTOR.userId,
            id: { in: [base.anchorGarmentId, companionId] },
            upload_status: 'ready',
            retention_status: 'active',
            deletion_requested_at: null,
          },
          select: { id: true },
        },
      ],
    ])
    expect(prisma.savedLook.create).not.toHaveBeenCalled()
    expect(signReadUrl).not.toHaveBeenCalled()
  })

  it('[7.30-ACCOUNT] rejects use of the anchor in a companion slot', async () => {
    const { prisma, service } = createHarness()
    const base = makeStylePieceInput()
    const input = createSavedLookInputSchema.parse({
      ...base,
      composition: base.composition.map((slot) =>
        slot.slotIndex === 1
          ? { ...slot, kind: 'garment', itemId: base.anchorGarmentId }
          : slot
      ),
    })
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      { id: base.anchorGarmentId, category: 'top', comfort_range: 'mild' },
    ])

    await expect(service.createSavedLook(ACTOR, input)).rejects.toThrow(NotFoundException)
    expect(prisma.savedLook.create).not.toHaveBeenCalled()
  })

  it('[7.30-ACCOUNT] verifies the weather tags of an owned non-anchor in slot zero', async () => {
    const { prisma, service } = createHarness()
    const base = makeStylePieceInput()
    const nonAnchor = 'cold-weather-top'
    const input = createSavedLookInputSchema.parse({
      ...base,
      composition: base.composition.map((slot) =>
        slot.slotIndex === 0 ? { ...slot, itemId: nonAnchor } : slot
      ),
    })
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      { id: base.anchorGarmentId, category: 'top', comfort_range: 'mild' },
      { id: nonAnchor, category: 'top', comfort_range: 'cold' },
    ])

    await expect(service.createSavedLook(ACTOR, input)).rejects.toThrow(NotFoundException)
    expect(prisma.savedLook.create).not.toHaveBeenCalled()
  })

  it.each([
    { weather: 'warm-rainy', comfort: 'warm' },
    { weather: 'cool-windy', comfort: 'cold' },
  ])(
    '[7.30-WEATHER] refuses an unverified owned rain or wind layer for $weather',
    async ({ weather, comfort }) => {
      const { prisma, service } = createHarness()
      const input = createSavedLookInputSchema.parse({
        ...makeStylePieceInput(),
        weather,
        composition: [
          ...makeStylePieceInput().composition,
          {
            slotIndex: 3,
            category: 'outerwear',
            kind: 'garment',
            itemId: 'unverified-layer',
          },
        ],
      })
      prisma.garmentItem.findMany.mockResolvedValueOnce([
        { id: input.anchorGarmentId, category: 'top', comfort_range: 'mild' },
        { id: 'unverified-layer', category: 'outerwear', comfort_range: comfort },
      ])

      await expect(service.createSavedLook(ACTOR, input)).rejects.toThrow(
        NotFoundException
      )
      expect(prisma.savedLook.create).not.toHaveBeenCalled()
    }
  )

  it('[7.30-ACCOUNT] creates a mixed look and distinguishes tag changes from deleted companions on read', async () => {
    const { prisma, service, signReadUrl } = createHarness()
    const anchor = {
      id: 'garment-1',
      user_id: ACTOR.userId,
      category: 'top',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      deletion_requested_at: null,
      object_path: 'wardrobe/user-1/garment-1.png',
    }
    const companion = {
      ...anchor,
      id: 'owned-bottom',
      category: 'bottom',
      object_path: 'wardrobe/user-1/owned-bottom.png',
    }
    const row = makeSavedLookRow({
      look_id: 'sample:l:office-oxford',
      weather: 'mild-dry',
      composition: [
        { slotIndex: 0, category: 'top', kind: 'garment', itemId: anchor.id },
        { slotIndex: 1, category: 'bottom', kind: 'garment', itemId: companion.id },
        { slotIndex: 2, category: 'shoes', kind: 'catalog', itemId: 'sample:g:loafers' },
      ],
      swaps: {},
    })
    const input = createSavedLookInputSchema.parse({
      ...makeStylePieceInput(),
      lookId: row.look_id,
      weather: row.weather,
      composition: row.composition,
      swaps: {},
    })
    prisma.savedLook.create.mockResolvedValueOnce(row)
    prisma.savedLook.findFirst.mockResolvedValue(row)
    prisma.garmentItem.findMany
      .mockResolvedValueOnce([anchor, companion])
      .mockResolvedValueOnce([anchor, companion])
      .mockResolvedValueOnce([
        anchor,
        { ...companion, category: 'accessory', object_path: null },
      ])
      .mockResolvedValueOnce([
        anchor,
        { ...companion, deletion_requested_at: new Date(0) },
      ])

    const created = await service.createSavedLook(ACTOR, input)
    expect(created.data.availabilityStatus).toBe('ready')
    expect(created.data.composition[1]).toMatchObject({
      itemId: companion.id,
      kind: 'garment',
      missing: false,
    })
    expect(created.data.composition[1]?.imageAccess?.url).toBe(
      'https://storage.example.test/signed.png'
    )
    expect(signReadUrl).toHaveBeenCalledWith(companion.object_path, 900)

    const retagged = await service.getSavedLook(ACTOR, row.id)
    expect(retagged.data.availabilityStatus).toBe('needs_review')
    expect(retagged.data.composition[1]).toMatchObject({
      itemId: companion.id,
      missing: false,
      imageAccess: null,
    })

    signReadUrl.mockClear()
    const deleted = await service.getSavedLook(ACTOR, row.id)
    expect(deleted.data.availabilityStatus).toBe('missing_garment')
    expect(deleted.data.missingGarmentIds).toEqual([companion.id])
    expect(deleted.data.composition[1]).toMatchObject({
      itemId: companion.id,
      missing: true,
      imageAccess: null,
    })
    expect(signReadUrl).not.toHaveBeenCalledWith(companion.object_path, 900)
  })

  it('[7.30-ACCOUNT] preserves a legacy saved look with its anchor in a later slot', async () => {
    const { prisma, service } = createHarness()
    const row = makeSavedLookRow({
      look_id: 'legacy-capsule',
      weather: 'mild',
      composition: [
        { slotIndex: 0, category: 'bottom', kind: 'garment', itemId: 'legacy-bottom' },
        { slotIndex: 1, category: 'top', kind: 'garment', itemId: 'garment-1' },
      ],
    })
    const garment = {
      id: 'garment-1',
      user_id: ACTOR.userId,
      category: 'top',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      deletion_requested_at: null,
      object_path: null,
    }
    prisma.savedLook.findFirst.mockResolvedValueOnce(row)
    prisma.garmentItem.findMany.mockResolvedValueOnce([
      garment,
      { ...garment, id: 'legacy-bottom', category: 'bottom' },
    ])

    const saved = await service.getSavedLook(ACTOR, row.id)

    expect(saved.data.availabilityStatus).toBe('ready')
    expect(saved.data.composition.map(({ itemId }) => itemId)).toEqual([
      'legacy-bottom',
      'garment-1',
    ])
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

  it('enforces ownership, multi-tag If-Match soft-delete, delayed-replay tombstone, and exact Undo restore', async () => {
    const { prisma, service } = createHarness()
    prisma.savedLook.findFirst.mockResolvedValueOnce(null)
    await expect(service.getSavedLook(ACTOR, 'missing-id')).rejects.toThrow(
      NotFoundException
    )

    prisma.savedLook.findFirst.mockResolvedValueOnce({ id: 'sl-1', revision: 2 })
    await expect(
      service.deleteSavedLook(ACTOR, 'sl-1', '"saved-look:sl-1:1"')
    ).rejects.toThrow(PreconditionFailedException)

    // Multi-tag If-Match succeeds when ANY strong candidate matches current revision.
    prisma.savedLook.findFirst.mockResolvedValueOnce({ id: 'sl-1', revision: 2 })
    prisma.savedLook.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      service.deleteSavedLook(ACTOR, 'sl-1', '"saved-look:sl-1:0", "saved-look:sl-1:2"')
    ).resolves.toBeUndefined()

    // Delayed create replay after removal returns 409 SAVED_LOOK_ALREADY_REMOVED (never resurrects).
    const input = makeHomeSampleInput()
    prisma.savedLook.findUnique.mockResolvedValueOnce(
      makeSavedLookRow({
        source: 'home_sample',
        look_id: input.lookId,
        weather: input.weather,
        anchor_garment_id: null,
        anchor_snapshot: null,
        composition: input.composition,
        swaps: {},
        collection: 'all',
        comfort: input.comfort,
        idempotency_payload_hash: computeSavedLookPayloadHash(input),
        deleted_at: new Date('2026-11-22T02:00:00.000Z'),
      })
    )
    await expect(
      service.createSavedLook(ACTOR, input, '11111111-1111-4111-8111-111111111111')
    ).rejects.toThrow(ConflictException)

    // Restore brings back the deleted row with its original anchor snapshot and missing/needs_review state intact.
    const deletedMissing = makeSavedLookRow({
      id: 'sl-restore',
      anchor_garment_id: 'g-gone',
      revision: 1,
      deleted_at: new Date('2026-11-22T02:00:00.000Z'),
    })
    const activeRestored = { ...deletedMissing, deleted_at: null, revision: 2 }
    prisma.savedLook.findFirst
      .mockResolvedValueOnce(deletedMissing)
      .mockResolvedValueOnce(activeRestored)
    prisma.savedLook.updateMany.mockResolvedValueOnce({ count: 1 })
    prisma.garmentItem.findMany.mockResolvedValueOnce([])

    const restored = await service.restoreSavedLook(ACTOR, 'sl-restore')
    expect(restored.data.id).toBe('sl-restore')
    expect(restored.data.revision).toBe(2)
    expect(restored.data.availabilityStatus).toBe('missing_garment')
    expect(restored.data.anchorSnapshot?.category).toBe('top')

    // Calling restore again when already active is idempotent.
    prisma.savedLook.findFirst.mockResolvedValueOnce(activeRestored)
    prisma.garmentItem.findMany.mockResolvedValueOnce([])
    const restoredAgain = await service.restoreSavedLook(ACTOR, 'sl-restore')
    expect(restoredAgain.data.id).toBe('sl-restore')
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

  it('imports unresolved legacy style_piece and home_sample looks directly into needs_review', async () => {
    const { prisma, service } = createHarness()

    // 1. Legacy style_piece look imported after the owned garment changed from top/mild to outerwear/cold
    const legacyStyleInput = {
      source: 'style_piece' as const,
      lookId: 'sample:l:silk-midi',
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
          category: 'outerwear' as const,
          kind: 'garment' as const,
          itemId: 'garment-1',
        },
        {
          slotIndex: 1,
          category: 'bottom' as const,
          kind: 'catalog' as const,
          itemId: 'sample:g:midi-skirt',
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

    prisma.savedLook.findUnique.mockResolvedValueOnce(null)
    prisma.garmentItem.findMany
      .mockResolvedValueOnce([
        { id: 'garment-1', category: 'outerwear', comfort_range: 'cold' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'garment-1',
          user_id: 'user-1',
          category: 'outerwear',
          comfort_range: 'cold',
          upload_status: 'ready',
          retention_status: 'active',
          object_path: 'wardrobe/user-1/garment-1.png',
        },
      ])
    prisma.savedLook.create.mockImplementationOnce(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(
          makeSavedLookRow({
            id: 'sl-legacy-style',
            look_id: String(data.look_id),
            weather: String(data.weather),
            anchor_garment_id: 'garment-1',
            anchor_snapshot: data.anchor_snapshot as SavedLook['anchor_snapshot'],
            composition: data.composition as SavedLook['composition'],
            swaps: data.swaps as SavedLook['swaps'],
          })
        )
    )

    const importedStyle = await service.createSavedLook(
      ACTOR,
      legacyStyleInput,
      '22222222-2222-4222-8222-222222222222'
    )
    expect(importedStyle.data.availabilityStatus).toBe('needs_review')
    // Server pins authoritative anchorSnapshot from Postgres rather than trusting client-supplied snapshot
    expect(importedStyle.data.anchorSnapshot).toEqual({
      garmentId: 'garment-1',
      category: 'outerwear',
      comfortRange: 'cold',
    })

    // Retrying a soft-deleted legacy import key returns 409 SAVED_LOOK_ALREADY_REMOVED even if payload changed after retag
    prisma.savedLook.findUnique.mockResolvedValueOnce(
      makeSavedLookRow({
        id: 'sl-legacy-style',
        deleted_at: new Date('2026-11-22T02:00:00.000Z'),
        idempotency_key: '22222222-2222-4222-8222-222222222222',
        idempotency_payload_hash: 'stale-hash-before-retag',
      })
    )
    await expect(
      service.createSavedLook(
        ACTOR,
        legacyStyleInput,
        '22222222-2222-4222-8222-222222222222'
      )
    ).rejects.toThrow('SAVED_LOOK_ALREADY_REMOVED')

    // 2. Legacy home_sample bookmark whose catalog look no longer resolves for the saved weather
    const legacyHomeInput = {
      source: 'home_sample' as const,
      lookId: 'sample:l:summer-linen',
      weather: 'cool-windy',
      composition: [
        {
          slotIndex: 0,
          category: 'top' as const,
          kind: 'catalog' as const,
          itemId: 'sample:g:cotton-tee',
        },
        {
          slotIndex: 1,
          category: 'bottom' as const,
          kind: 'catalog' as const,
          itemId: 'sample:g:linen-trousers',
        },
        {
          slotIndex: 2,
          category: 'shoes' as const,
          kind: 'catalog' as const,
          itemId: 'sample:g:sandals',
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

    prisma.savedLook.findUnique.mockResolvedValueOnce(null)
    prisma.savedLook.create.mockResolvedValueOnce(
      makeSavedLookRow({
        id: 'sl-legacy-home',
        source: 'home_sample',
        look_id: legacyHomeInput.lookId,
        weather: legacyHomeInput.weather,
        anchor_garment_id: null,
        anchor_snapshot: null,
        composition: legacyHomeInput.composition.map((s) => ({ ...s, label: null })),
        swaps: {},
        collection: 'all',
        comfort: legacyHomeInput.comfort,
      })
    )

    const importedHome = await service.createSavedLook(
      ACTOR,
      legacyHomeInput,
      '33333333-3333-4333-8333-333333333333'
    )
    expect(importedHome.data.availabilityStatus).toBe('needs_review')
  })
})
