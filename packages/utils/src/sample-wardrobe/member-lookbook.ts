import { z } from 'zod'
import { SAMPLE_CATALOG } from './catalog'
import { formatSampleExplanation, getGuestPreviewStrings } from './format'
import { createMemberSampleOutfit } from './member-outfit'
import {
  sampleSwapCandidates,
  selectSampleOutfit,
  type SampleOutfitResult,
  type SampleWeatherKey,
} from './selector'
import { activeStyleDay, type StyleMood, type StyleSampleInputs } from './style-profile'
import {
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_STYLE_OPTIONS,
  type SampleGarmentCategory,
} from './types'

const DEFAULT_MOODS: readonly StyleMood[] = ['chic', 'active', 'cozy']
const lookStyles = new Map(
  SAMPLE_CATALOG.looks.map((look) => [look.id, look.preferences?.style])
)

const outfitDraftSchema = z.object({
  lookId: z.string().max(100).nullable(),
  pieces: z.partialRecord(z.enum(SAMPLE_GARMENT_CATEGORIES), z.string().max(100)),
  pinned: z
    .array(z.enum(SAMPLE_GARMENT_CATEGORIES))
    .max(SAMPLE_GARMENT_CATEGORIES.length),
})
const draftSchema = z.object({
  mood: z.enum(SAMPLE_STYLE_OPTIONS.style),
  looks: z.partialRecord(z.enum(SAMPLE_STYLE_OPTIONS.style), outfitDraftSchema),
})

export type MemberLookbookOutfitDraft = z.infer<typeof outfitDraftSchema>
export type MemberLookbookDraft = z.infer<typeof draftSchema>

export function memberLookbookDraftKey(owner: string): string {
  return `couture:member-lookbook:v1:${encodeURIComponent(owner)}`
}

export function readMemberLookbookDraft(raw: string | null): MemberLookbookDraft | null {
  if (!raw || raw.length > 4096) return null
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function candidates(result: SampleOutfitResult, category: SampleGarmentCategory) {
  return sampleSwapCandidates(SAMPLE_CATALOG, category, result.input, result.context)
}

function withPieces(
  result: SampleOutfitResult,
  pieces: MemberLookbookOutfitDraft['pieces']
): SampleOutfitResult {
  if (!result.look) return result
  const selectedLookId = result.look.id
  const clean = selectSampleOutfit(
    { ...result.input, selectedLookId, swaps: {} },
    SAMPLE_CATALOG
  )
  const swaps: MemberLookbookOutfitDraft['pieces'] = {}
  for (const { category, id } of clean.garments) {
    const choice = pieces[category]
    if (choice && choice !== id) swaps[category] = choice
  }
  return Object.keys(swaps).length
    ? selectSampleOutfit(
        { ...clean.input, swaps: { [selectedLookId]: swaps } },
        SAMPLE_CATALOG
      )
    : clean
}

export function createMemberLookbook(
  weather?: SampleWeatherKey,
  inputs?: StyleSampleInputs
): { mood: StyleMood; result: SampleOutfitResult }[] {
  const day = activeStyleDay(inputs?.day)
  const preferred = day?.mood ?? inputs?.profile?.mood
  const moods = [
    ...new Set(preferred ? [preferred, ...DEFAULT_MOODS] : DEFAULT_MOODS),
  ].slice(0, DEFAULT_MOODS.length)
  const used = new Set<string>()

  return moods.map((mood) => {
    const profile = {
      palette: null,
      texture: null,
      fit: null,
      avoid: [],
      ...inputs?.profile,
      mood,
    }
    const base = createMemberSampleOutfit(weather, {
      profile,
      day: day && { ...day, mood },
    })
    const ranked = [
      ...base.eligibleLookIds.filter((id) => lookStyles.get(id) === mood),
      ...base.eligibleLookIds.filter((id) => lookStyles.get(id) !== mood),
    ]
    for (const selectedLookId of ranked) {
      if (used.has(selectedLookId)) continue
      const result = selectSampleOutfit({ ...base.input, selectedLookId }, SAMPLE_CATALOG)
      const replacements: MemberLookbookOutfitDraft['pieces'] = {}
      const canEditEveryPiece = result.garments.every((piece) => {
        const options = candidates(result, piece.category)
        if (options.length < 2) return false
        if (!options.some(({ id }) => id === piece.id)) {
          replacements[piece.category] = options[0]!.id
        }
        return true
      })
      if (canEditEveryPiece) {
        used.add(selectedLookId)
        return { mood, result: withPieces(result, replacements) }
      }
    }
    return { mood, result: base }
  })
}

export function memberLookbookOutfitDraft(
  result: SampleOutfitResult,
  pinned: readonly SampleGarmentCategory[]
): MemberLookbookOutfitDraft {
  const pieces: MemberLookbookOutfitDraft['pieces'] = {}
  for (const { category, id } of result.garments) pieces[category] = id
  return { lookId: result.look?.id ?? null, pieces, pinned: [...pinned] }
}

export function resolveMemberLookbookDraft(
  base: SampleOutfitResult,
  draft?: MemberLookbookOutfitDraft
): { result: SampleOutfitResult; pinned: SampleGarmentCategory[] } {
  if (!draft || !base.look) return { result: base, pinned: [] }
  const sameLook = base.look.id === draft.lookId
  const pinned: SampleGarmentCategory[] = []
  const pieces = { ...base.input.swaps[base.look.id] }
  for (const { category } of base.garments) {
    const id = draft.pieces[category]
    const isPinned = draft.pinned.includes(category)
    if (!id || (!sameLook && !isPinned)) continue
    if (!candidates(base, category).some((option) => option.id === id)) continue
    pieces[category] = id
    if (isPinned) pinned.push(category)
  }
  return { result: withPieces(base, pieces), pinned }
}

export function canShuffleMemberLookbook(
  result: SampleOutfitResult,
  pinned: readonly SampleGarmentCategory[]
): boolean {
  const changing = result.garments.filter(({ category }) => !pinned.includes(category))
  return (
    changing.length > 0 &&
    changing.every(({ category, id }) =>
      candidates(result, category).some((candidate) => candidate.id !== id)
    )
  )
}

export function shuffleMemberLookbook(
  result: SampleOutfitResult,
  pinned: readonly SampleGarmentCategory[]
): SampleOutfitResult {
  if (!canShuffleMemberLookbook(result, pinned)) return result
  const { pieces } = memberLookbookOutfitDraft(result, pinned)
  for (const { category, id } of result.garments) {
    if (pinned.includes(category)) continue
    const options = candidates(result, category)
    const index = options.findIndex((candidate) => candidate.id === id)
    pieces[category] = options[(index + 1) % options.length]!.id
  }
  return withPieces(result, pieces)
}

export function memberLookbookWeatherReason(
  result: SampleOutfitResult,
  locale: string | undefined
): string {
  const strings = getGuestPreviewStrings(locale)
  for (const key of ['layer-rain', 'layer-cold', 'no-layer']) {
    const reason = result.explanation.find((item) => item.key === key)
    if (reason)
      return formatSampleExplanation(reason, { strings, locale, catalog: SAMPLE_CATALOG })
  }
  return strings.values.weather[result.context.weather]
}

/** Today's wardrobe read includes up to three recent active pieces. */
export function isSmallLookbookCloset(pieces: readonly unknown[] | null | undefined) {
  return Array.isArray(pieces) && pieces.length < 3
}
