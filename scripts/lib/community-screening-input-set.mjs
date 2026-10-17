/*
 * The input set every community screening run product is measured against.
 *
 * Story 6.2b review (BH20, EC11, EC12): a run product is evidence only for the
 * inputs that produced it. Each product records the hash this module computes,
 * and the readiness generator recomputes it and reports a product whose hash no
 * longer matches as not run. The set covers the screening and worker sources,
 * the policy, lists and manifests, every corpus and fixture, the Dockerfile, the
 * lockfile and the scripts that produce the measurements.
 *
 * Run directly, it prints the hash, which the image build passes in as a build
 * argument so the image itself records the inputs it was built from.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '../..')

export const INPUT_DIRECTORIES = [
  'apps/api/src/modules/community',
  'apps/api/src/workers',
  'apps/api/src/config',
  'apps/api/policies/community-screening',
  'apps/api/model-manifests',
  'apps/api/test/community-screening',
  'apps/api/test/fixtures/community-moderation',
  'apps/api/test/fixtures/community-safe-corpus',
  'apps/api/test/fixtures/community-text-corpus',
]

export const INPUT_FILES = [
  'apps/api/Dockerfile.community-worker',
  'apps/api/package.json',
  'package-lock.json',
  '.dockerignore',
  'scripts/start-community-worker-production.mjs',
  'scripts/prune-community-worker-deps.mjs',
  'scripts/community-screening-canary.mjs',
  'scripts/measure-community-worker-runtime.mjs',
  'scripts/measure-community-worker-memory.mjs',
  'scripts/measure-community-worker-redis.mjs',
  'scripts/calibrate-community-screening-models.mjs',
  'scripts/verify-community-screening-model.mjs',
  'scripts/lib/community-screening-input-set.mjs',
]

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() ? [full] : []
  })
}

/** The sorted repository-relative paths in the input set. */
export function inputSetFiles(root = PROJECT_ROOT) {
  const files = [
    ...INPUT_DIRECTORIES.flatMap((directory) => walk(path.join(root, directory))),
    ...INPUT_FILES.map((file) => path.join(root, file)).filter((file) =>
      fs.existsSync(file)
    ),
  ]
  return [...new Set(files.map((file) => path.relative(root, file)))].toSorted()
}

/** One SHA-256 over every input file's path and content hash. */
export function inputSetHash(root = PROJECT_ROOT) {
  const hash = crypto.createHash('sha256')
  for (const file of inputSetFiles(root)) {
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, file)))
      .digest('hex')
    hash.update(`${file}\0${digest}\n`)
  }
  return hash.digest('hex')
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  console.log(inputSetHash())
}
