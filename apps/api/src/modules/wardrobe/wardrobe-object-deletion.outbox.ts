import type { Prisma, PrismaClient } from '@prisma/client'
import {
  parseWardrobeHeldObjectPath,
  parseWardrobeObjectPath,
  parseWardrobeStagingObjectPath,
} from '@couture/utils'

import { createBaseLogger } from '../../logger/pino.config'
import { singleRunTransaction } from '../../prisma/prisma-client.js'
import type { WardrobeStorage } from './wardrobe-storage.adapter'
import {
  REPEATING_REMOVAL_INTERVAL_MS,
  unfinishedPublicationDeadline,
} from './wardrobe-publication'

/** Why an object is being removed; logged and stored, never shown to a member. */
export type WardrobeDeletionReason =
  | 'garment_purged'
  | 'my_form_replaced'
  | 'my_form_deleted'
  | 'selfie_replaced'
  | 'selfie_purged'
  | 'selfie_erased'
  | 'selfie_superseded'
  | 'commit_compensation'
  | 'commit_staging_released'
  | 'flat_lay_unfinished'
  | 'upload_rejected'
  | 'staging_swept'
  | 'held_copy_released'

type DeletionWriter = Pick<Prisma.TransactionClient, 'wardrobeObjectDeletion'>

const DRAIN_BATCH_SIZE = 100
const BASE_BACKOFF_MS = 5 * 60 * 1000
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000
/** One removal holds its row locks across a single storage call; this bounds that call. */
const SETTLE_TRANSACTION_TIMEOUT_MS = 30 * 1000
/** Past this many failed attempts every retry logs an error, so a stuck deletion is visible. */
export const DELETION_ALERT_ATTEMPTS = 5

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}

/**
 * What the authoritative row says about one candidate key:
 * - `live`: the object must stay (a committed final object, a legacy relay upload awaiting
 *   commit, or any object of a garment under legal hold); the obligation is dropped.
 * - `publishing`: a commit owns the session's publication and may still write the final key;
 *   the obligation waits until the claim's lease runs out.
 * - `removable`: nothing keeps it. For a final key, `repeatUntil` is the cleanup horizon its
 *   session's claims recorded (round 6): a write an earlier attempt started may still land
 *   until then, after the lease ran out, a takeover or a successful publication, so the removal
 *   repeats until that horizon whoever recorded it.
 */
export type WardrobeObjectVerdict =
  | { kind: 'live' }
  | { kind: 'publishing'; until: Date }
  | { kind: 'removable'; repeatUntil?: Date }

const LIVE = { kind: 'live' } as const
const REMOVABLE = { kind: 'removable' } as const

/**
 * Removable, repeating until the session's recorded cleanup horizon when the key is a final key
 * a publisher writes and that horizon is still ahead. Staging keys are written only by the
 * member's signed PUT, which the staging sweep covers, so they never repeat on this account.
 */
function removableFinal(
  key: CandidateKey,
  cleanupUntil: Date | null,
  now: Date
): WardrobeObjectVerdict {
  if (key.final && cleanupUntil && cleanupUntil > now) {
    return { kind: 'removable', repeatUntil: cleanupUntil }
  }
  return REMOVABLE
}

const COMMITTED_GARMENT_STATUSES = new Set([
  'bytes_uploaded',
  'processing',
  'awaiting_tags',
  'ready',
  'failed',
])
const COMMITTED_MY_FORM_STATUSES = new Set([
  'bytes_uploaded',
  'processing',
  'ready',
  'failed',
])
/**
 * A selfie is purged by design once its analysis ends, so only its own analysis keeps it: a
 * legacy relay upload awaiting commit, or a processing selfie analysis of this very session
 * (final review F-6). A wardrobe analysis that left a profile processing never keeps an old
 * selfie, whatever selfie columns the row still carries. An analysis with no recorded attempt
 * was started by an instance from before attempts existed and is still taken as the selfie's.
 */
function selfieAnalysisUsesSession(
  profile: {
    status: string | null
    source: string | null
    analysis_attempt_id: string | null
  },
  uploadSessionId: string
): boolean {
  if (profile.status === 'bytes_uploaded') return true
  return (
    profile.status === 'processing' &&
    profile.source === 'selfie' &&
    (profile.analysis_attempt_id === null ||
      profile.analysis_attempt_id === uploadSessionId)
  )
}

function isCommittable(status: string | null): boolean {
  return status === 'pending_upload' || status === 'bytes_uploaded'
}

/**
 * Locks the one row that has authority over `objectPath` and judges the key against it. A
 * `held/` key (the server's immutable copy of a held pending garment's source) stays exactly
 * while its garment is under legal hold. The
 * key is parsed for its table, owner and object id (the garment id, or the upload session for
 * My Form, the selfie and every staging key), and only the row that matches all three can keep
 * it: no other table's or member's row can, whatever path text it stores. The row lock is held
 * by the caller's transaction across the storage removal, so a legal hold or a commit claim
 * that lands meanwhile waits for the removal, or precedes it and is seen here.
 */
export async function judgeWardrobeObject(
  tx: Prisma.TransactionClient,
  objectPath: string,
  now = new Date()
): Promise<WardrobeObjectVerdict> {
  const final = parseWardrobeObjectPath(objectPath)
  if (final) {
    const key = { objectPath, userId: final.userId, id: final.objectId, final: true }
    if (final.kind === 'garment') return judgeGarmentKey(tx, key, now)
    if (final.kind === 'silhouette') return judgeMyFormKey(tx, key, now)
    return judgeSelfieKey(tx, key, now)
  }
  const held = parseWardrobeHeldObjectPath(objectPath)
  if (held) return judgeHeldKey(tx, held.userId, held.garmentId, now)
  const staged = parseWardrobeStagingObjectPath(objectPath)
  if (!staged) return REMOVABLE
  const key = {
    objectPath,
    userId: staged.userId,
    id: staged.uploadSessionId,
    final: false,
  }
  if (staged.kind === 'garment') return judgeGarmentKey(tx, key, now)
  if (staged.kind === 'silhouette') return judgeMyFormKey(tx, key, now)
  return judgeSelfieKey(tx, key, now)
}

/**
 * A parsed candidate key: its owner, and the garment id (final garment key) or the upload
 * session id (every other key).
 */
type CandidateKey = { objectPath: string; userId: string; id: string; final: boolean }

/**
 * A held copy stays while its garment is held. Otherwise it is removable, repeating until the
 * cleanup horizon the capture recorded before it dispatched the write (final review F-4): a write
 * whose transaction timed out, or whose worker stopped, can still land after the first removal.
 */
async function judgeHeldKey(
  tx: Prisma.TransactionClient,
  userId: string,
  garmentId: string,
  now: Date
): Promise<WardrobeObjectVerdict> {
  await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE id = ${garmentId} AND user_id = ${userId} FOR UPDATE`
  const garment = await tx.garmentItem.findFirst({
    where: { id: garmentId, user_id: userId },
    select: { retention_status: true, held_source_cleanup_until: true },
  })
  if (!garment) return REMOVABLE
  if (garment.retention_status === 'legal_hold') return LIVE
  const until = garment.held_source_cleanup_until
  return until && until > now ? { kind: 'removable', repeatUntil: until } : REMOVABLE
}

/**
 * Final review F-5: once a held copy's removal has settled for good, the garment no longer owes
 * it, so its key and horizon are cleared, under the garment row lock the judgement took. Until
 * then the key stays on the garment, and a release after a reapplied hold finds it again.
 */
async function forgetSettledHeldKey(
  tx: Prisma.TransactionClient,
  objectPath: string
): Promise<void> {
  const held = parseWardrobeHeldObjectPath(objectPath)
  if (!held) return
  await tx.garmentItem.updateMany({
    where: {
      id: held.garmentId,
      user_id: held.userId,
      held_source_object_path: objectPath,
      retention_status: { not: 'legal_hold' },
    },
    data: { held_source_object_path: null, held_source_cleanup_until: null },
  })
}

async function judgeGarmentKey(
  tx: Prisma.TransactionClient,
  key: CandidateKey,
  now: Date
): Promise<WardrobeObjectVerdict> {
  // A final key names the garment id; a staging key names the garment's upload session.
  if (key.final) {
    await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE id = ${key.id} AND user_id = ${key.userId} FOR UPDATE`
  } else {
    await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE upload_session_id = ${key.id} AND user_id = ${key.userId} FOR UPDATE`
  }
  const garment = await tx.garmentItem.findFirst({
    where: key.final
      ? { id: key.id, user_id: key.userId }
      : { upload_session_id: key.id, user_id: key.userId },
  })
  if (!garment) return REMOVABLE
  if (garment.retention_status === 'legal_hold') return LIVE
  if (key.final && garment.object_path !== key.objectPath) {
    return removableFinal(key, garment.publish_cleanup_until, now)
  }
  if (
    key.final &&
    garment.retention_purged_at === null &&
    COMMITTED_GARMENT_STATUSES.has(garment.upload_status)
  ) {
    return LIVE
  }
  return inFlight(
    key,
    garment.publish_attempt_id,
    garment.publish_started_at,
    garment.upload_status,
    garment.publish_cleanup_until,
    now
  )
}

async function judgeMyFormKey(
  tx: Prisma.TransactionClient,
  key: CandidateKey,
  now: Date
): Promise<WardrobeObjectVerdict> {
  await tx.$queryRaw`SELECT 1 FROM "SilhouetteProfile" WHERE user_id = ${key.userId} FOR UPDATE`
  const profile = await tx.silhouetteProfile.findUnique({
    where: { user_id: key.userId },
  })
  if (!profile || profile.my_form_upload_session_id !== key.id) return REMOVABLE
  if (key.final && profile.my_form_object_path !== key.objectPath) {
    return removableFinal(key, profile.my_form_publish_cleanup_until, now)
  }
  if (key.final && COMMITTED_MY_FORM_STATUSES.has(profile.my_form_status ?? '')) {
    return LIVE
  }
  return inFlight(
    key,
    profile.my_form_publish_attempt_id,
    profile.my_form_publish_started_at,
    profile.my_form_status,
    profile.my_form_publish_cleanup_until,
    now
  )
}

async function judgeSelfieKey(
  tx: Prisma.TransactionClient,
  key: CandidateKey,
  now: Date
): Promise<WardrobeObjectVerdict> {
  await tx.$queryRaw`SELECT 1 FROM "PaletteProfile" WHERE user_id = ${key.userId} FOR UPDATE`
  const profile = await tx.paletteProfile.findUnique({ where: { user_id: key.userId } })
  if (!profile || profile.selfie_upload_session_id !== key.id) return REMOVABLE
  if (key.final && profile.selfie_object_path !== key.objectPath) {
    return removableFinal(key, profile.selfie_publish_cleanup_until, now)
  }
  if (key.final && selfieAnalysisUsesSession(profile, key.id)) return LIVE
  return inFlight(
    key,
    profile.selfie_publish_attempt_id,
    profile.selfie_publish_started_at,
    profile.status,
    profile.selfie_publish_cleanup_until,
    now
  )
}

/**
 * `publishing` while a commit of the session still owns its publication; otherwise removable,
 * repeating until the session's recorded cleanup horizon for a final key.
 */
function inFlight(
  key: CandidateKey,
  attemptId: string | null,
  startedAt: Date | null,
  status: string | null,
  cleanupUntil: Date | null,
  now: Date
): WardrobeObjectVerdict {
  const until = unfinishedPublicationDeadline(
    { attemptId, startedAt, committable: isCommittable(status) },
    now
  )
  return until ? { kind: 'publishing', until } : removableFinal(key, cleanupUntil, now)
}

type SettleOutcome = 'removed' | 'repeating' | 'kept' | 'deferred' | 'not_due' | 'absent'

/**
 * The durable record of every wardrobe-images object the API must remove. A caller writes rows
 * with {@link record} in the same transaction as the state change that orphans the objects,
 * then calls {@link removeNow} after that transaction commits. A removal that fails stays
 * recorded, and the hourly maintenance job retries it through {@link drainDue} with backoff, so
 * a transient storage fault can no longer leave an erased selfie or a replaced photo behind.
 *
 * Each removal runs in its own transaction that locks the key's authoritative row, judges the
 * key against it ({@link judgeWardrobeObject}) and removes the object while still holding the
 * lock. A live key's obligation is dropped; a key whose session a commit is still publishing
 * waits until that commit's lease runs out, so a write that lands late is removed after it
 * lands.
 *
 * A repeating row ({@link recordRepeating}) is removed at once whatever a publication still
 * holds, and again every {@link REPEATING_REMOVAL_INTERVAL_MS} until its `repeat_until`: a
 * storage write an ambiguous publisher started can complete after the lease, and is removed
 * whenever it lands. Only a removal after the horizon settles the row.
 */
export class WardrobeObjectDeletionOutbox {
  private readonly logger = createBaseLogger().child({
    feature: 'wardrobe-object-deletion',
  })

  /** A plain class: each service and worker builds one from the client and adapter it has. */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Pick<WardrobeStorage, 'remove'>
  ) {}

  /**
   * Records `objectPaths` for removal. With `notBefore`, the removal waits until then, and an
   * already recorded path is pushed back to it as well; without, an already recorded path keeps
   * its row.
   */
  async record(
    tx: DeletionWriter,
    objectPaths: readonly string[],
    reason: WardrobeDeletionReason,
    notBefore?: Date
  ): Promise<void> {
    const unique = [...new Set(objectPaths)]
    if (unique.length === 0) return
    await tx.wardrobeObjectDeletion.createMany({
      data: unique.map((object_path) => ({
        object_path,
        reason,
        ...(notBefore ? { not_before: notBefore } : {}),
      })),
      skipDuplicates: true,
    })
    if (notBefore) {
      await tx.wardrobeObjectDeletion.updateMany({
        where: { object_path: { in: unique }, not_before: { lt: notBefore } },
        data: { not_before: notBefore },
      })
    }
  }

  /**
   * Records `objectPaths` for a removal that repeats until `repeatUntil`: used where erasure,
   * deletion, purge, replacement or a superseding analysis meets a publication still in flight.
   * The caller removes the keys at once with {@link removeNow} after its transaction commits;
   * the row stays and the removal runs again until the horizon. An already recorded path keeps
   * the later horizon and is due now.
   */
  async recordRepeating(
    tx: DeletionWriter,
    objectPaths: readonly string[],
    reason: WardrobeDeletionReason,
    repeatUntil: Date
  ): Promise<void> {
    const unique = [...new Set(objectPaths)]
    if (unique.length === 0) return
    const now = new Date()
    await tx.wardrobeObjectDeletion.createMany({
      data: unique.map((object_path) => ({
        object_path,
        reason,
        not_before: now,
        repeat_until: repeatUntil,
      })),
      skipDuplicates: true,
    })
    await tx.wardrobeObjectDeletion.updateMany({
      where: {
        object_path: { in: unique },
        OR: [{ repeat_until: null }, { repeat_until: { lt: repeatUntil } }],
      },
      data: { repeat_until: repeatUntil, not_before: now },
    })
  }

  /** Records and removes at once, outside any transaction. Never throws. */
  async recordAndRemove(
    objectPaths: readonly string[],
    reason: WardrobeDeletionReason
  ): Promise<void> {
    try {
      await this.record(this.prisma, objectPaths, reason)
    } catch (error) {
      this.logger.error(
        { reason, count: objectPaths.length, errorClass: errorClass(error) },
        'wardrobe_object_deletion_record_failed'
      )
      return
    }
    await this.removeNow(objectPaths)
  }

  /**
   * Settles the recorded paths that are due right away. A failure is logged and left for
   * {@link drainDue}; it never fails the caller's request. A path recorded for later is left
   * for then, except a repeating one: its removal runs at once whenever a caller asks, since a
   * commit that compensates a late publish must not wait for the next repeat.
   */
  async removeNow(objectPaths: readonly string[]): Promise<void> {
    const now = new Date()
    for (const objectPath of new Set(objectPaths)) {
      try {
        await this.settle(objectPath, now, { immediate: true })
      } catch (error) {
        this.logger.warn(
          { errorClass: errorClass(error) },
          'wardrobe_object_deletion_deferred'
        )
        await this.prisma.wardrobeObjectDeletion
          .updateMany({
            where: { object_path: objectPath },
            data: {
              attempts: { increment: 1 },
              last_error: errorClass(error),
              not_before: new Date(now.getTime() + BASE_BACKOFF_MS),
            },
          })
          .catch(() => undefined)
      }
    }
  }

  /**
   * Retries due rows, oldest first, each on its own: one key's storage fault leaves the others
   * to proceed. Returns how many objects were removed or dropped as live. `objectPaths` limits
   * the drain to those keys: a suite that drains a shared database settles only the rows it
   * created, never another suite's or a developer's. The hourly job drains everything.
   */
  async drainDue(
    now = new Date(),
    scope: { objectPaths?: readonly string[] } = {}
  ): Promise<number> {
    const due = await this.prisma.wardrobeObjectDeletion.findMany({
      where: {
        not_before: { lte: now },
        ...(scope.objectPaths ? { object_path: { in: [...scope.objectPaths] } } : {}),
      },
      orderBy: { not_before: 'asc' },
      take: DRAIN_BATCH_SIZE,
    })
    let settled = 0
    for (const row of due) {
      try {
        const outcome = await this.settle(row.object_path, now)
        if (outcome === 'removed' || outcome === 'repeating' || outcome === 'kept') {
          settled += 1
        }
      } catch (error) {
        const attempts = row.attempts + 1
        await this.prisma.wardrobeObjectDeletion
          .updateMany({
            where: { id: row.id },
            data: {
              attempts,
              last_error: errorClass(error),
              not_before: new Date(now.getTime() + backoffMs(attempts)),
            },
          })
          .catch(() => undefined)
        const context = { reason: row.reason, attempts, errorClass: errorClass(error) }
        if (attempts >= DELETION_ALERT_ATTEMPTS) {
          this.logger.error(context, 'wardrobe_object_deletion_stuck')
        } else {
          this.logger.warn(context, 'wardrobe_object_deletion_retry_failed')
        }
      }
    }
    return settled
  }

  /**
   * One key, in one transaction: lock its authoritative row, then its outbox row; judge it; and
   * remove it from storage while both locks are held.
   */
  private settle(
    objectPath: string,
    now: Date,
    { immediate = false }: { immediate?: boolean } = {}
  ): Promise<SettleOutcome> {
    return singleRunTransaction(
      this.prisma,
      async (tx) => {
        const verdict = await judgeWardrobeObject(tx, objectPath, now)
        await tx.$queryRaw`SELECT 1 FROM "WardrobeObjectDeletion" WHERE object_path = ${objectPath} FOR UPDATE`
        const row = await tx.wardrobeObjectDeletion.findUnique({
          where: { object_path: objectPath },
        })
        if (!row) return 'absent'
        if (row.not_before > now && !(immediate && row.repeat_until)) return 'not_due'
        // The later of the horizon the caller recorded and the one the key's session recorded:
        // a one-time removal of a final key whose session may still receive a late write turns
        // into a repeating one here, whichever caller recorded it.
        const repeatUntil = laterOf(
          row.repeat_until,
          verdict.kind === 'removable' ? (verdict.repeatUntil ?? null) : null
        )
        if (verdict.kind === 'publishing' && !repeatUntil) {
          await tx.wardrobeObjectDeletion.update({
            where: { id: row.id },
            data: { not_before: verdict.until },
          })
          this.logger.info(
            { reason: row.reason },
            'wardrobe_object_deletion_waits_for_publish'
          )
          return 'deferred'
        }
        if (verdict.kind === 'live') {
          this.logger.warn(
            { reason: row.reason },
            'wardrobe_object_deletion_skipped_live'
          )
          await tx.wardrobeObjectDeletion.delete({ where: { id: row.id } })
          return 'kept'
        }
        // Removable, or a repeating row whose publication may still be writing: remove it now.
        await this.storage.remove([objectPath])
        if (repeatUntil && repeatUntil > now) {
          await tx.wardrobeObjectDeletion.update({
            where: { id: row.id },
            data: {
              // Written only when the session's horizon extends the row's own.
              ...(repeatUntil.getTime() === row.repeat_until?.getTime()
                ? {}
                : { repeat_until: repeatUntil }),
              not_before: new Date(now.getTime() + REPEATING_REMOVAL_INTERVAL_MS),
              attempts: 0,
              last_error: null,
            },
          })
          return 'repeating'
        }
        await tx.wardrobeObjectDeletion.delete({ where: { id: row.id } })
        await forgetSettledHeldKey(tx, objectPath)
        return 'removed'
      },
      { timeout: SETTLE_TRANSACTION_TIMEOUT_MS }
    )
  }
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a > b ? a : b
  return a ?? b
}
