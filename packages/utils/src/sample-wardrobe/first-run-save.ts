import { z } from 'zod'
import { applyComfortCarryover } from './carryover'
import { buildHomeSampleSavedLookInput, createIdempotencyKey } from './saved-looks'
import {
  SAMPLE_WEATHER_KEYS,
  type SampleComfort,
  type SampleOutfitResult,
} from './selector'
import type { GuestPreviewState } from './state'
import type { StyleProfileAnswers } from './style-profile'
import { getStyleProfileStrings } from './style-profile-strings'
import {
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_ID_PATTERN,
  SAMPLE_LOOK_ID_PATTERN,
  SAMPLE_STYLE_OPTIONS,
  type SampleCatalog,
} from './types'

export const GUEST_PREVIEW_SAVE_INTENT = 'guest-preview-save-look'

const category = z.enum(SAMPLE_GARMENT_CATEGORIES)
const garmentId = z.string().regex(SAMPLE_GARMENT_ID_PATTERN)
const tolerance = z.enum(['low', 'medium', 'high'])
export const guestPreviewComfortSchema = z
  .object({
    runsColdWarm: z.enum(['cold', 'neutral', 'warm']),
    windTolerance: tolerance,
    precipPreparedness: tolerance,
  })
  .strict()
const style = z
  .object({
    mood: z.enum(SAMPLE_STYLE_OPTIONS.style).optional(),
    palette: z.enum(SAMPLE_STYLE_OPTIONS.palette).optional(),
  })
  .strict()

export const guestLookSaveIntentSchema = z
  .object({
    intent: z.literal(GUEST_PREVIEW_SAVE_INTENT),
    key: z.uuidv4(),
    style,
    comfort: guestPreviewComfortSchema,
    look: z
      .object({
        source: z.literal('home_sample'),
        lookId: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
        weather: z.enum(SAMPLE_WEATHER_KEYS),
        collection: z.enum(SAMPLE_COLLECTION_FILTERS),
        composition: z
          .array(
            z
              .object({
                slotIndex: z.number().int().nonnegative(),
                category,
                kind: z.literal('catalog'),
                itemId: garmentId,
              })
              .strict()
          )
          .min(1)
          .max(12),
        swaps: z.partialRecord(category, garmentId),
      })
      .strict(),
  })
  .strict()

export type GuestLookSaveIntent = z.infer<typeof guestLookSaveIntentSchema>
type GuestStyleProposal = GuestLookSaveIntent['style']

export function guestLookStyleRows(
  values: Partial<Pick<StyleProfileAnswers, 'mood' | 'palette'>> | null,
  locale: string
) {
  const labels = getStyleProfileStrings(locale)
  return [
    [labels.mood, values?.mood ? labels[values.mood] : labels.any],
    [labels.palette, values?.palette ? labels[values.palette] : labels.any],
  ] as const
}

export function beginGuestLookSave(
  state: GuestPreviewState,
  result: SampleOutfitResult
): GuestPreviewState {
  const payload = buildHomeSampleSavedLookInput(result)
  if (!payload) return state
  const { comfort, ...look } = payload
  const proposed = guestLookSaveIntentSchema.safeParse({
    intent: GUEST_PREVIEW_SAVE_INTENT,
    key: createIdempotencyKey(),
    style: { mood: state.preferences?.style, palette: state.preferences?.palette },
    comfort,
    look,
  })
  return proposed.success ? { ...state, conversion: proposed.data } : state
}

export function isGuestLookAvailable(
  intent: GuestLookSaveIntent,
  catalog: SampleCatalog
) {
  const { lookId, composition, swaps } = intent.look
  const garments = new Map(catalog.garments.map((item) => [item.id, item.category]))
  return (
    catalog.looks.some((look) => look.id === lookId) &&
    composition.every(
      (slot, index) =>
        slot.slotIndex === index && garments.get(slot.itemId) === slot.category
    ) &&
    Object.entries(swaps).every(([category, id]) =>
      composition.some((slot) => slot.category === category && slot.itemId === id)
    )
  )
}

export type GuestLookReviewClient = {
  readStyle: () => Promise<StyleProfileAnswers | null>
  writeStyle: (proposal: GuestStyleProposal) => Promise<unknown>
  save: (look: GuestLookSaveIntent['look'], key: string) => Promise<{ id: string }>
}

export function guestPreviewReviewProposal(state: GuestPreviewState | null) {
  const conversion = state?.conversion
  if (!state || !conversion) return null
  const intent = conversion.intent === GUEST_PREVIEW_SAVE_INTENT ? conversion : null
  return { intent, comfort: intent?.comfort ?? state.comfort }
}

async function applyGuestStyle(
  { mood, palette }: GuestStyleProposal,
  client: GuestLookReviewClient,
  isCurrent: () => boolean
) {
  if (!mood && !palette) return
  const before = await client.readStyle()
  if (!isCurrent()) return
  const patch = {
    ...(mood && before?.mood !== mood && { mood }),
    ...(palette && before?.palette !== palette && { palette }),
  }
  if (Object.keys(patch).length) await client.writeStyle(patch)
}

export async function completeGuestLookSave(options: {
  intent: GuestLookSaveIntent
  applySettings: boolean
  lookClient: GuestLookReviewClient
  comfortClient: {
    read: () => Promise<SampleComfort>
    write: (values: SampleComfort) => Promise<unknown>
  }
  isCurrent: () => boolean
  isRejection?: (error: unknown) => boolean
}): Promise<{ id: string } | 'rejected' | null> {
  const { intent, applySettings, lookClient, comfortClient, isCurrent, isRejection } =
    options
  if (!isCurrent()) return null
  if (applySettings) {
    const outcome = await applyComfortCarryover({
      proposal: intent.comfort,
      ...comfortClient,
      isCurrent,
      isRejection: (error) => isRejection?.(error) ?? false,
    })
    if (!isCurrent()) return null
    if (outcome.status === 'rejected') return 'rejected'
    if (outcome.status !== 'saved') throw new Error('Comfort carryover failed')
    await applyGuestStyle(intent.style, lookClient, isCurrent)
    if (!isCurrent()) return null
  }
  const saved = await lookClient.save(intent.look, intent.key)
  return isCurrent() ? saved : null
}
