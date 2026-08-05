// Story 4.2 Task 2 step 2 owner: implement FashionClipTaggingEngine ONNX inference engine in apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  garmentTagSuggestionSnapshotSchema,
  type GarmentTagSuggestionSnapshot,
} from '@couture/api-client/contracts/http'
import {
  ANALYSIS_VERSION,
  classifyCategory,
  classifyMaterial,
  deriveComfort,
  GarmentTaggingOutputError,
  type GarmentTaggingEngine,
} from './garment-tagging.engine'
import type { InferenceRequest, InferenceResponse } from './fashion-clip-inference.worker'

export class FashionClipTaggingEngine implements GarmentTaggingEngine {
  private static readonly INITIALIZATION_TIMEOUT_MS = 30_000
  private static readonly FAILURE_COOLDOWN_MS = 5_000
  private worker: Worker | null = null
  private isReady = false
  private readyPromise: Promise<void> | null = null
  private modelDir: string
  private requestIdCounter = 0
  private restartPromise: Promise<void> | null = null
  private closing = false
  private initializationFailure: { error: Error; failedAt: number } | null = null

  constructor(modelDir?: string) {
    this.modelDir = path.resolve(
      modelDir ||
        process.env.GARMENT_TAGGING_MODEL_DIR ||
        path.resolve(__dirname, '../../../.cache/garment-tagging-model')
    )

    this.spawnWorker()
  }

  private spawnWorker(): void {
    const workerScript = path.join(__dirname, 'fashion-clip-inference.worker.js')
    const fallbackScript = path.join(__dirname, 'fashion-clip-inference.worker.ts')

    let workerPath: string
    if (fs.existsSync(workerScript)) {
      workerPath = workerScript
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `FashionCLIP inference worker build artifact is missing: ${workerScript}`
      )
    } else if (fs.existsSync(fallbackScript)) {
      workerPath = fallbackScript
    } else {
      throw new Error(`FashionCLIP inference worker source is missing: ${fallbackScript}`)
    }

    this.isReady = false
    this.worker = new Worker(workerPath, {
      workerData: { modelDir: this.modelDir },
      execArgv: workerPath.endsWith('.ts') ? ['-r', 'ts-node/register'] : [],
    })
    const worker = this.worker

    const readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const initializationTimer = setTimeout(() => {
        const error = new Error(
          `FashionCLIP inference worker initialization timed out after ${FashionClipTaggingEngine.INITIALIZATION_TIMEOUT_MS.toLocaleString()} ms`
        )
        rejectInitialization(error)
        void worker.terminate()
      }, FashionClipTaggingEngine.INITIALIZATION_TIMEOUT_MS)
      initializationTimer.unref()
      const cleanupInitializationListeners = () => {
        clearTimeout(initializationTimer)
        worker.off('message', onMessage)
        worker.off('error', onError)
      }
      const rejectInitialization = (error: Error) => {
        if (settled) return
        settled = true
        this.initializationFailure = { error, failedAt: Date.now() }
        cleanupInitializationListeners()
        reject(error)
      }
      const onRuntimeError = (error: Error) => {
        if (this.closing || this.worker !== worker) return
        this.initializationFailure = { error, failedAt: Date.now() }
        void this.restartWorker(worker)
      }
      const onMessage = (msg: InferenceResponse) => {
        if (msg && msg.type === 'ready') {
          settled = true
          this.isReady = true
          this.initializationFailure = null
          cleanupInitializationListeners()
          worker.on('error', onRuntimeError)
          resolve()
        } else if (msg && msg.type === 'initialization_error') {
          rejectInitialization(new Error(msg.error))
        }
      }

      const onError = (err: Error) => {
        rejectInitialization(err)
      }

      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.on('exit', (code) => {
        worker.off('error', onRuntimeError)
        if (this.worker === worker) {
          this.worker = null
          this.isReady = false
          this.readyPromise = null
        }
        if (!settled && !this.closing) {
          rejectInitialization(
            new Error(
              `FashionCLIP inference worker exited before ready with code ${code}`
            )
          )
        }
      })
    })
    void readyPromise.catch(() => undefined)
    this.readyPromise = readyPromise
  }

  private async restartWorker(failedWorker: Worker): Promise<void> {
    if (this.restartPromise) {
      return this.restartPromise
    }
    this.restartPromise = (async () => {
      if (this.worker === failedWorker) {
        this.isReady = false
        this.worker = null
        this.readyPromise = null
      }
      try {
        await failedWorker.terminate()
      } finally {
        if (!this.closing && !this.worker) {
          this.spawnWorker()
        }
      }
    })()
    try {
      await this.restartPromise
    } finally {
      this.restartPromise = null
    }
  }

  public async ensureReady(): Promise<void> {
    if (this.isReady) return
    if (
      this.initializationFailure &&
      Date.now() - this.initializationFailure.failedAt <
        FashionClipTaggingEngine.FAILURE_COOLDOWN_MS
    ) {
      throw this.initializationFailure.error
    }
    if (this.restartPromise) {
      await this.restartPromise
    }
    if (!this.worker) {
      try {
        this.spawnWorker()
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error('Failed to spawn inference worker')
        this.initializationFailure = { error: normalized, failedAt: Date.now() }
        throw normalized
      }
    }
    if (this.readyPromise) {
      await this.readyPromise
    }
  }

  public async inferTags(imageBuffer: Buffer): Promise<GarmentTagSuggestionSnapshot> {
    await this.ensureReady()

    const reqId = `req-${++this.requestIdCounter}`
    const worker = this.worker

    if (!worker || !this.isReady) {
      throw new Error('FashionCLIP inference worker is not ready')
    }

    return new Promise<GarmentTagSuggestionSnapshot>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        worker.off('message', onMessage)
        worker.off('error', onError)
      }

      const onMessage = (msg: InferenceResponse) => {
        if (!msg || msg.type === 'ready' || msg.type === 'initialization_error') return
        if (msg.id === reqId) {
          cleanup()
          if (msg.type === 'result') {
            try {
              const category = classifyCategory(msg.categoryLogits)
              const material = classifyMaterial(msg.materialLogits)
              const comfortRange = deriveComfort(category, material)

              resolve(
                garmentTagSuggestionSnapshotSchema.parse({
                  analysisVersion: ANALYSIS_VERSION,
                  category,
                  material,
                  comfortRange,
                })
              )
            } catch (err) {
              reject(
                new GarmentTaggingOutputError(
                  'Inference result could not be classified',
                  {
                    cause: err,
                  }
                )
              )
            }
          } else if (msg.type === 'error') {
            reject(
              msg.code === 'TAGGING_OUTPUT_INVALID'
                ? new GarmentTaggingOutputError(msg.error)
                : new Error(msg.error)
            )
          }
        }
      }

      const onError = (err: Error) => {
        cleanup()
        void this.restartWorker(worker).then(
          () => reject(err),
          (restartError: unknown) =>
            reject(restartError instanceof Error ? restartError : err)
        )
      }

      timeoutTimer = setTimeout(() => {
        cleanup()
        void this.restartWorker(worker).then(
          () => reject(new Error('Inference execution timed out after 30,000 ms')),
          (restartError: unknown) =>
            reject(
              restartError instanceof Error
                ? restartError
                : new Error('Inference worker restart failed after timeout')
            )
        )
      }, 30_000)

      worker.on('message', onMessage)
      worker.on('error', onError)

      worker.postMessage({ id: reqId, imageBuffer } as InferenceRequest)
    })
  }

  public async close(): Promise<void> {
    this.closing = true
    if (this.restartPromise) {
      await this.restartPromise
    }
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
      this.isReady = false
    }
    this.readyPromise = null
  }
}
