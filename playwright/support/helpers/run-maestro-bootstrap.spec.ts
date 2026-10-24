/** Actual runner CLI with isolated workspace outputs and synthetic preparation. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const runnerFiles = [
  'scripts/run-maestro.mjs',
  'scripts/maestro-version.mjs',
  'scripts/lib/expo-go-link-endpoint.mjs',
  'scripts/lib/maestro-driver-reuse.mjs',
  'scripts/lib/maestro-flow-outcome.mjs',
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
})

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

function run(failPreparation = false) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/run-maestro.mjs', '--platform', 'bootstrap-test-invalid'],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
          NODE_OPTIONS: '',
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
