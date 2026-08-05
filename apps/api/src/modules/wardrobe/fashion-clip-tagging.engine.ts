// Story 4.2 Task 2 step 2 owner: implement FashionClipTaggingEngine ONNX inference engine in apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { GarmentTagSuggestionSnapshot } from '@couture/api-client/contracts/http'
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
  private worker: Worker | null = null
  private isReady = false
  private readyPromise: Promise<void> | null = null
  private modelDir: string
  private requestIdCounter = 0
  private restartPromise: Promise<void> | null = null
  private closing = false

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

    const workerPath = fs.existsSync(workerScript) ? workerScript : fallbackScript

    this.isReady = false
    this.worker = new Worker(workerPath, {
      workerData: { modelDir: this.modelDir },
      execArgv: workerPath.endsWith('.ts') ? ['-r', 'ts-node/register'] : [],
    })
    const worker = this.worker

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanupInitializationListeners = () => {
        worker.off('message', onMessage)
        worker.off('error', onError)
      }
      const rejectInitialization = (error: Error) => {
        if (settled) return
        settled = true
        cleanupInitializationListeners()
        reject(error)
      }
      const onMessage = (msg: InferenceResponse) => {
        if (msg && msg.type === 'ready') {
          settled = true
          this.isReady = true
          cleanupInitializationListeners()
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
    if (this.restartPromise) {
      await this.restartPromise
    }
    if (!this.worker) {
      this.spawnWorker()
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

              resolve({
                analysisVersion: ANALYSIS_VERSION,
                category,
                material,
                comfortRange,
              })
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
