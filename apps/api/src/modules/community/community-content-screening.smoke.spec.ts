// Story 6.2 Task 2: the real-model smoke run for the ADR-013 NSFW image screener.
// It loads the installed nsfwjs graph and the TensorFlow.js WASM backend, so every
// case is gated behind `RUN_COMMUNITY_SCREENING_SMOKE` and reachable only through
// `npm run test:community-screening-model:smoke --workspace api`. A default suite
// run must stay on the fixture and unavailable adapters.
import fs from 'node:fs'
import type * as NetModule from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import sharp from 'sharp'
import { ADR013_IMAGE_ENGINE_VERSION } from './community-moderation.engine.js'
import {
  disposeInferenceWorker,
  initializeInferenceWorker,
  NSFW_CLASS_NAMES,
  NSFW_MODEL_INPUT_SIZE,
  readModelManifest,
  resolvePackageRoot,
  runInferenceOnImage,
  type NsfwModelManifest,
} from './community-nsfw-inference.worker.js'
import {
  loadApprovedPolicy,
  NSFW_INITIALIZATION_TIMEOUT_MS,
  resolveManifestPath,
  TensorflowNsfwImageScreener,
  type NsfwImagePolicy,
} from './tensorflow-nsfw-image-screener.js'

/**
 * Saves and restores `netModule.Socket.prototype.connect` through its property
 * descriptor. Reading the method value directly would be an unbound-method
 * reference, and the descriptor round-trip restores the original exactly.
 */
function captureSocketConnect(netModule: typeof NetModule): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    netModule.Socket.prototype,
    'connect'
  )
  return () => {
    if (descriptor)
      Object.defineProperty(netModule.Socket.prototype, 'connect', descriptor)
  }
}

const RUN_SMOKE = process.env.RUN_COMMUNITY_SCREENING_SMOKE === 'true'
const smokeIt = RUN_SMOKE ? it : it.skip

/** AC 8's absolute warm ceiling, far above what this stack costs. */
const AC8_WARM_CEILING_MS = 3_000
/** AC 8 calls a warm p95 above this a defect signal rather than a slow machine. */
const WARM_DEFECT_SIGNAL_MS = 500
/** Model load needs far more than Vitest's five-second default. */
const MODEL_TEST_TIMEOUT_MS = 60_000

describe('Community NSFW image screening model smoke test', () => {
  let manifestPath = ''
  let manifest: NsfwModelManifest
  let policy: NsfwImagePolicy
  let safeImage: Buffer
  let screener: TensorflowNsfwImageScreener | null = null
  let fetchSpy: MockInstance<typeof globalThis.fetch> | null = null

  // One model instance for the whole file: a cold start costs seconds, so the
  // first case pays for it and the rest reuse it.
  const readyScreener = async (): Promise<TensorflowNsfwImageScreener> => {
    screener ??= new TensorflowNsfwImageScreener()
    await screener.ensureReady()
    return screener
  }

  beforeAll(async () => {
    if (!RUN_SMOKE) return
    manifestPath = resolveManifestPath()
    manifest = readModelManifest(manifestPath)
    policy = (await loadApprovedPolicy(manifest, manifestPath)).policy
    // Generated here rather than committed: this repository holds no screening
    // imagery, and flat mid-grey is the same input the worker warms up on.
    safeImage = await sharp({
      create: {
        width: NSFW_MODEL_INPUT_SIZE,
        height: NSFW_MODEL_INPUT_SIZE,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
      },
    })
      .png()
      .toBuffer()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterAll(async () => {
    await screener?.close()
    screener = null
    fetchSpy?.mockRestore()
  })

  smokeIt(
    'reaches readiness against the installed model inside the AC 8 cold-start ceiling',
    async () => {
      expect(fs.existsSync(manifestPath)).toBe(true)

      const startedAt = Date.now()
      const active = await readyScreener()
      const coldStartMs = Date.now() - startedAt
      expect(coldStartMs).toBeLessThan(NSFW_INITIALIZATION_TIMEOUT_MS)

      const identity = active.runtimeIdentity
      expect(identity).not.toBeNull()
      expect(identity?.packageName).toBe('nsfwjs')
      expect(identity?.backend).toBe('wasm')
      expect(identity?.classNames).toEqual([...NSFW_CLASS_NAMES])
      expect(identity?.inputSize).toBe(NSFW_MODEL_INPUT_SIZE)

      // The manifest's pinned version is only honest if it is the version npm
      // actually installed, so the pin is read back off disk.
      const installedRoot = resolvePackageRoot(
        manifest.packageName,
        manifest.modelSubpath,
        createRequire(__filename)
      )
      const installed = JSON.parse(
        fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8')
      ) as { version?: string }
      expect(identity?.packageVersion).toBe(installed.version)
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'clears a synthetic safe image with a confident Neutral',
    async () => {
      const active = await readyScreener()
      const result = await active.screen(safeImage)

      expect(result.disposition).toBe('pass')
      expect(result.passed).toBe(true)
      expect(result.reasons).toEqual([])
      expect(result.classProbabilities.Neutral).toBeGreaterThan(policy.neutralPassMinimum)
      expect(result.score).toBe(result.classProbabilities.Neutral)
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'returns five finite probabilities that sum to 1 within the policy tolerance',
    async () => {
      const active = await readyScreener()
      const { classProbabilities } = await active.screen(safeImage)

      expect(Object.keys(classProbabilities)).toEqual([...NSFW_CLASS_NAMES])
      const probabilities = NSFW_CLASS_NAMES.map(
        (className) => classProbabilities[className] ?? Number.NaN
      )
      for (const probability of probabilities) {
        expect(Number.isFinite(probability)).toBe(true)
        expect(probability).toBeGreaterThanOrEqual(0)
        expect(probability).toBeLessThanOrEqual(1)
      }
      const sum = probabilities.reduce((total, value) => total + value, 0)
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(policy.probabilitySumTolerance)
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'persists an engine identity naming the real model and policy digests',
    async () => {
      const active = await readyScreener()
      const result = await active.screen(safeImage)

      expect(result.modelDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(result.policyDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(result.policyVersion).toBe(manifest.policy.version)
      expect(result.engineVersion).toBe(active.engineVersion)
      expect(result.engineVersion).toContain(ADR013_IMAGE_ENGINE_VERSION)
      expect(result.engineVersion).toContain(
        `${manifest.modelFamily}@${manifest.packageVersion}`
      )
      expect(result.engineVersion).toContain(`model-${result.modelDigest.slice(0, 12)}`)
      expect(result.engineVersion).toContain(`policy-${result.policyDigest.slice(0, 12)}`)
      expect(result.engineVersion).not.toContain('fixture')
      expect(result.engineVersion).not.toContain('unresolved')
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'completes a warm inference well inside the AC 8 warm ceiling',
    async () => {
      const active = await readyScreener()
      await active.screen(safeImage)

      const startedAt = Date.now()
      const result = await active.screen(safeImage)
      const warmMs = Date.now() - startedAt

      expect(warmMs).toBeLessThan(AC8_WARM_CEILING_MS)
      // The absolute ceiling above cannot detect a regression on its own. The
      // story's "Verified runtime baseline" measured warm p95 at 26 ms and calls
      // anything past 500 ms for a single 224x224 inference a defect signal, so
      // this is the assertion that would actually catch one.
      expect(warmMs).toBeLessThan(WARM_DEFECT_SIGNAL_MS)
      expect(result.inferenceMs).toBeLessThanOrEqual(warmMs)
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'performs no network access while loading the model or classifying',
    async () => {
      const active = await readyScreener()
      await active.screen(safeImage)

      // This spy covers the supervisor process, where `src/test-setup.ts` also
      // throws on any non-localhost request. The model runs in a worker thread
      // that carries its own globals, which neither reaches; the case below is
      // the one that proves the guarantee where the model actually loads.
      expect(fetchSpy).not.toBeNull()
      expect(fetchSpy?.mock.calls).toEqual([])
    },
    MODEL_TEST_TIMEOUT_MS
  )

  // AC 1 requires the inference process to open no socket, and a patched
  // `fetch` proves nothing about that: a raw `net`, `tls`, `http` or `https`
  // client never touches `fetch`. This runs the worker's own entrypoint in this
  // process instead of behind a thread boundary, so the guard it installs is
  // observable here. A real model load and a real classification completing
  // while every socket attempt and every fetch throws is the runtime evidence;
  // the explicit throws afterwards are what stop that from being vacuous.
  smokeIt(
    'loads the real model and classifies with every socket attempt armed to throw',
    async () => {
      const net = await import('node:net')
      const restoreSocketConnect = captureSocketConnect(net)
      const originalFetch = globalThis.fetch

      try {
        const startup = await initializeInferenceWorker(manifestPath)
        expect(startup.identity.backend).toBe('wasm')

        const probabilities = await runInferenceOnImage(safeImage)
        expect(probabilities).toHaveLength(NSFW_CLASS_NAMES.length)
        expect(probabilities.every((value) => Number.isFinite(value))).toBe(true)

        expect(() => new net.Socket().connect(443, 'example.com')).toThrow(
          /must never reach a network/
        )
        // The guard throws synchronously rather than returning a rejected
        // promise, so a caller that only writes `.catch()` still fails loudly.
        expect(() => globalThis.fetch('https://example.com')).toThrow(
          /must never reach a network/
        )
      } finally {
        restoreSocketConnect()
        globalThis.fetch = originalFetch
        disposeInferenceWorker()
      }
    },
    MODEL_TEST_TIMEOUT_MS
  )

  // The runtime logs this payload verbatim, so a real run has to produce all
  // five fields with real values rather than the fake worker's fixtures.
  smokeIt(
    'returns a truthful readiness payload from the real model',
    async () => {
      const active = await readyScreener()
      const readiness = await active.ensureReady()

      expect(readiness.backend).toBe('wasm')
      expect(readiness.policyVersion).toBe(manifest.policy.version)
      expect(readiness.modelHash).toMatch(/^[a-f0-9]{64}$/)
      expect(readiness.engineVersion).toBe(active.engineVersion)
      expect(readiness.engineVersion).not.toContain('fixture')
      expect(readiness.engineVersion).not.toContain('unresolved')
      expect(readiness.startupDurationMs).toBeGreaterThan(0)
      expect(readiness.startupDurationMs).toBeLessThan(NSFW_INITIALIZATION_TIMEOUT_MS)
      // Hosted readiness logs must carry no local absolute path.
      expect(JSON.stringify(readiness)).not.toContain('/')
    },
    MODEL_TEST_TIMEOUT_MS
  )

  smokeIt(
    'shuts the model worker down on close',
    async () => {
      const active = await readyScreener()

      await expect(active.close()).resolves.toBeUndefined()
      screener = null
      await expect(active.screen(safeImage)).rejects.toThrow(/closing/)
    },
    MODEL_TEST_TIMEOUT_MS
  )
})
