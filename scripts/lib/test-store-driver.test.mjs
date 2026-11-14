// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Antigravity r17 (3): scripts/run-test-store-journey.mjs itself, run as a subprocess against
// stubs: a loopback HTTP server stands in for the API and Metro's status page, and stub `npx`,
// `xcrun` and `maestro` scripts on PATH stand in for Metro, the simulator and the flows. The
// maestro stub plants a file holding the signed-up member id in the evidence dir, then the run
// crashes (the stub exits nonzero) or is stopped with SIGTERM. Either way the evidence dir must
// end with no trace of the member, the quarantine must hold the file, the exit code must keep
// the original failure, and the stub Metro and log stream processes must be gone.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { scanForLeaks } from './test-store-output.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const driver = path.join(repo, 'scripts/run-test-store-journey.mjs')

const NONE = {
  status: 'none',
  store: null,
  productId: null,
  willRenew: null,
  currentPeriodEnd: null,
  syncedAt: null,
  purchasesEnabled: true,
}

function writeStub(dir, name, body) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
}

/** The API and Metro status stand-in. Once `planted` exists, subscription reads hang. */
async function stubServer(t, stubDir, member) {
  const hung = []
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://stub.invalid')
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (url.pathname === '/status') return response.end('packager-status:running')
    if (url.pathname === '/api/health') return json(200, { ok: true })
    if (url.pathname === '/api/v1/auth/signup') return json(201, { userId: member })
    if (url.pathname === '/api/v1/commerce/premium/access')
      return json(200, { data: { premium: false, source: 'none' } })
    if (url.pathname.startsWith('/api/v1/commerce/subscription')) {
      if (fs.existsSync(path.join(stubDir, 'planted'))) return hung.push(response)
      return json(200, { data: NONE })
    }
    return json(404, {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise((resolve) => {
        for (const response of hung) response.destroy()
        server.closeAllConnections?.()
        server.close(resolve)
      })
  )
  return server.address().port
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function runDriver(t, mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-store-driver-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const bin = path.join(base, 'bin')
  const stubDir = path.join(base, 'stub')
  const out = path.join(base, 'evidence')
  fs.mkdirSync(bin)
  fs.mkdirSync(stubDir)
  const member = `stub-member-${randomUUID()}`
  fs.writeFileSync(path.join(stubDir, 'member'), member)
  const port = await stubServer(t, stubDir, member)
  writeStub(bin, 'npx', 'echo $$ > "$STUB_DIR/metro.pid"\nexec sleep 300')
  writeStub(
    bin,
    'xcrun',
    'case "$*" in *" stream "*) echo $$ > "$STUB_DIR/stream.pid"; exec sleep 300;; esac\nexit 0'
  )
  writeStub(
    bin,
    'maestro',
    [
      'case "$*" in *hierarchy*) echo \'{"id":"live-font-env-root~0.81.5~light~ltr~3~en-US"}\'; exit 0;; esac',
      'printf \'{"u":"%s"}\' "$(cat "$STUB_DIR/member")" > "$STUB_EVIDENCE/leak.json"',
      'touch "$STUB_DIR/planted"',
      '[ "$STUB_MODE" = crash ] && exit 1',
      'exit 0',
    ].join('\n')
  )
  const secrets = path.join(base, '.env.local')
  fs.writeFileSync(
    secrets,
    'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY=test_stubkey000000\nREVENUECAT_SECRET_API_KEY=sk_stub\n'
  )
  const artifact = path.join(base, 'CoutureCast.app')
  fs.writeFileSync(artifact, 'stub app')
  // The evidence dir must exist before the maestro stub writes into it; the driver creates it.
  const child = spawn(
    process.execPath,
    [
      driver,
      ...['--platform', 'ios', '--device', 'stub-udid', '--build', 'debug'],
      ...['--server', 'local', '--api-url', `http://127.0.0.1:${port}`],
      ...['--metro-port', String(port), '--proxy-port', '0'],
      ...['--artifact', artifact, '--secrets-env', secrets, '--out', out],
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        STUB_DIR: stubDir,
        STUB_EVIDENCE: out,
        STUB_MODE: mode,
      },
    }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  if (mode === 'sigterm') {
    // Once the leak is planted the driver waits on a subscription read that never answers.
    const deadline = Date.now() + 60_000
    while (!fs.existsSync(path.join(stubDir, 'planted')) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100))
    await new Promise((resolve) => setTimeout(resolve, 500))
    child.kill('SIGTERM')
  }
  const code = await new Promise((resolve) => child.on('close', resolve))
  const pids = ['metro.pid', 'stream.pid'].map((name) =>
    Number(fs.readFileSync(path.join(stubDir, name), 'utf8'))
  )
  return { code, stdout, stderr, out, member, pids }
}

function assertCleaned({ out, member, pids, stderr }) {
  assert.deepEqual(scanForLeaks(out, [member]), [], stderr)
  assert.ok(!fs.existsSync(path.join(out, 'leak.json')))
  const quarantine = path.join(`${out}.private`, 'quarantine')
  const held = fs
    .readdirSync(quarantine)
    .some((entry) => fs.existsSync(path.join(quarantine, entry, 'leak.json')))
  assert.ok(held, 'the quarantine holds the planted file')
  for (const pid of pids) assert.equal(alive(pid), false, `stub process ${pid} is gone`)
}

test('the driver crashing mid-run quarantines the planted leak and keeps the failure', async (t) => {
  const result = await runDriver(t, 'crash')
  assert.equal(result.code, 1, result.stderr)
  // The run's own failure is reported before any evidence write: the open step's command failed.
  assert.match(result.stdout, /"failed":\["open"\]/)
  assert.match(result.stdout, /test_store_command_failed/)
  assert.match(result.stderr, /test_store_evidence_leak/)
  assert.ok(!result.stdout.includes(result.member))
  assertCleaned(result)
})

test('SIGTERM mid-run exits 143 with the leak quarantined and Metro and the log stream stopped', async (t) => {
  const result = await runDriver(t, 'sigterm')
  assert.equal(result.code, 143, result.stderr)
  assertCleaned(result)
})
