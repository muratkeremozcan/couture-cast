// Story CC-7.5: shared rules for the garment detail and its tag editor on web and native, so
// both platforms label tags, compare drafts and name save failures the same way.
import { isOfflineError } from '../save-feedback'
import { formatGarmentCategory } from './garment-alt'
import { getGuestPreviewStrings, resolveGuestPreviewLocale } from './format'
import type { ComfortRange } from '../comfort-rules'
import type { SampleGarmentCategory, SampleGarmentMaterial } from './types'

/** D4: the editable tags. Category and comfort are required; material may be cleared. */
export interface GarmentTagDraft {
  category: SampleGarmentCategory
  material: SampleGarmentMaterial | null
  comfortRange: ComfortRange
}

/** The tags of a garment as the list or the tag update returned them. */
export interface GarmentTagSource {
  category: SampleGarmentCategory | null
  material: SampleGarmentMaterial | null
  comfortRange: ComfortRange | null
}

/** A draft for the editor, or null when the garment lacks a required tag. */
export function garmentTagDraft(garment: GarmentTagSource): GarmentTagDraft | null {
  if (!garment.category || !garment.comfortRange) return null
  return {
    category: garment.category,
    material: garment.material ?? null,
    comfortRange: garment.comfortRange,
  }
}

/** D5: Done with an unchanged draft shows "No changes" and sends nothing. */
export function garmentTagsEqual(a: GarmentTagDraft, b: GarmentTagDraft): boolean {
  return (
    a.category === b.category &&
    (a.material ?? null) === (b.material ?? null) &&
    a.comfortRange === b.comfortRange
  )
}

function capitalizeFirst(text: string, locale: string): string {
  const first = text.charAt(0)
  return first ? first.toLocaleUpperCase(locale) + text.slice(1) : text
}

export interface GarmentTagLabels {
  category: string | null
  material: string | null
  comfort: string | null
}

/**
 * Localized display labels for one garment's tags; a missing tag gives null. The category is
 * the singular noun ("Top"), the same word the alt text and the editor chips use.
 */
export function formatGarmentTagLabels(
  locale: string | undefined,
  garment: Partial<GarmentTagSource>
): GarmentTagLabels {
  const { values } = getGuestPreviewStrings(locale)
  const resolved = resolveGuestPreviewLocale(locale)
  return {
    category: garment.category ? formatGarmentCategory(resolved, garment.category) : null,
    material: garment.material ? values.material[garment.material] : null,
    comfort: garment.comfortRange
      ? capitalizeFirst(values.range[garment.comfortRange], resolved)
      : null,
  }
}

/** Each tag save failure the member is told about in its own words. */
export type GarmentTagSaveFailure = 'conflict' | 'not-allowed' | 'offline' | 'failed'

/**
 * Names a tag save failure from the error web or native raised. Both clients attach the HTTP
 * `status` of an API refusal and the API `code` when it named one; a request that never
 * reached the API has no status.
 */
export function classifyGarmentTagSaveError(
  error: unknown,
  online = true
): GarmentTagSaveFailure {
  const candidate =
    error && typeof error === 'object'
      ? (error as { status?: unknown; code?: unknown; message?: unknown })
      : {}
  const status = typeof candidate.status === 'number' ? candidate.status : undefined
  if (
    status === 409 &&
    (candidate.code === 'CONCURRENT_TAG_UPDATE' ||
      candidate.message === 'CONCURRENT_TAG_UPDATE')
  ) {
    return 'conflict'
  }
  if (status === 403) return 'not-allowed'
  if (status !== undefined) return 'failed'
  if (!online || isOfflineError(error)) return 'offline'
  return 'failed'
}
