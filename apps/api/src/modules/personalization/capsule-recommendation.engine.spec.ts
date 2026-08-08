import { describe, expect, it } from 'vitest'
import type { GarmentItem } from '@prisma/client'
import {
  evaluateCapsuleForScenario,
  type CapsuleWithJoins,
} from './capsule-recommendation.engine.js'

describe('capsule-recommendation.engine', () => {
  const createGarment = (
    id: string,
    category: string,
    comfortRange = 'mild'
  ): GarmentItem =>
    ({
      id,
      user_id: 'user-1',
      status: 'ready',
      upload_status: 'ready',
      category,
      material: 'cotton',
      comfort_range: comfortRange,
      tags_confirmed_at: new Date(),
      file_size_bytes: 100,
      mime_type: 'image/png',
      retention_status: 'active',
      retention_trigger: null,
      deletion_requested_at: null,
      created_at: new Date(),
      committed_at: new Date(),
      updated_at: new Date(),
      object_path: 'path',
      image_url: 'url',
      color_palette: null,
      width_px: 100,
      height_px: 100,
      sha256_checksum: 'abc',
      tagging_failure_code: null,
      tagging_model_version: 'v1',
      tag_suggested_at: null,
      tagging_telemetry_emitted_at: null,
      tag_suggestions: null,
    }) as unknown as GarmentItem

  const createCapsule = (
    id: string,
    name: string,
    occasions: string[],
    garments: GarmentItem[],
    isFavorite = false
  ): CapsuleWithJoins =>
    ({
      id,
      user_id: 'user-1',
      name,
      description: 'desc',
      occasions,
      is_favorite: isFavorite,
      revision: 1,
      idempotency_key: null,
      idempotency_payload_hash: null,
      created_at: new Date('2026-08-05T10:00:00Z'),
      updated_at: new Date('2026-08-05T10:00:00Z'),
      garment_joins: garments.map((g, idx) => ({
        id: `join-${id}-${idx}`,
        user_id: 'user-1',
        capsule_id: id,
        garment_id: g.id,
        garment_order: idx,
        created_at: new Date(),
        garment: g,
      })),
    }) as unknown as CapsuleWithJoins

  it('4.3-UNIT-ENGINE-01 returns null if no capsules are available', () => {
    const result = evaluateCapsuleForScenario({
      capsules: [],
      userGarments: [],
      adjustedFeelsLike: 20,
    })
    expect(result).toBeNull()
  })

  it('4.3-UNIT-ENGINE-02 filters out capsules with inactive garments', () => {
    const inactiveGarment = createGarment('g-1', 'top')
    inactiveGarment.retention_status =
      'deletion_pending' as unknown as GarmentItem['retention_status']
    const activeGarment = createGarment('g-2', 'bottom')

    const capsule = createCapsule(
      'cap-1',
      'Capsule 1',
      ['casual'],
      [inactiveGarment, activeGarment]
    )

    const result = evaluateCapsuleForScenario({
      capsules: [capsule],
      userGarments: [inactiveGarment, activeGarment],
      adjustedFeelsLike: 20,
    })

    expect(result).toBeNull()
  })

  it('4.3-UNIT-ENGINE-03 filters by requested occasion', () => {
    const g1 = createGarment('g-1', 'top')
    const g2 = createGarment('g-2', 'bottom')
    const shoes = createGarment('g-shoes', 'shoes')
    const capsuleWork = createCapsule('cap-work', 'Work Caps', ['work'], [g1, g2])

    const resultCasual = evaluateCapsuleForScenario({
      capsules: [capsuleWork],
      userGarments: [g1, g2, shoes],
      adjustedFeelsLike: 20,
      requestedOccasion: 'casual',
    })
    expect(resultCasual).toBeNull()

    const resultWork = evaluateCapsuleForScenario({
      capsules: [capsuleWork],
      userGarments: [g1, g2, shoes],
      adjustedFeelsLike: 20,
      requestedOccasion: 'work',
    })
    expect(resultWork).not.toBeNull()
    expect(resultWork?.capsule.id).toBe('cap-work')
  })

  it('4.3-UNIT-ENGINE-04 evaluates completeness and auto-fills missing categories below 15C', () => {
    const top = createGarment('g-top', 'top', 'cool')
    const bottom = createGarment('g-bot', 'bottom', 'cool')
    const shoes = createGarment('g-shoes', 'shoes', 'cool')
    const outerwear = createGarment('g-coat', 'outerwear', 'cool')

    const partialCapsule = createCapsule(
      'cap-partial',
      'Partial',
      ['casual'],
      [top, bottom]
    )

    const result = evaluateCapsuleForScenario({
      capsules: [partialCapsule],
      userGarments: [top, bottom, shoes, outerwear],
      adjustedFeelsLike: 12,
    })

    expect(result).not.toBeNull()
    expect(result?.completeness).toBe('partial')
    // Canonical slot order is dress, top, bottom, shoes, outerwear.
    expect(result?.autoFilledGarmentIds).toEqual(['g-shoes', 'g-coat'])
  })

  it('4.3-UNIT-ENGINE-05 breaks a genuine score tie by updated_at then id, not by favorite', () => {
    const top = createGarment('g-top', 'top')
    const bottom = createGarment('g-bot', 'bottom')
    const shoes = createGarment('g-shoes', 'shoes')

    // Identical contents and identical favorite state produce identical scores.
    const older = createCapsule('cap-b', 'Older', ['casual'], [top, bottom], false)
    older.updated_at = new Date('2026-08-01T00:00:00Z')
    const newer = createCapsule('cap-a', 'Newer', ['casual'], [top, bottom], false)
    newer.updated_at = new Date('2026-08-05T00:00:00Z')

    const result = evaluateCapsuleForScenario({
      capsules: [older, newer],
      userGarments: [top, bottom, shoes],
      adjustedFeelsLike: 20,
    })

    expect(result?.capsule.id).toBe('cap-a')
  })

  /** The favorite bonus is additive to the score; it is not a separate tie-break. */
  it('4.3-UNIT-ENGINE-06 applies the favorite bonus through the score', () => {
    const top = createGarment('g-top', 'top')
    const bottom = createGarment('g-bot', 'bottom')
    const shoes = createGarment('g-shoes', 'shoes')

    const plain = createCapsule('cap-1', 'Plain', ['casual'], [top, bottom], false)
    const favorite = createCapsule('cap-2', 'Favorite', ['casual'], [top, bottom], true)

    const result = evaluateCapsuleForScenario({
      capsules: [plain, favorite],
      userGarments: [top, bottom, shoes],
      adjustedFeelsLike: 20,
    })

    expect(result?.capsule.id).toBe('cap-2')
  })

  /** A dress capsule stays a dress capsule in the cold; outerwear is added. */
  it('4.3-UNIT-ENGINE-07 keeps the dress slot rule below 15C and adds outerwear', () => {
    const dress = createGarment('g-dress', 'dress')
    const shoes = createGarment('g-shoes', 'shoes')
    const coat = createGarment('g-coat', 'outerwear')

    const capsule = createCapsule(
      'cap-1',
      'Dress',
      ['evening'],
      [dress, shoes, coat],
      false
    )

    const result = evaluateCapsuleForScenario({
      capsules: [capsule],
      userGarments: [dress, shoes, coat],
      adjustedFeelsLike: 12,
    })

    expect(result?.completeness).toBe('complete')
    expect(result?.autoFilledGarmentIds).toEqual([])
  })

  /** A non-finite temperature must fall back, not score everything as `hot`. */
  it('4.3-UNIT-ENGINE-08 returns null for a non-finite adjusted temperature', () => {
    const top = createGarment('g-top', 'top')
    const bottom = createGarment('g-bot', 'bottom')
    const capsule = createCapsule('cap-1', 'Any', ['casual'], [top, bottom], false)

    expect(
      evaluateCapsuleForScenario({
        capsules: [capsule],
        userGarments: [top, bottom],
        adjustedFeelsLike: Number.NaN,
      })
    ).toBeNull()
  })

  /** Retention alone is not enough; the upload must have completed. */
  it('4.3-UNIT-ENGINE-09 excludes a capsule whose garment never finished uploading', () => {
    const top = createGarment('g-top', 'top')
    const bottom = createGarment('g-bot', 'bottom')
    bottom.upload_status = 'processing'
    const capsule = createCapsule('cap-1', 'Any', ['casual'], [top, bottom], false)

    expect(
      evaluateCapsuleForScenario({
        capsules: [capsule],
        userGarments: [top],
        adjustedFeelsLike: 20,
      })
    ).toBeNull()
  })
})
