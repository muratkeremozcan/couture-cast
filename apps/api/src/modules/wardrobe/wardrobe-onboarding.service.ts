// Story 4.4 Task 3: server-authoritative onboarding step state machine
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PreconditionFailedException,
} from '@nestjs/common'
import { Prisma, PrismaClient, type WardrobeOnboardingState } from '@prisma/client'
import {
  type UpdateWardrobeOnboardingStateInput,
  type WardrobeOnboardingStateResponse,
  type WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import {
  trackWardrobeOnboardingCompleted,
  trackWardrobeOnboardingStarted,
} from '@couture/api-client'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'

/** The strong entity tag this API issues and accepts: `"onboarding:<userId>:<revision>"`. */
export function formatOnboardingETag(userId: string, revision: number): string {
  return `"onboarding:${userId}:${revision}"`
}

const VIRTUAL_STATE: Pick<
  WardrobeOnboardingState,
  | 'status'
  | 'current_step'
  | 'used_starter_wardrobe'
  | 'garments_captured_count'
  | 'started_at'
  | 'completed_at'
> & { revision: number } = {
  status: 'not_started',
  current_step: 'permission',
  used_starter_wardrobe: false,
  garments_captured_count: 0,
  started_at: null,
  completed_at: null,
  revision: 0,
}

/**
 * Parses `If-Match` against the ETag this API actually issues. Returns the
 * expected revision, or `null` for `*`. Mirrors `parseIfMatchHeader` from
 * `wardrobe-capsule.service.ts`, keyed by userId instead of a resource id
 * since onboarding state is a singleton per user.
 */
export function parseOnboardingIfMatchHeader(
  ifMatchHeader: string | undefined,
  userId: string
): number | null {
  if (!ifMatchHeader || ifMatchHeader.trim().length === 0) {
    throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
  }

  const raw = ifMatchHeader.trim()
  if (raw === '*') {
    return null
  }

  const candidates = raw.split(',').map((entry) => entry.trim())

  for (const candidate of candidates) {
    if (/^W\//i.test(candidate)) {
      continue
    }

    const match = /^"onboarding:(.+):(\d+)"$/.exec(candidate)
    if (!match) {
      continue
    }

    const [, taggedUserId, revisionText] = match
    if (taggedUserId !== userId) {
      continue
    }

    const revision = Number(revisionText)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      continue
    }

    return revision
  }

  throw new PreconditionFailedException('ONBOARDING_REVISION_MISMATCH')
}

/**
 * Forward-only step order (decision 3). The starter-wardrobe skip path moves
 * capture -> silhouette directly, bypassing tagging.
 */
const FORWARD_TRANSITIONS: Record<WardrobeOnboardingStep, WardrobeOnboardingStep[]> = {
  permission: ['capture'],
  capture: ['tagging', 'silhouette'],
  tagging: ['silhouette'],
  silhouette: ['complete'],
  complete: [],
}

function assertValidTransition(
  fromStep: WardrobeOnboardingStep,
  toStep: WardrobeOnboardingStep,
  usedStarterWardrobe: boolean
): void {
  const allowed = FORWARD_TRANSITIONS[fromStep]
  if (!allowed.includes(toStep)) {
    throw new ConflictException('INVALID_STEP_TRANSITION')
  }
  if (fromStep === 'capture' && toStep === 'silhouette' && !usedStarterWardrobe) {
    // Skipping tagging is only valid via the explicit starter-wardrobe path.
    throw new ConflictException('INVALID_STEP_TRANSITION')
  }
  if (fromStep === 'capture' && toStep === 'tagging' && usedStarterWardrobe) {
    // A caller that chose the starter wardrobe cannot also enter tagging.
    throw new ConflictException('INVALID_STEP_TRANSITION')
  }
}

function toResponse(row: {
  status: WardrobeOnboardingState['status']
  current_step: WardrobeOnboardingStep
  used_starter_wardrobe: boolean
  garments_captured_count: number
  started_at: Date | null
  completed_at: Date | null
  revision: number
}): WardrobeOnboardingStateResponse {
  return {
    data: {
      status: row.status,
      currentStep: row.current_step,
      usedStarterWardrobe: row.used_starter_wardrobe,
      garmentsCapturedCount: row.garments_captured_count,
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      revision: row.revision,
    },
  }
}

type AdvanceResult = {
  response: WardrobeOnboardingStateResponse
  isNoOp: boolean
}

type TransitionOutcome = {
  row: WardrobeOnboardingState
  isNoOp: boolean
}

@Injectable()
export class WardrobeOnboardingService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-onboarding' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient
  ) {}

  async getState(userId: string): Promise<{
    response: WardrobeOnboardingStateResponse
    etag: string
  }> {
    const row = await this.prisma.wardrobeOnboardingState.findUnique({
      where: { user_id: userId },
    })

    if (!row) {
      return {
        response: toResponse(VIRTUAL_STATE),
        etag: formatOnboardingETag(userId, VIRTUAL_STATE.revision),
      }
    }

    return {
      response: toResponse(row),
      etag: formatOnboardingETag(userId, row.revision),
    }
  }

  /**
   * Advances the state machine by one forward-only step. Locked via a
   * Postgres advisory transaction lock keyed on the user id, which
   * serializes concurrent callers whether or not a row exists yet -- a plain
   * `SELECT ... FOR UPDATE` (the pattern `wardrobe-capsule.locks.ts` uses)
   * cannot lock a row that does not exist, and the very first PATCH for a
   * user always starts from that no-row state.
   */
  async advanceStep(
    userId: string,
    ifMatchHeader: string | undefined,
    input: UpdateWardrobeOnboardingStateInput
  ): Promise<AdvanceResult> {
    const expectedRevision = parseOnboardingIfMatchHeader(ifMatchHeader, userId)
    const usedStarterWardrobe = input.usedStarterWardrobe ?? false

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wardrobe_onboarding:' || ${userId}))`

      const existing = await tx.wardrobeOnboardingState.findUnique({
        where: { user_id: userId },
      })

      return existing
        ? this.advanceExistingState(
            tx,
            userId,
            existing,
            expectedRevision,
            input,
            usedStarterWardrobe
          )
        : this.createFirstState(tx, userId, expectedRevision, input, usedStarterWardrobe)
    })

    if (!result.isNoOp) {
      await this.emitTelemetry(userId, result.row)
    }

    return { response: toResponse(result.row), isNoOp: result.isNoOp }
  }

  private async createFirstState(
    tx: Prisma.TransactionClient,
    userId: string,
    expectedRevision: number | null,
    input: UpdateWardrobeOnboardingStateInput,
    usedStarterWardrobe: boolean
  ): Promise<TransitionOutcome> {
    if (expectedRevision !== null && expectedRevision !== VIRTUAL_STATE.revision) {
      throw new PreconditionFailedException('ONBOARDING_REVISION_MISMATCH')
    }
    assertValidTransition(
      VIRTUAL_STATE.current_step,
      input.targetStep,
      usedStarterWardrobe
    )

    const reachesSilhouette =
      input.targetStep === 'silhouette' || input.targetStep === 'complete'
    const garmentsCapturedCount = reachesSilhouette
      ? await this.countCapturedGarments(tx, userId, new Date())
      : 0
    const now = new Date()
    const created = await tx.wardrobeOnboardingState.create({
      data: {
        user_id: userId,
        status: input.targetStep === 'complete' ? 'completed' : 'in_progress',
        current_step: input.targetStep,
        used_starter_wardrobe: usedStarterWardrobe,
        garments_captured_count: garmentsCapturedCount,
        started_at: now,
        completed_at: input.targetStep === 'complete' ? now : null,
        revision: 1,
      },
    })
    return { row: created, isNoOp: false }
  }

  private async advanceExistingState(
    tx: Prisma.TransactionClient,
    userId: string,
    existing: WardrobeOnboardingState,
    expectedRevision: number | null,
    input: UpdateWardrobeOnboardingStateInput,
    usedStarterWardrobe: boolean
  ): Promise<TransitionOutcome> {
    if (expectedRevision !== null && existing.revision !== expectedRevision) {
      throw new PreconditionFailedException('ONBOARDING_REVISION_MISMATCH')
    }

    const isIdenticalReplay =
      existing.current_step === input.targetStep &&
      existing.used_starter_wardrobe === usedStarterWardrobe
    if (isIdenticalReplay) {
      return { row: existing, isNoOp: true }
    }

    assertValidTransition(existing.current_step, input.targetStep, usedStarterWardrobe)

    const shouldRecomputeGarmentCount =
      input.targetStep === 'silhouette' && existing.current_step !== 'silhouette'
    const garmentsCapturedCount = shouldRecomputeGarmentCount
      ? await this.countCapturedGarments(tx, userId, existing.started_at ?? new Date())
      : existing.garments_captured_count

    const now = new Date()
    const updated = await tx.wardrobeOnboardingState.update({
      where: { user_id: userId },
      data: {
        current_step: input.targetStep,
        used_starter_wardrobe: usedStarterWardrobe,
        status: input.targetStep === 'complete' ? 'completed' : 'in_progress',
        completed_at: input.targetStep === 'complete' ? now : existing.completed_at,
        garments_captured_count: garmentsCapturedCount,
        revision: { increment: 1 },
      },
    })
    return { row: updated, isNoOp: false }
  }

  /**
   * Server-authoritative garment count: counts the user's committed garments
   * rather than trusting a client-supplied number (decision 3's
   * server-authoritative principle). Recomputed once, when the capture/
   * tagging loop finishes (any transition landing on `silhouette`), and left
   * untouched afterward.
   */
  private async countCapturedGarments(
    tx: Prisma.TransactionClient,
    userId: string,
    since: Date
  ): Promise<number> {
    return tx.garmentItem.count({
      where: {
        user_id: userId,
        upload_status: { in: ['awaiting_tags', 'ready'] },
        retention_status: 'active',
        created_at: { gte: since },
      },
    })
  }

  /**
   * Emits `wardrobe_onboarding_started` at most once (guarded by
   * `started_telemetry_emitted_at`) and `wardrobe_onboarding_completed` at
   * most once (guarded by `completed_telemetry_emitted_at`). Both guards are
   * necessary, not just row creation: a crash between commit and emission
   * followed by an identical-payload replay must not re-emit, and must not
   * silently drop the event forever either -- the guard column keeps the
   * emission checkable and retryable independent of the state transition.
   */
  private async emitTelemetry(
    userId: string,
    row: WardrobeOnboardingState
  ): Promise<void> {
    try {
      const startedClaim = await this.prisma.wardrobeOnboardingState.updateMany({
        where: { user_id: userId, started_telemetry_emitted_at: null },
        data: { started_telemetry_emitted_at: new Date() },
      })
      if (startedClaim.count === 1) {
        this.analyticsClient.capture(
          trackWardrobeOnboardingStarted({
            analyticsSubjectId: userId,
            timestamp: new Date().toISOString(),
          })
        )
      }
    } catch (error) {
      this.logger.error(
        { error, userId, message: 'wardrobe_onboarding_started_emit_failed' },
        'Failed to emit wardrobe_onboarding_started telemetry'
      )
    }

    if (row.current_step !== 'complete') {
      return
    }

    try {
      const completedClaim = await this.prisma.wardrobeOnboardingState.updateMany({
        where: { user_id: userId, completed_telemetry_emitted_at: null },
        data: { completed_telemetry_emitted_at: new Date() },
      })
      if (completedClaim.count !== 1) {
        return
      }

      const silhouette = await this.prisma.silhouetteProfile.findUnique({
        where: { user_id: userId },
        select: { mode: true },
      })
      const durationMs =
        row.started_at && row.completed_at
          ? Math.max(0, row.completed_at.getTime() - row.started_at.getTime())
          : 0

      this.analyticsClient.capture(
        trackWardrobeOnboardingCompleted({
          analyticsSubjectId: userId,
          durationMs,
          usedStarterWardrobe: row.used_starter_wardrobe,
          garmentCount: row.garments_captured_count,
          silhouetteMode: silhouette?.mode ?? 'default_mannequin',
          timestamp: new Date().toISOString(),
        })
      )
    } catch (error) {
      this.logger.error(
        { error, userId, message: 'wardrobe_onboarding_completed_emit_failed' },
        'Failed to emit wardrobe_onboarding_completed telemetry'
      )
    }
  }
}
