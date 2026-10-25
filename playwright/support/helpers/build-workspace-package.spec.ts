/**
 * Story 6.7b R21 follow-up: a shared package rebuild never leaves its `dist` without an
 * entry point, so a reader in the same checkout sees the old or the new build at
 * every moment. See scripts/build-workspace-package.mjs.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { replaceDistFromStaging } from '../../../scripts/build-workspace-package.mjs'

const SCRIPT = path.resolve('scripts/build-workspace-package.mjs')

/**
 * A stand-in for `tsc -p tsconfig.build.json --outDir <dir>`: while it "compiles"
 * it records whether the package entry point is still there for a reader, then
 * writes the new build, or exits 2 like a failed compile.
 */
const FAKE_TSC = `
const fs = require('node:fs')
const path = require('node:path')
const outDir = process.argv[process.argv.indexOf('--outDir') + 1]
fs.appendFileSync('reads.log', (fs.existsSync('dist/index.js') ? fs.readFileSync('dist/index.js', 'utf8') : 'MISSING') + '\\n')
if (process.env.FAKE_TSC_FAIL === '1') process.exit(2)
fs.mkdirSync(path.join(outDir, 'nested'), { recursive: true })
fs.writeFileSync(path.join(outDir, 'index.js'), 'new entry')
fs.writeFileSync(path.join(outDir, 'nested', 'kept.js'), 'new kept')
`

let directory: string | undefined
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

/** A package directory with an earlier build in `dist`. */
function fakePackage() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r21f-package-'))
  const root = directory
  fs.mkdirSync(path.join(root, 'dist', 'nested'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist', 'gone'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist', 'index.js'), 'old entry')
  fs.writeFileSync(path.join(root, 'dist', 'nested', 'kept.js'), 'old kept')
  fs.writeFileSync(path.join(root, 'dist', 'gone', 'stale.js'), 'stale')
  fs.writeFileSync(path.join(root, 'tsconfig.build.tsbuildinfo'), '{}')
  fs.writeFileSync(path.join(root, 'fake-tsc.cjs'), FAKE_TSC)
  return root
}

const build = (root: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [SCRIPT, '--tsc', process.execPath, 'fake-tsc.cjs'], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

describe('workspace package build', () => {
  it('6.7b-R21F-01 keeps the old entry point readable for the whole compile, then swaps in the new build', () => {
    const root = fakePackage()
    expect(build(root).status).toBe(0)
    // The reader during the compile found the old build, never a missing one.
    expect(fs.readFileSync(path.join(root, 'reads.log'), 'utf8')).toBe('old entry\n')
    expect(fs.readFileSync(path.join(root, 'dist', 'index.js'), 'utf8')).toBe('new entry')
    expect(fs.readFileSync(path.join(root, 'dist', 'nested', 'kept.js'), 'utf8')).toBe(
      'new kept'
    )
    // What the build no longer emits is gone, the empty directory with it.
    expect(fs.existsSync(path.join(root, 'dist', 'gone'))).toBe(false)
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.dist-'))).toEqual([])
    // Every build is still a full one.
    expect(fs.existsSync(path.join(root, 'tsconfig.build.tsbuildinfo'))).toBe(false)
  })

  it('6.7b-R21F-02 leaves the last good build in place when the compile fails', () => {
    const root = fakePackage()
    expect(build(root, { FAKE_TSC_FAIL: '1' }).status).toBe(2)
    expect(fs.readFileSync(path.join(root, 'dist', 'index.js'), 'utf8')).toBe('old entry')
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.dist-'))).toEqual([])
  })

  it('6.7b-R21F-03 replaces dist file by file from staging and reports the counts', () => {
    const root = fakePackage()
    const staging = path.join(root, 'staging')
    fs.mkdirSync(path.join(staging, 'added'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'index.js'), 'new entry')
    fs.writeFileSync(path.join(staging, 'added', 'new.js'), 'new file')
    expect(replaceDistFromStaging(staging, path.join(root, 'dist'))).toEqual({
      moved: 2,
      removed: 2,
    })
    expect(
      fs.readdirSync(path.join(root, 'dist'), { recursive: true }).map(String).sort()
    ).toEqual(['added', path.join('added', 'new.js'), 'index.js'])
    expect(fs.existsSync(staging)).toBe(false)
  })
})

/**
 * A slow stand-in for `tsc`: writes six files 60 ms apart into `--outDir`, so a
 * second build started meanwhile overlaps the first one's compile.
 */
const SLOW_TSC = `
const fs = require('node:fs')
const path = require('node:path')
const outDir = process.argv[process.argv.indexOf('--outDir') + 1]
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60)
const mode = process.env.SLOW_TSC_MODE
if (mode === 'empty') process.exit(0)
fs.mkdirSync(path.join(outDir, 'nested'), { recursive: true })
for (let i = 0; i < 6; i++) {
  pause()
  fs.writeFileSync(path.join(outDir, i % 2 ? 'nested' : '', 'file-' + i + '.js'), 'build output ' + i)
  if (mode === 'fail' && i === 2) process.exit(2)
}
if (mode === 'vanish') fs.rmSync(outDir, { recursive: true, force: true })
`

/** Every file under `root` with its content, for comparing whole trees. */
const tree = (root: string): Record<string, string> => {
  const files = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry): [string, string] => {
      const file = path.join(entry.parentPath, entry.name)
      return [path.relative(root, file), fs.readFileSync(file, 'utf8')]
    })
    .sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(files)
}

/** A package whose `dist` holds an older build than the slow compiler writes. */
function slowPackage(parent: string, name: string) {
  const root = path.join(parent, name)
  fs.mkdirSync(path.join(root, 'dist', 'old'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist', 'file-0.js'), 'old output 0')
  fs.writeFileSync(path.join(root, 'dist', 'old', 'removed.js'), 'old only')
  fs.writeFileSync(path.join(root, 'slow-tsc.cjs'), SLOW_TSC)
  return root
}

const buildAsync = (root: string, env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [SCRIPT, '--tsc', process.execPath, 'slow-tsc.cjs'],
      {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let output = ''
    child.stdout.on('data', (data: Buffer) => (output += data.toString()))
    child.stderr.on('data', (data: Buffer) => (output += data.toString()))
    child.on('close', (code) => resolve({ code, output }))
  })

/** The package directory's own entries other than `dist` and the compiler stand-in. */
const leftovers = (root: string) =>
  fs.readdirSync(root).filter((name) => !['dist', 'slow-tsc.cjs'].includes(name))

describe('overlapping builds of one package', () => {
  it('6.7b-R23-01 two overlapping builds both succeed and leave the same complete dist as one build', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-overlap-'))
    const single = slowPackage(directory, 'single')
    expect((await buildAsync(single)).code).toBe(0)
    const expected = tree(path.join(single, 'dist'))
    expect(Object.keys(expected)).toHaveLength(6)

    const shared = slowPackage(directory, 'shared')
    const first = buildAsync(shared)
    // The second build starts while the first is mid-compile.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const second = buildAsync(shared)
    const results = await Promise.all([first, second])
    for (const result of results) expect(result, result.output).toMatchObject({ code: 0 })
    expect(tree(path.join(shared, 'dist'))).toEqual(expected)
    // No staging directory, lock or incremental state is left behind.
    expect(leftovers(shared)).toEqual([])
  })

  it('6.7b-R23-02 reclaims the lock and staging a dead build left, and keeps the staging of a live build', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-stale-'))
    const root = slowPackage(directory, 'package')
    // A pid that has exited, as a crashed build leaves it.
    const dead = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.pid))'],
      {
        encoding: 'utf8',
      }
    )
    const deadPid = Number(dead.stdout)
    fs.writeFileSync(
      path.join(root, '.dist-build.lock'),
      JSON.stringify({ pid: deadPid, startedAt: Date.now() - 60_000, token: 'crashed' })
    )
    fs.mkdirSync(path.join(root, `.dist-staging-${deadPid}-crashed`))
    // A staging directory whose pid is alive belongs to another build and is kept.
    const live = `.dist-staging-${process.pid}-running`
    fs.mkdirSync(path.join(root, live))
    const result = await buildAsync(root)
    expect(result, result.output).toMatchObject({ code: 0 })
    expect(result.output).toContain(`Reclaimed the build lock of pid ${deadPid}`)
    expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(6)
    expect(leftovers(root)).toEqual([live])
  })

  it('6.7b-R23-03 fails named when a live holder keeps the lock past the wait bound', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-held-'))
    const root = slowPackage(directory, 'package')
    // This test process stands in for a live build that holds the lock.
    fs.writeFileSync(
      path.join(root, '.dist-build.lock'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'held' })
    )
    const result = await buildAsync(root, { BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '400' })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(
      new RegExp(`build lock .*\\.dist-build\\.lock is held by live pid ${process.pid}`)
    )
    // The holder's lock and the last good build are untouched.
    expect(fs.existsSync(path.join(root, '.dist-build.lock'))).toBe(true)
    expect(fs.readFileSync(path.join(root, 'dist', 'file-0.js'), 'utf8')).toBe(
      'old output 0'
    )
  })

  it('6.7b-R23-04 keeps a complete dist when a build that fails mid-compile follows one that publishes', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-fail-after-'))
    const single = slowPackage(directory, 'single')
    expect((await buildAsync(single)).code).toBe(0)
    const expected = tree(path.join(single, 'dist'))

    const shared = slowPackage(directory, 'shared')
    const publishing = buildAsync(shared)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const failing = buildAsync(shared, { SLOW_TSC_MODE: 'fail' })
    const [published, failed] = await Promise.all([publishing, failing])
    expect(published, published.output).toMatchObject({ code: 0 })
    expect(failed.code).toBe(2)
    expect(tree(path.join(shared, 'dist'))).toEqual(expected)
    expect(leftovers(shared)).toEqual([])
  })

  it.each([
    { mode: 'empty', label: 'empty', message: 'emitted nothing' },
    { mode: 'vanish', label: 'gone', message: 'is missing' },
  ])(
    '6.7b-R23-05 refuses to publish when the compiler exits 0 but its staging is $label, and leaves dist untouched',
    async ({ mode, message }) => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), `r23-${mode}-`))
      const root = slowPackage(directory, 'package')
      const before = tree(path.join(root, 'dist'))
      const result = await buildAsync(root, { SLOW_TSC_MODE: mode })
      expect(result.code).toBe(1)
      expect(result.output).toContain(message)
      expect(tree(path.join(root, 'dist'))).toEqual(before)
      expect(leftovers(root)).toEqual([])
    }
  )
})
