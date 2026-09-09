import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import { FIXTURE_ENGINE_VERSION_SUFFIX } from './community-screening-policy.js'
import {
  CommunityTextScreener,
  SCREENING_LANGUAGES,
  TEXT_CLEAN_REASON,
  type CommunityTextScreeningResult,
  type ScreeningLanguage,
  type TextScreeningDisposition,
  type TextScreeningField,
} from './community-text-screener.js'
// Story 6.1 Task 4, extended by Story 6.2: ADR-013 automated content screening.
//
// The engine is a COMBINER, and deliberately little else. Text policy lives in
// `CommunityTextScreener` and image policy behind the `NsfwImageScreener` seam,
// so what is left here is the one rule neither of them can enforce alone: a post
// publishes only when both halves say so, and each half's own verdict decides
// that rather than whether it happened to name a reason.
//
// It used to hold its own three-language word list, which oversold itself in one
// direction and undersold itself in the other: it screened `en`/`es`/`fr` while
// ten locales shipped, and inside those three it matched whole unobfuscated
// tokens, so `fuuuck`, `f.u.c.k` and `f u c k` all passed. Both gaps are closed
// by the screener this now delegates to, which runs all seven languages against
// bounded canonical representations for every submission.
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

/**
 * Re-exported rather than restated. The screener owns the vocabulary and the
 * dependency runs one way, engine to screener, so a second copy of the string
 * here is how the two would silently disagree.
 */
export { LOCALE_UNSCREENABLE_REASON } from './community-text-screener.js'

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
  /** AC 3's three-way answer for the text half, aggregated over both fields. */
  disposition: TextScreeningDisposition
  /** Languages whose lists actually ran, which is every language loaded. */
  screenedLanguages: readonly ScreeningLanguage[]
  /**
   * One entry per screened field, each carrying its own declared locale,
   * observed scripts, categories, severity and policy version.
   *
   * NO MATCHED TERMS ANYWHERE, and the field that used to carry them is gone
   * rather than emptied. AC 4 keeps raw matched terms out of logs, metrics and
   * generated evidence, and a field that exists but must always be empty is an
   * invitation to fill it.
   */
  fields: readonly CommunityTextScreeningResult[]
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

export interface TextFieldScreeningInput {
  text: string | null | undefined
  /**
   * Required, with no default, because it selects the per-field input ceiling.
   * A caption screened as `altText` would be bounded at 200 characters instead
   * of 280 and truncate legitimate copy, and the laxer mistake in the other
   * direction is worse.
   */
  field: TextScreeningField
  locale?: string | null
}

export interface CommunityModerationEngine {
  screenText(input: TextFieldScreeningInput): Promise<TextScreeningResult>
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
   *
   * A screener that returns nothing still satisfies the seam and is treated as
   * ready with only its `engineVersion` known. Reporting the policy hash, the
   * model hash and the backend is what lets the readiness log answer AC 1's
   * question about which artifacts actually loaded, so a screener that has
   * those values should return them.
   */
  ensureReady?(): Promise<NsfwScreenerReadiness | void>
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

/**
 * The default text screener, built once per process on first use.
 *
 * Constructing one reads and validates fourteen list files, so a fresh instance
 * per engine, or worse per `screenText` call, would be filesystem work on the
 * screening hot path. Production does not rely on this: the worker runtime
 * builds one explicitly at startup from the loaded policy, which is where AC 1
 * wants a malformed list to throw.
 */
let sharedTextScreener: CommunityTextScreener | undefined

function defaultTextScreener(): CommunityTextScreener {
  sharedTextScreener ??= new CommunityTextScreener()
  return sharedTextScreener
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
  private readonly textScreener: CommunityTextScreener

  constructor(
    private readonly imageScreener: NsfwImageScreener = new UnavailableNsfwImageScreener(),
    textScreener?: CommunityTextScreener
  ) {
    this.textScreener = textScreener ?? defaultTextScreener()
  }

  /**
   * Delegates to the reusable text boundary, which runs every language's list
   * against every submission whatever locale the client declared, and adds
   * `locale_unscreenable` for a locale it holds no list for. Both behaviours
   * predate this delegation and are preserved by it rather than rebuilt.
   */
  screenText(input: TextFieldScreeningInput): Promise<TextScreeningResult> {
    const result = this.textScreener.screen({
      text: input.text,
      field: input.field,
      locale: input.locale,
    })
    return Promise.resolve(toTextScreeningResult([result]))
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
 * Folds one or more per-field results into the engine's text verdict.
 *
 * Only `pass` clears. `review` and `block` both withhold publication, which is
 * the same explicit-verdict rule the image half follows, and the reason list is
 * never what decides it.
 */
function harshest(
  left: TextScreeningDisposition,
  right: TextScreeningDisposition
): TextScreeningDisposition {
  if (left === 'block' || right === 'block') return 'block'
  if (left === 'review' || right === 'review') return 'review'
  return 'pass'
}

function toTextScreeningResult(
  fields: readonly CommunityTextScreeningResult[]
): TextScreeningResult {
  const disposition = fields.reduce<TextScreeningDisposition>(
    (accumulated, field) => harshest(accumulated, field.disposition),
    'pass'
  )
  const reasons = new Set(fields.flatMap((field) => [...field.reasons]))
  if (disposition !== 'pass') {
    reasons.delete(TEXT_CLEAN_REASON)
  }

  return {
    passed: disposition === 'pass',
    reasons: Array.from(reasons),
    engineVersion: fields[0]?.policyVersion ?? ADR013_TEXT_ENGINE_VERSION,
    disposition,
    screenedLanguages: Array.from(
      new Set(fields.flatMap((field) => [...field.screenedLanguages]))
    ),
    fields,
  }
}

/**
 * Folds the caption's verdict and the alt text's into one.
 *
 * IT KEEPS THE FIRST RESULT'S `engineVersion` rather than re-deriving it from
 * the fields, and that is the point. A pinned fixture outcome reports no
 * per-field provenance at all, so re-deriving dropped its `-fixture` marker and
 * a fixture run persisted a `moderation_engine_version` claiming the real text
 * engine had screened the post.
 */
function combineTextResults(
  results: readonly TextScreeningResult[]
): TextScreeningResult {
  const disposition = results.reduce<TextScreeningDisposition>(
    (accumulated, result) => harshest(accumulated, result.disposition),
    'pass'
  )
  const reasons = new Set(results.flatMap((result) => result.reasons))
  if (disposition !== 'pass') {
    reasons.delete(TEXT_CLEAN_REASON)
  }

  return {
    // Same rule as `combineScreeningResults`: a half that refused without
    // naming a reason still refuses.
    passed: results.every((result) => result.passed),
    reasons: Array.from(reasons),
    engineVersion: results[0]?.engineVersion ?? ADR013_TEXT_ENGINE_VERSION,
    disposition,
    screenedLanguages: Array.from(
      new Set(results.flatMap((result) => [...result.screenedLanguages]))
    ),
    fields: results.flatMap((result) => [...result.fields]),
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
  // Both fields, each screened AS ITSELF. The field selects its own input
  // ceiling, so passing a constant would bound one of them wrongly.
  const results = [
    await engine.screenText({
      text: input.caption,
      field: 'caption',
      locale: input.locale,
    }),
    await engine.screenText({
      text: input.altText,
      field: 'altText',
      locale: input.locale,
    }),
  ]

  return combineTextResults(results)
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
  const publishes = text.passed && imageCleared(image)
  // `text_clean` stays on the text verdict, where "screened and clean" is a
  // real auditable fact, and comes off the COMBINED list once anything holds
  // the post. The combined list becomes `moderation_reason`, and a moderator
  // reading "text_clean, screening_unavailable" as the reason a post was held
  // has been told the opposite of what happened.
  if (!publishes) {
    reasons.delete(TEXT_CLEAN_REASON)
  }
  const reasonsArray = Array.from(reasons)

  // The outcome follows each verdict's own `passed`, NOT whether it named a
  // reason. Deriving it from the reason list alone means a screener that
  // refuses an item without explaining itself is read as a pass, which is the
  // fail-open this whole engine exists to remove.
  return {
    outcome: publishes ? 'passed' : 'flagged',
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
      textOutcome?: {
        passed: boolean
        reasons: string[]
        disposition?: TextScreeningDisposition
      }
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
    this.delegate = new DefaultCommunityModerationEngine()
  }

  private readonly delegate: DefaultCommunityModerationEngine

  screenText(input: TextFieldScreeningInput): Promise<TextScreeningResult> {
    if (this.config.textOutcome) {
      const outcome = this.config.textOutcome
      const disposition: TextScreeningDisposition = outcome.passed
        ? 'pass'
        : (outcome.disposition ?? 'review')
      return Promise.resolve({
        passed: outcome.passed,
        reasons: outcome.reasons,
        engineVersion: FIXTURE_TEXT_ENGINE_VERSION,
        disposition,
        screenedLanguages: [...SCREENING_LANGUAGES],
        // A pinned outcome screened no field, so there is no per-field
        // provenance to report and inventing one would be a fixture claiming
        // observed scripts and a policy version it never read.
        fields: [],
      })
    }
    // The real screener, and therefore the REAL text version, because the work
    // genuinely was done. Only a pinned outcome is a fixture.
    return this.delegate.screenText(input)
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
