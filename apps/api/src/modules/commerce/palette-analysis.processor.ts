// Story 5.4 Task 6 step 2 owner: own the terminal branches, the purge and the telemetry in `apps/api/src/modules/commerce/palette-analysis.processor.ts`, enqueued through `apps/api/src/modules/commerce/palette-analysis-processing.queue.ts` and registered in `apps/api/src/config/queues.ts` and `apps/api/src/workers/wardrobe.bootstrap.ts`
// Story 5.4 Task 6: BullMQ processor for palette analysis (both sources),
// mirroring silhouette-photo.processor.ts's shape.
import { type PaletteProfile, type Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  chroma,
  classifyUndertone,
  hueAngleDegrees,
  hueAngleInterquartileSpread,
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
import type {
  PaletteAnalysisEngine,
  SelfieAnalysisOutcome,
} from './palette-analysis.engine.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import { WardrobeObjectDeletionOutbox } from '../wardrobe/wardrobe-object-deletion.outbox.js'
import { isOwnSessionObject } from '../wardrobe/wardrobe-upload-paths.js'
import { ambiguousPublicationHorizon } from '../wardrobe/wardrobe-publication.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

type ProcessablePaletteProfile = PaletteProfile & { status: 'processing' }

function isProcessableProfile(
  profile: PaletteProfile | null
): profile is ProcessablePaletteProfile {
  return profile?.status === 'processing'
}

/**
 * The attempt the 2026-11-19 migration gave every wardrobe analysis that was already processing
 * at deploy: such an analysis has no recoverable attempt, and the hourly handoff enqueues it as
 * `<profileId>__legacy-wardrobe-analysis`.
 */
export const LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID = 'legacy-wardrobe-analysis'

/**
 * True when the profile is processing the analysis `attemptId` names (the job's own, read from
 * its job id). The profile's recorded attempt must match exactly; a job that names no attempt
 * counts as the legacy wardrobe attempt, so it can only finish or fail a profile the migration
 * gave that attempt. A profile with no recorded attempt is matched only on its selfie session.
 * Anything else is another attempt the job must not touch, including an older wardrobe job for
 * the same profile.
 */
function isJobAttempt(
  profile: ProcessablePaletteProfile,
  attemptId: string | null
): boolean {
  if (profile.analysis_attempt_id) {
    return (
      profile.analysis_attempt_id === (attemptId ?? LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID)
    )
  }
  return (
    attemptId !== null &&
    profile.source === 'selfie' &&
    profile.selfie_upload_session_id === attemptId
  )
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

/**
 * The spread is CIRCULAR (`hueAngleInterquartileSpread`), which matters more
 * here than on the selfie path. Garment colours routinely straddle CIELAB's
 * 0/360 wrap -- magentas and fuchsias sit just below 360, reds, corals and
 * pinks just above 0 -- and a linear interquartile range reads that tight
 * cluster as near-total disagreement, refusing a wardrobe whose colours in
 * fact agree.
 */
function hueTightness(hueAngles: readonly number[]): number {
  const iqr = hueAngleInterquartileSpread(hueAngles)
  return Math.max(0, 1 - iqr / HUE_IQR_ZERO_CONFIDENCE)
}

export class PaletteAnalysisProcessor {
  private readonly logger = createBaseLogger().child({
    feature: 'palette-analysis-processing',
  })

  private readonly deletions: WardrobeObjectDeletionOutbox

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: WardrobeStorage,
    private readonly engine: PaletteAnalysisEngine,
    private readonly telemetry: TelemetryService
  ) {
    this.deletions = new WardrobeObjectDeletionOutbox(prisma, storage)
  }

  /**
   * Every terminal write is fenced on the attempt the job belongs to: the processing status, the
   * source, the analysis attempt and the selfie session, as read once the job matched them. A job
   * that finishes after the member replaced the selfie or started another analysis cannot apply
   * its result to, fail, or purge the newer attempt.
   */
  private attemptGuard(profile: ProcessablePaletteProfile) {
    return {
      id: profile.id,
      status: 'processing' as const,
      source: profile.source,
      analysis_attempt_id: profile.analysis_attempt_id,
      selfie_upload_session_id: profile.selfie_upload_session_id,
    }
  }

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

  private async analyzeSelfie(profile: {
    id: string
    user_id: string
    selfie_object_path: string | null
    selfie_upload_session_id: string | null
  }): Promise<AnalysisResult> {
    const objectPath = profile.selfie_object_path
    if (!objectPath) {
      return { outcome: 'storage_error' }
    }
    // The path column was member-writable before the 2026-11-19 revoke migration: never read
    // an object that is not this member's own selfie for this very session.
    if (
      !isOwnSessionObject(
        objectPath,
        profile.user_id,
        'palette',
        profile.selfie_upload_session_id
      )
    ) {
      this.logger.error({ profileId: profile.id }, 'palette_selfie_path_not_own')
      return { outcome: 'storage_error' }
    }
    // A genuine storage/timeout fault propagates here so BullMQ's existing
    // retry/backoff engages (mirrors silhouette-photo.processor.ts's
    // deliberate non-catching of download failures).
    const bytes = await this.storage.download(objectPath)

    // The DECODE, unlike the download above, is caught.
    //
    // The upload route already decoded these bytes: `verifyGarmentImage` runs
    // `sharp().metadata()` and `.stats()` at PUT time under the same 4096-pixel
    // limit and rejects anything that fails, so the common cases -- a file that
    // is not an image, a lying `mimeType`, an oversized frame -- never reach
    // here. What remains is the narrower window between the two decodes: an
    // object that comes back from storage truncated or corrupted, or a codec
    // path `.metadata()`/`.stats()` accepts and `.resize().raw()` does not.
    //
    // Narrow, but DETERMINISTIC, and that is what makes the catch load-bearing.
    // Left to propagate, such a throw repeats identically on every BullMQ
    // attempt, burns the whole retry budget on an input that can never succeed,
    // and then terminates through `markFailed` as `timeout` or `storage_error`
    // -- telling the user the service was slow or the storage broke when their
    // photo was in fact unreadable. `low_quality` is the honest terminal
    // answer, its copy ("too dim, too filtered or too uneven") already asks for
    // another photo, and the bytes are still purged either way.
    let verdict: SelfieAnalysisOutcome
    try {
      verdict = await this.engine.analyzeSelfie(bytes)
    } catch (error) {
      this.logger.warn(
        { error },
        'Palette selfie could not be decoded; terminating low_quality'
      )
      return { outcome: 'low_quality' }
    }

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
   * The selfie object this attempt must purge, or null: only for a selfie analysis, and only when
   * the path is this member's own selfie for this very session (the path column was
   * member-writable before the 2026-11-19 revoke migration).
   */
  private selfieToPurge(profile: ProcessablePaletteProfile): string | null {
    const objectPath = profile.selfie_object_path
    if (!objectPath) return null
    if (
      !isOwnSessionObject(
        objectPath,
        profile.user_id,
        'palette',
        profile.selfie_upload_session_id
      )
    ) {
      this.logger.error(
        { profileId: profile.id },
        'palette_selfie_path_not_own_purge_skipped'
      )
      return null
    }
    return objectPath
  }

  /**
   * The terminal write and the selfie's deletion obligation, in one transaction (Decision 8): the
   * guarded status update, the outbox row for the selfie key and `selfie_purged_at`, which now
   * means the deletion is durably scheduled. An outbox failure fails the transaction, so the
   * status never turns terminal with the obligation lost, and BullMQ's retry finds the profile
   * still processing. The object itself is removed after the commit, and the hourly maintenance
   * job retries that removal if it fails or the worker stops first.
   */
  private async applyTerminal(
    profile: ProcessablePaletteProfile,
    data: Prisma.PaletteProfileUpdateManyMutationInput
  ): Promise<boolean> {
    const selfiePath = this.selfieToPurge(profile)
    const applied = await interactiveTransaction(this.prisma, async (tx) => {
      const result = await tx.paletteProfile.updateMany({
        where: this.attemptGuard(profile),
        data: selfiePath ? { ...data, selfie_purged_at: new Date() } : data,
      })
      if (result.count === 1 && selfiePath) {
        // A commit attempt whose claim was taken over (or whose lease ran out before the
        // successful one) may still write this key after the purge: repeat the removal until
        // the horizon the session's claims recorded.
        const horizon = ambiguousPublicationHorizon({
          attemptId: profile.selfie_publish_attempt_id,
          startedAt: profile.selfie_publish_started_at,
          committable: false,
          cleanupUntil: profile.selfie_publish_cleanup_until,
        })
        if (horizon) {
          await this.deletions.recordRepeating(tx, [selfiePath], 'selfie_purged', horizon)
        } else {
          await this.deletions.record(tx, [selfiePath], 'selfie_purged')
        }
      }
      return result.count === 1
    })
    if (applied && selfiePath) {
      await this.deletions.removeNow([selfiePath])
    }
    return applied
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

  /**
   * `attemptId` is the analysis the job was enqueued for, read from its deterministic job id
   * (`paletteAttemptFromJobId`). A job whose attempt is not the one the profile is processing
   * exits without writing anything.
   */
  async process(paletteProfileId: string, attemptId: string | null): Promise<void> {
    const startedAt = Date.now()
    const profile = await this.prisma.paletteProfile.findUnique({
      where: { id: paletteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }
    if (!isJobAttempt(profile, attemptId)) {
      // The member replaced the selfie or started another analysis since this job was
      // enqueued; that attempt's own job handles it.
      this.logCompletion(profile.id, startedAt, 'superseded', false)
      return
    }

    const result: AnalysisResult =
      profile.source === 'wardrobe'
        ? await this.analyzeWardrobe(profile.user_id)
        : await this.analyzeSelfie(profile)

    // Status and the purge obligation commit together, the removal follows (Decision 8): a
    // crash in between leaves a terminal row whose selfie the deletion outbox still owes,
    // never `processing` with the bytes already gone.
    const applied = await this.applyTerminal(
      profile,
      result.outcome === 'ready'
        ? {
            status: 'ready',
            failure_reason: null,
            undertone: result.undertone,
            depth: result.depth,
            confidence: result.confidence,
            analysis_version: ADVISOR_RULES_VERSION,
            analyzed_at: new Date(),
          }
        : { status: 'failed', failure_reason: result.outcome }
    )

    if (applied) {
      await this.emitCompletion(profile, result)
    }

    this.logCompletion(profile.id, startedAt, result.outcome, applied)
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
    reason: Extract<PaletteAnalysisFailureReason, 'timeout' | 'storage_error'>,
    attemptId: string | null
  ): Promise<void> {
    const profile = await this.prisma.paletteProfile.findUnique({
      where: { id: paletteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }
    if (!isJobAttempt(profile, attemptId)) {
      // Retry exhaustion of another attempt: the current one is not this job's to fail.
      return
    }

    const applied = await this.applyTerminal(profile, {
      status: 'failed',
      failure_reason: reason,
    })

    if (applied) {
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
