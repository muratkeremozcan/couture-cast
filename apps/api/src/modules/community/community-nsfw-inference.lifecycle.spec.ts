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

// Story 6.2 Task 2: the rest of the worker module's exported surface. Everything
// below runs in this process with no TensorFlow.js at all. `initializeInferenceWorker`
// and `loadGraphModelFromPackage` are the only exports that need a real graph
// model, and the gated readiness command is where those two are proven.
const {
  NSFW_MODEL_INPUT_SIZE,
  assertManifestIdentity,
  assertWeightBundlesMatchManifest,
  classifyPixels,
  computeSha256,
  decodeImageToPixels,
  defaultManifestDirectories,
  disposeInferenceWorker,
  findManifestIn,
  isModelDefinition,
  runInferenceOnImage,
  selectModelDefinition,
  verifyManifestFile,
} = NsfwWorkerModule

const DECODED_PIXEL_COUNT = NSFW_MODEL_INPUT_SIZE * NSFW_MODEL_INPUT_SIZE * 3

// Imported the way the worker imports it, so a run that never decodes an image
// never loads the native binding either.
async function solidImage(options: {
  width: number
  height: number
  channels: 3 | 4
  background: { r: number; g: number; b: number; alpha?: number }
  format?: 'jpeg' | 'png'
}): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const image = sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: options.channels,
      background: options.background,
    },
  })
  return options.format === 'jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer()
}

const pixelAt = (pixels: Uint8Array, offset: number): number[] =>
  Array.from(pixels.subarray(offset, offset + 3))

const squareImage = (): Promise<Buffer> =>
  solidImage({
    width: NSFW_MODEL_INPUT_SIZE,
    height: NSFW_MODEL_INPUT_SIZE,
    channels: 3,
    background: { r: 12, g: 34, b: 56 },
  })

const manifestFrom = (
  overrides: Record<string, unknown> = {}
): NsfwWorkerModule.NsfwModelManifest =>
  readModelManifest(createManifestFixture(overrides))

const modelDefinition = (): NsfwWorkerModule.NsfwModelDefinition => ({
  modelJson: () => Promise.resolve({ default: {} }),
  weightBundles: [],
})

describe('decodeImageToPixels', () => {
  it('decodes a 224x224 RGB image to one byte per channel', async () => {
    const pixels = await decodeImageToPixels(await squareImage())

    expect(pixels).toBeInstanceOf(Uint8Array)
    expect(pixels).toHaveLength(DECODED_PIXEL_COUNT)
    expect(pixelAt(pixels, 0)).toEqual([12, 34, 56])
  })

  /**
   * The graph accepts exactly one shape, so a phone photo has to arrive already
   * resized. Checking the colour as well as the length is what separates a real
   * resize from a stride or channel-order bug that produces the right byte count.
   */
  it('resizes an image of any other size onto the shape the graph declares', async () => {
    const pixels = await decodeImageToPixels(
      await solidImage({
        width: 320,
        height: 180,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      })
    )

    expect(pixels).toHaveLength(DECODED_PIXEL_COUNT)
    for (const offset of [0, DECODED_PIXEL_COUNT / 2, DECODED_PIXEL_COUNT - 3]) {
      expect(pixelAt(pixels, offset)).toEqual([200, 100, 50])
    }
  })

  /** Dropping the alpha channel would classify whatever colour it hid. */
  it('flattens a fully transparent image onto black', async () => {
    const pixels = await decodeImageToPixels(
      await solidImage({
        width: NSFW_MODEL_INPUT_SIZE,
        height: NSFW_MODEL_INPUT_SIZE,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 0 },
      })
    )

    expect(pixelAt(pixels, 0)).toEqual([0, 0, 0])
    expect(pixels.findIndex((value) => value !== 0)).toBe(-1)
  })

  it('rejects a buffer that is not an image at all', async () => {
    const notAnImage = Buffer.from('not an image')

    await expect(decodeImageToPixels(notAnImage)).rejects.toBeInstanceOf(
      NsfwImageDecodeError
    )
    await expect(decodeImageToPixels(notAnImage)).rejects.toThrow(
      /could not be decoded for inference/
    )
  })

  /**
   * The shape assertion inside the decoder is unreachable through real sharp,
   * which is why it is worth pinning: a wrapped error would hide the dimensions
   * from the operator reading the failure.
   */
  it('re-throws its own decode error with the measured dimensions intact', async () => {
    vi.doMock('sharp', () => {
      const pipeline: Record<string, unknown> = {}
      for (const step of ['flatten', 'resize', 'toColourspace', 'raw']) {
        pipeline[step] = () => pipeline
      }
      pipeline.toBuffer = () =>
        Promise.resolve({
          data: Buffer.alloc(12),
          info: { width: 2, height: 2, channels: 3 },
        })
      return { default: () => pipeline }
    })

    try {
      await expect(decodeImageToPixels(Buffer.from('mocked'))).rejects.toThrow(
        'Decoded image is 2x2x3, expected 224x224x3'
      )
      await expect(decodeImageToPixels(Buffer.from('mocked'))).rejects.toBeInstanceOf(
        NsfwImageDecodeError
      )
    } finally {
      vi.doUnmock('sharp')
    }
  })
})

describe('verifyManifestFile', () => {
  const ARTIFACT_BYTES = 'model-graph-bytes'

  /** A package root nested inside the temp tree, so `..` stays cleanable. */
  function installedPackage(relativePath = path.join('dist', 'model.bin')): {
    root: string
    file: NsfwManifestFile
  } {
    const root = path.join(temporaryDirectory('nsfw-install-'), 'node_modules', 'nsfwjs')
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, ARTIFACT_BYTES)
    return {
      root,
      file: { package: 'nsfwjs', path: relativePath, sha256: sha256Of(ARTIFACT_BYTES) },
    }
  }

  it('returns the canonical path of a file whose bytes match the manifest', async () => {
    const { root, file } = installedPackage()

    await expect(verifyManifestFile(file, root)).resolves.toBe(
      fs.realpathSync(path.join(root, file.path))
    )
  })

  it('rejects a manifest entry whose file was never installed', async () => {
    const { root, file } = installedPackage()

    await expect(
      verifyManifestFile({ ...file, path: path.join('dist', 'absent.bin') }, root)
    ).rejects.toThrow(/declares a missing file/)
  })

  /** A file at the right path with the wrong bytes is why the hash is pinned. */
  it('rejects a file whose bytes are not the ones the manifest pinned', async () => {
    const { root, file } = installedPackage()
    fs.writeFileSync(path.join(root, file.path), 'tampered-bytes')

    await expect(verifyManifestFile(file, root)).rejects.toThrow(
      /Model artifact checksum mismatch/
    )
  })

  const invalidDigests: [string, string | undefined][] = [
    ['a truncated digest', sha256Of(ARTIFACT_BYTES).slice(0, 32)],
    ['a digest that is not hex', 'z'.repeat(64)],
    ['no digest at all', undefined],
  ]

  it.each(invalidDigests)('rejects %s', async (_label, sha256) => {
    const { root, file } = installedPackage()

    await expect(
      verifyManifestFile({ ...file, sha256: sha256 as string }, root)
    ).rejects.toThrow(/64-character SHA-256 hex digest/)
  })

  const invalidPaths: [string, string | undefined][] = [
    ['an empty path', ''],
    ['no path at all', undefined],
  ]

  it.each(invalidPaths)('rejects a manifest entry with %s', async (_label, badPath) => {
    const { root, file } = installedPackage()

    await expect(
      verifyManifestFile({ ...file, path: badPath as string }, root)
    ).rejects.toThrow(/must declare a path/)
  })

  it('rejects a path that escapes its package root', async () => {
    const { root, file } = installedPackage()
    fs.writeFileSync(path.join(root, '..', 'outside.bin'), ARTIFACT_BYTES)

    await expect(
      verifyManifestFile({ ...file, path: path.join('..', 'outside.bin') }, root)
    ).rejects.toThrow(/escapes its package root/)
  })

  /** A symlink satisfies the textual check, which is why realpath runs too. */
  it('rejects a symlink that points out of its package root', async () => {
    const { root, file } = installedPackage()
    const outside = path.join(root, '..', 'outside.bin')
    fs.writeFileSync(outside, ARTIFACT_BYTES)
    fs.rmSync(path.join(root, file.path))
    fs.symlinkSync(outside, path.join(root, file.path))

    await expect(verifyManifestFile(file, root)).rejects.toThrow(
      /escapes its package root/
    )
  })
})

describe('computeSha256', () => {
  it.each([
    ['a file with bytes in it', 'model-graph-bytes'],
    ['an empty file', ''],
  ])('hashes %s to the digest node:crypto computes', async (_label, contents) => {
    const filePath = path.join(temporaryDirectory('nsfw-digest-'), 'artifact.bin')
    fs.writeFileSync(filePath, contents)

    await expect(computeSha256(filePath)).resolves.toBe(sha256Of(contents))
  })
})

describe('isModelDefinition', () => {
  it('accepts the shape nsfwjs/models/* exports', () => {
    expect(isModelDefinition(modelDefinition())).toBe(true)
  })

  const nonDefinitions: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nsfwjs/models/mobilenet_v2_mid'],
    ['a number', 4],
    ['an empty object', {}],
    ['a modelJson that is not callable', { modelJson: 'nope', weightBundles: [] }],
    [
      'weightBundles that is not an array',
      { modelJson: () => undefined, weightBundles: 'nope' },
    ],
  ]

  it.each(nonDefinitions)('rejects %s', (_label, value) => {
    expect(isModelDefinition(value)).toBe(false)
  })
})

describe('selectModelDefinition', () => {
  it('prefers the export the manifest names', () => {
    const named = modelDefinition()
    const other = modelDefinition()

    expect(
      selectModelDefinition({ named, other }, manifestFrom({ modelExport: 'named' }))
    ).toBe(named)
  })

  it('finds the model structurally when the manifest names no export', () => {
    const bundled = modelDefinition()

    expect(selectModelDefinition({ notes: 'metadata', bundled }, manifestFrom())).toBe(
      bundled
    )
  })

  /**
   * The manifest name is the audit trail; the structural fallback is what keeps
   * a rename inside nsfwjs from taking image screening offline entirely.
   */
  it('survives a rename by falling back when the named export is not a model', () => {
    const bundled = modelDefinition()

    expect(
      selectModelDefinition(
        { mobilenetV2Mid: 'renamed away', bundled },
        manifestFrom({ modelExport: 'mobilenetV2Mid' })
      )
    ).toBe(bundled)
  })

  it('throws naming the subpath when no export qualifies', () => {
    expect(() =>
      selectModelDefinition({ default: {}, version: '4.3.0' }, manifestFrom())
    ).toThrow('nsfwjs/models/mobilenet_v2_mid did not export a usable model definition')
  })
})

describe('assertWeightBundlesMatchManifest', () => {
  const WEIGHTS_MANIFEST = [
    { paths: ['group1-shard1of2'] },
    { paths: ['group1-shard2of2'] },
  ]
  const BUNDLES = [Buffer.alloc(8), Buffer.alloc(16)]
  const PINNED = {
    manifestPaths: ['group1-shard1of2', 'group1-shard2of2'],
    weightSpecCount: 4,
    decodedBytes: [8, 16],
  }

  it('accepts bundles that agree with the manifest', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(
        manifestFrom({ weightBundles: PINNED }),
        WEIGHTS_MANIFEST,
        BUNDLES,
        4
      )
    ).not.toThrow()
  })

  it('rejects a bundle count the bundled model does not declare', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(
        manifestFrom({ weightBundles: PINNED }),
        WEIGHTS_MANIFEST,
        [BUNDLES[0] as Buffer],
        4
      )
    ).toThrow(/declares 2 weight paths but ships 1 bundles/)
  })

  /** The mirror is optional, so a manifest without it must still load. */
  it('skips every mirror check when the manifest pins no weight bundles', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(manifestFrom(), WEIGHTS_MANIFEST, BUNDLES, 99)
    ).not.toThrow()
  })

  it('rejects weight paths the manifest does not name', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(
        manifestFrom({
          weightBundles: { ...PINNED, manifestPaths: ['group1-shard1of2', 'renamed'] },
        }),
        WEIGHTS_MANIFEST,
        BUNDLES,
        4
      )
    ).toThrow(/do not match the manifest/)
  })

  it('rejects a weight spec count the manifest does not pin', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(
        manifestFrom({ weightBundles: PINNED }),
        WEIGHTS_MANIFEST,
        BUNDLES,
        5
      )
    ).toThrow('Bundled model declares 5 weight specs, manifest pins 4')
  })

  /** A re-encoded or truncated bundle hashes fine on disk and fails here. */
  it('rejects decoded bundle sizes the manifest does not pin', () => {
    expect(() =>
      assertWeightBundlesMatchManifest(
        manifestFrom({ weightBundles: { ...PINNED, decodedBytes: [8, 32] } }),
        WEIGHTS_MANIFEST,
        BUNDLES,
        4
      )
    ).toThrow(/Decoded weight bundle sizes \[8, 16\]/)
  })
})

describe('assertManifestIdentity', () => {
  const identity = {
    modelFamily: 'mobilenet_v2_mid',
    packageName: 'nsfwjs',
    packageVersion: '4.3.0',
    modelSubpath: 'nsfwjs/models/mobilenet_v2_mid',
    backend: 'wasm',
  }

  it('accepts an identity that names its model, package and backend', () => {
    expect(() => assertManifestIdentity(identity)).not.toThrow()
  })

  const brokenIdentities: [string, Partial<NsfwWorkerModule.NsfwModelManifest>][] = [
    ['no model family', { modelFamily: undefined }],
    ['no package name', { packageName: undefined }],
    ['no package version', { packageVersion: undefined }],
    ['no model subpath', { modelSubpath: undefined }],
    ['a backend other than wasm', { backend: 'cpu' }],
  ]

  it.each(brokenIdentities)('rejects an identity with %s', (_label, overrides) => {
    expect(() => assertManifestIdentity({ ...identity, ...overrides })).toThrow(
      'Model manifest identity is invalid'
    )
  })
})

describe('findManifestIn', () => {
  function manifestDirectory(...names: string[]): string {
    const directory = temporaryDirectory('nsfw-lookup-')
    for (const name of names) fs.writeFileSync(path.join(directory, name), '{}')
    return directory
  }

  it('takes the alphabetically first manifest in the first directory that exists', () => {
    const absent = path.join(temporaryDirectory('nsfw-lookup-'), 'never-created')
    const directory = manifestDirectory(
      'community-nsfw-mobilenet-v2-mid.json',
      'community-nsfw-a-earlier.json'
    )

    expect(findManifestIn([absent, directory])).toBe(
      path.join(directory, 'community-nsfw-a-earlier.json')
    )
  })

  it('walks past a directory that holds nothing matching', () => {
    const decoys = manifestDirectory(
      'fashion-clip-7e3ba62.json',
      'community-nsfw-notes.txt'
    )
    const directory = manifestDirectory('community-nsfw-mobilenet-v2-mid.json')

    expect(findManifestIn([decoys, directory])).toBe(
      path.join(directory, 'community-nsfw-mobilenet-v2-mid.json')
    )
  })

  it('throws naming every directory it looked in', () => {
    const first = manifestDirectory()
    const second = manifestDirectory()

    expect(() => findManifestIn([first, second])).toThrow(
      `Community NSFW model manifest not found in: ${first}, ${second}`
    )
  })
})

describe('defaultManifestDirectories', () => {
  it('offers the src and dist locations, three and four levels up', () => {
    const fromDirectory = path.join(path.sep, 'srv', 'api', 'src', 'modules', 'community')

    expect(defaultManifestDirectories(fromDirectory)).toEqual([
      path.resolve(path.sep, 'srv', 'api', 'model-manifests'),
      path.resolve(path.sep, 'srv', 'model-manifests'),
    ])
  })

  /** The worker sits in this directory, so one candidate has to be the real one. */
  it('resolves the checked-in manifest directory from the worker location', () => {
    const candidates = defaultManifestDirectories(__dirname)

    expect(candidates.filter((directory) => fs.existsSync(directory))).toHaveLength(1)
    expect(findManifestIn(candidates)).toMatch(/community-nsfw-.+\.json$/)
  })
})

describe('classifyPixels without a loaded model', () => {
  it('refuses to classify before the runtime is initialized', async () => {
    await expect(classifyPixels(new Uint8Array(DECODED_PIXEL_COUNT))).rejects.toThrow(
      'NSFW inference worker is not initialized'
    )
  })

  it('decodes a real image before it discovers there is no model to run', async () => {
    await expect(runInferenceOnImage(await squareImage())).rejects.toThrow(
      'NSFW inference worker is not initialized'
    )
  })

  it('fails at the decode when the bytes are not an image', async () => {
    await expect(runInferenceOnImage(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      NsfwImageDecodeError
    )
  })
})

describe('disposeInferenceWorker', () => {
  it('is safe and idempotent when no model was ever loaded', () => {
    expect(() => disposeInferenceWorker()).not.toThrow()
    expect(() => disposeInferenceWorker()).not.toThrow()
  })
})

// Story 6.2 Task 2 (continued). `assertManifestWeightBundles` is the newest of
// the manifest gates; everything after it is a controller lifecycle path that
// only the fake worker and a faked clock can reach.
const { assertManifestWeightBundles } = NsfwWorkerModule
const { NSFW_INITIALIZATION_TIMEOUT_MS, toWorkerError } =
  TensorflowNsfwImageScreenerModule

type NsfwWeightBundleMirror = NsfwWorkerModule.NsfwModelManifest['weightBundles']

describe('assertManifestWeightBundles', () => {
  const MIRROR = {
    manifestPaths: ['group1-shard1of2', 'group1-shard2of2'],
    weightSpecCount: 4,
    decodedBytes: [8, 16],
  }

  it('returns silently when the manifest pins no weight bundles', () => {
    expect(() => assertManifestWeightBundles({})).not.toThrow()
  })

  it('accepts a mirror whose paths, spec count and decoded sizes agree', () => {
    expect(() => assertManifestWeightBundles({ weightBundles: MIRROR })).not.toThrow()
  })

  const malformedMirrors: [string, Record<string, unknown>][] = [
    ['an empty object', {}],
    ['no manifestPaths', { ...MIRROR, manifestPaths: undefined }],
    ['an empty manifestPaths', { ...MIRROR, manifestPaths: [] }],
    ['a manifestPaths that is not an array', { ...MIRROR, manifestPaths: 'shard1' }],
    ['a manifest path that is an empty string', { ...MIRROR, manifestPaths: ['a', ''] }],
    ['a manifest path that is not a string', { ...MIRROR, manifestPaths: ['a', 2] }],
    ['no weightSpecCount', { ...MIRROR, weightSpecCount: undefined }],
    ['a fractional weightSpecCount', { ...MIRROR, weightSpecCount: 4.5 }],
    ['a zero weightSpecCount', { ...MIRROR, weightSpecCount: 0 }],
    ['a negative weightSpecCount', { ...MIRROR, weightSpecCount: -4 }],
    ['no decodedBytes', { ...MIRROR, decodedBytes: undefined }],
    ['a decodedBytes that is not an array', { ...MIRROR, decodedBytes: 24 }],
    ['fewer decodedBytes entries than paths', { ...MIRROR, decodedBytes: [8] }],
    ['a zero decodedBytes entry', { ...MIRROR, decodedBytes: [8, 0] }],
    ['a negative decodedBytes entry', { ...MIRROR, decodedBytes: [8, -16] }],
    ['a fractional decodedBytes entry', { ...MIRROR, decodedBytes: [8, 16.5] }],
  ]

  it.each(malformedMirrors)('rejects a mirror with %s', (_label, mirror) => {
    expect(() =>
      assertManifestWeightBundles({ weightBundles: mirror as NsfwWeightBundleMirror })
    ).toThrow(/weightBundles must declare/)
  })

  /**
   * `"weightBundles": {}` used to clear every manifest gate and die inside
   * `assertWeightBundlesMatchManifest` as `Cannot read properties of undefined
   * (reading 'length')`, at model load, reaching the supervisor as a generic
   * initialization failure that never mentioned the manifest.
   */
  it('is wired into readModelManifest, so a broken mirror fails manifest-shaped', () => {
    const manifestPath = createManifestFixture({ weightBundles: {} })

    expect(() => readModelManifest(manifestPath)).toThrow(/weightBundles must declare/)
  })
})

describe('toWorkerError', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular

  it('hands back the Error it was given', () => {
    const original = new Error('already an error')

    expect(toWorkerError(original, 'fallback')).toBe(original)
  })

  const nonErrors: [string, unknown, string][] = [
    ['a message string', 'boom', 'boom'],
    ['a number', 7, 'fallback: 7'],
    ['a boolean', false, 'fallback: false'],
    ['a bigint', BigInt(9), 'fallback: 9'],
    ['an empty string', '', 'fallback'],
    ['null', null, 'fallback'],
    ['undefined', undefined, 'fallback'],
    ['a value JSON cannot serialise', circular, 'fallback'],
  ]

  it.each(nonErrors)('turns %s into an Error', (_label, value, expected) => {
    const error = toWorkerError(value, 'fallback')

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(expected)
  })
})

describe('TensorflowNsfwImageScreener startup timeout', () => {
  it('gives up and terminates the model process when ready never arrives', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })
    // The first attempt exists to get the policy cached on the real clock: the
    // load is filesystem I/O, and the retry below must spawn without it so the
    // only timer a faked clock stands in front of is the worker's own.
    const first = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    latestWorker().emit('exit', 9)
    await expect(first).rejects.toThrow(/exited before ready/)

    vi.useFakeTimers()
    vi.advanceTimersByTime(NSFW_FAILURE_COOLDOWN_MS + 1)
    const retried = screener.ensureReady()
    const settled = expect(retried).rejects.toThrow(/startup timed out after/)
    await vi.advanceTimersByTimeAsync(0)
    expect(workers()).toHaveLength(2)
    const stalled = latestWorker()
    await vi.advanceTimersByTimeAsync(NSFW_INITIALIZATION_TIMEOUT_MS)

    await settled
    expect(stalled.terminate).toHaveBeenCalled()
  })
})

/**
 * Node turns an unhandled rejection into a process exit, so a teardown that
 * rejects while a startup is already failing has to stay swallowed. Capturing
 * the event here makes that assertion belong to the test that provokes it.
 */
function captureUnhandledRejections(): { reasons: unknown[]; restore: () => void } {
  const reasons: unknown[] = []
  const listener = (reason: unknown): void => {
    reasons.push(reason)
  }
  process.on('unhandledRejection', listener)
  return {
    reasons,
    restore: () => {
      process.off('unhandledRejection', listener)
    },
  }
}

describe('TensorflowNsfwImageScreener startup teardown', () => {
  it('keeps the initialization cause when terminating the worker rejects', async () => {
    const unhandled = captureUnhandledRejections()

    try {
      const screener = new TensorflowNsfwImageScreener({
        manifestPath: createManifestFixture(),
      })
      const ready = screener.ensureReady()
      await vi.waitFor(() => expect(workers()).toHaveLength(1))
      latestWorker().terminate = vi
        .fn<() => Promise<number>>()
        .mockRejectedValue(new Error('terminate refused'))
      send(latestWorker(), {
        type: 'initialization_error',
        error: 'wasm backend absent',
      })

      await expect(ready).rejects.toThrow('wasm backend absent')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled.reasons).toEqual([])
    } finally {
      unhandled.restore()
    }
  })
})

describe('TensorflowNsfwImageScreener idle crash', () => {
  it('restarts on an error event with no screening in flight', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    worker.emit('error', new Error('worker thread crashed'))

    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await expect(screener.ensureReady()).rejects.toThrow('worker thread crashed')
    expect(workers()).toHaveLength(1)

    vi.useFakeTimers()
    vi.advanceTimersByTime(NSFW_FAILURE_COOLDOWN_MS + 1)
    const recovered = screener.ensureReady()
    await vi.advanceTimersByTimeAsync(0)
    expect(workers()).toHaveLength(2)
    send(latestWorker(), readyMessage())

    await expect(recovered).resolves.toBeUndefined()
  })
})

describe('TensorflowNsfwImageScreener restart failure', () => {
  const refusingTerminate = () =>
    vi.fn<() => Promise<number>>().mockRejectedValue(new Error('terminate refused'))

  it('rejects a crashed screening with the reason the restart failed', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()
    worker.terminate = refusingTerminate()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    worker.emit('error', new Error('wasm heap exhausted'))

    await expect(pending).rejects.toThrow('terminate refused')
  })

  it('rejects a timed-out screening with the reason the restart failed', async () => {
    const screener = await readyScreener({ inferenceTimeoutMs: 200 })
    const worker = latestWorker()
    worker.terminate = refusingTerminate()
    vi.useFakeTimers()

    const pending = screener.screen(IMAGE)
    const settled = expect(pending).rejects.toThrow('terminate refused')
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)

    await settled
  })
})

/**
 * A worker thread's `error` event carries whatever the thread threw, so a
 * module-resolution failure arrives as a plain object rather than an Error.
 * Rejecting with that value cost a peer session an hour: every case in the
 * smoke suite printed `{}` while the true cause, a node_modules tree that
 * predated the TensorFlow.js install, never once surfaced.
 */
describe('TensorflowNsfwImageScreener non-Error worker events', () => {
  async function spawnedScreener(): Promise<{ ready: Promise<void> }> {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })
    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    return { ready }
  }

  it('names the module it could not find rather than rejecting with {}', async () => {
    const { ready } = await spawnedScreener()

    latestWorker().emit('error', {
      message: "Cannot find module '@tensorflow/tfjs-core'",
      code: 'MODULE_NOT_FOUND',
    })

    await expect(ready).rejects.toBeInstanceOf(Error)
    await expect(ready).rejects.toThrow("Cannot find module '@tensorflow/tfjs-core'")
    await expect(ready).rejects.toMatchObject({ name: 'MODULE_NOT_FOUND' })
  })

  it('rejects with a non-empty Error when the event carries no message', async () => {
    const { ready } = await spawnedScreener()

    latestWorker().emit('error', { stacks: [] })

    await expect(ready).rejects.toBeInstanceOf(Error)
    await expect(ready).rejects.toThrow(/failed to start: \{"stacks":\[\]\}/)
  })
})

describe('TensorflowNsfwImageScreener response filtering', () => {
  it('ignores handshakes and other requests while a screening is in flight', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    const requestId = lastRequestId(worker)
    send(worker, readyMessage())
    send(worker, { type: 'initialization_error', error: 'not this caller' })
    send(worker, resultMessage(`${requestId}-stale`, UNSAFE_VECTOR))

    const outcome = await Promise.race([
      pending.then(
        () => 'settled',
        () => 'settled'
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('in flight'), 0)),
    ])
    expect(outcome).toBe('in flight')

    send(worker, resultMessage(requestId, NEUTRAL_VECTOR))
    await expect(pending).resolves.toMatchObject({ disposition: 'pass' })
  })

  it('rejects with the code and message a failed inference reported', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()

    const pending = screener.screen(IMAGE)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
    send(worker, {
      type: 'error',
      id: lastRequestId(worker),
      error: 'boom',
      code: 'NSFW_OUTPUT_INVALID',
    })

    await expect(pending).rejects.toThrow(/NSFW_OUTPUT_INVALID: boom/)
  })
})

describe('TensorflowNsfwImageScreener shutdown mid-lifecycle', () => {
  it('waits for an in-flight restart before it finishes closing', async () => {
    const screener = await readyScreener()
    const worker = latestWorker()
    let finishTerminate = (): void => undefined
    worker.terminate = vi.fn<() => Promise<number>>(
      () =>
        new Promise<number>((resolve) => {
          finishTerminate = () => resolve(0)
        })
    )

    worker.emit('error', new Error('worker thread crashed'))
    expect(worker.terminate).toHaveBeenCalledTimes(1)

    let closed = false
    const closing = screener.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closed).toBe(false)

    finishTerminate()
    await closing
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('closes without stranding a caller when the model never became ready', async () => {
    const screener = new TensorflowNsfwImageScreener({
      manifestPath: createManifestFixture(),
    })
    const ready = screener.ensureReady()
    await vi.waitFor(() => expect(workers()).toHaveLength(1))
    const settled = expect(ready).rejects.toThrow(/closed before the model became ready/)

    await expect(screener.close()).resolves.toBeUndefined()

    await settled
    expect(latestWorker().terminate).toHaveBeenCalledTimes(1)
  })
})
