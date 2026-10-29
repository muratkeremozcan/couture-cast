// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 3: reusable multilingual community text screening (ADR-013).
//
// The boundary Story 6.4 reuses for comments. It holds the seven-language term
// and allow lists, the locale map, the obfuscation transforms and the severity
// mapping; `DefaultCommunityModerationEngine` and any later caller supply the
// field and locale and read back a disposition.
//
// Three rules shape everything below.
//
// EVERY LANGUAGE RUNS AGAINST EVERY SUBMISSION. `locale` arrives from the
// client on the publish request, so treating it as a dictionary routing key would
// make it a one-field opt-out. It scopes ordinary low/medium grammatical contexts;
// every dictionary still runs. Reviewed high-term constructions require their
// declared native language and exclude person-directed insult frames. It is also checked for a language this
// screener holds no list for. A policy that set `allDictionariesAlwaysRun` to
// false would be asking for exactly that bypass, so construction refuses it.
//
// MATCHING IS TOKEN-EQUALITY, NEVER SUBSTRING. Ordinary fashion copy is full of
// words that contain a vulgarity: `cocktail`, `peacock`, `cockade`. A substring
// scan flags all three. Every representation below therefore compares whole
// tokens, and the obfuscation families that need characters joined back together
// reconstruct a candidate token rather than squashing the whole caption into one
// string.
//
// RAW MATCHED TERMS NEVER LEAVE THIS MODULE. `screen` returns categories,
// severity and reason codes. A matched token exists only as a local inside the
// call that produced the decision, because everything the caller persists ends
// up in logs, metrics and readiness evidence.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Filter } from 'bad-words'
import { z } from 'zod'
import { supportedLocales } from '@couture/api-client/contracts/http'
import reviewedOccurrenceBank from '../../../policies/community-screening/reviewed-occurrence-constructions-v1.json'

export const SCREENING_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'] as const

/** The six categories `policies/community-screening/policy-v2.json` defines. */
export const TEXT_SCREENING_CATEGORIES = [
  'profanity',
  'sexual',
  'hate',
  'harassment',
  'violence',
  'self_harm',
] as const

export const TEXT_SCREENING_SEVERITIES = ['low', 'medium', 'high'] as const

export type ScreeningLanguage = (typeof SCREENING_LANGUAGES)[number]

export type TextScreeningField = 'caption' | 'altText'

export type TextScreeningCategory = (typeof TEXT_SCREENING_CATEGORIES)[number]

export type TextScreeningSeverity = (typeof TEXT_SCREENING_SEVERITIES)[number]

export type TextScreeningDisposition = 'pass' | 'review' | 'block'

/**
 * Locale to language, derived from the ten tags `supported-locales.json`
 * publishes rather than hand-written here, so a new locale cannot ship without
 * either landing in this map or failing construction.
 *
 * The primary subtag is the language: `es-419` is Spanish, `pt-BR` and `pt-PT`
 * are both Portuguese. The spec asserts set equality against that JSON's own
 * `language` field so the shortcut cannot drift from it.
 */
export const LOCALE_SCREENING_LANGUAGES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    supportedLocales.map((locale) => [locale, locale.split('-')[0] ?? locale])
  )
)

/** Stable reason codes, mirroring `policy-v2.json`'s `reasonCodes.text`. */
export const TEXT_POLICY_MATCH_REASON = 'text_policy_match'
export const LOCALE_UNSCREENABLE_REASON = 'locale_unscreenable'
export const SCRIPT_MIXED_REASON = 'script_mixed'
export const SCRIPT_UNSUPPORTED_REASON = 'script_unsupported'

/**
 * Emitted on a clean read. The policy's own `reasonCodes.text` cannot carry it,
 * because that map is typed to dispositions that withhold a post and a pass is
 * not one of them, so it lives here. It exists so a persisted result can tell
 * "screened and clean" apart from "never screened", which an empty reason list
 * cannot. Callers still decide from `disposition`, never from this list.
 */
export const TEXT_CLEAN_REASON = 'text_clean'

/**
 * Emitted when input arrived longer than its own contract allows, or when a
 * crafted caption exhausted the expansion budget before every representation was
 * generated. Either way some of the text went unscreened, so it fails closed.
 */
export const TEXT_INPUT_TRUNCATED_REASON = 'text_input_truncated'

/**
 * The forms one submission expands into, counted against the policy's
 * `maxCanonicalRepresentations`. Naming them is what makes that limit checkable
 * rather than decorative.
 */
export const CANONICAL_REPRESENTATIONS = [
  'literal',
  'folded',
  'repeat-collapsed',
  'leet-class',
  'joined',
  'joined-repeat-collapsed',
  'joined-leet-class',
] as const

export interface CommunityTextPolicy {
  readonly categories: readonly TextScreeningCategory[]
  readonly severities?: readonly TextScreeningSeverity[]
  /**
   * Partial because the policy schema builds it with `z.record`, which cannot
   * promise every key. Construction checks that all of them are present, since
   * a missing severity would otherwise look up `undefined` and quietly leave a
   * matched term publishable.
   */
  readonly severityDisposition: Partial<
    Record<TextScreeningSeverity, TextScreeningDisposition>
  >
  readonly unscreenableLocaleDisposition: TextScreeningDisposition
  readonly allDictionariesAlwaysRun: boolean
  readonly scripts: {
    readonly supported: readonly string[]
    readonly mixedScriptDisposition: TextScreeningDisposition
    readonly unsupportedScriptDisposition: TextScreeningDisposition
  }
  readonly limits: {
    /**
     * Either one ceiling for both fields or a per-field pair. Both are accepted
     * because the policy's number is an upper bound, and
     * {@link CONTRACT_FIELD_CEILINGS} is what the public contract actually
     * enforces; the smaller of the two always wins.
     */
    readonly maxInputCharacters: number | Readonly<Record<TextScreeningField, number>>
    readonly maxCanonicalRepresentations: number
    readonly maxExpandedCharacters: number
  }
  /**
   * Terms kept routed to review on purpose although ordinary copy uses them,
   * each with the reason. Construction refuses a policy whose deliberate term is
   * allow-listed or indexed by no list, so a later allow-list edit cannot
   * quietly reverse the decision.
   */
  readonly deliberateReviewTerms?: readonly {
    readonly term: string
    readonly reason: string
  }[]
  /**
   * The policy's list records. When they carry SHA-256 pins, every loaded list
   * file must hash to its pin, so an edited list cannot run under a policy
   * hash, and therefore an engine identity, that describes different lists.
   */
  readonly lists?: readonly {
    readonly language: string
    readonly termsSha256?: string
    readonly allowListSha256?: string
  }[]
}

/**
 * What `communityPostCaptionSchema` and `communityPostAltTextSchema` enforce.
 * Text longer than this is already a contract violation, so the screener bounds
 * at it and fails the submission closed rather than normalizing the overflow.
 * The spec pins both numbers against those schemas.
 */
export const CONTRACT_FIELD_CEILINGS: Readonly<Record<TextScreeningField, number>> =
  Object.freeze({ caption: 280, altText: 200 })

function resolveFieldLimits(
  configured: number | Readonly<Record<TextScreeningField, number>>
): Readonly<Record<TextScreeningField, number>> {
  const perField =
    typeof configured === 'number'
      ? { caption: configured, altText: configured }
      : configured
  return Object.freeze({
    caption: Math.min(perField.caption, CONTRACT_FIELD_CEILINGS.caption),
    altText: Math.min(perField.altText, CONTRACT_FIELD_CEILINGS.altText),
  })
}

/**
 * A structural copy of `policy-v2.json`'s `text` section, so this boundary is
 * usable and testable on its own. The spec asserts the two are identical, which
 * is what stops the default drifting away from the approved policy.
 */
export const DEFAULT_COMMUNITY_TEXT_POLICY: CommunityTextPolicy = Object.freeze({
  categories: TEXT_SCREENING_CATEGORIES,
  severities: TEXT_SCREENING_SEVERITIES,
  severityDisposition: Object.freeze({
    low: 'review',
    medium: 'review',
    high: 'block',
  } as const),
  unscreenableLocaleDisposition: 'review' as const,
  allDictionariesAlwaysRun: true,
  scripts: Object.freeze({
    supported: Object.freeze(['Latin', 'Common', 'Inherited']),
    mixedScriptDisposition: 'review' as const,
    unsupportedScriptDisposition: 'review' as const,
  }),
  limits: Object.freeze({
    maxInputCharacters: Object.freeze({ caption: 280, altText: 200 }),
    maxCanonicalRepresentations: 8,
    maxExpandedCharacters: 2048,
  }),
})

export const DEFAULT_COMMUNITY_TEXT_POLICY_VERSION = 'community-screening-policy-v2'

export interface CommunityTextScreeningInput {
  text: string | null | undefined
  field: TextScreeningField
  locale?: string | null
}

export interface CommunityTextScreeningResult {
  readonly field: TextScreeningField
  readonly declaredLocale: string | null
  /** Every language whose list ran, which is every language this screener loaded. */
  readonly screenedLanguages: readonly ScreeningLanguage[]
  readonly observedScripts: readonly string[]
  readonly disposition: TextScreeningDisposition
  readonly categories: readonly TextScreeningCategory[]
  readonly severity: TextScreeningSeverity | null
  readonly reasons: readonly string[]
  readonly policyVersion: string
  readonly listVersions: Readonly<Record<string, string>>
  /** True when a match needed a canonical representation rather than the plain token. */
  readonly obfuscated: boolean
  /** True when input was cut at its contract ceiling or at the expansion budget. */
  readonly truncated: boolean
}

export class CommunityTextScreenerConfigError extends Error {
  constructor(message: string) {
    super(`Invalid community text screening policy: ${message}`)
    this.name = 'CommunityTextScreenerConfigError'
  }
}

const provenanceSchema = z.object({
  source: z.string().trim().min(1),
  version: z.string().trim().min(1),
  licence: z.string().trim().min(1),
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  curator: z.string().trim().min(1),
  notes: z.string().trim().min(1).optional(),
})

const termEntrySchema = z.object({
  term: z.string().trim().min(1),
  category: z.enum(TEXT_SCREENING_CATEGORIES),
  severity: z.enum(TEXT_SCREENING_SEVERITIES),
})

const termsFileSchema = z.object({
  language: z.enum(SCREENING_LANGUAGES),
  listVersion: z.string().trim().min(1),
  listType: z.literal('terms'),
  provenance: provenanceSchema,
  entries: z.array(termEntrySchema).min(1),
})

const literalContextSchema = z.object({
  terms: z.array(z.string().regex(/^\p{Script=Latin}+$/u)).min(1),
  objects: z.array(z.string().regex(/^\p{L}+$/u)).min(1),
  connectors: z.array(z.string().regex(/^\p{L}+$/u)),
  maxDistance: z.number().int().min(1).max(6),
})

// Coordinator-reviewed native-sense constructions. Each marks only its exact
// target occurrence in raw contiguous words. High-term rules also require the
// reviewed declared language and reject the reviewed insult-frame grammar.
const REVIEWED_OCCURRENCE_CONSTRUCTIONS = z
  .object({
    version: z.literal(1),
    provenance: z.string().min(20),
    constructions: z
      .array(
        z
          .object({
            language: z.enum(SCREENING_LANGUAGES),
            nativeLanguages: z.array(z.enum(SCREENING_LANGUAGES)).min(1),
            target: z
              .string()
              .regex(/^\p{Script=Latin}+$/u)
              .max(40),
            phrases: z
              .array(
                z
                  .string()
                  .regex(/^\p{Script=Latin}+(?: +\p{Script=Latin}+)*$/u)
                  .max(120)
              )
              .min(1)
              .max(4096),
            reason: z.string().min(20),
            requiredDeclaredLanguages: z
              .array(z.enum(SCREENING_LANGUAGES))
              .min(1)
              .optional(),
            // A phrase listed here needs these declared languages instead of the rule's
            // own, so one target can be wider in one language than in another.
            // The phrase clears only when it starts the text or a sentence
            // (sentenceInitial) or directly follows one of these words.
            precedingWords: z
              .array(z.string().regex(/^\p{L}+$/u))
              .min(1)
              .optional(),
            sentenceInitial: z.boolean().optional(),
            // Right bound: after the phrase the whole remainder of the text must be these
            // closed tails separated by spaces and punctuation, then the end of the text.
            closedTails: z
              .array(z.string().regex(/^\p{Script=Latin}+(?: +\p{Script=Latin}+)*$/u))
              .min(1)
              .optional(),
            // Left bound: all text before the phrase must be these closed opener phrases
            // (no punctuation is read), so nothing unlisted can lead into the clearance.
            openers: z
              .array(z.string().regex(/^\p{L}+(?: \p{L}+)*$/u))
              .min(1)
              .optional(),
            // The construction does not clear when the whole field text holds any of these
            // words, whichever sentence or line they sit in.
            textForbidden: z
              .array(z.string().regex(/^\p{L}+$/u))
              .min(1)
              .optional(),
            phraseRequiredDeclaredLanguages: z
              .record(z.string(), z.array(z.enum(SCREENING_LANGUAGES)).min(1))
              .optional(),
            rejectedPrefixFrames: z
              .array(z.string().regex(/^\p{Script=Latin}+(?: +\p{Script=Latin}+)*$/u))
              .min(1)
              .optional(),
            developmentEvidence: z
              .array(
                z
                  .object({
                    phrase: z.string(),
                    source: z.string(),
                    id: z.string(),
                    baselineDisposition: z.enum(['review', 'block']),
                    reasonCode: z.literal('text_policy_match'),
                  })
                  .strict()
              )
              .optional(),
          })
          .strict()
          .refine(
            (rule) =>
              rule.nativeLanguages.includes(rule.language) &&
              (rule.requiredDeclaredLanguages ?? []).every((language) =>
                rule.nativeLanguages.includes(language)
              ) &&
              Object.entries(rule.phraseRequiredDeclaredLanguages ?? {}).every(
                ([phrase, languages]) =>
                  rule.phrases.includes(phrase) &&
                  languages.every((language) => rule.nativeLanguages.includes(language))
              ) &&
              rule.target.toLowerCase() === rule.target &&
              rule.phrases.every(
                (phrase) =>
                  phrase.split(/ +/).filter((word) => word === rule.target).length === 1
              ),
            'reviewed occurrence must bind exactly one literal target in its native grammar'
          )
      )
      .min(1),
  })
  .strict()
  .parse(reviewedOccurrenceBank).constructions

const occurrenceConstructionSchema = z
  .object({
    target: z.string().regex(/^\p{Script=Latin}+$/u),
    phrases: z.array(z.string()),
  })
  .strict()

const allowFileSchema = z.object({
  language: z.enum(SCREENING_LANGUAGES),
  listVersion: z.string().trim().min(1),
  listType: z.literal('allowList'),
  provenance: provenanceSchema,
  entries: z.array(z.string().trim().min(1)),
  // Head phrases cleared only when the declared locale resolves to this file's
  // language AND the next word is one of the enumerated complements. They reach the
  // short-token rejoin pass, which literal contexts cannot.
  scopedWords: z.array(z.string().trim().min(1)).default([]),
  // The sexual-violence family: its terms rejoin when cut into two or three words of any
  // length, a half listed in reviewHalves routes the cut to review, and a term of any
  // grade receives generated inflected forms.
  cutFamily: z
    .object({
      terms: z.array(z.string().regex(/^\p{L}+$/u)),
      reviewHalves: z.array(z.string().regex(/^\p{L}+$/u)),
      copulas: z.array(z.string().regex(/^\p{L}+$/u)).default([]),
      nameFollowers: z.array(z.string().regex(/^\p{L}+$/u)).default([]),
    })
    .default({ terms: [], reviewHalves: [], copulas: [], nameFollowers: [] }),
  // Reviewed two-word cuts of a high-severity term that stay clean, but only inside the
  // enumerated frame: the word before the pair (or the text start) and the closed phrase
  // after it must both be listed. Everything else about a cut keeps the high-severity block.
  splitFrames: z
    .array(
      z.object({
        pair: z.string().regex(/^\p{L}+ \p{L}+$/u),
        atStart: z.boolean(),
        before: z.array(z.string().regex(/^\p{L}+$/u)),
        // Closed phrases that may precede the `before` word, and closed phrases that may
        // follow the `after` phrase. The whole text outside the frame must be tiled by them.
        leads: z.array(z.string().regex(/^\p{L}+(?: \p{L}+)*$/u)).default([]),
        after: z.array(z.string().regex(/^\p{L}+(?: \p{L}+)*$/u)).min(1),
        tails: z.array(z.string().regex(/^\p{L}+(?: \p{L}+)*$/u)).default([]),
        // An ordinary pair outside its clearing frame routes to review instead of a hard
        // block when the word before it is one of these and no word of the text is forbidden.
        reviewBefore: z.array(z.string().regex(/^\p{L}+$/u)).default([]),
        reviewForbidden: z.array(z.string().regex(/^\p{L}+$/u)).default([]),
        // Violent verbs and hate nouns forbidden only within three words of the pair, and
        // hate or removal phrases forbidden anywhere in the text.
        reviewForbiddenNear: z.array(z.string().regex(/^\p{L}+$/u)).default([]),
        reviewForbiddenPhrases: z
          .array(z.string().regex(/^\p{L}+(?: \p{L}+)+$/u))
          .default([]),
      })
    )
    .default([]),
  scopedPhrases: z
    .array(
      z.object({
        phrase: z.string().trim().min(1),
        complements: z.array(z.string().regex(/^\p{L}+$/u)).min(1),
      })
    )
    .default([]),
  literalContexts: z.array(literalContextSchema).default([]),
  occurrenceConstructions: z.array(occurrenceConstructionSchema).default([]),
})

/**
 * A single-word term shorter than this collides with ordinary vocabulary in the
 * other six languages once folded, and every language runs against every
 * submission. The Turkish word for backside folds to English "got"; the
 * two-letter one folds to English "am". Both are excluded by this floor.
 */
const MIN_SINGLE_TERM_LENGTH = 4
/** The most fragments of one word that are rejoined across symbols (f*a*g*g*o*t is six). */
const MAX_CUT_FRAGMENTS = 12

/**
 * Reviewed exceptions to {@link MIN_SINGLE_TERM_LENGTH}, kept visible on purpose
 * rather than buried in a list file. `kys` and `amk` are both written
 * abbreviations with no ordinary reading in any of the seven languages once
 * folded, which is the only ground on which the floor is waived.
 */
const SHORT_TERM_EXCEPTIONS: ReadonlySet<string> = new Set(['kys', 'amk'])

/**
 * Whether a candidate too short for the floor is one of the reviewed
 * exceptions, in its own spelling or in leet-class form. The class form matters
 * because `k y 5` and `4 m k` rejoin to something that is not the abbreviation.
 * Computed on demand rather than precomputed, since the leet table is declared
 * further down this file.
 */
function isReviewedShortTerm(folded: string): boolean {
  if (SHORT_TERM_EXCEPTIONS.has(folded)) return true
  const classed = toLeetClassForm(folded)
  for (const term of SHORT_TERM_EXCEPTIONS) {
    if (toLeetClassForm(term) === classed) return true
  }
  return false
}

/**
 * The absolute cap on how many adjacent tokens are ever rejoined. The real
 * bound is the data: a window grows while what it collapses to could still be a
 * term, which is exact, because a candidate whose collapsed form is longer than
 * the longest term can never match one. A fixed window is a silent fail-open,
 * and a 12-token one hid three German terms whose spaced forms published. This
 * ceiling only stops a run of identical characters, which collapses to one
 * character however long it is, from growing the window without limit.
 */
const JOIN_WINDOW_CEILING = 64
/** RFC 5646 caps a well-formed language tag well below this. */
const MAX_LOCALE_TAG_LENGTH = 35
/** Tokens this short are the raw material of a spaced-letter form, not words. */
const JOINABLE_TOKEN_LENGTH = 2

const IGNORABLE_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu
const COMBINING_MARK_PATTERN = /\p{M}/gu
/**
 * A combining mark that survived NFKC has no precomposed letter, so it is stray. Left in place
 * it splits a token (v + U+0301 + iado), because marks are neither letters nor digits.
 */
const STRAY_MARK_PATTERN =
  /([\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}])\p{M}+/gu
/**
 * Letters drawn as emoji or tag characters that NFKC leaves alone: negative circled
 * (U+1F150 to U+1F169), negative squared (U+1F170 to U+1F189), regional indicator letters
 * (U+1F1E6 to U+1F1FF) and the tag characters (U+E0020 to U+E007E, which mirror ASCII and
 * are otherwise stripped as invisible). Circled, squared and parenthesized letters are
 * already compatibility characters. Each maps onto the Latin letter it shows.
 *
 * Two grammar bounds keep real flags clean. A run of regional indicators that is entirely
 * valid flag pairs ("🇫🇷🇩🇪") is a row of flags and reads as a break. A black flag followed by
 * the tag characters of England, Scotland or Wales (gbeng, gbsct, gbwls) and the cancel tag ("🏴󠁧󠁢󠁥󠁮󠁧󠁿") is a subdivision flag and reads as a break.
 */
const SUBDIVISION_FLAG_PATTERN =
  /\u{1F3F4}(?:\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}|\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}|\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu
const REGIONAL_RUN_PATTERN = /[\u{1F1E6}-\u{1F1FF}]+/gu
const EMOJI_LETTER_PATTERN =
  /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{E0020}-\u{E007E}]/gu

/** ISO 3166-1 alpha-2 codes plus the reserved flag codes (AC CP DG EA EU IC TA UN XK). */
export const REGIONAL_FLAG_CODES: ReadonlySet<string> = new Set(
  (
    'AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU ' +
    'FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT ' +
    'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
    'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG UM UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
  ).split(' ')
)

const regionalLetters = (run: string): string =>
  [...run]
    .map((glyph) => String.fromCharCode(97 + (glyph.codePointAt(0) as number) - 0x1f1e6))
    .join('')

/** A regional run that is entirely valid flag pairs is a row of flags and reads as a break. */
function isFlagRun(letters: string): boolean {
  if (letters.length % 2 !== 0) return false
  for (let at = 0; at < letters.length; at += 2)
    if (!REGIONAL_FLAG_CODES.has(letters.slice(at, at + 2).toUpperCase())) return false
  return true
}

/**
 * What a flag leaves behind in the literal form. A symbol, not a space: a flag spliced into a
 * word separates its halves the way a smiley does, and the cut windows rejoin across symbols.
 */
const FLAG_SEPARATOR = '\u{1F600}'
const MAX_REGIONAL_ALTERNATIVES = 256

function defaultRegionalReading(letters: string): string {
  return isFlagRun(letters) ? FLAG_SEPARATOR : letters
}

/**
 * The readings of a regional run that is not a row of flags: all letters, and the letters with
 * one or two valid flag pairs removed from anywhere in it ("🇷🇺🇸🇦🇵🇪🇩" is raped with the US flag
 * spliced in after the first letter).
 */
function regionalReadings(letters: string): string[] {
  const readings = new Set<string>([letters])
  const removeOne = (value: string): string[] => {
    const out: string[] = []
    for (let at = 0; at + 1 < value.length; at += 1)
      if (REGIONAL_FLAG_CODES.has(value.slice(at, at + 2).toUpperCase()))
        out.push(value.slice(0, at) + value.slice(at + 2))
    return out
  }
  const onces = removeOne(letters)
  for (const once of onces) readings.add(once)
  for (const once of onces) for (const twice of removeOne(once)) readings.add(twice)
  return [...readings].slice(0, 48)
}

/** A regional letter run as it stands and with a valid flag pair peeled off either edge. */
function edgeReadings(letters: string): string[] {
  const readings = new Set<string>([letters])
  const lead = REGIONAL_FLAG_CODES.has(letters.slice(0, 2).toUpperCase())
  const trail = REGIONAL_FLAG_CODES.has(letters.slice(-2).toUpperCase())
  if (lead) readings.add(letters.slice(2))
  if (trail) readings.add(letters.slice(0, -2))
  if (lead && trail && letters.length > 4) readings.add(letters.slice(2, -2))
  return [...readings]
}

const TOKEN_SPLIT_PATTERN = /[^\p{L}\p{N}]+/u
const LEET_TRIGGER_PATTERN = /[0-9!@$|+]/
const REPEAT_PATTERN = /(.)\1+/gu

/**
 * Orthographic equivalences, applied before the allow list is consulted because
 * they are how the language spells the same word, not an attempt to hide it.
 */
const LITERAL_EXPANSIONS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
]

/**
 * Letters that survive NFD because they carry no combining mark. Turkish
 * dotless i is the one that matters here; the rest keep a stray Nordic or
 * Central European spelling from reading as a different word.
 */
const FOLD_SINGLETONS: Readonly<Record<string, string>> = {
  ı: 'i',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ħ: 'h',
  ŋ: 'n',
  þ: 'th',
}

/**
 * Letters of Latin Extended-A to D, IPA and the phonetic extensions that read as a-z (ɾ ɑ ƥ ɛ
 * ɖ ƒ ɡ ɔ ƫ ...), generated from the Unicode character names (LATIN ... LETTER X WITH ...,
 * TURNED, OPEN, BARRED, SCRIPT). Letters of the screened languages (ı ø đ ð ł ħ ŋ þ) and
 * letters that decompose to a base letter plus a mark are handled elsewhere.
 */
const LATIN_EXTENDED_LOOKALIKES: Readonly<Record<string, string>> = {
  a: 'ȺɐᶏⱥⱯɑɒ',
  b: 'ƀƁƂƃɃɓᵬᶀꞖꞗ',
  c: 'ƇƈȻȼɕꜾꜿꞒꞓꞔꟄ',
  d: 'ƊƋƌȡɖɗᵭᶁᶑꟇꟈ',
  e: 'ƎƐǝɆɇɘɛᶒᶓꬳꬴⱸ',
  f: 'ƑƒʄᵮᶂꞘꞙɸ',
  g: 'ƓǤǥɠɡᵷᶃꞠꞡꞬꬶ',
  h: 'ɥɦʮʯꞍꞕꞪⱧⱨ',
  i: 'ƗɨᴉᶖꞮɩ',
  j: 'ȷɈɉɟʝꞲ',
  k: 'ƘƙʞᶄꝀꝁꝂꝃꝄꝅꞢꞣꞰⱩⱪ',
  l: 'ƚȴȽɫɬɭᶅꝈꝉꞀꞁꞎꞭꬷꬸꬹⱠⱡⱢ',
  m: 'ƜɯɰɱᵯᶆꬺⱮ',
  n: 'ƝƞȠȵɲɳᵰᶇꞐꞑꞤꞥꬻ',
  o: 'ƆƟɔɵᶗꝊꝋꝌꝍꬿⱺ',
  p: 'ƤƥᵱᵽᶈꝐꝑꝒꝓꝔꝕⱣ',
  q: 'ɋʠꝖꝗꝘꝙ',
  r: 'ɌɍɹɺɻɼɽɾɿᵲᵳᶉꞦꞧꭉꭋꭌꭨⱤⱹ',
  s: 'ȿʂᵴᶊꞨꞩꟅꟉꟊⱾ',
  t: 'ŦŧƫƬƭƮȶȾʇʈᵵꞱⱦ',
  u: 'ᶙꞸꞹꭎꭒ',
  v: 'ƲɅʋʌᶌꝞꝟⱱⱴ',
  w: 'ʍⱲⱳ',
  x: 'ᶍꭖꭗꭘꭙ',
  y: 'ƳƴɎɏʎꭚ',
  z: 'ƵƶȤȥɀʐʑᵶᶎꟆⱫⱬⱿ',
}

const LATIN_EXTENDED_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries(LATIN_EXTENDED_LOOKALIKES).flatMap(([letter, glyphs]) =>
    [...glyphs].map((glyph): [string, string] => [glyph, letter])
  )
)

/** Cyrillic and Greek letters that render as a Latin letter in most typefaces. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ғ: 'f',
  һ: 'h',
  ӏ: 'l',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  μ: 'm',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  σ: 's',
  τ: 't',
  υ: 'u',
  χ: 'x',
  γ: 'y',
  η: 'n',
  ζ: 'z',
  // Latin small capitals render as the capital of the same letter in most typefaces.
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
}

/**
 * Leetspeak collapsed onto classes rather than substitutions, and applied to
 * both the term index and the candidate token. `1` is equally an `i` and an `l`,
 * so resolving it either way loses one of `b1tch` and `s1ut`; folding `i`, `l`,
 * `1`, `!` and `|` onto one class catches both.
 *
 * The cost is that the class form is lossy, which is why it is only generated
 * for a token that actually contains a digit or symbol. Ordinary alphabetic copy
 * never reaches it, so `slit` can never be read as `slut`.
 */
const LEET_CLASSES: Readonly<Record<string, string>> = {
  '0': 'o',
  o: 'o',
  '1': 'l',
  l: 'l',
  i: 'l',
  '!': 'l',
  '|': 'l',
  '2': 'z',
  z: 'z',
  '3': 'e',
  e: 'e',
  '4': 'a',
  a: 'a',
  '@': 'a',
  '5': 's',
  s: 's',
  $: 's',
  '6': 'g',
  '9': 'g',
  g: 'g',
  '7': 't',
  t: 't',
  '+': 't',
  '8': 'b',
  b: 'b',
}

const SCRIPT_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Common', /\p{Script=Common}/u],
  ['Inherited', /\p{Script=Inherited}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u],
]

const UNKNOWN_SCRIPT = 'Unknown'

const DISPOSITION_RANK: Readonly<Record<TextScreeningDisposition, number>> = {
  pass: 0,
  review: 1,
  block: 2,
}

const SEVERITY_RANK: Readonly<Record<TextScreeningSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
}

/**
 * Case-folds and expands orthography without touching diacritics, because the
 * allow list is consulted on this form. Keeping the accent here is what lets
 * `cono`, the Spanish word for cone, be allow-listed while `coño` still screens.
 */
export function toLiteralForm(raw: string): string {
  return toLiteralFormWith(raw, defaultRegionalReading)
}

/** The literal form with each regional indicator run read by `regional` (letters, run number). */
function toLiteralFormWith(
  raw: string,
  regional: (letters: string, run: number) => string
): string {
  let runs = 0
  let value = raw
    .normalize('NFKC')
    .replace(SUBDIVISION_FLAG_PATTERN, FLAG_SEPARATOR)
    .replace(REGIONAL_RUN_PATTERN, (run) => regional(regionalLetters(run), runs++))
    .replace(EMOJI_LETTER_PATTERN, (glyph) => {
      const code = glyph.codePointAt(0) as number
      if (code >= 0xe0020) return String.fromCharCode(code - 0xe0000)
      return String.fromCharCode(97 + code - (code >= 0x1f170 ? 0x1f170 : 0x1f150))
    })
    .replace(IGNORABLE_PATTERN, '')
    .replace(STRAY_MARK_PATTERN, '$1')
    .toLowerCase()
  for (const [pattern, replacement] of LITERAL_EXPANSIONS) {
    value = value.replace(pattern, replacement)
  }
  return value
}

/** Strips diacritics and maps confusables, so the term index sees one spelling. */
export function toFoldedForm(literal: string): string {
  const stripped = literal.normalize('NFD').replace(COMBINING_MARK_PATTERN, '')
  let folded = ''
  for (const character of stripped) {
    folded +=
      FOLD_SINGLETONS[character] ??
      CONFUSABLES[character] ??
      LATIN_EXTENDED_MAP.get(character) ??
      character
  }
  return folded.normalize('NFC')
}

function collapseRepeats(value: string): string {
  return value.replace(REPEAT_PATTERN, '$1')
}

/**
 * Repeats are collapsed again after classing, because classing can create them:
 * `fr35se` has no doubled letter until `5` and `s` both class to `s`, and the
 * indexed `fresse` was collapsed to `frese` before it was classed. Without the
 * second collapse the two never met, and Story 6.2b's corpus found five such
 * leet spellings that published (`f r 3 5 s e`, `p 1 5 s e r`, `u n d r 3 5 s i n g`).
 */
function toLeetRunForm(value: string): string {
  let classed = ''
  for (const character of value) {
    classed += LEET_CLASSES[character] ?? character
  }
  return classed
}

function toLeetClassForm(value: string): string {
  return collapseRepeats(toLeetRunForm(value))
}

function tokenize(value: string): string[] {
  return value.split(TOKEN_SPLIT_PATTERN).filter(Boolean)
}

function connectedLiteralTokens(
  literal: string,
  spans: readonly RegExpMatchArray[],
  at: number,
  neighbor: number,
  joiner: 'space' | 'space-or-hyphen' = 'space'
): boolean {
  const left = spans[Math.min(at, neighbor)]
  const right = spans[Math.max(at, neighbor)]
  if (!left || !right) return false
  const gap = literal.slice((left.index ?? 0) + left[0].length, right.index)
  if (/^[\p{Zs}\t]+$/u.test(gap)) return true
  // A native hyphenated compound ("pé-de-galinha") joins the same words an ordinary
  // phrase does. Only one plain hyphen-minus counts, so every other separator
  // (dots, underscores, slashes, zero-width characters) keeps splitting a phrase.
  return joiner === 'space-or-hyphen' && gap === '-'
}

function indexScopedPhrases(
  lists: readonly {
    language: ScreeningLanguage
    scopedPhrases?: { phrase: string; complements: string[] }[]
  }[]
): ReadonlyMap<ScreeningLanguage, readonly ScopedPhrase[]> {
  const scoped = new Map<ScreeningLanguage, ScopedPhrase[]>()
  for (const list of lists) {
    for (const entry of list.scopedPhrases ?? []) {
      const tokens = tokenize(toLiteralForm(entry.phrase))
      if (tokens.length < 2)
        throw new CommunityTextScreenerConfigError(
          'a scoped allow phrase needs at least two words'
        )
      scoped.set(list.language, [
        ...(scoped.get(list.language) ?? []),
        { tokens, complements: new Set(entry.complements.map(toLiteralForm)) },
      ])
    }
  }
  return scoped
}

interface SplitFrame {
  readonly atStart: boolean
  readonly before: readonly string[]
  readonly leads: readonly (readonly string[])[]
  readonly after: readonly (readonly string[])[]
  readonly tails: readonly (readonly string[])[]
  readonly reviewBefore: readonly string[]
  readonly reviewForbidden: readonly string[]
  readonly reviewForbiddenNear: readonly string[]
  readonly reviewForbiddenPhrases: readonly (readonly string[])[]
}

/** The longest text outside a reviewed split frame that the closed-phrase tiling will consider. */
const SPLIT_FRAME_MAX_OUTSIDE_TOKENS = 64

/** Whether the tokens are exactly a concatenation of the listed phrases (empty counts). */
function tiledByPhrases(
  tokens: readonly string[],
  phrases: readonly (readonly string[])[]
): boolean {
  if (tokens.length > SPLIT_FRAME_MAX_OUTSIDE_TOKENS) return false
  const reachable = new Array<boolean>(tokens.length + 1).fill(false)
  reachable[0] = true
  for (let at = 0; at < tokens.length; at += 1) {
    if (!reachable[at]) continue
    for (const phrase of phrases) {
      if (phrase.every((word, offset) => tokens[at + offset] === word))
        reachable[at + phrase.length] = true
    }
  }
  return reachable[tokens.length] as boolean
}

/** The reviewed split-pair frames of every language, keyed by the folded pair "you pin". */
function indexSplitFrames(
  lists: readonly { splitFrames?: z.input<typeof allowFileSchema>['splitFrames'] }[]
): ReadonlyMap<string, readonly SplitFrame[]> {
  const folded = (word: string): string => toFoldedForm(toLiteralForm(word))
  const frames = new Map<string, SplitFrame[]>()
  for (const list of lists) {
    for (const frame of list.splitFrames ?? []) {
      const key = frame.pair.split(' ').map(folded).join(' ')
      frames.set(key, [
        ...(frames.get(key) ?? []),
        {
          atStart: frame.atStart,
          before: frame.before.map(folded),
          leads: (frame.leads ?? []).map((phrase) => phrase.split(' ').map(folded)),
          after: frame.after.map((phrase) => phrase.split(' ').map(folded)),
          tails: (frame.tails ?? []).map((phrase) => phrase.split(' ').map(folded)),
          reviewBefore: (frame.reviewBefore ?? []).map(folded),
          reviewForbidden: (frame.reviewForbidden ?? []).map(folded),
          reviewForbiddenNear: (frame.reviewForbiddenNear ?? []).map(folded),
          reviewForbiddenPhrases: (frame.reviewForbiddenPhrases ?? []).map((phrase) =>
            phrase.split(' ').map(folded)
          ),
        },
      ])
    }
  }
  return frames
}

/**
 * The right bound: after the phrase, every remaining character of the text is a closed
 * tail or a separator. A period, ellipsis or line break ends no clause for this check,
 * so nothing unlisted can follow the clearance.
 */
function occurrenceLookahead(closedTails: readonly string[] | undefined): string {
  if (!closedTails?.length) return ''
  const tails = [...closedTails]
    .sort((left, right) => right.length - left.length)
    .map((tail) => tail.replaceAll(' ', ' +'))
    .join('|')
  return `(?=(?:[\\s,.;:!?…()]*(?:${tails})(?![\\p{L}\\p{N}]))*[\\s,.;:!?…()]*$)`
}

/** The position a verb-led construction may start at: a sentence start or after a listed word. */
function occurrenceLookbehind(
  precedingWords: readonly string[] | undefined,
  sentenceInitial: boolean
): string {
  const alternatives = [
    ...(sentenceInitial ? ['(?<=^\\s*)', '(?<=[.!?;:\\n]\\s*)'] : []),
    ...(precedingWords?.length
      ? [`(?<=(?<![\\p{L}\\p{N}])(?:${precedingWords.join('|')}) +)`]
      : []),
  ]
  return alternatives.length ? `(?:${alternatives.join('|')})` : ''
}

/**
 * One alternation per target and scope instead of one pattern per phrase: a bank with
 * a thousand phrases would otherwise run a thousand scans on every screened text.
 */
function compileOccurrenceConstructions(
  phrases: ReturnType<typeof reviewedOccurrencePhrases>
): {
  target: string
  pattern: RegExp
  requiredDeclaredLanguages?: readonly ScreeningLanguage[]
  rejectedPrefixFrames: readonly string[]
  textForbidden: readonly string[]
  openers: readonly (readonly string[])[]
}[] {
  const groups = new Map<
    string,
    {
      target: string
      requiredDeclaredLanguages?: readonly ScreeningLanguage[]
      rejectedPrefixFrames: readonly string[]
      precedingWords?: readonly string[]
      sentenceInitial: boolean
      closedTails?: readonly string[]
      textForbidden?: readonly string[]
      openers?: readonly string[]
      phrases: string[]
    }
  >()
  for (const entry of phrases) {
    const rejectedPrefixFrames = (entry.rejectedPrefixFrames ?? []).map((frame) =>
      toLeetClassForm(toFoldedForm(toLiteralForm(frame))).replaceAll(' ', '')
    )
    const key = JSON.stringify([
      entry.target,
      entry.requiredDeclaredLanguages ?? null,
      rejectedPrefixFrames,
      entry.precedingWords ?? null,
      entry.sentenceInitial ?? false,
      entry.closedTails ?? null,
      entry.textForbidden ?? null,
      entry.openers ?? null,
    ])
    const group = groups.get(key) ?? {
      target: entry.target,
      requiredDeclaredLanguages: entry.requiredDeclaredLanguages,
      rejectedPrefixFrames,
      precedingWords: entry.precedingWords,
      sentenceInitial: entry.sentenceInitial ?? false,
      closedTails: entry.closedTails,
      textForbidden: entry.textForbidden,
      openers: entry.openers,
      phrases: [],
    }
    group.phrases.push(entry.phrase)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    target: group.target,
    requiredDeclaredLanguages: group.requiredDeclaredLanguages,
    rejectedPrefixFrames: group.rejectedPrefixFrames,
    openers: (group.openers ?? []).map((phrase) =>
      tokenize(toFoldedForm(toLiteralForm(phrase)))
    ),
    textForbidden: (group.textForbidden ?? []).map((word) =>
      collapseRepeats(toLeetClassForm(toFoldedForm(toLiteralForm(word))))
    ),
    pattern: new RegExp(
      `${occurrenceLookbehind(group.precedingWords, group.sentenceInitial)}(?<![\\p{L}\\p{N}])(?:${[
        ...group.phrases,
      ]
        .sort((left, right) => right.length - left.length)
        .map((phrase) => phrase.replaceAll(' ', ' +'))
        .join('|')})(?![\\p{L}\\p{N}])${occurrenceLookahead(group.closedTails)}`,
      'gu'
    ),
  }))
}

function reviewedOccurrencePhrases(
  lists: readonly {
    language: ScreeningLanguage
    occurrenceConstructions?: z.infer<typeof occurrenceConstructionSchema>[]
  }[]
): {
  target: string
  phrase: string
  requiredDeclaredLanguages?: readonly ScreeningLanguage[]
  rejectedPrefixFrames?: readonly string[]
  precedingWords?: readonly string[]
  sentenceInitial?: boolean
  closedTails?: readonly string[]
  textForbidden?: readonly string[]
  openers?: readonly string[]
}[] {
  const phrases: {
    target: string
    phrase: string
    requiredDeclaredLanguages?: readonly ScreeningLanguage[]
    rejectedPrefixFrames?: readonly string[]
    precedingWords?: readonly string[]
    sentenceInitial?: boolean
    closedTails?: readonly string[]
    textForbidden?: readonly string[]
    openers?: readonly string[]
  }[] = []
  const targets = new Set<string>()
  for (const list of lists) {
    for (const rule of list.occurrenceConstructions ?? []) {
      const reviewed = REVIEWED_OCCURRENCE_CONSTRUCTIONS.find(
        (entry) => entry.target === rule.target && entry.language === list.language
      )
      if (
        !reviewed ||
        rule.phrases.length !== reviewed.phrases.length ||
        !reviewed.phrases.every((phrase) => rule.phrases.includes(phrase))
      )
        throw new CommunityTextScreenerConfigError('unreviewed occurrence construction')
      if (targets.has(rule.target))
        throw new CommunityTextScreenerConfigError('duplicate occurrence construction')
      targets.add(rule.target)
      phrases.push(
        ...rule.phrases.map((phrase) => ({
          target: rule.target,
          phrase,
          requiredDeclaredLanguages:
            reviewed.phraseRequiredDeclaredLanguages?.[phrase] ??
            reviewed.requiredDeclaredLanguages,
          rejectedPrefixFrames: reviewed.rejectedPrefixFrames,
          precedingWords: reviewed.precedingWords,
          sentenceInitial: reviewed.sentenceInitial,
          closedTails: reviewed.closedTails,
          textForbidden: reviewed.textForbidden,
          openers: reviewed.openers,
        }))
      )
    }
  }
  return phrases
}

function observeScripts(literal: string): string[] {
  const observed = new Set<string>()
  for (const character of literal) {
    const match = SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(character))
    observed.add(match ? match[0] : UNKNOWN_SCRIPT)
  }
  return [...observed].sort()
}

interface TermMeta {
  readonly category: TextScreeningCategory
  readonly severity: TextScreeningSeverity
}

type RunIndex = ReadonlyMap<string, TermMeta>

function indexRun(index: Map<string, TermMeta>, form: string, meta: TermMeta): void {
  const key = collapseRepeats(form)
  const previous = index.get(key)
  if (!previous || SEVERITY_RANK[meta.severity] > SEVERITY_RANK[previous.severity])
    index.set(key, meta)
}

function matchRun(index: RunIndex, candidate: string): TermMeta | undefined {
  return index.get(collapseRepeats(candidate))
}

interface ScopedPhrase {
  readonly tokens: readonly string[]
  readonly complements: ReadonlySet<string>
}

interface PhraseEntry {
  readonly tokens: readonly string[]
  readonly collapsed: readonly string[]
  readonly leet: readonly string[]
  readonly meta: TermMeta
}

interface LanguageIndex {
  readonly language: ScreeningLanguage
  readonly listVersion: string
  readonly longestSingleTerm: number
  readonly single: ReadonlyMap<string, TermMeta>
  readonly singleCollapsed: RunIndex
  readonly singleLeet: RunIndex
  readonly phrases: readonly PhraseEntry[]
  /**
   * Each phrase's repeat-collapsed concatenation, for the re-split pass: the
   * same letters as the phrase, cut into tokens at different places.
   */
  readonly phraseConcatenations: RunIndex
  /** The same concatenations in leet-class form, for a re-split phrase written in leet. */
  readonly phraseLeetConcatenations: RunIndex
  /** Each phrase's own collapsed tokens joined by a space, which that pass skips. */
  readonly phraseForms: ReadonlySet<string>
  /** The generated plural and inflected spellings of this language's high-severity terms. */
  readonly generatedForms: readonly string[]
  /** The single-word terms the list names itself, folded. */
  readonly listedTerms: ReadonlySet<string>
  /** Generated Turkish inflections whose suffix breaks vowel harmony with their stem. */
  readonly disharmonicForms: ReadonlySet<string>
}

export interface CommunityTextScreenerOptions {
  /** Structurally `policy.text` from the loaded `policy-v2.json`. */
  readonly policy?: CommunityTextPolicy
  readonly policyVersion?: string
  /** Overridden by tests that need a deliberately malformed list directory. */
  readonly listsDirectory?: string
}

/**
 * The directory holding `<language>-v1.json` and `allow-<language>-v1.json`.
 * Two candidates because `__dirname` is `src/modules/community` under Vitest and
 * Nest's development path and `dist/src/modules/community` after a build;
 * nothing copies `policies/` into `dist`.
 */
function resolveListsDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '../../../policies/community-screening/terms-v1'),
    path.resolve(__dirname, '../../../../policies/community-screening/terms-v1'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    throw new CommunityTextScreenerConfigError(
      `term lists not found in: ${candidates.join(', ')}`
    )
  }
  return found
}

function readListFile<Parsed extends { language: ScreeningLanguage }>(
  filePath: string,
  schema: z.ZodType<Parsed>,
  language: ScreeningLanguage,
  pinnedSha256?: string
): Parsed {
  if (!fs.existsSync(filePath)) {
    throw new CommunityTextScreenerConfigError(`missing list file ${filePath}`)
  }

  const bytes = fs.readFileSync(filePath)
  if (pinnedSha256 !== undefined) {
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== pinnedSha256.toLowerCase()) {
      throw new CommunityTextScreenerConfigError(
        `${path.basename(filePath)} does not hash to the SHA-256 the policy pins`
      )
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new CommunityTextScreenerConfigError(`${filePath} is not valid JSON`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)')),
    ]
    throw new CommunityTextScreenerConfigError(`${filePath}: ${fields.join(', ')}`)
  }
  if (result.data.language !== language) {
    throw new CommunityTextScreenerConfigError(
      `${filePath} declares language ${result.data.language}`
    )
  }
  return result.data
}

/**
 * Indexes a term under its exact spelling, its repeat-collapsed form and its
 * leet-class form.
 *
 * The length floor has to apply to the collapsed key too, for the same reason it
 * applies to the term: `gook` collapses to `gok`, which is how a Turkish writer
 * spells "sky" without its umlaut, so indexing that key makes ordinary copy
 * flag. Dropping the key instead loses `gooook`, which is a silent fail-open,
 * and neither is acceptable. So a short collapsed key is allowed only when the
 * ordinary word it collides with is on an allow list, which clears the plain
 * spelling while the term still catches every stretched one, and startup fails
 * when it is not, rather than the collision being resolved silently either way.
 */
function indexSingleTerm(
  term: string,
  meta: TermMeta,
  language: ScreeningLanguage,
  allowSingles: ReadonlySet<string>,
  single: Map<string, TermMeta>,
  singleCollapsed: Map<string, TermMeta>,
  singleLeet: Map<string, TermMeta>
): void {
  // A generated inflection can meet a listed term of a lower grade (rape generates raping,
  // which the English list grades medium); the higher grade stays.
  const listed = single.get(term)
  if (!listed || SEVERITY_RANK[meta.severity] > SEVERITY_RANK[listed.severity])
    single.set(term, meta)
  const collapsed = collapseRepeats(term)
  if (
    collapsed.length < MIN_SINGLE_TERM_LENGTH &&
    !SHORT_TERM_EXCEPTIONS.has(collapsed) &&
    !allowSingles.has(collapsed)
  ) {
    throw new CommunityTextScreenerConfigError(
      `${language} has a term that collapses to under ${MIN_SINGLE_TERM_LENGTH} characters, which needs that collapsed spelling on an allow list or a reviewed exception before it can be indexed`
    )
  }
  indexRun(singleCollapsed, term, meta)
  indexRun(singleLeet, toLeetRunForm(term), meta)
}

/**
 * Explicit plural and inflected spellings of a high-severity term, generated per language
 * so that "wetbacks", "faggots" and "towelheads" meet the same term as the singular. The
 * suffixes are listed, never stemmed: a form exists only when this table produces it.
 * Final-vowel languages also swap the gender vowel. Forms are folded like the terms.
 */
const INFLECTION_SUFFIXES: Readonly<Record<ScreeningLanguage, readonly string[]>> = {
  en: ['s', 'es'],
  de: ['e', 'en', 'n', 's'],
  es: ['s', 'es'],
  pt: ['s', 'es'],
  fr: ['s', 'e', 'es'],
  it: [],
  tr: [
    'lar',
    'ler',
    'ı',
    'i',
    'u',
    'ü',
    'a',
    'e',
    'da',
    'de',
    'dan',
    'den',
    'ın',
    'in',
    'un',
    'ün',
    'ları',
    'leri',
  ],
}

/**
 * Italian plurals replace the final vowel. Gender swaps are not generated: a swapped
 * vowel spells ordinary words in the other six languages (bolero, zoccolo, fagoting).
 */
const ITALIAN_PLURALS: Readonly<Record<string, string>> = { o: 'i', a: 'e', e: 'i' }

/** Verb forms of the reviewed violent terms, listed because a general verb suffix collides. */
const VERB_FORMS: Readonly<
  Partial<Record<ScreeningLanguage, Readonly<Record<string, readonly string[]>>>>
> = {
  en: { rape: ['raped', 'raping'] },
}

/**
 * Every indexed spelling of a high-severity term, or of a sexual-violence family term of
 * any grade, with each letter in turn replaced by "?" and classed like the leet index.
 * A word censored with one symbol ("n*gger", "r_ped", "wh#re") meets its key.
 */
function buildCensorKeys(
  indexes: readonly LanguageIndex[],
  family: ReadonlySet<string>
): ReadonlyMap<string, TermMeta> {
  const keys = new Map<string, TermMeta>()
  for (const index of indexes) {
    for (const [term, meta] of index.single) {
      if (meta.severity !== 'high' && !family.has(collapseRepeats(term))) continue
      if (term.length < MIN_SINGLE_TERM_LENGTH || !/^\p{L}+$/u.test(term)) continue
      const classed = toLeetRunForm(term)
      for (let at = 0; at < classed.length; at += 1) {
        const key = `${classed.slice(0, at)}?${classed.slice(at + 1)}`
        const previous = keys.get(key)
        if (!previous || SEVERITY_RANK[meta.severity] > SEVERITY_RANK[previous.severity])
          keys.set(key, meta)
      }
    }
  }
  return keys
}

/**
 * Across plain whitespace a one- or two-letter word is a function word in most of the
 * seven languages ("put a", "via do"), so only whole words of three letters or more
 * rejoin there. Across a symbol every length rejoins, at review when a part is that short.
 */
function classifyCutGaps(
  window: readonly string[],
  plainGap: (gap: number) => boolean
): 'whole' | 'short' | 'unusable' {
  let result: 'whole' | 'short' = 'whole'
  for (let gap = 0; gap < window.length - 1; gap += 1) {
    const short =
      (window[gap] as string).length <= JOINABLE_TOKEN_LENGTH ||
      (window[gap + 1] as string).length <= JOINABLE_TOKEN_LENGTH
    if (short && plainGap(gap)) return 'unusable'
    if (short) result = 'short'
  }
  return result
}

/**
 * The words of every high-severity phrase ("te voy a violar", "kill yourself", "heil
 * hitler") with each letter in turn replaced by "?" and in leet-class form, so one censored
 * or symbol-leet word inside a phrase can be put back before the phrase windows run.
 */
function buildPhraseWordKeys(indexes: readonly LanguageIndex[]): {
  censored: ReadonlyMap<string, readonly string[]>
  leet: ReadonlyMap<string, readonly string[]>
} {
  const censored = new Map<string, string[]>()
  const leet = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, word: string): void => {
    const words = map.get(key) ?? []
    if (!words.includes(word)) map.set(key, [...words, word])
  }
  for (const index of indexes)
    for (const phrase of index.phrases) {
      if (phrase.meta.severity !== 'high') continue
      for (const word of phrase.tokens) {
        if (word.length < 3 || !/^\p{L}+$/u.test(word)) continue
        const classed = toLeetRunForm(word)
        add(leet, classed, word)
        for (let at = 0; at < classed.length; at += 1)
          add(censored, `${classed.slice(0, at)}?${classed.slice(at + 1)}`, word)
      }
    }
  return { censored, leet }
}

/** Terms of this many letters or more have their one-letter typos indexed; shorter ones collide with ordinary words. */
const TYPO_MIN_TERM_LENGTH = 8

/**
 * Every high-severity spelling of TYPO_MIN_TERM_LENGTH letters or more with one inner letter
 * deleted, or two adjacent inner letters swapped: "schwanzlutscer", "kikeriki"-safe because
 * the keys of a term never equal the term itself. Ordinary words that meet a key are cleared
 * on the allow list.
 */
function buildTypoKeys(indexes: readonly LanguageIndex[]): ReadonlyMap<string, TermMeta> {
  const keys = new Map<string, TermMeta>()
  const add = (key: string, meta: TermMeta): void => {
    const previous = keys.get(key)
    if (!previous || SEVERITY_RANK[meta.severity] > SEVERITY_RANK[previous.severity])
      keys.set(key, meta)
  }
  for (const index of indexes) {
    for (const [term, meta] of index.single) {
      if (meta.severity !== 'high' || term.length < TYPO_MIN_TERM_LENGTH) continue
      if (!/^\p{L}+$/u.test(term)) continue
      // A generated Turkish inflection whose suffix breaks vowel harmony (cifit plus ler, for
      // the back-vowel stem çıfıt) is a spelling nobody writes; one letter less is the ordinary
      // front-vowel word çiftler. Only harmonic inflections are typo-checked, except the
      // violence terms (tecavüz), whose forms are never released.
      if (
        index.disharmonicForms.has(term) &&
        !index.listedTerms.has(term) &&
        meta.category !== 'violence'
      )
        continue
      for (let at = 1; at < term.length - 1; at += 1) {
        add(`${term.slice(0, at)}${term.slice(at + 1)}`, meta)
        if (at < term.length - 2 && term[at] !== term[at + 1])
          add(`${term.slice(0, at)}${term[at + 1]}${term[at]}${term.slice(at + 2)}`, meta)
      }
    }
  }
  for (const [key] of keys)
    if (indexes.some((index) => index.single.has(key))) keys.delete(key)
  return keys
}

const EDIT_ONE_MIN_TERM_LENGTH = 6

interface EditOneTerm {
  readonly term: string
  readonly meta: TermMeta
}

/** The word with each letter removed in turn. */
function singleDeletes(word: string): string[] {
  return Array.from(
    { length: word.length },
    (_, at) => word.slice(0, at) + word.slice(at + 1)
  )
}

/** Whether two different words are one insertion, deletion, substitution or adjacent swap apart. */
function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let start = 0
  while (start < short.length && short[start] === long[start]) start += 1
  if (short.length === long.length) {
    if (a.slice(start + 1) === b.slice(start + 1)) return true
    return (
      a[start] === b[start + 1] &&
      a[start + 1] === b[start] &&
      a.slice(start + 2) === b.slice(start + 2)
    )
  }
  return short.slice(start) === long.slice(start + 1)
}

/**
 * Every high-severity single-word term of six letters or more that the lists name, and every
 * sexual-violence family term, found again with one letter added, dropped or changed, or two
 * neighbours swapped ("hurex", "axrschficker"). The index is the deletion neighbourhood: a term
 * is filed under itself and each of its deletions, a token is looked up under itself and each of
 * its deletions, and a candidate is kept only at edit distance exactly one.
 */
function buildEditOneIndex(
  indexes: readonly LanguageIndex[],
  family: ReadonlySet<string>
): ReadonlyMap<string, readonly EditOneTerm[]> {
  const keys = new Map<string, EditOneTerm[]>()
  const add = (key: string, entry: EditOneTerm): void => {
    const bucket = keys.get(key)
    if (!bucket) keys.set(key, [entry])
    else if (!bucket.some((other) => other.term === entry.term)) bucket.push(entry)
  }
  // The spellings a list names and the plural and inflected spellings generated from its
  // high-severity terms ("niggars" is one edit from the generated "niggers"). A generated
  // Turkish inflection that breaks vowel harmony is left out, as in the typo index, except
  // for violence terms.
  // Turkish is left to the listed spellings: its suffix chains put ordinary words one edit
  // from many generated forms (dikişi, one letter from the generated sikişi), and no spell
  // checker is available to sweep them. Its inflected typos stay in the typo index.
  for (const index of indexes)
    for (const term of [
      ...index.listedTerms,
      ...index.generatedForms.filter(
        (form) =>
          index.language !== 'tr' || index.single.get(form)?.category === 'violence'
      ),
    ]) {
      const meta = index.single.get(term)
      if (!meta || term.length < EDIT_ONE_MIN_TERM_LENGTH || !/^\p{L}+$/u.test(term))
        continue
      if (meta.severity !== 'high' && !family.has(collapseRepeats(term))) continue
      if (
        index.disharmonicForms.has(term) &&
        !index.listedTerms.has(term) &&
        meta.category !== 'violence'
      )
        continue
      const entry = { term, meta }
      add(term, entry)
      for (const deleted of singleDeletes(term)) add(deleted, entry)
    }
  return keys
}

/** Suffixes of INFLECTION_SUFFIXES.tr that agree with the last vowel of a stem. */
const TURKISH_HARMONIC_SUFFIXES: Readonly<Record<string, ReadonlySet<string>>> = (() => {
  const back = ['lar', 'a', 'da', 'dan', 'ları']
  const front = ['ler', 'e', 'de', 'den', 'leri']
  const sets: Record<string, string[]> = {
    a: [...back, 'ı', 'ın'],
    ı: [...back, 'ı', 'ın'],
    o: [...back, 'u', 'un'],
    u: [...back, 'u', 'un'],
    e: [...front, 'i', 'in'],
    i: [...front, 'i', 'in'],
    ö: [...front, 'ü', 'ün'],
    ü: [...front, 'ü', 'ün'],
  }
  return Object.fromEntries(
    Object.entries(sets).map(([vowel, suffixes]) => [vowel, new Set(suffixes)])
  )
})()

/**
 * Whether a generated Turkish inflection pairs its stem with a suffix of the wrong vowel
 * class: the stem's last vowel is read on the listed spelling (çıfıt ends in a back ı), not
 * on the folded one, which has lost the dotless i.
 */
function breaksVowelHarmony(listed: string, form: string, foldedTerm: string): boolean {
  const stem = toLiteralForm(listed)
  const vowel = [...stem].reverse().find((letter) => 'aıoueiöü'.includes(letter))
  const harmonic = vowel ? TURKISH_HARMONIC_SUFFIXES[vowel] : undefined
  if (!harmonic) return false
  // ı and i fold together, so a folded suffix can stand for two listed ones.
  const suffix = form.slice(foldedTerm.length)
  const spelled = INFLECTION_SUFFIXES.tr.filter(
    (candidate) => toFoldedForm(candidate) === suffix
  )
  return spelled.length > 0 && spelled.every((candidate) => !harmonic.has(candidate))
}

export function inflectedForms(term: string, language: ScreeningLanguage): string[] {
  const forms = new Set<string>(VERB_FORMS[language]?.[term] ?? [])
  const last = term.at(-1) as string
  for (const suffix of INFLECTION_SUFFIXES[language]) {
    if (!(term.endsWith('e') && suffix.startsWith('e'))) forms.add(`${term}${suffix}`)
  }
  if (language === 'it' && ITALIAN_PLURALS[last])
    forms.add(`${term.slice(0, -1)}${ITALIAN_PLURALS[last]}`)
  if (language === 'it' && !'aeiou'.includes(last)) forms.add(`${term}i`)
  if (language === 'en' && last === 'y') forms.add(`${term.slice(0, -1)}ies`)
  forms.delete(term)
  return [...forms].map((form) => toFoldedForm(toLiteralForm(form)))
}

function buildLanguageIndex(
  list: z.infer<typeof termsFileSchema>,
  policy: CommunityTextPolicy,
  allowSingles: ReadonlySet<string>,
  familyTerms: ReadonlySet<string>
): LanguageIndex {
  const single = new Map<string, TermMeta>()
  const singleCollapsed = new Map<string, TermMeta>()
  const singleLeet = new Map<string, TermMeta>()
  const phrases: PhraseEntry[] = []
  const phraseConcatenations = new Map<string, TermMeta>()
  const phraseLeetConcatenations = new Map<string, TermMeta>()
  const phraseForms = new Set<string>()
  const generatedForms = new Set<string>()
  const listedTerms = new Set<string>()
  const disharmonicForms = new Set<string>()

  for (const entry of list.entries) {
    if (!policy.categories.includes(entry.category)) {
      throw new CommunityTextScreenerConfigError(
        `${list.language} term uses category ${entry.category}, which the policy does not define`
      )
    }

    const meta: TermMeta = { category: entry.category, severity: entry.severity }
    const foldedTokens = tokenize(toFoldedForm(toLiteralForm(entry.term)))
    if (foldedTokens.length === 0) {
      throw new CommunityTextScreenerConfigError(
        `${list.language} has a term that normalizes to nothing`
      )
    }

    if (foldedTokens.length > 1) {
      const collapsedTokens = foldedTokens.map(collapseRepeats)
      phrases.push({
        tokens: foldedTokens,
        collapsed: collapsedTokens,
        leet: collapsedTokens.map(toLeetClassForm),
        meta,
      })
      indexRun(phraseConcatenations, foldedTokens.join(''), meta)
      indexRun(phraseLeetConcatenations, toLeetRunForm(foldedTokens.join('')), meta)
      phraseForms.add(collapsedTokens.join(' '))
      // A phrase also has to be findable with its spaces gone. `killyourself`
      // written as one word, or spelled out letter by letter, arrives as a
      // single reconstructed token that no window comparison can see, so the
      // concatenation is indexed as though it were a single term.
      indexSingleTerm(
        foldedTokens.join(''),
        meta,
        list.language,
        allowSingles,
        single,
        singleCollapsed,
        singleLeet
      )
      continue
    }

    const term = foldedTokens[0] as string
    listedTerms.add(term)
    if (term.length < MIN_SINGLE_TERM_LENGTH && !SHORT_TERM_EXCEPTIONS.has(term)) {
      throw new CommunityTextScreenerConfigError(
        `${list.language} has a single-word term under ${MIN_SINGLE_TERM_LENGTH} characters that is not a reviewed exception`
      )
    }
    if (
      (entry.severity === 'high' || familyTerms.has(term)) &&
      term.length >= MIN_SINGLE_TERM_LENGTH
    ) {
      // A derived form that collapses under the floor is skipped: only the reviewed root
      // spelling may be guarded by an allow-list entry, never a generated one.
      for (const form of inflectedForms(term, list.language).filter(
        (candidate) => collapseRepeats(candidate).length >= MIN_SINGLE_TERM_LENGTH
      )) {
        generatedForms.add(form)
        if (list.language === 'tr' && breaksVowelHarmony(entry.term, form, term))
          disharmonicForms.add(form)
        indexSingleTerm(
          form,
          meta,
          list.language,
          allowSingles,
          single,
          singleCollapsed,
          singleLeet
        )
      }
    }

    indexSingleTerm(
      term,
      meta,
      list.language,
      allowSingles,
      single,
      singleCollapsed,
      singleLeet
    )
  }

  return {
    language: list.language,
    listVersion: list.listVersion,
    longestSingleTerm: Math.max(0, ...[...single.keys()].map((term) => term.length)),
    single,
    singleCollapsed,
    singleLeet,
    phrases,
    phraseConcatenations,
    phraseLeetConcatenations,
    phraseForms,
    generatedForms: [...generatedForms].toSorted(),
    listedTerms,
    disharmonicForms,
  }
}

interface PhraseWindowForms {
  readonly collapsedTokens: readonly string[]
  readonly leetTokens: readonly string[]
  readonly foldedTokens: readonly string[]
  readonly carriesLeet: readonly boolean[]
  readonly allowed: readonly boolean[]
}

/**
 * Whether `phrase` matches the window starting at `start`, and if so whether it
 * needed a canonical form to do it. `null` means no match.
 */
function matchPhraseWindow(
  phrase: PhraseEntry,
  start: number,
  forms: PhraseWindowForms
): boolean | null {
  let collapsedHit = true
  let leetHit = true
  let leetPresent = false
  let exact = true
  for (let offset = 0; offset < phrase.collapsed.length; offset += 1) {
    const at = start + offset
    if (forms.allowed[at]) return null
    if (forms.collapsedTokens[at] !== phrase.collapsed[offset]) collapsedHit = false
    if (forms.leetTokens[at] !== phrase.leet[offset]) leetHit = false
    if (forms.foldedTokens[at] !== phrase.tokens[offset]) exact = false
    if (forms.carriesLeet[at]) leetPresent = true
  }
  if (collapsedHit) return !exact
  return leetHit && leetPresent ? true : null
}

interface MatchOutcome {
  readonly meta: TermMeta
  readonly obfuscated: boolean
}

/** Tracks how much expansion one call has spent against the policy budget. */
class ExpansionBudget {
  private remaining: number
  exhausted = false

  constructor(limit: number) {
    this.remaining = limit
  }

  spend(value: string): boolean {
    if (this.remaining < value.length) {
      this.exhausted = true
      return false
    }
    this.remaining -= value.length
    return true
  }
}

/** Accumulates reasons, categories and the worst disposition one call reached. */
class Verdict {
  private readonly reasons = new Set<string>()
  private readonly categories = new Set<TextScreeningCategory>()
  disposition: TextScreeningDisposition = 'pass'
  severity: TextScreeningSeverity | null = null
  obfuscated = false

  /**
   * Raises the disposition, never below `review`. The policy types every reason
   * code to a disposition that withholds the post, so a reason that fired
   * cannot leave the submission publishable however the knob it read is set.
   */
  flag(reason: string, disposition: TextScreeningDisposition): void {
    this.reasons.add(reason)
    const withheld = disposition === 'pass' ? 'review' : disposition
    if (DISPOSITION_RANK[withheld] > DISPOSITION_RANK[this.disposition]) {
      this.disposition = withheld
    }
  }

  match(outcome: MatchOutcome, disposition: TextScreeningDisposition): void {
    this.categories.add(outcome.meta.category)
    this.obfuscated = this.obfuscated || outcome.obfuscated
    if (
      this.severity === null ||
      SEVERITY_RANK[outcome.meta.severity] > SEVERITY_RANK[this.severity]
    ) {
      this.severity = outcome.meta.severity
    }
    this.flag(TEXT_POLICY_MATCH_REASON, disposition)
  }

  get sortedReasons(): string[] {
    return this.reasons.size === 0 ? [TEXT_CLEAN_REASON] : [...this.reasons].sort()
  }

  get sortedCategories(): TextScreeningCategory[] {
    return [...this.categories].sort()
  }
}

/**
 * Screens caption and alt text against all seven language lists.
 *
 * Construction reads and validates every list, so a missing file, a missing
 * provenance record or a category the policy does not define fails at startup
 * rather than at the first submission.
 */
export class CommunityTextScreener {
  private readonly policy: CommunityTextPolicy
  private readonly policyVersion: string
  private readonly indexes: readonly LanguageIndex[]
  private readonly allowSingles: ReadonlySet<string>
  private readonly allowPhrases: readonly string[][]
  private readonly scopedAllowPhrases: ReadonlyMap<
    ScreeningLanguage,
    readonly ScopedPhrase[]
  >
  /** The generated plural and inflected spellings, as language:form, for the collision pin spec. */
  generatedInflectionForms(): string[] {
    return this.indexes.flatMap((index) =>
      index.generatedForms.map((form) => `${index.language}:${form}`)
    )
  }

  /** The generated Turkish inflections whose suffix breaks vowel harmony, as language:form. */
  disharmonicInflectionForms(): string[] {
    return this.indexes.flatMap((index) =>
      [...index.disharmonicForms]
        .filter(
          (form) =>
            !index.listedTerms.has(form) &&
            index.single.get(form)?.category !== 'violence'
        )
        .map((form) => `${index.language}:${form}`)
    )
  }

  /** The generated inflections the typo index reads: high severity, harmonic, not listed. */
  typoIndexedInflectionForms(): string[] {
    return this.indexes.flatMap((index) =>
      index.generatedForms
        .filter(
          (form) =>
            index.single.get(form)?.severity === 'high' &&
            !index.listedTerms.has(form) &&
            (!index.disharmonicForms.has(form) ||
              index.single.get(form)?.category === 'violence')
        )
        .map((form) => `${index.language}:${form}`)
    )
  }

  /** The generated inflections the edit-distance-one index reads, as language:form. */
  editOneIndexedInflectionForms(): string[] {
    const indexed = new Set<string>()
    for (const bucket of this.editOneKeys.values())
      for (const { term } of bucket) indexed.add(term)
    return this.indexes.flatMap((index) =>
      index.generatedForms
        .filter((form) => indexed.has(form) && !index.listedTerms.has(form))
        .map((form) => `${index.language}:${form}`)
    )
  }

  /** The scoped phrases of the language the current screen() call declared. */
  private activeScopedPhrases: readonly ScopedPhrase[] = []
  private readonly splitFrames: ReadonlyMap<string, readonly SplitFrame[]>
  /** The sexual-violence family: repeat-collapsed terms that rejoin from short cuts. */
  private readonly cutFamilyTerms: ReadonlySet<string>
  private readonly cutFamilyReviewHalves: ReadonlySet<string>
  /** Ordinary continuations of a review half: a copula after it, or a name after "ed". */
  private readonly cutFamilyCopulas: ReadonlySet<string>
  private readonly cutFamilyNameFollowers: ReadonlySet<string>
  /** Each indexed high-severity or family form with one letter replaced by "?", in leet-class form. */
  private censorKeys: ReadonlyMap<string, TermMeta> = new Map()
  /** One inner deletion or adjacent transposition of every long high-severity spelling. */
  private typoKeys: ReadonlyMap<string, TermMeta> = new Map()
  private editOneKeys: ReadonlyMap<string, readonly EditOneTerm[]> = new Map()
  /** The words of high-severity phrases, keyed by their censored and leet spellings. */
  private phraseWordCensorKeys: ReadonlyMap<string, readonly string[]> = new Map()
  private phraseWordLeetKeys: ReadonlyMap<string, readonly string[]> = new Map()
  private readonly scopedAllowWords: ReadonlyMap<ScreeningLanguage, ReadonlySet<string>>
  /** Exact tokens cleared for the language the current screen() call declared. */
  private activeScopedWords: ReadonlySet<string> = new Set()
  private readonly literalContexts: readonly (z.infer<typeof literalContextSchema> & {
    language: ScreeningLanguage
  })[]
  private readonly occurrenceConstructions: readonly {
    target: string
    pattern: RegExp
    requiredDeclaredLanguages?: readonly ScreeningLanguage[]
    rejectedPrefixFrames: readonly string[]
    textForbidden: readonly string[]
    openers: readonly (readonly string[])[]
  }[]
  private readonly listVersions: Readonly<Record<string, string>>
  private readonly loadedLanguages: readonly ScreeningLanguage[]
  private readonly englishFilter: Filter
  private readonly englishProfane: ReadonlySet<string>
  private readonly fieldLimits: Readonly<Record<TextScreeningField, number>>
  private readonly longestTerm: number

  constructor(options: CommunityTextScreenerOptions = {}) {
    this.policy = options.policy ?? DEFAULT_COMMUNITY_TEXT_POLICY
    this.policyVersion = options.policyVersion ?? DEFAULT_COMMUNITY_TEXT_POLICY_VERSION

    const ungraded = TEXT_SCREENING_SEVERITIES.filter(
      (severity) => this.policy.severityDisposition[severity] === undefined
    )
    if (ungraded.length > 0) {
      throw new CommunityTextScreenerConfigError(
        `severityDisposition has no entry for ${ungraded.join(', ')}, so a term of that grade would have no disposition`
      )
    }
    if (!this.policy.allDictionariesAlwaysRun) {
      throw new CommunityTextScreenerConfigError(
        'allDictionariesAlwaysRun is false, which would let a declared locale bypass the other languages'
      )
    }
    if (
      CANONICAL_REPRESENTATIONS.length > this.policy.limits.maxCanonicalRepresentations
    ) {
      throw new CommunityTextScreenerConfigError(
        `this screener generates ${CANONICAL_REPRESENTATIONS.length} canonical representations, above the policy limit of ${this.policy.limits.maxCanonicalRepresentations}`
      )
    }

    this.fieldLimits = resolveFieldLimits(this.policy.limits.maxInputCharacters)

    const directory = options.listsDirectory ?? resolveListsDirectory()
    const pinFor = (language: ScreeningLanguage) =>
      this.policy.lists?.find((list) => list.language === language)
    const termLists = SCREENING_LANGUAGES.map((language) =>
      readListFile(
        path.join(directory, `${language}-v1.json`),
        termsFileSchema,
        language,
        pinFor(language)?.termsSha256
      )
    )
    const allowLists = SCREENING_LANGUAGES.map((language) =>
      readListFile(
        path.join(directory, `allow-${language}-v1.json`),
        allowFileSchema,
        language,
        pinFor(language)?.allowListSha256
      )
    )

    // Allow lists apply across languages rather than only to the file they were
    // written in, because every language's dictionary runs against every
    // submission. A word that is ordinary German copy has to survive the Italian
    // list too, so the union is the only coherent reading. They are built before
    // the term indexes because indexing consults them: a term whose collapsed
    // spelling collides with an ordinary word is only indexable once that word
    // is cleared here.
    const allowSingles = new Set<string>()
    const allowPhrases: string[][] = []
    for (const list of allowLists) {
      for (const entry of list.entries) {
        const tokens = tokenize(toLiteralForm(entry))
        if (tokens.length === 0) continue
        if (tokens.length === 1) {
          allowSingles.add(tokens[0] as string)
        } else {
          allowPhrases.push(tokens)
        }
      }
    }
    this.allowSingles = allowSingles
    this.allowPhrases = allowPhrases
    this.scopedAllowPhrases = indexScopedPhrases(allowLists)
    this.splitFrames = indexSplitFrames(allowLists)
    this.scopedAllowWords = new Map(
      allowLists.map((list) => [
        list.language,
        new Set((list.scopedWords ?? []).map(toLiteralForm)),
      ])
    )
    if (
      allowLists.some((list) =>
        list.entries.some((entry) =>
          tokenize(toLeetRunForm(toFoldedForm(toLiteralForm(entry)))).some((token) =>
            REVIEWED_OCCURRENCE_CONSTRUCTIONS.some(
              (entry) =>
                collapseRepeats(token) === toLeetClassForm(toFoldedForm(entry.target))
            )
          )
        )
      )
    )
      throw new CommunityTextScreenerConfigError(
        'reviewed occurrence target cannot be globally allow-listed'
      )
    this.literalContexts = allowLists.flatMap((list) =>
      (list.literalContexts ?? []).map((context) => ({
        ...context,
        language: list.language,
      }))
    )
    this.occurrenceConstructions = compileOccurrenceConstructions(
      reviewedOccurrencePhrases(allowLists)
    )

    const familyForms = allowLists.flatMap((list) =>
      (list.cutFamily?.terms ?? []).map((term) => toFoldedForm(toLiteralForm(term)))
    )
    this.cutFamilyTerms = new Set(familyForms.map(collapseRepeats))
    this.cutFamilyReviewHalves = new Set(
      allowLists.flatMap((list) =>
        (list.cutFamily?.reviewHalves ?? []).map((word) =>
          toFoldedForm(toLiteralForm(word))
        )
      )
    )
    const foldedWords = (
      pick: (list: (typeof allowLists)[number]) => string[] | undefined
    ) =>
      new Set(
        allowLists.flatMap((list) =>
          (pick(list) ?? []).map((word) => toFoldedForm(toLiteralForm(word)))
        )
      )
    this.cutFamilyCopulas = foldedWords((list) => list.cutFamily?.copulas)
    this.cutFamilyNameFollowers = foldedWords((list) => list.cutFamily?.nameFollowers)
    // A term whose collapsed spelling is only three letters is indexable once an ordinary
    // word of that spelling is cleared, globally or under a declared language ("gok", the
    // Turkish sky, against the English slur gook).
    const indexable = new Set([
      ...allowSingles,
      ...[...this.scopedAllowWords.values()].flatMap((words) => [...words]),
    ])
    this.indexes = termLists.map((list) =>
      buildLanguageIndex(list, this.policy, indexable, new Set(familyForms))
    )
    this.censorKeys = buildCensorKeys(this.indexes, this.cutFamilyTerms)
    this.typoKeys = buildTypoKeys(this.indexes)
    this.editOneKeys = buildEditOneIndex(this.indexes, this.cutFamilyTerms)
    const phraseWords = buildPhraseWordKeys(this.indexes)
    this.phraseWordCensorKeys = phraseWords.censored
    this.phraseWordLeetKeys = phraseWords.leet
    for (const term of this.cutFamilyTerms) {
      if (!this.indexes.some((index) => index.singleCollapsed.has(term)))
        throw new CommunityTextScreenerConfigError(
          `cut family term ${term} is not a listed term of any language`
        )
    }
    this.assertDeliberateReviewTerms()
    this.assertContextTargets()
    this.longestTerm = Math.max(
      MIN_SINGLE_TERM_LENGTH,
      ...this.indexes.map((index) => index.longestSingleTerm)
    )
    this.loadedLanguages = Object.freeze(this.indexes.map((index) => index.language))
    this.listVersions = Object.freeze(
      Object.fromEntries(termLists.map((list) => [list.language, list.listVersion]))
    )

    // ADR-013 names a profanity filter, and `bad-words` is it. Its vocabulary is
    // English-only and was never reviewed against fashion copy, so it runs after
    // the repository lists as a low-severity backstop that routes to a human
    // rather than as a blocking authority, and the repository allow list is
    // removed from it so our own decisions win.
    this.englishFilter = new Filter()
    const allowed = [...allowSingles]
    if (allowed.length > 0) {
      this.englishFilter.removeWords(...allowed)
    }
    // The filter builds one regular expression per list word on every call and tests each
    // word against the whole allow list first, so its cost grows with both lists. For a token
    // of plain word characters the two reduce to set membership, which is what this holds.
    const excluded = new Set(this.englishFilter.exclude)
    this.englishProfane = new Set(
      this.englishFilter.list
        .map((word) => word.toLowerCase())
        .filter((word) => /^\w+$/.test(word) && !excluded.has(word))
    )
  }

  /** Whether the English backstop list holds the token, as `bad-words` would answer. */
  private isEnglishProfane(token: string): boolean {
    return /^\w+$/.test(token)
      ? this.englishProfane.has(token)
      : this.englishFilter.isProfane(token)
  }

  private assertDeliberateReviewTerms(): void {
    for (const entry of this.policy.deliberateReviewTerms ?? []) {
      const literal = toLiteralForm(entry.term)
      if (
        this.allowSingles.has(literal) ||
        this.literalContexts.some((context) => context.terms.includes(literal))
      ) {
        throw new CommunityTextScreenerConfigError(
          'a deliberate review term is allow-listed, which would silently reverse the policy decision'
        )
      }
      const folded = toFoldedForm(literal)
      if (!this.indexes.some((index) => index.single.has(folded))) {
        throw new CommunityTextScreenerConfigError(
          'a deliberate review term is indexed by no list, so it would not route to review'
        )
      }
    }
  }

  private assertContextTargets(): void {
    for (const context of this.literalContexts) {
      for (const term of context.terms) {
        const folded = toFoldedForm(toLiteralForm(term))
        if (
          this.worstAcross((index) => matchRun(index.singleCollapsed, folded))
            ?.severity === 'high'
        )
          throw new CommunityTextScreenerConfigError(
            'generic context targets a high-severity term'
          )
      }
    }
  }

  /** Every language whose list is loaded, which is every language that runs. */
  get screenedLanguages(): readonly ScreeningLanguage[] {
    return this.loadedLanguages
  }

  screen(input: CommunityTextScreeningInput): CommunityTextScreeningResult {
    const declaredLocale = boundLocaleTag(input.locale)
    const verdict = new Verdict()

    if (declaredLocale && this.resolveLanguage(declaredLocale) === null) {
      verdict.flag(LOCALE_UNSCREENABLE_REASON, this.policy.unscreenableLocaleDisposition)
    }

    const declaredLanguage = this.resolveLanguage(declaredLocale)
    this.activeScopedWords = declaredLanguage
      ? (this.scopedAllowWords.get(declaredLanguage) ?? new Set())
      : new Set()
    this.activeScopedPhrases = declaredLanguage
      ? (this.scopedAllowPhrases.get(declaredLanguage) ?? [])
      : []
    try {
      return this.screenWithVerdict(input, declaredLocale, verdict)
    } finally {
      this.activeScopedPhrases = []
      this.activeScopedWords = new Set()
    }
  }

  private screenWithVerdict(
    input: CommunityTextScreeningInput,
    declaredLocale: string | null,
    verdict: Verdict
  ): CommunityTextScreeningResult {
    const limit = this.fieldLimits[input.field]
    const raw = input.text ?? ''
    const overLength = raw.length > limit
    const boundedRaw = overLength ? trimToLimit(raw, limit) : raw
    const literal = toLiteralForm(boundedRaw)

    const observedScripts = observeScripts(literal)
    this.applyScriptPolicy(observedScripts, verdict)

    const budget = new ExpansionBudget(this.policy.limits.maxExpandedCharacters)
    const { literalTokens, foldedTokens } = this.foldTokens(literal, budget)
    // Two allowances, kept apart. A single allow-listed word clears that word
    // as a term on its own; an allow-listed phrase clears the words it covers.
    // Multi-word terms honour only the second. Story 6.2b found that one array
    // for both let an ordinary word disable every phrase it appears in: clearing
    // `concha` (a shell) also cleared `concha de tu madre`.
    const phraseAllowed = literalTokens.map(() => false)
    this.markAllowedPhrases(literal, literalTokens, phraseAllowed)
    const allowed = literalTokens.map(
      (token, index) =>
        this.allowSingles.has(token) ||
        this.activeScopedWords.has(token) ||
        (phraseAllowed[index] as boolean)
    )
    this.markLiteralContexts(literal, literalTokens, allowed, declaredLocale)
    this.markOccurrenceConstructions(boundedRaw, literalTokens, allowed, declaredLocale)

    for (const outcome of this.collectMatches(
      literal,
      literalTokens,
      foldedTokens,
      { allowed, phraseAllowed },
      budget
    )) {
      verdict.match(outcome, this.dispositionFor(outcome.meta.severity))
    }

    // Alternative readings of the text, run through the same passes with no allowances:
    // a regional-letter spelling with a valid flag removed, and one obfuscated phrase word put back.
    for (const alternative of [
      ...this.regionalAlternatives(boundedRaw),
      ...this.restorePhraseWords(literal),
    ]) {
      const tokens = this.foldTokens(alternative, budget)
      const none = tokens.literalTokens.map(() => false)
      for (const outcome of this.collectMatches(
        alternative,
        tokens.literalTokens,
        tokens.foldedTokens,
        { allowed: none, phraseAllowed: none },
        budget
      ))
        verdict.match(outcome, this.dispositionFor(outcome.meta.severity))
    }

    const truncated = overLength || budget.exhausted
    if (truncated) {
      verdict.flag(TEXT_INPUT_TRUNCATED_REASON, this.policy.unscreenableLocaleDisposition)
    }

    return {
      field: input.field,
      declaredLocale,
      screenedLanguages: this.loadedLanguages,
      observedScripts,
      disposition: verdict.disposition,
      categories: verdict.sortedCategories,
      severity: verdict.severity,
      reasons: verdict.sortedReasons,
      policyVersion: this.policyVersion,
      listVersions: this.listVersions,
      obfuscated: verdict.obfuscated,
      truncated,
    }
  }

  /** Safe because construction rejects a policy missing any severity. */
  private dispositionFor(severity: TextScreeningSeverity): TextScreeningDisposition {
    return this.policy.severityDisposition[severity] as TextScreeningDisposition
  }

  private applyScriptPolicy(observedScripts: string[], verdict: Verdict): void {
    const unsupported = observedScripts.filter(
      (script) => !this.policy.scripts.supported.includes(script)
    )
    if (unsupported.length === 0) return
    if (observedScripts.includes('Latin')) {
      verdict.flag(SCRIPT_MIXED_REASON, this.policy.scripts.mixedScriptDisposition)
      return
    }
    verdict.flag(
      SCRIPT_UNSUPPORTED_REASON,
      this.policy.scripts.unsupportedScriptDisposition
    )
  }

  /** Folds each token until the budget runs out, keeping both arrays aligned. */
  private foldTokens(
    literal: string,
    budget: ExpansionBudget
  ): { literalTokens: string[]; foldedTokens: string[] } {
    const literalTokens = tokenize(literal)
    const foldedTokens: string[] = []
    for (const token of literalTokens) {
      const folded = toFoldedForm(token)
      if (!budget.spend(folded)) break
      foldedTokens.push(folded)
    }
    literalTokens.length = foldedTokens.length
    return { literalTokens, foldedTokens }
  }

  /**
   * The language this screener would screen `locale` in, or `null` when it holds
   * no list for it. Callers use it only to report an unscreenable locale; it
   * never narrows which lists run.
   */
  resolveLanguage(locale: string | null | undefined): ScreeningLanguage | null {
    if (!locale) return null
    const normalized = locale.trim().replaceAll('_', '-').toLowerCase()
    const canonicalTag = supportedLocales.find((tag) => tag.toLowerCase() === normalized)
    const mapped = canonicalTag
      ? LOCALE_SCREENING_LANGUAGES[canonicalTag]
      : normalized.split('-')[0]
    return SCREENING_LANGUAGES.find((candidate) => candidate === mapped) ?? null
  }

  /**
   * Phrase allowances clear the words they cover only when the phrase is contiguous in the
   * literal text: adjacent words are separated by plain spaces (a Portuguese native compound
   * may also use one hyphen, in the scoped phrases only). A full stop, newline, emoji or any
   * other separator between the words is a boundary, so an allowed tail appended to a
   * reviewable word ("you are a dick. und weich") cannot clear it.
   */
  private markAllowedPhrases(
    literal: string,
    literalTokens: string[],
    allowed: boolean[]
  ): void {
    const spans = [...literal.matchAll(/[\p{L}\p{N}]+/gu)]
    const contiguous = (
      start: number,
      length: number,
      joiner: 'space' | 'space-or-hyphen'
    ): boolean =>
      Array.from({ length: length - 1 }, (_, offset) =>
        connectedLiteralTokens(literal, spans, start + offset, start + offset + 1, joiner)
      ).every(Boolean)
    for (const scoped of this.activeScopedPhrases) {
      const { tokens: head, complements } = scoped
      for (let start = 0; start + head.length < literalTokens.length; start += 1) {
        if (!head.every((token, offset) => literalTokens[start + offset] === token))
          continue
        if (!complements.has(literalTokens[start + head.length] as string)) continue
        if (!contiguous(start, head.length + 1, 'space-or-hyphen')) continue
        for (let offset = 0; offset < head.length; offset += 1)
          allowed[start + offset] = true
      }
    }
    for (const phrase of this.allowPhrases) {
      for (let start = 0; start + phrase.length <= literalTokens.length; start += 1) {
        const matches = phrase.every(
          (token, offset) => literalTokens[start + offset] === token
        )
        if (!matches || !contiguous(start, phrase.length, 'space')) continue
        for (let offset = 0; offset < phrase.length; offset += 1) {
          allowed[start + offset] = true
        }
      }
    }
  }

  /** Clear only an exact ordinary homograph within a bounded literal clause.
   * Object and connector tokens remain screened, as do all multi-word terms.
   */
  private markLiteralContexts(
    literal: string,
    tokens: readonly string[],
    allowed: boolean[],
    declaredLocale: string | null
  ): void {
    const language = this.resolveLanguage(declaredLocale)
    if (!language) return
    const spans = [...literal.matchAll(/[\p{L}\p{N}]+/gu)]
    for (let position = 0; position < tokens.length; position++) {
      for (const context of this.literalContexts) {
        if (context.language !== language) continue
        if (!context.terms.includes(tokens[position] as string)) continue
        for (const direction of [-1, 1]) {
          for (let distance = 1; distance <= context.maxDistance; distance++) {
            const at = position + direction * distance
            const token = tokens[at]
            if (token === undefined) break
            if (!connectedLiteralTokens(literal, spans, at, at - direction)) break
            if (context.objects.includes(token)) {
              // A preceding object needs an assembly connector ("fibbia da
              // montare"); a bare verb after a noun is not that construction.
              if (direction === 1 || distance > 1) allowed[position] = true
              break
            }
            if (!context.connectors.includes(token)) break
          }
        }
      }
    }
  }

  /**
   * Whether the whole field text holds one of the forbidden words, in any spelling the
   * folds merge, also when letters are spaced or separated ("crian ça"). Words of six
   * letters or more are looked for in the text with every separator removed.
   */
  private textHoldsForbidden(exact: string, forbidden: readonly string[]): boolean {
    const words = tokenize(toFoldedForm(toLiteralForm(exact)))
    if (words.some((word) => forbidden.includes(collapseRepeats(toLeetClassForm(word)))))
      return true
    const squashed = collapseRepeats(toLeetClassForm(words.join('')))
    return forbidden.some((word) => word.length >= 6 && squashed.includes(word))
  }

  private markOccurrenceConstructions(
    raw: string,
    tokens: readonly string[],
    allowed: boolean[],
    declaredLocale?: string | null
  ): void {
    const exact = raw.toLowerCase()
    const language = this.resolveLanguage(declaredLocale)
    for (const construction of this.occurrenceConstructions) {
      if (
        construction.requiredDeclaredLanguages &&
        (!language || !construction.requiredDeclaredLanguages.includes(language))
      )
        continue
      for (const match of exact.matchAll(construction.pattern)) {
        const prefix = exact.slice(0, match.index)
        // Screening folds may only remove an exception here. The construction
        // itself still requires exact raw spelling and ordinary spaces.
        const prefixWords = tokenize(toLeetRunForm(toFoldedForm(toLiteralForm(prefix))))
        let frame = ''
        let rejected = false
        for (const word of prefixWords.slice(-32).toReversed()) {
          frame = collapseRepeats(word + frame)
          if (construction.rejectedPrefixFrames.includes(frame)) {
            rejected = true
            break
          }
          if (frame.length > 32) break
        }
        if (rejected) continue
        if (
          construction.openers.length > 0 &&
          !tiledByPhrases(
            tokenize(toFoldedForm(toLiteralForm(prefix))),
            construction.openers
          )
        )
          continue
        if (
          construction.textForbidden.length > 0 &&
          this.textHoldsForbidden(exact, construction.textForbidden)
        )
          continue
        const words = match[0].split(/ +/)
        const at = tokenize(toLiteralForm(prefix)).length
        if (!words.every((word, index) => tokens[at + index] === word)) continue
        allowed[at + words.indexOf(construction.target)] = true
      }
    }
  }

  private collectMatches(
    literal: string,
    literalTokens: readonly string[],
    foldedTokens: readonly string[],
    allowances: { allowed: readonly boolean[]; phraseAllowed: readonly boolean[] },
    budget: ExpansionBudget
  ): MatchOutcome[] {
    const { allowed, phraseAllowed } = allowances
    const outcomes: MatchOutcome[] = []

    for (let position = 0; position < foldedTokens.length; position += 1) {
      if (allowed[position]) continue
      const folded = foldedTokens[position] as string
      const literal = literalTokens[position] as string
      const outcome = this.matchCandidate(
        folded,
        LEET_TRIGGER_PATTERN.test(literal),
        budget
      )
      if (outcome) {
        outcomes.push(outcome)
        continue
      }
      if (folded.length >= MIN_SINGLE_TERM_LENGTH && this.isEnglishProfane(folded)) {
        outcomes.push({
          meta: { category: 'profanity', severity: 'low' },
          obfuscated: false,
        })
      }
    }

    outcomes.push(
      ...this.collectPhraseMatches(literalTokens, foldedTokens, phraseAllowed)
    )
    outcomes.push(
      ...this.collectResplitPhraseMatches(foldedTokens, phraseAllowed, literalTokens)
    )
    outcomes.push(
      ...this.collectSplitHighTermMatches(literal, foldedTokens, literalTokens, allowed)
    )
    outcomes.push(...this.collectFamilyCutMatches(foldedTokens))

    for (const candidate of this.buildSymbolLeetCandidates(literal, budget)) {
      const outcome = this.matchCandidate(toFoldedForm(candidate), true, budget)
      if (outcome) outcomes.push({ meta: outcome.meta, obfuscated: true })
    }

    outcomes.push(...this.collectCensoredMatches(literal, budget))
    outcomes.push(...this.collectTypoMatches(foldedTokens, allowed))

    for (const candidate of this.buildJoinCandidates(literal, literalTokens, budget)) {
      const outcome = this.matchCandidate(
        toFoldedForm(candidate),
        LEET_TRIGGER_PATTERN.test(candidate),
        budget
      )
      if (outcome) outcomes.push({ meta: outcome.meta, obfuscated: true })
    }

    return outcomes
  }

  /**
   * Multi-word terms, matched over a window of adjacent tokens in
   * repeat-collapsed form and, when the text actually carries a digit or
   * symbol, in leet-class form too.
   *
   * A phrase written with its spaces removed, or spelled out letter by letter,
   * never reaches here: it arrives as one reconstructed token, which is why the
   * concatenation is indexed as a single term as well.
   */
  private collectPhraseMatches(
    literalTokens: readonly string[],
    foldedTokens: readonly string[],
    allowed: readonly boolean[]
  ): MatchOutcome[] {
    const outcomes: MatchOutcome[] = []
    const collapsedTokens = foldedTokens.map(collapseRepeats)
    const leetTokens = collapsedTokens.map(toLeetClassForm)
    const carriesLeet = literalTokens.map((token) => LEET_TRIGGER_PATTERN.test(token))

    for (const index of this.indexes) {
      for (const phrase of index.phrases) {
        const width = phrase.collapsed.length
        for (let start = 0; start + width <= collapsedTokens.length; start += 1) {
          const hit = matchPhraseWindow(phrase, start, {
            collapsedTokens,
            leetTokens,
            foldedTokens,
            carriesLeet,
            allowed,
          })
          if (hit !== null) outcomes.push({ meta: phrase.meta, obfuscated: hit })
        }
      }
    }
    return outcomes
  }

  /**
   * A high-severity single-word term cut in two ("tap ete") rejoins to the term. Two
   * ordinary words that happen to spell a single-word term stay unflagged for lower
   * severities, which is why the single-term passes never rejoin whole tokens; the
   * hate, violence and self-harm tier is the exception, because a cut there is the
   * cheapest disguise and the same two-way cut of a medium term only routes to review.
   */
  private collectSplitHighTermMatches(
    literal: string,
    foldedTokens: readonly string[],
    literalTokens: readonly string[],
    allowed: readonly boolean[]
  ): MatchOutcome[] {
    const outcomes: MatchOutcome[] = []
    // An ordinary word the lists clear as a term on its own ("con") must not shield a
    // cut of a high-severity term ("mari con"); only phrase and construction clearances do.
    const cleared = (position: number): boolean =>
      (allowed[position] as boolean) &&
      !this.allowSingles.has(literalTokens[position] as string)
    const spans = [...literal.matchAll(/[\p{L}\p{N}]+/gu)]
    const aligned = spans.length === foldedTokens.length
    // A gap of plain whitespace is a word break; anything else (a hyphen, dot, slash,
    // asterisk, comma ...) inside a would-be word is a disguise.
    const plainGap = (at: number): boolean => {
      if (!aligned) return true
      const left = spans[at] as RegExpMatchArray
      const right = spans[at + 1] as RegExpMatchArray
      return /^[\p{Zs}\t\r\n]+$/u.test(
        literal.slice((left.index ?? 0) + left[0].length, right.index)
      )
    }
    for (let start = 0; start + 1 < foldedTokens.length; start += 1) {
      if (cleared(start)) continue
      // A chain of fragments of any length rejoins (f*a*g*got). Everything that rules a window
      // out is monotonic in its size, so the first window that cannot grow ends the chain.
      for (
        let size = 2;
        size <= MAX_CUT_FRAGMENTS && start + size <= foldedTokens.length;
        size += 1
      ) {
        const window = foldedTokens.slice(start, start + size)
        if (cleared(start + size - 1)) break
        const gaps = classifyCutGaps(window, (gap) => plainGap(start + gap))
        if (gaps === 'unusable') break
        const shortPart = gaps === 'short'
        const joined = window.join('')
        if (collapseRepeats(joined).length > this.longestTerm) break
        if (joined.length < MIN_SINGLE_TERM_LENGTH) continue
        // A cut of a hate or sexual term never passes on its own. Only a reviewed fashion
        // pair inside its enumerated frame ("then you pin the hem") is left alone.
        if (size === 2 && this.inReviewedSplitFrame(foldedTokens, start)) continue
        const meta = this.worstAcross((index) => matchRun(index.singleCollapsed, joined))
        if (meta?.severity !== 'high') continue
        // Two ordinary words with an open frame are withheld for review, not hard-blocked;
        // a slur-leading frame or a cut with a non-ordinary half keeps the block.
        outcomes.push({
          meta:
            shortPart || (size === 2 && this.isOrdinaryOpenSplit(foldedTokens, start))
              ? { ...meta, severity: 'medium' }
              : meta,
          obfuscated: true,
        })
      }
    }
    return outcomes
  }

  /**
   * "El rap es genial", "il rap e musica", "Der Rap ist laut" and "rap Ed Hardy tee" are
   * ordinary copy: the review half "rap", then a copula with a word after it, or "ed" with
   * a listed surname after it.
   */
  private isOrdinaryFamilyContinuation(
    foldedTokens: readonly string[],
    start: number,
    size: number
  ): boolean {
    if (size !== 2 || !this.cutFamilyReviewHalves.has(foldedTokens[start] as string))
      return false
    const second = foldedTokens[start + 1] as string
    const next = foldedTokens[start + 2]
    if (next === undefined) return false
    return (
      this.cutFamilyCopulas.has(second) ||
      (second === 'ed' && this.cutFamilyNameFollowers.has(next))
    )
  }

  /**
   * A term of the sexual-violence family cut into two or three words of any length
   * ("ra ped", "rap ed", "sa-ed her") rejoins at the term's own grade. The ordinary
   * word "rap" as a half downgrades the cut to review.
   */
  private collectFamilyCutMatches(foldedTokens: readonly string[]): MatchOutcome[] {
    if (this.cutFamilyTerms.size === 0) return []
    const outcomes: MatchOutcome[] = []
    for (let start = 0; start < foldedTokens.length; start += 1) {
      for (
        let size = 2;
        size <= MAX_CUT_FRAGMENTS && start + size <= foldedTokens.length;
        size += 1
      ) {
        const window = foldedTokens.slice(start, start + size)
        const joined = window.join('')
        if (collapseRepeats(joined).length > this.longestTerm) break
        if (!this.cutFamilyTerms.has(collapseRepeats(joined))) continue
        if (this.isOrdinaryFamilyContinuation(foldedTokens, start, size)) continue
        const meta = this.worstAcross((index) => matchRun(index.singleCollapsed, joined))
        if (!meta) continue
        outcomes.push({
          meta: window.some((word) => this.cutFamilyReviewHalves.has(word))
            ? { ...meta, severity: 'medium' }
            : meta,
          obfuscated: true,
        })
      }
    }
    return outcomes
  }

  /** A long high-severity term with one inner letter missing or two swapped ("arschficer"). */
  private collectTypoMatches(
    foldedTokens: readonly string[],
    allowed: readonly boolean[]
  ): MatchOutcome[] {
    const outcomes: MatchOutcome[] = []
    for (const [at, token] of foldedTokens.entries()) {
      if (allowed[at]) continue
      if (token.length >= TYPO_MIN_TERM_LENGTH - 1) {
        const meta = this.typoKeys.get(token)
        if (meta) outcomes.push({ meta, obfuscated: true })
      }
      const near = this.editOneMatch(token)
      if (near) outcomes.push(near)
    }
    return outcomes
  }

  /**
   * A token one edit from a listed high-severity or sexual-violence term of six letters or
   * more. A real word that sits one edit from a term is cleared by an allow entry; any other
   * is withheld for review, the grade of a spelling that may be an ordinary word.
   */
  private editOneMatch(token: string): MatchOutcome | null {
    if (
      token.length < EDIT_ONE_MIN_TERM_LENGTH - 1 ||
      token.length > this.longestTerm + 1
    )
      return null
    // A listed spelling is matched as itself, whatever other term sits one edit from it.
    if (this.indexes.some((index) => index.single.has(token))) return null
    for (const key of [token, ...singleDeletes(token)])
      for (const { term, meta } of this.editOneKeys.get(key) ?? [])
        if (isEditDistanceOne(token, term))
          return { meta: { ...meta, severity: 'medium' }, obfuscated: true }
    return null
  }

  /**
   * The other literal readings of regional indicator runs that are not rows of flags: with one
   * or two valid flags removed from anywhere in the run. A real flag spliced into a spelling
   * (or standing beside it) therefore does not hide the word. Capped at 16 texts.
   */
  private regionalAlternatives(raw: string): string[] {
    const runs = [...raw.normalize('NFKC').matchAll(REGIONAL_RUN_PATTERN)].map((run) =>
      regionalLetters(run[0])
    )
    // A text whose regional runs are all rows of flags ("Paris 🇫🇷 Berlin 🇩🇪") has nothing to
    // peel: building alternatives for it would spend the work budget on clean captions.
    if (runs.every((letters) => isFlagRun(letters))) return []
    // A run read as its own word may also stand apart from Latin letters written against it.
    const options = runs.map((letters) =>
      isFlagRun(letters)
        ? [FLAG_SEPARATOR]
        : [
            ...regionalReadings(letters).flatMap((reading) => [reading, ` ${reading} `]),
            FLAG_SEPARATOR,
          ]
    )
    // One run read differently at a time, then every run with a flag peeled off either edge
    // (a flag glued to a word of a phrase), so a flag touching a term does not shield it.
    const readings: string[][] = []
    const base = options.map(() => 0)
    options.forEach((choices, run) => {
      for (let at = 1; at < choices.length; at += 1)
        readings.push(base.map((_, i) => (i === run ? at : 0)).map(String))
    })
    const edges = runs.map((letters) =>
      isFlagRun(letters) ? [FLAG_SEPARATOR] : [...edgeReadings(letters), FLAG_SEPARATOR]
    )
    let edgeCombos: string[][] = [[]]
    for (const choices of edges)
      edgeCombos = edgeCombos
        .flatMap((combo) => choices.map((choice) => [...combo, choice]))
        .slice(0, MAX_REGIONAL_ALTERNATIVES)
    const chosen = readings.map((combo) =>
      toLiteralFormWith(
        raw,
        (_letters, run) => (options[run] as string[])[Number(combo[run])] as string
      )
    )
    const peeled = edgeCombos.map((combo) =>
      toLiteralFormWith(raw, (letters, run) =>
        isFlagRun(letters) ? FLAG_SEPARATOR : (combo[run] as string)
      )
    )
    return [...chosen, ...peeled].slice(0, MAX_REGIONAL_ALTERNATIVES)
  }

  /**
   * One word of a high-severity phrase written censored ("v*olar") or with a leet symbol
   * ("viol@r") is put back, so the phrase windows can see "te voy a violar". Returns the
   * rewritten text, or null when no word was restored.
   */
  private restorePhraseWords(literal: string): string[] {
    if (this.phraseWordCensorKeys.size === 0) return []
    // Each obfuscated chunk may restore to several phrase words ("?ang" is gang or hang),
    // so the texts are the combinations, capped.
    let texts: string[] = ['']
    let changed = false
    let cursor = 0
    for (const chunk of literal.matchAll(/\S+/gu)) {
      const raw = chunk[0]
      const core = raw.replace(/^[^\p{L}\p{N}*_#@$!|+]+|[^\p{L}\p{N}*_#@$!|+]+$/gu, '')
      let words: readonly string[] | undefined
      if (core.length >= 3) {
        if (/^[\p{L}\p{N}]*[*_#.-][\p{L}\p{N}]*$/u.test(core)) {
          const at = core.search(/[*_#.-]/u)
          words = this.phraseWordCensorKeys.get(
            toLeetRunForm(toFoldedForm(`${core.slice(0, at)}?${core.slice(at + 1)}`))
          )
        } else if (/[@$!|+]/.test(core) && /^[\p{L}\p{N}@$!|+]+$/u.test(core)) {
          words = this.phraseWordLeetKeys.get(toLeetRunForm(toFoldedForm(core)))
        }
      }
      const gap = literal.slice(cursor, chunk.index)
      cursor = chunk.index + raw.length
      const options = words ? words.map((word) => raw.replace(core, word)) : [raw]
      if (words) changed = true
      texts = texts
        .flatMap((text) => options.map((option) => text + gap + option))
        .slice(0, 16)
    }
    return changed ? texts : []
  }

  /**
   * A word with one letter replaced by a censor symbol (* _ # . -) is one whitespace-bounded
   * run that the tokenizer splits at the symbol. The run is read with the symbol as a
   * wildcard against every high-severity spelling and every sexual-violence family term.
   * A dot or hyphen at either edge is punctuation, never a censored letter.
   */
  private collectCensoredMatches(
    literal: string,
    budget: ExpansionBudget
  ): MatchOutcome[] {
    const outcomes: MatchOutcome[] = []
    if (this.censorKeys.size === 0) return outcomes
    for (const chunk of literal.matchAll(/\S+/gu)) {
      // The run between whitespace, without surrounding punctuation. An asterisk, hash or
      // underscore at an edge may be a censored letter; a dot or hyphen there is punctuation.
      const core = chunk[0].replace(/^[^\p{L}\p{N}*_#]+|[^\p{L}\p{N}*_#]+$/gu, '')
      if (!/^[\p{L}\p{N}]*[*_#.-][\p{L}\p{N}]*$/u.test(core)) continue
      if (core.length < MIN_SINGLE_TERM_LENGTH) continue
      if (!budget.spend(core)) return outcomes
      const at = core.search(/[*_#.-]/u)
      const folded = toFoldedForm(`${core.slice(0, at)}?${core.slice(at + 1)}`)
      const meta = this.censorKeys.get(toLeetRunForm(folded))
      if (meta) outcomes.push({ meta, obfuscated: true })
    }
    return outcomes
  }

  /**
   * A word written with a leet symbol inside it ("r@ped") is one
   * whitespace-bounded run that the tokenizer splits at the symbol. The run, and the run
   * without its edge symbols, are offered as candidates and matched in leet-class form.
   */
  private buildSymbolLeetCandidates(literal: string, budget: ExpansionBudget): string[] {
    const candidates: string[] = []
    for (const run of literal.matchAll(/[\p{L}\p{N}@$!|+]*[@$|+!][\p{L}\p{N}@$!|+]*/gu)) {
      const whole = run[0]
      const trimmed = whole.replace(/^[@$!|+]+|[@$!|+]+$/gu, '')
      for (const candidate of new Set([whole, trimmed])) {
        if (!/[\p{L}\p{N}]/u.test(candidate) || !/[@$!|+]/.test(candidate)) continue
        if (
          candidate.length < MIN_SINGLE_TERM_LENGTH &&
          !SHORT_TERM_EXCEPTIONS.has(toLeetRunForm(toFoldedForm(candidate)))
        )
          continue
        if (!budget.spend(candidate)) return candidates
        candidates.push(candidate)
      }
    }
    return candidates
  }

  /**
   * A reviewed ordinary pair, led by a listed ordinary word, in a text with no forbidden
   * word, no violent or hate word within three words of the pair and no forbidden phrase.
   */
  private isOrdinaryOpenSplit(foldedTokens: readonly string[], start: number): boolean {
    const frames = this.splitFrames.get(
      `${foldedTokens[start]} ${foldedTokens[start + 1]}`
    )
    if (!frames) return false
    const outside = [...foldedTokens.slice(0, start), ...foldedTokens.slice(start + 2)]
    const near = [
      ...foldedTokens.slice(Math.max(0, start - 3), start),
      ...foldedTokens.slice(start + 2, start + 5),
    ]
    return frames.some(
      (frame) =>
        (start === 0
          ? frame.atStart
          : frame.before.includes(foldedTokens[start - 1] as string) ||
            frame.reviewBefore.includes(foldedTokens[start - 1] as string)) &&
        !outside.some((word) => frame.reviewForbidden.includes(word)) &&
        !near.some((word) => frame.reviewForbiddenNear.includes(word)) &&
        !frame.reviewForbiddenPhrases.some((phrase) =>
          foldedTokens.some((_, at) =>
            phrase.every((word, offset) => foldedTokens[at + offset] === word)
          )
        )
    )
  }

  /**
   * Whether the pair at `start` sits inside a reviewed frame: the text before the listed
   * word is empty or closed lead phrases, the closed `after` phrase follows, and the
   * whole remainder of the text is closed tail phrases or empty. A clause break does not
   * end the check, so nothing unlisted can ride on the clearance.
   */
  private inReviewedSplitFrame(foldedTokens: readonly string[], start: number): boolean {
    const frames = this.splitFrames.get(
      `${foldedTokens[start]} ${foldedTokens[start + 1]}`
    )
    if (!frames) return false
    return frames.some((frame) => {
      if (start === 0) {
        if (!frame.atStart) return false
      } else {
        const before = foldedTokens[start - 1] as string
        if (!frame.before.includes(before)) return false
        const lead = foldedTokens.slice(0, start - 1)
        const words = frame.before.map((word) => [word])
        if (!tiledByPhrases(lead, [...frame.leads, ...words])) return false
      }
      return frame.after.some(
        (phrase) =>
          phrase.every((word, offset) => foldedTokens[start + 2 + offset] === word) &&
          tiledByPhrases(foldedTokens.slice(start + 2 + phrase.length), frame.tails)
      )
    })
  }

  /**
   * A multi-word term whose letters arrive cut at different places: `vai-tefoder`
   * for `vai-te foder`, `kill yours elf`, `blo wjob`. The window pass compares
   * token for token, the concatenation index sees only a single joined token,
   * and the spaced-letter rejoin only joins fragments of two characters, so a
   * phrase re-split between words of three or more letters reached none of them
   * and published. Found by Story 6.2b, when the vendored LDNOOBW lists brought
   * hyphenated phrases the earlier lists did not carry.
   *
   * Adjacent tokens are joined and compared against phrase concatenations only,
   * never against single terms, so two ordinary words that happen to spell a
   * single-word term (`pen is`) are not rebuilt into it. A window that is the
   * phrase in its own tokenization is skipped, because the window pass already
   * reported it as an unobfuscated match.
   */
  private collectResplitPhraseMatches(
    foldedTokens: readonly string[],
    allowed: readonly boolean[],
    literalTokens: readonly string[]
  ): MatchOutcome[] {
    const outcomes: MatchOutcome[] = []
    const collapsed = foldedTokens.map(collapseRepeats)
    const carriesLeet = literalTokens.map((token) => LEET_TRIGGER_PATTERN.test(token))
    for (let start = 0; start < collapsed.length; start += 1) {
      let joined = ''
      let leetInWindow = false
      for (
        let end = start;
        end < collapsed.length && end - start < JOIN_WINDOW_CEILING;
        end += 1
      ) {
        if (allowed[end]) break
        joined += foldedTokens[end] as string
        leetInWindow = leetInWindow || (carriesLeet[end] as boolean)
        if (collapseRepeats(joined).length > this.longestTerm) break
        if (end === start) continue
        // Story 6.2b review (EC5): `k1ll yours elf` and `bl0 wjob` published,
        // because the re-split pass compared repeat-collapsed letters only. The
        // leet-class comparison runs only when the window carries a digit or
        // symbol, the same gate the single-token pass uses.
        const leetJoined = leetInWindow ? toLeetRunForm(joined) : null
        const meta =
          this.worstAcross((index) => matchRun(index.phraseConcatenations, joined)) ??
          (leetJoined === null
            ? null
            : this.worstAcross((index) =>
                matchRun(index.phraseLeetConcatenations, leetJoined)
              ))
        if (!meta) continue
        const form = collapsed.slice(start, end + 1).join(' ')
        if (this.indexes.some((index) => index.phraseForms.has(form))) continue
        outcomes.push({ meta, obfuscated: true })
      }
    }
    return outcomes
  }

  /**
   * `f u c k`, `f.u.c.k` and `fu ck` all tokenize into short fragments, so the
   * spaced-letter and internal-punctuation families reduce to one rule: rejoin
   * runs of adjacent tokens that are too short to be words and offer each window
   * as a candidate. Tokens of three characters or more are never joined, which is
   * what keeps `off the shoulder` and `a line` out of this path.
   */
  private buildJoinCandidates(
    literal: string,
    literalTokens: readonly string[],
    budget: ExpansionBudget
  ): string[] {
    const candidates: string[] = []
    const spans = [...literal.matchAll(/[\p{L}\p{N}]+/gu)]
    let runStart = 0

    const flush = (endExclusive: number): void => {
      if (endExclusive - runStart < 2) return
      for (let start = runStart; start < endExclusive - 1; start += 1) {
        const maxSize = Math.min(endExclusive - start, JOIN_WINDOW_CEILING)
        for (let size = 2; size <= maxSize; size += 1) {
          const joined = literalTokens.slice(start, start + size).join('')
          if (this.isAllowedJoinedPhrase(literal, spans, literalTokens, start, size))
            continue
          const folded = toFoldedForm(joined)
          if (collapseRepeats(folded).length > this.longestTerm) break
          // The length floor keeps three-character candidates out, because
          // rebuilding those from adjacent letters would flag ordinary copy
          // everywhere. A reviewed exception has no ordinary reading in any of
          // the seven languages, so `a m k` is still reassembled.
          if (joined.length < MIN_SINGLE_TERM_LENGTH && !isReviewedShortTerm(folded)) {
            continue
          }
          if (this.allowSingles.has(joined)) continue
          if (!budget.spend(joined)) return
          candidates.push(joined)
        }
      }
    }

    // The allow list is deliberately not consulted per token here. Ending a run
    // at an allowed token would mean a short allow-list entry could be dropped
    // between letters to split a spaced-letter form in two, and neither half
    // would rebuild the term. The reconstructed candidate is checked against the
    // allow list instead, which protects the ordinary word without the gap.
    for (let position = 0; position <= literalTokens.length; position += 1) {
      const token = literalTokens[position]
      if (token !== undefined && token.length <= JOINABLE_TOKEN_LENGTH) continue
      flush(position)
      runStart = position + 1
    }

    return candidates
  }

  private isAllowedJoinedPhrase(
    literal: string,
    spans: readonly RegExpMatchArray[],
    tokens: readonly string[],
    start: number,
    size: number
  ): boolean {
    const contiguous = (joiner: 'space' | 'space-or-hyphen'): boolean =>
      Array.from({ length: size - 1 }, (_, offset) =>
        connectedLiteralTokens(literal, spans, start + offset, start + offset + 1, joiner)
      ).every(Boolean)
    // An ordinary complete phrase joins across plain spaces only ("lo-fa" is still lofa);
    // the hyphen of a native Portuguese compound belongs to the scoped phrases alone.
    if (
      this.allowPhrases.some(
        (phrase) =>
          phrase.length === size &&
          phrase.every((word, offset) => tokens[start + offset] === word)
      ) &&
      contiguous('space')
    )
      return true
    return this.activeScopedPhrases.some(
      (scoped) =>
        scoped.tokens.length === size &&
        scoped.tokens.every((word, offset) => tokens[start + offset] === word) &&
        scoped.complements.has(tokens[start + size] as string) &&
        connectedLiteralTokens(
          literal,
          spans,
          start + size - 1,
          start + size,
          'space-or-hyphen'
        ) &&
        contiguous('space-or-hyphen')
    )
  }

  private matchCandidate(
    folded: string,
    hasLeetCharacter: boolean,
    budget: ExpansionBudget
  ): MatchOutcome | null {
    const exact = this.worstAcross((index) => index.single.get(folded))
    if (exact) return { meta: exact, obfuscated: false }

    const collapsed = collapseRepeats(folded)
    if (!budget.spend(collapsed)) return null
    const repeated = this.worstAcross((index) => matchRun(index.singleCollapsed, folded))
    if (repeated) return { meta: repeated, obfuscated: true }

    if (!hasLeetCharacter) return null

    const classed = toLeetRunForm(folded)
    if (!budget.spend(classed)) return null
    const leet = this.worstAcross((index) => matchRun(index.singleLeet, classed))
    if (leet) return { meta: leet, obfuscated: true }

    // A nine is also a mirrored p (ra9ed); the g reading above covers the other.
    if (folded.includes('9') && (folded.match(/\p{L}/gu)?.length ?? 0) >= 4) {
      const mirrored = toLeetRunForm(folded.replaceAll('9', 'p'))
      const mirroredMeta = this.worstAcross((index) =>
        matchRun(index.singleLeet, mirrored)
      )
      if (mirroredMeta) return { meta: mirroredMeta, obfuscated: true }
    }

    return null
  }

  /**
   * The same word appears in more than one list, and the lists do not always
   * grade it alike: `puta` is medium in Spanish and high in Portuguese. Stopping
   * at the first index would let the order languages happen to be loaded in
   * decide whether a term blocks or only reviews, so every list is consulted and
   * the harshest grade wins.
   */
  private worstAcross(
    lookup: (index: LanguageIndex) => TermMeta | undefined
  ): TermMeta | null {
    let worst: TermMeta | null = null
    for (const index of this.indexes) {
      const found = lookup(index)
      if (!found) continue
      if (
        worst === null ||
        SEVERITY_RANK[found.severity] > SEVERITY_RANK[worst.severity]
      ) {
        worst = found
      }
    }
    return worst
  }
}

/**
 * The declared locale is echoed back for provenance, and whatever the caller
 * logs it into gets client-supplied text. Control characters are dropped and
 * the tag is cut at the longest BCP 47 tag the contract could produce, so a
 * crafted `locale` cannot forge a log line or grow one without bound.
 */
function boundLocaleTag(locale: string | null | undefined): string | null {
  const trimmed = locale?.replace(/\p{C}/gu, '').trim()
  return trimmed ? trimmed.slice(0, MAX_LOCALE_TAG_LENGTH) : null
}

/** Slices to the contract ceiling without leaving a lone high surrogate behind. */
function trimToLimit(raw: string, limit: number): string {
  const sliced = raw.slice(0, limit)
  const last = sliced.charCodeAt(sliced.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}
