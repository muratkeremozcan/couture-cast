/** Actual runner CLI with isolated workspace outputs and synthetic preparation. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const runnerFiles = [
  'scripts/run-maestro.mjs',
  'scripts/maestro-version.mjs',
  'scripts/lib/test-disk-space.mjs',
  'scripts/lib/native-maestro-flows.mjs',
  'scripts/lib/expo-go-link-endpoint.mjs',
  'scripts/lib/maestro-android-driver-session.mjs',
  'scripts/lib/maestro-android-permissions.mjs',
  'scripts/lib/maestro-android-shards.mjs',
  'scripts/lib/maestro-driver-reuse.mjs',
  'scripts/lib/maestro-flow-outcome.mjs',
  'scripts/lib/maestro-launch-watchdog.mjs',
  'scripts/lib/mobile-e2e-flow-state.mjs',
  'scripts/lib/mobile-e2e-flow-retry.mjs',
  'scripts/lib/mobile-e2e-token.mjs',
  'scripts/lib/package-manager-readiness.mjs',
  'scripts/lib/weather-provider-double-data.mjs',
]
const prepareArgs = ['run', 'prepare:shared-deps', '--workspace', 'packages/db']
let directory: string

function write(relative: string, content: string, executable = false) {
  const file = path.join(directory, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, executable ? { mode: 0o755 } : undefined)
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-bootstrap-'))
  for (const file of runnerFiles) write(file, fs.readFileSync(file, 'utf8'))
  write('apps/mobile/package.json', JSON.stringify({ dependencies: { expo: '54.0.0' } }))
  write('maestro/probe.yaml', 'appId: test.bootstrap\n---\n- assertVisible: unused\n')
  write('node_modules/@prisma/client/package.json', JSON.stringify({ main: 'index.js' }))
  write(
    'node_modules/@couture/testing/package.json',
    JSON.stringify({ exports: { '.': './dist/index.js' } })
  )
  // A real runner must prepare before consuming either workspace's output.
  // Stale output throws if unconditional preparation is ever removed.
  write(
    'node_modules/@prisma/client/index.js',
    "throw new Error('Stale Prisma imported')"
  )
  write(
    'bin/npm',
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const record = (value) => fs.appendFileSync(process.env.BOOTSTRAP_TEST_EVENTS, JSON.stringify(value) + '\\n');
record({ type: 'prepare', args: process.argv.slice(2), cwd: process.cwd() });
if (process.env.BOOTSTRAP_TEST_FAIL === 'true') process.exit(23);
const moduleBody = (name, exports) => "const fs = require('node:fs'); fs.appendFileSync(process.env.BOOTSTRAP_TEST_EVENTS, JSON.stringify({type:'import', name:" + JSON.stringify(name) + "}) + String.fromCharCode(10)); module.exports = " + exports + ";";
const outputs = [
  ['node_modules/@prisma/client/index.js', moduleBody('prisma', '{PrismaClient: class { constructor() { throw new Error("Unexpected database access") } }}')],
  ['node_modules/@couture/testing/dist/index.js', moduleBody('testing', '{cleanupCommunityCommentFixtures: async () => { throw new Error("Unexpected cleanup") }}')],
];
for (const [file, content] of outputs) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}
`,
    true
  )
  // The real runner cleans stale iOS drivers before platform validation. Keep
  // that side effect inside the fixture, including on developer macOS hosts.
  write('bin/pkill', '#!/usr/bin/env node\nprocess.exit(1)\n', true)
  // Bootstrap stops at platform validation and allocates no device/build output.
  // Its synthetic workspace volume must not depend on the developer host's free space.
  write(
    'bootstrap-filesystem.cjs',
    `const fs = require('node:fs');
const statfs = fs.statfsSync;
fs.statfsSync = (...args) => {
  const stats = statfs(...args);
  stats.bavail = Math.ceil(80 * 1024 ** 3 / stats.bsize);
  return stats;
};\n`
  )
})

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

function run(failPreparation = false, native = false) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      native
        ? [
            'scripts/run-story68-native.mjs',
            'bootstrap-test-invalid',
            '--platform',
            'bootstrap-test-invalid',
          ]
        : ['scripts/run-maestro.mjs', '--platform', 'bootstrap-test-invalid'],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
          NODE_OPTIONS: '--require ./bootstrap-filesystem.cjs',
          MOBILE_E2E_PLATFORM: 'bootstrap-test-invalid',
          MOBILE_E2E_METRO_PORT: '0',
          BOOTSTRAP_TEST_EVENTS: path.join(directory, 'events.jsonl'),
          BOOTSTRAP_TEST_FAIL: String(failPreparation),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      }
    )
    let output = ''
    child.stdout.on('data', (data: Buffer) => (output += data.toString()))
    child.stderr.on('data', (data: Buffer) => (output += data.toString()))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, output }))
  })
}

function events() {
  const file = path.join(directory, 'events.jsonl')
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []
}

describe('Maestro shared dependency bootstrap', () => {
  it.each(['cold', 'stale'] as const)(
    'prepares %s workspace outputs once before importing them',
    async (state) => {
      if (state === 'cold') {
        fs.rmSync(path.join(directory, 'node_modules/@prisma/client/index.js'))
      } else {
        write(
          'node_modules/@couture/testing/dist/index.js',
          "throw new Error('Stale testing output imported')"
        )
      }

      const result = await run()
      // Stop at the real platform boundary after successful imports. No device,
      // API or database operation belongs to this bootstrap regression.
      expect(result.code).toBe(1)
      expect(result.output).toContain('Choose a mobile platform explicitly')
      expect(events()).toEqual([
        { type: 'prepare', args: prepareArgs, cwd: fs.realpathSync(directory) },
        { type: 'import', name: 'prisma' },
        { type: 'import', name: 'testing' },
      ])
    }
  )

  it('fails closed when shared preparation fails before importing stale outputs', async () => {
    const result = await run(true)
    expect(result.code).toBe(1)
    expect(result.output).toContain('Mobile E2E shared dependency preparation failed')
    expect(result.output).not.toContain('Choose a mobile platform explicitly')
    expect(events()).toEqual([
      { type: 'prepare', args: prepareArgs, cwd: fs.realpathSync(directory) },
    ])
  })
})

function copyNativeImportClosure(relative: string, seen = new Set<string>()) {
  if (seen.has(relative)) return
  seen.add(relative)
  const source = fs.readFileSync(relative, 'utf8')
  write(relative, source)
  for (const match of source.matchAll(
    /(?:from\s+|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  )) {
    const dependency = path.normalize(path.join(path.dirname(relative), match[1]!))
    if (path.isAbsolute(dependency) || dependency.startsWith('..'))
      throw new Error('Native bootstrap dependency must remain in the repository')
    copyNativeImportClosure(dependency, seen)
  }
}

describe('native runner static dependency bootstrap', () => {
  it('loads the actual native CLI import closure before its command boundary', async () => {
    copyNativeImportClosure('scripts/run-story68-native.mjs')
    fs.mkdirSync(path.join(directory, 'maestro/story65'), { recursive: true })
    fs.mkdirSync(path.join(directory, 'maestro/story68'), { recursive: true })
    const result = await run(false, true)
    expect(result.code).toBe(1)
    expect(result.output).toContain('Use serve, metro or inspect-png')
    expect(result.output).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(events()).toEqual([])
    for (const name of [
      'story68-cold-font-scale.mjs',
      'story68-release-live-font-command.mjs',
      'story68-release-live-font.mjs',
    ])
      expect(fs.existsSync(path.join(directory, 'scripts/lib', name))).toBe(true)
  })

  it('detects a missing cold-font import in the actual copied native CLI', async () => {
    copyNativeImportClosure('scripts/run-story68-native.mjs')
    fs.mkdirSync(path.join(directory, 'maestro/story65'), { recursive: true })
    fs.mkdirSync(path.join(directory, 'maestro/story68'), { recursive: true })
    fs.unlinkSync(path.join(directory, 'scripts/lib/story68-cold-font-scale.mjs'))
    const result = await run(false, true)
    expect(result.code).toBe(1)
    expect(result.output).toContain('ERR_MODULE_NOT_FOUND')
    expect(result.output).toContain('story68-cold-font-scale.mjs')
    expect(events()).toEqual([])
  })
})
