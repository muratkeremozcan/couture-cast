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
// client on the publish request, so treating it as a routing key would make it a
// one-field opt-out of the other six dictionaries. It selects nothing; it is
// only reported back as provenance, and it is checked for a language this
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

import fs from 'node:fs'
import path from 'node:path'
import { Filter } from 'bad-words'
import { z } from 'zod'
import { supportedLocales } from '@couture/api-client/contracts/http'

export const SCREENING_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'] as const

/** The six categories `policies/community-screening/policy-v1.json` defines. */
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

/** Stable reason codes, mirroring `policy-v1.json`'s `reasonCodes.text`. */
export const TEXT_POLICY_MATCH_REASON = 'text_policy_match'
export const LOCALE_UNSCREENABLE_REASON = 'locale_unscreenable'
export const SCRIPT_MIXED_REASON = 'script_mixed'
export const SCRIPT_UNSUPPORTED_REASON = 'script_unsupported'

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
  readonly severityDisposition: Readonly<
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
 * A structural copy of `policy-v1.json`'s `text` section, so this boundary is
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

export const DEFAULT_COMMUNITY_TEXT_POLICY_VERSION = 'community-screening-policy-v1'

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

const allowFileSchema = z.object({
  language: z.enum(SCREENING_LANGUAGES),
  listVersion: z.string().trim().min(1),
  listType: z.literal('allowList'),
  provenance: provenanceSchema,
  entries: z.array(z.string().trim().min(1)),
})

/**
 * A single-word term shorter than this collides with ordinary vocabulary in the
 * other six languages once folded, and every language runs against every
 * submission. The Turkish word for backside folds to English "got"; the
 * two-letter one folds to English "am". Both are excluded by this floor.
 */
const MIN_SINGLE_TERM_LENGTH = 4

/**
 * Reviewed exceptions to {@link MIN_SINGLE_TERM_LENGTH}, kept visible on purpose
 * rather than buried in a list file. `kys` and `amk` are both written
 * abbreviations with no ordinary reading in any of the seven languages once
 * folded, which is the only ground on which the floor is waived.
 */
const SHORT_TERM_EXCEPTIONS: ReadonlySet<string> = new Set(['kys', 'amk'])

const MAX_JOIN_WINDOW = 12
/** Tokens this short are the raw material of a spaced-letter form, not words. */
const JOINABLE_TOKEN_LENGTH = 2

const IGNORABLE_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu
const COMBINING_MARK_PATTERN = /\p{M}/gu
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
  let value = raw.normalize('NFKC').replace(IGNORABLE_PATTERN, '').toLowerCase()
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
    folded += FOLD_SINGLETONS[character] ?? CONFUSABLES[character] ?? character
  }
  return folded.normalize('NFC')
}

function collapseRepeats(value: string): string {
  return value.replace(REPEAT_PATTERN, '$1')
}

function toLeetClassForm(value: string): string {
  let classed = ''
  for (const character of value) {
    classed += LEET_CLASSES[character] ?? character
  }
  return classed
}

function tokenize(value: string): string[] {
  return value.split(TOKEN_SPLIT_PATTERN).filter(Boolean)
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

interface PhraseEntry {
  readonly tokens: readonly string[]
  readonly collapsed: readonly string[]
  readonly meta: TermMeta
}

interface LanguageIndex {
  readonly language: ScreeningLanguage
  readonly listVersion: string
  readonly single: ReadonlyMap<string, TermMeta>
  readonly singleCollapsed: ReadonlyMap<string, TermMeta>
  readonly singleLeet: ReadonlyMap<string, TermMeta>
  readonly phrases: readonly PhraseEntry[]
}

export interface CommunityTextScreenerOptions {
  /** Structurally `policy.text` from the loaded `policy-v1.json`. */
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
  language: ScreeningLanguage
): Parsed {
  if (!fs.existsSync(filePath)) {
    throw new CommunityTextScreenerConfigError(`missing list file ${filePath}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function buildLanguageIndex(
  list: z.infer<typeof termsFileSchema>,
  policy: CommunityTextPolicy
): LanguageIndex {
  const single = new Map<string, TermMeta>()
  const singleCollapsed = new Map<string, TermMeta>()
  const singleLeet = new Map<string, TermMeta>()
  const phrases: PhraseEntry[] = []

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
      phrases.push({
        tokens: foldedTokens,
        collapsed: foldedTokens.map(collapseRepeats),
        meta,
      })
      continue
    }

    const term = foldedTokens[0] as string
    if (term.length < MIN_SINGLE_TERM_LENGTH && !SHORT_TERM_EXCEPTIONS.has(term)) {
      throw new CommunityTextScreenerConfigError(
        `${list.language} has a single-word term under ${MIN_SINGLE_TERM_LENGTH} characters that is not a reviewed exception`
      )
    }

    single.set(term, meta)
    singleCollapsed.set(collapseRepeats(term), meta)
    singleLeet.set(toLeetClassForm(collapseRepeats(term)), meta)
  }

  return {
    language: list.language,
    listVersion: list.listVersion,
    single,
    singleCollapsed,
    singleLeet,
    phrases,
  }
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

  flag(reason: string, disposition: TextScreeningDisposition): void {
    this.reasons.add(reason)
    if (DISPOSITION_RANK[disposition] > DISPOSITION_RANK[this.disposition]) {
      this.disposition = disposition
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
    return [...this.reasons].sort()
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
  private readonly listVersions: Readonly<Record<string, string>>
  private readonly loadedLanguages: readonly ScreeningLanguage[]
  private readonly englishFilter: Filter
  private readonly fieldLimits: Readonly<Record<TextScreeningField, number>>

  constructor(options: CommunityTextScreenerOptions = {}) {
    this.policy = options.policy ?? DEFAULT_COMMUNITY_TEXT_POLICY
    this.policyVersion = options.policyVersion ?? DEFAULT_COMMUNITY_TEXT_POLICY_VERSION

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
    const termLists = SCREENING_LANGUAGES.map((language) =>
      readListFile(path.join(directory, `${language}-v1.json`), termsFileSchema, language)
    )
    const allowLists = SCREENING_LANGUAGES.map((language) =>
      readListFile(
        path.join(directory, `allow-${language}-v1.json`),
        allowFileSchema,
        language
      )
    )

    this.indexes = termLists.map((list) => buildLanguageIndex(list, this.policy))
    this.loadedLanguages = Object.freeze(this.indexes.map((index) => index.language))
    this.listVersions = Object.freeze(
      Object.fromEntries(termLists.map((list) => [list.language, list.listVersion]))
    )

    // Allow lists apply across languages rather than only to the file they were
    // written in, because every language's dictionary runs against every
    // submission. A word that is ordinary German copy has to survive the Italian
    // list too, so the union is the only coherent reading.
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
  }

  /** Every language whose list is loaded, which is every language that runs. */
  get screenedLanguages(): readonly ScreeningLanguage[] {
    return this.loadedLanguages
  }

  screen(input: CommunityTextScreeningInput): CommunityTextScreeningResult {
    const declaredLocale = input.locale?.trim() ? input.locale.trim() : null
    const verdict = new Verdict()

    if (declaredLocale && this.resolveLanguage(declaredLocale) === null) {
      verdict.flag(LOCALE_UNSCREENABLE_REASON, this.policy.unscreenableLocaleDisposition)
    }

    const limit = this.fieldLimits[input.field]
    const raw = input.text ?? ''
    const overLength = raw.length > limit
    const literal = toLiteralForm(overLength ? trimToLimit(raw, limit) : raw)

    const observedScripts = observeScripts(literal)
    this.applyScriptPolicy(observedScripts, verdict)

    const budget = new ExpansionBudget(this.policy.limits.maxExpandedCharacters)
    const { literalTokens, foldedTokens } = this.foldTokens(literal, budget)
    const allowed = literalTokens.map((token) => this.allowSingles.has(token))
    this.markAllowedPhrases(literalTokens, allowed)

    for (const outcome of this.collectMatches(
      literalTokens,
      foldedTokens,
      allowed,
      budget
    )) {
      verdict.match(outcome, this.policy.severityDisposition[outcome.meta.severity])
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

  private markAllowedPhrases(literalTokens: string[], allowed: boolean[]): void {
    for (const phrase of this.allowPhrases) {
      for (let start = 0; start + phrase.length <= literalTokens.length; start += 1) {
        const matches = phrase.every(
          (token, offset) => literalTokens[start + offset] === token
        )
        if (!matches) continue
        for (let offset = 0; offset < phrase.length; offset += 1) {
          allowed[start + offset] = true
        }
      }
    }
  }

  private collectMatches(
    literalTokens: readonly string[],
    foldedTokens: readonly string[],
    allowed: readonly boolean[],
    budget: ExpansionBudget
  ): MatchOutcome[] {
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
      if (
        folded.length >= MIN_SINGLE_TERM_LENGTH &&
        this.englishFilter.isProfane(folded)
      ) {
        outcomes.push({
          meta: { category: 'profanity', severity: 'low' },
          obfuscated: false,
        })
      }
    }

    const collapsedTokens = foldedTokens.map(collapseRepeats)
    for (const index of this.indexes) {
      for (const phrase of index.phrases) {
        const width = phrase.collapsed.length
        for (let start = 0; start + width <= collapsedTokens.length; start += 1) {
          const window = collapsedTokens.slice(start, start + width)
          if (window.some((_token, offset) => allowed[start + offset])) continue
          if (!window.every((token, offset) => token === phrase.collapsed[offset]))
            continue
          const exact = foldedTokens
            .slice(start, start + width)
            .every((token, offset) => token === phrase.tokens[offset])
          outcomes.push({ meta: phrase.meta, obfuscated: !exact })
        }
      }
    }

    for (const candidate of this.buildJoinCandidates(literalTokens, budget)) {
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
   * `f u c k`, `f.u.c.k` and `fu ck` all tokenize into short fragments, so the
   * spaced-letter and internal-punctuation families reduce to one rule: rejoin
   * runs of adjacent tokens that are too short to be words and offer each window
   * as a candidate. Tokens of three characters or more are never joined, which is
   * what keeps `off the shoulder` and `a line` out of this path.
   */
  private buildJoinCandidates(
    literalTokens: readonly string[],
    budget: ExpansionBudget
  ): string[] {
    const candidates: string[] = []
    let runStart = 0

    const flush = (endExclusive: number): void => {
      const length = endExclusive - runStart
      if (length < 2) return
      const maxWindow = Math.min(length, MAX_JOIN_WINDOW)
      for (let size = 2; size <= maxWindow; size += 1) {
        for (let start = runStart; start + size <= endExclusive; start += 1) {
          const joined = literalTokens.slice(start, start + size).join('')
          if (joined.length < MIN_SINGLE_TERM_LENGTH) continue
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

  private matchCandidate(
    folded: string,
    hasLeetCharacter: boolean,
    budget: ExpansionBudget
  ): MatchOutcome | null {
    const exact = this.worstAcross((index) => index.single.get(folded))
    if (exact) return { meta: exact, obfuscated: false }

    const collapsed = collapseRepeats(folded)
    if (!budget.spend(collapsed)) return null
    const repeated = this.worstAcross((index) => index.singleCollapsed.get(collapsed))
    if (repeated) return { meta: repeated, obfuscated: true }

    if (!hasLeetCharacter) return null

    const classed = toLeetClassForm(collapsed)
    if (!budget.spend(classed)) return null
    const leet = this.worstAcross((index) => index.singleLeet.get(classed))
    if (leet) return { meta: leet, obfuscated: true }

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

/** Slices to the contract ceiling without leaving a lone high surrogate behind. */
function trimToLimit(raw: string, limit: number): string {
  const sliced = raw.slice(0, limit)
  const last = sliced.charCodeAt(sliced.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}
