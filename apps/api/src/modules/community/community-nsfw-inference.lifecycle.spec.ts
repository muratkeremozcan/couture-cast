// Story 6.2 AC 9: the ADR-013 NSFW image screener's lifecycle, proven without
// TensorFlow.js and without a single image byte.
//
// No unsafe imagery may be committed to this repository, so every classification
// here is driven by handing the fake worker a probability vector directly. That
// substitution is deliberate: the model's accuracy is not what this suite is
// about. What it proves is everything the controller owns around the model —
// manifest verification, the startup handshake, the failure cooldown, the
// three-way disposition, timeout termination, crash recovery, serialisation and
// the truthfulness of the persisted engine identity.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// vi.mock is hoisted above these imports, so the faked node:worker_threads
// module is already in place when the controller module is evaluated. A
// top-level `await import` is not an option: this workspace compiles specs as
// CommonJS, where top-level await is a TS1309 error.
import * as NsfwWorkerModule from './community-nsfw-inference.worker.js'
import * as TensorflowNsfwImageScreenerModule from './tensorflow-nsfw-image-screener.js'
import type {
  NsfwInferenceRequest,
  NsfwInferenceResponse,
  NsfwManifestFile,
  NsfwRuntimeIdentity,
} from './community-nsfw-inference.worker.js'

/**
 * The real controller spawns a worker thread that loads TensorFlow.js, a WASM
 * backend and a MobileNet graph. None of those packages are installed here, and
 * the worker module's own entrypoint guard reads `isMainThread`/`parentPort`
 * from this same mock, which is why they are exported alongside `Worker`:
 * without them the mock proxy throws on the worker module's named imports.
 */
const workerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeWorker {
    static readonly instances: FakeWorker[] = []

    readonly listeners = new Map<string, Listener[]>()
    readonly postMessage = vi.fn<(message: NsfwInferenceRequest) => void>()
    terminate = vi.fn<() => Promise<number>>(() => Promise.resolve(0))

    constructor(
      readonly scriptPath: string,
      readonly options: {
        workerData?: { manifestPath?: string }
        execArgv?: string[]
      }
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
  }

  return { FakeWorker }
})

vi.mock('node:worker_threads', () => ({
  Worker: workerHarness.FakeWorker,
  isMainThread: true,
  parentPort: null,
  workerData: undefined,
}))

const {
  COMMUNITY_NSFW_MANIFEST_ENV,
  NSFW_FAILURE_COOLDOWN_MS,
  NSFW_REASON_INFERENCE_TIMEOUT,
  NsfwScreeningError,
  TensorflowNsfwImageScreener,
  composeEngineVersion,
} = TensorflowNsfwImageScreenerModule

const {
  NSFW_CLASS_NAMES,
  NsfwImageDecodeError,
  NsfwInferenceOutputError,
  deriveModelDigest,
  inferenceErrorCode,
  mapClassProbabilities,
  readModelManifest,
  resolvePackageRoot,
} = NsfwWorkerModule

type FakeWorker = InstanceType<typeof workerHarness.FakeWorker>

const sha256Of = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex')

const POLICY_FILENAME = 'community-screening-policy.json'
const POLICY_VERSION = 'v1'

/** Mirrors the checked-in policy's thresholds so the fixture stays believable. */
const IMAGE_POLICY = {
  classNames: [...NSFW_CLASS_NAMES],
  neutralPassMinimum: 0.85,
  unsafeAggregateMaximum: 0.15,
  unsafeBlockMinimum: 0.35,
  unsafeClasses: ['Hentai', 'Porn'],
  probabilitySumTolerance: 0.001,
  boundaryDisposition: 'review',
}

const IMAGE_REASON_CODES = {
  unsafe_class: 'block',
  low_confidence: 'review',
  output_invalid: 'review',
  class_mismatch: 'review',
  probability_sum_invalid: 'review',
  inference_timeout: 'review',
}

const RUNTIME_IDENTITY: NsfwRuntimeIdentity = {
  modelFamily: 'mobilenet_v2_mid',
  packageName: 'nsfwjs',
  packageVersion: '4.3.0',
  modelDigest: sha256Of('nsfw-model-artifact-set'),
  policyVersion: POLICY_VERSION,
  policyDigest: sha256Of('approved-screening-policy'),
  backend: 'wasm',
  classNames: [...NSFW_CLASS_NAMES],
  inputSize: 224,
}

/**
 * Probabilities in the manifest's class order: Drawing, Hentai, Neutral, Porn,
 * Sexy. They stand in for the model's output so no NSFW image has to exist.
 */
const NEUTRAL_VECTOR = [0.03, 0.01, 0.93, 0.01, 0.02]
const UNSAFE_VECTOR = [0.02, 0.01, 0.05, 0.9, 0.02]
const UNCERTAIN_VECTOR = [0.3, 0.05, 0.5, 0.05, 0.1]

/** The fake worker never decodes it, which is the whole point. */
const IMAGE = Buffer.from('any-bytes')

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function baseManifest(policySha256: string): Record<string, unknown> {
  return {
    modelFamily: RUNTIME_IDENTITY.modelFamily,
    packageName: RUNTIME_IDENTITY.packageName,
    packageVersion: RUNTIME_IDENTITY.packageVersion,
    modelSubpath: 'nsfwjs/models/mobilenet_v2_mid',
    backend: 'wasm',
    inputWidth: 224,
    inputHeight: 224,
    inputChannels: 3,
    inputScale: 255,
    outputShape: [1, 5],
    classNames: [...NSFW_CLASS_NAMES],
    modelFiles: [
      {
        package: 'nsfwjs',
        path: 'dist/models/mobilenet_v2_mid/model.min.js',
        sha256: sha256Of('model-graph'),
      },
    ],
    wasmFiles: [
      {
        package: '@tensorflow/tfjs-backend-wasm',
        binaryName: 'tfjs-backend-wasm.wasm',
        path: 'dist/tfjs-backend-wasm.wasm',
        sha256: sha256Of('wasm-binary'),
      },
    ],
    policy: { path: POLICY_FILENAME, version: POLICY_VERSION, sha256: policySha256 },
  }
}

/**
 * Writes a manifest and the policy it approves into a real directory. The
 * manifest carries the policy file's true SHA-256 so the controller's checksum
 * gate passes for the same reason it passes in production.
 */
function createManifestFixture(overrides: Record<string, unknown> = {}): string {
  const directory = temporaryDirectory('community-nsfw-')
  const policy = JSON.stringify(
    {
      version: POLICY_VERSION,
      image: IMAGE_POLICY,
      reasonCodes: { image: IMAGE_REASON_CODES },
    },
    null,
    2
  )
  fs.writeFileSync(path.join(directory, POLICY_FILENAME), policy)

  const manifestPath = path.join(directory, 'community-nsfw-mobilenet-v2-mid.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ ...baseManifest(sha256Of(policy)), ...overrides }, null, 2)
  )
  return manifestPath
}

function workers(): FakeWorker[] {
  return workerHarness.FakeWorker.instances
}

function latestWorker(): FakeWorker {
  const worker = workers().at(-1)
  if (!worker) throw new Error('no worker was spawned')
  return worker
}

function send(worker: FakeWorker, message: NsfwInferenceResponse): void {
  worker.emit('message', message)
}

function lastRequestId(worker: FakeWorker): string {
  const call = worker.postMessage.mock.calls.at(-1)
  if (!call) throw new Error('no inference request was posted')
  return call[0].id
}

function readyMessage(
  identity: NsfwRuntimeIdentity = RUNTIME_IDENTITY
): NsfwInferenceResponse {
  return { type: 'ready', identity, startupMs: 1_200, warmupMs: 240 }
}

function resultMessage(id: string, probabilities: number[]): NsfwInferenceResponse {
  return {
    type: 'result',
    id,
    classNames: [...NSFW_CLASS_NAMES],
    probabilities,
    inferenceMs: 42,
  }
}

async function readyScreener(
  options: { manifestPath?: string; inferenceTimeoutMs?: number } = {}
) {
  const screener = new TensorflowNsfwImageScreener({
    manifestPath: createManifestFixture(),
    ...options,
  })
  const ready = screener.ensureReady()
  await vi.waitFor(() => expect(workers()).toHaveLength(1))
  send(latestWorker(), readyMessage())
  await ready
  return screener
}

beforeEach(() => {
  workers().length = 0
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('readModelManifest', () => {
  it('returns the manifest when every gate passes', () => {
    const manifestPath = createManifestFixture()

    const manifest = readModelManifest(manifestPath)

    expect(manifest.classNames).toEqual([...NSFW_CLASS_NAMES])
    expect(manifest.backend).toBe('wasm')
    expect(manifest.outputShape).toEqual([1, 5])
    expect(manifest.policy.version).toBe(POLICY_VERSION)
  })

  it('rejects a manifest path that does not exist', () => {
    const manifestPath = path.join(temporaryDirectory('community-nsfw-'), 'absent.json')

    expect(() => readModelManifest(manifestPath)).toThrow(
      /Community NSFW model manifest not found/
    )
  })

  /**
   * The class order is what turns a probability vector into a disposition, so a
   * manifest that renames or reorders a class has to fail closed at startup
   * rather than mislabel every submission afterwards.
   */
  const invalidManifests: [string, Record<string, unknown>, string | RegExp][] = [
    [
      'class names in the wrong order',
      { classNames: ['Hentai', 'Drawing', 'Neutral', 'Porn', 'Sexy'] },
      /class names must be exactly/,
    ],
    [
      'a class-name list of the wrong length',
      { classNames: ['Drawing', 'Hentai', 'Neutral', 'Porn'] },
      /class names must be exactly/,
    ],
    ['no model family', { modelFamily: undefined }, 'Model manifest identity is invalid'],
    ['no package name', { packageName: undefined }, 'Model manifest identity is invalid'],
    [
      'no package version',
      { packageVersion: undefined },
      'Model manifest identity is invalid',
    ],
    [
      'no model subpath',
      { modelSubpath: undefined },
      'Model manifest identity is invalid',
    ],
    [
      'a backend other than wasm',
      { backend: 'cpu' },
      'Model manifest identity is invalid',
    ],
    [
      'input dimensions the graph does not declare',
      { inputWidth: 299 },
      /input dimensions must be 224x224x3/,
    ],
    [
      'a single-channel input',
      { inputChannels: 1 },
      /input dimensions must be 224x224x3/,
    ],
    [
      'no input scale',
      { inputScale: undefined },
      'Model manifest must declare a positive input scale',
    ],
    [
      'an output shape that is not one row of five classes',
      { outputShape: [1, 4] },
      /output shape must be \[1, 5\]/,
    ],
    [
      'an empty model file list',
      { modelFiles: [] },
      'Model manifest must declare at least one model file',
    ],
    [
      'an empty WASM file list',
      { wasmFiles: [] },
      'Model manifest must pin every TensorFlow.js WASM binary',
    ],
    [
      'a WASM entry that does not name its binary',
      {
        wasmFiles: [
          {
            package: '@tensorflow/tfjs-backend-wasm',
            path: 'dist/tfjs-backend-wasm.wasm',
            sha256: sha256Of('wasm-binary'),
          },
        ],
      },
      'Every WASM manifest entry must name the binary it supplies',
    ],
    [
      'no policy block',
      { policy: undefined },
      'Model manifest must name the approved policy file and version',
    ],
    [
      'a policy hash that is not a SHA-256 digest',
      { policy: { path: POLICY_FILENAME, version: POLICY_VERSION, sha256: 'nope' } },
      /Manifest policy hash must be a 64-character SHA-256 hex digest/,
    ],
  ]

  it.each(invalidManifests)('rejects %s', (_label, overrides, expected) => {
    const manifestPath = createManifestFixture(overrides)

    expect(() => readModelManifest(manifestPath)).toThrow(expected)
  })
})

describe('worker helpers', () => {
  const modelFiles: NsfwManifestFile[] = [
    { package: 'nsfwjs', path: 'dist/a.bin', sha256: sha256Of('a') },
    { package: 'nsfwjs', path: 'dist/b.bin', sha256: sha256Of('b') },
  ]

  it('derives a digest that is stable, order sensitive, and hash sensitive', () => {
    const digest = deriveModelDigest(modelFiles)

    expect(deriveModelDigest(modelFiles)).toBe(digest)
    expect(deriveModelDigest([...modelFiles].reverse())).not.toBe(digest)
    expect(
      deriveModelDigest([modelFiles[0]!, { ...modelFiles[1]!, sha256: sha256Of('c') }])
    ).not.toBe(digest)
  })

  it('maps probabilities onto class names positionally', () => {
    expect(mapClassProbabilities(NEUTRAL_VECTOR, [...NSFW_CLASS_NAMES])).toEqual({
      Drawing: 0.03,
      Hentai: 0.01,
      Neutral: 0.93,
      Porn: 0.01,
      Sexy: 0.02,
    })
  })

  /** Four probabilities read as five classes would silently shift every label. */
  it('refuses to map a vector whose length does not match the class list', () => {
    expect(() => mapClassProbabilities([0.5, 0.5], [...NSFW_CLASS_NAMES])).toThrow(
      NsfwInferenceOutputError
    )
    expect(() => mapClassProbabilities([0.5, 0.5], [...NSFW_CLASS_NAMES])).toThrow(
      'Model returned 2 probabilities for 5 classes'
    )
  })

  it.each([
    [new NsfwInferenceOutputError('bad head'), 'NSFW_OUTPUT_INVALID'],
    [new NsfwImageDecodeError('undecodable'), 'NSFW_IMAGE_DECODE_FAILED'],
    [new Error('wasm aborted'), 'NSFW_INFERENCE_FAILED'],
    ['not even an error', 'NSFW_INFERENCE_FAILED'],
  ])('classifies %s as a stable inference error code', (error, expected) => {
    expect(inferenceErrorCode(error)).toBe(expected)
  })
})

describe('resolvePackageRoot', () => {
  const fakeRequire = (resolver: (specifier: string) => string): NodeRequire =>
    ({ resolve: resolver }) as unknown as NodeRequire

  it('prefers the package.json the package publishes', () => {
    const requireFrom = fakeRequire((specifier) => {
      if (specifier === 'nsfwjs/package.json') {
        return path.join(path.sep, 'packages', 'nsfwjs', 'package.json')
      }
      throw new Error(`unexpected specifier: ${specifier}`)
    })

    expect(resolvePackageRoot('nsfwjs', 'nsfwjs/models/x', requireFrom)).toBe(
      path.join(path.sep, 'packages', 'nsfwjs')
    )
  })

  /** `nsfwjs` does not publish `./package.json`, which is why the walk exists. */
  it('walks up from a published export when package.json is not exported', () => {
    const packageRoot = path.join(temporaryDirectory('nsfw-pkg-'), 'nsfwjs')
    fs.mkdirSync(path.join(packageRoot, 'dist', 'models'), { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'nsfwjs' })
    )
    const exported = path.join(packageRoot, 'dist', 'models', 'index.js')
    fs.writeFileSync(exported, '')
    const requireFrom = fakeRequire((specifier) => {
      if (specifier === 'nsfwjs/package.json') throw new Error('not exported')
      return exported
    })

    expect(resolvePackageRoot('nsfwjs', 'nsfwjs/models/x', requireFrom)).toBe(packageRoot)
  })

  it('throws when no ancestor package.json claims the package name', () => {
    const packageRoot = path.join(temporaryDirectory('nsfw-pkg-'), 'impostor')
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'someone-else' })
    )
    const exported = path.join(packageRoot, 'dist', 'index.js')
    fs.writeFileSync(exported, '')
    const requireFrom = fakeRequire((specifier) => {
      if (specifier === 'nsfwjs/package.json') throw new Error('not exported')
      return exported
    })

    expect(() => resolvePackageRoot('nsfwjs', 'nsfwjs/models/x', requireFrom)).toThrow(
      'Unable to resolve the install root of nsfwjs'
    )
  })
})

describe('TensorflowNsfwImageScreener startup', () => {
  it('spawns no worker until something asks it to be ready', () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    expect(workers()).toHaveLength(0)
    expect(screener.runtimeIdentity).toBeNull()
    expect(screener.engineVersion).toMatch(/:unresolved$/)
  })

  it('spawns exactly one worker and resolves on the ready handshake', async () => {
    const manifestPath = createManifestFixture()
    const screener = new TensorflowNsfwImageScreener({ manifestPath })

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    expect(latestWorker().options.workerData?.manifestPath).toBe(manifestPath)
    send(latestWorker(), readyMessage())

    await expect(ready).resolves.toBeUndefined()
    expect(workers()).toHaveLength(1)
    expect(screener.runtimeIdentity).toEqual(RUNTIME_IDENTITY)
    expect(screener.engineVersion).toBe(composeEngineVersion(RUNTIME_IDENTITY))
  })

  it('honours COMMUNITY_NSFW_MODEL_MANIFEST when no path is configured', async () => {
    const manifestPath = createManifestFixture()
    vi.stubEnv(COMMUNITY_NSFW_MANIFEST_ENV, manifestPath)
    const screener = new TensorflowNsfwImageScreener()

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    expect(latestWorker().options.workerData?.manifestPath).toBe(manifestPath)
    send(latestWorker(), readyMessage())

    await expect(ready).resolves.toBeUndefined()
  })
})

describe('TensorflowNsfwImageScreener startup failure', () => {
  it('surfaces the worker initialization error to the caller', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    send(latestWorker(), {
      type: 'initialization_error',
      error: 'tfjs-backend-wasm binary checksum mismatch',
    })

    await expect(ready).rejects.toThrow('tfjs-backend-wasm binary checksum mismatch')
  })

  it('rejects when the model process exits before reporting ready', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    latestWorker().emit('exit', 3)

    await expect(ready).rejects.toThrow(
      'Community NSFW model process exited before ready with code 3'
    )
  })

  it('rejects when the worker thread errors before reporting ready', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    latestWorker().emit('error', new Error('worker thread crashed on load'))

    await expect(ready).rejects.toThrow('worker thread crashed on load')
  })

  it('rejects when the manifest names a policy file that is not there', async () => {
    const manifestPath = createManifestFixture()
    fs.rmSync(path.join(path.dirname(manifestPath), POLICY_FILENAME))
    const screener = new TensorflowNsfwImageScreener({ manifestPath })

    await expect(screener.ensureReady()).rejects.toThrow(
      /Approved screening policy not found/
    )
    expect(workers()).toHaveLength(0)
  })

  /** An edited policy would make the hash in the engine identity a lie. */
  it('rejects when the approved policy no longer matches its manifest hash', async () => {
    const manifestPath = createManifestFixture()
    fs.writeFileSync(
      path.join(path.dirname(manifestPath), POLICY_FILENAME),
      JSON.stringify({
        version: POLICY_VERSION,
        image: { ...IMAGE_POLICY, neutralPassMinimum: 0.1 },
        reasonCodes: { image: IMAGE_REASON_CODES },
      })
    )
    const screener = new TensorflowNsfwImageScreener({ manifestPath })

    await expect(screener.ensureReady()).rejects.toThrow(
      /Screening policy checksum mismatch/
    )
    expect(workers()).toHaveLength(0)
  })
})

describe('TensorflowNsfwImageScreener failure cooldown', () => {
  it('replays the recorded failure without respawning inside the cooldown', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    send(latestWorker(), { type: 'initialization_error', error: 'wasm backend absent' })
    latestWorker().emit('exit', 1)
    await expect(ready).rejects.toThrow('wasm backend absent')

    await expect(screener.ensureReady()).rejects.toThrow('wasm backend absent')
    expect(workers()).toHaveLength(1)
  })

  it('spawns a fresh worker once the cooldown has expired', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })
    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    send(latestWorker(), { type: 'initialization_error', error: 'wasm backend absent' })
    latestWorker().emit('exit', 1)
    await expect(ready).rejects.toThrow('wasm backend absent')

    // Fake timers are installed only now: the policy load above is real
    // filesystem I/O, which a faked clock has no business standing in front of.
    vi.useFakeTimers()
    vi.advanceTimersByTime(NSFW_FAILURE_COOLDOWN_MS + 1)
    const retried = screener.ensureReady()
    await vi.advanceTimersByTimeAsync(0)
    expect(workers()).toHaveLength(2)
    send(latestWorker(), readyMessage())

    await expect(retried).resolves.toBeUndefined()
  })
})

describe('TensorflowNsfwImageScreener screening', () => {
  const dispositions: [string, number[], string, boolean, string[]][] = [
    ['publishes a confidently neutral image', NEUTRAL_VECTOR, 'pass', true, []],
    [
      'blocks a confidently unsafe image',
      UNSAFE_VECTOR,
      'block',
      false,
      ['unsafe_class'],
    ],
    [
      'routes an uncertain image to review',
      UNCERTAIN_VECTOR,
      'review',
      false,
      ['low_confidence'],
    ],
  ]

  it.each(dispositions)(
    '%s',
    async (_label, probabilities, disposition, passed, reasons) => {
      const screener = await readyScreener()
      const worker = latestWorker()

      const pending = screener.screen(IMAGE)
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
      send(worker, resultMessage(lastRequestId(worker), probabilities))

      await expect(pending).resolves.toMatchObject({
        disposition,
        passed,
        reasons,
        engineVersion: composeEngineVersion(RUNTIME_IDENTITY),
        classProbabilities: mapClassProbabilities(probabilities, [...NSFW_CLASS_NAMES]),
        inferenceMs: 42,
      })
    }
  )

  /**
   * The persisted `moderation_engine_version` outlives everyone who remembers
   * which engine was wired, so it has to name the artifacts that actually ran
   * and must never be confusable with the fixture screener's version.
   */
  it('persists the identity the worker reported, not a placeholder', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    send(worker, resultMessage(lastRequestId(worker), NEUTRAL_VECTOR))
    const result = await pending

    expect(result.engineVersion).toBe(composeEngineVersion(RUNTIME_IDENTITY))
    expect(result.engineVersion).toContain(
      `model-${RUNTIME_IDENTITY.modelDigest.slice(0, 12)}`
    )
    expect(result.engineVersion).toContain(
      `policy-${RUNTIME_IDENTITY.policyDigest.slice(0, 12)}`
    )
    expect(result.engineVersion).not.toContain('fixture')
    expect(result.modelDigest).toBe(RUNTIME_IDENTITY.modelDigest)
    expect(result.policyDigest).toBe(RUNTIME_IDENTITY.policyDigest)
    expect(result.policyVersion).toBe(POLICY_VERSION)
  })

  /** One WASM backend runs one classification, so the controller must queue. */
  it('runs one classification at a time when two screenings overlap', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const first = screener.screen(IMAGE)
    const second = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worker.postMessage).toHaveBeenCalledTimes(1)

    const firstId = lastRequestId(worker)
    send(worker, resultMessage(firstId, NEUTRAL_VECTOR))
    await expect(first).resolves.toMatchObject({ disposition: 'pass' })

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    expect(lastRequestId(worker)).not.toBe(firstId)
    send(worker, resultMessage(lastRequestId(worker), NEUTRAL_VECTOR))

    await expect(second).resolves.toMatchObject({ disposition: 'pass' })
  })
})

describe('TensorflowNsfwImageScreener inference failure', () => {
  it('terminates the model process when a classification exceeds its timeout', async () => {
    const screener = await readyScreener({ inferenceTimeoutMs: 200 })
    const worker = latestWorker()
    vi.useFakeTimers()

    const pending = screener.screen(IMAGE)
    // The rejection is claimed before the clock moves: advancing fake timers
    // runs a microtask checkpoint that would otherwise see it unhandled.
    const settled = expect(pending).rejects.toThrow(/timed out after/)
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)

    await settled
    await expect(pending).rejects.toBeInstanceOf(NsfwScreeningError)
    await expect(pending).rejects.toMatchObject({
      reasonCode: NSFW_REASON_INFERENCE_TIMEOUT,
    })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects the in-flight screening when the worker thread dies', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    worker.emit('error', new Error('wasm heap exhausted'))

    await expect(pending).rejects.toThrow('wasm heap exhausted')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('replays the crash cause without respawning while the cooldown holds', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    worker.emit('error', new Error('wasm heap exhausted'))
    await expect(pending).rejects.toThrow('wasm heap exhausted')

    await expect(screener.screen(IMAGE)).rejects.toThrow('wasm heap exhausted')
    await expect(screener.screen(IMAGE)).rejects.toThrow('wasm heap exhausted')
    expect(workers()).toHaveLength(1)
  })

  it('recovers on a fresh worker once the crash cooldown has expired', async () => {
    const screener = await readyScreener()
    const crashed = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(crashed.postMessage).toHaveBeenCalledTimes(1))
    crashed.emit('error', new Error('wasm heap exhausted'))
    await expect(pending).rejects.toThrow('wasm heap exhausted')

    vi.useFakeTimers()
    vi.advanceTimersByTime(NSFW_FAILURE_COOLDOWN_MS + 1)
    const retried = screener.screen(IMAGE)
    await vi.advanceTimersByTimeAsync(0)
    expect(workers()).toHaveLength(2)

    const replacement = latestWorker()
    send(replacement, readyMessage())
    await vi.advanceTimersByTimeAsync(0)
    send(replacement, resultMessage(lastRequestId(replacement), NEUTRAL_VECTOR))

    await expect(retried).resolves.toMatchObject({ disposition: 'pass', passed: true })
  })
})

describe('TensorflowNsfwImageScreener worker resolution', () => {
  it('runs the compiled worker without a TypeScript loader when it is built', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    void screener.ensureReady().catch(() => undefined)
    await vi.waitFor(() => expect(workers()).toHaveLength(1))

    expect(latestWorker().scriptPath).toMatch(/community-nsfw-inference\.worker\.js$/)
    expect(latestWorker().options.execArgv).toEqual([])
  })

  it('falls back to the TypeScript source outside production', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (target) => !String(target).endsWith('community-nsfw-inference.worker.js')
    )
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })

    void screener.ensureReady().catch(() => undefined)
    await vi.waitFor(() => expect(workers()).toHaveLength(1))

    expect(latestWorker().scriptPath).toMatch(/community-nsfw-inference\.worker\.ts$/)
    expect(latestWorker().options.execArgv).toEqual(['-r', 'ts-node/register'])
  })

  /** Reading a `.ts` worker in production would mean shipping an unbuilt artifact. */
  it('refuses to start in production when the compiled worker is missing', async () => {
    // Built before NODE_ENV moves: the manifest override is resolved in the
    // constructor and is itself forbidden outside a test environment.
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (target) => !String(target).includes('community-nsfw-inference.worker')
    )

    await expect(screener.ensureReady()).rejects.toThrow(
      /worker build artifact is missing/
    )
    expect(workers()).toHaveLength(0)
  })

  /** The override is a policy-selection route in disguise, so production refuses it. */
  it('refuses a manifest override outside a test environment', () => {
    const manifestPath = createManifestFixture()
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => new TensorflowNsfwImageScreener({ manifestPath })).toThrow(
      /override is forbidden outside an allowed test environment/
    )
  })
})

describe('TensorflowNsfwImageScreener shutdown', () => {
  it('terminates the worker and refuses to start again after close', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    await screener.close()

    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await expect(screener.ensureReady()).rejects.toThrow(
      'Community NSFW screener is closing'
    )
    expect(workers()).toHaveLength(1)
  })
})

const { forbidNetworkAccess } = NsfwWorkerModule

/**
 * Saves and restores `net.Socket.prototype.connect` through its property
 * descriptor. Reading the method value directly would be an unbound-method
 * reference, and the descriptor round-trip restores the original exactly.
 */
function captureSocketConnect(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect')
  return () => {
    if (descriptor) Object.defineProperty(net.Socket.prototype, 'connect', descriptor)
  }
}

describe('forbidNetworkAccess', () => {
  it('refuses a fetch and names what it refused', () => {
    const scope: { fetch?: unknown } = {}

    forbidNetworkAccess(scope)

    expect(() =>
      (scope.fetch as (url: string) => unknown)('https://models.example')
    ).toThrow(/network connection to https:\/\/models\.example/)
  })

  // `fetch` alone is not the guarantee AC 1 asks for. A raw net, tls, http or
  // https client never touches it, and all four reach this one prototype method.
  it('refuses a raw socket, which no fetch patch would catch', () => {
    const restoreSocketConnect = captureSocketConnect()

    try {
      forbidNetworkAccess({})

      expect(() => new net.Socket().connect(443, 'models.example')).toThrow(
        /must never reach a network/
      )
      expect(() =>
        new net.Socket().connect({ host: 'models.example', port: 443 })
      ).toThrow(/models\.example:443/)
    } finally {
      restoreSocketConnect()
    }
  })
})
