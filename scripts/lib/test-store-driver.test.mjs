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
import { killOwned } from './owned-process.mjs'
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

async function runDriver(
  t,
  mode,
  platform = 'ios',
  { hang = '', fail = '', git = '', extraArgs = [] } = {}
) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-store-driver-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const bin = path.join(base, 'bin')
  const stubDir = path.join(base, 'stub')
  const androidHome = path.join(base, 'android')
  const out = path.join(base, 'evidence')
  fs.mkdirSync(bin)
  fs.mkdirSync(stubDir)
  fs.mkdirSync(path.join(androidHome, 'platform-tools'), { recursive: true })
  const member = `stub-member-${randomUUID()}`
  fs.writeFileSync(path.join(stubDir, 'member'), member)
  const port = await stubServer(t, stubDir, member)
  writeStub(bin, 'npx', 'echo $$ > "$STUB_DIR/metro.pid"\nexec sleep 300')
  // STUB_HANG makes one side call hang past the driver's shortened bound.
  writeStub(
    bin,
    'xcrun',
    [
      'case "$*" in *" stream "*) echo $$ > "$STUB_DIR/stream.pid"; exec sleep 300;; esac',
      'case "$*" in *"simctl $STUB_HANG "*) exec sleep 300;; esac',
      'case "$*" in *"simctl $STUB_FAIL "*) exit 1;; esac',
      'exit 0',
    ].join('\n')
  )
  if (hang === 'git') writeStub(bin, 'git', 'exec sleep 300')
  // git that answers rev-parse with something that is not a sha, and exits 0.
  if (git === 'not-a-sha') writeStub(bin, 'git', 'echo not-a-sha; exit 0')
  // adb records every reverse and reverse --remove it is asked for, one line each.
  writeStub(
    path.join(androidHome, 'platform-tools'),
    'adb',
    [
      'case "$*" in *" reverse "*) echo "$*" >> "$STUB_DIR/adb-reverse.log";; esac',
      // The Maestro driver packages exist while $STUB_DIR/driver does (the maestro stub installs it).
      'case "$*" in *" pm uninstall "*) rm -f "$STUB_DIR/driver"; exit 0;; esac',
      'case "$*" in *" pm list packages "*) [ -f "$STUB_DIR/driver" ] && printf "package:dev.mobile.maestro\\npackage:dev.mobile.maestro.test\\n"; exit 0;; esac',
      'case "$*" in *" pm list instrumentation"*) [ -f "$STUB_DIR/driver" ] && echo "instrumentation:dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner (target=dev.mobile.maestro)"; exit 0;; esac',
      'case "$*" in *" $STUB_HANG "*) exec sleep 300;; esac',
      'case "$*" in *" $STUB_FAIL "*) exit 1;; esac',
      'exit 0',
    ].join('\n')
  )
  writeStub(
    bin,
    'maestro',
    [
      'touch "$STUB_DIR/driver"',
      'echo "$*" >> "$STUB_DIR/maestro-args.log"',
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
  const artifact = path.join(
    base,
    platform === 'ios' ? 'CoutureCast.app' : 'app-debug.apk'
  )
  fs.writeFileSync(artifact, 'stub app')
  const child = spawn(
    process.execPath,
    [
      driver,
      ...['--platform', platform, '--device', 'stub-device', '--build', 'debug'],
      ...['--server', 'local', '--api-url', `http://127.0.0.1:${port}`],
      ...['--metro-port', String(port), '--proxy-port', '0'],
      ...['--artifact', artifact, '--secrets-env', secrets, '--out', out],
      ...(hang ? ['--spawn-timeout-ms', '300'] : []),
      ...extraArgs,
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        ANDROID_HOME: androidHome,
        // A real ~/.maestro/sessions must not hold a stub device (Antigravity r29).
        HOME: base,
        STUB_DIR: stubDir,
        STUB_EVIDENCE: out,
        STUB_MODE: mode,
        STUB_HANG: hang || 'none-hangs',
        STUB_FAIL: fail || 'none-fails',
      },
    }
  )
  const stubPids = () =>
    ['metro.pid', 'stream.pid']
      .map((name) => path.join(stubDir, name))
      .filter((file) => fs.existsSync(file))
      .map((file) => Number(fs.readFileSync(file, 'utf8')))
  // A failing test leaves nothing running: the driver and every stub it started.
  t.after(() => {
    // The driver is a direct child: child.kill does nothing once Node has reaped it. The stubs'
    // pids come from files, so only a live process still running the stub's sleep is killed.
    child.kill('SIGKILL')
    for (const pid of stubPids()) killOwned(pid, 'sleep 300')
  })
  let stdout = ''
  let stderr = ''
  let exited = false
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const closed = new Promise((resolve) =>
    child.on('close', (code) => {
      exited = true
      resolve(code)
    })
  )
  if (mode === 'sigterm') {
    // Once the leak is planted the driver waits on a subscription read that never answers.
    // The wait ends early if the driver already exited, so a broken run fails fast.
    const deadline = Date.now() + 60_000
    while (
      !exited &&
      !fs.existsSync(path.join(stubDir, 'planted')) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 100))
    if (!exited) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      child.kill('SIGTERM')
    }
  }
  const code = await closed
  const reverseLog = path.join(stubDir, 'adb-reverse.log')
  return {
    code,
    stdout,
    stderr,
    out,
    member,
    pids: stubPids(),
    reverse: fs.existsSync(reverseLog) ? fs.readFileSync(reverseLog, 'utf8') : '',
    maestroArgs: fs.existsSync(path.join(stubDir, 'maestro-args.log'))
      ? fs.readFileSync(path.join(stubDir, 'maestro-args.log'), 'utf8').trim().split('\n')
      : [],
  }
}

/**
 * Resolves true once `pid` has exited, or false at the deadline. A stub that got SIGTERM can
 * outlive the driver's close by a moment on a loaded runner (TEA r18), so one check is not proof.
 */
export async function goneWithin(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (alive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return true
}

async function assertCleaned({ out, member, pids, stderr }) {
  assert.deepEqual(scanForLeaks(out, [member]), [], stderr)
  assert.ok(!fs.existsSync(path.join(out, 'leak.json')))
  const quarantine = path.join(`${out}.private`, 'quarantine')
  const held = fs
    .readdirSync(quarantine)
    .some((entry) => fs.existsSync(path.join(quarantine, entry, 'leak.json')))
  assert.ok(held, 'the quarantine holds the planted file')
  for (const pid of pids)
    assert.equal(await goneWithin(pid), true, `stub process ${pid} is gone`)
}

test('the driver crashing mid-run quarantines the planted leak and keeps the failure', async (t) => {
  const result = await runDriver(t, 'crash')
  assert.equal(result.code, 1, result.stderr)
  assert.equal(result.pids.length, 2, 'Metro and the log stream both started')
  // The run's own failure is reported before any evidence write: the open step's command failed.
  assert.match(result.stdout, /"failed":\["open"\]/)
  assert.match(result.stdout, /test_store_command_failed/)
  assert.match(result.stderr, /test_store_evidence_leak/)
  assert.ok(!result.stdout.includes(result.member))
  await assertCleaned(result)
})

test('SIGTERM mid-run exits 143 with the leak quarantined and Metro and the log stream stopped', async (t) => {
  const result = await runDriver(t, 'sigterm')
  assert.equal(result.code, 143, result.stderr)
  assert.equal(result.pids.length, 2, 'Metro and the log stream both started')
  await assertCleaned(result)
})

/** A shell that exits `delay` seconds after SIGTERM, or never (it ignores SIGTERM). */
function lingering(t, delay) {
  const trap = delay === null ? "trap '' TERM" : `trap 'sleep ${delay}; exit 0' TERM`
  const child = spawn('sh', ['-c', `${trap}; while :; do sleep 0.05; done`], {
    stdio: 'ignore',
  })
  t.after(() => child.kill('SIGKILL'))
  return child
}

test('the gone check polls: a stub exiting 1 s after SIGTERM passes, one that never exits fails', async (t) => {
  const slow = lingering(t, 1)
  await new Promise((resolve) => setTimeout(resolve, 200))
  slow.kill('SIGTERM')
  // A single check right away still sees it.
  assert.equal(alive(slow.pid), true)
  assert.equal(await goneWithin(slow.pid), true)
  const stuck = lingering(t, null)
  await new Promise((resolve) => setTimeout(resolve, 200))
  stuck.kill('SIGTERM')
  const started = Date.now()
  assert.equal(await goneWithin(stuck.pid, 1_500), false)
  assert.ok(Date.now() - started >= 1_500)
})

// Antigravity r18 C30: Android removes the adb reverse of the proxy port it really bound.
test('Android: the crash path removes the reverse of the actual proxy and Metro ports', async (t) => {
  const result = await runDriver(t, 'crash', 'android')
  assert.equal(result.code, 1, result.stderr)
  assert.equal(result.pids.length, 1, 'Metro started')
  const lines = result.reverse.trim().split('\n')
  const added = lines
    .filter((line) => !line.includes('--remove'))
    .map((line) => line.split(' ').at(-1))
  const removed = lines
    .filter((line) => line.includes('--remove'))
    .map((line) => line.split(' ').at(-1))
  // The proxy bound a real port for --proxy-port 0; the remove names that port, never tcp:0.
  assert.equal(added.length, 2, result.reverse)
  assert.ok(!added.includes('tcp:0'))
  assert.deepEqual([...removed].sort(), [...new Set(added)].sort())
  // TEA: Maestro keeps the driver it installed; the flow pins the driver port.
  assert.ok(result.maestroArgs.length > 0)
  for (const args of result.maestroArgs) assert.match(args, /--no-reinstall-driver/)
  assert.ok(
    result.maestroArgs
      .filter((args) => / test /.test(args))
      .every((args) => args.includes('--driver-host-port 17001'))
  )
  await assertCleaned(result)
})

// Antigravity r21 (1): each bounded side call that hangs fails the run with its own code.
for (const [platform, hang, code, where] of [
  ['ios', 'git', 'test_store_rev_failed', 'stderr'],
  ['ios', 'uninstall', 'test_store_uninstall_failed', 'stderr'],
  ['android', 'uninstall', 'test_store_uninstall_failed', 'stderr'],
  ['ios', 'terminate', 'test_store_stop_failed', 'stdout'],
  ['android', 'force-stop', 'test_store_stop_failed', 'stdout'],
])
  test(`${platform}: a hung ${hang} fails the run as ${code}`, async (t) => {
    const result = await runDriver(t, 'crash', platform, { hang })
    assert.notEqual(result.code, 0)
    assert.match(result[where], new RegExp(code), `${result.stdout}\n${result.stderr}`)
    for (const pid of result.pids)
      assert.equal(await goneWithin(pid), true, `stub process ${pid} is gone`)
  })

// Antigravity r22 (4): rev-parse that exits 0 with no sha still fails the run.
test('git rev-parse printing a non-sha fails the run as test_store_rev_failed', async (t) => {
  const result = await runDriver(t, 'crash', 'ios', { git: 'not-a-sha' })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /test_store_rev_failed/)
})

// Antigravity r22 (2): force-stop exits 0 either way, so a nonzero is a device failure; simctl
// terminate exits nonzero for an app that is not running, which is fine.
test('android: a nonzero force-stop fails the step as test_store_stop_failed', async (t) => {
  const result = await runDriver(t, 'crash', 'android', { fail: 'force-stop' })
  assert.notEqual(result.code, 0)
  assert.match(result.stdout, /test_store_stop_failed/)
})

test('ios: a nonzero simctl terminate is tolerated and the run goes on to its flow', async (t) => {
  const result = await runDriver(t, 'crash', 'ios', { fail: 'terminate' })
  assert.equal(result.code, 1)
  assert.doesNotMatch(result.stdout, /test_store_stop_failed/)
  // The open step reached maestro, which the crash stub fails.
  assert.match(result.stdout, /test_store_command_failed/)
})

// Antigravity r22 (1): the option is checked before anything runs.
for (const value of ['0', 'abc', '-5', '1.5', '9007199254740993'])
  test(`--spawn-timeout-ms ${value} fails as test_store_spawn_timeout_invalid`, async (t) => {
    const result = await runDriver(t, 'crash', 'ios', {
      extraArgs: ['--spawn-timeout-ms', value],
    })
    assert.equal(result.code, 1)
    // The option itself is refused, as given: not a NaN or a rounded number further on.
    assert.ok(
      result.stderr.includes(`test_store_spawn_timeout_invalid: ${value}`),
      result.stderr
    )
    assert.deepEqual(result.pids, [])
  })
