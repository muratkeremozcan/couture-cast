// Story 6.16 D7: strict, versioned, bounded guest preview state. It holds no birthdate,
// age, account or device data, and lives apart from every member store.
import { z } from 'zod'
import { evaluateBirthdateInput, parseBirthdateInput } from '../age'
import {
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_COLLECTION_FILTERS,
  type SampleCatalog,
  type SampleGarmentCategory,
} from './types'
import {
  DEFAULT_SAMPLE_COMFORT,
  SAMPLE_WEATHER_KEYS,
  type SampleSelectionInput,
  type SampleVote,
} from './selector'

export const GUEST_PREVIEW_SCHEMA_VERSION = 1
export const GUEST_PREVIEW_RETENTION_MS = 24 * 60 * 60 * 1000
export const GUEST_PREVIEW_MAX_BYTES = 16 * 1024
export const GUEST_PREVIEW_VIEWS = ['outfit', 'wardrobe', 'preferences'] as const
export type GuestPreviewView = (typeof GUEST_PREVIEW_VIEWS)[number]
export const GUEST_PREVIEW_CONVERSION_INTENT = 'guest-preview-carryover'

const tolerance = z.enum(['low', 'medium', 'high'])

export const guestPreviewStateSchema = z
  .object({
    schemaVersion: z.literal(GUEST_PREVIEW_SCHEMA_VERSION),
    catalogVersion: z.string().max(32),
    startedAt: z.number().int().nonnegative(),
    eligibility: z
      .object({ eligible: z.literal(true), expiresAt: z.number().int().nonnegative() })
      .strict(),
    view: z.enum(GUEST_PREVIEW_VIEWS),
    weather: z.enum(SAMPLE_WEATHER_KEYS),
    collection: z.enum(SAMPLE_COLLECTION_FILTERS),
    selectedLookId: z.string().max(64).optional(),
    comfort: z
      .object({
        runsColdWarm: z.enum(['cold', 'neutral', 'warm']),
        windTolerance: tolerance,
        precipPreparedness: tolerance,
      })
      .strict(),
    votes: z.record(z.string().max(64), z.enum(['like', 'dislike'])),
    swaps: z.record(
      z.string().max(64),
      z.record(z.enum(SAMPLE_GARMENT_CATEGORIES), z.string().max(64))
    ),
    conversion: z
      .object({ intent: z.literal(GUEST_PREVIEW_CONVERSION_INTENT) })
      .strict()
      .optional(),
  })
  .strict()

export type GuestPreviewState = z.infer<typeof guestPreviewStateSchema>

export function createGuestPreviewState(
  now: number,
  catalog: SampleCatalog
): GuestPreviewState {
  return {
    schemaVersion: GUEST_PREVIEW_SCHEMA_VERSION,
    catalogVersion: catalog.catalogVersion,
    startedAt: now,
    eligibility: { eligible: true, expiresAt: now + GUEST_PREVIEW_RETENTION_MS },
    view: 'outfit',
    weather: 'mild-dry',
    collection: 'all',
    comfort: { ...DEFAULT_SAMPLE_COMFORT },
    votes: {},
    swaps: {},
  }
}

/** "Reset preview": defaults back, eligibility and its fixed 24-hour window kept (TEA-1). */
export function resetGuestPreviewState(
  state: GuestPreviewState,
  catalog: SampleCatalog
): GuestPreviewState {
  return {
    ...createGuestPreviewState(state.startedAt, catalog),
    eligibility: { ...state.eligibility },
  }
}

export function isGuestPreviewExpired(state: GuestPreviewState, now: number): boolean {
  return now >= state.eligibility.expiresAt
}

/**
 * Parses stored text. Returns null (start clean) for anything expired, malformed,
 * oversized, from another schema or catalog version, or with a stretched expiry.
 * Ids outside the current catalog are dropped so they never reach a path, URL or API.
 */
export function parseGuestPreviewState(
  raw: string | null,
  now: number,
  catalog: SampleCatalog
): GuestPreviewState | null {
  if (raw === null || raw.length > GUEST_PREVIEW_MAX_BYTES) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = guestPreviewStateSchema.safeParse(json)
  if (!parsed.success) return null
  const state = parsed.data
  if (state.catalogVersion !== catalog.catalogVersion) return null
  if (state.eligibility.expiresAt !== state.startedAt + GUEST_PREVIEW_RETENTION_MS)
    return null
  if (state.startedAt > now || isGuestPreviewExpired(state, now)) return null
  return keepCatalogIds(state, catalog)
}

/**
 * G2: validates an in-memory change before it is kept. Returns the state with ids outside
 * the catalog dropped, exactly as a later load would, or null when the change breaks the
 * schema or moves the fixed 24-hour window.
 */
export function normalizeGuestPreviewState(
  next: GuestPreviewState,
  previous: GuestPreviewState | null,
  catalog: SampleCatalog
): GuestPreviewState | null {
  const parsed = guestPreviewStateSchema.safeParse(next)
  if (!parsed.success) return null
  const state = parsed.data
  if (state.catalogVersion !== catalog.catalogVersion) return null
  if (state.eligibility.expiresAt !== state.startedAt + GUEST_PREVIEW_RETENTION_MS)
    return null
  if (previous && state.startedAt !== previous.startedAt) return null
  return keepCatalogIds(state, catalog)
}

function keepCatalogIds(
  state: GuestPreviewState,
  catalog: SampleCatalog
): GuestPreviewState {
  const lookIds = new Set(catalog.looks.map((look) => look.id))
  const garments = new Map(
    catalog.garments.map((garment) => [garment.id, garment.category])
  )
  const votes: Record<string, SampleVote> = {}
  for (const [lookId, vote] of Object.entries(state.votes)) {
    if (lookIds.has(lookId)) votes[lookId] = vote
  }
  const swaps: Record<string, Partial<Record<SampleGarmentCategory, string>>> = {}
  for (const [lookId, bySlot] of Object.entries(state.swaps)) {
    if (!lookIds.has(lookId)) continue
    const kept: Partial<Record<SampleGarmentCategory, string>> = {}
    for (const [category, garmentId] of Object.entries(bySlot)) {
      if (garments.get(garmentId) === category) {
        kept[category] = garmentId
      }
    }
    if (Object.keys(kept).length > 0) swaps[lookId] = kept
  }
  const { selectedLookId, ...rest } = state
  return {
    ...rest,
    ...(selectedLookId !== undefined && lookIds.has(selectedLookId)
      ? { selectedLookId }
      : {}),
    votes,
    swaps,
  }
}

export function serializeGuestPreviewState(state: GuestPreviewState): string {
  return JSON.stringify(guestPreviewStateSchema.parse(state))
}

export function toSampleSelectionInput(state: GuestPreviewState): SampleSelectionInput {
  return {
    weather: state.weather,
    collection: state.collection,
    comfort: state.comfort,
    ...(state.selectedLookId !== undefined
      ? { selectedLookId: state.selectedLookId }
      : {}),
    votes: state.votes,
    swaps: state.swaps,
  }
}

/** D8: `from` is honored only as the exact literal `preview`. */
export function parsePreviewFrom(value: unknown): 'preview' | null {
  return value === 'preview' ? 'preview' : null
}

export type GuestPreviewGateResult =
  | { eligible: true }
  | { eligible: false; reason: 'empty' | 'invalid' | 'underage' }

/**
 * D2: the self-reported gate reuses the signup age rules. Only the pass or fail result
 * leaves this function; the caller clears the typed birthdate right after. A date in the
 * future is invalid. Ages 13 to 15 pass, since the preview holds only synthetic examples.
 */
export function evaluateGuestPreviewGate(
  input: string,
  today: Date = new Date()
): GuestPreviewGateResult {
  const evaluation = evaluateBirthdateInput(input, today)
  if (evaluation.kind === 'empty') return { eligible: false, reason: 'empty' }
  if (evaluation.kind === 'invalid') return { eligible: false, reason: 'invalid' }
  const todayNoonUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    12
  )
  if (parseBirthdateInput(input).getTime() > todayNoonUtc) {
    return { eligible: false, reason: 'invalid' }
  }
  if (!evaluation.gate.allowed) return { eligible: false, reason: 'underage' }
  return { eligible: true }
}
