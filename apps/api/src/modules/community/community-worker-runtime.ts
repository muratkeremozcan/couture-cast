import type { Worker } from 'bullmq'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import { CommunityMaintenanceService } from './community-maintenance.service.js'
import { CommunityModerationOutboxDispatcher } from './community-moderation.outbox.js'
import { CommunityModerationQueue } from './community-moderation.queue.js'
import { createCommunityModerationWorker } from './community-moderation.worker.js'
import {
  DefaultCommunityModerationEngine,
  UnavailableNsfwImageScreener,
  type CommunityModerationEngine,
  type NsfwImageScreener,
  type NsfwScreenerReadiness,
} from './community-moderation.engine.js'
import {
  COMMUNITY_NSFW_SCREENER_ENV,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
  FixtureNsfwImageScreener,
} from './fixture-nsfw-image-screener.js'
import {
  COMMUNITY_MODERATION_LOG_EVENTS,
  COMMUNITY_MODERATION_LOG_FEATURE,
  createOpenTelemetryCommunityModerationMeter,
  createSafeCommunityModerationMeter,
  type CommunityModerationMeter,
} from './community-moderation.telemetry.js'
import { MODERATION_SCREENING_TIMEOUT_MS } from './community-moderation.processor.js'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV,
  COMMUNITY_NSFW_SCREENER_TENSORFLOW,
  NSFW_INFERENCE_TIMEOUT_MS,
} from './tensorflow-nsfw-image-screener.js'
import { CommunityTextScreener } from './community-text-screener.js'
import { SupabaseCommunityStorageAdapter } from './community-storage.adapter.js'
import { createBaseLogger } from '../../logger/pino.config.js'

/** The value that selects the fail-closed adapter with no model behind it. */
export const COMMUNITY_NSFW_SCREENER_UNAVAILABLE = 'unavailable'

/**
 * The second, deliberately awkward switch a production operator has to throw to
 * run without a model. `unavailable` on its own is what a half-finished
 * deployment looks like; `unavailable` plus this plus an incident reference is
 * what a decision looks like.
 */
export const COMMUNITY_NSFW_INCIDENT_MODE_ENV = 'COMMUNITY_NSFW_INCIDENT_MODE'
export const COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV = 'COMMUNITY_NSFW_INCIDENT_REFERENCE'
export const COMMUNITY_NSFW_INCIDENT_MODE_UNAVAILABLE = 'unavailable'

/**
 * Ceiling on ONE inference inside the supervised model runtime.
 *
 * Distinct from `MODERATION_SCREENING_TIMEOUT_MS`, which bounds the whole
 * screening step from the outside and stays at thirty seconds. This one exists
 * so a wedged inference is terminated and its CPU reclaimed before the outer
 * race fires, which is why it is required to be strictly smaller: a value at or
 * above the outer ceiling means the outer timer always wins and the inner
 * termination never runs, leaving a pathological inference burning a core
 * through every remaining BullMQ attempt.
 */

export function resolveNsfwInferenceTimeoutMs(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): number {
  const raw = env[COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV]?.trim()
  if (!raw) return NSFW_INFERENCE_TIMEOUT_MS

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV} must be a positive integer of milliseconds, got: ${raw}`
    )
  }
  if (parsed >= MODERATION_SCREENING_TIMEOUT_MS) {
    throw new Error(
      `${COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV} must be below the ${MODERATION_SCREENING_TIMEOUT_MS}ms outer screening ceiling, got: ${raw}`
    )
  }
  return parsed
}

export type CommunityNsfwSelector =
  | typeof COMMUNITY_NSFW_SCREENER_TENSORFLOW
  | typeof COMMUNITY_NSFW_SCREENER_FIXTURE
  | typeof COMMUNITY_NSFW_SCREENER_UNAVAILABLE

const SUPPORTED_SELECTORS: readonly CommunityNsfwSelector[] = [
  COMMUNITY_NSFW_SCREENER_TENSORFLOW,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
  COMMUNITY_NSFW_SCREENER_UNAVAILABLE,
]

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

/** What the process knows about its own screening posture once it is ready. */
export interface CommunityScreeningReadiness extends NsfwScreenerReadiness {
  selector: CommunityNsfwSelector
  startupDurationMs: number
  /** Set only in incident mode, so an operator can trace why nothing screened. */
  incidentReference?: string
}

export interface CommunityWorkerRuntime {
  worker: Worker
  sweeps: CommunitySweeps
  /**
   * Absent when the caller pinned an engine instead of letting the runtime
   * select a screener. A synthesised readiness payload would be a plausible
   * identity for a screening that never took a selector at all.
   */
  readiness?: CommunityScreeningReadiness
  close: () => Promise<void>
}

export interface CommunityNsfwScreenerSelection {
  screener: NsfwImageScreener
  readiness: CommunityScreeningReadiness
  close: () => Promise<void>
}

const logger = createBaseLogger().child({ feature: COMMUNITY_MODERATION_LOG_FEATURE })

/**
 * Reads the selector, refusing an absent or unrecognised one.
 *
 * ABSENT NOW FAILS, WHERE IT USED TO MEAN "unavailable". Fail-closed was the
 * right instinct while no model existed, but once one does, a deployment that
 * forgot the variable and a deployment that chose to run degraded produce
 * exactly the same running process, and the second one is supposed to be a
 * decision somebody made. AC 1 asks startup to reject an unknown selector
 * before the consumer begins, and an absent one is the same class of mistake.
 */
export function resolveCommunityNsfwSelector(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): CommunityNsfwSelector {
  const requested = env[COMMUNITY_NSFW_SCREENER_ENV]?.trim()
  if (!requested) {
    throw new Error(
      `${COMMUNITY_NSFW_SCREENER_ENV} is required; set it to one of ${SUPPORTED_SELECTORS.join(', ')}`
    )
  }
  const selector = SUPPORTED_SELECTORS.find((value) => value === requested)
  if (!selector) {
    throw new Error(`Unsupported ${COMMUNITY_NSFW_SCREENER_ENV} value: ${requested}`)
  }
  return selector
}

/**
 * The incident reference an operator must supply to run production without a
 * model, or `undefined` outside production where the degraded adapter is an
 * ordinary test posture.
 */
function requireIncidentAuthorization(
  env: Readonly<NodeJS.ProcessEnv>
): string | undefined {
  if (allowsTestOnlySecrets(env)) {
    return undefined
  }

  const mode = env[COMMUNITY_NSFW_INCIDENT_MODE_ENV]?.trim()
  if (mode !== COMMUNITY_NSFW_INCIDENT_MODE_UNAVAILABLE) {
    throw new Error(
      `${COMMUNITY_NSFW_SCREENER_ENV}=${COMMUNITY_NSFW_SCREENER_UNAVAILABLE} requires ` +
        `${COMMUNITY_NSFW_INCIDENT_MODE_ENV}=${COMMUNITY_NSFW_INCIDENT_MODE_UNAVAILABLE} in production`
    )
  }

  const reference = env[COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV]?.trim()
  if (!reference) {
    throw new Error(
      `${COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV} must name the authorizing incident`
    )
  }
  return reference
}

/**
 * Selects the image screener and brings it to a verified ready state.
 *
 * Returns the close hook alongside it rather than leaving the caller to find
 * one: the screener that actually loads a model owns a child process, and a
 * selection API that hands back only the screener is how that process outlives
 * its worker.
 */
export async function createNsfwImageScreener(
  meter: CommunityModerationMeter = createSafeCommunityModerationMeter(
    createOpenTelemetryCommunityModerationMeter()
  )
): Promise<CommunityNsfwScreenerSelection> {
  const startedAt = Date.now()
  // `process.env` and nothing else. `FixtureNsfwImageScreener` re-reads the real
  // environment in its own constructor, so a selection driven by some other
  // object could pass one gate of the double gate and fail the other.
  const selector = resolveCommunityNsfwSelector(process.env)

  try {
    const selection = await selectScreener(selector, process.env, startedAt)
    meter.recordScreenerReadiness(
      selector,
      'ready',
      selection.readiness.startupDurationMs
    )
    return selection
  } catch (error) {
    meter.recordScreenerReadiness(selector, 'failed', Date.now() - startedAt)
    logger.error(
      {
        event: COMMUNITY_MODERATION_LOG_EVENTS.screenerStartupFailed,
        selector,
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      },
      'Community NSFW screener failed to start; the queue consumer will not begin'
    )
    throw error
  }
}

async function selectScreener(
  selector: CommunityNsfwSelector,
  env: Readonly<NodeJS.ProcessEnv>,
  startedAt: number
): Promise<CommunityNsfwScreenerSelection> {
  if (selector === COMMUNITY_NSFW_SCREENER_UNAVAILABLE) {
    const incidentReference = requireIncidentAuthorization(env)
    const screener = new UnavailableNsfwImageScreener()
    // No model is constructed, so there is nothing to retry: the refusal is
    // deterministic and every submission routes to a human. That is the whole
    // point of the mode, and it is why this branch has no readiness await.
    logger.error(
      {
        event: COMMUNITY_MODERATION_LOG_EVENTS.screenerIncidentMode,
        selector,
        incidentReference: incidentReference ?? null,
        engineVersion: screener.engineVersion,
      },
      'Community NSFW screening is DEGRADED: every submission will be refused and routed to human review'
    )
    return {
      screener,
      readiness: {
        selector,
        engineVersion: screener.engineVersion,
        startupDurationMs: Date.now() - startedAt,
        ...(incidentReference === undefined ? {} : { incidentReference }),
      },
      close: () => Promise.resolve(),
    }
  }

  if (selector === COMMUNITY_NSFW_SCREENER_FIXTURE) {
    // The fixture's own constructor re-checks the environment predicate and
    // throws outside a test environment, so this is a double gate rather than a
    // single one.
    const screener = new FixtureNsfwImageScreener()
    logger.warn(
      { screener: COMMUNITY_NSFW_SCREENER_FIXTURE },
      'Community NSFW screening is running a FIXTURE that clears every image; a pass proves nothing about image safety'
    )
    return finalizeSelection(selector, screener, startedAt)
  }

  // Imported dynamically so TensorFlow.js, its WASM backend and the 5.6 MB
  // model bundle stay off the import graph of every process that does not
  // select them. The API request app composes this module too, and it must
  // never pay for a model it will not run.
  const { TensorflowNsfwImageScreener } = await import(
    './tensorflow-nsfw-image-screener.js'
  )
  const screener = new TensorflowNsfwImageScreener({
    inferenceTimeoutMs: resolveNsfwInferenceTimeoutMs(env),
  })
  return finalizeSelection(selector, screener, startedAt)
}

async function finalizeSelection(
  selector: CommunityNsfwSelector,
  screener: NsfwImageScreener,
  startedAt: number
): Promise<CommunityNsfwScreenerSelection> {
  const readiness = (await screener.ensureReady?.()) ?? {
    engineVersion: screener.engineVersion,
  }
  const startupDurationMs = Date.now() - startedAt

  logger.info(
    {
      event: COMMUNITY_MODERATION_LOG_EVENTS.screenerReady,
      selector,
      engineVersion: readiness.engineVersion,
      policyVersion: readiness.policyVersion ?? null,
      modelHash: readiness.modelHash ?? null,
      backend: readiness.backend ?? null,
      startupDurationMs,
    },
    'Community NSFW screener is ready'
  )

  return {
    screener,
    readiness: { ...readiness, selector, startupDurationMs },
    close: () => screener.close?.() ?? Promise.resolve(),
  }
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
 *
 * IT IS ASYNCHRONOUS BECAUSE READINESS COMES FIRST. A BullMQ worker starts
 * consuming the moment it is constructed, so building one before the model has
 * loaded and verified means the first jobs off the queue are screened by an
 * engine that is not ready yet. `wardrobe.bootstrap.ts` already awaits
 * `ensureReady()` for FashionCLIP for the same reason.
 */
export async function createCommunityWorkerRuntime(deps: {
  prisma: PrismaClient
  telemetryService: TelemetryService
  /** Overrides the environment selection; specs inject a pinned engine here. */
  engine?: CommunityModerationEngine
  meter?: CommunityModerationMeter
}): Promise<CommunityWorkerRuntime> {
  const storage = new SupabaseCommunityStorageAdapter()
  const queue = new CommunityModerationQueue()
  const maintenance = new CommunityMaintenanceService(deps.prisma, storage)
  const dispatcher = new CommunityModerationOutboxDispatcher(deps.prisma, queue)
  const meter =
    deps.meter ??
    createSafeCommunityModerationMeter(createOpenTelemetryCommunityModerationMeter())

  let selection: CommunityNsfwScreenerSelection | undefined
  let engine = deps.engine
  if (!engine) {
    selection = await createNsfwImageScreener(meter)
    // Built ONCE, here, from the loaded policy. Construction reads and
    // validates fourteen term lists and throws on a missing file, missing
    // provenance, an undeclared category or a policy that would let a declared
    // locale bypass the other languages. AC 1 wants exactly those rejected
    // before queue consumption, so this sits beside the model's readiness check
    // and is deliberately not caught.
    const loaded = loadCommunityScreeningPolicy()
    engine = new DefaultCommunityModerationEngine(
      selection.screener,
      new CommunityTextScreener({
        policy: loaded.policy.text,
        policyVersion: loaded.identity.textEngineVersion,
      })
    )
  }

  const worker = createCommunityModerationWorker({
    prisma: deps.prisma,
    storage,
    telemetryService: deps.telemetryService,
    engine,
    meter,
  })

  return {
    worker,
    sweeps: {
      dispatchPending: () => dispatcher.dispatchPending(),
      sweepStalePendingReview: () => maintenance.sweepStalePendingReview(),
      sweepExpiredUploads: () => maintenance.sweepExpiredUploads(),
      sweepErasureRequests: () => maintenance.sweepErasureRequests(),
    },
    ...(selection ? { readiness: selection.readiness } : {}),
    close: async () => {
      // Both, and in this order. The queue holds the lazily-created Redis
      // connection the outbox dispatcher opens; the screener holds a model
      // process. Closing one and not the other is how `SIGTERM` used to leave a
      // connection open for the lifetime of the container.
      await selection?.close()
      await queue.onModuleDestroy()
    },
  }
}
