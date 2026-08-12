// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- the ONNX runtime session and tokenizer are stubbed with untyped test doubles, which is the established pattern for these suites. */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GarmentTaggingOutputError } from './garment-tagging.engine'
// vi.mock is hoisted above this import, so the faked node:worker_threads
// module is already in place when the engine module is evaluated. A
// top-level `await import` is not an option: this workspace compiles specs
// as CommonJS, where top-level await is a TS1309 error.
import * as FashionClipTaggingEngineModule from './fashion-clip-tagging.engine.js'
import type { InferenceRequest, InferenceResponse } from './fashion-clip-inference.worker'

/**
 * The real engine boots a `node:worker_threads` worker that loads a ~600 MB
 * FashionCLIP ONNX snapshot. That boundary is replaced here so the engine's own
 * supervision logic — readiness, initialization failure cooldown, restart after a
 * crash or timeout, and error translation — is testable without the model.
 */
const workerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeWorker {
    static readonly instances: FakeWorker[] = []

    readonly listeners = new Map<string, Listener[]>()
    readonly postMessage = vi.fn()
    terminate: () => Promise<number> = () => Promise.resolve(0)

    constructor(
      readonly scriptPath: string,
      readonly options: { workerData?: { modelDir?: string }; execArgv?: string[] }
    ) {
      FakeWorker.instances.push(this)
    }

    on(event: string, listener: Listener): this {
      const existing = this.listeners.get(event) ?? []
      this.listeners.set(event, [...existing, listener])
      return this
    }

    off(event: string, listener: Listener): this {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((entry) => entry !== listener)
      )
      return this
    }

    emit(event: string, payload?: unknown): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(payload)
      }
    }

    listenerCount(event: string): number {
      return (this.listeners.get(event) ?? []).length
    }
  }

  return { FakeWorker }
})

vi.mock('node:worker_threads', () => ({ Worker: workerHarness.FakeWorker }))

const { FashionClipTaggingEngine } = FashionClipTaggingEngineModule

type FakeWorker = InstanceType<typeof workerHarness.FakeWorker>

const MODEL_DIR = '/models/fashion-clip'
const ANALYSIS_VERSION =
  'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1'

/** Six category prompts, dominated by `top`; nine material prompts by `cotton`. */
const CONFIDENT_CATEGORY_LOGITS = [9, 0, 0, 0, 0, 0]
const CONFIDENT_MATERIAL_LOGITS = [9, 0, 0, 0, 0, 0, 0, 0, 0]

function workers(): FakeWorker[] {
  return workerHarness.FakeWorker.instances
}

function latestWorker(): FakeWorker {
  const worker = workers().at(-1)
  if (!worker) throw new Error('no worker was spawned')
  return worker
}

function lastRequestId(worker: FakeWorker): string {
  const call = worker.postMessage.mock.calls.at(-1)
  return (call?.[0] as InferenceRequest).id
}

function send(worker: FakeWorker, message: InferenceResponse): void {
  worker.emit('message', message)
}

describe('FashionClipTaggingEngine worker supervision', () => {
  beforeEach(() => {
    workers().length = 0
    vi.stubEnv('NODE_ENV', 'test')
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('startup', () => {
    it('hands the resolved model directory to the worker and resolves once it is ready', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()

      expect(worker.options.workerData?.modelDir).toBe(path.resolve(MODEL_DIR))
      send(worker, { type: 'ready' })

      await expect(engine.ensureReady()).resolves.toBeUndefined()
    })

    /** Without a build artifact the engine must run the TypeScript source under ts-node. */
    it('falls back to the TypeScript worker source outside production', () => {
      new FashionClipTaggingEngine(MODEL_DIR)

      expect(latestWorker().scriptPath.endsWith('.ts')).toBe(true)
      expect(latestWorker().options.execArgv).toEqual(['-r', 'ts-node/register'])
    })

    /** Reading a `.ts` worker in production would mean shipping an unbuilt artifact. */
    it('refuses to start in production when the compiled worker is missing', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)

      expect(() => new FashionClipTaggingEngine(MODEL_DIR)).toThrow(
        /inference worker build artifact is missing/
      )
    })

    it('refuses to start when neither the compiled worker nor its source exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)

      expect(() => new FashionClipTaggingEngine(MODEL_DIR)).toThrow(
        /inference worker source is missing/
      )
    })

    /** With no explicit directory the engine falls back to the env var. */
    it('reads the model directory from GARMENT_TAGGING_MODEL_DIR when none is passed', () => {
      vi.stubEnv('GARMENT_TAGGING_MODEL_DIR', '/env/model-dir')

      new FashionClipTaggingEngine()

      expect(latestWorker().options.workerData?.modelDir).toBe('/env/model-dir')
    })

    /** With neither an argument nor the env var, the bundled cache path is used. */
    it('falls back to the bundled model cache when nothing configures a directory', () => {
      new FashionClipTaggingEngine()

      expect(latestWorker().options.workerData?.modelDir).toMatch(
        /\.cache\/garment-tagging-model$/
      )
    })

    /**
     * When the build artifact exists it must be used directly. Loading the
     * compiled worker under `ts-node/register` would pull a dev-only loader into
     * a production process.
     */
    it('runs the compiled worker without a TypeScript loader when it is built', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      new FashionClipTaggingEngine(MODEL_DIR)

      expect(latestWorker().scriptPath.endsWith('.js')).toBe(true)
      expect(latestWorker().options.execArgv).toEqual([])
    })

    /** Unrelated worker chatter before `ready` must not settle initialization. */
    it('ignores a non-lifecycle message received before the worker is ready', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()

      send(worker, {
        type: 'result',
        id: 'stray',
        categoryLogits: CONFIDENT_CATEGORY_LOGITS,
        materialLogits: CONFIDENT_MATERIAL_LOGITS,
      })
      send(worker, { type: 'ready' })

      await expect(engine.ensureReady()).resolves.toBeUndefined()
    })
  })

  describe('initialization failures', () => {
    it('surfaces the worker initialization error to the caller', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)

      send(latestWorker(), {
        type: 'initialization_error',
        error: 'model snapshot missing required file',
      })

      await expect(engine.ensureReady()).rejects.toThrow(
        'model snapshot missing required file'
      )
    })

    /**
     * A failed model load is expensive to retry. Within the cooldown the stored
     * error is replayed instead of spawning another worker that will fail again.
     */
    it('replays the stored failure without respawning during the cooldown', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()

      send(worker, { type: 'initialization_error', error: 'onnx load failed' })
      worker.emit('exit', 1)

      await expect(engine.ensureReady()).rejects.toThrow('onnx load failed')
      await expect(engine.ensureReady()).rejects.toThrow('onnx load failed')
      expect(workers()).toHaveLength(1)
    })

    it('spawns a fresh worker once the failure cooldown has expired', async () => {
      vi.useFakeTimers()
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const failed = latestWorker()

      send(failed, { type: 'initialization_error', error: 'onnx load failed' })
      failed.emit('exit', 1)
      await expect(engine.ensureReady()).rejects.toThrow('onnx load failed')

      vi.advanceTimersByTime(5_001)
      const ready = engine.ensureReady()
      expect(workers()).toHaveLength(2)
      send(latestWorker(), { type: 'ready' })

      await expect(ready).resolves.toBeUndefined()
    })

    /** A worker that dies during model load never sends a message at all. */
    it('rejects when the worker exits before reporting ready', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)

      latestWorker().emit('exit', 3)

      await expect(engine.ensureReady()).rejects.toThrow(
        'FashionCLIP inference worker exited before ready with code 3'
      )
    })

    it('rejects when the worker emits an error before reporting ready', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)

      latestWorker().emit('error', new Error('worker thread crashed'))

      await expect(engine.ensureReady()).rejects.toThrow('worker thread crashed')
    })

    /** A model load that never settles must not hang every caller forever. */
    it('terminates the worker when initialization exceeds its timeout', async () => {
      vi.useFakeTimers()
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()
      const terminate = vi.fn().mockResolvedValue(0)
      worker.terminate = terminate

      const ready = engine.ensureReady()
      vi.advanceTimersByTime(30_000)

      await expect(ready).rejects.toThrow(/initialization timed out after/)
      expect(terminate).toHaveBeenCalledTimes(1)
    })

    /** A respawn that cannot even find the worker script must report that reason. */
    it('reports a respawn failure raised while recovering', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      latestWorker().emit('exit', 0)
      await expect(engine.ensureReady()).rejects.toThrow(/exited before ready/)

      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      vi.useFakeTimers()
      vi.advanceTimersByTime(5_001)

      await expect(engine.ensureReady()).rejects.toThrow(
        /inference worker source is missing/
      )
    })
  })

  describe('inferTags', () => {
    async function readyEngine() {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      send(latestWorker(), { type: 'ready' })
      await engine.ensureReady()
      return engine
    }

    it('classifies worker logits into a validated suggestion snapshot', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      send(worker, {
        type: 'result',
        id: lastRequestId(worker),
        categoryLogits: CONFIDENT_CATEGORY_LOGITS,
        materialLogits: CONFIDENT_MATERIAL_LOGITS,
      })

      await expect(pending).resolves.toEqual({
        analysisVersion: ANALYSIS_VERSION,
        category: { value: 'top', confidence: expect.any(Number), isConfident: true },
        material: { value: 'cotton', confidence: expect.any(Number), isConfident: true },
        comfortRange: {
          value: 'mild',
          confidence: expect.any(Number),
          isConfident: true,
        },
      })
    })

    /** Readiness announcements and results for other requests must not settle this one. */
    it('ignores unrelated worker messages while awaiting its own result', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))

      send(worker, { type: 'ready' })
      send(worker, {
        type: 'result',
        id: 'req-someone-else',
        categoryLogits: CONFIDENT_CATEGORY_LOGITS,
        materialLogits: CONFIDENT_MATERIAL_LOGITS,
      })
      send(worker, {
        type: 'result',
        id: lastRequestId(worker),
        categoryLogits: CONFIDENT_CATEGORY_LOGITS,
        materialLogits: CONFIDENT_MATERIAL_LOGITS,
      })

      await expect(pending).resolves.toMatchObject({ category: { value: 'top' } })
    })

    /**
     * A truncated logit vector means the model produced something the label map
     * cannot describe, which is a tagging output failure the caller can fall back
     * from, not a generic crash.
     */
    it('translates an unclassifiable result into a tagging output error', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      send(worker, {
        type: 'result',
        id: lastRequestId(worker),
        categoryLogits: [1, 2],
        materialLogits: CONFIDENT_MATERIAL_LOGITS,
      })

      await expect(pending).rejects.toBeInstanceOf(GarmentTaggingOutputError)
      await expect(pending).rejects.toThrow('Inference result could not be classified')
    })

    it('preserves the worker TAGGING_OUTPUT_INVALID classification', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      send(worker, {
        type: 'error',
        id: lastRequestId(worker),
        error: 'Inference returned non-finite score',
        code: 'TAGGING_OUTPUT_INVALID',
      })

      await expect(pending).rejects.toBeInstanceOf(GarmentTaggingOutputError)
    })

    /** A generic inference failure is retriable and must not be reported as bad output. */
    it('reports a non-output inference failure as a plain error', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      send(worker, {
        type: 'error',
        id: lastRequestId(worker),
        error: 'onnx session crashed',
        code: 'TAGGING_INFERENCE_FAILED',
      })

      await expect(pending).rejects.toThrow('onnx session crashed')
      await expect(pending).rejects.not.toBeInstanceOf(GarmentTaggingOutputError)
    })

    it('restarts the worker and rejects when inference exceeds its timeout', async () => {
      vi.useFakeTimers()
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockResolvedValue(0)

      const pending = engine.inferTags(Buffer.from('image'))
      // Claim the rejection before driving the clock: advancing fake timers runs
      // a microtask checkpoint, which would otherwise see it unhandled.
      const settled = expect(pending).rejects.toThrow(
        'Inference execution timed out after 30,000 ms'
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30_000)

      await settled
      expect(workers()).toHaveLength(2)
    })

    /** If the restart itself fails the caller must learn why, not see the timeout. */
    it('reports the restart failure when recovery after a timeout fails', async () => {
      vi.useFakeTimers()
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockRejectedValue(new Error('terminate refused'))

      const pending = engine.inferTags(Buffer.from('image'))
      const settled = expect(pending).rejects.toThrow('terminate refused')
      await vi.advanceTimersByTimeAsync(0)
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30_000)

      await settled
    })

    it('rejects the in-flight request when the worker thread errors', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockResolvedValue(0)

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      worker.emit('error', new Error('worker thread died mid-inference'))

      await expect(pending).rejects.toThrow('worker thread died mid-inference')
    })
  })

  describe('runtime recovery and shutdown', () => {
    it('replaces a worker that errors after it was ready', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()
      worker.terminate = vi.fn().mockResolvedValue(0)
      send(worker, { type: 'ready' })
      await engine.ensureReady()

      worker.emit('error', new Error('segfault'))

      await vi.waitFor(() => expect(workers()).toHaveLength(2))
    })

    /** Shutdown must not fight the supervisor by respawning what it just closed. */
    it('does not respawn after close, even if the old worker errors', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()
      const terminate = vi.fn().mockResolvedValue(0)
      worker.terminate = terminate
      send(worker, { type: 'ready' })
      await engine.ensureReady()

      await engine.close()
      worker.emit('error', new Error('late failure'))

      expect(terminate).toHaveBeenCalledTimes(1)
      expect(workers()).toHaveLength(1)
    })

    it('is safe to close twice', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()
      const terminate = vi.fn().mockResolvedValue(0)
      worker.terminate = terminate
      send(worker, { type: 'ready' })
      await engine.ensureReady()

      await engine.close()
      await expect(engine.close()).resolves.toBeUndefined()
      expect(terminate).toHaveBeenCalledTimes(1)
    })

    /**
     * A worker that exits after it has already been replaced must not clear the
     * live worker out from under the engine. That is the difference between a
     * clean rolling restart and an engine that silently has no worker at all.
     */
    it('ignores the exit of a worker that was already replaced', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const first = latestWorker()
      first.terminate = vi.fn().mockResolvedValue(0)
      send(first, { type: 'ready' })
      await engine.ensureReady()

      first.emit('error', new Error('segfault'))
      await vi.waitFor(() => expect(workers()).toHaveLength(2))
      send(latestWorker(), { type: 'ready' })
      await engine.ensureReady()

      first.emit('exit', 1)

      await expect(engine.ensureReady()).resolves.toBeUndefined()
      expect(workers()).toHaveLength(2)
    })

    /**
     * A caller arriving mid-restart must wait for the replacement rather than
     * racing it and spawning a third worker. The restart is started from a failed
     * inference here, which is the one path that restarts without also arming the
     * initialization-failure cooldown.
     */
    /**
     * Starts the restart from an inference timeout, which is the one path that
     * replaces the worker without also arming the initialization-failure cooldown,
     * and holds `terminate()` open so the restart is observably still in flight.
     */
    function engineWithRestartInFlight() {
      vi.useFakeTimers()
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const first = latestWorker()
      let releaseTerminate: (() => void) | undefined
      first.terminate = () =>
        new Promise<number>((resolve) => {
          releaseTerminate = () => resolve(0)
        })
      send(first, { type: 'ready' })

      return {
        engine,
        // The rejection assertion is handed back inside an object: returning the
        // promise itself would make this async function adopt it and never settle.
        start: async () => {
          await engine.ensureReady()
          const pending = engine.inferTags(Buffer.from('image'))
          const settled = expect(pending).rejects.toThrow(/timed out/)
          await vi.advanceTimersByTimeAsync(0)
          await vi.advanceTimersByTimeAsync(30_000)
          expect(releaseTerminate).toBeDefined()
          return { settled }
        },
        release: async () => {
          releaseTerminate?.()
          await vi.advanceTimersByTimeAsync(0)
        },
      }
    }

    it('makes a caller wait for an in-flight restart instead of spawning again', async () => {
      const { engine, start, release } = engineWithRestartInFlight()
      const { settled } = await start()

      const waiting = engine.ensureReady()
      await release()

      expect(workers()).toHaveLength(2)
      send(latestWorker(), { type: 'ready' })

      await expect(waiting).resolves.toBeUndefined()
      await settled
      expect(workers()).toHaveLength(2)
    })

    /** Shutdown that lands mid-restart must wait it out and then respawn nothing. */
    it('waits for an in-flight restart before closing and does not respawn', async () => {
      const { engine, start, release } = engineWithRestartInFlight()
      const { settled } = await start()

      const closing = engine.close()
      await release()

      await expect(closing).resolves.toBeUndefined()
      await settled
      expect(workers()).toHaveLength(1)
    })

    /**
     * After a clean shutdown the engine can be revived, and a spawn failure that
     * throws a non-Error must still reach the caller as an Error.
     */
    it('normalizes a non-Error spawn failure raised while reviving the engine', async () => {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      const worker = latestWorker()
      worker.terminate = vi.fn().mockResolvedValue(0)
      send(worker, { type: 'ready' })
      await engine.ensureReady()

      worker.emit('exit', 0)
      vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the non-Error throw is exactly the case the engine must normalize.
        throw 'filesystem exploded'
      })

      await expect(engine.ensureReady()).rejects.toThrow(
        'Failed to spawn inference worker'
      )
    })
  })

  describe('inference protocol drift', () => {
    async function readyEngine() {
      const engine = new FashionClipTaggingEngine(MODEL_DIR)
      send(latestWorker(), { type: 'ready' })
      await engine.ensureReady()
      return engine
    }

    /**
     * A response type this engine does not know is claimed by request id and then
     * matches neither `result` nor `error`, so the engine detaches its handlers
     * without resolving. Pinning that here documents the failure mode: an
     * unrecognized type strands the caller rather than surfacing an error.
     */
    it('detaches its handlers for a response type it does not recognize', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()

      const pending = engine.inferTags(Buffer.from('image'))
      void pending.catch(() => undefined)
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      const inFlightListeners = worker.listenerCount('message')

      worker.emit('message', {
        type: 'progress',
        id: lastRequestId(worker),
      } as unknown as InferenceResponse)

      expect(worker.listenerCount('message')).toBe(inFlightListeners - 1)
    })

    /** A restart that fails with a non-Error must not mask the original timeout. */
    it('falls back to a restart-failure error when the timeout restart rejects a non-Error', async () => {
      vi.useFakeTimers()
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockRejectedValue('terminate exploded')

      const pending = engine.inferTags(Buffer.from('image'))
      const settled = expect(pending).rejects.toThrow(
        'Inference worker restart failed after timeout'
      )
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)

      await settled
    })

    /** A restart failure during a thread error is the more useful diagnosis. */
    it('reports the restart failure when a worker error restart also fails', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockRejectedValue(new Error('terminate refused'))

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      worker.emit('error', new Error('worker thread died mid-inference'))

      await expect(pending).rejects.toThrow('terminate refused')
    })

    /** A non-Error restart failure falls back to the original thread error. */
    it('falls back to the thread error when the restart rejects a non-Error', async () => {
      const engine = await readyEngine()
      const worker = latestWorker()
      worker.terminate = vi.fn().mockRejectedValue('terminate exploded')

      const pending = engine.inferTags(Buffer.from('image'))
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      worker.emit('error', new Error('worker thread died mid-inference'))

      await expect(pending).rejects.toThrow('worker thread died mid-inference')
    })
  })
})
