/**
 * Story 6.7b R21 follow-up: a shared package rebuild never leaves its `dist` without an
 * entry point, so a reader in the same checkout sees the old or the new build at
 * every moment. See scripts/build-workspace-package.mjs.
 */
import { spawnSync } from 'node:child_process'
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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r22-package-'))
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
    expect(fs.existsSync(path.join(root, '.dist-staging'))).toBe(false)
    // Every build is still a full one.
    expect(fs.existsSync(path.join(root, 'tsconfig.build.tsbuildinfo'))).toBe(false)
  })

  it('6.7b-R21F-02 leaves the last good build in place when the compile fails', () => {
    const root = fakePackage()
    expect(build(root, { FAKE_TSC_FAIL: '1' }).status).toBe(2)
    expect(fs.readFileSync(path.join(root, 'dist', 'index.js'), 'utf8')).toBe('old entry')
    expect(fs.existsSync(path.join(root, '.dist-staging'))).toBe(false)
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
