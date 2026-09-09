import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const EXPECTED_ANALYSIS_VERSION =
  'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1'
const DOWNLOAD_ATTEMPTS = 3
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000

const manifestPath = path.join(
  projectRoot,
  'apps/api/model-manifests/fashion-clip-7e3ba62.json'
)

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest file not found at ${manifestPath}`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (
  manifest.modelId !== 'patrickjohncyh/fashion-clip' ||
  manifest.revision !== '7e3ba62ce16b379a1ab479346b66f192e76f51b7' ||
  manifest.analysisVersion !== EXPECTED_ANALYSIS_VERSION ||
  !Array.isArray(manifest.files) ||
  manifest.files.length === 0 ||
  manifest.files.some(
    (fileSpec) =>
      fileSpec.required !== true ||
      typeof fileSpec.path !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(fileSpec.sha256 || '')
  )
) {
  console.error('Model manifest identity, required paths, or SHA-256 hashes are invalid.')
  process.exit(1)
}
const targetDir = path.resolve(
  process.env.GARMENT_TAGGING_MODEL_DIR ||
    path.join(projectRoot, 'apps/api/.cache/garment-tagging-model')
)

const isVerifyOnly = process.argv.includes('--verify-only')
fs.mkdirSync(targetDir, { recursive: true })
const canonicalTargetDir = fs.realpathSync(targetDir)

// Keep this streamed digest implementation aligned with
// apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts.
async function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function resolveTargetPath(fileSpec) {
  if (!fileSpec.path || path.isAbsolute(fileSpec.path) || fileSpec.path.includes('\0')) {
    throw new Error(`Unsafe model manifest path: ${String(fileSpec.path)}`)
  }
  const fullPath = path.resolve(targetDir, fileSpec.path)
  if (!fullPath.startsWith(`${targetDir}${path.sep}`)) {
    throw new Error(`Model manifest path escapes target directory: ${fileSpec.path}`)
  }
  return fullPath
}

async function validateFile(fileSpec) {
  const fullPath = resolveTargetPath(fileSpec)
  if (!fs.existsSync(fullPath)) {
    return { valid: false, fullPath, reason: 'missing' }
  }
  const canonicalFilePath = fs.realpathSync(fullPath)
  if (!canonicalFilePath.startsWith(`${canonicalTargetDir}${path.sep}`)) {
    return { valid: false, fullPath, reason: 'path_escape' }
  }
  const actualHash = await computeSha256(fullPath)
  if (actualHash.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
    return { valid: false, fullPath, reason: 'checksum', actualHash }
  }
  return { valid: true, fullPath, actualHash }
}

async function verifyFiles() {
  let valid = true
  for (const fileSpec of manifest.files) {
    const result = await validateFile(fileSpec)
    if (result.reason === 'missing') {
      console.error(`[Verify] Missing required file: ${result.fullPath}`)
      valid = false
      continue
    }
    if (!result.valid) {
      console.error(
        result.reason === 'path_escape'
          ? `[Verify] File escapes target directory: ${fileSpec.path}`
          : `[Verify] Checksum mismatch for ${fileSpec.path}: expected ${fileSpec.sha256}, got ${result.actualHash}`
      )
      valid = false
    }
  }
  return valid
}

async function downloadFile(fileSpec) {
  const fullPath = resolveTargetPath(fileSpec)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  const canonicalParent = fs.realpathSync(path.dirname(fullPath))
  if (
    canonicalParent !== canonicalTargetDir &&
    !canonicalParent.startsWith(`${canonicalTargetDir}${path.sep}`)
  ) {
    throw new Error(
      `Model manifest parent path escapes target directory: ${fileSpec.path}`
    )
  }

  const downloadUrl = `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${fileSpec.path}`
  let lastError
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    console.log(
      `Downloading ${fileSpec.path} from ${downloadUrl} (attempt ${attempt}/${DOWNLOAD_ATTEMPTS})...`
    )
    try {
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isSymbolicLink()) {
        fs.unlinkSync(fullPath)
      }
      // The budget is a STALL timeout, rearmed on every chunk, not a deadline for
      // the whole transfer. `onnx/model.onnx` is 605 MB, so a fixed 60-second
      // deadline needed roughly 80 Mbps sustained and otherwise aborted a perfectly
      // healthy download; that is why `test:tagging-model:smoke` could not run at
      // all on an ordinary connection. A stall timeout still fails fast on a dead
      // connection, which is the case the budget exists for.
      const controller = new AbortController()
      let stallTimer
      const rearmStallTimer = () => {
        clearTimeout(stallTimer)
        stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT_MS)
      }
      try {
        rearmStallTimer()
        const response = await fetch(downloadUrl, {
          headers: {
            'User-Agent': 'CoutureCast-Prepare-Script/1.0',
          },
          redirect: 'follow',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`)
        }
        if (!response.body) {
          throw new Error('Response carried no body to stream')
        }
        // Streamed rather than buffered: `arrayBuffer()` held the whole 605 MB in
        // memory before the first byte reached disk.
        const source = Readable.fromWeb(response.body)
        source.on('data', rearmStallTimer)
        await pipeline(source, fs.createWriteStream(fullPath))
      } finally {
        clearTimeout(stallTimer)
      }
      const validation = await validateFile(fileSpec)
      if (!validation.valid) {
        throw new Error(
          `SHA-256 verification failed: expected ${fileSpec.sha256}, got ${validation.actualHash ?? validation.reason}`
        )
      }
      console.log(`Successfully verified and saved ${fileSpec.path}`)
      return
    } catch (error) {
      lastError = error
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500))
      }
    }
  }
  throw new Error(
    `Failed to download ${fileSpec.path} after ${DOWNLOAD_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError }
  )
}

async function main() {
  console.log(`Target model directory: ${targetDir}`)

  const isCurrentlyValid = await verifyFiles()
  if (isCurrentlyValid) {
    console.log('✅ Model snapshot is present and verified.')
    process.exit(0)
  }

  if (isVerifyOnly) {
    console.error('❌ Model verification failed in --verify-only mode.')
    process.exit(1)
  }

  console.log('Preparing missing or unverified model files...')
  for (const fileSpec of manifest.files) {
    const validation = await validateFile(fileSpec)
    if (!validation.valid) {
      if (validation.reason !== 'missing') {
        console.warn(`Re-downloading ${fileSpec.path} due to ${validation.reason}.`)
      }
      await downloadFile(fileSpec)
    }
  }

  const finalCheck = await verifyFiles()
  if (!finalCheck) {
    console.error('❌ Model preparation failed verification after download.')
    process.exit(1)
  }

  console.log('✅ Model snapshot successfully prepared and verified.')
}

main().catch((err) => {
  console.error('Model preparation error:', err)
  process.exit(1)
})
