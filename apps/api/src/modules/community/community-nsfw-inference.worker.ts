// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 2: the isolated inference entrypoint for ADR-013 NSFW image
// screening. It runs in a worker thread so a CPU-bound classification can be
// stopped by terminating the thread; a `Promise.race` in the main thread would
// leave the computation running and let it compete with the BullMQ retry that
// the timeout just caused.
//
// This module deliberately imports nothing from the rest of the repository.
// Everything it needs arrives as `workerData` or is read from the manifest, so
// the `.ts` fallback spawn path stays loadable under a bare `ts-node/register`
// hook, and the controller can import the protocol types from here without
// pulling TensorFlow.js into the main thread: every TensorFlow.js import below
// is either `import type`, which is erased, or dynamic and inside a function.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import type * as tfCore from '@tensorflow/tfjs-core'

/** Canonical class names, in the order `NSFW_CLASSES` declares them. */
export const NSFW_CLASS_NAMES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as const

export type NsfwClassName = (typeof NSFW_CLASS_NAMES)[number]

export const NSFW_MODEL_INPUT_SIZE = 224

export type NsfwInferenceErrorCode =
  | 'NSFW_OUTPUT_INVALID'
  | 'NSFW_IMAGE_DECODE_FAILED'
  | 'NSFW_INFERENCE_FAILED'

/**
 * The model and policy artifacts that actually ran, as measured by this
 * process rather than as declared by configuration.
 */
export interface NsfwRuntimeIdentity {
  modelFamily: string
  packageName: string
  packageVersion: string
  /** SHA-256 over the manifest's model file digests, in manifest order. */
  modelDigest: string
  policyVersion: string
  policyDigest: string
  backend: string
  classNames: string[]
  inputSize: number
}

export type NsfwInferenceRequest = {
  id: string
  imageBuffer: Buffer
}

export type NsfwInferenceResponse =
  | {
      type: 'ready'
      identity: NsfwRuntimeIdentity
      startupMs: number
      warmupMs: number
    }
  | { type: 'initialization_error'; error: string }
  | {
      type: 'result'
      id: string
      classNames: string[]
      probabilities: number[]
      inferenceMs: number
    }
  | { type: 'error'; id: string; error: string; code: NsfwInferenceErrorCode }

export class NsfwInferenceOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NsfwInferenceOutputError'
  }
}

export class NsfwImageDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NsfwImageDecodeError'
  }
}

/** A manifest file entry, resolved against its own package root. */
export interface NsfwManifestFile {
  package: string
  path: string
  sha256: string
}

export interface NsfwWasmManifestFile extends NsfwManifestFile {
  /**
   * The name TensorFlow.js asks its path map for. It is carried separately
   * because `setWasmPaths` keys on the binary name, not on the install path.
   */
  binaryName: string
}

export interface NsfwModelManifest {
  modelFamily: string
  packageName: string
  packageVersion: string
  modelSubpath: string
  modelExport?: string
  backend: string
  inputWidth: number
  inputHeight: number
  inputChannels: number
  inputScale: number
  outputShape: number[]
  classNames: string[]
  modelFiles: NsfwManifestFile[]
  wasmFiles: NsfwWasmManifestFile[]
  weightBundles?: {
    manifestPaths: string[]
    weightSpecCount: number
    decodedBytes: number[]
  }
  policy: { path: string; version: string; sha256: string }
  /**
   * A subset mirror of the policy's image thresholds, present so AC 1's "the
   * manifest pins thresholds" reads literally. It is verified against the
   * policy file rather than read from, so the two cannot drift in silence.
   */
  thresholds?: Record<string, unknown>
}

const HEX_SHA256 = /^[a-f0-9]{64}$/i

function assertHex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) {
    throw new Error(`${label} must be a 64-character SHA-256 hex digest`)
  }
  return value.toLowerCase()
}

/**
 * Resolves the install root of `packageName` through Node's own resolver.
 *
 * The obvious `require.resolve('<pkg>/package.json')` fails for `nsfwjs`,
 * whose `exports` map does not publish that path, so the fallback resolves an
 * export the map does publish and walks up to the directory whose
 * `package.json` claims the name. Both routes go through `createRequire`, so a
 * hoisted, deduped, or workspace-linked install resolves the same way a plain
 * one does; nothing here assumes a literal `node_modules` location.
 */
export function resolvePackageRoot(
  packageName: string,
  exportSpecifier: string,
  requireFrom: NodeRequire
): string {
  try {
    return path.dirname(requireFrom.resolve(`${packageName}/package.json`))
  } catch {
    // Falls through to the exports-map-safe route below.
  }

  let directory = path.dirname(requireFrom.resolve(exportSpecifier))
  const filesystemRoot = path.parse(directory).root
  while (directory !== filesystemRoot) {
    const candidate = path.join(directory, 'package.json')
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string }
      if (parsed.name === packageName) {
        return directory
      }
    }
    directory = path.dirname(directory)
  }

  throw new Error(`Unable to resolve the install root of ${packageName}`)
}

export async function computeSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/**
 * Verifies one manifest entry against the installed package and returns its
 * absolute path. A path that escapes its package root is rejected before the
 * file is read, and again after `realpath`, so neither `..` nor a symlink can
 * point the hash check at a file outside the package it claims to describe.
 */
export async function verifyManifestFile(
  file: NsfwManifestFile,
  packageRoot: string
): Promise<string> {
  if (typeof file.path !== 'string' || file.path.length === 0) {
    throw new Error('Every manifest file entry must declare a path')
  }
  const expected = assertHex(file.sha256, `Manifest hash for ${file.path}`)

  const absoluteRoot = path.resolve(packageRoot)
  const fullPath = path.resolve(absoluteRoot, file.path)
  if (!fullPath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Manifest path escapes its package root: ${file.path}`)
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Manifest declares a missing file: ${file.path}`)
  }
  const canonicalRoot = fs.realpathSync(absoluteRoot)
  const canonicalFile = fs.realpathSync(fullPath)
  if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Manifest path escapes its package root: ${file.path}`)
  }

  const actual = await computeSha256(canonicalFile)
  if (actual.toLowerCase() !== expected) {
    throw new Error(
      `Model artifact checksum mismatch for ${file.path}: expected ${expected}, got ${actual}`
    )
  }
  return canonicalFile
}

/**
 * The single digest that stands for "this exact set of model bytes". It is
 * derived from the verified per-file hashes rather than chosen, so a changed
 * artifact cannot keep its engine identity.
 */
export function deriveModelDigest(files: readonly NsfwManifestFile[]): string {
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(`${file.package}/${file.path}:${file.sha256.toLowerCase()}\n`)
  }
  return hash.digest('hex')
}

export function assertManifestIdentity(manifest: Partial<NsfwModelManifest>): void {
  if (
    typeof manifest.modelFamily !== 'string' ||
    typeof manifest.packageName !== 'string' ||
    typeof manifest.packageVersion !== 'string' ||
    typeof manifest.modelSubpath !== 'string' ||
    manifest.backend !== 'wasm'
  ) {
    throw new Error('Model manifest identity is invalid')
  }
}

function assertManifestClassNames(manifest: Partial<NsfwModelManifest>): void {
  const classNames = manifest.classNames
  if (
    !Array.isArray(classNames) ||
    classNames.length !== NSFW_CLASS_NAMES.length ||
    !NSFW_CLASS_NAMES.every((name, index) => classNames[index] === name)
  ) {
    throw new Error(
      `Model manifest class names must be exactly [${NSFW_CLASS_NAMES.join(', ')}] in that order`
    )
  }
}

function assertManifestTensorShape(manifest: Partial<NsfwModelManifest>): void {
  if (
    manifest.inputWidth !== NSFW_MODEL_INPUT_SIZE ||
    manifest.inputHeight !== NSFW_MODEL_INPUT_SIZE ||
    manifest.inputChannels !== 3
  ) {
    throw new Error(
      `Model manifest input dimensions must be ${NSFW_MODEL_INPUT_SIZE}x${NSFW_MODEL_INPUT_SIZE}x3`
    )
  }
  if (typeof manifest.inputScale !== 'number' || manifest.inputScale <= 0) {
    throw new Error('Model manifest must declare a positive input scale')
  }
  const outputShape = manifest.outputShape
  if (
    !Array.isArray(outputShape) ||
    outputShape.length !== 2 ||
    outputShape[0] !== 1 ||
    outputShape[1] !== NSFW_CLASS_NAMES.length
  ) {
    throw new Error(`Model manifest output shape must be [1, ${NSFW_CLASS_NAMES.length}]`)
  }
}

function assertManifestFiles(manifest: Partial<NsfwModelManifest>): void {
  if (!Array.isArray(manifest.modelFiles) || manifest.modelFiles.length === 0) {
    throw new Error('Model manifest must declare at least one model file')
  }
  if (!Array.isArray(manifest.wasmFiles) || manifest.wasmFiles.length === 0) {
    throw new Error('Model manifest must pin every TensorFlow.js WASM binary')
  }
  for (const file of manifest.wasmFiles) {
    if (typeof file.binaryName !== 'string' || file.binaryName.length === 0) {
      throw new Error('Every WASM manifest entry must name the binary it supplies')
    }
  }
}

function assertManifestPolicy(manifest: Partial<NsfwModelManifest>): void {
  const policy = manifest.policy
  if (
    !policy ||
    typeof policy.path !== 'string' ||
    typeof policy.version !== 'string' ||
    policy.version.length === 0
  ) {
    throw new Error('Model manifest must name the approved policy file and version')
  }
  assertHex(policy.sha256, 'Manifest policy hash')
}

/**
 * Validates the optional decoded-bundle mirror at manifest-read time.
 *
 * Without this, `assertWeightBundlesMatchManifest` dereferences
 * `manifestPaths` and `decodedBytes` as soon as the key is present, so a
 * manifest carrying `"weightBundles": {}`, or one that loses a field in an
 * edit, dies at model load with a TypeError about reading `length` of
 * undefined and reaches the supervisor as a generic initialization error. The
 * manifest file is not itself hash-verified, only the artifacts and the policy
 * it names are, so a hand-edit does reach this.
 */
export function assertManifestWeightBundles(manifest: Partial<NsfwModelManifest>): void {
  const bundles = manifest.weightBundles
  if (bundles === undefined) return

  const paths = (bundles as { manifestPaths?: unknown }).manifestPaths
  const specCount = (bundles as { weightSpecCount?: unknown }).weightSpecCount
  const decoded = (bundles as { decodedBytes?: unknown }).decodedBytes
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((entry) => typeof entry === 'string' && entry.length > 0) ||
    typeof specCount !== 'number' ||
    !Number.isInteger(specCount) ||
    specCount <= 0 ||
    !Array.isArray(decoded) ||
    decoded.length !== paths.length ||
    !decoded.every(
      (entry) => typeof entry === 'number' && Number.isInteger(entry) && entry > 0
    )
  ) {
    throw new Error(
      'Model manifest weightBundles must declare manifestPaths, a positive integer weightSpecCount, and one positive decodedBytes entry per path'
    )
  }
}

export function readModelManifest(manifestPath: string): NsfwModelManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Community NSFW model manifest not found: ${manifestPath}`)
  }
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  ) as Partial<NsfwModelManifest>

  assertManifestClassNames(manifest)
  assertManifestIdentity(manifest)
  assertManifestTensorShape(manifest)
  assertManifestFiles(manifest)
  assertManifestWeightBundles(manifest)
  assertManifestPolicy(manifest)

  return manifest as NsfwModelManifest
}

/**
 * Applies the manifest's canonical class names to the model's output vector
 * positionally. The length assertion runs first, so a model that changed its
 * head cannot have four probabilities silently read as five classes.
 */
export function mapClassProbabilities(
  probabilities: readonly number[],
  classNames: readonly string[]
): Record<string, number> {
  if (probabilities.length !== classNames.length) {
    throw new NsfwInferenceOutputError(
      `Model returned ${probabilities.length} probabilities for ${classNames.length} classes`
    )
  }
  const mapped: Record<string, number> = {}
  classNames.forEach((className, index) => {
    mapped[className] = probabilities[index] as number
  })
  return mapped
}

type GraphModel = { predict: (input: unknown) => unknown; dispose: () => void }

type TensorflowRuntime = {
  tf: typeof tfCore
  model: GraphModel
  manifest: NsfwModelManifest
  identity: NsfwRuntimeIdentity
}

let runtime: TensorflowRuntime | null = null

/**
 * Decodes to exactly the tensor the graph declares. Sharp is the deterministic
 * step: the same bytes produce the same 224x224x3 RGB buffer on every host, so
 * two runs of the same image cannot disagree about the probabilities. Alpha is
 * flattened onto black rather than dropped, because dropping the channel leaves
 * whatever RGB happened to sit under a fully transparent pixel.
 */
export async function decodeImageToPixels(imageBuffer: Buffer): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  try {
    const { data, info } = await sharp(imageBuffer)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize(NSFW_MODEL_INPUT_SIZE, NSFW_MODEL_INPUT_SIZE, { fit: 'fill' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (
      info.channels !== 3 ||
      info.width !== NSFW_MODEL_INPUT_SIZE ||
      info.height !== NSFW_MODEL_INPUT_SIZE
    ) {
      throw new NsfwImageDecodeError(
        `Decoded image is ${info.width}x${info.height}x${info.channels}, expected ${NSFW_MODEL_INPUT_SIZE}x${NSFW_MODEL_INPUT_SIZE}x3`
      )
    }
    return new Uint8Array(data)
  } catch (error) {
    if (error instanceof NsfwImageDecodeError) throw error
    throw new NsfwImageDecodeError('Community image could not be decoded for inference', {
      cause: error,
    })
  }
}

/**
 * The shape `nsfwjs/models/*` exports. Both members are async functions that
 * resolve to an ES module namespace, so the payload sits on `.default`:
 * `modelJson` yields the graph JSON and each `weightBundles` entry yields one
 * base64 string. Reading either without awaiting the call yields an object
 * whose only keys are `default` and `module.exports`.
 */
export interface NsfwModelDefinition {
  modelJson: () => Promise<{ default: Record<string, unknown> }>
  weightBundles: (() => Promise<{ default: string }>)[]
}

export function isModelDefinition(value: unknown): value is NsfwModelDefinition {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<NsfwModelDefinition>
  return (
    typeof candidate.modelJson === 'function' && Array.isArray(candidate.weightBundles)
  )
}

/**
 * Prefers the export the manifest names, then falls back to whichever export
 * is structurally a model definition. The fallback is what survives a rename
 * upstream; the manifest name is what makes the intent auditable.
 */
export function selectModelDefinition(
  moduleNamespace: Record<string, unknown>,
  manifest: NsfwModelManifest
): NsfwModelDefinition {
  const named = manifest.modelExport ? moduleNamespace[manifest.modelExport] : undefined
  if (isModelDefinition(named)) return named

  const structural = Object.values(moduleNamespace).find(isModelDefinition)
  if (structural) return structural

  throw new Error(`${manifest.modelSubpath} did not export a usable model definition`)
}

async function loadGraphModelFromPackage(
  manifest: NsfwModelManifest
): Promise<GraphModel> {
  const { loadGraphModel } = await import('@tensorflow/tfjs-converter')
  const moduleNamespace = (await import(manifest.modelSubpath)) as Record<string, unknown>
  const definition = selectModelDefinition(moduleNamespace, manifest)

  const modelJson = (await definition.modelJson()).default as {
    modelTopology?: unknown
    weightsManifest?: { paths: string[]; weights: unknown[] }[]
    format?: string
    generatedBy?: string
    convertedBy?: string
    userDefinedMetadata?: Record<string, unknown>
  }
  const weightsManifest = modelJson.weightsManifest
  if (!Array.isArray(weightsManifest) || weightsManifest.length === 0) {
    throw new Error('Bundled model.json declares no weights manifest')
  }

  // The bundles are base64 strings inside the package rather than binary shards
  // on disk, so the loader is an in-memory IOHandler. There is no `file://`
  // handler, no cache directory, and no URL for TensorFlow.js to fetch.
  const bundles = await Promise.all(
    definition.weightBundles.map(async (load) =>
      Buffer.from((await load()).default, 'base64')
    )
  )
  const weightSpecs = weightsManifest.flatMap((group) => group.weights)
  assertWeightBundlesMatchManifest(manifest, weightsManifest, bundles, weightSpecs.length)

  const weightData = Buffer.concat(bundles)
  const handler: tfCore.io.IOHandler = {
    load: () =>
      Promise.resolve({
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength
        ),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        userDefinedMetadata: modelJson.userDefinedMetadata,
      } as tfCore.io.ModelArtifacts),
  }

  return (await loadGraphModel(handler)) as unknown as GraphModel
}

/**
 * Checks the decoded bundles against what the manifest recorded. Hashing the
 * base64 files proves the bytes on disk; this proves the decode produced the
 * same weights, which catches a re-encoded or truncated bundle that would
 * otherwise reach `loadGraphModel` and fail somewhere less legible.
 */
export function assertWeightBundlesMatchManifest(
  manifest: NsfwModelManifest,
  weightsManifest: { paths: string[] }[],
  bundles: Buffer[],
  weightSpecCount: number
): void {
  const declaredPaths = weightsManifest.flatMap((group) => group.paths)
  if (declaredPaths.length !== bundles.length) {
    throw new Error(
      `Bundled model declares ${declaredPaths.length} weight paths but ships ${bundles.length} bundles`
    )
  }

  const expected = manifest.weightBundles
  if (!expected) return

  const pathsMatch =
    expected.manifestPaths.length === declaredPaths.length &&
    expected.manifestPaths.every((name, index) => declaredPaths[index] === name)
  if (!pathsMatch) {
    throw new Error(
      `Bundled weight paths [${declaredPaths.join(', ')}] do not match the manifest`
    )
  }
  if (expected.weightSpecCount !== weightSpecCount) {
    throw new Error(
      `Bundled model declares ${weightSpecCount} weight specs, manifest pins ${expected.weightSpecCount}`
    )
  }
  const bytesMatch =
    expected.decodedBytes.length === bundles.length &&
    expected.decodedBytes.every((size, index) => bundles[index]?.byteLength === size)
  if (!bytesMatch) {
    throw new Error(
      `Decoded weight bundle sizes [${bundles.map((b) => b.byteLength).join(', ')}] do not match the manifest`
    )
  }
}

export interface NsfwWorkerStartup {
  identity: NsfwRuntimeIdentity
  startupMs: number
  warmupMs: number
}

/**
 * Makes AC 1's "runtime inference performs zero network access" structural
 * rather than merely true. The model ships inside the package and the WASM
 * paths are absolute and hash-verified, so nothing in this thread has a
 * legitimate reason to open a socket; if some future dependency acquires one,
 * it fails here instead of silently reaching a network.
 *
 * It has to be installed inside the worker because a thread carries its own
 * globals: the `fetch` guard in `src/test-setup.ts` patches the supervisor
 * process and cannot see the thread where the model actually loads.
 */
export function forbidNetworkAccess(scope: { fetch?: unknown } = globalThis): void {
  const refuse = (target: string): never => {
    throw new Error(
      `Community NSFW inference attempted a network connection to ${target}; this process loads its model from the pinned package and must never reach a network`
    )
  }

  scope.fetch = (input: unknown): never =>
    refuse(
      typeof input === 'string' ? input : ((input as { url?: string })?.url ?? 'unknown')
    )

  // `fetch` alone is not the guarantee. A raw `net`, `tls`, `http` or `https`
  // client never goes near it, and every one of those ultimately calls
  // `net.Socket.prototype.connect`, so that is the single chokepoint worth
  // closing. Nothing in this thread has a legitimate socket to open: the model
  // and the WASM binaries are files inside pinned packages, and the only
  // channel out is the worker message port, which is not a socket.
  const net = require('node:net') as {
    Socket: { prototype: { connect: unknown } }
  }
  net.Socket.prototype.connect = function connect(...args: unknown[]): never {
    const [first] = args
    if (typeof first === 'object' && first !== null) {
      const options = first as { host?: string; port?: number; path?: string }
      return refuse(options.path ?? `${options.host ?? 'unknown'}:${options.port ?? ''}`)
    }
    return refuse(
      typeof first === 'number' ? String(first) : (first as string) || 'unknown'
    )
  }
}

export async function initializeInferenceWorker(
  manifestPath: string
): Promise<NsfwWorkerStartup> {
  const startedAt = Date.now()
  forbidNetworkAccess()
  const manifest = readModelManifest(manifestPath)
  const requireFrom = createRequire(__filename)

  // Each package root is resolved once. `modelSubpath` is the export the model
  // package publishes; every other package is resolved by its own name.
  const roots = new Map<string, string>()
  const rootFor = (packageName: string): string => {
    const cached = roots.get(packageName)
    if (cached) return cached
    const resolved = resolvePackageRoot(
      packageName,
      packageName === manifest.packageName ? manifest.modelSubpath : packageName,
      requireFrom
    )
    roots.set(packageName, resolved)
    return resolved
  }

  for (const file of manifest.modelFiles) {
    await verifyManifestFile(file, rootFor(file.package))
  }

  const wasmPaths: Record<string, string> = {}
  for (const file of manifest.wasmFiles) {
    wasmPaths[file.binaryName] = await verifyManifestFile(file, rootFor(file.package))
  }

  const policyPath = path.resolve(path.dirname(manifestPath), manifest.policy.path)
  const policyDigest = (await computeSha256(policyPath)).toLowerCase()
  if (policyDigest !== manifest.policy.sha256.toLowerCase()) {
    throw new Error(
      `Screening policy checksum mismatch: expected ${manifest.policy.sha256}, got ${policyDigest}`
    )
  }

  const { setWasmPaths } = await import('@tensorflow/tfjs-backend-wasm')
  // `false` keeps TensorFlow.js from treating the map as a URL prefix. The
  // paths are absolute and already hash-verified, and this process has no
  // remote fallback to fall back to.
  setWasmPaths(wasmPaths, false)

  const tf = await import('@tensorflow/tfjs-core')
  tf.enableProdMode()
  await tf.setBackend(manifest.backend)
  await tf.ready()
  const activeBackend = tf.getBackend()
  if (activeBackend !== manifest.backend) {
    throw new Error(
      `TensorFlow.js selected the ${activeBackend} backend, but the manifest pins ${manifest.backend}`
    )
  }

  const model = await loadGraphModelFromPackage(manifest)
  const identity: NsfwRuntimeIdentity = {
    modelFamily: manifest.modelFamily,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    modelDigest: deriveModelDigest(manifest.modelFiles),
    policyVersion: manifest.policy.version,
    policyDigest,
    backend: activeBackend,
    classNames: [...manifest.classNames],
    inputSize: manifest.inputWidth,
  }
  runtime = { tf, model, manifest, identity }

  const warmupStartedAt = Date.now()
  const warmupPixels = new Uint8Array(
    NSFW_MODEL_INPUT_SIZE * NSFW_MODEL_INPUT_SIZE * 3
  ).fill(128)
  // Validating the warmup output means an incompatible model head is a startup
  // failure rather than a first-submission failure in production.
  mapClassProbabilities(await classifyPixels(warmupPixels), identity.classNames)
  const warmupMs = Date.now() - warmupStartedAt

  return { identity, startupMs: Date.now() - startedAt, warmupMs }
}

export async function classifyPixels(pixels: Uint8Array): Promise<number[]> {
  const active = runtime
  if (!active) {
    throw new Error('NSFW inference worker is not initialized')
  }
  const { tf, model, manifest } = active
  const output = tf.tidy(() => {
    const input = tf.tensor3d(
      pixels,
      [NSFW_MODEL_INPUT_SIZE, NSFW_MODEL_INPUT_SIZE, 3],
      'int32'
    )
    // `tfjs-core` alone does not register the chained tensor API, so
    // `input.toFloat().div(255)` throws here. These are the free-function forms.
    const normalized = tf.div(tf.cast(input, 'float32'), tf.scalar(manifest.inputScale))
    const batched = tf.reshape(normalized, [
      1,
      NSFW_MODEL_INPUT_SIZE,
      NSFW_MODEL_INPUT_SIZE,
      3,
    ])
    return model.predict(batched) as tfCore.Tensor
  })
  try {
    return Array.from(await output.data())
  } finally {
    output.dispose()
  }
}

export async function runInferenceOnImage(imageBuffer: Buffer): Promise<number[]> {
  return classifyPixels(await decodeImageToPixels(imageBuffer))
}

export function disposeInferenceWorker(): void {
  runtime?.model.dispose()
  runtime = null
}

export function inferenceErrorCode(error: unknown): NsfwInferenceErrorCode {
  if (error instanceof NsfwInferenceOutputError) return 'NSFW_OUTPUT_INVALID'
  if (error instanceof NsfwImageDecodeError) return 'NSFW_IMAGE_DECODE_FAILED'
  return 'NSFW_INFERENCE_FAILED'
}

export function findManifestIn(directories: readonly string[]): string {
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue
    const entry = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith('community-nsfw-') && name.endsWith('.json'))
      .sort()[0]
    if (entry) return path.join(directory, entry)
  }
  throw new Error(`Community NSFW model manifest not found in: ${directories.join(', ')}`)
}

/** Both candidates exist because `__dirname` differs between `src` and `dist`. */
export function defaultManifestDirectories(fromDirectory: string): string[] {
  return [
    path.resolve(fromDirectory, '../../../model-manifests'),
    path.resolve(fromDirectory, '../../../../model-manifests'),
  ]
}

if (!isMainThread && parentPort) {
  const port = parentPort
  const data = workerData as { manifestPath?: string } | undefined
  const manifestPath = data?.manifestPath
    ? path.resolve(data.manifestPath)
    : findManifestIn(defaultManifestDirectories(__dirname))

  initializeInferenceWorker(manifestPath)
    .then(({ identity, startupMs, warmupMs }) => {
      const ready: NsfwInferenceResponse = {
        type: 'ready',
        identity,
        startupMs,
        warmupMs,
      }
      port.postMessage(ready)
    })
    .catch((error: unknown) => {
      const failure: NsfwInferenceResponse = {
        type: 'initialization_error',
        error:
          error instanceof Error
            ? error.message
            : 'NSFW inference worker initialization failed',
      }
      port.postMessage(failure)
      // Exiting in the same tick can win the race against the port flush and
      // cost the supervisor the specific cause, leaving it with the generic
      // "exited before ready" message. Both are fail-closed; only one is
      // diagnosable.
      setImmediate(() => process.exit(1))
    })

  // One inference at a time. Concurrency is added by running more worker
  // replicas, not by overlapping classifications inside one WASM backend.
  let queue = Promise.resolve()
  port.on('message', (message: NsfwInferenceRequest) => {
    if (!message?.id || !message.imageBuffer) return
    queue = queue.then(async () => {
      const startedInferenceAt = Date.now()
      try {
        const probabilities = await runInferenceOnImage(message.imageBuffer)
        const result: NsfwInferenceResponse = {
          type: 'result',
          id: message.id,
          classNames: runtime?.identity.classNames ?? [...NSFW_CLASS_NAMES],
          probabilities,
          inferenceMs: Date.now() - startedInferenceAt,
        }
        port.postMessage(result)
      } catch (error: unknown) {
        const failure: NsfwInferenceResponse = {
          type: 'error',
          id: message.id,
          error: error instanceof Error ? error.message : 'NSFW inference failed',
          code: inferenceErrorCode(error),
        }
        port.postMessage(failure)
      }
    })
    void queue
  })

  process.on('exit', disposeInferenceWorker)
}
