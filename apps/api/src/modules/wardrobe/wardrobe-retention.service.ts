import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { Prisma, PrismaClient, type GarmentItem } from '@prisma/client'

import {
  buildGarmentObjectPath,
  buildWardrobeHeldObjectPath,
  buildWardrobeObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
  isWardrobeUuid,
  parseWardrobeHeldObjectPath,
  parseWardrobeStagingObjectPath,
  type GarmentObjectExtension,
} from '@couture/utils'

import { SIGNED_UPLOAD_LIFETIME_MS } from '../../common/signed-upload-expiry'
import { createBaseLogger } from '../../logger/pino.config'
import {
  RITUAL_CACHE_INVALIDATOR,
  type RitualCacheInvalidator,
} from '../personalization/ritual-cache'
import {
  SupabaseWardrobeStorageAdapter,
  type StagedUploadPage,
} from './wardrobe-storage.adapter'
import { lockCapsules, lockGarments, lockOwnerProfile } from './wardrobe-capsule.locks'
import {
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentMimeType,
} from './wardrobe-image-validation'
import { WardrobeObjectDeletionOutbox } from './wardrobe-object-deletion.outbox'
import { isOwnGarmentObject, objectExtensionFor } from './wardrobe-upload-paths'
import {
  FLAT_LAY_RESERVATION_PREFIX,
  ambiguousPublicationHorizon,
  isFlatLayReservation,
  publicationCleanupHorizon,
  staleClaimCutoff,
} from './wardrobe-publication'
import {
  WARDROBE_PROCESSING_HANDOFFS,
  reenqueueStrandedProcessing,
  type MaintenanceScope,
  type ProcessingHandoffPublishers,
} from './wardrobe-processing-handoff'
import {
  interactiveTransaction,
  singleRunTransaction,
} from '../../prisma/prisma-client.js'

const ABANDONED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100
/** Each capture downloads up to 10 MiB, so one run takes a small batch. */
const HELD_SOURCE_CAPTURE_BATCH_SIZE = 20
const ALLOWED_GARMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * What one held pending garment's source capture found; see `captureHeldSources`. Every value
 * except `released` is stored in `GarmentItem.held_source_capture_outcome` for the operator.
 */
export type HeldSourceCapture =
  | 'captured'
  | 'missing'
  | 'digest_mismatch'
  | 'copy_mismatch'
  | 'invalid'
  | 'failed'
  | 'released'

/** The held copy's write and digest record hold the garment row lock across one upload. */
const HELD_SOURCE_WRITE_TIMEOUT_MS = 30 * 1000

/**
 * A staged upload this old can no longer be committed (sessions last 15 minutes) and no signed
 * URL can still write it (tokens last `SIGNED_UPLOAD_LIFETIME_MS`); the margin covers a request
 * that started just before its token expired.
 */
export const STAGED_UPLOAD_RETENTION_MS = SIGNED_UPLOAD_LIFETIME_MS + 15 * 60 * 1000
const STAGING_SWEEP_MAX_BATCHES = 10
/** Where the staging sweep's listing continues on the next run; see `purgeStaleStagedUploads`. */
export const STAGING_SWEEP_CURSOR_KEY = 'staging_sweep_cursor'

@Injectable()
export class WardrobeRetentionService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-retention' })
  private readonly deletions: WardrobeObjectDeletionOutbox

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(RITUAL_CACHE_INVALIDATOR)
    private readonly ritualCache: RitualCacheInvalidator,
    /**
     * The queue producers the hourly job re-enqueues stranded processing photos with. Only the
     * worker runtime runs that job and provides them; the request app leaves them out.
     */
    @Optional()
    @Inject(WARDROBE_PROCESSING_HANDOFFS)
    private readonly processingHandoffs?: ProcessingHandoffPublishers
  ) {
    this.deletions = new WardrobeObjectDeletionOutbox(prisma, storage)
  }

  /**
   * A member's deletion request. A request on a garment of another member, or on one that does
   * not exist, changes nothing. Under a legal hold the request is recorded on the row
   * (`deletion_requested_at`, `retention_trigger`) and the hold stays; the database trigger
   * `garment_hold_release_honours_deletion` turns the release of such a row into
   * `deletion_pending`, and the hourly sweep purges it (Story CC-7.6 D4). Otherwise the row
   * flips to `deletion_pending` and its bytes are purged at once; a purge that throws after the
   * flip committed is logged and left to the hourly sweep (D5), so the member's request still
   * succeeds. A repeated request is idempotent.
   */
  async requestDeletion(
    userId: string,
    garmentId: string,
    trigger = 'user_deleted_garment'
  ): Promise<void> {
    const garment = await this.prisma.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })
    if (!garment || garment.retention_purged_at) {
      return
    }

    /**
     * The availability flip runs under the shared lock order rather than as a
     * bare update. Capsule creation validates garment eligibility while holding
     * these same locks, so an unlocked flip here would let a capsule be built
     * from a garment that is being deleted in the same instant. The legal-hold
     * record takes the same locks, so a release racing it sees one or the other.
     */
    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await lockOwnerProfile(tx, userId)

      const affectedCapsules = await tx.outfitCapsule.findMany({
        where: { user_id: userId, garment_joins: { some: { garment_id: garment.id } } },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      await lockCapsules(
        tx,
        userId,
        affectedCapsules.map((capsule) => capsule.id)
      )
      await lockGarments(tx, userId, [garment.id])

      const requestedAt = new Date()
      const flipped = await tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          user_id: userId,
          retention_status: 'active',
          retention_purged_at: null,
        },
        data: {
          retention_status: 'deletion_pending',
          retention_trigger: trigger,
          deletion_requested_at: requestedAt,
        },
      })
      if (flipped.count === 1) return { claimed: true as const, trigger }

      // A pending row whose purge has not finished (a released hold, a failed purge, a
      // guardian revocation) keeps its first recorded request and reason; the repeat only
      // retries the purge. A purged row stays as it is.
      const pending = await tx.garmentItem.findFirst({
        where: {
          id: garment.id,
          user_id: userId,
          retention_status: 'deletion_pending',
          retention_purged_at: null,
        },
        select: { retention_trigger: true },
      })
      if (pending) {
        return { claimed: true as const, trigger: pending.retention_trigger ?? trigger }
      }

      // Under a hold: record the request once and leave the hold as it is. An already purged
      // row matches neither update.
      await tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          user_id: userId,
          retention_status: 'legal_hold',
          deletion_requested_at: null,
        },
        data: {
          retention_trigger: trigger,
          deletion_requested_at: requestedAt,
        },
      })
      return { claimed: false as const }
    })

    if (!outcome.claimed) {
      return
    }
    await this.invalidateRitualCache(userId, garment.id)
    try {
      await this.purgeGarment({
        ...garment,
        retention_status: 'deletion_pending',
        retention_trigger: outcome.trigger,
      })
    } catch (error) {
      // The flip committed, so the list and every reader already treat the garment as gone;
      // the hourly sweep picks up the `deletion_pending` row and finishes the purge.
      this.logger.error(
        {
          garmentId: garment.id,
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        },
        'wardrobe_retention_purge_deferred'
      )
    }
  }

  /**
   * Triggered by the `wardrobe-retention-purge` BullMQ Job Scheduler in the worker
   * runtime (`workers/maintenance.scheduler.ts`). It used to carry
   * `@Cron(CronExpression.EVERY_HOUR)`, which never fired in a deployed
   * environment: the API is a Vercel serverless function with no long-lived
   * process to hold the timer between ticks.
   */
  async purgeExpiredAndDeletedGarments(): Promise<void> {
    const now = new Date()
    const abandonedBefore = new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS)
    const expiredFlatLay: Prisma.GarmentItemWhereInput = {
      upload_status: 'pending_upload',
      upload_idempotency_key: { startsWith: FLAT_LAY_RESERVATION_PREFIX },
      upload_expires_at: { lte: now },
      OR: [
        { publish_attempt_id: null },
        { publish_started_at: null },
        { publish_started_at: { lte: staleClaimCutoff(now) } },
      ],
    }
    const candidates = await this.prisma.garmentItem.findMany({
      where: {
        retention_status: { not: 'legal_hold' },
        retention_purged_at: null,
        OR: [
          { retention_status: 'deletion_pending' },
          {
            upload_status: { in: ['pending_upload', 'bytes_uploaded'] },
            created_at: { lte: abandonedBefore },
            upload_expires_at: { lte: now },
          },
          expiredFlatLay,
        ],
      },
      orderBy: { created_at: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    })

    for (const garment of candidates) {
      const flatLay = isFlatLayReservation(garment.upload_idempotency_key)
      const claimed = await this.prisma.garmentItem.updateMany({
        where: {
          id: garment.id,
          retention_status: { not: 'legal_hold' },
          // A flat-lay publish may have succeeded since the candidate read.
          ...(flatLay && {
            retention_purged_at: null,
            OR: [{ retention_status: 'deletion_pending' }, expiredFlatLay],
          }),
        },
        data: {
          retention_status: 'deletion_pending',
          retention_trigger: garment.retention_trigger ?? 'abandoned_upload',
          deletion_requested_at: garment.deletion_requested_at ?? now,
        },
      })
      if (flatLay && claimed.count === 0) continue
      if (claimed.count === 1) {
        await this.invalidateRitualCache(garment.user_id, garment.id)
      }

      await this.purgeGarment(garment).catch((error: unknown) => {
        this.logger.error(
          { error, garmentId: garment.id },
          'wardrobe_retention_purge_failed'
        )
      })
    }

    // The same hourly job captures held sources, removes held copies whose hold ended, sweeps
    // the staging folder and re-enqueues processing photos whose job handoff never happened.
    // Recorded deletions drain on their own 15-minute schedule (`drainDeletions`). Each step
    // runs whatever the others do. The first failure is raised afterwards, so the job records
    // it.
    const failures: unknown[] = []
    const step = async (name: string, work: () => Promise<unknown>) => {
      try {
        await work()
      } catch (error) {
        this.logger.error(
          {
            step: name,
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
          },
          'wardrobe_maintenance_step_failed'
        )
        failures.push(error)
      }
    }
    await step('held_source_capture', () => this.captureHeldSources(now))
    await step('held_copy_release', () => this.releaseUnheldCopies())
    await step('staging_sweep', () => this.purgeStaleStagedUploads(now))
    if (this.processingHandoffs) {
      const handoffs = this.processingHandoffs
      await step('processing_handoff', () =>
        reenqueueStrandedProcessing(this.prisma, handoffs, now)
      )
    }
    if (failures.length > 0) throw failures[0]
  }

  /**
   * Triggered every 15 minutes by the `wardrobe-deletion-drain` Job Scheduler, apart from the
   * hourly job: a repeating removal is due again 15 minutes after its last run, so a write that
   * lands late waits at most about two intervals (the row's next attempt plus the scheduler
   * tick), given a backlog under the batch size. Returns how many rows it settled.
   */
  async drainDeletions(now = new Date()): Promise<number> {
    return this.deletions.drainDue(now)
  }

  /**
   * Preserves the staged source of every pending garment under legal hold whose source is not
   * captured yet. Storage can admit two first transfers to one staging key before either
   * completes (local Supabase Storage v1.32.0 checks for an existing object at the start of an
   * upload and upserts at its end), so a transfer already admitted when the hold began could
   * still replace the staged bytes. The staged object is read through the size ceiling; when
   * its sha256 matches the garment's declaration, the server writes those exact bytes once, with
   * no upsert, to `held/<userId>/<garmentId>.<ext>` and records the digest. That key is never
   * signed and only the server writes it, so it keeps the declared bytes whatever later lands
   * on staging.
   *
   * Every attempt records its result in `held_source_capture_outcome` and
   * `held_source_checked_at`, the operator-visible state the Step 58 runbook names: a
   * `digest_mismatch` means the staged bytes no longer match the declaration (the accepted
   * residual risk C5-3, see deferred-work). Each run takes the garments checked least recently,
   * never-checked first, so garments that cannot be captured yet (no bytes, a mismatch, a storage
   * fault) rotate behind the others and never starve a capturable one. Returns how many sources
   * were captured.
   */
  async captureHeldSources(
    now = new Date(),
    scope: MaintenanceScope = {}
  ): Promise<number> {
    const garments = await this.prisma.garmentItem.findMany({
      where: {
        ...(scope.userIds ? { user_id: { in: [...scope.userIds] } } : {}),
        retention_status: 'legal_hold',
        upload_status: 'pending_upload',
        held_source_sha256: null,
        upload_session_id: { not: null },
      },
      orderBy: [
        { held_source_checked_at: { sort: 'asc', nulls: 'first' } },
        { created_at: 'asc' },
        { id: 'asc' },
      ],
      take: HELD_SOURCE_CAPTURE_BATCH_SIZE,
    })
    let captured = 0
    for (const garment of garments) {
      let outcome: HeldSourceCapture
      try {
        outcome = await this.captureHeldSource(garment)
      } catch (error) {
        this.logger.warn(
          {
            garmentId: garment.id,
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
          },
          'held_source_capture_failed'
        )
        outcome = 'failed'
      }
      if (outcome === 'captured') {
        captured += 1
        continue
      }
      if (outcome === 'released') continue
      await this.prisma.garmentItem
        .updateMany({
          where: { id: garment.id, held_source_sha256: null },
          data: { held_source_capture_outcome: outcome, held_source_checked_at: now },
        })
        .catch((error: unknown) => {
          this.logger.warn(
            {
              garmentId: garment.id,
              errorClass: error instanceof Error ? error.constructor.name : typeof error,
            },
            'held_source_capture_outcome_not_recorded'
          )
        })
    }
    return captured
  }

  /**
   * One garment's capture, in three steps. The staged bytes are read and checked first, with no
   * lock held. Then, under the garment row lock that purge and an operator's release (any update
   * of the row) also take, the held key is recorded as an obligation on the row before anything
   * is written, so a purge or a release removes it whether or not the digest marker is ever
   * recorded, a crash after the write included. Finally the copy is written and its digest
   * recorded under the same row lock, after checking that the hold still stands: a release or
   * purge that committed meanwhile is seen and nothing is written.
   */
  private async captureHeldSource(garment: GarmentItem): Promise<HeldSourceCapture> {
    if (
      !isWardrobePathSegment(garment.user_id) ||
      !isWardrobePathSegment(garment.id) ||
      !isWardrobeUuid(garment.upload_session_id) ||
      !garment.mime_type ||
      !ALLOWED_GARMENT_MIME_TYPES.has(garment.mime_type) ||
      !garment.content_sha256
    ) {
      this.logger.error({ garmentId: garment.id }, 'held_source_capture_invalid_row')
      return 'invalid'
    }
    const mimeType = garment.mime_type as GarmentMimeType
    const extension = objectExtensionFor(mimeType)
    const sessionId = garment.upload_session_id
    const declaredSha256 = garment.content_sha256
    const stagingPath = buildWardrobeStagingObjectPath(
      garment.user_id,
      'garment',
      sessionId,
      extension
    )
    const heldPath = buildWardrobeHeldObjectPath(garment.user_id, garment.id, extension)

    const staged = await this.storage.downloadBounded(
      stagingPath,
      MAX_GARMENT_IMAGE_BYTES
    )
    if (staged.status === 'missing') return 'missing'
    if (staged.status === 'too_large' || sha256(staged.bytes) !== declaredSha256) {
      this.logger.error({ garmentId: garment.id }, 'held_source_digest_mismatch')
      return 'digest_mismatch'
    }
    const bytes = staged.bytes

    const stillHeld = (row: GarmentItem | null): row is GarmentItem =>
      row !== null &&
      row.retention_status === 'legal_hold' &&
      row.upload_status === 'pending_upload' &&
      row.upload_session_id === sessionId &&
      row.content_sha256 === declaredSha256 &&
      row.held_source_sha256 === null

    // The obligation first, committed on its own: from here on a purge or release removes the
    // held key even if this run stops right after writing it. Its cleanup horizon goes with it
    // (final review F-4): the write below runs inside a 30-second transaction, and when that
    // transaction times out or this worker stops while storage is still applying the write, the
    // copy can land after a release or purge removed the key. The outbox repeats the key's
    // removal until this horizon, so such a write is removed whenever it lands.
    const obligated = await interactiveTransaction(this.prisma, async (tx) => {
      const locked = await lockHeldGarment(tx, garment)
      if (!stillHeld(locked)) return false
      const horizon = publicationCleanupHorizon(new Date())
      const recorded = locked.held_source_cleanup_until
      await tx.garmentItem.update({
        where: { id: garment.id },
        data: {
          held_source_object_path: heldPath,
          held_source_cleanup_until: recorded && recorded > horizon ? recorded : horizon,
        },
      })
      return true
    })
    if (!obligated) return 'released'

    return singleRunTransaction(
      this.prisma,
      async (tx) => {
        const locked = await lockHeldGarment(tx, garment)
        if (!stillHeld(locked) || locked.held_source_object_path !== heldPath) {
          return 'released'
        }
        const written = await this.storage.publishOnce(heldPath, bytes, mimeType)
        if (written === 'exists') {
          // An earlier run wrote the copy and stopped before recording it: keep it only when
          // it holds the declared bytes.
          const existing = await this.storage.downloadBounded(
            heldPath,
            MAX_GARMENT_IMAGE_BYTES
          )
          if (
            existing.status !== 'present' ||
            sha256(existing.bytes) !== declaredSha256
          ) {
            this.logger.error({ garmentId: garment.id }, 'held_source_copy_mismatch')
            return 'copy_mismatch'
          }
        }
        const capturedAt = new Date()
        await tx.garmentItem.update({
          where: { id: garment.id },
          data: {
            held_source_sha256: declaredSha256,
            held_source_captured_at: capturedAt,
            held_source_capture_outcome: 'captured',
            held_source_checked_at: capturedAt,
          },
        })
        this.logger.info({ garmentId: garment.id }, 'held_source_captured')
        return 'captured'
      },
      { timeout: HELD_SOURCE_WRITE_TIMEOUT_MS }
    )
  }

  /**
   * Removes the held copy of every garment whose legal hold has ended: the operator released it
   * (a plain update of the row), or a capture recorded its obligation and stopped. The key is
   * recorded in the deletion outbox and the digest cleared in one transaction under the garment
   * row lock; the outbox removes the object only while the garment is not held, repeating the
   * removal until the held copy's cleanup horizon (final review F-4).
   *
   * The held key itself stays on the garment until the outbox settles its removal, which clears
   * it (final review F-5): a hold reapplied before then makes the outbox drop its row and keep
   * the object, and the next release finds the key here again. A garment whose key already has
   * an outbox row is left to that row. Returns how many copies were released.
   */
  async releaseUnheldCopies(scope: MaintenanceScope = {}): Promise<number> {
    // Keys whose removal the outbox already owns (repeating until their horizon, or retrying):
    // their garments are left out of the page, so they never crowd out a release still owed.
    const outstanding = await this.prisma.wardrobeObjectDeletion.findMany({
      where: { object_path: { startsWith: 'held/' } },
      select: { object_path: true },
    })
    const garments = await this.prisma.garmentItem.findMany({
      where: {
        ...(scope.userIds ? { user_id: { in: [...scope.userIds] } } : {}),
        retention_status: { not: 'legal_hold' },
        OR: [
          {
            held_source_object_path: {
              not: null,
              notIn: outstanding.map((row) => row.object_path),
            },
          },
          { held_source_sha256: { not: null } },
        ],
      },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    })
    let released = 0
    for (const garment of garments) {
      try {
        const paths = await interactiveTransaction(this.prisma, async (tx) => {
          const locked = await lockHeldGarment(tx, garment)
          if (!locked || locked.retention_status === 'legal_hold') return []
          const heldPaths = heldCopyPaths(locked)
          const unrecorded: string[] = []
          for (const heldPath of heldPaths) {
            const pending = await tx.wardrobeObjectDeletion.findUnique({
              where: { object_path: heldPath },
            })
            if (!pending) unrecorded.push(heldPath)
          }
          if (unrecorded.length === 0 && locked.held_source_sha256 === null) return []
          await tx.garmentItem.update({
            where: { id: garment.id },
            data: {
              held_source_object_path: heldKeyToKeep(locked, heldPaths),
              held_source_sha256: null,
              held_source_captured_at: null,
            },
          })
          await this.deletions.record(tx, unrecorded, 'held_copy_released')
          return unrecorded
        })
        if (paths.length === 0) continue
        await this.deletions.removeNow(paths)
        released += 1
      } catch (error) {
        this.logger.warn(
          {
            garmentId: garment.id,
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
          },
          'held_copy_release_failed'
        )
      }
    }
    if (released > 0) this.logger.info({ released }, 'held_copies_released')
    return released
  }

  /**
   * Removes staged uploads nothing can commit any more: late writes on a signed URL whose garment,
   * My Form or selfie was deleted, replaced or purged, abandoned sessions, and staged objects a
   * failed removal left behind. No member can read a staged key meanwhile. Each key is parsed
   * for its owner, kind and session: a garment under legal hold keeps its staged bytes, and the
   * session's derived final key is recorded too, which covers a commit that published and then
   * never claimed. The deletion outbox judges every key against its row under a row lock before
   * removing it.
   *
   * Oldest first, a bounded number of pages per run, continuing where the previous run stopped:
   * held keys stay in the listing for good, and starting each run from the oldest would spend
   * every run's budget on them while newer abandoned photos waited forever. The continuation is
   * cleared once a run reaches objects too fresh to sweep, so the next pass starts again from
   * the oldest.
   */
  async purgeStaleStagedUploads(now = new Date()): Promise<number> {
    const cutoff = now.getTime() - STAGED_UPLOAD_RETENTION_MS
    let swept = 0
    let held = 0
    let cursor = await this.loadSweepCursor()
    let nextStart: string | null = null
    for (let batch = 0; batch < STAGING_SWEEP_MAX_BATCHES; batch += 1) {
      let page: StagedUploadPage
      try {
        page = await this.storage.listStagedUploads(CLEANUP_BATCH_SIZE, cursor)
      } catch (error) {
        // A continuation storage no longer honors would fail every run; start over next time.
        if (cursor) await this.saveSweepCursor(null)
        throw error
      }
      const stale = page.objects.filter((entry) => entry.createdAt.getTime() <= cutoff)
      if (stale.length > 0) {
        const plan = await this.planStagingRemoval(stale.map((entry) => entry.objectPath))
        held += plan.held
        await this.deletions.record(this.prisma, plan.paths, 'staging_swept')
        await this.deletions.removeNow(plan.paths)
        swept += stale.length - plan.held
      }
      // Sorted oldest first: a page with anything still fresh ends the stale run, and the next
      // pass starts from the oldest again.
      if (stale.length < page.objects.length || !page.nextCursor) {
        nextStart = null
        break
      }
      cursor = page.nextCursor
      nextStart = page.nextCursor
    }
    await this.saveSweepCursor(nextStart)
    if (swept > 0 || held > 0) {
      this.logger.info({ removed: swept, held }, 'wardrobe_staged_uploads_purged')
    }
    return swept
  }

  private async loadSweepCursor(): Promise<string | null> {
    const state = await this.prisma.wardrobeMaintenanceState.findUnique({
      where: { key: STAGING_SWEEP_CURSOR_KEY },
    })
    return state?.value ?? null
  }

  private async saveSweepCursor(value: string | null): Promise<void> {
    await this.prisma.wardrobeMaintenanceState.upsert({
      where: { key: STAGING_SWEEP_CURSOR_KEY },
      create: { key: STAGING_SWEEP_CURSOR_KEY, value },
      update: { value },
    })
  }

  /** The keys to remove for a set of stale staged objects, and how many a legal hold keeps. */
  private async planStagingRemoval(
    stagedPaths: string[]
  ): Promise<{ paths: string[]; held: number }> {
    const paths: string[] = []
    const garmentSessions = new Map<
      string,
      { path: string; userId: string; ext: GarmentObjectExtension }
    >()
    for (const stagedPath of stagedPaths) {
      const parsed = parseWardrobeStagingObjectPath(stagedPath)
      if (!parsed) {
        // Nothing the API signs looks like this; it can only be removed.
        paths.push(stagedPath)
        continue
      }
      if (parsed.kind === 'garment') {
        garmentSessions.set(parsed.uploadSessionId, {
          path: stagedPath,
          userId: parsed.userId,
          ext: parsed.extension,
        })
        continue
      }
      paths.push(
        stagedPath,
        buildWardrobeObjectPath(
          parsed.userId,
          parsed.kind,
          parsed.uploadSessionId,
          parsed.extension
        )
      )
    }

    let held = 0
    if (garmentSessions.size > 0) {
      const garments = await this.prisma.garmentItem.findMany({
        where: { upload_session_id: { in: [...garmentSessions.keys()] } },
        select: {
          id: true,
          user_id: true,
          upload_session_id: true,
          retention_status: true,
        },
      })
      const bySession = new Map(garments.map((g) => [g.upload_session_id, g]))
      for (const [sessionId, staged] of garmentSessions) {
        const garment = bySession.get(sessionId)
        if (garment?.retention_status === 'legal_hold') {
          held += 1
          continue
        }
        paths.push(staged.path)
        if (
          garment &&
          garment.user_id === staged.userId &&
          isWardrobeUuid(garment.id) &&
          isWardrobePathSegment(garment.user_id)
        ) {
          paths.push(buildGarmentObjectPath(garment.user_id, garment.id, staged.ext))
        }
      }
    }
    return { paths, held }
  }

  private async invalidateRitualCache(userId: string, garmentId: string): Promise<void> {
    const invalidated = await this.ritualCache.invalidateUserCache(userId)
    if (!invalidated) {
      this.logger.warn(
        { garmentId, userId },
        'wardrobe_retention_cache_invalidation_failed'
      )
    }
  }

  /**
   * The garment's own final object (only when the stored path parses as this member's garment
   * object with this garment's id, in any extension) and, for a session never committed, its
   * staging key, and the immutable `held/` copy a past legal hold captured. The path column was
   * member-writable before the 2026-11-19 revoke migration, so a path naming anything else is
   * skipped and logged.
   */
  private garmentObjectsToRemove(garment: GarmentItem): string[] {
    const paths: string[] = []
    if (garment.object_path) {
      if (isOwnGarmentObject(garment)) {
        paths.push(garment.object_path)
      } else {
        this.logger.error(
          { garmentId: garment.id },
          'garment_object_path_not_own_purge_skipped'
        )
      }
    }
    if (
      !isFlatLayReservation(garment.upload_idempotency_key) &&
      isWardrobePathSegment(garment.user_id) &&
      isWardrobeUuid(garment.upload_session_id) &&
      garment.mime_type &&
      ['image/jpeg', 'image/png', 'image/webp'].includes(garment.mime_type) &&
      (garment.upload_status === 'pending_upload' ||
        garment.upload_status === 'bytes_uploaded')
    ) {
      paths.push(
        buildWardrobeStagingObjectPath(
          garment.user_id,
          'garment',
          garment.upload_session_id,
          objectExtensionFor(garment.mime_type as GarmentMimeType)
        )
      )
    }
    // The immutable copy the hold kept, digest recorded or not; the hold is over once a purge
    // runs.
    paths.push(...heldCopyPaths(garment))
    return paths
  }

  /**
   * Clears the garment and records its objects for deletion in one transaction, then removes
   * them. A removal that fails stays recorded for the hourly retry; the row is already purged.
   * When a commit still owns the session's publication, its write of the final key may land
   * after this purge: the keys are still removed at once, and again every 15 minutes until 24
   * hours after that publication's lease started, so the write is removed whenever it lands.
   */
  private async purgeGarment(garment: GarmentItem): Promise<void> {
    if (garment.retention_status === 'legal_hold' || garment.retention_purged_at) {
      return
    }
    let objectPaths: string[] = []
    const completedAt = new Date()
    await interactiveTransaction(this.prisma, async (tx) => {
      /**
       * Same lock order as every capsule mutation: owner profile, then affected
       * capsules by id, then the target garment. Acquiring capsules before the
       * profile here would deadlock against a concurrent PATCH, and taking no
       * lock at all leaves the capsule eligibility check racing this purge.
       */
      await lockOwnerProfile(tx, garment.user_id)

      const affectedCapsules = await tx.outfitCapsule.findMany({
        where: {
          user_id: garment.user_id,
          garment_joins: { some: { garment_id: garment.id } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      const capsuleIds = affectedCapsules.map((capsule) => capsule.id)

      await lockCapsules(tx, garment.user_id, capsuleIds)
      await lockGarments(tx, garment.user_id, [garment.id])

      /**
       * Re-read under the lock. A concurrent sweep or an explicit deletion may
       * have purged this garment already, and repeating the work would bump
       * every containing capsule's revision a second time for one transition.
       */
      const locked = await tx.garmentItem.findFirst({
        where: { id: garment.id, user_id: garment.user_id },
      })
      if (
        !locked ||
        locked.retention_status === 'legal_hold' ||
        locked.retention_purged_at
      ) {
        return
      }
      objectPaths = this.garmentObjectsToRemove(locked)
      const removalHorizon = ambiguousPublicationHorizon({
        attemptId: locked.publish_attempt_id,
        startedAt: locked.publish_started_at,
        cleanupUntil: locked.publish_cleanup_until,
        committable:
          locked.upload_status === 'pending_upload' ||
          locked.upload_status === 'bytes_uploaded',
      })

      if (capsuleIds.length > 0) {
        await tx.outfitCapsule.updateMany({
          where: { id: { in: capsuleIds } },
          data: {
            revision: { increment: 1 },
            updated_at: completedAt,
          },
        })

        /**
         * One profile increment per retention transition, regardless of how many
         * capsules it touched, so a stale recommendation is rejected exactly once.
         */
        await tx.userProfile.update({
          where: { user_id: garment.user_id },
          data: { capsule_revision: { increment: 1 } },
        })
      }

      await tx.paletteInsights.deleteMany({ where: { garment_item_id: garment.id } })
      await tx.garmentItem.update({
        where: { id: garment.id },
        data: {
          object_path: null,
          image_url: null,
          color_palette: Prisma.DbNull,
          file_size_bytes: null,
          mime_type: null,
          content_sha256: null,
          // The held copy's key is in the outbox now, recorded below; the key stays on the row
          // until the outbox settles its removal (final review F-5).
          held_source_sha256: null,
          held_source_captured_at: null,
          held_source_object_path: heldKeyToKeep(locked, heldCopyPaths(locked)),
          width_px: null,
          height_px: null,
          failure_code: 'DELETED',
          upload_status: 'failed',
          retention_purged_at: completedAt,
        },
      })
      await tx.auditLog.create({
        data: {
          user_id: garment.user_id,
          event_type: 'garment_retention_purged',
          event_data: {
            garmentId: garment.id,
            // The locked row holds the recorded reason; the caller's copy may predate it.
            trigger: locked.retention_trigger ?? garment.retention_trigger ?? 'unknown',
            completedAt: completedAt.toISOString(),
            outcome: 'purged',
          },
          timestamp: completedAt,
        },
      })
      if (removalHorizon) {
        await this.deletions.recordRepeating(
          tx,
          objectPaths,
          'garment_purged',
          removalHorizon
        )
      } else {
        await this.deletions.record(tx, objectPaths, 'garment_purged')
      }
    })
    await this.deletions.removeNow(objectPaths)
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Locks one garment row (the lock purge and any operator update take) and reads it. */
async function lockHeldGarment(
  tx: Prisma.TransactionClient,
  garment: Pick<GarmentItem, 'id' | 'user_id'>
): Promise<GarmentItem | null> {
  await lockGarments(tx, garment.user_id, [garment.id])
  return tx.garmentItem.findFirst({ where: { id: garment.id, user_id: garment.user_id } })
}

/**
 * The held key that stays on the garment while its removal is outstanding: the recorded
 * obligation when it is the garment's own, else the key a recorded digest implies.
 */
function heldKeyToKeep(
  garment: GarmentItem,
  heldPaths: readonly string[]
): string | null {
  const recorded = garment.held_source_object_path
  if (recorded && heldPaths.includes(recorded)) return recorded
  return heldPaths[0] ?? null
}

/**
 * The garment's held copy keys: the obligation a capture recorded before writing (only when it
 * parses as this garment's own held key), and the key a recorded digest implies.
 */
function heldCopyPaths(garment: GarmentItem): string[] {
  const paths = new Set<string>()
  const recorded = garment.held_source_object_path
  if (recorded) {
    const parsed = parseWardrobeHeldObjectPath(recorded)
    if (parsed && parsed.userId === garment.user_id && parsed.garmentId === garment.id) {
      paths.add(recorded)
    }
  }
  if (
    garment.held_source_sha256 &&
    isWardrobePathSegment(garment.user_id) &&
    isWardrobePathSegment(garment.id) &&
    garment.mime_type &&
    ALLOWED_GARMENT_MIME_TYPES.has(garment.mime_type)
  ) {
    paths.add(
      buildWardrobeHeldObjectPath(
        garment.user_id,
        garment.id,
        objectExtensionFor(garment.mime_type as GarmentMimeType)
      )
    )
  }
  return [...paths]
}
