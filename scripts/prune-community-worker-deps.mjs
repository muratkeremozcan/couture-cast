/*
 * Assembles the community worker's runtime tree from a fully installed and built
 * checkout, keeping only what the compiled worker can actually load, and fails
 * when that tree outgrows the free-tier budget.
 *
 * Story 6.2b, Task 1. Runs inside the Docker build (apps/api/Dockerfile.community-worker);
 * it also runs locally against a built checkout, which is how the size gate is
 * checked before an image is built.
 *
 * WHY A TRACE AND NOT `npm ci --omit=dev`. The api workspace's production
 * dependencies serve the HTTP app, the general worker and the wardrobe worker as
 * well as this one. `@huggingface/transformers` alone pulls onnxruntime binaries
 * for every platform, and the OpenTelemetry auto-instrumentations pull dozens of
 * packages this process never imports. The community worker needs a small
 * fraction of that, and the budget below is what keeps the image inside a free
 * hosting tier, so the tree is derived from the worker's own import graph rather
 * than from a dependency list written for other processes.
 *
 * HOW. The compiled entrypoints are scanned for `require`, `import` and dynamic
 * `import()` specifiers. Relative specifiers are followed file by file; bare ones
 * name packages, and each package contributes its own declared `dependencies`
 * and installed `optionalDependencies` (sharp's platform binaries arrive that
 * way), plus its required peers, with one documented exclusion (see
 * `EXCLUDED_PEERS`).
 * A trace that missed something fails loudly, because the Docker build runs the
 * worker self-test against the pruned tree: it verifies the model artifacts,
 * loads the model, and screens an image.
 *
 * Usage:
 *   node scripts/prune-community-worker-deps.mjs --out <dir> [--max-node-modules-mb 150] [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

/**
 * The budget from Story 6.2b AC 1. Measured at 98 MB for the inference tree on
 * its own; the rest of the worker (Prisma, BullMQ, sharp, Supabase, pino) has to
 * fit in the remainder. A dependency change that pushes past it fails the build
 * instead of the bill.
 */
const DEFAULT_MAX_NODE_MODULES_MB = 150

/** Model families NSFWJS ships that this worker never loads. */
const UNUSED_NSFWJS_MODEL_FAMILIES = ['inception_v3', 'mobilenet_v2']

/**
 * Prisma ships a base64-embedded WASM query engine and query compiler for every
 * database provider, for edge runtimes and driver adapters. This worker runs the
 * native library engine on Node against PostgreSQL and loads none of them; they
 * are twenty files of 3.1 MB each, which is most of the budget on their own.
 */
const UNUSED_PRISMA_RUNTIME_FILE =
  /^(query_compiler_bg|query_engine_bg)\.[a-z]+\.wasm-base64\.m?js$/

/**
 * Every file the running container executes. The worker thread entry and the
 * TensorFlow screener are listed explicitly because they are reached through a
 * path string and a dynamic import respectively, which a static scan can miss.
 */
const ENTRY_FILES = [
  'apps/api/dist/src/workers/community.bootstrap.js',
  'apps/api/dist/src/modules/community/tensorflow-nsfw-image-screener.js',
  'apps/api/dist/src/modules/community/community-nsfw-inference.worker.js',
  'scripts/start-community-worker-production.mjs',
  'scripts/verify-community-screening-model.mjs',
  // Shipped so the runtime is measured inside the same image that runs it.
  'scripts/measure-community-worker-runtime.mjs',
]

const MODEL_MANIFEST =
  'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'

/** Non-code files the worker reads from disk at startup. */
const RUNTIME_DIRECTORIES = ['apps/api/policies', 'apps/api/model-manifests']
const RUNTIME_FILES = [
  'apps/api/package.json',
  // The model verification reads it to prove the union @tensorflow/tfjs package
  // stayed out of the dependency tree.
  'package-lock.json',
]

const SPECIFIER_PATTERNS = [
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
]

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

function parseArgs(argv) {
  const options = { out: null, maxMb: DEFAULT_MAX_NODE_MODULES_MB, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') options.out = argv[++index]
    else if (arg === '--max-node-modules-mb') options.maxMb = Number(argv[++index])
    else if (arg === '--json') options.json = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.out) throw new Error('--out <dir> is required')
  if (!Number.isFinite(options.maxMb) || options.maxMb <= 0) {
    throw new Error('--max-node-modules-mb must be a positive number')
  }
  return options
}

/**
 * Strips block and line comments before scanning. This repository documents its
 * code generously, and a comment that mentions `require('x')` must not pull a
 * package into the image.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function specifiersIn(filePath) {
  const source = stripComments(fs.readFileSync(filePath, 'utf8'))
  const found = new Set()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[1])
    }
  }
  return [...found]
}

function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function resolveRelativeFile(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
  ]
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  )
}

/** The api workspace's `imports` map, resolved through its `default` condition. */
function resolveSubpathImport(specifier) {
  const apiPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'apps/api/package.json'), 'utf8')
  )
  const target = apiPackage.imports?.[specifier]
  const relative = typeof target === 'string' ? target : target?.default
  if (!relative) throw new Error(`Unresolvable subpath import ${specifier}`)
  return path.resolve(projectRoot, 'apps/api', relative)
}

/**
 * Node's own lookup: the nearest `node_modules/<name>` walking up from the
 * requiring location. Done by hand rather than through `require.resolve`,
 * because several packages here publish an `exports` map that hides their
 * `package.json`, and the question is where the package lives, not which file a
 * particular specifier maps to.
 */
function findPackageDirectory(fromPath, name) {
  let current = fs.statSync(fromPath).isDirectory() ? fromPath : path.dirname(fromPath)
  for (;;) {
    const candidate = path.join(current, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function traceSourceGraph() {
  const files = new Set()
  const packages = new Map()
  const queue = ENTRY_FILES.map((entry) => path.join(projectRoot, entry))

  for (const entry of queue) {
    if (!fs.existsSync(entry)) {
      throw new Error(
        `Entry ${path.relative(projectRoot, entry)} is missing. Build the api workspace first.`
      )
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()
    if (files.has(file)) continue
    files.add(file)

    for (const specifier of specifiersIn(file)) {
      if (builtins.has(specifier) || builtins.has(packageNameOf(specifier))) continue
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeFile(file, specifier)
        if (resolved) queue.push(resolved)
        continue
      }
      if (specifier.startsWith('#')) {
        queue.push(resolveSubpathImport(specifier))
        continue
      }
      const name = packageNameOf(specifier)
      if (!packages.has(name)) packages.set(name, file)
    }
  }

  // The inference thread loads the model through `manifest.modelSubpath`, a
  // specifier read from the manifest at runtime that no static scan can see. The
  // manifest's own `dependencies` block is the declared runtime set of the model
  // process, so those packages seed the closure directly, resolved from the api
  // workspace the way the verifier resolves them.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, MODEL_MANIFEST), 'utf8')
  )
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!packages.has(name))
      packages.set(name, path.join(projectRoot, 'apps/api/package.json'))
  }
  return { files, packages }
}

/**
 * Peers a package cannot run without. `@nestjs/common` loads `reflect-metadata`
 * at import time and declares it only as a peer, so required peers are part of
 * the closure. Optional peers are not: they exist for features this worker does
 * not use. The one deliberate exclusion is nsfwjs's peer on the union
 * `@tensorflow/tfjs` package. This repository satisfies that edge with an alias
 * to tfjs-core so npm cannot install the union, and the worker never calls the
 * nsfwjs entry point that would load it: the inference thread loads the graph
 * itself through tfjs-converter. Carrying the alias would add a second 39 MB
 * copy of tfjs-core that nothing imports.
 *
 * ts-node's peers are the second. `@couture/api-client` lists ts-node as a
 * runtime dependency, and ts-node requires the TypeScript compiler as a peer, but
 * the worker executes compiled JavaScript only: the one place that would register
 * ts-node, the inference thread's `.ts` fallback, is refused when
 * NODE_ENV=production. The compiler alone is 20 MB.
 */
const EXCLUDED_PEERS = new Map([
  ['nsfwjs', new Set(['@tensorflow/tfjs'])],
  ['ts-node', new Set(['typescript', '@types/node'])],
])

function requiredPeers(manifest) {
  const optional = manifest.peerDependenciesMeta ?? {}
  const excluded = EXCLUDED_PEERS.get(manifest.name) ?? new Set()
  return Object.keys(manifest.peerDependencies ?? {}).filter(
    (peer) => optional[peer]?.optional !== true && !excluded.has(peer)
  )
}

/**
 * The package closure. Every package found by the source scan contributes its
 * declared `dependencies`, any `optionalDependencies` actually installed for this
 * platform, and its required peers.
 */
function closePackages(seedPackages) {
  const directories = new Map()
  const missing = []
  const queue = [...seedPackages].map(([name, from]) => ({ name, from }))

  while (queue.length > 0) {
    const { name, from } = queue.shift()
    const directory = findPackageDirectory(from, name)
    if (!directory) {
      missing.push({ name, requiredFrom: path.relative(projectRoot, from) })
      continue
    }
    const real = fs.realpathSync(directory)
    if (directories.has(real)) continue
    directories.set(real, { name, linkedAt: directory })

    const manifest = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'))
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dependency, from: real })
    }
    for (const optional of Object.keys(manifest.optionalDependencies ?? {})) {
      if (findPackageDirectory(real, optional)) queue.push({ name: optional, from: real })
    }
    for (const peer of requiredPeers(manifest)) {
      if (findPackageDirectory(real, peer)) queue.push({ name: peer, from: real })
    }
  }
  return { directories, missing }
}

const SKIPPED_FILE = /\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo|md|markdown)$/i
const KEPT_DOCUMENT = /^(licen[cs]e|notice|copying)/i

function shouldCopy(source) {
  const base = path.basename(source)
  if (KEPT_DOCUMENT.test(base)) return true
  return !SKIPPED_FILE.test(base)
}

/** Copies a directory tree, skipping nested `node_modules` (closed over separately). */
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(from)
      if (fs.statSync(real).isDirectory()) copyTree(real, to)
      else if (shouldCopy(real)) fs.copyFileSync(real, to)
    } else if (entry.isDirectory()) {
      copyTree(from, to)
    } else if (entry.isFile() && shouldCopy(from)) {
      fs.copyFileSync(from, to)
    }
  }
}

function copyFile(relativePath, outDir) {
  const destination = path.join(outDir, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(path.join(projectRoot, relativePath), destination)
}

function isWorkspacePackage(real) {
  const relative = path.relative(projectRoot, real)
  return !relative.split(path.sep).includes('node_modules')
}

function directorySize(directory) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) total += directorySize(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}

function nodeModulesDirectories(root) {
  const found = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(directory, entry.name)
      if (entry.name === 'node_modules') found.push(full)
      else walk(full)
    }
  }
  walk(root)
  return found
}

/** Written into every tree this script assembles; only such a tree may be replaced. */
const TREE_MARKER = '.community-worker-tree'

/**
 * Refuses an `--out` this script must never delete: the checkout, any directory
 * above it, a path inside the checkout outside its gitignored caches, or an
 * existing non-empty directory this script did not assemble. The assembly starts
 * with a recursive delete, so a mistyped `--out` would otherwise wipe it.
 */
export function outDirectoryRefusal(outDir, root = projectRoot) {
  const out = path.resolve(outDir)
  const relative = path.relative(out, root)
  if (
    out === root ||
    (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return `--out ${out} is the checkout or a directory above it`
  }
  const inside = path.relative(root, out)
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    const allowed = inside.split(path.sep).includes('.cache')
    if (!allowed)
      return `--out ${out} is inside the checkout; use a path under a .cache directory`
  }
  if (
    fs.existsSync(out) &&
    fs.readdirSync(out).length > 0 &&
    !fs.existsSync(path.join(out, TREE_MARKER))
  ) {
    return `--out ${out} is a non-empty directory this script did not assemble`
  }
  return null
}

function assemble(outDir) {
  const { files, packages } = traceSourceGraph()
  const { directories, missing } = closePackages(packages)
  if (missing.length > 0) {
    throw new Error(
      `Packages imported by the worker are not installed: ${missing
        .map((entry) => `${entry.name} (from ${entry.requiredFrom})`)
        .join(', ')}`
    )
  }

  const refusal = outDirectoryRefusal(outDir)
  if (refusal) throw new Error(refusal)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, TREE_MARKER),
    'assembled by scripts/prune-community-worker-deps.mjs\n'
  )

  // Compiled worker code: every traced file, not the whole dist tree.
  for (const file of files) {
    copyFile(path.relative(projectRoot, file), outDir)
  }
  for (const directory of RUNTIME_DIRECTORIES) {
    copyTree(path.join(projectRoot, directory), path.join(outDir, directory))
  }
  for (const file of RUNTIME_FILES) {
    copyFile(file, outDir)
  }
  // A root manifest so the ESM scripts and the workspace symlinks resolve the
  // way they do in the checkout. `private` stops anything publishing it.
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify({ name: 'couture-cast-community-worker', private: true }, null, 2)}\n`
  )

  const packageSummary = []
  for (const [real, { name, linkedAt }] of directories) {
    if (isWorkspacePackage(real)) {
      // Workspace packages ship their built output only; the symlink npm made
      // under node_modules is recreated so resolution matches the checkout.
      const relativeReal = path.relative(projectRoot, real)
      const destination = path.join(outDir, relativeReal)
      copyFile(path.join(relativeReal, 'package.json'), outDir)
      copyTree(path.join(real, 'dist'), path.join(destination, 'dist'))
      const linkRelative = path.relative(projectRoot, linkedAt)
      const linkPath = path.join(outDir, linkRelative)
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      fs.symlinkSync(path.relative(path.dirname(linkPath), destination), linkPath)
      packageSummary.push({ name, path: relativeReal, workspace: true })
      continue
    }
    const relative = path.relative(projectRoot, real)
    copyTree(real, path.join(outDir, relative))
    packageSummary.push({ name, path: relative, workspace: false })

    // Prisma's generated client lives beside @prisma/client, not inside it.
    if (name === '@prisma/client') {
      const generated = path.join(path.dirname(path.dirname(real)), '.prisma')
      if (!fs.existsSync(generated)) {
        throw new Error(
          'The generated Prisma client is missing. Run prisma generate first.'
        )
      }
      copyTree(generated, path.join(outDir, path.relative(projectRoot, generated)))
      const runtime = path.join(outDir, relative, 'runtime')
      for (const file of fs.readdirSync(runtime)) {
        if (UNUSED_PRISMA_RUNTIME_FILE.test(file)) fs.rmSync(path.join(runtime, file))
      }
    }
    if (name === 'nsfwjs') {
      for (const family of UNUSED_NSFWJS_MODEL_FAMILIES) {
        fs.rmSync(path.join(outDir, relative, 'dist', 'models', family), {
          recursive: true,
          force: true,
        })
      }
    }
  }

  return { files, packageSummary }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(options.out)
  const { files, packageSummary } = assemble(outDir)

  const sizes = nodeModulesDirectories(outDir).map((directory) => ({
    path: path.relative(outDir, directory),
    bytes: directorySize(directory),
  }))
  const totalBytes = sizes.reduce((sum, entry) => sum + entry.bytes, 0)
  const totalMb = totalBytes / 1_000_000
  const largest = packageSummary
    .filter((entry) => !entry.workspace)
    .map((entry) => ({
      name: entry.name,
      bytes: directorySize(path.join(outDir, entry.path)),
    }))
    .toSorted((a, b) => b.bytes - a.bytes)
    .slice(0, 12)

  const report = {
    outDir,
    tracedFiles: files.size,
    packages: packageSummary.length,
    nodeModulesMb: Number(totalMb.toFixed(1)),
    budgetMb: options.maxMb,
    withinBudget: totalMb <= options.maxMb,
    largestPackagesMb: largest.map((entry) => ({
      name: entry.name,
      mb: Number((entry.bytes / 1_000_000).toFixed(1)),
    })),
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(
      `[prune] ${report.tracedFiles} compiled files, ${report.packages} packages, node_modules ${report.nodeModulesMb} MB (budget ${report.budgetMb} MB)`
    )
    for (const entry of report.largestPackagesMb) {
      console.log(`[prune]   ${entry.mb.toFixed(1).padStart(6)} MB  ${entry.name}`)
    }
  }

  if (!report.withinBudget) {
    console.error(
      `[prune] node_modules is ${report.nodeModulesMb} MB, above the ${report.budgetMb} MB budget that keeps the worker inside a free hosting tier.`
    )
    process.exit(1)
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`[prune] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
