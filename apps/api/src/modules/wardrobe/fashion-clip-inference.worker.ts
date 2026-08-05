import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createBaseLogger } from '../../logger/pino.config'
import {
  CATEGORY_KEYS,
  CATEGORY_PROMPTS,
  MATERIAL_KEYS,
  MATERIAL_PROMPTS,
} from './garment-tagging.engine'

export type InferenceRequest = {
  id: string
  imageBuffer: Buffer
}

export type InferenceResponse =
  | {
      type: 'ready'
    }
  | {
      type: 'result'
      id: string
      categoryLogits: number[]
      materialLogits: number[]
    }
  | {
      type: 'initialization_error'
      error: string
    }
  | {
      type: 'error'
      id: string
      error: string
      code: 'TAGGING_OUTPUT_INVALID' | 'TAGGING_INFERENCE_FAILED'
    }

let processor: ((input: unknown) => Promise<Record<string, unknown>>) | null = null
let tokenizer:
  | ((
      input: string[],
      options: { padding: boolean; truncation: boolean }
    ) => Promise<Record<string, unknown>>)
  | null = null
let model: ((input: unknown) => Promise<unknown>) | null = null
let promptTextInputs: Record<string, unknown> | null = null
let initialized = false
const logger = createBaseLogger().child({ feature: 'fashion-clip-inference-worker' })

class InvalidInferenceOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInferenceOutputError'
  }
}

type TensorOutput = { data?: Float32Array } | Float32Array

type InferenceModelOutput = {
  logits_per_image?: TensorOutput
  logits?: TensorOutput
  image_embeds?: TensorOutput
  text_embeds?: TensorOutput
}

function tensorValues(tensor: TensorOutput | undefined): ArrayLike<number> | undefined {
  if (!tensor) {
    return undefined
  }
  return tensor instanceof Float32Array ? tensor : tensor.data
}

function calculateEmbeddingLogits(
  imageEmbeds: ArrayLike<number>,
  textEmbeds: ArrayLike<number>,
  promptCount: number
): number[] {
  const embedDimension = imageEmbeds.length
  if (embedDimension === 0 || textEmbeds.length !== promptCount * embedDimension) {
    throw new InvalidInferenceOutputError('Inference embedding dimensions are invalid')
  }
  const logits = new Array<number>(promptCount).fill(0)

  for (let promptIndex = 0; promptIndex < promptCount; promptIndex++) {
    let dotProduct = 0
    for (let dimension = 0; dimension < embedDimension; dimension++) {
      dotProduct +=
        imageEmbeds[dimension]! * textEmbeds[promptIndex * embedDimension + dimension]!
    }
    logits[promptIndex] = dotProduct
  }

  return logits
}

export function extractLogits(
  output: InferenceModelOutput,
  promptCount: number
): number[] {
  const directLogits =
    tensorValues(output.logits_per_image) ?? tensorValues(output.logits)
  if (directLogits) {
    return Array.from(directLogits)
  }

  const imageEmbeds = tensorValues(output.image_embeds)
  const textEmbeds = tensorValues(output.text_embeds)
  if (!imageEmbeds || !textEmbeds) {
    return []
  }

  return calculateEmbeddingLogits(imageEmbeds, textEmbeds, promptCount)
}

export function assertValidLogits(logits: number[], expectedCount: number): void {
  if (logits.length !== expectedCount) {
    throw new InvalidInferenceOutputError('Inference output logits count invalid')
  }
  if (logits.some((score) => !Number.isFinite(score))) {
    throw new InvalidInferenceOutputError('Inference returned non-finite score')
  }
}

// Keep this streamed digest implementation aligned with
// scripts/prepare-garment-tagging-model.mjs.
async function computeSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

// eslint-disable-next-line complexity
export async function verifyModelSnapshot(modelDir: string): Promise<void> {
  const absoluteModelDir = path.resolve(modelDir)
  const manifestCandidates = [
    path.resolve(__dirname, '../../../model-manifests/fashion-clip-7e3ba62.json'),
    path.resolve(__dirname, '../../../../model-manifests/fashion-clip-7e3ba62.json'),
  ]
  const manifestPath = manifestCandidates.find((candidate) => fs.existsSync(candidate))
  if (!manifestPath) {
    throw new Error(`Model manifest not found in: ${manifestCandidates.join(', ')}`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    modelId?: string
    revision?: string
    analysisVersion?: string
    files?: { path?: string; sha256?: string; required?: boolean }[]
  }

  if (
    manifest.modelId !== 'patrickjohncyh/fashion-clip' ||
    manifest.revision !== '7e3ba62ce16b379a1ab479346b66f192e76f51b7' ||
    manifest.analysisVersion !==
      'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error('Model manifest identity or file list is invalid')
  }

  for (const fileSpec of manifest.files) {
    const expectedSha256 = fileSpec.sha256
    if (
      fileSpec.required !== true ||
      !fileSpec.path ||
      !expectedSha256 ||
      !/^[a-f0-9]{64}$/i.test(expectedSha256)
    ) {
      throw new Error('Every required model file must declare a path and SHA-256 hash')
    }
    const fullPath = path.resolve(absoluteModelDir, fileSpec.path)
    if (!fullPath.startsWith(`${absoluteModelDir}${path.sep}`)) {
      throw new Error(
        `Model manifest path escapes the snapshot directory: ${fileSpec.path}`
      )
    }
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Model snapshot missing required file: ${fullPath}`)
    }
    const canonicalModelDir = fs.realpathSync(absoluteModelDir)
    const canonicalFilePath = fs.realpathSync(fullPath)
    if (!canonicalFilePath.startsWith(`${canonicalModelDir}${path.sep}`)) {
      throw new Error(
        `Model manifest path escapes the snapshot directory: ${fileSpec.path}`
      )
    }
    const actualHash = await computeSha256(fullPath)
    if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(
        `Model file checksum mismatch for ${fileSpec.path}: expected ${expectedSha256}, got ${actualHash}`
      )
    }
  }
}

export async function initializeInferenceWorker(modelDir: string): Promise<void> {
  const resolvedModelDir = path.resolve(modelDir)
  await verifyModelSnapshot(resolvedModelDir)

  const transformers = await import('@huggingface/transformers')
  transformers.env.allowRemoteModels = false
  transformers.env.localModelPath = resolvedModelDir

  const { AutoProcessor, AutoTokenizer, AutoModel, RawImage } = transformers

  processor = (await AutoProcessor.from_pretrained(resolvedModelDir, {
    local_files_only: true,
  })) as unknown as (input: unknown) => Promise<Record<string, unknown>>
  tokenizer = (await AutoTokenizer.from_pretrained(resolvedModelDir, {
    local_files_only: true,
  })) as unknown as (
    input: string[],
    options: { padding: boolean; truncation: boolean }
  ) => Promise<Record<string, unknown>>
  model = (await AutoModel.from_pretrained(resolvedModelDir, {
    local_files_only: true,
  })) as unknown as (input: unknown) => Promise<unknown>

  // Warmup with a neutral 64x64 pixel image
  const dummyCanvas = Buffer.alloc(64 * 64 * 3, 128)
  const dummyRawImage = new RawImage(dummyCanvas, 64, 64, 3)
  const categoryTexts = CATEGORY_KEYS.map((k) => CATEGORY_PROMPTS[k])
  const materialTexts = MATERIAL_KEYS.map((k) => MATERIAL_PROMPTS[k])
  const allPrompts = [...categoryTexts, ...materialTexts]

  promptTextInputs = await tokenizer(allPrompts, {
    padding: true,
    truncation: true,
  })
  const imageInputs = await processor(dummyRawImage)
  await model({ ...promptTextInputs, ...imageInputs })

  initialized = true
}

export async function runInferenceOnImage(
  imageBuffer: Buffer
): Promise<{ categoryLogits: number[]; materialLogits: number[] }> {
  if (!initialized || !processor || !model || !promptTextInputs) {
    throw new Error('Inference worker is not initialized')
  }

  const transformers = await import('@huggingface/transformers')
  const { RawImage } = transformers

  const imageBytes = Uint8Array.from(imageBuffer)
  const rawImage = await RawImage.fromBlob(new Blob([imageBytes]))
  const imageInputs = await processor(rawImage)

  const output = (await model({
    ...promptTextInputs,
    ...imageInputs,
  })) as InferenceModelOutput
  const expectedLogitCount = CATEGORY_KEYS.length + MATERIAL_KEYS.length
  const logits = extractLogits(output, expectedLogitCount)
  assertValidLogits(logits, expectedLogitCount)

  const categoryLogits = logits.slice(0, CATEGORY_KEYS.length)
  const materialLogits = logits.slice(
    CATEGORY_KEYS.length,
    CATEGORY_KEYS.length + MATERIAL_KEYS.length
  )

  return { categoryLogits, materialLogits }
}

if (!isMainThread && parentPort) {
  const data = workerData as { modelDir?: string } | undefined
  const targetModelDir = path.resolve(
    data?.modelDir ||
      process.env.GARMENT_TAGGING_MODEL_DIR ||
      path.resolve(__dirname, '../../../.cache/garment-tagging-model')
  )

  initializeInferenceWorker(targetModelDir)
    .then(() => {
      logger.info(
        { event: 'worker_ready', modelDir: targetModelDir },
        'Inference worker ready'
      )
      parentPort?.postMessage({ type: 'ready' } as InferenceResponse)
    })
    .catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Inference worker initialization failed'
      logger.error(
        {
          event: 'worker_initialization_failed',
          errorMessage: message,
          errorName: err instanceof Error ? err.name : 'UnknownError',
          modelDir: targetModelDir,
        },
        'Failed to initialize inference worker'
      )
      parentPort?.postMessage({
        type: 'initialization_error',
        error: message,
      } as InferenceResponse)
      process.exit(1)
    })

  let requestQueue = Promise.resolve()
  parentPort.on('message', (msg: InferenceRequest) => {
    if (!msg || !msg.id || !msg.imageBuffer) return
    requestQueue = requestQueue.then(async () => {
      try {
        const { categoryLogits, materialLogits } = await runInferenceOnImage(
          msg.imageBuffer
        )
        parentPort?.postMessage({
          type: 'result',
          id: msg.id,
          categoryLogits,
          materialLogits,
        } as InferenceResponse)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Inference execution failed'
        const code =
          err instanceof InvalidInferenceOutputError
            ? 'TAGGING_OUTPUT_INVALID'
            : 'TAGGING_INFERENCE_FAILED'
        logger.warn(
          {
            event: 'inference_failed',
            code,
            errorMessage: message,
            requestId: msg.id,
          },
          'Inference request failed'
        )
        parentPort?.postMessage({
          type: 'error',
          id: msg.id,
          error: message,
          code,
        } as InferenceResponse)
      }
    })
    void requestQueue
  })
}
