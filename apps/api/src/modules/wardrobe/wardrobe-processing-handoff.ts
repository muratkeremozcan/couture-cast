import { randomUUID } from 'node:crypto'
import type {
  GarmentItem,
  PaletteProfile,
  PrismaClient,
  SilhouetteProfile,
} from '@prisma/client'
import { isWardrobeUuid } from '@couture/utils'

import { createBaseLogger } from '../../logger/pino.config'
import type { PaletteAnalysisProcessingPublisher } from '../commerce/palette-analysis-processing.queue'
import type { SilhouettePhotoProcessingPublisher } from './silhouette-photo-processing.queue'
import type { GarmentProcessingPublisher } from './wardrobe-processing.queue'

/**
 * Durable job handoff for garments and the two profile photo flows, each with its
 * `processing_job_enqueued_at` marker. Commit moves the profile to processing and enqueues the job
 * under its deterministic id (`<profileId>__<session or analysis attempt>`), then sets the
 * marker. If the function stops in between, the row is processing with no marker: a same-key
 * commit replay enqueues again, and so does the hourly maintenance job once the grace period
 * has passed. A repeated enqueue under the same job id is a no-op while that job exists.
 */
export const WARDROBE_PROCESSING_HANDOFFS = Symbol('WardrobeProcessingHandoffs')

export type ProcessingHandoffPublishers = {
  garment: GarmentProcessingPublisher
  silhouette: SilhouettePhotoProcessingPublisher
  palette: PaletteAnalysisProcessingPublisher
}

/**
 * Limits a maintenance pass to the rows of these members. An integration suite sharing a
 * database recovers only the rows it created, never another suite's or a developer's; the
 * hourly job passes nothing and covers every row.
 */
export type MaintenanceScope = { userIds?: readonly string[] }

function scoped(scope: MaintenanceScope): { user_id?: { in: string[] } } {
  return scope.userIds ? { user_id: { in: [...scope.userIds] } } : {}
}

/** A commit enqueues within one request; past this, a missing marker means it never will. */
export const PROCESSING_HANDOFF_GRACE_MS = 5 * 60 * 1000
const HANDOFF_BATCH_SIZE = 100

const logger = createBaseLogger().child({ feature: 'wardrobe-processing-handoff' })

type GarmentHandoffRow = Pick<
  GarmentItem,
  | 'id'
  | 'upload_status'
  | 'retention_status'
  | 'processing_job_enqueued_at'
  | 'processing_deferred_at'
>

/**
 * The garment's color job id: the garment id, or, once a legal hold made the worker defer the
 * garment, an id derived from when it did. The first job's id stays retained as completed for
 * seven days, so a re-enqueue under it would be a no-op. Commit replay and the maintenance
 * handoff derive the same id from the row, so they never queue the work twice.
 */
export function garmentProcessingJobId(
  garment: Pick<GarmentItem, 'id' | 'processing_deferred_at'>
): string {
  return garment.processing_deferred_at
    ? `${garment.id}__deferred-${garment.processing_deferred_at.getTime()}`
    : garment.id
}

/**
 * Enqueues a processing garment's color job unless its handoff is already recorded or the
 * garment is not active (a held garment waits for its release). True when it enqueued.
 */
export async function handOffGarmentProcessing(
  prisma: Pick<PrismaClient, 'garmentItem'>,
  publisher: GarmentProcessingPublisher,
  garment: GarmentHandoffRow
): Promise<boolean> {
  if (
    garment.upload_status !== 'processing' ||
    garment.retention_status !== 'active' ||
    garment.processing_job_enqueued_at
  ) {
    return false
  }
  await publisher.enqueue(garment.id, garmentProcessingJobId(garment))
  await prisma.garmentItem.updateMany({
    where: {
      id: garment.id,
      upload_status: 'processing',
      processing_job_enqueued_at: null,
      processing_deferred_at: garment.processing_deferred_at,
    },
    data: { processing_job_enqueued_at: new Date() },
  })
  return true
}

type MyFormHandoffRow = Pick<
  SilhouetteProfile,
  | 'id'
  | 'my_form_status'
  | 'my_form_upload_session_id'
  | 'my_form_processing_job_enqueued_at'
>

type PaletteHandoffRow = Pick<
  PaletteProfile,
  'id' | 'status' | 'analysis_attempt_id' | 'processing_job_enqueued_at'
>

/**
 * Enqueues a processing My Form photo's job unless its handoff is already recorded. True when
 * it enqueued.
 */
export async function handOffMyFormProcessing(
  prisma: Pick<PrismaClient, 'silhouetteProfile'>,
  publisher: SilhouettePhotoProcessingPublisher,
  profile: MyFormHandoffRow
): Promise<boolean> {
  const sessionId = profile.my_form_upload_session_id
  if (
    profile.my_form_status !== 'processing' ||
    profile.my_form_processing_job_enqueued_at ||
    !isWardrobeUuid(sessionId)
  ) {
    return false
  }
  await publisher.enqueue(profile.id, sessionId)
  await prisma.silhouetteProfile.updateMany({
    where: {
      id: profile.id,
      my_form_status: 'processing',
      my_form_upload_session_id: sessionId,
      my_form_processing_job_enqueued_at: null,
    },
    data: { my_form_processing_job_enqueued_at: new Date() },
  })
  return true
}

/**
 * Enqueues a processing palette analysis's job unless its handoff is already recorded. True
 * when it enqueued.
 */
export async function handOffPaletteAnalysis(
  prisma: Pick<PrismaClient, 'paletteProfile'>,
  publisher: PaletteAnalysisProcessingPublisher,
  profile: PaletteHandoffRow
): Promise<boolean> {
  const attemptId = profile.analysis_attempt_id
  if (
    profile.status !== 'processing' ||
    profile.processing_job_enqueued_at ||
    !attemptId
  ) {
    return false
  }
  await publisher.enqueue(profile.id, attemptId)
  await prisma.paletteProfile.updateMany({
    where: {
      id: profile.id,
      status: 'processing',
      analysis_attempt_id: attemptId,
      processing_job_enqueued_at: null,
    },
    data: { processing_job_enqueued_at: new Date() },
  })
  return true
}

/**
 * A palette analysis an API instance from before the attempt column started during the rollout:
 * processing with no `analysis_attempt_id`. The new worker skips its job (no attempt to match)
 * and the handoff below needs an attempt, so the member would see an analysis in progress for
 * good. Each one gets a durable attempt under a guarded update (still processing, still with no
 * attempt, and unchanged since it was read), and only then is it enqueued under that attempt;
 * the stale job fence stays, so the old job still exits without writing. A selfie analysis's
 * attempt is its session, as the producer assigns it; a wardrobe analysis gets a fresh one.
 * Returns the rows it assigned, ready for the handoff.
 */
async function assignMissingAnalysisAttempts(
  prisma: Pick<PrismaClient, 'paletteProfile'>,
  before: Date,
  scope: MaintenanceScope
): Promise<PaletteProfile[]> {
  const orphans = await prisma.paletteProfile.findMany({
    where: {
      ...scoped(scope),
      status: 'processing',
      analysis_attempt_id: null,
      updated_at: { lte: before },
    },
    orderBy: { updated_at: 'asc' },
    take: HANDOFF_BATCH_SIZE,
  })
  const assigned: PaletteProfile[] = []
  for (const profile of orphans) {
    const attemptId =
      profile.source === 'selfie' && isWardrobeUuid(profile.selfie_upload_session_id)
        ? profile.selfie_upload_session_id
        : randomUUID()
    const claimed = await prisma.paletteProfile.updateMany({
      where: {
        id: profile.id,
        status: 'processing',
        analysis_attempt_id: null,
        revision: profile.revision,
      },
      data: { analysis_attempt_id: attemptId, processing_job_enqueued_at: null },
    })
    if (claimed.count !== 1) continue
    logger.warn({ profileId: profile.id }, 'palette_analysis_attempt_assigned')
    assigned.push({
      ...profile,
      analysis_attempt_id: attemptId,
      processing_job_enqueued_at: null,
    })
  }
  return assigned
}

/**
 * The maintenance half of the handoff: enqueues every processing garment, My Form photo and
 * palette analysis whose marker is still missing after the grace period, including a garment
 * whose processing a legal hold deferred and that is active again, and a palette analysis an
 * old API instance started with no attempt. Returns how many it handed off; one failed enqueue
 * is logged and left for the next run.
 */
export async function reenqueueStrandedProcessing(
  prisma: Pick<PrismaClient, 'garmentItem' | 'silhouetteProfile' | 'paletteProfile'>,
  publishers: ProcessingHandoffPublishers,
  now = new Date(),
  scope: MaintenanceScope = {}
): Promise<number> {
  const before = new Date(now.getTime() - PROCESSING_HANDOFF_GRACE_MS)
  const orphanAnalyses = await assignMissingAnalysisAttempts(prisma, before, scope)
  const [garments, myForms, analyses] = await Promise.all([
    prisma.garmentItem.findMany({
      where: {
        ...scoped(scope),
        upload_status: 'processing',
        retention_status: 'active',
        processing_job_enqueued_at: null,
        committed_at: { lte: before },
      },
      orderBy: { committed_at: 'asc' },
      take: HANDOFF_BATCH_SIZE,
    }),
    prisma.silhouetteProfile.findMany({
      where: {
        ...scoped(scope),
        my_form_status: 'processing',
        my_form_processing_job_enqueued_at: null,
        my_form_committed_at: { lte: before },
      },
      orderBy: { my_form_committed_at: 'asc' },
      take: HANDOFF_BATCH_SIZE,
    }),
    prisma.paletteProfile.findMany({
      where: {
        ...scoped(scope),
        status: 'processing',
        processing_job_enqueued_at: null,
        analysis_attempt_id: { not: null },
        updated_at: { lte: before },
      },
      orderBy: { updated_at: 'asc' },
      take: HANDOFF_BATCH_SIZE,
    }),
  ])
  let handedOff = 0
  for (const garment of garments) {
    try {
      if (await handOffGarmentProcessing(prisma, publishers.garment, garment)) {
        handedOff += 1
      }
    } catch (error) {
      logger.warn(
        { garmentId: garment.id, errorClass: errorClass(error) },
        'garment_processing_handoff_failed'
      )
    }
  }
  for (const profile of myForms) {
    try {
      if (await handOffMyFormProcessing(prisma, publishers.silhouette, profile)) {
        handedOff += 1
      }
    } catch (error) {
      logger.warn(
        { profileId: profile.id, errorClass: errorClass(error) },
        'my_form_processing_handoff_failed'
      )
    }
  }
  const analysisIds = new Set(analyses.map((profile) => profile.id))
  for (const profile of [
    ...analyses,
    ...orphanAnalyses.filter((profile) => !analysisIds.has(profile.id)),
  ]) {
    try {
      if (await handOffPaletteAnalysis(prisma, publishers.palette, profile)) {
        handedOff += 1
      }
    } catch (error) {
      logger.warn(
        { profileId: profile.id, errorClass: errorClass(error) },
        'palette_analysis_handoff_failed'
      )
    }
  }
  if (handedOff > 0) {
    logger.warn({ count: handedOff }, 'stranded_processing_reenqueued')
  }
  return handedOff
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}
