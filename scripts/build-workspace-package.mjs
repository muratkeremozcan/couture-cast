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
 * Builds of one package now take an exclusive lock (`.dist-build.lock`, created
 * with `wx`, holding the pid, start time and a token) and run one at a time. A
 * waiter reclaims a lock whose pid is gone, and fails naming the holder when a
 * live one keeps the lock past the wait bound. Each build also compiles into its
 * own `.dist-staging-<pid>-<random>` directory and removes only that one, plus
 * the staging directories of builds whose pid is gone.
 *
 * Usage, from the package directory:
 *   node ../../scripts/build-workspace-package.mjs [--tsc <command...>]
 * The default compiler is `npm exec --yes --package=typescript@5.9.3 -- tsc`.
 * `BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS` bounds the wait for the lock
 * (default 300000).
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIST = 'dist'
const STAGING_PREFIX = '.dist-staging-'
const LOCK = '.dist-build.lock'
const TSBUILDINFO = 'tsconfig.build.tsbuildinfo'
const DEFAULT_LOCK_WAIT_MS = 300_000
const LOCK_POLL_MS = 100
/** A lock file with no readable holder yet is one being written; older than this, it is debris. */
const UNREADABLE_LOCK_GRACE_MS = 5_000

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM'
  }
}

/**
 * @param {string} file
 * @returns {{ pid: number, startedAt: number, token: string } | undefined}
 */
function readHolder(file) {
  try {
    const holder = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof holder?.pid === 'number' ? holder : undefined
  } catch {
    return undefined
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Takes the package's build lock, waiting while a live build holds it. A lock
 * whose pid is gone (or that never got a readable holder) is reclaimed. Throws,
 * naming the holder, when a live one still holds it after `waitMs`.
 *
 * @param {{
 *   lockFile: string,
 *   waitMs?: number,
 *   log?: (message: string) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => void,
 * }} options
 * @returns {() => void} releases the lock, if it is still this build's
 */
export function acquireBuildLock({
  lockFile,
  waitMs = DEFAULT_LOCK_WAIT_MS,
  log = (message) => console.error(message),
  now = Date.now,
  sleep = sleepSync,
}) {
  const mine = { pid: process.pid, startedAt: now(), token: randomUUID() }
  const deadline = now() + waitMs
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      fs.writeSync(fd, JSON.stringify(mine))
      fs.closeSync(fd)
      return () => {
        if (readHolder(lockFile)?.token === mine.token)
          fs.rmSync(lockFile, { force: true })
      }
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error
    }
    const holder = readHolder(lockFile)
    let stale
    if (holder) stale = !pidAlive(holder.pid)
    else {
      let ageMs = 0
      try {
        ageMs = now() - fs.statSync(lockFile).mtimeMs
      } catch {
        continue // released meanwhile
      }
      stale = ageMs > UNREADABLE_LOCK_GRACE_MS
    }
    if (stale && reclaim(lockFile, holder)) {
      log(
        holder
          ? `Reclaimed the build lock of pid ${holder.pid}, which is no longer running`
          : 'Reclaimed a build lock that never named its holder'
      )
      continue
    }
    if (now() >= deadline) {
      const named = holder
        ? `live pid ${holder.pid} (held for ${Math.round((now() - holder.startedAt) / 1000)} s)`
        : 'a holder that has not written its pid yet'
      throw new Error(
        `The build lock ${path.resolve(lockFile)} is held by ${named}, still after ` +
          `${waitMs} ms; stop that build or remove the lock if it is not running`
      )
    }
    sleep(LOCK_POLL_MS)
  }
}

/**
 * Removes a stale lock, unless another waiter replaced it meanwhile: the lock is
 * moved aside in one step, and put back when what was moved is not the stale
 * holder that was judged.
 *
 * @param {string} lockFile
 * @param {{ token: string } | undefined} judged
 * @returns {boolean} whether the stale lock was removed
 */
function reclaim(lockFile, judged) {
  const aside = `${lockFile}.reclaim-${process.pid}-${randomUUID()}`
  try {
    fs.renameSync(lockFile, aside)
  } catch {
    return false // already gone or moved by another waiter
  }
  const moved = readHolder(aside)
  if (judged && moved?.token !== judged.token) {
    // Another waiter's fresh lock: hand it back, unless a third took the name.
    try {
      fs.linkSync(aside, lockFile)
    } catch {
      // The name is taken again; that build holds the lock now.
    }
    fs.rmSync(aside, { force: true })
    return false
  }
  fs.rmSync(aside, { force: true })
  return true
}

/**
 * Removes the staging directories of builds whose pid is gone. Called while
 * holding the lock, so no live build of this package is using one.
 *
 * @param {string} packageDir
 */
export function removeAbandonedStaging(packageDir) {
  for (const name of fs.readdirSync(packageDir)) {
    if (!name.startsWith(STAGING_PREFIX)) continue
    const pid = Number(name.slice(STAGING_PREFIX.length).split('-')[0])
    if (!pidAlive(pid))
      fs.rmSync(path.join(packageDir, name), { recursive: true, force: true })
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

/**
 * Moves every file of `staging` over its counterpart in `dist`, then deletes the
 * `dist` files the staging tree does not have, and the directories that leaves
 * empty. Each move is one rename, so no file of `dist` is ever absent or partial.
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
  for (const relative of fresh) {
    const target = path.join(dist, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(path.join(staging, relative), target)
  }
  const keep = new Set(fresh)
  const stale = filesUnder(dist).filter((relative) => !keep.has(relative))
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

const main = () => {
  const tscIndex = process.argv.indexOf('--tsc')
  const tsc =
    tscIndex === -1
      ? ['npm', 'exec', '--yes', '--package=typescript@5.9.3', '--', 'tsc']
      : process.argv.slice(tscIndex + 1)
  const waitMs = Number(
    process.env.BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS || DEFAULT_LOCK_WAIT_MS
  )
  let release
  try {
    release = acquireBuildLock({ lockFile: LOCK, waitMs })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  /** @type {string | undefined} */
  let staging
  // Runs on every exit path, process.exit included.
  process.on('exit', () => {
    if (staging) fs.rmSync(staging, { recursive: true, force: true })
    release()
  })
  removeAbandonedStaging('.')
  fs.rmSync(TSBUILDINFO, { force: true })
  staging = fs.mkdtempSync(`${STAGING_PREFIX}${process.pid}-`)
  const [command, ...args] = tsc
  const result = spawnSync(
    command,
    // Declarations follow too, for a package that sets its own declarationDir.
    [
      ...args,
      '-p',
      'tsconfig.build.json',
      '--outDir',
      staging,
      '--declarationDir',
      staging,
    ],
    { stdio: 'inherit' }
  )
  if (result.error) throw result.error
  // A failed compile leaves the last good `dist` in place.
  if (result.status !== 0) process.exit(result.status ?? 1)
  try {
    replaceDistFromStaging(staging, DIST)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main()
