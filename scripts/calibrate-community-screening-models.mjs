/*
 * Calibrates the community image policy across the three model families NSFWJS
 * ships, on the calibration half of the safe photograph corpus only.
 *
 * Story 6.2b follow-up. The holdout half is never read here: a threshold chosen
 * by looking at the photographs the release gate is computed on would make the
 * gate measure the tuning rather than the policy. This script picks a model and
 * a policy variant; the gated safe-corpus evaluation then reports that choice on
 * the holdout half through the production screener.
 *
 * Modes:
 *   --evaluate            classify every calibration photograph with each family,
 *                         score the policy variants, and write the run product
 *                         apps/api/.cache/community-screening/model-calibration.json
 *   --measure <family>    measure one family's cold load, warm latency and peak
 *                         resident set in this process (run it inside the
 *                         container under its memory limit), printed as JSON
 *
 * Every family is classified the way the production worker classifies:
 * the stored bytes go through the API's own declaration check and re-encode
 * (compiled `verifyAndNormalizeCommunityImage`), then sharp flattens alpha onto
 * black, fill-resizes to the model's input size, and the pixels are scaled by
 * 1/255 on the WASM backend.
 *
 * Policy variants, all holding the unsafe review and block thresholds at
 * today's values or stricter:
 *   current       Neutral > 0.85, Hentai + Porn < 0.10, each < 0.35, block
 *                 when Hentai or Porn > 0.35 (Sexy is bounded implicitly:
 *                 Neutral > 0.85 forces Sexy < 0.15)
 *   safe-mass@t   Neutral + Drawing > t, Hentai + Porn < 0.10, Sexy < 0.15,
 *                 Hentai + Porn + Sexy < 0.15 (the joint bound the original
 *                 Neutral floor implied), each unsafe class < 0.35, block when
 *                 Hentai or Porn > 0.35
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const requireFromApi = createRequire(pathToFileURL(path.join(projectRoot, 'apps/api/')))

/**
 * Where the TensorFlow.js packages and nsfwjs are resolved from. Two of the three
 * families (mobilenet_v2 and inception_v3) are Keras layers models and need
 * `@tensorflow/tfjs-layers`, which this repository's production tree does not
 * install. Evaluating them therefore uses a separate install outside the
 * repository, passed as `--tfjs-from <dir>`, holding the same pinned versions so
 * every family runs on one TensorFlow.js instance:
 *
 *   npm install --prefix <dir> --legacy-peer-deps @tensorflow/tfjs-core@4.16.0 \
 *     @tensorflow/tfjs-converter@4.16.0 @tensorflow/tfjs-backend-wasm@4.16.0 \
 *     @tensorflow/tfjs-layers@4.16.0 nsfwjs@4.3.0 sharp@0.35.4
 */
let requireTfjs = requireFromApi

export const FAMILIES = {
  mobilenet_v2: {
    subpath: 'nsfwjs/models/mobilenet_v2',
    exportName: 'MobileNetV2Model',
    format: 'layers',
  },
  mobilenet_v2_mid: {
    subpath: 'nsfwjs/models/mobilenet_v2_mid',
    exportName: 'MobileNetV2MidModel',
    format: 'graph',
  },
  inception_v3: {
    subpath: 'nsfwjs/models/inception_v3',
    exportName: 'InceptionV3Model',
    format: 'layers',
  },
}

const CLASS_NAMES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy']
const MANIFEST = 'apps/api/test/fixtures/community-safe-corpus/manifest.json'
const OUTPUT = 'apps/api/.cache/community-screening/model-calibration.json'

/** Today's values. A variant may tighten any of them and loosen none. */
export const UNSAFE_BOUNDS = {
  blockMinimum: 0.35,
  unsafeAggregateMaximum: 0.1,
  sexyPassMaximum: 0.15,
  // Hentai, Porn and Sexy together: the joint bound the original Neutral floor
  // implied, held so no variant publishes more unsafe mass than v1 did.
  jointMaximum: 0.15,
}
export const SAFE_MASS_GRID = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5]

/** The disposition a variant gives one probability vector. */
export function dispositionUnder(variant, p) {
  const unsafe = [p.Hentai, p.Porn]
  if (unsafe.some((score) => score > UNSAFE_BOUNDS.blockMinimum)) return 'block'
  const boundedUnsafe =
    unsafe[0] + unsafe[1] < UNSAFE_BOUNDS.unsafeAggregateMaximum &&
    unsafe.every((score) => score < UNSAFE_BOUNDS.blockMinimum) &&
    unsafe[0] + unsafe[1] + p.Sexy < UNSAFE_BOUNDS.jointMaximum
  if (!boundedUnsafe) return 'review'
  if (variant.kind === 'current') {
    return p.Neutral > 0.85 ? 'pass' : 'review'
  }
  const safeMass = p.Neutral + p.Drawing
  return safeMass > variant.safeMassMinimum && p.Sexy < UNSAFE_BOUNDS.sexyPassMaximum
    ? 'pass'
    : 'review'
}

export function policyVariants() {
  return [
    { id: 'current', kind: 'current' },
    ...SAFE_MASS_GRID.map((minimum) => ({
      id: `safe-mass@${minimum}`,
      kind: 'safe-mass',
      safeMassMinimum: minimum,
    })),
  ]
}

/** Withheld counts for every variant over one family's vectors. */
export function scoreVariants(vectors) {
  return policyVariants().map((variant) => {
    const counts = { pass: 0, review: 0, block: 0 }
    for (const vector of vectors) counts[dispositionUnder(variant, vector)] += 1
    const withheld = counts.review + counts.block
    return {
      ...variant,
      ...counts,
      withheld,
      withheldRate: vectors.length === 0 ? null : withheld / vectors.length,
    }
  })
}

/**
 * The lowest calibration withheld rate among the configurations that fit. Ties
 * go to the stricter threshold, then to the smaller model, so a flat region of
 * the grid never selects a looser policy than it needs.
 */
export function chooseConfiguration(byFamily, fits) {
  const candidates = []
  for (const [family, variants] of Object.entries(byFamily)) {
    if (!fits(family)) continue
    for (const variant of variants) candidates.push({ family, ...variant })
  }
  const strictness = (candidate) =>
    candidate.kind === 'current' ? 1 : (candidate.safeMassMinimum ?? 0)
  const sizeRank = { mobilenet_v2: 0, mobilenet_v2_mid: 1, inception_v3: 2 }
  return candidates.toSorted(
    (a, b) =>
      a.withheldRate - b.withheldRate ||
      strictness(b) - strictness(a) ||
      sizeRank[a.family] - sizeRank[b.family]
  )[0]
}

async function loadRuntime() {
  const wasmDir = path.join(
    path.dirname(requireTfjs.resolve('@tensorflow/tfjs-backend-wasm/package.json')),
    'dist'
  )
  const { setWasmPaths } = await import(
    pathToFileURL(requireTfjs.resolve('@tensorflow/tfjs-backend-wasm')).href
  )
  setWasmPaths(
    {
      'tfjs-backend-wasm.wasm': path.join(wasmDir, 'tfjs-backend-wasm.wasm'),
      'tfjs-backend-wasm-simd.wasm': path.join(wasmDir, 'tfjs-backend-wasm-simd.wasm'),
      'tfjs-backend-wasm-threaded-simd.wasm': path.join(
        wasmDir,
        'tfjs-backend-wasm-threaded-simd.wasm'
      ),
    },
    false
  )
  const tf = await import(
    pathToFileURL(requireTfjs.resolve('@tensorflow/tfjs-core')).href
  )
  const converter = await import(
    pathToFileURL(requireTfjs.resolve('@tensorflow/tfjs-converter')).href
  )
  let loadLayersModel = null
  try {
    loadLayersModel = (
      await import(pathToFileURL(requireTfjs.resolve('@tensorflow/tfjs-layers')).href)
    ).loadLayersModel
  } catch {
    // Not installed in the production tree; layers families are then unloadable.
  }
  tf.enableProdMode()
  await tf.setBackend('wasm')
  await tf.ready()
  const sharp = (await import(pathToFileURL(requireTfjs.resolve('sharp')).href)).default
  return { tf, loadGraphModel: converter.loadGraphModel, loadLayersModel, sharp }
}

async function loadFamily(runtime, family) {
  const { subpath, exportName, format } = FAMILIES[family]
  // The ESM build, as the production worker imports it. The CommonJS build of the
  // same bundles holds roughly 430 MB of heap while it loads them, which a 512 MiB
  // container's default heap limit cannot hold; the ESM build holds about 10 MB.
  const esmPath = path.join(
    path.resolve(path.dirname(requireTfjs.resolve(subpath)), '../../..'),
    'dist/esm/models',
    `${family}.js`
  )
  const definition = (await import(pathToFileURL(esmPath).href))[exportName]
  const loader = format === 'layers' ? runtime.loadLayersModel : runtime.loadGraphModel
  if (!loader) {
    throw new Error(
      `${family} is a layers model and @tensorflow/tfjs-layers is not installed`
    )
  }
  const modelJson = (await definition.modelJson()).default
  const bundles = await Promise.all(
    definition.weightBundles.map(async (load) =>
      Buffer.from((await load()).default, 'base64')
    )
  )
  const weightData = Buffer.concat(bundles)
  const model = await loader({
    load: () =>
      Promise.resolve({
        modelTopology: modelJson.modelTopology,
        weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength
        ),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
      }),
  })
  const inputSize = model.inputs[0].shape[1]
  return { model, inputSize }
}

async function classify(runtime, loaded, bytes) {
  const { data } = await runtime
    .sharp(bytes)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(loaded.inputSize, loaded.inputSize, { fit: 'fill' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { tf } = runtime
  const output = tf.tidy(() => {
    const input = tf.tensor3d(
      new Uint8Array(data),
      [loaded.inputSize, loaded.inputSize, 3],
      'int32'
    )
    const scaled = tf.div(tf.cast(input, 'float32'), tf.scalar(255))
    return loaded.model.predict(
      tf.reshape(scaled, [1, loaded.inputSize, loaded.inputSize, 3])
    )
  })
  const values = Array.from(await output.data())
  output.dispose()
  return Object.fromEntries(CLASS_NAMES.map((name, index) => [name, values[index]]))
}

function storeDirectory() {
  const base = process.env.COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR?.trim()
  return base
    ? path.resolve(base, 'safe-photographs-v1')
    : path.join(
        projectRoot,
        'apps/api/.cache/community-screening-corpus/safe-photographs-v1'
      )
}

function familyBytes(family) {
  // nsfwjs's exports map hides its package.json, so the root is found from a
  // published export: dist/cjs/models/<family>.js sits three levels below it.
  const root = path.resolve(
    path.dirname(requireTfjs.resolve(FAMILIES.mobilenet_v2.subpath)),
    '../../..'
  )
  const dir = path.join(root, 'dist/models', family)
  return fs
    .readdirSync(dir)
    .reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0)
}

async function evaluate(measurementsPath) {
  const manifestBytes = fs.readFileSync(path.join(projectRoot, MANIFEST))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const calibration = manifest.entries.filter((entry) => entry.split === 'calibration')
  if (calibration.length === 0)
    throw new Error('The manifest records no calibration half')

  const { verifyAndNormalizeCommunityImage } = await import(
    pathToFileURL(
      path.join(
        projectRoot,
        'apps/api/dist/src/modules/community/community-image-validation.js'
      )
    ).href
  )
  const store = storeDirectory()
  const normalized = []
  // A photograph the upload path refuses (too large, undecodable) could never
  // reach the screener, so it is recorded and left out, as the holdout
  // evaluation does.
  const validationRejected = []
  for (const entry of calibration) {
    const raw = fs.readFileSync(path.join(store, entry.file))
    try {
      const result = await verifyAndNormalizeCommunityImage(raw, {
        byteSize: raw.length,
        mimeType: entry.contentType,
        sha256: entry.sha256,
      })
      normalized.push({ id: entry.id, bytes: result.bytes })
    } catch (error) {
      if (typeof error?.code !== 'string' || !/ValidationError$/.test(error.name ?? '')) {
        throw error
      }
      validationRejected.push({ id: entry.id, code: error.code })
    }
  }

  const runtime = await loadRuntime()
  const vectors = {}
  for (const family of Object.keys(FAMILIES)) {
    const loaded = await loadFamily(runtime, family)
    vectors[family] = []
    for (const entry of normalized) {
      vectors[family].push({
        id: entry.id,
        ...(await classify(runtime, loaded, entry.bytes)),
      })
    }
    loaded.model.dispose()
  }

  const measurements = measurementsPath
    ? JSON.parse(fs.readFileSync(path.resolve(measurementsPath), 'utf8'))
    : {}
  const scores = Object.fromEntries(
    Object.entries(vectors).map(([family, list]) => [family, scoreVariants(list)])
  )
  const fits = (family) => {
    const measured = measurements[family]
    return (
      Boolean(measured) &&
      measured.peakResidentMib <= 512 &&
      measured.nodeModulesMb <= 150
    )
  }
  const chosen = chooseConfiguration(scores, fits)
  const { inputSetHash } = await import('./lib/community-screening-input-set.mjs')
  const report = {
    measuredAt: new Date().toISOString(),
    inputSetHash: inputSetHash(),
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    split: manifest.split,
    calibrationEntries: normalized.length,
    validationRejected,
    unsafeBounds: UNSAFE_BOUNDS,
    selectionRule:
      'lowest calibration withheld rate among families that fit 512 MiB peak RSS and the 150 MB node_modules budget; ties to the stricter threshold, then the smaller model',
    familyModelBytes: Object.fromEntries(
      Object.keys(FAMILIES).map((family) => [family, familyBytes(family)])
    ),
    measurements,
    scores,
    chosen,
    vectors,
  }
  fs.mkdirSync(path.dirname(path.join(projectRoot, OUTPUT)), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, OUTPUT), `${JSON.stringify(report, null, 2)}\n`)
  for (const [family, variants] of Object.entries(scores)) {
    const best = variants.toSorted((a, b) => a.withheldRate - b.withheldRate)[0]
    console.log(
      `${family}: current ${(variants[0].withheldRate * 100).toFixed(1)}%, best ${best.id} ${(best.withheldRate * 100).toFixed(1)}%${fits(family) ? '' : ' (does not fit or not measured)'}`
    )
  }
  console.log(
    `chosen: ${chosen ? `${chosen.family} ${chosen.id} at ${(chosen.withheldRate * 100).toFixed(1)}% on ${normalized.length} calibration photographs (${validationRejected.length} rejected by validation)` : 'none fits'}`
  )
}

const percentile = (sorted, fraction) =>
  sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  ]

async function measure(family, warm) {
  const baseline = process.memoryUsage().rss / 1048576
  const runtime = await loadRuntime()
  const startedAt = performance.now()
  const loaded = await loadFamily(runtime, family)
  const image = await runtime
    .sharp({ create: { width: 512, height: 640, channels: 3, background: '#beb4aa' } })
    .jpeg({ quality: 90 })
    .toBuffer()
  await classify(runtime, loaded, image)
  const coldStartupMs = performance.now() - startedAt
  for (let index = 0; index < 20; index += 1) await classify(runtime, loaded, image)
  const samples = []
  for (let index = 0; index < warm; index += 1) {
    const sampleStart = performance.now()
    await classify(runtime, loaded, image)
    samples.push(performance.now() - sampleStart)
  }
  samples.sort((a, b) => a - b)
  const round = (value) => Number(value.toFixed(1))
  console.log(
    JSON.stringify({
      family,
      inputSize: loaded.inputSize,
      modelBytes: familyBytes(family),
      coldStartupMs: round(coldStartupMs),
      warmSamples: warm,
      warmP50Ms: round(percentile(samples, 0.5)),
      warmP95Ms: round(percentile(samples, 0.95)),
      warmP99Ms: round(percentile(samples, 0.99)),
      peakResidentMib: round(process.resourceUsage().maxRSS / 1024),
      baselineResidentMib: round(baseline),
      cpuCount: os.cpus().length,
    })
  )
}

async function main() {
  const args = process.argv.slice(2)
  const tfjsFromIndex = args.indexOf('--tfjs-from')
  if (tfjsFromIndex >= 0) {
    requireTfjs = createRequire(
      pathToFileURL(`${path.resolve(args[tfjsFromIndex + 1])}/`)
    )
  }
  const measureIndex = args.indexOf('--measure')
  if (measureIndex >= 0) {
    const family = args[measureIndex + 1]
    if (!FAMILIES[family]) throw new Error(`Unknown family ${family}`)
    const warmIndex = args.indexOf('--warm')
    await measure(family, warmIndex >= 0 ? Number(args[warmIndex + 1]) : 200)
    return
  }
  const measurementsIndex = args.indexOf('--measurements')
  await evaluate(measurementsIndex >= 0 ? args[measurementsIndex + 1] : null)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[calibrate] ${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
}
