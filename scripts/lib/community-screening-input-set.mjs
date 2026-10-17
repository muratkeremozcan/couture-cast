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
 * Story 6.2b peer review (CX3): the worker also runs source that lives outside
 * those directories (the wardrobe image limits the community validation
 * imports, the logger, the telemetry service, the workspace packages). Listing
 * them by hand is how one was missed, so the set also carries the worker's own
 * repo-local import graph, traced from its entrypoints the way
 * `prune-community-worker-deps.mjs` traces the compiled tree, plus the Prisma
 * schema the generated client is built from.
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
  // The generated Prisma client the worker queries through is built from it.
  'packages/db/prisma/schema.prisma',
  // The CA the image verifies the hosted database against.
  'apps/api/certs/supabase-root-2021-ca.pem',
  'scripts/start-community-worker-production.mjs',
  'scripts/prune-community-worker-deps.mjs',
  'scripts/community-screening-canary.mjs',
  'scripts/measure-community-worker-runtime.mjs',
  'scripts/measure-community-worker-memory.mjs',
  'scripts/measure-community-worker-redis.mjs',
  'scripts/calibrate-community-screening-models.mjs',
  'scripts/verify-community-screening-model.mjs',
  'scripts/lib/community-screening-input-set.mjs',
  'scripts/lib/community-rollout-flags.mjs',
]

/**
 * The source of every file the worker container executes: the TypeScript the
 * compiled entrypoints in `prune-community-worker-deps.mjs` come from, and the
 * scripts it runs directly.
 */
export const WORKER_SOURCE_ENTRIES = [
  'apps/api/src/workers/community.bootstrap.ts',
  'apps/api/src/modules/community/tensorflow-nsfw-image-screener.ts',
  'apps/api/src/modules/community/community-nsfw-inference.worker.ts',
  'scripts/start-community-worker-production.mjs',
  'scripts/verify-community-screening-model.mjs',
  'scripts/measure-community-worker-runtime.mjs',
]

/** Workspace packages are repository source, built from `src` into `dist`. */
const WORKSPACE_SCOPE = '@couture/'

const SPECIFIER_PATTERNS = [
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
]

/** Comments mention specifiers freely; only code counts. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function specifiersIn(filePath) {
  const source = stripComments(fs.readFileSync(filePath, 'utf8'))
  const found = new Set()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1])
  }
  return [...found]
}

function isFile(candidate) {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
}

/** A relative specifier as TypeScript resolves it: `./x.js` names `./x.ts`. */
function resolveSourceFile(base) {
  const stem = base.replace(/\.(c|m)?js$/, '')
  return [
    base,
    `${stem}.ts`,
    `${stem}.mts`,
    `${stem}.cts`,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ].find(isFile)
}

/** The api workspace's `imports` map, through its `development` (source) condition. */
function resolveSubpathImport(root, specifier) {
  const apiPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8')
  )
  const target = apiPackage.imports?.[specifier]
  const relative = typeof target === 'string' ? target : target?.development
  return relative ? resolveSourceFile(path.resolve(root, 'apps/api', relative)) : null
}

/**
 * A workspace package specifier, mapped from the `dist` file its `exports` name to
 * the `src` file it is built from.
 */
function resolveWorkspaceImport(root, specifier) {
  const [scope, name, ...rest] = specifier.split('/')
  const directory = path.join(root, 'packages', name)
  const manifestPath = path.join(directory, 'package.json')
  if (`${scope}/` !== WORKSPACE_SCOPE || !isFile(manifestPath)) return null
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const subpath = rest.length > 0 ? `./${rest.join('/')}` : '.'
  const entry = manifest.exports?.[subpath]
  const built =
    typeof entry === 'string' ? entry : (entry?.default ?? entry?.require ?? null)
  if (!built) return null
  const source = built.replace(/^\.\/dist\//, './src/')
  return {
    manifest: manifestPath,
    file: resolveSourceFile(path.resolve(directory, source)),
  }
}

/**
 * Every repository file the worker's entrypoints reach through relative,
 * subpath and workspace imports, with the specifiers the trace could not place.
 * Third-party packages are covered by the lockfile.
 */
export function traceWorkerSourceGraph(root = PROJECT_ROOT) {
  const files = new Set()
  const unresolved = []
  const queue = WORKER_SOURCE_ENTRIES.map((entry) => path.join(root, entry))
  while (queue.length > 0) {
    const file = queue.shift()
    if (files.has(file)) continue
    if (!isFile(file)) {
      unresolved.push({ from: null, specifier: path.relative(root, file) })
      continue
    }
    files.add(file)
    for (const specifier of specifiersIn(file)) {
      let resolved = null
      if (specifier.startsWith('.')) {
        resolved = resolveSourceFile(path.resolve(path.dirname(file), specifier))
      } else if (specifier.startsWith('#')) {
        resolved = resolveSubpathImport(root, specifier)
      } else if (specifier.startsWith(WORKSPACE_SCOPE)) {
        const workspace = resolveWorkspaceImport(root, specifier)
        if (workspace) files.add(workspace.manifest)
        resolved = workspace?.file ?? null
      } else {
        continue
      }
      if (resolved) queue.push(resolved)
      else unresolved.push({ from: path.relative(root, file), specifier })
    }
  }
  return {
    files: [...files].map((file) => path.relative(root, file)).toSorted(),
    unresolved,
  }
}

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
    ...traceWorkerSourceGraph(root).files.map((file) => path.join(root, file)),
  ]
  return [...new Set(files.map((file) => path.relative(root, file)))].toSorted()
}

/**
 * Git pathspecs covering the input set, for comparing it between two commits.
 * The directories are named whole, so a file added or removed under them counts.
 */
export function inputSetPathspecs(root = PROJECT_ROOT) {
  return [
    ...new Set([
      ...INPUT_DIRECTORIES,
      ...INPUT_FILES,
      ...traceWorkerSourceGraph(root).files,
    ]),
  ].toSorted()
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
