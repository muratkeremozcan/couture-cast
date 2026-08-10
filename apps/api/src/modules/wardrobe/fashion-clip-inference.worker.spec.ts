/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- the ONNX runtime session is stubbed with an untyped test double, which is the established pattern for these suites. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InferenceResponse } from './fashion-clip-inference.worker'

/**
 * `@huggingface/transformers` loads native ONNX bindings and a multi-hundred-
 * megabyte snapshot, so it is stubbed here. Everything else in the worker —
 * snapshot verification, prompt assembly, logit slicing, the request queue, and
 * the failure-code mapping the engine relies on — runs for real.
 */
const transformers = vi.hoisted(() => {
  class RawImage {
    constructor(
      readonly data: unknown,
      readonly width: number,
      readonly height: number,
      readonly channels: number
    ) {}

    static fromBlob = vi.fn()
  }

  return {
    env: { allowRemoteModels: true, localModelPath: '' },
    RawImage,
    processor: vi.fn(),
    tokenizer: vi.fn(),
    model: vi.fn(),
    AutoProcessor: { from_pretrained: vi.fn() },
    AutoTokenizer: { from_pretrained: vi.fn() },
    AutoModel: { from_pretrained: vi.fn() },
  }
})

vi.mock('@huggingface/transformers', () => ({
  env: transformers.env,
  RawImage: transformers.RawImage,
  AutoProcessor: transformers.AutoProcessor,
  AutoTokenizer: transformers.AutoTokenizer,
  AutoModel: transformers.AutoModel,
}))

const MANIFEST_IDENTITY = {
  modelId: 'patrickjohncyh/fashion-clip',
  revision: '7e3ba62ce16b379a1ab479346b66f192e76f51b7',
  analysisVersion: 'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1',
}

/** Six category prompts plus nine material prompts. */
const EXPECTED_LOGIT_COUNT = 15

const CATEGORY_PROMPT_SAMPLE =
  'a photo of a shirt, blouse, sweater, or other upper-body garment'

const temporaryDirectories: string[] = []

function createModelDirectory(): { modelDir: string; sha256: string } {
  const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fashion-clip-worker-'))
  temporaryDirectories.push(modelDir)
  const contents = '{"model_type":"clip"}'
  fs.writeFileSync(path.join(modelDir, 'config.json'), contents)
  return {
    modelDir,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
  }
}

/**
 * The checked-in manifest pins digests for a snapshot no unit test can
 * materialize, so the manifest read is redirected to a synthetic one describing a
 * file the test actually wrote.
 */
function stubManifest(manifest: Record<string, unknown>): void {
  vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(manifest) as never)
}

function validManifest(sha256: string): Record<string, unknown> {
  return {
    ...MANIFEST_IDENTITY,
    files: [{ path: 'config.json', sha256, required: true }],
  }
}

async function loadWorkerModule(
  workerThreads: Record<string, unknown> = {
    isMainThread: true,
    parentPort: null,
    workerData: undefined,
  }
) {
  vi.resetModules()
  vi.doMock('node:worker_threads', () => workerThreads)
  return import('./fashion-clip-inference.worker.js')
}

beforeEach(() => {
  transformers.env.allowRemoteModels = true
  transformers.env.localModelPath = ''
  transformers.processor.mockReset().mockResolvedValue({ pixel_values: 'pixels' })
  transformers.tokenizer.mockReset().mockResolvedValue({ input_ids: 'ids' })
  transformers.model.mockReset().mockResolvedValue({})
  transformers.AutoProcessor.from_pretrained
    .mockReset()
    .mockResolvedValue(transformers.processor)
  transformers.AutoTokenizer.from_pretrained
    .mockReset()
    .mockResolvedValue(transformers.tokenizer)
  transformers.AutoModel.from_pretrained.mockReset().mockResolvedValue(transformers.model)
  transformers.RawImage.fromBlob
    .mockReset()
    .mockImplementation((blob: unknown) =>
      Promise.resolve(new transformers.RawImage(blob, 8, 8, 3))
    )
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  vi.doUnmock('node:worker_threads')
  vi.restoreAllMocks()
})

describe('verifyModelSnapshot', () => {
  it('rejects a snapshot when no manifest is bundled with the build', async () => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir } = createModelDirectory()
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    await expect(verifyModelSnapshot(modelDir)).rejects.toThrow(
      /Model manifest not found in:/
    )
  })

  /**
   * The manifest is the only statement of which model this code was reviewed
   * against. A manifest for a different model or revision must fail closed rather
   * than tagging garments with unreviewed weights.
   */
  const invalidIdentities: [string, Record<string, unknown>][] = [
    ['a foreign model id', { modelId: 'someone-else/clip' }],
    ['a different revision', { revision: 'deadbeef' }],
    ['a mismatched analysis version', { analysisVersion: 'prompts-v0' }],
    ['an empty file list', { files: [] }],
    ['a non-array file list', { files: 'config.json' }],
  ]

  it.each(invalidIdentities)('rejects %s', async (_label, override) => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest({ ...validManifest(sha256), ...override })

    await expect(verifyModelSnapshot(modelDir)).rejects.toThrow(
      'Model manifest identity or file list is invalid'
    )
  })

  const invalidFileSpecs: [string, Record<string, unknown>][] = [
    ['a file that is not marked required', { required: false }],
    ['a file with no path', { path: undefined }],
    ['a file with no digest', { sha256: undefined }],
    ['a file whose digest is not SHA-256', { sha256: 'not-a-digest' }],
  ]

  it.each(invalidFileSpecs)('rejects %s', async (_label, override) => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest({
      ...MANIFEST_IDENTITY,
      files: [{ path: 'config.json', sha256, required: true, ...override }],
    })

    await expect(verifyModelSnapshot(modelDir)).rejects.toThrow(
      'Every required model file must declare a path and SHA-256 hash'
    )
  })

  /** The manifest is untrusted input: it must not be able to read outside the snapshot. */
  it('rejects a manifest path that escapes the snapshot directory', async () => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest({
      ...MANIFEST_IDENTITY,
      files: [{ path: '../escaped.json', sha256, required: true }],
    })

    await expect(verifyModelSnapshot(modelDir)).rejects.toThrow(
      'Model manifest path escapes the snapshot directory: ../escaped.json'
    )
  })

  /** The symlink target, not the declared path, is what actually gets read. */
  it('rejects a file that symlinks outside the snapshot directory', async () => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir } = createModelDirectory()
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fashion-clip-outside-'))
    temporaryDirectories.push(outsideDir)
    const outsideFile = path.join(outsideDir, 'secret.json')
    const contents = '{"secret":true}'
    fs.writeFileSync(outsideFile, contents)
    fs.rmSync(path.join(modelDir, 'config.json'))
    fs.symlinkSync(outsideFile, path.join(modelDir, 'config.json'))
    stubManifest({
      ...MANIFEST_IDENTITY,
      files: [
        {
          path: 'config.json',
          sha256: crypto.createHash('sha256').update(contents).digest('hex'),
          required: true,
        },
      ],
    })

    await expect(verifyModelSnapshot(modelDir)).rejects.toThrow(
      'Model manifest path escapes the snapshot directory: config.json'
    )
  })

  it('accepts a snapshot whose file digests match the manifest', async () => {
    const { verifyModelSnapshot } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest(validManifest(sha256))

    await expect(verifyModelSnapshot(modelDir)).resolves.toBeUndefined()
  })
})

describe('initializeInferenceWorker', () => {
  /**
   * Remote model downloads must stay disabled: the snapshot has been digest
   * verified, and a silent fetch would defeat that entirely.
   */
  it('pins transformers to the verified local snapshot and warms the model', async () => {
    const { initializeInferenceWorker } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest(validManifest(sha256))

    await initializeInferenceWorker(modelDir)

    expect(transformers.env.allowRemoteModels).toBe(false)
    expect(transformers.env.localModelPath).toBe(path.resolve(modelDir))
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledWith(
      path.resolve(modelDir),
      { local_files_only: true }
    )
    // All 15 prompts are tokenized once and reused for every later request.
    const prompts = transformers.tokenizer.mock.calls[0]?.[0] as string[] | undefined
    expect(prompts).toHaveLength(EXPECTED_LOGIT_COUNT)
    expect(prompts).toContain(CATEGORY_PROMPT_SAMPLE)
    expect(transformers.tokenizer).toHaveBeenCalledWith(expect.any(Array), {
      padding: true,
      truncation: true,
    })
    expect(transformers.model).toHaveBeenCalledTimes(1)
  })

  it('propagates a snapshot verification failure instead of loading the model', async () => {
    const { initializeInferenceWorker } = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest({ ...validManifest(sha256), modelId: 'someone-else/clip' })

    await expect(initializeInferenceWorker(modelDir)).rejects.toThrow(
      'Model manifest identity or file list is invalid'
    )
    expect(transformers.AutoModel.from_pretrained).not.toHaveBeenCalled()
  })
})

describe('runInferenceOnImage', () => {
  async function initializedWorker() {
    const module = await loadWorkerModule()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest(validManifest(sha256))
    await module.initializeInferenceWorker(modelDir)
    return module
  }

  it('refuses to run before the model is loaded', async () => {
    const { runInferenceOnImage } = await loadWorkerModule()

    await expect(runInferenceOnImage(Buffer.from('image'))).rejects.toThrow(
      'Inference worker is not initialized'
    )
  })

  it('splits the model logits into the category and material groups', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    transformers.model.mockResolvedValue({
      logits_per_image: Float32Array.from(
        Array.from({ length: EXPECTED_LOGIT_COUNT }, (_value, index) => index)
      ),
    })

    const result = await runInferenceOnImage(Buffer.from('image'))

    expect(result.categoryLogits).toEqual([0, 1, 2, 3, 4, 5])
    expect(result.materialLogits).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(transformers.RawImage.fromBlob).toHaveBeenCalledTimes(1)
  })

  /** Some exported graphs name the head `logits` and wrap it in a tensor object. */
  it('reads logits from a wrapped tensor under the alternate output name', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    transformers.model.mockResolvedValue({
      logits: {
        data: Float32Array.from(new Array<number>(EXPECTED_LOGIT_COUNT).fill(1)),
      },
    })

    const result = await runInferenceOnImage(Buffer.from('image'))

    expect(result.categoryLogits).toHaveLength(6)
    expect(result.materialLogits).toHaveLength(9)
  })

  it('derives logits from embeddings when no logit head is exposed', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    const embedDimension = 2
    transformers.model.mockResolvedValue({
      image_embeds: Float32Array.from([1, 1]),
      text_embeds: Float32Array.from(
        Array.from({ length: EXPECTED_LOGIT_COUNT * embedDimension }, () => 0.5)
      ),
    })

    const result = await runInferenceOnImage(Buffer.from('image'))

    expect(result.categoryLogits).toEqual(new Array<number>(6).fill(1))
    expect(result.materialLogits).toEqual(new Array<number>(9).fill(1))
  })

  it('rejects an output that exposes nothing usable', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    transformers.model.mockResolvedValue({})

    await expect(runInferenceOnImage(Buffer.from('image'))).rejects.toThrow(
      'Inference output logits count invalid'
    )
  })

  it('rejects embeddings whose dimensions do not match the prompt count', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    transformers.model.mockResolvedValue({
      image_embeds: Float32Array.from([1, 1]),
      text_embeds: Float32Array.from([1, 1, 1]),
    })

    await expect(runInferenceOnImage(Buffer.from('image'))).rejects.toThrow(
      'Inference embedding dimensions are invalid'
    )
  })

  /** A NaN score would otherwise sort to the top and become the suggested label. */
  it('rejects a non-finite score', async () => {
    const { runInferenceOnImage } = await initializedWorker()
    const logits = Float32Array.from(new Array<number>(EXPECTED_LOGIT_COUNT).fill(1))
    logits[3] = Number.NaN
    transformers.model.mockResolvedValue({ logits_per_image: logits })

    await expect(runInferenceOnImage(Buffer.from('image'))).rejects.toThrow(
      'Inference returned non-finite score'
    )
  })
})

describe('worker thread entrypoint', () => {
  function createParentPort() {
    const messages: InferenceResponse[] = []
    let handler: ((message: unknown) => void) | undefined
    return {
      messages,
      dispatch: (message: unknown) => handler?.(message),
      port: {
        postMessage: vi.fn((message: InferenceResponse) => messages.push(message)),
        on: vi.fn((_event: string, listener: (message: unknown) => void) => {
          handler = listener
        }),
      },
    }
  }

  async function bootWorkerThread(parentPort: ReturnType<typeof createParentPort>) {
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest(validManifest(sha256))
    await loadWorkerModule({
      isMainThread: false,
      parentPort: parentPort.port,
      workerData: { modelDir },
    })
    await vi.waitFor(() => expect(parentPort.port.postMessage).toHaveBeenCalled())
  }

  it('announces readiness once the model has loaded', async () => {
    const parentPort = createParentPort()

    await bootWorkerThread(parentPort)

    expect(parentPort.messages).toEqual([{ type: 'ready' }])
  })

  /** The supervising engine can only react to a load failure if it is told about it. */
  it('reports an initialization failure and exits non-zero', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const parentPort = createParentPort()
    const { modelDir, sha256 } = createModelDirectory()
    stubManifest({ ...validManifest(sha256), revision: 'wrong' })

    await loadWorkerModule({
      isMainThread: false,
      parentPort: parentPort.port,
      workerData: { modelDir },
    })
    await vi.waitFor(() => expect(parentPort.port.postMessage).toHaveBeenCalled())

    expect(parentPort.messages).toEqual([
      {
        type: 'initialization_error',
        error: 'Model manifest identity or file list is invalid',
      },
    ])
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('answers an inference request with the sliced logit groups', async () => {
    const parentPort = createParentPort()
    await bootWorkerThread(parentPort)
    transformers.model.mockResolvedValue({
      logits_per_image: Float32Array.from(
        Array.from({ length: EXPECTED_LOGIT_COUNT }, (_value, index) => index)
      ),
    })

    parentPort.dispatch({ id: 'req-1', imageBuffer: Buffer.from('image') })
    await vi.waitFor(() => expect(parentPort.messages).toHaveLength(2))

    expect(parentPort.messages[1]).toEqual({
      type: 'result',
      id: 'req-1',
      categoryLogits: [0, 1, 2, 3, 4, 5],
      materialLogits: [6, 7, 8, 9, 10, 11, 12, 13, 14],
    })
  })

  /**
   * The engine falls back to manual confirmation only for TAGGING_OUTPUT_INVALID,
   * so a malformed model output has to keep that code across the thread boundary.
   */
  it('reports a malformed model output as TAGGING_OUTPUT_INVALID', async () => {
    const parentPort = createParentPort()
    await bootWorkerThread(parentPort)
    transformers.model.mockResolvedValue({ logits_per_image: Float32Array.from([1, 2]) })

    parentPort.dispatch({ id: 'req-2', imageBuffer: Buffer.from('image') })
    await vi.waitFor(() => expect(parentPort.messages).toHaveLength(2))

    expect(parentPort.messages[1]).toEqual({
      type: 'error',
      id: 'req-2',
      error: 'Inference output logits count invalid',
      code: 'TAGGING_OUTPUT_INVALID',
    })
  })

  /** Any other failure is retriable, so it must not claim the output was invalid. */
  it('reports an inference crash as TAGGING_INFERENCE_FAILED', async () => {
    const parentPort = createParentPort()
    await bootWorkerThread(parentPort)
    transformers.model.mockRejectedValue(new Error('onnx session aborted'))

    parentPort.dispatch({ id: 'req-3', imageBuffer: Buffer.from('image') })
    await vi.waitFor(() => expect(parentPort.messages).toHaveLength(2))

    expect(parentPort.messages[1]).toEqual({
      type: 'error',
      id: 'req-3',
      error: 'onnx session aborted',
      code: 'TAGGING_INFERENCE_FAILED',
    })
  })

  it('ignores a message that carries no request', async () => {
    const parentPort = createParentPort()
    await bootWorkerThread(parentPort)

    parentPort.dispatch(null)
    parentPort.dispatch({ id: 'req-4' })
    parentPort.dispatch({ imageBuffer: Buffer.from('image') })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(parentPort.messages).toHaveLength(1)
  })

  /** Requests are serialized so two images never share one ONNX session. */
  it('serializes concurrent requests and answers each one in order', async () => {
    const parentPort = createParentPort()
    await bootWorkerThread(parentPort)
    transformers.model.mockResolvedValue({
      logits_per_image: Float32Array.from(
        new Array<number>(EXPECTED_LOGIT_COUNT).fill(1)
      ),
    })

    parentPort.dispatch({ id: 'req-a', imageBuffer: Buffer.from('a') })
    parentPort.dispatch({ id: 'req-b', imageBuffer: Buffer.from('b') })
    await vi.waitFor(() => expect(parentPort.messages).toHaveLength(3))

    const ids = parentPort.messages.map((message) =>
      'id' in message ? message.id : null
    )
    expect(ids).toEqual([null, 'req-a', 'req-b'])
  })
})
