import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import { FIXTURE_ENGINE_VERSION_SUFFIX } from './community-screening-policy.js'
// Story 6.1 Task 4: ADR-013 automated content screening engine.
// Dictionary-based text safety filtering and server-side NSFW image screening,
// both with a deterministic, fail-closed verdict.
//
// READ THE WORD "FILTERING" NARROWLY, because this used to say "multilingual
// text safety filtering" and that oversold it in two directions at once.
//
// It screens three languages, not ten. `SCREENABLE_LANGUAGES` is `en`/`es`/`fr`;
// `tr`, `de`, `it` and `pt` ship as supported locales with no dictionary here, and
// `resolveScreeningLanguage` returns null for them so the post is held rather
// than cleared. That is a deliberate fail-closed gap, not a silent pass.
//
// And within those three it matches whole tokens against a fixed word list.
// `normalizeTextForModeration` folds diacritics and case and nothing else, and
// `scanTermList` compares single-word terms by exact token equality against a
// split on non-alphanumerics. So a repeated character, internal punctuation, or a
// spaced-out variant all pass: `fuuuck`, `f.u.c.k` and `f u c k` are each invisible
// to a dictionary holding the unobfuscated word. Only multi-word terms, which use
// substring matching, tolerate punctuation in the middle.
//
// Obfuscation handling was never specified for this story, so widening it is a
// product decision rather than a defect fix, and the honest thing in the meantime
// is for this comment not to imply a boundary the code does not enforce. Anything
// downstream that needs to assume real adversarial coverage does not have it yet.

export const ADR013_TEXT_ENGINE_VERSION = 'adr013-text-v2.0'
export const ADR013_IMAGE_ENGINE_VERSION = 'adr013-nsfw-v1.0'
export const IMAGE_SCREENING_UNAVAILABLE_VERSION = 'adr013-nsfw-unavailable'

/**
 * Versions a fixture reports, so a persisted `moderation_engine_version` can
 * never be mistaken for a real screening run.
 */
export const FIXTURE_TEXT_ENGINE_VERSION = `${ADR013_TEXT_ENGINE_VERSION}${FIXTURE_ENGINE_VERSION_SUFFIX}`
export const FIXTURE_IMAGE_ENGINE_VERSION = `${ADR013_IMAGE_ENGINE_VERSION}${FIXTURE_ENGINE_VERSION_SUFFIX}`

/** Reason emitted when no NSFW model is wired, so the post cannot be cleared. */
export const SCREENING_UNAVAILABLE_REASON = 'screening_unavailable'

/** Reason emitted for a locale this engine holds no dictionary for. */
export const LOCALE_UNSCREENABLE_REASON = 'locale_unscreenable'

/**
 * Reason emitted when a screener reports `passed: true` beside a `review` or
 * `block` disposition.
 *
 * The verdict is refused either way, but a refusal with no reason at all leaves
 * a held post in the moderation queue with nothing to explain it. This names the
 * contradiction instead, which is also the signal that the screener itself is
 * broken rather than that the image was.
 */
export const IMAGE_DISPOSITION_CONFLICT_REASON = 'image_disposition_conflict'

export interface TextScreeningResult {
  passed: boolean
  reasons: string[]
  engineVersion: string
  matchedTerms?: string[]
  /** Languages whose dictionaries actually ran against the text. */
  screenedLanguages?: SupportedLanguage[]
}

/**
 * The five ADR-013 class names, in the canonical order the model manifest pins.
 * The adapter applies them positionally to the model's output vector, so the
 * order here is part of the contract rather than presentation.
 */
export const ADR013_NSFW_CLASSES = [
  'Drawing',
  'Hentai',
  'Neutral',
  'Porn',
  'Sexy',
] as const

export type Adr013NsfwClass = (typeof ADR013_NSFW_CLASSES)[number]

/** AC 2's three-way image disposition. Only `pass` can reach publication. */
export type NsfwImageDisposition = 'pass' | 'review' | 'block'

export interface ImageScreeningResult {
  passed: boolean
  reasons: string[]
  engineVersion: string
  score?: number
  /**
   * Present once a screener has a real three-way opinion. It is optional
   * because the unavailable and fixture adapters predate it and a required
   * field would force them to invent one; {@link imageCleared} treats an absent
   * disposition as deferring to `passed`.
   */
  disposition?: NsfwImageDisposition
  /** Bounded model detail for the access-controlled evaluation payload. */
  classProbabilities?: Readonly<Partial<Record<Adr013NsfwClass, number>>>
  /** The hashed policy identity that produced {@link disposition}. */
  policyVersion?: string
}

export interface CommunityModerationResult {
  outcome: 'passed' | 'flagged'
  reasons: string[]
  engineVersions: {
    text: string
    image: string
  }
  /**
   * Both engine verdicts are carried through rather than collapsed into
   * `reasons`, because the matrix row for moderation requires recording each
   * engine's result even when the two disagree.
   */
  text: TextScreeningResult
  image: ImageScreeningResult
}

export interface PostScreeningInput {
  caption?: string | null
  altText?: string | null
  locale?: string | null
  imageBuffer: Buffer
}

export interface CommunityModerationEngine {
  screenText(text: string, locale?: string | null): Promise<TextScreeningResult>
  screenImage(imageBuffer: Buffer): Promise<ImageScreeningResult>
  moderatePost(input: PostScreeningInput): Promise<CommunityModerationResult>
}

/**
 * The seam ADR-013's TensorFlow.js NSFW model plugs into.
 *
 * An implementation that owns a model process also owns its lifecycle, so the
 * two lifecycle members are optional here rather than in a second interface:
 * `community-worker-runtime.ts` awaits {@link NsfwImageScreener.ensureReady}
 * before the BullMQ consumer starts and calls {@link NsfwImageScreener.close}
 * on shutdown, and the adapters that hold no resources simply omit both.
 */
export interface NsfwImageScreener {
  readonly engineVersion: string
  screen(imageBuffer: Buffer): Promise<ImageScreeningResult>
  /**
   * Loads and verifies whatever the screener needs before it can answer, and
   * reports the identity that will be persisted with every verdict.
   */
  ensureReady?(): Promise<NsfwScreenerReadiness>
  /** Releases the model process, tensors and handles the screener opened. */
  close?(): Promise<void>
}

/**
 * What a screener knows about itself once it is ready. Every field beyond
 * `engineVersion` is optional because the unavailable and fixture adapters
 * genuinely have no model, no backend and no policy behind them, and inventing
 * values for them is the kind of plausible-looking identity this story exists
 * to prevent.
 */
export interface NsfwScreenerReadiness {
  engineVersion: string
  /** Hash of the policy file that produced the thresholds in use. */
  policyVersion?: string
  /** Hash pinning the model artifact that actually loaded. */
  modelHash?: string
  /** TensorFlow.js backend the inference runtime selected. */
  backend?: string
}

// Multilingual profanity and safety term dictionaries
const PROFANITY_EN = [
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'pussy',
  'whore',
  'slut',
  'cock',
]

const SAFETY_EN = ['nigger', 'faggot', 'kill yourself', 'kys', 'nazi', 'terrorist']

const PROFANITY_ES = [
  'puta',
  'puto',
  'mierda',
  'cabron',
  'cabrona',
  'pendejo',
  'pendeja',
  'chingar',
  'chinga',
  'chingado',
  'coño',
  'cono',
  'joder',
  'culiao',
  'hijo de puta',
]

const SAFETY_ES = ['maricon', 'nazi', 'matate']

const PROFANITY_FR = [
  'merde',
  'putain',
  'connard',
  'connasse',
  'salope',
  'salopard',
  'encule',
  'enculer',
  'foutre',
  'chier',
  'bordel',
  'pute',
  'bite',
  'batard',
]

const SAFETY_FR = ['negre', 'nazi', 'va te faire pendre']

export type SupportedLanguage = 'en' | 'es' | 'fr'

/**
 * Every language this engine can actually screen. The story's supported-locale
 * set is wider (`tr`, `de`, `it`, `pt` also ship), and that gap is the reason
 * {@link resolveScreeningLanguage} returns `null` rather than quietly falling
 * back to English.
 */
export const SCREENABLE_LANGUAGES: readonly SupportedLanguage[] = ['en', 'es', 'fr']

const DICTIONARIES: Record<
  SupportedLanguage,
  { profanity: readonly string[]; safety: readonly string[] }
> = {
  en: { profanity: PROFANITY_EN, safety: SAFETY_EN },
  es: { profanity: PROFANITY_ES, safety: SAFETY_ES },
  fr: { profanity: PROFANITY_FR, safety: SAFETY_FR },
}

/**
 * Returns the screenable language for a locale tag, or `null` when this engine
 * holds no dictionary for it.
 *
 * The previous implementation mapped anything that was not `es` or `fr` onto
 * `en`. Because `locale` arrives from the client on the publish request, that
 * turned a declared `de-DE` into "screen this Spanish caption with the English
 * dictionary" — a one-field opt-out of the Spanish and French filters. Callers
 * now screen every dictionary regardless of what the client declared, and use
 * this result only to decide whether the declared locale is one we can claim to
 * have screened.
 */
export function resolveScreeningLanguage(
  locale?: string | null
): SupportedLanguage | null {
  if (!locale) return null
  const normalized = locale.trim().toLowerCase()
  return SCREENABLE_LANGUAGES.find((language) => normalized.startsWith(language)) ?? null
}

export function normalizeTextForModeration(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function scanTermList(
  terms: readonly string[],
  normalized: string,
  tokens: string[],
  category: string,
  reasons: Set<string>,
  matchedTerms: string[]
): void {
  for (const term of terms) {
    const hit = term.includes(' ') ? normalized.includes(term) : tokens.includes(term)
    if (hit) {
      reasons.add(category)
      matchedTerms.push(term)
    }
  }
}

/**
 * The fail-closed default: with no model wired, every image is unscreened, and
 * an unscreened image must not reach `published`.
 *
 * ADR-013 names a TensorFlow.js NSFW model running server-side in the BullMQ
 * worker. Neither `nsfwjs` nor `@tensorflow/tfjs-node` is a dependency of this
 * repository, and adding one is an "Ask First" item in the story ("change
 * ADR-013 moderation technology"), so the honest posture is to report the gap
 * as a verdict instead of reporting success. Every post therefore lands in
 * `flagged` for human review, which is the same queue the SLA alert already
 * feeds, until the real screener is supplied through
 * {@link DefaultCommunityModerationEngine}'s constructor.
 */
export class UnavailableNsfwImageScreener implements NsfwImageScreener {
  readonly engineVersion = IMAGE_SCREENING_UNAVAILABLE_VERSION

  screen(_imageBuffer: Buffer): Promise<ImageScreeningResult> {
    return Promise.resolve({
      passed: false,
      reasons: [SCREENING_UNAVAILABLE_REASON],
      engineVersion: this.engineVersion,
      disposition: 'review',
    })
  }
}

export class DefaultCommunityModerationEngine implements CommunityModerationEngine {
  constructor(
    private readonly imageScreener: NsfwImageScreener = new UnavailableNsfwImageScreener()
  ) {}

  /**
   * Screens `text` against every dictionary this engine holds, then adds
   * {@link LOCALE_UNSCREENABLE_REASON} when the declared locale is one it has no
   * dictionary for. Screening all dictionaries satisfies the spec's "caption and
   * alt text screened in the resolved locale" strictly: the resolved locale's
   * dictionary always runs when one exists, and running the others as well can
   * only catch more.
   */
  screenText(text: string, locale?: string | null): Promise<TextScreeningResult> {
    const declaredLanguage = resolveScreeningLanguage(locale)
    const reasons = new Set<string>()

    if (locale && !declaredLanguage) {
      reasons.add(LOCALE_UNSCREENABLE_REASON)
    }

    if (!text || text.trim().length === 0) {
      const emptyReasons = Array.from(reasons)
      return Promise.resolve({
        passed: emptyReasons.length === 0,
        reasons: emptyReasons,
        engineVersion: ADR013_TEXT_ENGINE_VERSION,
        matchedTerms: [],
        screenedLanguages: [],
      })
    }

    const normalized = normalizeTextForModeration(text)
    const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    const matchedTerms: string[] = []

    for (const language of SCREENABLE_LANGUAGES) {
      const dictionary = DICTIONARIES[language]
      scanTermList(
        dictionary.profanity,
        normalized,
        tokens,
        'profanity',
        reasons,
        matchedTerms
      )
      scanTermList(dictionary.safety, normalized, tokens, 'safety', reasons, matchedTerms)
    }

    const reasonsArray = Array.from(reasons)
    return Promise.resolve({
      passed: reasonsArray.length === 0,
      reasons: reasonsArray,
      engineVersion: ADR013_TEXT_ENGINE_VERSION,
      matchedTerms,
      screenedLanguages: [...SCREENABLE_LANGUAGES],
    })
  }

  screenImage(imageBuffer: Buffer): Promise<ImageScreeningResult> {
    return this.imageScreener.screen(imageBuffer)
  }

  async moderatePost(input: PostScreeningInput): Promise<CommunityModerationResult> {
    return combineScreeningResults(
      await screenPostText(this, input),
      await this.screenImage(input.imageBuffer)
    )
  }
}

/**
 * Screens caption and alt text together, so a clean caption cannot mask a
 * flagged alt text and an unscreenable locale is reported once for both.
 */
async function screenPostText(
  engine: Pick<CommunityModerationEngine, 'screenText'>,
  input: PostScreeningInput
): Promise<TextScreeningResult> {
  const results: TextScreeningResult[] = [
    await engine.screenText(input.caption ?? '', input.locale),
    await engine.screenText(input.altText ?? '', input.locale),
  ]

  const reasons = new Set<string>()
  const matchedTerms: string[] = []
  // Union across both fields, not the caption's list. An empty caption screens
  // no languages and returns an empty list, so reading the caption's answer
  // alone reported "nothing was screened" for a post whose alt text had just
  // been run against every dictionary.
  const screenedLanguages = new Set<SupportedLanguage>()
  for (const result of results) {
    for (const reason of result.reasons) {
      reasons.add(reason)
    }
    for (const language of result.screenedLanguages ?? []) {
      screenedLanguages.add(language)
    }
    matchedTerms.push(...(result.matchedTerms ?? []))
  }

  const reasonsArray = Array.from(reasons)
  return {
    // Same rule as `combineScreeningResults`: a sub-result that refused without
    // naming a reason still refuses.
    passed: results.every((result) => result.passed),
    reasons: reasonsArray,
    engineVersion: results[0]?.engineVersion ?? ADR013_TEXT_ENGINE_VERSION,
    matchedTerms,
    screenedLanguages: Array.from(screenedLanguages),
  }
}

/**
 * Whether the image half may contribute to automatic publication.
 *
 * Both halves have to agree, and they are checked separately because they fail
 * in opposite directions. `passed` is the seam's original verdict and stays
 * authoritative on its own. `disposition` is AC 2's three-way answer, and a
 * screener that reports `passed: true` beside a `review` or `block` disposition
 * is contradicting itself; reading only one of the two would publish on the
 * half that happens to be wrong.
 */
export function imageCleared(image: ImageScreeningResult): boolean {
  return image.passed && (image.disposition ?? 'pass') === 'pass'
}

function combineScreeningResults(
  text: TextScreeningResult,
  image: ImageScreeningResult
): CommunityModerationResult {
  const reasons = new Set<string>([...text.reasons, ...image.reasons])
  if (image.passed && !imageCleared(image)) {
    reasons.add(IMAGE_DISPOSITION_CONFLICT_REASON)
  }
  const reasonsArray = Array.from(reasons)

  // The outcome follows each verdict's own `passed`, NOT whether it named a
  // reason. Deriving it from the reason list alone means a screener that
  // refuses an item without explaining itself is read as a pass, which is the
  // fail-open this whole engine exists to remove.
  return {
    outcome: text.passed && imageCleared(image) ? 'passed' : 'flagged',
    reasons: reasonsArray,
    engineVersions: {
      text: text.engineVersion,
      image: image.engineVersion,
    },
    text,
    image,
  }
}

/**
 * Deterministic engine for tests and local seeding. It exists so a spec can
 * pin an outcome without the production engine ever having a code path that
 * reports success it did not earn.
 *
 * ITS VERSIONS SAY `fixture` OUT LOUD, and that is not cosmetic. This engine
 * previously reported `ADR013_IMAGE_ENGINE_VERSION` verbatim, so every row it
 * published persisted `moderation_engine_version: 'adr013-nsfw-v1.0'` — the real
 * model's identifier — on content no model had screened. A
 * `moderation_engine_version` outlives everyone who remembers which engine was
 * wired on the day, and it is the column an auditor would read to answer "was
 * this screened". A fixture that signs the real model's name is the one lie the
 * audit trail cannot survive.
 *
 * The text half keeps the REAL version when `textOutcome` is unset, because it
 * then delegates to the genuine dictionary screening and the work really was
 * done; it is only a fixture when an outcome is pinned.
 *
 * Gated on `allowsTestOnlySecrets()` like every other fixture in this
 * repository, so it cannot be constructed in production. Nothing in production
 * source references it today, and this makes that structural rather than
 * incidental.
 */
export class FixtureCommunityModerationEngine implements CommunityModerationEngine {
  constructor(
    private readonly config: {
      textOutcome?: { passed: boolean; reasons: string[] }
      imageOutcome?: {
        passed: boolean
        reasons: string[]
        score?: number
        disposition?: NsfwImageDisposition
      }
    } = {}
  ) {
    if (!allowsTestOnlySecrets()) {
      throw new Error(
        'FixtureCommunityModerationEngine is strictly forbidden outside an allowed test environment'
      )
    }
  }

  screenText(text: string, locale?: string | null): Promise<TextScreeningResult> {
    if (this.config.textOutcome) {
      return Promise.resolve({
        passed: this.config.textOutcome.passed,
        reasons: this.config.textOutcome.reasons,
        engineVersion: FIXTURE_TEXT_ENGINE_VERSION,
        matchedTerms: [],
        screenedLanguages: [...SCREENABLE_LANGUAGES],
      })
    }
    return new DefaultCommunityModerationEngine().screenText(text, locale)
  }

  screenImage(_imageBuffer: Buffer): Promise<ImageScreeningResult> {
    const outcome = this.config.imageOutcome ?? {
      passed: false,
      reasons: [SCREENING_UNAVAILABLE_REASON],
    }
    return Promise.resolve({
      passed: outcome.passed,
      reasons: outcome.reasons,
      engineVersion: FIXTURE_IMAGE_ENGINE_VERSION,
      disposition: outcome.disposition ?? (outcome.passed ? 'pass' : 'review'),
      ...(outcome.score === undefined ? {} : { score: outcome.score }),
    })
  }

  async moderatePost(input: PostScreeningInput): Promise<CommunityModerationResult> {
    return combineScreeningResults(
      await screenPostText(this, input),
      await this.screenImage(input.imageBuffer)
    )
  }
}
