/**
 * Story 6.7b R21 follow-up: a shared package rebuild never leaves its `dist` without an
 * entry point, so a reader in the same checkout sees the old or the new build at
 * every moment. See scripts/build-workspace-package.mjs.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lock } from 'proper-lockfile'
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
const pauseMs = Number(process.env.SLOW_TSC_PAUSE_MS || 60)
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs)
const mode = process.env.SLOW_TSC_MODE
const startedAt = Date.now()
// Each compile's interval, so a test can tell whether two of them overlapped.
process.on('exit', () => fs.appendFileSync('compiles.log', startedAt + ' ' + Date.now() + '\\n'))
if (mode === 'empty') process.exit(0)
fs.mkdirSync(path.join(outDir, 'nested'), { recursive: true })
for (let i = 0; i < 6; i++) {
  pause()
  fs.writeFileSync(path.join(outDir, i % 2 ? 'nested' : '', 'file-' + i + '.js'), 'build output ' + i)
  if (mode === 'fail' && i === 2) process.exit(2)
  // Another build takes the lock over mid-compile, once (R24 displacement).
  const marker = process.env.SLOW_TSC_DISPLACE_MARKER
  if (mode === 'displace' && i === 2 && marker && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, '')
    fs.rmSync('.dist-build.lock', { recursive: true, force: true })
    fs.mkdirSync('.dist-build.lock')
    fs.writeFileSync('.dist-build.lock.owner', 'another-build')
    fs.writeFileSync(path.join(outDir, 'displaced-attempt.js'), 'must never be published')
  }
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
  fs
    .readdirSync(root)
    .filter((name) => !['dist', 'slow-tsc.cjs', 'compiles.log'].includes(name))

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

  it('6.7b-R23-02 removes the staging a crashed build left', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-staging-'))
    const root = slowPackage(directory, 'package')
    fs.mkdirSync(path.join(root, '.dist-staging-999999-crashed', 'nested'), {
      recursive: true,
    })
    const result = await buildAsync(root)
    expect(result, result.output).toMatchObject({ code: 0 })
    expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(6)
    expect(leftovers(root)).toEqual([])
  })

  it('6.7b-R23-03 fails named when a heartbeating holder keeps the lock past the wait bound', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-held-'))
    const root = slowPackage(directory, 'package')
    // This test process holds the lock and keeps it alive, like a running build.
    const release = await lock(root, {
      lockfilePath: path.join(root, '.dist-build.lock'),
      realpath: false,
      stale: 2_000,
      update: 1_000,
    })
    try {
      const result = await buildAsync(root, {
        BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '600',
        BUILD_WORKSPACE_PACKAGE_LOCK_STALE_MS: '2000',
      })
      expect(result.code).toBe(1)
      expect(result.output).toMatch(
        /build lock .*\.dist-build\.lock is still held after 600 ms by a build that keeps it alive/
      )
      expect(fs.readFileSync(path.join(root, 'dist', 'file-0.js'), 'utf8')).toBe(
        'old output 0'
      )
    } finally {
      await release()
    }
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The compile intervals `slow-tsc.cjs` logged, in start order. */
const compiles = (root: string) =>
  fs
    .readFileSync(path.join(root, 'compiles.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(' ').map(Number) as [number, number])
    .sort((left, right) => left[0] - right[0])

/** Fails when two logged compiles overlap. */
const expectSerialized = (ran: [number, number][]) => {
  for (let index = 1; index < ran.length; index += 1)
    expect(ran[index]![0], 'compiles overlapped').toBeGreaterThanOrEqual(
      ran[index - 1]![1]
    )
}

/** A short stale window, so the tests see takeovers in seconds. */
const STALE = { BUILD_WORKSPACE_PACKAGE_LOCK_STALE_MS: '2000' }

/** A lock directory whose heartbeat stopped `ageMs` ago, as a crashed build leaves it. */
function abandonedLock(root: string, ageMs: number) {
  const lock = path.join(root, '.dist-build.lock')
  fs.mkdirSync(lock)
  const then = new Date(Date.now() - ageMs)
  fs.utimesSync(lock, then, then)
}

describe('heartbeat build lock (R24)', () => {
  it('6.7b-R24-01 three waiters on an abandoned lock run one at a time and leave one complete dist', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-waiters-'))
    const single = slowPackage(directory, 'single')
    expect((await buildAsync(single)).code).toBe(0)
    const expected = tree(path.join(single, 'dist'))

    const root = slowPackage(directory, 'shared')
    abandonedLock(root, 60_000)
    const env = {
      ...STALE,
      SLOW_TSC_PAUSE_MS: '120',
      BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '20000',
    }
    const first = buildAsync(root, env)
    const second = buildAsync(root, env)
    await wait(300)
    const third = buildAsync(root, env)
    const results = await Promise.all([first, second, third])
    for (const result of results) expect(result, result.output).toMatchObject({ code: 0 })
    const ran = compiles(root)
    expect(ran).toHaveLength(3)
    expectSerialized(ran)
    expect(tree(path.join(root, 'dist'))).toEqual(expected)
    expect(leftovers(root)).toEqual([])
  })

  it("6.7b-R24-02 takes over a dead build's lock even when its pid now names a live process", async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-reused-pid-'))
    const root = slowPackage(directory, 'package')
    // A lock file from the pid-lock version, whose pid the OS has since given to a
    // live process (this one); its last write is a day old.
    const lock = path.join(root, '.dist-build.lock')
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now() - 86_400_000,
        token: 'old',
      })
    )
    const dayAgo = new Date(Date.now() - 86_400_000)
    fs.utimesSync(lock, dayAgo, dayAgo)
    const result = await buildAsync(root, {
      ...STALE,
      BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '1500',
    })
    expect(result, result.output).toMatchObject({ code: 0 })
    expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(6)
    expect(leftovers(root)).toEqual([])
  })

  it('6.7b-R24-03 takes over the lock of a build killed mid-compile once its heartbeat is stale', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-killed-'))
    const root = slowPackage(directory, 'package')
    const killed = spawn(
      process.execPath,
      [SCRIPT, '--tsc', process.execPath, 'slow-tsc.cjs'],
      {
        cwd: root,
        env: { ...process.env, ...STALE, SLOW_TSC_PAUSE_MS: '500' },
        stdio: 'ignore',
        detached: true,
      }
    )
    const exited = new Promise((resolve) => killed.once('exit', resolve))
    // Kill the build and its compiler outright once it holds the lock.
    for (let tries = 0; !fs.existsSync(path.join(root, '.dist-build.lock')); tries += 1) {
      if (tries > 100) throw new Error('the build never took the lock')
      await wait(20)
    }
    await wait(300)
    process.kill(-killed.pid!, 'SIGKILL')
    await exited
    expect(fs.existsSync(path.join(root, '.dist-build.lock'))).toBe(true)

    const startedAt = Date.now()
    const next = await buildAsync(root, {
      ...STALE,
      BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '20000',
    })
    expect(next, next.output).toMatchObject({ code: 0 })
    // It waited for the heartbeat to go stale, then took the lock over.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000)
    expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(6)
    expect(leftovers(root)).toEqual([])
  })

  it('6.7b-R24-04 never takes over a live build that compiles longer than the stale window', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-slow-holder-'))
    const root = slowPackage(directory, 'package')
    // Six 600 ms steps: 3.6 s of compile against a 2 s stale window.
    const holder = buildAsync(root, { ...STALE, SLOW_TSC_PAUSE_MS: '600' })
    await wait(400)
    const waiter = buildAsync(root, {
      ...STALE,
      BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '20000',
    })
    const results = await Promise.all([holder, waiter])
    for (const result of results) expect(result, result.output).toMatchObject({ code: 0 })
    const ran = compiles(root)
    expect(ran).toHaveLength(2)
    expectSerialized(ran)
    expect(ran[0]![1] - ran[0]![0]).toBeGreaterThan(2_000)
    expect(leftovers(root)).toEqual([])
  })
})

/** The relative module specifiers a compiled `.js` file loads. */
const relativeImports = (source: string) =>
  [
    ...source.matchAll(
      /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
    ),
  ].map((match) => match[1]!)

/** Every `.js` file in `dist` whose relative imports do not resolve there. */
const unresolved = (dist: string) =>
  Object.entries(tree(dist))
    .filter(([file]) => file.endsWith('.js'))
    .flatMap(([file, source]) =>
      relativeImports(source)
        .map((specifier) => path.join(path.dirname(file), specifier))
        .filter((target) => !fs.existsSync(path.join(dist, target)))
        .map((target) => `${file} -> ${target}`)
    )

describe('displaced builds (R24)', () => {
  it('6.7b-R24-07 a build whose lock is taken over mid-compile discards that attempt, rebuilds and exits 0', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-displaced-'))
    const single = slowPackage(directory, 'single')
    expect((await buildAsync(single)).code).toBe(0)
    const expected = tree(path.join(single, 'dist'))

    const root = slowPackage(directory, 'package')
    const result = await buildAsync(root, {
      ...STALE,
      SLOW_TSC_MODE: 'displace',
      SLOW_TSC_DISPLACE_MARKER: path.join(directory, 'displaced-once'),
      BUILD_WORKSPACE_PACKAGE_LOCK_WAIT_MS: '20000',
    })
    expect(result, result.output).toMatchObject({ code: 0 })
    expect(result.output).toContain('discarding that compile and building again')
    // Two compiles: the displaced one and the rebuild that published.
    const ran = compiles(root)
    expect(ran).toHaveLength(2)
    // The displaced build left the other build's lock alone: the rebuild had to
    // wait for that lock to go stale before taking it.
    expect(ran[1]![0] - ran[0]![1]).toBeGreaterThanOrEqual(1_000)
    // Nothing from the displaced attempt reached dist.
    expect(tree(path.join(root, 'dist'))).toEqual(expected)
    expect(leftovers(root)).toEqual([])
  })
})

describe('publication order (R24)', () => {
  it('6.7b-R24-05 publishes new files first, then changed ones, then removes deleted ones, so every import resolves at every step', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-order-'))
    const dist = path.join(directory, 'dist')
    const staging = path.join(directory, 'staging')
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
    // The old build: an entry and a helper that load a module the new build drops.
    write(
      path.join(dist, 'index.js'),
      "export * from './old.js'\nimport './lib/helper.js'\n"
    )
    write(path.join(dist, 'old.js'), 'export const old = 1\n')
    write(path.join(dist, 'lib', 'helper.js'), "require('./../old.js')\n")
    // The new build: the changed entry and helper load modules that are new.
    write(
      path.join(staging, 'index.js'),
      "export * from './zz-new.js'\nimport './lib/helper.js'\n"
    )
    write(
      path.join(staging, 'zz-new.js'),
      "import { deep } from './lib/deep.js'\nexport { deep }\n"
    )
    write(path.join(staging, 'lib', 'helper.js'), "import { deep } from './deep.js'\n")
    write(path.join(staging, 'lib', 'deep.js'), 'export const deep = 1\n')

    const steps: string[] = []
    const problems: string[] = []
    const check = (step: string) => {
      steps.push(step)
      for (const problem of unresolved(dist)) problems.push(`after ${step}: ${problem}`)
    }
    const rename = fs.renameSync.bind(fs)
    const remove = fs.rmSync.bind(fs)
    const renames = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      check(`rename ${path.relative(directory!, String(to))}`)
    })
    const removals = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      remove(target, options)
      if (String(target).startsWith(dist))
        check(`remove ${path.relative(directory!, String(target))}`)
    })
    try {
      replaceDistFromStaging(staging, dist)
    } finally {
      renames.mockRestore()
      removals.mockRestore()
    }
    expect(problems).toEqual([])
    // New files first, then changed ones, then the removal.
    expect(steps).toEqual([
      'rename dist/lib/deep.js',
      'rename dist/zz-new.js',
      'rename dist/lib/helper.js',
      'rename dist/index.js',
      'remove dist/old.js',
    ])
  })

  it('6.7b-R24-06 a Node reader requiring the package entry succeeds at every step of publication', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-reader-'))
    const dist = path.join(directory, 'dist')
    const staging = path.join(directory, 'staging')
    fs.mkdirSync(dist)
    fs.mkdirSync(staging)
    // The old build: a usable entry. The new entry needs a dependency that is new.
    fs.writeFileSync(
      path.join(dist, 'index.cjs'),
      "module.exports = require('./old-dependency.cjs')\n"
    )
    fs.writeFileSync(
      path.join(dist, 'old-dependency.cjs'),
      'module.exports = { generation: 1 }\n'
    )
    fs.writeFileSync(
      path.join(staging, 'index.cjs'),
      "module.exports = require('./new-dependency.cjs')\n"
    )
    fs.writeFileSync(
      path.join(staging, 'new-dependency.cjs'),
      'module.exports = { generation: 2 }\n'
    )

    const reads: string[] = []
    const read = (step: string) => {
      const reader = spawnSync(
        process.execPath,
        [
          '-e',
          `process.stdout.write(String(require(${JSON.stringify(path.join(dist, 'index.cjs'))}).generation))`,
        ],
        { encoding: 'utf8' }
      )
      reads.push(
        `${step}: ${reader.status === 0 ? `generation ${reader.stdout}` : /MODULE_NOT_FOUND/.test(reader.stderr) ? 'MODULE_NOT_FOUND' : reader.stderr.trim()}`
      )
    }
    const rename = fs.renameSync.bind(fs)
    const remove = fs.rmSync.bind(fs)
    const renames = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      read(`after rename ${path.basename(String(to))}`)
    })
    const removals = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      remove(target, options)
      if (String(target).startsWith(dist))
        read(`after remove ${path.basename(String(target))}`)
    })
    try {
      replaceDistFromStaging(staging, dist)
    } finally {
      renames.mockRestore()
      removals.mockRestore()
    }
    expect(reads).toEqual([
      'after rename new-dependency.cjs: generation 1',
      'after rename index.cjs: generation 2',
      'after remove old-dependency.cjs: generation 2',
    ])
  })
})
