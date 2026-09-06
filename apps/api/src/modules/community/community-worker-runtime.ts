import type { Worker } from 'bullmq'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { CommunityMaintenanceService } from './community-maintenance.service.js'
import { CommunityModerationOutboxDispatcher } from './community-moderation.outbox.js'
import { CommunityModerationQueue } from './community-moderation.queue.js'
import { createCommunityModerationWorker } from './community-moderation.worker.js'
import {
  DefaultCommunityModerationEngine,
  UnavailableNsfwImageScreener,
  type CommunityModerationEngine,
  type NsfwImageScreener,
} from './community-moderation.engine.js'
import {
  COMMUNITY_NSFW_SCREENER_ENV,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
  FixtureNsfwImageScreener,
} from './fixture-nsfw-image-screener.js'
import { SupabaseCommunityStorageAdapter } from './community-storage.adapter.js'
import { createBaseLogger } from '../../logger/pino.config.js'

/**
 * The periodic community work, as plain callables.
 *
 * `maintenance.processor.ts` routes job names onto this shape, and the narrow
 * community worker process drives the same three functions on its own timer, so
 * neither substrate can call something the other cannot.
 */
export interface CommunitySweeps {
  dispatchPending: () => Promise<unknown>
  sweepStalePendingReview: () => Promise<unknown>
  sweepExpiredUploads: () => Promise<unknown>
  sweepErasureRequests: () => Promise<unknown>
}

export interface CommunityWorkerRuntime {
  worker: Worker
  sweeps: CommunitySweeps
  close: () => Promise<void>
}

/**
 * Selects the image screener, mirroring `createTaggingEngine`'s handling of
 * `GARMENT_TAGGING_ENGINE`.
 *
 * Default is the real screener, which today means fail closed: an absent
 * variable can only ever make screening stricter, never laxer. An unknown value
 * is an error rather than a silent fallback, so a typo in a deployment cannot
 * quietly select something nobody asked for.
 */
export function createNsfwImageScreener(): NsfwImageScreener {
  const requested = process.env[COMMUNITY_NSFW_SCREENER_ENV]?.trim()
  if (!requested) {
    return new UnavailableNsfwImageScreener()
  }
  if (requested !== COMMUNITY_NSFW_SCREENER_FIXTURE) {
    throw new Error(`Unsupported ${COMMUNITY_NSFW_SCREENER_ENV} value: ${requested}`)
  }
  // The fixture's own constructor re-checks the environment predicate and
  // throws outside a test environment, so this is a double gate rather than a
  // single one.
  const screener = new FixtureNsfwImageScreener()
  createBaseLogger()
    .child({ feature: 'community-workers' })
    .warn(
      { screener: COMMUNITY_NSFW_SCREENER_FIXTURE },
      'Community NSFW screening is running a FIXTURE that clears every image; a pass proves nothing about image safety'
    )
  return screener
}

/**
 * One composition of the community moderation pipeline, shared by every process
 * that runs it.
 *
 * It exists because there are two such processes. The main worker runtime
 * (`bootstrap.ts`) runs it in production, and a narrow process
 * (`community.bootstrap.ts`) runs it for the local end-to-end stack, which
 * cannot start `bootstrap.ts` because that process also starts weather
 * ingestion against live providers. Composing the pipeline twice by hand is how
 * the two drift, and a drift here is silent: the end-to-end stack would appear
 * to exercise screening while running different wiring from production.
 */
export function createCommunityWorkerRuntime(deps: {
  prisma: PrismaClient
  telemetryService: TelemetryService
  /** Overrides the environment selection; specs inject a pinned engine here. */
  engine?: CommunityModerationEngine
}): CommunityWorkerRuntime {
  const storage = new SupabaseCommunityStorageAdapter()
  const queue = new CommunityModerationQueue()
  const maintenance = new CommunityMaintenanceService(deps.prisma, storage)
  const dispatcher = new CommunityModerationOutboxDispatcher(deps.prisma, queue)

  const worker = createCommunityModerationWorker({
    prisma: deps.prisma,
    storage,
    telemetryService: deps.telemetryService,
    engine:
      deps.engine ?? new DefaultCommunityModerationEngine(createNsfwImageScreener()),
  })

  return {
    worker,
    sweeps: {
      dispatchPending: () => dispatcher.dispatchPending(),
      sweepStalePendingReview: () => maintenance.sweepStalePendingReview(),
      sweepExpiredUploads: () => maintenance.sweepExpiredUploads(),
      sweepErasureRequests: () => maintenance.sweepErasureRequests(),
    },
    close: () => queue.onModuleDestroy(),
  }
}
