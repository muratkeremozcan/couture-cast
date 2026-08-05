import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

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
  !Array.isArray(manifest.files) ||
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

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const fileBuffer = fs.readFileSync(filePath)
  hash.update(fileBuffer)
  return hash.digest('hex')
}

async function verifyFiles() {
  let valid = true
  for (const fileSpec of manifest.files) {
    const fullPath = path.join(targetDir, fileSpec.path)
    if (!fs.existsSync(fullPath)) {
      console.error(`[Verify] Missing required file: ${fullPath}`)
      valid = false
      continue
    }
    if (fileSpec.sha256) {
      const actualHash = computeSha256(fullPath)
      if (actualHash.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
        console.error(
          `[Verify] Checksum mismatch for ${fileSpec.path}: expected ${fileSpec.sha256}, got ${actualHash}`
        )
        valid = false
      }
    }
  }
  return valid
}

async function downloadFile(fileSpec) {
  const fullPath = path.join(targetDir, fileSpec.path)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })

  const downloadUrl = `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${fileSpec.path}`
  console.log(`Downloading ${fileSpec.path} from ${downloadUrl}...`)

  const response = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'CoutureCast-Prepare-Script/1.0',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(
      `Failed to download ${fileSpec.path}: HTTP ${response.status} ${response.statusText}`
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(fullPath, buffer)

  if (fileSpec.sha256) {
    const actualHash = computeSha256(fullPath)
    if (actualHash.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
      fs.unlinkSync(fullPath)
      throw new Error(
        `Downloaded ${fileSpec.path} failed SHA-256 verification! Expected ${fileSpec.sha256}, got ${actualHash}`
      )
    }
  }
  console.log(`Successfully verified and saved ${fileSpec.path}`)
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
    const fullPath = path.join(targetDir, fileSpec.path)
    let needsDownload = !fs.existsSync(fullPath)

    if (!needsDownload && fileSpec.sha256) {
      const actualHash = computeSha256(fullPath)
      if (actualHash.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
        console.warn(`Re-downloading ${fileSpec.path} due to checksum mismatch.`)
        needsDownload = true
      }
    }

    if (needsDownload) {
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
