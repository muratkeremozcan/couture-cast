// Story 6.2 Task 2: the production ADR-013 NSFW image screener.
//
// It is split in two on purpose. This file is the supervisor: it owns the
// manifest, the policy, the engine identity, the three-way disposition and the
// worker's lifecycle, and it never loads TensorFlow.js itself. The model runs
// in `community-nsfw-inference.worker.ts`, in a worker thread, because a
// classification is CPU-bound: a `Promise.race` in this process would report a
// timeout while the computation kept running and kept competing with the BullMQ
// retry that the timeout just caused. Terminating a thread actually stops it.
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import {
  ADR013_IMAGE_ENGINE_VERSION,
  type ImageScreeningResult,
  type NsfwImageScreener,
} from './community-moderation.engine.js'
import {
  computeSha256,
  readModelManifest,
  type NsfwInferenceRequest,
  type NsfwInferenceResponse,
  type NsfwModelManifest,
  type NsfwRuntimeIdentity,
} from './community-nsfw-inference.worker.js'

/** The selector value that chooses this screener. */
export const COMMUNITY_NSFW_SCREENER_TENSORFLOW = 'tensorflow'

export const COMMUNITY_NSFW_MANIFEST_ENV = 'COMMUNITY_NSFW_MODEL_MANIFEST'
export const COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV = 'COMMUNITY_NSFW_INFERENCE_TIMEOUT_MS'

export type NsfwDisposition = 'pass' | 'review' | 'block'

/**
 * Stable reason codes, matching `reasonCodes.image` in the approved policy.
 * They are persisted and read by operators long after this code changes, so
 * they are values rather than generated strings, and
 * {@link assertReasonCodesArePolicyWired} proves at startup that the set this
 * adapter can emit is the set the policy declares.
 */
export const NSFW_REASON_UNSAFE_CLASS = 'unsafe_class'
export const NSFW_REASON_LOW_CONFIDENCE = 'low_confidence'
export const NSFW_REASON_OUTPUT_INVALID = 'output_invalid'
export const NSFW_REASON_CLASS_MISMATCH = 'class_mismatch'
export const NSFW_REASON_PROBABILITY_SUM_INVALID = 'probability_sum_invalid'
export const NSFW_REASON_INFERENCE_TIMEOUT = 'inference_timeout'

/** Every code {@link evaluateNsfwDisposition} or {@link TensorflowNsfwImageScreener} can emit. */
export const NSFW_IMAGE_REASON_CODES = [
  NSFW_REASON_UNSAFE_CLASS,
  NSFW_REASON_LOW_CONFIDENCE,
  NSFW_REASON_OUTPUT_INVALID,
  NSFW_REASON_CLASS_MISMATCH,
  NSFW_REASON_PROBABILITY_SUM_INVALID,
  NSFW_REASON_INFERENCE_TIMEOUT,
] as const

/** Absolute ceilings from AC 8, expressed where they are enforced. */
export const NSFW_INITIALIZATION_TIMEOUT_MS = 30_000
export const NSFW_INFERENCE_TIMEOUT_MS = 10_000
export const NSFW_FAILURE_COOLDOWN_MS = 5_000

/**
 * The five threshold keys the manifest mirrors, in the order it lists them.
 * They are named once here because both the mirror assertion and the policy
 * schema have to agree on exactly which keys are the pinned thresholds and
 * which are the rationale prose sitting beside them.
 */
export const NSFW_MIRRORED_THRESHOLD_KEYS = [
  'neutralPassMinimum',
  'unsafeAggregateMaximum',
  'unsafeBlockMinimum',
  'unsafeClasses',
  'probabilitySumTolerance',
] as const

const probability = z.number().gt(0).lte(1)

const imagePolicySchema = z
  .object({
    classNames: z.array(z.string().min(1)).min(1),
    /** `Neutral` must exceed this for automatic publication. */
    neutralPassMinimum: probability,
    /**
     * The unsafe probabilities must sum strictly below this for automatic
     * publication. Without it a vector could clear every single-class floor
     * while carrying substantial unsafe mass and still publish.
     */
    unsafeAggregateMaximum: probability,
    /** An unsafe class above this blocks outright. */
    unsafeBlockMinimum: probability,
    unsafeClasses: z.array(z.string().min(1)).min(1),
    /** How far the probabilities may sum away from 1 before the vector is untrusted. */
    probabilitySumTolerance: z.number().gt(0).lte(0.5),
    /**
     * AC 2 requires a threshold-boundary result to route to review, so this is
     * the only value a valid policy can carry. A policy that tried to resolve a
     * boundary in either decisive direction is an invalid threshold.
     */
    boundaryDisposition: z.literal('review'),
  })
  .passthrough()

export const screeningPolicySchema = z
  .object({
    version: z.string().min(1),
    image: imagePolicySchema,
    reasonCodes: z
      .object({ image: z.record(z.enum(['pass', 'review', 'block'])) })
      .passthrough(),
  })
  .passthrough()

export type NsfwImagePolicy = z.infer<typeof imagePolicySchema>

export interface NsfwEvaluation {
  disposition: NsfwDisposition
  reasons: string[]
  classProbabilities: Record<string, number>
}

function emptyEvaluation(reason: string): NsfwEvaluation {
  return { disposition: 'review', reasons: [reason], classProbabilities: {} }
}

function review(
  reason: string,
  classProbabilities: Record<string, number>
): NsfwEvaluation {
  return { disposition: 'review', reasons: [reason], classProbabilities }
}

/**
 * Validates the vector before any threshold is consulted. A vector that fails
 * here is not merely uncertain, it is untrustworthy, so no amount of confident
 * Neutral in it can be believed.
 */
function validateVector(
  probabilities: readonly number[],
  mapped: Record<string, number>,
  policy: NsfwImagePolicy
): NsfwEvaluation | null {
  const missingClass =
    !policy.unsafeClasses.every((className) => className in mapped) ||
    !('Neutral' in mapped)
  if (missingClass) {
    return review(NSFW_REASON_CLASS_MISMATCH, mapped)
  }
  if (probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return review(NSFW_REASON_OUTPUT_INVALID, mapped)
  }
  const sum = probabilities.reduce((total, value) => total + value, 0)
  if (Math.abs(sum - 1) > policy.probabilitySumTolerance) {
    return review(NSFW_REASON_PROBABILITY_SUM_INVALID, mapped)
  }
  return null
}

/**
 * The disposition function, kept pure so AC 7's deterministic evaluation can
 * prove it without a model.
 *
 * `block` needs one unsafe class strictly above its floor. `pass` needs all
 * three of a confident `Neutral`, an unsafe aggregate strictly below its
 * ceiling, and every unsafe class strictly below the block floor.
 * Everything else, uncertainty included, is a human's problem.
 *
 * Every comparison is strict, so a probability sitting exactly on a threshold
 * has not crossed it and the case resolves to review from both sides. That is
 * why the third condition is stated as "strictly below the block floor" rather
 * than as the negation of the block rule: the negation would let a class
 * sitting exactly on the floor publish, which is the one direction AC 2 says a
 * boundary may never resolve in.
 *
 * The aggregate condition closes a separate fail-open. With only the Neutral
 * floor and the per-class floor, `Neutral` 0.86 alongside `Porn` 0.13 clears
 * the Neutral floor, never reaches the 0.35 block floor, and publishes.
 */
export function evaluateNsfwDisposition(
  probabilities: readonly number[],
  classNames: readonly string[],
  policy: NsfwImagePolicy
): NsfwEvaluation {
  if (probabilities.length !== classNames.length) {
    return emptyEvaluation(NSFW_REASON_OUTPUT_INVALID)
  }

  const mapped: Record<string, number> = {}
  classNames.forEach((className, index) => {
    mapped[className] = probabilities[index] as number
  })

  const invalid = validateVector(probabilities, mapped, policy)
  if (invalid) return invalid

  const unsafeScores = policy.unsafeClasses.map(
    (className) => mapped[className] as number
  )
  if (unsafeScores.some((score) => score > policy.unsafeBlockMinimum)) {
    return {
      disposition: 'block',
      reasons: [NSFW_REASON_UNSAFE_CLASS],
      classProbabilities: mapped,
    }
  }

  const unsafeAggregate = unsafeScores.reduce((total, score) => total + score, 0)
  const publishable =
    (mapped.Neutral as number) > policy.neutralPassMinimum &&
    unsafeAggregate < policy.unsafeAggregateMaximum &&
    unsafeScores.every((score) => score < policy.unsafeBlockMinimum)
  if (publishable) {
    return { disposition: 'pass', reasons: [], classProbabilities: mapped }
  }
  return review(NSFW_REASON_LOW_CONFIDENCE, mapped)
}

/**
 * What a screening returns. It is a superset of {@link ImageScreeningResult}
 * rather than a replacement: the seam's four fields keep their existing meaning
 * for every current consumer, and the disposition, probabilities and policy
 * identity ride alongside for the moderation event and the evaluation payload.
 */
export interface NsfwImageScreeningResult extends ImageScreeningResult {
  disposition: NsfwDisposition
  classProbabilities: Record<string, number>
  modelDigest: string
  policyVersion: string
  policyDigest: string
  inferenceMs: number
}

/**
 * Composes the persisted engine identity from what actually ran. Both digests
 * are truncated because the column is shared with the text engine's version and
 * an operator has to be able to read it; the full digests live in the manifest
 * and the evaluation payload, and twelve hex characters still distinguish any
 * two artifacts this project will ever ship.
 */
export function composeEngineVersion(identity: NsfwRuntimeIdentity): string {
  return [
    ADR013_IMAGE_ENGINE_VERSION,
    `${identity.modelFamily}@${identity.packageVersion}`,
    `model-${identity.modelDigest.slice(0, 12)}`,
    identity.policyVersion,
    `policy-${identity.policyDigest.slice(0, 12)}`,
  ].join(':')
}

/**
 * Finds the committed manifest, and refuses to be pointed anywhere else in
 * production.
 *
 * The environment override exists for tests and for the local measurement run,
 * and it is gated on {@link allowsTestOnlySecrets} for the same reason the
 * story refuses a policy-path variable outright: the manifest names the policy
 * and carries its hash, so an env-selectable manifest is an env-selectable
 * policy wearing one more layer of indirection, and that is exactly the
 * unapproved-policy route the hash exists to close.
 */
export function resolveManifestPath(explicit?: string): string {
  const override = explicit ?? process.env[COMMUNITY_NSFW_MANIFEST_ENV]?.trim()
  if (override && !allowsTestOnlySecrets()) {
    throw new Error(
      `A ${COMMUNITY_NSFW_MANIFEST_ENV} override is forbidden outside an allowed test environment; production reads the committed manifest`
    )
  }
  if (override) return path.resolve(override)

  const candidates = [
    path.resolve(__dirname, '../../../model-manifests'),
    path.resolve(__dirname, '../../../../model-manifests'),
  ]
  for (const directory of candidates) {
    if (!fs.existsSync(directory)) continue
    const entry = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith('community-nsfw-') && name.endsWith('.json'))
      .sort()[0]
    if (entry) return path.join(directory, entry)
  }
  throw new Error(`Community NSFW model manifest not found in: ${candidates.join(', ')}`)
}

/**
 * Reads the policy the manifest approves, and proves it is that policy before
 * trusting a threshold out of it. An unapproved or edited policy file is a
 * startup failure, which is what keeps the hash in the engine identity honest.
 */
export async function loadApprovedPolicy(
  manifest: NsfwModelManifest,
  manifestPath: string
): Promise<{ policy: NsfwImagePolicy; version: string; digest: string }> {
  const policyPath = path.resolve(path.dirname(manifestPath), manifest.policy.path)
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Approved screening policy not found: ${manifest.policy.path}`)
  }
  const digest = (await computeSha256(policyPath)).toLowerCase()
  if (digest !== manifest.policy.sha256.toLowerCase()) {
    throw new Error(
      `Screening policy checksum mismatch: expected ${manifest.policy.sha256}, got ${digest}`
    )
  }

  const parsed = screeningPolicySchema.safeParse(
    JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  )
  if (!parsed.success) {
    throw new Error(`Screening policy is invalid: ${parsed.error.issues[0]?.message}`)
  }
  if (parsed.data.version !== manifest.policy.version) {
    throw new Error(
      `Screening policy version mismatch: manifest names ${manifest.policy.version}, file declares ${parsed.data.version}`
    )
  }

  assertPolicyClassesMatchModel(manifest, parsed.data.image)
  assertThresholdMirrorMatches(manifest, parsed.data.image)
  assertReasonCodesArePolicyWired(parsed.data.reasonCodes.image)

  return { policy: parsed.data.image, version: parsed.data.version, digest }
}

function assertPolicyClassesMatchModel(
  manifest: NsfwModelManifest,
  policy: NsfwImagePolicy
): void {
  const sameClassNames =
    policy.classNames.length === manifest.classNames.length &&
    policy.classNames.every((name, index) => manifest.classNames[index] === name)
  if (!sameClassNames) {
    throw new Error(
      'Screening policy class names do not match the class names the manifest pins'
    )
  }
  const unknownUnsafeClass = policy.unsafeClasses.find(
    (className) => !manifest.classNames.includes(className)
  )
  if (unknownUnsafeClass) {
    throw new Error(
      `Screening policy names an unsafe class the model does not emit: ${unknownUnsafeClass}`
    )
  }
}

/**
 * AC 7 asks for the policy to be provably wired, not merely present. Every
 * code this adapter can persist has to exist in the policy's own reason-code
 * table, and no code may be emitted at a disposition weaker than the floor the
 * policy records for it, so a reason string cannot quietly come to mean
 * something softer than the policy says it means.
 */
export function assertReasonCodesArePolicyWired(
  declared: Record<string, 'pass' | 'review' | 'block'>
): void {
  const missing = NSFW_IMAGE_REASON_CODES.filter((code) => !(code in declared))
  if (missing.length > 0) {
    throw new Error(
      `Screening policy declares no disposition for reason codes: ${missing.join(', ')}`
    )
  }
  if (declared[NSFW_REASON_UNSAFE_CLASS] !== 'block') {
    throw new Error(
      `Screening policy must record ${NSFW_REASON_UNSAFE_CLASS} as block, not ${declared[NSFW_REASON_UNSAFE_CLASS]}`
    )
  }
  const softened = NSFW_IMAGE_REASON_CODES.filter(
    (code) => code !== NSFW_REASON_UNSAFE_CLASS && declared[code] === 'pass'
  )
  if (softened.length > 0) {
    throw new Error(
      `Screening policy would let these reason codes publish: ${softened.join(', ')}`
    )
  }
}

/**
 * When the manifest states the image thresholds itself, they must be the same
 * thresholds the policy file declares. Only the five mirrored keys are
 * compared, picked out of the policy block, because the policy also carries the
 * rationale prose that JSON cannot hold as a comment and the manifest does not
 * repeat. Verifying the mirror rather than reading from it means the manifest
 * can satisfy "the manifest pins thresholds" without becoming a second source
 * of truth that drifts from the hashed policy.
 */
function assertThresholdMirrorMatches(
  manifest: NsfwModelManifest,
  policy: NsfwImagePolicy
): void {
  const mirror = manifest.thresholds
  if (!mirror) return

  const policyRecord = policy as unknown as Record<string, unknown>
  const stable = (value: unknown): string => JSON.stringify(value) ?? 'undefined'

  const unexpected = Object.keys(mirror).filter(
    (key) => !(NSFW_MIRRORED_THRESHOLD_KEYS as readonly string[]).includes(key)
  )
  if (unexpected.length > 0) {
    throw new Error(
      `Model manifest thresholds mirror unexpected keys: ${unexpected.join(', ')}`
    )
  }

  const drifted = NSFW_MIRRORED_THRESHOLD_KEYS.filter(
    (key) => stable(mirror[key]) !== stable(policyRecord[key])
  )
  if (drifted.length > 0) {
    throw new Error(
      `Model manifest thresholds do not match the approved screening policy: ${drifted.join(', ')}`
    )
  }
}

/**
 * A screening failure that rejects the BullMQ attempt rather than producing a
 * verdict. The reason code rides along so the pipeline can persist a stable
 * reason if the attempts are exhausted, instead of persisting a message.
 */
export class NsfwScreeningError extends Error {
  constructor(
    message: string,
    readonly reasonCode: string
  ) {
    super(message)
    this.name = 'NsfwScreeningError'
  }
}

/**
 * Normalizes whatever a worker thread's `error` event actually carries.
 *
 * The Node typings say `Error`, but the value crosses a thread boundary and is
 * whatever the thread threw, so a module-resolution failure or a rejected
 * non-Error arrives here as a plain object. Rejecting with that value makes
 * Vitest print `{ stacks: [] }` and hides the real cause entirely: a worktree
 * whose node_modules predated the TensorFlow.js install failed every case in
 * the smoke suite with the true message, `Cannot find module
 * '@tensorflow/tfjs-core'`, never once surfacing.
 */
export function toWorkerError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string' && value.length > 0) return new Error(value)
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { message?: unknown; code?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      const error = new Error(candidate.message)
      if (typeof candidate.code === 'string') error.name = candidate.code
      return error
    }
    // Nothing message-shaped, so serialise it rather than lose it.
    try {
      return new Error(`${fallback}: ${JSON.stringify(value)}`)
    } catch {
      return new Error(fallback)
    }
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return new Error(`${fallback}: ${value.toString()}`)
  }
  return new Error(fallback)
}

export interface TensorflowNsfwImageScreenerOptions {
  manifestPath?: string
  inferenceTimeoutMs?: number
}

export class TensorflowNsfwImageScreener implements NsfwImageScreener {
  private readonly manifestPath: string
  private readonly inferenceTimeoutMs: number
  private worker: Worker | null = null
  private ready = false
  private readyPromise: Promise<void> | null = null
  private restartPromise: Promise<void> | null = null
  private closing = false
  private requestCounter = 0
  private identity: NsfwRuntimeIdentity | null = null
  private policy: NsfwImagePolicy | null = null
  private resolvedEngineVersion: string | null = null
  private initializationFailure: { error: Error; failedAt: number } | null = null
  /** Settles an in-flight startup, so closing mid-startup cannot strand a caller. */
  private abortInitialization: ((error: unknown) => void) | null = null
  /** Serialises inference so one model process runs one classification at a time. */
  private inferenceChain: Promise<unknown> = Promise.resolve()

  constructor(options: TensorflowNsfwImageScreenerOptions = {}) {
    this.manifestPath = resolveManifestPath(options.manifestPath)
    this.inferenceTimeoutMs =
      options.inferenceTimeoutMs ??
      (Number(process.env[COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV]) ||
        NSFW_INFERENCE_TIMEOUT_MS)
  }

  /**
   * Reports the identity that actually ran once one exists. Before readiness it
   * says so out loud rather than guessing, because this string is persisted and
   * a provisional value would be indistinguishable from a real one later. The
   * runtime awaits {@link ensureReady} before consuming the queue, so nothing
   * persists the unresolved form in production.
   */
  get engineVersion(): string {
    return this.resolvedEngineVersion ?? `${ADR013_IMAGE_ENGINE_VERSION}:unresolved`
  }

  get runtimeIdentity(): NsfwRuntimeIdentity | null {
    return this.identity
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return
    if (this.closing) {
      throw new Error('Community NSFW screener is closing')
    }
    const failure = this.initializationFailure
    if (failure && Date.now() - failure.failedAt < NSFW_FAILURE_COOLDOWN_MS) {
      // Inside the cooldown the previous cause is replayed rather than a new
      // model process spawned, so a broken install cannot be respawned once per
      // job for the lifetime of the worker.
      throw failure.error
    }
    if (this.restartPromise) {
      await this.restartPromise
    }
    if (!this.policy) {
      await this.loadPolicy()
    }
    if (!this.worker) {
      try {
        this.spawnWorker()
      } catch (error) {
        // A missing build artifact throws synchronously, before any of the
        // listeners below can record it. Without this it would be the one
        // startup failure that re-probes the filesystem once per job instead
        // of being held off by the cooldown.
        const normalized =
          error instanceof Error
            ? error
            : new Error('Community NSFW model process could not be spawned')
        this.initializationFailure = { error: normalized, failedAt: Date.now() }
        throw normalized
      }
    }
    if (this.readyPromise) {
      await this.readyPromise
    }
  }

  private async loadPolicy(): Promise<void> {
    try {
      const manifest = readModelManifest(this.manifestPath)
      const { policy } = await loadApprovedPolicy(manifest, this.manifestPath)
      this.policy = policy
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error('Screening policy could not be loaded')
      this.initializationFailure = { error: normalized, failedAt: Date.now() }
      throw normalized
    }
  }

  private workerScriptPath(): string {
    const compiled = path.join(__dirname, 'community-nsfw-inference.worker.js')
    if (fs.existsSync(compiled)) return compiled
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Community NSFW inference worker build artifact is missing: ${compiled}`
      )
    }
    const source = path.join(__dirname, 'community-nsfw-inference.worker.ts')
    if (fs.existsSync(source)) return source
    throw new Error(`Community NSFW inference worker source is missing: ${source}`)
  }

  private spawnWorker(): void {
    const workerPath = this.workerScriptPath()
    this.ready = false
    const worker = new Worker(workerPath, {
      workerData: { manifestPath: this.manifestPath },
      execArgv: workerPath.endsWith('.ts') ? ['-r', 'ts-node/register'] : [],
    })
    this.worker = worker

    const readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        rejectInitialization(
          new Error(
            `Community NSFW model startup timed out after ${NSFW_INITIALIZATION_TIMEOUT_MS.toLocaleString()} ms`
          )
        )
        void worker.terminate()
      }, NSFW_INITIALIZATION_TIMEOUT_MS)
      timer.unref()

      const cleanup = () => {
        clearTimeout(timer)
        worker.off('message', onMessage)
        worker.off('error', onError)
      }
      const rejectInitialization = (raw: unknown) => {
        if (settled) return
        const error = toWorkerError(raw, 'Community NSFW model process failed to start')
        settled = true
        this.initializationFailure = { error, failedAt: Date.now() }
        cleanup()
        // Clearing the handle here rather than waiting for `exit` is what makes
        // recovery a property of this controller instead of a property of
        // message-versus-exit delivery order. A worker that reports a failed
        // initialization and then lingers would otherwise leave `this.worker`
        // set, so the next `ensureReady` past the cooldown would re-await an
        // already-rejected promise and replay the same error forever.
        if (this.worker === worker) {
          this.worker = null
          this.ready = false
          this.readyPromise = null
        }
        void worker.terminate().catch(() => undefined)
        reject(error)
      }
      this.abortInitialization = rejectInitialization
      const onRuntimeError = (raw: unknown) => {
        if (this.closing || this.worker !== worker) return
        const error = toWorkerError(raw, 'Community NSFW model process errored')
        this.initializationFailure = { error, failedAt: Date.now() }
        void this.restartWorker(worker).catch(() => undefined)
      }
      const onMessage = (message: NsfwInferenceResponse) => {
        if (message?.type === 'ready') {
          settled = true
          this.ready = true
          this.identity = message.identity
          this.resolvedEngineVersion = composeEngineVersion(message.identity)
          this.initializationFailure = null
          this.abortInitialization = null
          cleanup()
          worker.on('error', onRuntimeError)
          resolve()
        } else if (message?.type === 'initialization_error') {
          rejectInitialization(new Error(message.error))
        }
      }
      const onError = (raw: unknown) => rejectInitialization(raw)

      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.on('exit', (code) => {
        worker.off('error', onRuntimeError)
        if (this.worker === worker) {
          this.worker = null
          this.ready = false
          this.readyPromise = null
        }
        if (!settled && !this.closing) {
          rejectInitialization(
            new Error(
              `Community NSFW model process exited before ready with code ${code}`
            )
          )
        }
      })
    })
    // The rejection is delivered through `ensureReady`; claiming it here keeps
    // a startup failure from becoming an unhandled rejection, which Node turns
    // into a process exit.
    void readyPromise.catch(() => undefined)
    this.readyPromise = readyPromise
  }

  private async restartWorker(failed: Worker): Promise<void> {
    if (this.restartPromise) return this.restartPromise
    this.restartPromise = (async () => {
      if (this.worker === failed) {
        this.ready = false
        this.worker = null
        this.readyPromise = null
      }
      // Terminating is the point: it stops the CPU-bound classification that
      // the timeout only noticed. A respawn waits for the next `ensureReady`,
      // which the cooldown holds off, so a wedged model is not restarted in a
      // tight loop.
      await failed.terminate()
    })()
    try {
      await this.restartPromise
    } finally {
      this.restartPromise = null
    }
  }

  screen(imageBuffer: Buffer): Promise<NsfwImageScreeningResult> {
    // The chain is re-seeded with a `catch`, so it is always fulfilled and a
    // rejection handler here would be dead code. A failed screening therefore
    // does not poison the queue behind it: the next request still runs.
    const dispatched = this.inferenceChain.then(() => this.screenOnce(imageBuffer))
    this.inferenceChain = dispatched.catch(() => undefined)
    return dispatched
  }

  private async screenOnce(imageBuffer: Buffer): Promise<NsfwImageScreeningResult> {
    await this.ensureReady()
    const worker = this.worker
    const policy = this.policy
    const identity = this.identity
    if (!worker || !this.ready || !policy || !identity) {
      throw new Error('Community NSFW screener is not ready')
    }

    const requestId = `nsfw-${++this.requestCounter}`
    const { probabilities, classNames, inferenceMs } = await this.requestInference(
      worker,
      requestId,
      imageBuffer
    )

    const evaluation = evaluateNsfwDisposition(probabilities, classNames, policy)
    const engineVersion = composeEngineVersion(identity)
    return {
      passed: evaluation.disposition === 'pass',
      reasons: evaluation.reasons,
      engineVersion,
      score: evaluation.classProbabilities.Neutral,
      disposition: evaluation.disposition,
      classProbabilities: evaluation.classProbabilities,
      modelDigest: identity.modelDigest,
      policyVersion: identity.policyVersion,
      policyDigest: identity.policyDigest,
      inferenceMs,
    }
  }

  private requestInference(
    worker: Worker,
    requestId: string,
    imageBuffer: Buffer
  ): Promise<{ probabilities: number[]; classNames: string[]; inferenceMs: number }> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        worker.off('message', onMessage)
        worker.off('error', onError)
      }

      const onMessage = (message: NsfwInferenceResponse) => {
        if (
          !message ||
          message.type === 'ready' ||
          message.type === 'initialization_error'
        ) {
          return
        }
        if (message.id !== requestId) return
        cleanup()
        if (message.type === 'result') {
          resolve({
            probabilities: message.probabilities,
            classNames: message.classNames,
            inferenceMs: message.inferenceMs,
          })
        } else {
          reject(new Error(`${message.code}: ${message.error}`))
        }
      }

      const onError = (raw: unknown) => {
        cleanup()
        const error = toWorkerError(raw, 'Community NSFW inference process errored')
        void this.restartWorker(worker).then(
          () => reject(error),
          (restartError: unknown) =>
            reject(restartError instanceof Error ? restartError : error)
        )
      }

      timer = setTimeout(() => {
        cleanup()
        const timeout = new NsfwScreeningError(
          `Community NSFW inference timed out after ${this.inferenceTimeoutMs.toLocaleString()} ms`,
          NSFW_REASON_INFERENCE_TIMEOUT
        )
        this.initializationFailure = { error: timeout, failedAt: Date.now() }
        void this.restartWorker(worker).then(
          () => reject(timeout),
          (restartError: unknown) =>
            reject(restartError instanceof Error ? restartError : timeout)
        )
      }, this.inferenceTimeoutMs)

      worker.on('message', onMessage)
      worker.on('error', onError)
      const request: NsfwInferenceRequest = { id: requestId, imageBuffer }
      worker.postMessage(request)
    })
  }

  async close(): Promise<void> {
    this.closing = true
    // The `exit` handler declines to reject once `closing` is set, so without
    // this an `ensureReady()` that was still in flight would never settle.
    this.abortInitialization?.(
      new Error('Community NSFW screener closed before the model became ready')
    )
    this.abortInitialization = null
    if (this.restartPromise) {
      await this.restartPromise
    }
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }
    this.ready = false
    this.readyPromise = null
  }
}
