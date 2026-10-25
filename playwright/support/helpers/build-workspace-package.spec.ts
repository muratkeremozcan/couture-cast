/**
 * Story 6.7b R21 follow-up, R23 and R34: a shared package rebuild never leaves
 * its `dist` without an entry point, so a reader in the same checkout sees the
 * old or the new build at every moment; concurrent builds of one package need
 * no lock. See scripts/build-workspace-package.mjs.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
 * second build started meanwhile overlaps the first one's compile. `many` writes
 * 300 files at once, like a real package's emit.
 */
const SLOW_TSC = `
const fs = require('node:fs')
const path = require('node:path')
const outDir = process.argv[process.argv.indexOf('--outDir') + 1]
const pauseMs = Number(process.env.SLOW_TSC_PAUSE_MS || 60)
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs)
const mode = process.env.SLOW_TSC_MODE
if (mode === 'empty') process.exit(0)
fs.mkdirSync(path.join(outDir, 'nested'), { recursive: true })
if (mode === 'many') {
  for (let i = 0; i < 300; i++)
    fs.writeFileSync(path.join(outDir, i % 2 ? 'nested' : '', 'file-' + i + '.js'), 'build output ' + i)
  process.exit(0)
}
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

const buildAsync = (root: string, env: NodeJS.ProcessEnv = {}, script = SCRIPT) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [script, '--tsc', process.execPath, 'slow-tsc.cjs'],
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
  it(
    '6.7b-R23-01 two overlapping builds both succeed and leave the same complete dist as one build',
    { timeout: 30_000 },
    async () => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-overlap-'))
      const single = slowPackage(directory, 'single')
      expect((await buildAsync(single)).code).toBe(0)
      const expected = tree(path.join(single, 'dist'))
      expect(Object.keys(expected)).toHaveLength(6)

      const shared = slowPackage(directory, 'shared')
      const first = buildAsync(shared)
      // The second build starts while the first is mid-compile: no lock, both
      // compile privately and publish the same file set.
      await new Promise((resolve) => setTimeout(resolve, 150))
      const second = buildAsync(shared)
      const results = await Promise.all([first, second])
      for (const result of results)
        expect(result, result.output).toMatchObject({ code: 0 })
      expect(tree(path.join(shared, 'dist'))).toEqual(expected)
      // No staging directory or incremental state is left behind.
      expect(leftovers(shared)).toEqual([])
    }
  )

  it(
    '6.7b-R23-04 keeps a complete dist when a build that fails mid-compile follows one that publishes',
    { timeout: 30_000 },
    async () => {
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
    }
  )

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

/** A stand-in for `tsc` that emits 20 directories of 10 files each at once. */
const DIRECTORIES_TSC = `
const fs = require('node:fs')
const path = require('node:path')
const outDir = process.argv[process.argv.indexOf('--outDir') + 1]
for (let d = 0; d < 20; d++) {
  fs.mkdirSync(path.join(outDir, 'dir-' + d), { recursive: true })
  for (let i = 0; i < 10; i++)
    fs.writeFileSync(path.join(outDir, 'dir-' + d, 'file-' + i + '.js'), 'build output ' + d + '-' + i)
}
`

describe('concurrent pruning (R34)', () => {
  it(
    '6.7b-R34-02 three concurrent builds that prune the same stale directories all succeed, round after round',
    { timeout: 120_000 },
    async () => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r34-prune-'))
      const root = path.join(directory, 'package')
      fs.mkdirSync(root)
      fs.writeFileSync(path.join(root, 'slow-tsc.cjs'), DIRECTORIES_TSC)
      const failures: string[] = []
      for (let round = 1; round <= 20; round += 1) {
        fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
        for (let d = 0; d < 30; d += 1) {
          fs.mkdirSync(path.join(root, 'dist', `stale-${d}`, 'sub'), { recursive: true })
          fs.writeFileSync(path.join(root, 'dist', `stale-${d}`, 'sub', 'old.js'), 'old')
        }
        // eslint-disable-next-line no-await-in-loop -- rounds are serial on purpose
        const results = await Promise.all([
          buildAsync(root),
          buildAsync(root),
          buildAsync(root),
        ])
        for (const result of results)
          if (result.code !== 0) failures.push(`round ${round}: ${result.output}`)
        const files = Object.keys(tree(path.join(root, 'dist')))
        if (files.length !== 200 || files.some((file) => file.startsWith('stale-')))
          failures.push(`round ${round}: dist holds ${files.length} files`)
      }
      expect(failures).toEqual([])
      expect(leftovers(root)).toEqual([])
    }
  )

  it('6.7b-R34-03 a peer build that already removed a stale directory does not fail this one', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r34-peer-'))
    const dist = path.join(directory, 'dist')
    const staging = path.join(directory, 'staging')
    fs.mkdirSync(path.join(dist, 'stale', 'deeper'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'stale', 'deeper', 'old.js'), 'old')
    fs.mkdirSync(staging)
    fs.writeFileSync(path.join(staging, 'index.js'), 'new entry')
    const removeDirectory = fs.rmdirSync.bind(fs)
    // This build has listed the empty directories; the peer prunes the rest of
    // the stale tree right after this build removes the deepest one.
    const removals = vi.spyOn(fs, 'rmdirSync').mockImplementation((target) => {
      removeDirectory(target)
      if (String(target).endsWith('deeper'))
        fs.rmSync(path.join(dist, 'stale'), { recursive: true, force: true })
    })
    try {
      expect(replaceDistFromStaging(staging, dist)).toEqual({ moved: 1, removed: 1 })
    } finally {
      removals.mockRestore()
    }
    expect(tree(dist)).toEqual({ 'index.js': 'new entry' })
  })

  it('6.7b-R34-04 publishes into a directory a peer build pruned between creating it and the rename', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r34-recreate-'))
    const dist = path.join(directory, 'dist')
    const staging = path.join(directory, 'staging')
    fs.mkdirSync(dist)
    fs.mkdirSync(path.join(staging, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'lib', 'new.js'), 'new file')
    const rename = fs.renameSync.bind(fs)
    let pruned = 0
    const renames = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (pruned === 0) {
        pruned += 1
        fs.rmSync(path.dirname(String(to)), { recursive: true, force: true })
      }
      rename(from, to)
    })
    try {
      expect(replaceDistFromStaging(staging, dist)).toEqual({ moved: 1, removed: 0 })
    } finally {
      renames.mockRestore()
    }
    expect(pruned).toBe(1)
    expect(tree(dist)).toEqual({ [path.join('lib', 'new.js')]: 'new file' })
  })
})

describe('command-line entry', () => {
  it(
    '6.7b-R32-02 builds when the script is run through a symlinked directory',
    { timeout: 30_000 },
    async () => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r32-symlink-'))
      const real = path.join(directory, 'real-scripts')
      fs.mkdirSync(real)
      fs.copyFileSync(SCRIPT, path.join(real, 'build-workspace-package.mjs'))
      fs.symlinkSync(real, path.join(directory, 'linked-scripts'), 'dir')
      const script = path.join(directory, 'linked-scripts', 'build-workspace-package.mjs')
      const root = slowPackage(directory, 'package')
      const result = await buildAsync(root, {}, script)
      expect(result, result.output).toMatchObject({ code: 0 })
      // A run that exits 0 without building would leave the old dist here.
      expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(6)
      expect(leftovers(root)).toEqual([])
    }
  )
})

describe('serial builds (R34)', () => {
  it(
    '6.7b-R34-01 fifty serial builds of a 300-file package all succeed with nothing left behind',
    { timeout: 120_000 },
    async () => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r34-serial-'))
      const root = slowPackage(directory, 'package')
      const failures: string[] = []
      for (let run = 1; run <= 50; run += 1) {
        // eslint-disable-next-line no-await-in-loop -- serial on purpose
        const result = await buildAsync(root, { SLOW_TSC_MODE: 'many' })
        if (result.code !== 0) failures.push(`run ${run}: ${result.output}`)
      }
      expect(failures).toEqual([])
      expect(Object.keys(tree(path.join(root, 'dist')))).toHaveLength(300)
      expect(leftovers(root)).toEqual([])
    }
  )
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

  it('6.7b-R25-02 publishes a declaration file after the declarations it imports', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-declarations-'))
    const dist = path.join(directory, 'dist')
    const staging = path.join(directory, 'staging')
    fs.mkdirSync(dist)
    fs.mkdirSync(path.join(staging, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'index.d.ts'), 'export declare const old: 1\n')
    // The changed entry and a new declaration both import a new one in lib/.
    fs.writeFileSync(
      path.join(staging, 'index.d.ts'),
      "export * from './api.js'\nexport type { Shape } from './lib/shape'\n"
    )
    fs.writeFileSync(
      path.join(staging, 'api.d.ts'),
      "import type { Shape } from './lib/shape.js'\nexport declare const make: () => Shape\n"
    )
    fs.writeFileSync(
      path.join(staging, 'lib', 'shape.d.ts'),
      'export type Shape = { a: 1 }\n'
    )
    const order: string[] = []
    const rename = fs.renameSync.bind(fs)
    const renames = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      order.push(path.relative(dist, String(to)))
    })
    try {
      replaceDistFromStaging(staging, dist)
    } finally {
      renames.mockRestore()
    }
    expect(order).toEqual([path.join('lib', 'shape.d.ts'), 'api.d.ts', 'index.d.ts'])
  })
})
