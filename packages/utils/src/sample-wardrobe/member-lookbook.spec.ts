// Learning path Step 79: Lookbook with shuffle and pinned pieces.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-79-lookbook-with-shuffle-and-pinned-pieces
import { describe, expect, it } from 'vitest'
import {
  canShuffleMemberLookbook,
  createMemberLookbook,
  isSmallLookbookCloset,
  memberLookbookDraftKey,
  memberLookbookOutfitDraft,
  memberLookbookWeatherReason,
  readMemberLookbookDraft,
  resolveMemberLookbookDraft,
  shuffleMemberLookbook,
} from './member-lookbook'
import { garmentSuitsRange, type SampleWeatherKey } from './selector'
import { styleLocalDay, type StyleProfileAnswers } from './style-profile'
import type { SampleGarmentCategory } from './types'

const classic: StyleProfileAnswers = {
  mood: 'classic',
  palette: 'neutral',
  texture: 'smooth',
  fit: 'fitted',
  avoid: ['crop-top', 'mini-skirt', 'leggings'],
}

const conditions = [
  { weather: 'cool-rainy', needs: 'rain' },
  { weather: 'cool-windy', needs: 'wind' },
  { weather: 'mild-dry', needs: 'none' },
  { weather: 'mild-rainy', needs: 'rain' },
  { weather: 'warm-dry', needs: 'none' },
  { weather: 'warm-rainy', needs: 'rain' },
] as const satisfies readonly { weather: SampleWeatherKey; needs: string }[]

describe('CC-7.22 member lookbook', () => {
  it.each(conditions)(
    '$weather has three complete looks whose unpinned pieces can change',
    ({ weather, needs }) => {
      const looks = createMemberLookbook(weather, { profile: classic })
      expect(looks.map(({ mood }) => mood)).toEqual(['classic', 'chic', 'active'])
      expect(new Set(looks.map(({ result }) => result.look?.id)).size).toBe(3)

      const pins = ['shoes'] as const
      for (const { result } of looks) {
        const before = memberLookbookOutfitDraft(result, pins).pieces
        const updated = shuffleMemberLookbook(result, pins)
        const after = memberLookbookOutfitDraft(updated, pins).pieces
        expect(result.context.weather).toBe(weather)
        expect(result.look?.id).toMatch(/^sample:l:/)
        expect(before).toHaveProperty('shoes', expect.stringMatching(/^sample:g:/))
        if (before.dress) {
          expect(before).not.toHaveProperty('top')
          expect(before).not.toHaveProperty('bottom')
        } else {
          expect(before).toHaveProperty('top', expect.stringMatching(/^sample:g:/))
          expect(before).toHaveProperty('bottom', expect.stringMatching(/^sample:g:/))
        }
        expect(canShuffleMemberLookbook(result, pins)).toBe(true)
        expect(Object.keys(after)).toEqual(Object.keys(before))
        expect(after.shoes).toBe(before.shoes)
        for (const [category, id] of Object.entries(before)) {
          if (category !== 'shoes')
            expect(after[category as SampleGarmentCategory], category).not.toBe(id)
        }
        for (const garment of updated.garments) {
          expect(garmentSuitsRange(garment, result.context.range), garment.id).toBe(true)
          expect(classic.avoid, garment.id).not.toContain(
            garment.subtype ?? garment.art.key
          )
        }
        if (needs === 'rain') {
          expect(
            updated.garments.find(({ category }) => category === 'outerwear')
          ).toMatchObject({ waterResistant: true })
          expect(memberLookbookWeatherReason(updated, 'en-US')).toMatch(/rain|water/i)
        }
        if (needs === 'wind') {
          expect(
            updated.garments.find(({ category }) => category === 'outerwear')
          ).toMatchObject({ windResistant: true })
          expect(memberLookbookWeatherReason(updated, 'en-US')).toMatch(/wind/i)
        }
      }
    }
  )

  it('gives the current day mood priority and keeps rain when the day changes the temperature', () => {
    const looks = createMemberLookbook('warm-rainy', {
      profile: classic,
      day: { date: styleLocalDay(), mood: 'cozy', temperature: 'cool' },
    })
    expect(looks.map(({ mood }) => mood)).toEqual(['cozy', 'chic', 'active'])
    for (const { result } of looks) expect(result.context.weather).toBe('cool-rainy')
    const expired = createMemberLookbook('warm-rainy', {
      profile: classic,
      day: { date: '2000-01-01', mood: 'cozy', temperature: 'cool' },
    })
    expect(expired.map(({ mood }) => mood)).toEqual(['classic', 'chic', 'active'])
    expect(expired[0]!.result.context.weather).toBe('warm-rainy')
  })

  it('keeps every piece with all pins set and resumes shuffle after one is released', () => {
    const { result } = createMemberLookbook('mild-dry')[0]!
    const all = result.garments.map(({ category }) => category)
    expect(canShuffleMemberLookbook({ ...result, garments: [] }, [])).toBe(false)
    expect(canShuffleMemberLookbook(result, all)).toBe(false)
    expect(shuffleMemberLookbook(result, all)).toBe(result)
    const shoeReleased = all.filter((category) => category !== 'shoes')
    expect(canShuffleMemberLookbook(result, shoeReleased)).toBe(true)
    expect(
      memberLookbookOutfitDraft(shuffleMemberLookbook(result, shoeReleased), shoeReleased)
        .pieces.shoes
    ).not.toBe(memberLookbookOutfitDraft(result, all).pieces.shoes)
  })

  it('restores the exact acceptable draft for its owner and rebuilds stale slots', () => {
    const { mood, result } = createMemberLookbook('mild-rainy')[0]!
    const shuffled = shuffleMemberLookbook(result, ['shoes'])
    const outfit = memberLookbookOutfitDraft(shuffled, ['shoes'])
    const draft = { mood, looks: { [mood]: outfit } }
    const storage = new Map([[memberLookbookDraftKey('member-a'), JSON.stringify(draft)]])
    const restored = readMemberLookbookDraft(
      storage.get(memberLookbookDraftKey('member-a')) ?? null
    )
    expect(restored).toEqual(draft)
    expect(
      readMemberLookbookDraft(storage.get(memberLookbookDraftKey('member-b')) ?? null)
    ).toBeNull()
    const resolved = resolveMemberLookbookDraft(result, restored?.looks[mood])
    expect(memberLookbookOutfitDraft(resolved.result, resolved.pinned)).toEqual(outfit)

    const stale = resolveMemberLookbookDraft(result, {
      ...outfit,
      lookId: 'sample:l:removed-look',
      pinned: ['shoes', 'outerwear', 'accessory'],
      pieces: {
        ...outfit.pieces,
        outerwear: 'sample:g:wool-overcoat',
        accessory: 'sample:g:unknown',
      },
    })
    expect(stale.pinned).toEqual(['shoes'])
    expect(memberLookbookOutfitDraft(stale.result, stale.pinned).pieces).toEqual({
      ...memberLookbookOutfitDraft(result, []).pieces,
      shoes: outfit.pieces.shoes,
    })
    expect(
      stale.result.garments.find(({ category }) => category === 'outerwear')
    ).toMatchObject({ waterResistant: true })
  })

  it.each(['{', '{}', '{"mood":"unknown","looks":{}}', ' '.repeat(4097)])(
    'discards an invalid stored draft',
    (raw) => {
      expect(readMemberLookbookDraft(raw)).toBeNull()
    }
  )

  it('only uses the small-closet rule after the wardrobe has answered', () => {
    expect(isSmallLookbookCloset([])).toBe(true)
    expect(isSmallLookbookCloset([{}, {}])).toBe(true)
    expect(isSmallLookbookCloset([{}, {}, {}])).toBe(false)
    expect(isSmallLookbookCloset(null)).toBe(false)
    expect(isSmallLookbookCloset(undefined)).toBe(false)
  })
})
