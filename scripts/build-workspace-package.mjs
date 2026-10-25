#!/usr/bin/env node
/**
 * Builds a workspace package without its `dist` ever going missing.
 *
 * Story 6.7b R21 follow-up: the shared packages used to build with
 * `rm -rf dist tsconfig.build.tsbuildinfo && tsc -p tsconfig.build.json`, so for
 * the whole compile (one to three seconds) the package had no entry point. In a
 * checkout several agents share, `scripts/run-maestro.mjs` rebuilds
 * `@couture/utils`, `@couture/api-client` and `@couture/testing` on every start,
 * and anything importing them meanwhile failed: a helper spec run lost
 * `accessibility.spec.ts` to `Failed to resolve entry for package
 * "@couture/utils"` while `packages/utils/dist` was being rebuilt at 22:07:21.
 * A copy of that spec run against a looping rebuild failed 30 of 30 times.
 *
 * Here `tsc` compiles into a private staging directory next to `dist`
 * (`.dist-staging-<pid>-<random>`, with its own incremental state beside it), so
 * every build is a full one and no two builds share anything until they
 * publish. Publication renames each emitted file over its `dist` counterpart (a
 * same-filesystem rename replaces the old file in one step): first the files
 * `dist` does not have yet, then the ones it has, each group ordered so a module
 * (or a declaration file) comes after the ones it imports, and only then are
 * files the build no longer emits removed. A reader sees the old or the new
 * version of each file at every moment, and a just-published module finds what
 * it imports.
 *
 * A failed compile, or a staging directory that is missing or empty after it,
 * leaves `dist` untouched and fails the build (R23). The staging directory is
 * removed on every exit path.
 *
 * Story 6.7b R34 (decision D5): there is no build lock. Two concurrent builds of
 * one package compile into separate staging directories and, from the same
 * source, publish the same file set in the same order, so whichever publishes
 * last leaves a complete tree. Each tolerates the other pruning a stale
 * directory under it while it walks, prunes or publishes. The heartbeat lock of R24 to R32 is gone with its
 * dependency: it guarded nothing correctness needed and its lease checks failed
 * serial CI builds.
 *
 * Usage, from the package directory:
 *   node ../../scripts/build-workspace-package.mjs [--tsc <command...>]
 * The default compiler is `npm exec --yes --package=typescript@5.9.3 -- tsc`.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIST = 'dist'
const STAGING_PREFIX = '.dist-staging-'
/** The incremental state older versions kept beside `dist`; removed if present. */
const SHARED_TSBUILDINFO = 'tsconfig.build.tsbuildinfo'

/**
 * @param {unknown} error
 * @param {string[]} codes
 * @returns {boolean}
 */
const hasCode = (error, codes) =>
  error instanceof Error && 'code' in error && codes.includes(String(error.code))

/**
 * The entries of `directory`, or none when it is gone: a concurrent build of the
 * same package may prune a stale directory while this one walks `dist` (R34).
 *
 * @param {string} directory
 * @returns {fs.Dirent[]}
 */
function entriesOf(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (hasCode(error, ['ENOENT', 'ENOTDIR'])) return []
    throw error
  }
}

/**
 * Every file and directory under `root`, as paths relative to it, each
 * directory listed after the ones inside it.
 *
 * @param {string} root
 * @returns {{ files: string[], directories: string[] }}
 */
function walk(root) {
  const files = []
  const directories = []
  const visit = (relative) => {
    for (const entry of entriesOf(path.join(root, relative))) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) {
        visit(child)
        directories.push(child)
      } else if (entry.isFile()) files.push(child)
    }
  }
  visit('')
  return { files, directories }
}

/**
 * Every file under `root`, as paths relative to it.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function filesUnder(root) {
  return walk(root).files
}

/**
 * Renames `from` over `to`, creating its directory. A concurrent build that no
 * longer emits that directory may prune it between the two steps, so the pair
 * is retried a few times before the error is reported.
 *
 * @param {string} from
 * @param {string} to
 */
function publishFile(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(from, to)
      return
    } catch (error) {
      if (!hasCode(error, ['ENOENT']) || attempt === 3 || !fs.existsSync(from))
        throw error
    }
  }
}

/** Relative module specifiers in compiled JavaScript: import, export from, import(), require(). */
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

/**
 * Where a relative specifier written in `relative` can point among `files`: for
 * JavaScript the specifier as written, with `.js`, or `/index.js`; for a
 * declaration file the declaration of that module (`./x.js` and `./x` both
 * mean `./x.d.ts`, `./x.mjs` means `./x.d.mts`, `./x.cjs` means `./x.d.cts`).
 *
 * @param {string} relative
 * @param {string} base the specifier joined to the file's directory
 * @returns {string[]}
 */
function candidatesFor(relative, base) {
  if (!/\.d\.[cm]?ts$/.test(relative))
    return [base, `${base}.js`, path.join(base, 'index.js')]
  const stem = base.replace(/\.[cm]?js$/, '')
  const extension = base.endsWith('.mjs')
    ? '.d.mts'
    : base.endsWith('.cjs')
      ? '.d.cts'
      : '.d.ts'
  return [`${stem}${extension}`, path.join(stem, `index${extension}`)]
}

/**
 * The files of `files` that `relative` (JavaScript or a declaration file in
 * `root`) loads or imports types from by relative specifier.
 *
 * @param {string} root
 * @param {string} relative
 * @param {Set<string>} files
 * @returns {string[]}
 */
function localDependencies(root, relative, files) {
  if (!/\.[cm]?js$|\.d\.[cm]?ts$/.test(relative)) return []
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const found = []
  for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
    const base = path.normalize(path.join(path.dirname(relative), match[1] ?? ''))
    const target = candidatesFor(relative, base).find((candidate) => files.has(candidate))
    if (target) found.push(target)
  }
  return found
}

/**
 * `group` ordered so each file comes after the files of the group it loads, so
 * publishing in this order never puts a module in `dist` before what it imports.
 * Cycles are broken where they are entered.
 *
 * @param {string} root
 * @param {string[]} group
 * @returns {string[]}
 */
function dependenciesFirst(root, group) {
  const members = new Set(group)
  const ordered = []
  const state = new Map()
  const visit = (file) => {
    if (state.has(file)) return
    state.set(file, 'visiting')
    for (const dependency of localDependencies(root, file, members)) visit(dependency)
    state.set(file, 'done')
    ordered.push(file)
  }
  for (const file of [...group].sort()) visit(file)
  return ordered
}

/**
 * Publishes `staging` into `dist` one rename per file: first the files `dist`
 * does not have yet, then the ones it has, each group with every file
 * (JavaScript and declarations alike) after the files of that group it loads or
 * imports types from, and only then removes the `dist` files the new build no
 * longer emits, and the directories that leaves empty. A reader that loads a
 * just-published module finds every module it imports, old or new. Each rename
 * replaces one file in one step, so no file of `dist` is ever absent or partial.
 *
 * A missing or empty staging directory throws before `dist` is touched, so a
 * lost or empty compile prunes nothing and publishes nothing.
 *
 * @param {string} staging
 * @param {string} dist
 * @returns {{ moved: number, removed: number }}
 */
export function replaceDistFromStaging(staging, dist) {
  if (!fs.existsSync(staging)) {
    throw new Error(
      `The staging directory ${path.resolve(staging)} is missing after the compile, ` +
        'so dist is left as it was'
    )
  }
  const fresh = filesUnder(staging)
  if (fresh.length === 0) {
    throw new Error(
      `The compiler emitted nothing into ${path.resolve(staging)}, so dist is left as it was`
    )
  }
  const existing = new Set(filesUnder(dist))
  const added = dependenciesFirst(
    staging,
    fresh.filter((relative) => !existing.has(relative))
  )
  const replaced = dependenciesFirst(
    staging,
    fresh.filter((relative) => existing.has(relative))
  )
  for (const relative of [...added, ...replaced])
    publishFile(path.join(staging, relative), path.join(dist, relative))
  const keep = new Set(fresh)
  const stale = [...existing].filter((relative) => !keep.has(relative))
  for (const relative of stale) fs.rmSync(path.join(dist, relative), { force: true })
  // Inner directories come first, so a parent is empty by the time it is
  // checked. A concurrent build may have removed one already, or published into
  // one since it was found empty; either way it is left to that build.
  for (const relative of walk(dist).directories) {
    const directory = path.join(dist, relative)
    if (entriesOf(directory).length > 0) continue
    try {
      fs.rmdirSync(directory)
    } catch (error) {
      if (!hasCode(error, ['ENOENT', 'ENOTEMPTY', 'EEXIST'])) throw error
    }
  }
  fs.rmSync(staging, { recursive: true, force: true })
  return { moved: fresh.length, removed: stale.length }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<number>} the exit code, 1 for a signal or a spawn error
 */
const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', (error) => {
      console.error(`Could not start ${command}: ${error.message}`)
      resolve(1)
    })
    child.once('close', (code) => resolve(code ?? 1))
  })

/**
 * The whole build, as the CLI runs it, from the package directory.
 *
 * @param {{ argv?: string[] }} [options]
 * @returns {Promise<void>}
 */
export const runBuild = async ({ argv = process.argv } = {}) => {
  const tscIndex = argv.indexOf('--tsc')
  const [command, ...args] =
    tscIndex === -1
      ? ['npm', 'exec', '--yes', '--package=typescript@5.9.3', '--', 'tsc']
      : argv.slice(tscIndex + 1)
  fs.rmSync(SHARED_TSBUILDINFO, { force: true })
  const staging = fs.mkdtempSync(`${STAGING_PREFIX}${process.pid}-`)
  const tsbuildinfo = `${staging}.tsbuildinfo`
  try {
    const code = await run(command, [
      ...args,
      '-p',
      'tsconfig.build.json',
      '--outDir',
      staging,
      // Declarations follow too, for a package that sets its own declarationDir.
      '--declarationDir',
      staging,
      // Private incremental state, so concurrent builds never read each other's.
      '--tsBuildInfoFile',
      tsbuildinfo,
    ])
    // A failed compile leaves the last good `dist` in place.
    if (code !== 0) {
      process.exitCode = code
      return
    }
    replaceDistFromStaging(staging, DIST)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(tsbuildinfo, { force: true })
  }
}

// Compared by real path: run through a symlinked directory (macOS's /var is
// /private/var), the entry path and this module's URL differ, and a build that
// silently did nothing would exit 0.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href
)
  await runBuild()
