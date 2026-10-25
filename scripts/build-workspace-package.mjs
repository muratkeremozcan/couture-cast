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
 * Here `tsc` compiles into a staging directory next to `dist`, every emitted
 * file is then renamed over its `dist` counterpart (a same-filesystem rename
 * replaces the old file in one step), and only then are files the build no
 * longer emits removed. A reader sees the old or the new version of each file,
 * at every moment. The incremental state is still deleted first, so every build
 * is a full one, as before.
 *
 * Story 6.7b R23: two builds of one package can overlap (two runners starting
 * together, a pre-hook inside another pre-hook). With one fixed staging
 * directory the second build deleted the first one's output mid-compile; the
 * first then pruned valid files from `dist` and the second crashed on ENOENT.
 * Builds of one package now run one at a time, each compiling into its own
 * `.dist-staging-<pid>-<random>` directory, and a missing or empty staging
 * directory publishes nothing.
 *
 * Story 6.7b R24: the lock is a heartbeat lock from `proper-lockfile`. It is a
 * directory (`.dist-build.lock`) made with an atomic `mkdir`; its holder
 * refreshes the directory's mtime every `stale / 2` ms, and a lock with no
 * refresh for `stale` ms counts as abandoned and is taken over. Liveness never
 * depends on a pid, so a reused pid, another host or a container cannot keep a
 * dead build's lock alive, and a live build compiling longer than `stale` keeps
 * its lock because it keeps refreshing it. The compile runs as an async child so
 * the refresh timer keeps running. A holder whose lock is compromised (a refresh
 * failed, or another build took the lock over) aborts without publishing, and
 * right before publishing every build checks the lock is still its own, by the
 * token it wrote to `.dist-build.lock.owner`. A displaced build discards its
 * staging and builds again (at most three displacements, then it fails naming
 * why), so a rare double takeover of an abandoned lock costs a rebuild and
 * never fails the npm hook that started the build.
 *
 * Usage, from the package directory:
 *   node ../../scripts/build-workspace-package.mjs [--tsc <command...>]
 * The default compiler is `npm exec --yes --package=typescript@5.9.3 -- tsc`.
 * `BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS` bounds the wait for the lock (default
 * 300000) and `BUILD_WORKSPACE_PACKAGE_LOCK_STALE_MS` sets the stale window
 * (default 10000, at least 2000, the minimum `proper-lockfile` accepts).
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { lock } from 'proper-lockfile'

const DIST = 'dist'
const STAGING_PREFIX = '.dist-staging-'
const LOCK = '.dist-build.lock'
const OWNER = `${LOCK}.owner`
const TSBUILDINFO = 'tsconfig.build.tsbuildinfo'
const DEFAULT_LOCK_WAIT_MS = 300_000
const DEFAULT_LOCK_STALE_MS = 10_000
const LOCK_POLL_MS = 100
/** A build displaced from its lock this many times gives up, naming why. */
const MAX_DISPLACEMENTS = 3

/**
 * Takes the package's heartbeat lock, waiting at most `waitMs` while another
 * build holds it. Throws, naming the lock, when it is still held after that.
 * `onCompromised` runs if this build loses the lock later.
 *
 * A plain file at the lock path is the pid lock of an earlier version of this
 * script; it carries no heartbeat, so once it is older than `staleMs` it is
 * removed, and until then it counts as held.
 *
 * @param {{
 *   packageDir: string,
 *   waitMs: number,
 *   staleMs: number,
 *   onCompromised: (error: Error) => void,
 * }} options
 * @returns {Promise<{ release: () => Promise<void>, token: string }>}
 */
export async function acquireBuildLock({ packageDir, waitMs, staleMs, onCompromised }) {
  const lockPath = path.join(packageDir, LOCK)
  const deadline = Date.now() + waitMs
  for (;;) {
    let legacy
    try {
      legacy = fs.statSync(lockPath)
    } catch {
      break
    }
    if (legacy.isDirectory()) break
    if (Date.now() - legacy.mtimeMs > staleMs) {
      fs.rmSync(lockPath, { force: true })
      break
    }
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
  }
  const token = randomUUID()
  const state = { holding: false }
  /**
   * `proper-lockfile` removes its directory on release and at process exit
   * without checking it still owns it. Once this build holds the lock, those
   * removals go ahead only while the owner record is still this build's, so a
   * build that lost the lock never deletes the lock of the build that took it.
   * Before that, the only removal is of an abandoned lock, which is allowed.
   */
  const guardedFs = Object.assign(Object.create(fs), {
    rmdir: (target, callback) => {
      if (state.holding && !ownsBuildLock(packageDir, token)) return callback(null)
      return fs.rmdir(target, callback)
    },
    rmdirSync: (target) => {
      if (state.holding && !ownsBuildLock(packageDir, token)) return undefined
      return fs.rmdirSync(target)
    },
  })
  let release
  try {
    release = await lock(packageDir, {
      fs: guardedFs,
      lockfilePath: lockPath,
      realpath: false,
      stale: staleMs,
      update: Math.floor(staleMs / 2),
      retries: {
        retries: Math.max(
          0,
          Math.ceil(Math.max(0, deadline - Date.now()) / LOCK_POLL_MS)
        ),
        factor: 1,
        minTimeout: LOCK_POLL_MS,
        maxTimeout: LOCK_POLL_MS,
      },
      onCompromised,
    })
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ELOCKED') throw error
    throw new Error(
      `The build lock ${path.resolve(lockPath)} is still held after ${waitMs} ms by a ` +
        `build that keeps it alive (its heartbeat is under ${staleMs} ms old); ` +
        'wait for that build or stop it'
    )
  }
  const owner = path.join(packageDir, OWNER)
  const temporary = `${owner}.${process.pid}.tmp`
  fs.writeFileSync(temporary, token)
  fs.renameSync(temporary, owner)
  state.holding = true
  return {
    token,
    release: async () => {
      const mine = ownsBuildLock(packageDir, token)
      try {
        // Stops the heartbeat; the guard keeps it from removing a lock not ours.
        await release()
      } catch {
        // Already released, or compromised and so released by proper-lockfile.
      }
      if (mine) fs.rmSync(owner, { force: true })
    },
  }
}

/**
 * Whether the lock is still this build's: the lock directory exists and the
 * owner record carries `token`. A build that took the lock over wrote its own.
 *
 * @param {string} packageDir
 * @param {string} token
 * @returns {boolean}
 */
export function ownsBuildLock(packageDir, token) {
  try {
    if (!fs.statSync(path.join(packageDir, LOCK)).isDirectory()) return false
    return fs.readFileSync(path.join(packageDir, OWNER), 'utf8') === token
  } catch {
    return false
  }
}

/**
 * Removes every staging directory but `keep`. Called while holding the lock, so
 * each other one belongs to a build that crashed or lost the lock.
 *
 * @param {string} packageDir
 * @param {string} [keep]
 */
export function removeAbandonedStaging(packageDir, keep) {
  for (const name of fs.readdirSync(packageDir)) {
    if (!name.startsWith(STAGING_PREFIX)) continue
    const full = path.join(packageDir, name)
    if (keep && path.resolve(full) === path.resolve(keep)) continue
    fs.rmSync(full, { recursive: true, force: true })
  }
}

/**
 * Every file under `root`, as paths relative to it.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function filesUnder(root) {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
}

/** Relative module specifiers in compiled JavaScript: import, export from, import(), require(). */
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

/**
 * The files of `files` that `relative` (a `.js`, `.cjs` or `.mjs` file in
 * `root`) loads by relative specifier, as written or with `.js` or `/index.js`.
 *
 * @param {string} root
 * @param {string} relative
 * @param {Set<string>} files
 * @returns {string[]}
 */
function localDependencies(root, relative, files) {
  if (!/\.[cm]?js$/.test(relative)) return []
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const found = []
  for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
    const base = path.normalize(path.join(path.dirname(relative), match[1] ?? ''))
    const target = [base, `${base}.js`, path.join(base, 'index.js')].find((candidate) =>
      files.has(candidate)
    )
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
 * Publishes `staging` into `dist` one rename per file, in an order a concurrent
 * reader can follow (R24): first the files `dist` does not have yet, then the
 * ones it has, each group with every file after the files of that group it
 * loads, and only then removes the `dist` files the new build no longer emits,
 * and the directories that leaves empty. A reader that loads a just-published
 * module finds every module it imports, old or new. Each rename replaces one
 * file in one step, so no file of `dist` is ever absent or partial.
 *
 * A missing or empty staging directory throws before `dist` is touched (R23),
 * so a lost or empty compile prunes nothing and publishes nothing.
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
  for (const relative of [...added, ...replaced]) {
    const target = path.join(dist, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(path.join(staging, relative), target)
  }
  const keep = new Set(fresh)
  const stale = [...existing].filter((relative) => !keep.has(relative))
  for (const relative of stale) fs.rmSync(path.join(dist, relative), { force: true })
  // Deepest first, so a parent is empty by the time it is checked.
  const directories = fs.existsSync(dist)
    ? fs
        .readdirSync(dist, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort((left, right) => right.length - left.length)
    : []
  for (const directory of directories) {
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
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

/** @param {string} message */
const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

const main = async () => {
  const tscIndex = process.argv.indexOf('--tsc')
  const tsc =
    tscIndex === -1
      ? ['npm', 'exec', '--yes', '--package=typescript@5.9.3', '--', 'tsc']
      : process.argv.slice(tscIndex + 1)
  const waitMs = Number(
    process.env.BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS || DEFAULT_LOCK_WAIT_MS
  )
  const staleMs = Number(
    process.env.BUILD_WORKSPACE_PACKAGE_LOCK_STALE_MS || DEFAULT_LOCK_STALE_MS
  )
  const [command, ...args] = tsc
  for (let displaced = 0; ; displaced += 1) {
    // eslint-disable-next-line no-await-in-loop -- one attempt at a time
    const outcome = await buildOnce({ command, args, waitMs, staleMs })
    if (outcome.kind === 'done') return
    if (displaced + 1 >= MAX_DISPLACEMENTS) {
      fail(
        `The build was displaced from its lock ${MAX_DISPLACEMENTS} times ` +
          `(last: ${outcome.reason}), so dist is left as the last complete build`
      )
      return
    }
    console.error(
      `The build lock was taken over during the compile (${outcome.reason}); ` +
        'discarding that compile and building again'
    )
  }
}

/**
 * One attempt: take the lock, compile into a fresh staging directory, and
 * publish only while the lock is still this build's. A displaced attempt (its
 * lock compromised, or taken over by another build) discards its staging and
 * publishes nothing, so the caller can build again.
 *
 * @param {{ command: string, args: string[], waitMs: number, staleMs: number }} options
 * @returns {Promise<{ kind: 'done' } | { kind: 'displaced', reason: string }>}
 */
async function buildOnce({ command, args, waitMs, staleMs }) {
  /** @type {Error | undefined} */
  let compromised
  let held
  try {
    held = await acquireBuildLock({
      packageDir: '.',
      waitMs,
      staleMs,
      onCompromised: (error) => {
        compromised = error
      },
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return { kind: 'done' }
  }
  const staging = fs.mkdtempSync(`${STAGING_PREFIX}${process.pid}-`)
  try {
    removeAbandonedStaging('.', staging)
    fs.rmSync(TSBUILDINFO, { force: true })
    const code = await run(command, [
      ...args,
      '-p',
      'tsconfig.build.json',
      '--outDir',
      staging,
      // Declarations follow too, for a package that sets its own declarationDir.
      '--declarationDir',
      staging,
    ])
    // Checked first: a build that took the lock over may have removed this
    // attempt's staging, which makes the compile itself fail.
    if (compromised || !ownsBuildLock('.', held.token)) {
      return {
        kind: 'displaced',
        reason: compromised?.message ?? 'another build took the lock over',
      }
    }
    // A failed compile leaves the last good `dist` in place.
    if (code !== 0) {
      process.exitCode = code
      return { kind: 'done' }
    }
    try {
      replaceDistFromStaging(staging, DIST)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    return { kind: 'done' }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
    await held.release()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main()
