// Story 5.4 Task 6: BullMQ processor for palette analysis (both sources),
// mirroring silhouette-photo.processor.ts's shape.
import { type PaletteProfile, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  chroma,
  classifyUndertone,
  hueAngleDegrees,
  type Lab,
  linearRgbToLab,
  linearizeSrgbChannel,
  NEUTRAL_CHROMA_MAX,
  srgbChannels,
  type SkinDepth,
  type SkinUndertone,
} from '@couture/utils'
import {
  ADVISOR_RULES_VERSION,
  type PaletteAnalysisFailureReason,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { PaletteAnalysisEngine } from './palette-analysis.engine.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'

type ProcessablePaletteProfile = PaletteProfile & { status: 'processing' }

function isProcessableProfile(
  profile: PaletteProfile | null
): profile is ProcessablePaletteProfile {
  return profile?.status === 'processing'
}

/**
 * Same floor as `NEUTRAL_CHROMA_MAX` (skin-tone.ts), applied to a GARMENT
 * colour rather than a skin-pixel median: a wardrobe of black-and-white
 * garments says nothing about undertone, and this is also what silently
 * discards every `#808080` fallback row `WardrobeColorProcessor` writes when
 * Sharp throws (wardrobe-color.processor.ts:61) — those rows are failed
 * extractions, not neutral votes.
 */
const ACHROMATIC_CHROMA_MAX = NEUTRAL_CHROMA_MAX

/** Below this many usable wardrobe samples, there is not enough signal to classify (Decision 3). */
const MIN_WARDROBE_SAMPLES = 5

/** Sample count at or above which the wardrobe confidence's count factor saturates. */
const WARDROBE_CONFIDENCE_SATURATION_COUNT = 15

/** Interquartile hue-angle spread (degrees) at or above which confidence bottoms out at 0. */
const HUE_IQR_ZERO_CONFIDENCE = 90

/**
 * The confidence floor below which a wardrobe derivation refuses to answer.
 *
 * Decision 3 states the rule for both sources: "`confidence < MIN_CONFIDENCE`
 * (0.4) terminates as `failed` rather than shipping a low-confidence answer
 * that a user will read as fact about their body." The selfie engine owns its
 * own copy of that constant; this is the wardrobe half, which was missing.
 *
 * Two deliberate details:
 *
 * - The value is the same 0.4 the selfie path uses, because it means the same
 *   thing on both: do not publish an undertone this weakly evidenced.
 * - It terminates as `insufficient_wardrobe`, NOT as `low_quality`. The
 *   `low_quality` copy is photo-specific in all ten catalogs ("too dim, too
 *   filtered or too uneven"), and showing it to someone who never uploaded a
 *   photo would be a wrong answer dressed as a helpful one. A wardrobe whose
 *   colours disagree too much to call IS an insufficient wardrobe for this
 *   purpose, and that is what the copy says.
 *
 * With `WARDROBE_CONFIDENCE_SATURATION_COUNT` at 15, this makes
 * `MIN_WARDROBE_SAMPLES` a fast path rather than the binding gate: five
 * survivors score at most 0.33 and can never clear the floor. That is
 * intentional -- both checks answer `insufficient_wardrobe`, so the user-visible
 * outcome is identical and the cheap count check still short-circuits the
 * arithmetic.
 */
const MIN_WARDROBE_CONFIDENCE = 0.4

const hexCodesArraySchema = z.array(z.string())

type AnalysisResult =
  | {
      outcome: 'ready'
      undertone: SkinUndertone
      depth: SkinDepth | null
      confidence: number
    }
  | { outcome: PaletteAnalysisFailureReason }

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

function interquartileRange(values: readonly number[]): number {
  if (values.length < 4) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0
  return q3 - q1
}

function hueTightness(hueAngles: readonly number[]): number {
  const iqr = interquartileRange(hueAngles)
  return Math.max(0, 1 - iqr / HUE_IQR_ZERO_CONFIDENCE)
}

export class PaletteAnalysisProcessor {
  private readonly logger = createBaseLogger().child({
    feature: 'palette-analysis-processing',
  })

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: WardrobeStorage,
    private readonly engine: PaletteAnalysisEngine,
    private readonly telemetry: TelemetryService
  ) {}

  /**
   * Decision 3's wardrobe aggregation, precisely: reads the acting user's
   * `PaletteInsights` rows, takes each row's `hex_codes[0]` through a Zod
   * guard (the column is `Json?`, so a fixture or an older row can hold
   * anything), discards near-achromatic survivors, requires at least
   * `MIN_WARDROBE_SAMPLES`, and classifies from the MEDIAN of the survivors'
   * Lab a* and b* -- never the mean, so a handful of outliers cannot skew it.
   * `depth` is always null: garment colour is evidence about what the user
   * wears, not about their skin.
   */
  private async analyzeWardrobe(userId: string): Promise<AnalysisResult> {
    const rows = await this.prisma.paletteInsights.findMany({
      where: { user_id: userId },
      select: { hex_codes: true },
    })

    const survivorLabs: Lab[] = []
    for (const row of rows) {
      const parsed = hexCodesArraySchema.safeParse(row.hex_codes)
      const hex = parsed.success ? parsed.data[0] : undefined
      if (!hex) {
        continue
      }
      let lab: Lab
      try {
        const [r, g, b] = srgbChannels(hex)
        lab = linearRgbToLab([
          linearizeSrgbChannel(r),
          linearizeSrgbChannel(g),
          linearizeSrgbChannel(b),
        ])
      } catch {
        continue
      }
      if (chroma(lab) < ACHROMATIC_CHROMA_MAX) {
        continue
      }
      survivorLabs.push(lab)
    }

    if (survivorLabs.length < MIN_WARDROBE_SAMPLES) {
      return { outcome: 'insufficient_wardrobe' }
    }

    const medianLab: Lab = {
      L: median(survivorLabs.map((lab) => lab.L)),
      a: median(survivorLabs.map((lab) => lab.a)),
      b: median(survivorLabs.map((lab) => lab.b)),
    }
    const undertone = classifyUndertone(medianLab)
    const countFactor = Math.min(
      1,
      survivorLabs.length / WARDROBE_CONFIDENCE_SATURATION_COUNT
    )
    const hueAngles = survivorLabs.map((lab) => hueAngleDegrees(lab))
    const confidence = Math.min(1, Math.max(0, countFactor * hueTightness(hueAngles)))
    if (confidence < MIN_WARDROBE_CONFIDENCE) {
      return { outcome: 'insufficient_wardrobe' }
    }

    return { outcome: 'ready', undertone, depth: null, confidence }
  }

  private async analyzeSelfie(objectPath: string | null): Promise<AnalysisResult> {
    if (!objectPath) {
      return { outcome: 'storage_error' }
    }
    // A genuine storage/timeout fault propagates here so BullMQ's existing
    // retry/backoff engages (mirrors silhouette-photo.processor.ts's
    // deliberate non-catching of download failures).
    const bytes = await this.storage.download(objectPath)
    const verdict = await this.engine.analyzeSelfie(bytes)
    if (verdict.outcome === 'ready') {
      return {
        outcome: 'ready',
        undertone: verdict.undertone as SkinUndertone,
        depth: verdict.depth as SkinDepth,
        confidence: verdict.confidence,
      }
    }
    return { outcome: verdict.outcome }
  }

  /**
   * Storage removal failure must not strand the profile: log it, leave
   * `selfie_purged_at` null, and let the retention sweep pattern catch it
   * (Decision 8). The status commit is the durable fact; this purge follows
   * it and is best-effort, never the reverse order.
   */
  private async purgeSelfie(profileId: string, objectPath: string | null): Promise<void> {
    if (!objectPath) {
      return
    }
    try {
      await this.storage.remove([objectPath])
    } catch (error) {
      this.logger.warn(
        { error, profileId },
        'Failed to purge palette selfie object; retention sweep will retry'
      )
      return
    }
    await this.prisma.paletteProfile
      .updateMany({
        where: { id: profileId },
        data: { selfie_purged_at: new Date() },
      })
      .catch(() => undefined)
  }

  private async emitCompletion(
    profile: ProcessablePaletteProfile,
    result: AnalysisResult
  ): Promise<void> {
    try {
      await this.telemetry.captureEvent(profile.user_id, 'palette_analysis_completed', {
        source: profile.source ?? 'wardrobe',
        undertone: result.outcome === 'ready' ? result.undertone : null,
        depth: result.outcome === 'ready' ? result.depth : null,
        outcome: result.outcome,
      })
    } catch (error) {
      this.logger.warn(
        { error, profileId: profile.id },
        'Palette analysis telemetry emission failed (fail-open)'
      )
    }
  }

  async process(paletteProfileId: string): Promise<void> {
    const startedAt = Date.now()
    const profile = await this.prisma.paletteProfile.findUnique({
      where: { id: paletteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }

    const result: AnalysisResult =
      profile.source === 'wardrobe'
        ? await this.analyzeWardrobe(profile.user_id)
        : await this.analyzeSelfie(profile.selfie_object_path)

    // Status commit FIRST, purge SECOND (Decision 8): a crash between them
    // must leave the row in a terminal state with bytes still present,
    // never `processing` with the bytes already gone.
    const applied =
      result.outcome === 'ready'
        ? await this.prisma.paletteProfile.updateMany({
            where: { id: profile.id, status: 'processing' },
            data: {
              status: 'ready',
              failure_reason: null,
              undertone: result.undertone,
              depth: result.depth,
              confidence: result.confidence,
              analysis_version: ADVISOR_RULES_VERSION,
              analyzed_at: new Date(),
            },
          })
        : await this.prisma.paletteProfile.updateMany({
            where: { id: profile.id, status: 'processing' },
            data: { status: 'failed', failure_reason: result.outcome },
          })

    if (applied.count === 1) {
      await this.purgeSelfie(profile.id, profile.selfie_object_path)
      await this.emitCompletion(profile, result)
    }

    this.logCompletion(profile.id, startedAt, result.outcome, applied.count === 1)
  }

  /**
   * The third terminal door (Decision 8): reached from the worker's
   * retry-exhaustion catch block on the FINAL attempt only, which never
   * enters `process()`'s body at all. Purges exactly like the two branches
   * above -- a purge written only inside `process()` would leak every selfie
   * whose analysis exhausts its retries.
   */
  async markFailed(
    paletteProfileId: string,
    reason: Extract<PaletteAnalysisFailureReason, 'timeout' | 'storage_error'>
  ): Promise<void> {
    const profile = await this.prisma.paletteProfile.findUnique({
      where: { id: paletteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }

    const applied = await this.prisma.paletteProfile.updateMany({
      where: { id: paletteProfileId, status: 'processing' },
      data: { status: 'failed', failure_reason: reason },
    })

    if (applied.count === 1) {
      await this.purgeSelfie(profile.id, profile.selfie_object_path)
      await this.emitCompletion(profile, { outcome: reason })
    }
  }

  private logCompletion(
    paletteProfileId: string,
    startedAt: number,
    outcome: string,
    applied: boolean
  ): void {
    const logContext = {
      applied,
      durationMs: Date.now() - startedAt,
      outcome,
      paletteProfileId,
    }
    if (applied) {
      this.logger.info(logContext, 'Palette analysis processing completed')
    } else {
      this.logger.warn(logContext, 'Palette analysis processing completed')
    }
  }
}
