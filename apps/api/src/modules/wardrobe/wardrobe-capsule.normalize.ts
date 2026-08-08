import { BadRequestException } from '@nestjs/common'

/**
 * Canonical enum order for `occasions`. Story 4.3 requires this exact order for
 * idempotency hashing and for analytics payloads, so both paths read it here
 * rather than each keeping their own copy.
 */
export const OCCASION_ORDER = [
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
] as const

export type CanonicalOccasion = (typeof OCCASION_ORDER)[number]

const NAME_MAX_GRAPHEMES = 60
const DESCRIPTION_MAX_GRAPHEMES = 280
const SEARCH_MAX_GRAPHEMES = 120

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Counts extended grapheme clusters, which is what a user perceives as a
 * character. UTF-16 code units would reject a 5-emoji name and accept a
 * 120-character combining-mark name, neither of which matches the stated limit.
 */
export function countGraphemes(value: string): number {
  // Iterating the segmenter is the only way to count clusters; the segment
  // itself is not needed, so consume the iterator without binding it.
  return [...graphemeSegmenter.segment(value)].length
}

/**
 * Trims Unicode whitespace and applies NFC. Every user-authored string is
 * normalized here before it is validated, hashed, compared for no-op detection,
 * or persisted, so that canonically equivalent input is treated as identical
 * everywhere.
 */
export function canonicalizeText(value: string): string {
  return value.trim().normalize('NFC')
}

/** PostgreSQL `text` cannot store a NUL byte; reject it as invalid input. */
function assertNoNullByte(value: string, field: string): void {
  if (value.includes('\u0000')) {
    throw new BadRequestException(`${field} must not contain a null byte`)
  }
}

export function canonicalizeName(value: string): string {
  assertNoNullByte(value, 'name')
  const canonical = canonicalizeText(value)
  const graphemes = countGraphemes(canonical)
  if (graphemes < 1 || graphemes > NAME_MAX_GRAPHEMES) {
    throw new BadRequestException(
      `name must be 1 to ${NAME_MAX_GRAPHEMES} characters after normalization`
    )
  }
  return canonical
}

/** An empty normalized description is stored as `null`, never as `''`. */
export function canonicalizeDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  assertNoNullByte(value, 'description')
  const canonical = canonicalizeText(value)
  if (canonical.length === 0) {
    return null
  }
  if (countGraphemes(canonical) > DESCRIPTION_MAX_GRAPHEMES) {
    throw new BadRequestException(
      `description must be at most ${DESCRIPTION_MAX_GRAPHEMES} characters after normalization`
    )
  }
  return canonical
}

/** Returns `undefined` when the normalized search term is empty, so that a
 * whitespace-only `q` is treated as omitted rather than matching every row. */
export function canonicalizeSearchTerm(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  assertNoNullByte(value, 'q')
  const canonical = canonicalizeText(value)
  if (canonical.length === 0) {
    return undefined
  }
  if (countGraphemes(canonical) > SEARCH_MAX_GRAPHEMES) {
    throw new BadRequestException(
      `q must be at most ${SEARCH_MAX_GRAPHEMES} characters after normalization`
    )
  }
  return canonical
}

/**
 * Escapes the LIKE metacharacters so a search term is matched as literal text.
 * Quotes need no escaping: Prisma binds the term as a parameter, so they are
 * already literal.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}

export function sortOccasions(occasions: readonly string[]): CanonicalOccasion[] {
  const rank = new Map<string, number>(
    OCCASION_ORDER.map((value, index) => [value, index])
  )
  return [...occasions]
    .filter((value): value is CanonicalOccasion => rank.has(value))
    .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
}
