/*
 * Assembles the hosted wardrobe worker's runtime tree from a fully installed and built checkout,
 * keeping only what the compiled worker can load, and fails when that tree outgrows its budget.
 *
 * Runs inside the Docker build (apps/api/Dockerfile.wardrobe-worker); it also runs locally against
 * a built checkout, which is how the size gate is checked before an image is built.
 *
 * WHY A TRACE. The api workspace's production dependencies serve the HTTP app, the general worker,
 * the community worker and the model-capable wardrobe worker. `@huggingface/transformers` pulls
 * onnxruntime binaries for every platform and the OpenTelemetry auto-instrumentations pull dozens
 * of packages; this worker runs with `GARMENT_TAGGING_ENGINE=manual` and imports none of them. The
 * tree is derived from its own import graph, so none of them can arrive by accident, and the
 * budget turns a dependency that would break the free service's envelope into a failed build.
 *
 * This is the same technique as `prune-community-worker-deps.mjs`, with the wardrobe worker's
 * entrypoints and without the screening model. That script and everything its image hash covers
 * stay untouched: its output feeds the community readiness evidence.
 *
 * HOW. The compiled entrypoints are scanned for `require`, `import` and dynamic `import()`
 * specifiers. Relative ones are followed file by file; bare ones name packages, and each package
 * contributes its declared `dependencies`, its installed `optionalDependencies` (sharp's platform
 * binary arrives that way) and its required peers. A trace that missed something fails loudly,
 * because the Docker build runs the launcher's self-test against the pruned tree.
 *
 * Usage:
 *   node scripts/prune-wardrobe-worker-deps.mjs --out <dir> [--max-node-modules-mb 150] [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

/** Budget for `node_modules` in the image: Prisma, BullMQ, sharp, Supabase and pino, no model. */
export const DEFAULT_MAX_NODE_MODULES_MB = 150

/** Packages that mean a model or the OpenTelemetry SDK reached this worker; the build fails. */
export const FORBIDDEN_PACKAGES = [
  '@huggingface/transformers',
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  '@tensorflow/tfjs-core',
  '@tensorflow/tfjs-converter',
  'nsfwjs',
  '@opentelemetry/sdk-node',
  '@opentelemetry/auto-instrumentations-node',
]

/**
 * Prisma ships a base64-embedded WASM query engine and query compiler for every database
 * provider, for edge runtimes and driver adapters. This worker runs the native library engine on
 * Node against PostgreSQL and loads none of them.
 */
const UNUSED_PRISMA_RUNTIME_FILE =
  /^(query_compiler_bg|query_engine_bg)\.[a-z]+\.wasm-base64\.m?js$/

/**
 * Every file the running container executes. The community launcher is listed because the
 * wardrobe launcher imports its database TLS refusal, so the two hosted workers refuse the same
 * unverified `DATABASE_URL` from one definition.
 */
export const ENTRY_FILES = [
  'apps/api/dist/src/workers/wardrobe.bootstrap.js',
  'scripts/start-wardrobe-worker-production.mjs',
  'scripts/start-community-worker-production.mjs',
]

/** Non-code files the worker reads from disk at startup. */
const RUNTIME_FILES = ['apps/api/package.json']

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

/** A comment that mentions `require('x')` must not pull a package into the image. */
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

/** Node's own lookup: the nearest `node_modules/<name>` walking up from the requiring location. */
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
  return { files, packages }
}

/**
 * Peers a package cannot run without. `@nestjs/common` loads `reflect-metadata` at import time and
 * declares it only as a peer. Optional peers are not followed. ts-node's peers are excluded:
 * `@couture/api-client` lists ts-node as a runtime dependency, and the worker executes compiled
 * JavaScript only, so the 20 MB TypeScript compiler would ship for nothing.
 */
const EXCLUDED_PEERS = new Map([['ts-node', new Set(['typescript', '@types/node'])]])

function requiredPeers(manifest) {
  const optional = manifest.peerDependenciesMeta ?? {}
  const excluded = EXCLUDED_PEERS.get(manifest.name) ?? new Set()
  return Object.keys(manifest.peerDependencies ?? {}).filter(
    (peer) => optional[peer]?.optional !== true && !excluded.has(peer)
  )
}

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

/** The forbidden packages a closure contains. */
export function forbiddenPackagesIn(names) {
  const present = new Set(names)
  return FORBIDDEN_PACKAGES.filter((name) => present.has(name))
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
const TREE_MARKER = '.wardrobe-worker-tree'

/**
 * Refuses an `--out` this script must never delete: the checkout, any directory above it, a path
 * inside the checkout outside its gitignored caches, or an existing non-empty directory this
 * script did not assemble. The assembly starts with a recursive delete.
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
  const forbidden = forbiddenPackagesIn(
    [...directories.values()].map((entry) => entry.name)
  )
  if (forbidden.length > 0) {
    throw new Error(
      `The wardrobe worker's closure reaches ${forbidden.join(', ')}: the model-free image must not carry a model runtime. Find the static import that pulls it in.`
    )
  }

  const refusal = outDirectoryRefusal(outDir)
  if (refusal) throw new Error(refusal)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, TREE_MARKER),
    'assembled by scripts/prune-wardrobe-worker-deps.mjs\n'
  )

  for (const file of files) copyFile(path.relative(projectRoot, file), outDir)
  for (const file of RUNTIME_FILES) copyFile(file, outDir)
  // A root manifest so the ESM scripts and the workspace symlinks resolve the way they do in the
  // checkout. `private` stops anything publishing it.
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify({ name: 'couture-cast-wardrobe-worker', private: true }, null, 2)}\n`
  )

  const packageSummary = []
  for (const [real, { name, linkedAt }] of directories) {
    if (isWorkspacePackage(real)) {
      // Workspace packages ship their built output only; the symlink npm made under
      // node_modules is recreated so resolution matches the checkout.
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
  const totalMb = sizes.reduce((sum, entry) => sum + entry.bytes, 0) / 1_000_000
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
      `[prune] node_modules is ${report.nodeModulesMb} MB, above the ${report.budgetMb} MB budget that keeps the worker inside the free hosting tier.`
    )
    process.exit(1)
  }
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`[prune] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
