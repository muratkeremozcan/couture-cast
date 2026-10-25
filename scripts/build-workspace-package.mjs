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
 * Usage, from the package directory:
 *   node ../../scripts/build-workspace-package.mjs [--tsc <command...>]
 * The default compiler is `npm exec --yes --package=typescript@5.9.3 -- tsc`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIST = 'dist'
const STAGING = '.dist-staging'
const TSBUILDINFO = 'tsconfig.build.tsbuildinfo'

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
 * @param {string} staging
 * @param {string} dist
 * @returns {{ moved: number, removed: number }}
 */
export function replaceDistFromStaging(staging, dist) {
  const fresh = filesUnder(staging)
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
  fs.rmSync(TSBUILDINFO, { force: true })
  fs.rmSync(STAGING, { recursive: true, force: true })
  const [command, ...args] = tsc
  const result = spawnSync(
    command,
    // Declarations follow too, for a package that sets its own declarationDir.
    [
      ...args,
      '-p',
      'tsconfig.build.json',
      '--outDir',
      STAGING,
      '--declarationDir',
      STAGING,
    ],
    { stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    // A failed compile leaves the last good `dist` in place.
    fs.rmSync(STAGING, { recursive: true, force: true })
    process.exit(result.status ?? 1)
  }
  replaceDistFromStaging(STAGING, DIST)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main()
