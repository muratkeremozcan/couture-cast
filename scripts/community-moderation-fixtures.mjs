/*
 * Generates and verifies the synthetic safe image corpus that Story 6.2's
 * community screening evidence runs against.
 *
 * WHY THE CORPUS IS SYNTHETIC AND WHY IT IS ALL SAFE. No unsafe imagery may be
 * committed to this repository, so recall against real unsafe content is not
 * measurable here; Story 6.2b records that as an inherited limitation of the
 * upstream NSFWJS model. What this corpus does buy is the other half: it spans
 * the model's confidence range on safe input, so the disposition policy's pass
 * and review branches are both reachable without a single unsafe byte.
 *
 * The bands below were measured, not guessed. Each fixture's `neutralBand` is
 * design intent recorded at authoring time; the authoritative per-run numbers
 * live in _bmad-output/test-artifacts/community-content-screening-measurements.json,
 * labelled with the screening path that produced them. Keeping the measurement
 * out of the manifest is deliberate: the manifest is a supply-chain document
 * that a model upgrade must not silently falsify.
 *
 * Shape follows scripts/prepare-garment-tagging-model.mjs: verify against
 * committed SHA-256 hashes, report every failure rather than the first, and
 * exit nonzero on any of them.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const corpusDir = path.join(projectRoot, 'apps/api/test/fixtures/community-moderation/v1')
const manifestPath = path.join(corpusDir, 'manifest.json')

const CORPUS_ID = 'community-moderation-safe-v1'
const CORPUS_VERSION = 'v1'
const GENERATOR_SEED = 0x5eed

/*
 * Mirrored from apps/api/src/modules/community/community-image-validation.ts.
 * Duplicated rather than imported because this is a plain .mjs script outside
 * every tsconfig project, and because the corpus must fail loudly here if the
 * runtime bounds ever move away from what the committed bytes satisfy.
 */
const MIN_DIMENSION_PX = 256
const MAX_DIMENSION_PX = 4096
const MAX_BYTES = 10_485_760
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const CONTENT_TYPE_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Deterministic PRNG so a regenerated fixture is the same image. */
function mulberry32(seed) {
  let state = seed
  return function next() {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function noiseTable(seed) {
  const next = mulberry32(seed)
  return Array.from({ length: 4096 }, () => next())
}

function raster(width, height, shade) {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const channels = shade(x, y)
      const offset = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.max(0, Math.min(255, channels[channel]))
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

/*
 * Woven-textile patterns rather than abstract gradients. Fabric is what a
 * Community submission actually contains, and the model reads a flat gradient
 * very differently from a woven surface: the two lowest-confidence entries
 * below are both weaves, and no gradient reached that band.
 */
const PATTERNS = {
  'satin-plum': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x44)
    return raster(width, height, (x, y) => {
      const sheen = Math.pow(Math.abs(Math.sin(((x + y) / width) * Math.PI * 3)), 3)
      const jitter = noise[(y * 17 + x * 11) % 4096] * 10
      const value = 70 + sheen * 120 + jitter
      return [value * 1.15, value * 0.6, value]
    })
  },
  'linen-oat': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x55)
    return raster(width, height, (x, y) => {
      const warp = noise[(x * 31) % 4096] * 26
      const weft = noise[(y * 47) % 4096] * 26
      const value = 186 + warp - weft * 0.5
      return [value, value * 0.97, value * 0.88]
    })
  },
  'pinstripe-slate': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x66)
    return raster(width, height, (x, y) => {
      const stripe = x % 32 < 3 ? 210 : 62
      const jitter = noise[(y * 23 + x * 7) % 4096] * 14
      return [stripe * 0.9 + jitter, stripe * 0.94 + jitter, stripe * 1.05 + jitter]
    })
  },
  'check-navy': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x77)
    return raster(width, height, (x, y) => {
      const column = Math.floor(x / 64) % 2
      const row = Math.floor(y / 64) % 2
      const base = column === row ? 46 : 88
      const value = base + noise[(y * 71 + x * 23) % 4096] * 26
      return [value * 0.7, value * 0.8, value * 1.35]
    })
  },
  'knit-sage': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x88)
    return raster(width, height, (x, y) => {
      const rib = Math.abs(Math.sin((x / width) * Math.PI * 40))
      const loop = Math.abs(Math.sin((y / height) * Math.PI * 60))
      const value = 120 + rib * 35 + loop * 20 + noise[(y * 61 + x * 13) % 4096] * 18
      return [value * 0.82, value * 0.95, value * 0.8]
    })
  },
  'boucle-cream': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x22)
    return raster(width, height, (x, y) => {
      const nub = noise[(y * 7 + x * 3) % 4096]
      const slub = noise[(y * 101 + x * 61) % 4096]
      const value = 208 + nub * 34 - slub * 26
      return [value, value * 0.98, value * 0.92]
    })
  },
  'houndstooth-mono': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x11)
    return raster(width, height, (x, y) => {
      const column = Math.floor(x / 24) % 2
      const row = Math.floor(y / 24) % 2
      const step = (x + y) % 24 < 12 ? 1 : 0
      const base = column === row ? (step ? 235 : 30) : step ? 30 : 235
      const value = base + noise[(y * 43 + x * 19) % 4096] * 16
      return [value, value, value]
    })
  },
  'denim-indigo': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x99)
    return raster(width, height, (x, y) => {
      const warp = (x % 3 === 0 ? 1 : 0) * 22
      const weft = (y % 4 === 0 ? 1 : 0) * 12
      const value = 58 + warp + weft + noise[(y * 91 + x * 31) % 4096] * 24
      return [value * 0.62, value * 0.72, value * 1.3]
    })
  },
  'neutral-grey': (width, height) => raster(width, height, () => [128, 128, 128]),
  'corduroy-rust': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0x33)
    return raster(width, height, (x, y) => {
      const wale = Math.abs(Math.sin((x / width) * Math.PI * 24))
      const value = 96 + wale * 58 + noise[(y * 13 + x * 5) % 4096] * 20
      return [value * 1.4, value * 0.78, value * 0.5]
    })
  },
  'twill-charcoal': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0xaa)
    return raster(width, height, (x, y) => {
      const diagonal = ((x + y) % 8) / 8
      const value = 40 + diagonal * 55 + noise[(y * 37 + x * 17) % 4096] * 30
      return [value * 0.95, value * 0.97, value * 1.05]
    })
  },
  'herringbone-oat': (width, height) => {
    const noise = noiseTable(GENERATOR_SEED ^ 0xbb)
    return raster(width, height, (x, y) => {
      const band = Math.floor(y / 16) % 2
      const diagonal = band === 0 ? (x + y) % 12 : (x - y + width) % 12
      const value = 176 + (diagonal / 12) * 40 + noise[(y * 53 + x * 29) % 4096] * 22
      return [value, value * 0.96, value * 0.86]
    })
  },
}

/*
 * `neutralBand` records where the entry sat on the model's Neutral probability
 * when the corpus was authored: high is at or above 0.93, moderate is 0.85 up
 * to 0.93, low is below 0.85. The readiness suite asserts that every band is
 * non-empty, which is what stops an empty or single-branch corpus from passing.
 */
const CORPUS = [
  { pattern: 'satin-plum', format: 'jpeg', width: 512, height: 512, neutralBand: 'high' },
  { pattern: 'linen-oat', format: 'jpeg', width: 768, height: 512, neutralBand: 'high' },
  {
    pattern: 'pinstripe-slate',
    format: 'png',
    width: 512,
    height: 768,
    neutralBand: 'high',
  },
  // Measured at 0.9140, not the 0.9404 the same pattern reaches as JPEG. WebP's
  // re-encode moves it a full band, which is why the band recorded here is
  // taken from the committed bytes rather than from the pattern.
  {
    pattern: 'check-navy',
    format: 'webp',
    width: 512,
    height: 512,
    neutralBand: 'moderate',
  },
  { pattern: 'knit-sage', format: 'jpeg', width: 512, height: 512, neutralBand: 'high' },
  {
    pattern: 'boucle-cream',
    format: 'jpeg',
    width: 512,
    height: 512,
    neutralBand: 'high',
  },
  {
    pattern: 'houndstooth-mono',
    format: 'png',
    width: 512,
    height: 512,
    neutralBand: 'moderate',
  },
  {
    pattern: 'denim-indigo',
    format: 'jpeg',
    width: 512,
    height: 512,
    neutralBand: 'moderate',
  },
  // The minimum dimension the community validator accepts, so the corpus
  // carries that boundary rather than only comfortable sizes.
  {
    pattern: 'neutral-grey',
    format: 'png',
    width: MIN_DIMENSION_PX,
    height: MIN_DIMENSION_PX,
    neutralBand: 'moderate',
  },
  {
    pattern: 'corduroy-rust',
    format: 'webp',
    width: 512,
    height: 512,
    neutralBand: 'moderate',
  },
  {
    pattern: 'twill-charcoal',
    format: 'jpeg',
    width: 512,
    height: 512,
    neutralBand: 'low',
  },
  {
    pattern: 'herringbone-oat',
    format: 'jpeg',
    width: 512,
    height: 512,
    neutralBand: 'low',
  },
]

const REQUIRED_BANDS = ['high', 'moderate', 'low']

const EXTENSION_BY_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp' }

function fixtureFileName(entry) {
  return `safe-${entry.pattern}-${entry.width}x${entry.height}.${EXTENSION_BY_FORMAT[entry.format]}`
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

async function encode(entry) {
  const image = PATTERNS[entry.pattern](entry.width, entry.height)
  if (entry.format === 'jpeg') {
    return image.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer()
  }
  if (entry.format === 'webp') {
    return image.webp({ quality: 90 }).toBuffer()
  }
  return image.png({ compressionLevel: 9 }).toBuffer()
}

async function generate() {
  fs.mkdirSync(corpusDir, { recursive: true })
  const files = []

  for (const entry of CORPUS) {
    const fileName = fixtureFileName(entry)
    const bytes = await encode(entry)
    fs.writeFileSync(path.join(corpusDir, fileName), bytes)
    files.push({
      path: fileName,
      sha256: sha256(bytes),
      byteSize: bytes.length,
      contentType: CONTENT_TYPE_BY_FORMAT[entry.format],
      widthPx: entry.width,
      heightPx: entry.height,
      pattern: entry.pattern,
      neutralBand: entry.neutralBand,
      required: true,
    })
    console.log(`Generated ${fileName} (${bytes.length} bytes)`)
  }

  const manifest = {
    corpusId: CORPUS_ID,
    corpusVersion: CORPUS_VERSION,
    safetyClass: 'synthetic-safe',
    generator: {
      script: 'scripts/community-moderation-fixtures.mjs',
      seed: GENERATOR_SEED,
      encoder: 'sharp',
      note: 'Bytes are committed rather than rendered at test time. sharp output is deterministic for one libvips build but is not guaranteed byte-identical across versions, so the committed hashes are the authority.',
    },
    constraints: {
      minDimensionPx: MIN_DIMENSION_PX,
      maxDimensionPx: MAX_DIMENSION_PX,
      maxBytes: MAX_BYTES,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
    },
    requiredBands: REQUIRED_BANDS,
    files,
  }

  await writeJson(manifestPath, manifest)
  console.log(
    `Wrote ${path.relative(projectRoot, manifestPath)} with ${files.length} entries.`
  )
}

/*
 * _bmad-output and apps/api/test are both inside the repository prettier glob,
 * so a hand-serialised JSON file fails `npm run lint`: prettier collapses a
 * short array onto one line where JSON.stringify always expands it. Formatting
 * through prettier's own API is what keeps a generated artifact and the lint
 * gate from disagreeing.
 */
async function writeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(filePath)) ?? {}
  const formatted = await prettier.format(serialized, { ...options, parser: 'json' })
  fs.writeFileSync(filePath, formatted)
}

function readManifest(failures) {
  if (!fs.existsSync(manifestPath)) {
    failures.push(`Manifest file not found at ${manifestPath}`)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    failures.push(`Manifest is not valid JSON: ${error.message}`)
    return null
  }
}

function verifyManifestIdentity(manifest, failures) {
  if (
    manifest.corpusId !== CORPUS_ID ||
    manifest.corpusVersion !== CORPUS_VERSION ||
    manifest.safetyClass !== 'synthetic-safe' ||
    !Array.isArray(manifest.files)
  ) {
    failures.push('[Verify] Manifest identity or file list is invalid.')
    return false
  }
  // Non-vacuity. An empty corpus must never verify: it would make every
  // downstream branch-count assertion pass by having nothing to examine.
  if (manifest.files.length === 0) {
    failures.push('[Verify] Manifest declares an empty corpus.')
    return false
  }
  return true
}

function verifyEntryShape(fileSpec, index, failures) {
  if (
    typeof fileSpec.path !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(fileSpec.sha256 || '') ||
    !Number.isInteger(fileSpec.byteSize) ||
    !ALLOWED_CONTENT_TYPES.includes(fileSpec.contentType) ||
    !REQUIRED_BANDS.includes(fileSpec.neutralBand) ||
    fileSpec.required !== true
  ) {
    failures.push(`[Verify] Manifest entry ${index} is malformed.`)
    return false
  }
  if (fileSpec.path.includes('/') || fileSpec.path.includes('\0')) {
    failures.push(
      `[Verify] Manifest entry ${index} has an illegal path: ${fileSpec.path}`
    )
    return false
  }
  return true
}

async function verifyEntryBytes(fileSpec, failures) {
  const fullPath = path.join(corpusDir, fileSpec.path)
  if (!fs.existsSync(fullPath)) {
    failures.push(`[Verify] Missing required fixture: ${fullPath}`)
    return
  }

  const bytes = fs.readFileSync(fullPath)
  if (bytes.length === 0) {
    failures.push(`[Verify] Fixture is empty: ${fileSpec.path}`)
    return
  }

  const actual = sha256(bytes)
  if (actual.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
    failures.push(
      `[Verify] Checksum mismatch for ${fileSpec.path}: expected ${fileSpec.sha256}, got ${actual}`
    )
  }
  if (bytes.length !== fileSpec.byteSize) {
    failures.push(
      `[Verify] Byte size mismatch for ${fileSpec.path}: expected ${fileSpec.byteSize}, got ${bytes.length}`
    )
  }
  if (bytes.length > MAX_BYTES) {
    failures.push(`[Verify] Fixture exceeds the community byte ceiling: ${fileSpec.path}`)
  }

  const metadata = await sharp(bytes).metadata()
  if (metadata.width !== fileSpec.widthPx || metadata.height !== fileSpec.heightPx) {
    failures.push(
      `[Verify] Dimension mismatch for ${fileSpec.path}: manifest says ${fileSpec.widthPx}x${fileSpec.heightPx}, decoded ${metadata.width}x${metadata.height}`
    )
  }
  const smallest = Math.min(metadata.width ?? 0, metadata.height ?? 0)
  const largest = Math.max(metadata.width ?? 0, metadata.height ?? 0)
  if (smallest < MIN_DIMENSION_PX || largest > MAX_DIMENSION_PX) {
    failures.push(
      `[Verify] ${fileSpec.path} is outside the community dimension range ${MIN_DIMENSION_PX}..${MAX_DIMENSION_PX}`
    )
  }
  if (CONTENT_TYPE_BY_FORMAT[metadata.format] !== fileSpec.contentType) {
    failures.push(
      `[Verify] Content type mismatch for ${fileSpec.path}: manifest says ${fileSpec.contentType}, decoded ${metadata.format}`
    )
  }
}

function verifyCorpusInvariants(manifest, failures) {
  const seenHashes = new Map()
  const seenPaths = new Set()
  for (const fileSpec of manifest.files) {
    const hash = String(fileSpec.sha256).toLowerCase()
    // A duplicate hash means two entries are the same image under two names,
    // which silently halves the corpus while the count still looks right.
    if (seenHashes.has(hash)) {
      failures.push(
        `[Verify] Duplicate fixture content: ${fileSpec.path} has the same SHA-256 as ${seenHashes.get(hash)}`
      )
    }
    seenHashes.set(hash, fileSpec.path)
    if (seenPaths.has(fileSpec.path)) {
      failures.push(`[Verify] Duplicate manifest path: ${fileSpec.path}`)
    }
    seenPaths.add(fileSpec.path)
  }

  for (const band of REQUIRED_BANDS) {
    if (!manifest.files.some((fileSpec) => fileSpec.neutralBand === band)) {
      failures.push(`[Verify] No fixture covers the "${band}" Neutral confidence band.`)
    }
  }

  // An image on disk that the manifest does not pin is unverified content
  // sitting in a directory whose whole purpose is that everything is pinned.
  const onDisk = fs
    .readdirSync(corpusDir)
    .filter((name) => name !== 'manifest.json' && !name.startsWith('.'))
  for (const name of onDisk) {
    if (!seenPaths.has(name)) {
      failures.push(`[Verify] Unpinned file present in the corpus directory: ${name}`)
    }
  }
}

async function verify() {
  const failures = []
  const manifest = readManifest(failures)
  if (!manifest) return failures

  if (!verifyManifestIdentity(manifest, failures)) return failures

  for (const [index, fileSpec] of manifest.files.entries()) {
    if (!verifyEntryShape(fileSpec, index, failures)) continue
    try {
      await verifyEntryBytes(fileSpec, failures)
    } catch (error) {
      /*
       * An unreadable file or an undecodable image throws rather than returning,
       * and without this the exception escapes to the tail handler, which prints
       * one raw error and discards every failure collected so far. This file
       * promises to report all of them.
       */
      failures.push(
        `[Verify] ${fileSpec.path} could not be read or decoded: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  verifyCorpusInvariants(manifest, failures)
  return failures
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only')

  if (!verifyOnly) {
    await generate()
  }

  const failures = await verify()
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    console.error(
      `❌ Community moderation fixture verification failed with ${failures.length} problem(s).`
    )
    process.exit(1)
  }

  console.log('✅ Community moderation fixture corpus is present and verified.')
}

main().catch((error) => {
  console.error('Community moderation fixture error:', error)
  process.exit(1)
})
