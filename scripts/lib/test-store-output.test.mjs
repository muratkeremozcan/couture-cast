// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertEvidenceClean,
  awaitExit,
  readPsTable,
  stillRunning,
  FS_OPS,
  installEvidenceGuard,
  outputDirs,
  privatePath,
  scanForLeaks,
  writeEvidence,
  writePrivate,
  writeRunOutputs,
} from './test-store-output.mjs'
import { buildMobileE2EAccessToken } from './mobile-e2e-token.mjs'
import { startApiProxy } from './test-store-proxy.mjs'
import { memberRef, writeArtifactManifests } from './test-store-runner.mjs'

const MEMBER = '7b2c4e8a-1f3d-4c5b-9a6e-0d1f2a3b4c5d'
const APP_USER = '$RCAnonymousID:4f1c2b9e8d7a6c5b3a29'
const SUBSCRIBER = 'sub-0b9c8d7e6f5a4b3c2d1e'
const IDS = [MEMBER, APP_USER, SUBSCRIBER]

/** Where `relative` landed in the quarantine (each entry has its own run-id directory). */
function quarantined(dirs, relative) {
  const root = privatePath(dirs, 'quarantine')
  const found = fs
    .readdirSync(root)
    .map((entry) => path.join(root, entry, relative))
    .filter((candidate) => {
      try {
        fs.lstatSync(candidate)
        return true
      } catch {
        return false
      }
    })
  assert.equal(found.length, 1, relative)
  return found[0]
}

function tempOut(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-store-output-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  return path.join(base, 'evidence')
}

test('the driver writers keep member, app user and subscriber ids out of the evidence dir', async (t) => {
  const dirs = outputDirs(tempOut(t))
  assert.equal(dirs.private, `${dirs.evidence}.private`)
  assert.equal(fs.statSync(dirs.private).mode & 0o777, 0o700)

  // The proxy saw requests naming all three ids; its log goes into the report as recorded.
  const upstream = await startApiProxy({ target: 'http://127.0.0.1:9' })
  t.after(() => upstream.close())
  for (const url of [
    `/api/v1/users/${MEMBER}/profile?app_user_id=${encodeURIComponent(APP_USER)}`,
    `/v1/subscribers/${encodeURIComponent(APP_USER)}/offerings`,
    `/v1/subscribers/${SUBSCRIBER}`,
  ])
    await fetch(`${upstream.url}${url}`)

  // Raw logs, as the driver writes them.
  writePrivate(dirs, 'metro.log', `Metro bundling for ${MEMBER}\n`)
  writePrivate(
    dirs,
    'device.log',
    `[Purchases] - DEBUG: app user ${APP_USER}\nGET /v1/subscribers/${SUBSCRIBER}\n`
  )
  writePrivate(
    dirs,
    path.join('maestro', '1-open-premium', 'commands.json'),
    `{"u":"${MEMBER}"}`
  )
  writeArtifactManifests({
    out: dirs.evidence,
    cwd: dirs.evidence,
    artifacts: [{ name: 'installed', file: null, rev: 'a'.repeat(40) }],
    manifest: ({ leg, rev }) => ({ leg, sha: rev, inputs: {} }),
  })
  const report = {
    memberRef: memberRef(MEMBER),
    records: [{ step: 'preflight', memberRef: memberRef(MEMBER) }],
    proxyLog: upstream.log,
  }
  const written = writeRunOutputs({
    dirs,
    label: 'test-store-ios-debug-local-purchase',
    report,
    member: { userId: MEMBER },
    extraIds: [APP_USER, SUBSCRIBER],
  })

  assert.deepEqual(scanForLeaks(dirs.evidence, IDS), [])
  assert.equal(path.dirname(written.member), dirs.private)
  assert.equal(fs.statSync(written.member).mode & 0o777, 0o600)
  const held = new Set(scanForLeaks(dirs.private, IDS).map((hit) => hit.needle))
  assert.deepEqual([...held].sort(), [...IDS].sort())
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        privatePath(dirs, 'test-store-ios-debug-local-purchase.member.json')
      )
    ).userId,
    MEMBER
  )
})

test('a member id anywhere under the evidence dir fails the run without printing the id', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, path.join('nested', 'notes.txt'), `member ${MEMBER}`)
  assert.throws(
    () => assertEvidenceClean(dirs, [MEMBER]),
    (error) =>
      error.code === 'test_store_evidence_leak' &&
      error.message.includes(path.join('nested', 'notes.txt')) &&
      !error.message.includes(MEMBER)
  )
})

// Antigravity r12 P2: every encoding an id can take in a file is found by scanning for the id.
test('the leak scan finds an id in base64url, base64, double URL, case-changed and \\u-escaped form', (t) => {
  const dirs = outputDirs(tempOut(t))
  const forms = {
    'bearer.txt': `Authorization: Bearer ${buildMobileE2EAccessToken(MEMBER)}`,
    'base64.txt': Buffer.from(`{"appUserID":"${APP_USER}","x":1}`).toString('base64'),
    'double-url.txt': `GET /x?u=${encodeURIComponent(encodeURIComponent(APP_USER))}`,
    'upper.txt': `member ${MEMBER.toUpperCase()}`,
    'escaped.json': JSON.stringify({ u: 'placeholder' }).replace(
      'placeholder',
      [...SUBSCRIBER]
        .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .join('')
    ),
  }
  for (const [name, text] of Object.entries(forms)) writeEvidence(dirs, name, text)
  const hits = scanForLeaks(dirs.evidence, IDS)
  assert.deepEqual(
    [...new Set(hits.map((hit) => hit.file))].sort(),
    Object.keys(forms).sort()
  )
  // A clean file stays clean: no false positive from the variants.
  writeEvidence(dirs, 'clean.json', { memberRef: memberRef(MEMBER), step: 'preflight' })
  assert.ok(!hits.some((hit) => hit.file === 'clean.json'))
  assert.ok(!scanForLeaks(dirs.evidence, IDS).some((hit) => hit.file === 'clean.json'))
})

// Antigravity r13 P2: a leaking report never lands in the evidence dir, so an always-run upload
// of that dir carries nothing; the member file still reaches the private dir.
test('a leaking report leaves no file in the evidence dir', (t) => {
  const dirs = outputDirs(tempOut(t))
  assert.throws(
    () =>
      writeRunOutputs({
        dirs,
        label: 'leaky',
        report: { note: `member ${Buffer.from(MEMBER).toString('base64url')}` },
        member: { userId: MEMBER },
      }),
    (error) =>
      error.code === 'test_store_evidence_leak' && !error.message.includes(MEMBER)
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
  // Refused in memory: it was never written, so nothing had to be quarantined either.
  assert.ok(!fs.existsSync(privatePath(dirs, 'quarantine')))
  assert.equal(
    JSON.parse(fs.readFileSync(privatePath(dirs, 'leaky.member.json'), 'utf8')).userId,
    MEMBER
  )
})

test('a leaking file already in the evidence dir is moved to the private quarantine', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, path.join('maestro', 'step.json'), `{"u":"${MEMBER}"}`)
  writeEvidence(dirs, 'clean.json', { ok: true })
  assert.throws(
    () => assertEvidenceClean(dirs, [MEMBER]),
    (error) => error.code === 'test_store_evidence_leak'
  )
  assert.deepEqual(scanForLeaks(dirs.evidence, [MEMBER]), [])
  assert.ok(fs.existsSync(path.join(dirs.evidence, 'clean.json')))
  assert.ok(fs.existsSync(quarantined(dirs, path.join('maestro', 'step.json'))))
})

// Antigravity r14: a leaking report must not stop the quarantine of another leaking file.
test('a leaking report still quarantines every other leak already in the evidence dir', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, 'earlier.json', `{"u":"${MEMBER}"}`)
  assert.throws(
    () =>
      writeRunOutputs({
        dirs,
        label: 'leaky',
        report: { note: MEMBER },
        member: { userId: MEMBER },
      }),
    (error) =>
      error.code === 'test_store_evidence_leak' &&
      error.message.includes('earlier.json') &&
      error.message.includes('leaky.json (not written)')
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
  assert.ok(fs.existsSync(quarantined(dirs, path.join('earlier.json'))))
})

// Antigravity r14: --out on its own mount makes rename fail with EXDEV.
test('quarantine copies across mounts, keeping mode 600 and moving a symlink as a link', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, 'leak.json', `{"u":"${MEMBER}"}`)
  fs.chmodSync(path.join(dirs.evidence, 'leak.json'), 0o644)
  fs.symlinkSync('/etc/hosts', path.join(dirs.evidence, 'hosts-link'))
  const exdev = () => {
    throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
  }
  assert.throws(
    () => assertEvidenceClean(dirs, [MEMBER], { ops: { ...FS_OPS, rename: exdev } }),
    (error) => error.code === 'test_store_evidence_leak'
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
  const moved = quarantined(dirs, path.join('leak.json'))
  assert.equal(fs.statSync(moved).mode & 0o777, 0o600)
  assert.ok(fs.readFileSync(moved, 'utf8').includes(MEMBER))
  const link = quarantined(dirs, path.join('hosts-link'))
  assert.ok(fs.lstatSync(link).isSymbolicLink())
  assert.equal(fs.readlinkSync(link), '/etc/hosts')
  // Any other rename failure is not swallowed, and the source still leaves the evidence dir.
  writeEvidence(dirs, 'again.json', MEMBER)
  const denied = () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' })
  }
  assert.throws(
    () => assertEvidenceClean(dirs, [MEMBER], { ops: { ...FS_OPS, rename: denied } }),
    /denied/
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
})

// Antigravity r14: a symlinked dir under evidence is never followed; the link itself moves out.
test('a symlinked dir under the evidence dir is quarantined, not followed', (t) => {
  const dirs = outputDirs(tempOut(t))
  writePrivate(dirs, path.join('raw', 'device.log'), `app user ${APP_USER}`)
  fs.symlinkSync(privatePath(dirs, 'raw'), path.join(dirs.evidence, 'logs'))
  writeEvidence(dirs, 'report.json', { ok: true })
  const hits = scanForLeaks(dirs.evidence, IDS)
  assert.deepEqual(hits, [{ file: 'logs', needle: null, kind: 'non-regular' }])
  assert.throws(
    () => assertEvidenceClean(dirs, IDS),
    (error) => error.code === 'test_store_evidence_leak'
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), ['report.json'])
  assert.ok(fs.lstatSync(quarantined(dirs, path.join('logs'))).isSymbolicLink())
  // The private file the link pointed at is untouched.
  assert.ok(fs.existsSync(privatePath(dirs, path.join('raw', 'device.log'))))
})

const exdevOps = (overrides = {}) => ({
  ...FS_OPS,
  rename: () => {
    throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
  },
  ...overrides,
})
const failing = (code) => () => {
  throw Object.assign(new Error(`injected ${code}`), { code })
}

// Antigravity r15: a reused out dir already holds a quarantine entry of the same name.
test('a reused out dir never collides: each quarantined entry gets its own name', (t) => {
  const dirs = outputDirs(tempOut(t))
  for (let run = 0; run < 2; run += 1) {
    fs.symlinkSync('/etc/hosts', path.join(dirs.evidence, 'hosts-link'))
    writeEvidence(dirs, 'leak.json', MEMBER)
    assert.throws(
      () => assertEvidenceClean(dirs, [MEMBER], { ops: exdevOps() }),
      (error) => error.code === 'test_store_evidence_leak'
    )
    assert.deepEqual(fs.readdirSync(dirs.evidence), [])
  }
  // Two runs, two entries each, four distinct quarantine directories.
  assert.equal(fs.readdirSync(privatePath(dirs, 'quarantine')).length, 4)
})

// Antigravity r15: a failed copy or chmod still takes the source out of the evidence dir.
test('a failing copy or chmod removes the source anyway and throws the original error', (t) => {
  for (const [name, overrides] of [
    ['copy', { copyFile: failing('ENOSPC') }],
    ['chmod', { chmod: failing('EPERM') }],
    ['symlink', { symlink: failing('EEXIST') }],
  ]) {
    const dirs = outputDirs(tempOut(t))
    if (name === 'symlink') fs.symlinkSync('/etc/hosts', path.join(dirs.evidence, 'link'))
    else writeEvidence(dirs, 'leak.json', MEMBER)
    assert.throws(
      () => assertEvidenceClean(dirs, [MEMBER], { ops: exdevOps(overrides) }),
      /injected/,
      name
    )
    assert.deepEqual(fs.readdirSync(dirs.evidence), [], name)
  }
})

test('a source that cannot be removed is named as still in the evidence dir', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, 'leak.json', MEMBER)
  assert.throws(
    () =>
      assertEvidenceClean(dirs, [MEMBER], {
        ops: exdevOps({ copyFile: failing('ENOSPC'), unlink: failing('EBUSY') }),
      }),
    (error) =>
      error.code === 'test_store_quarantine_failed' &&
      error.message.includes('leak.json') &&
      error.message.includes('still in the evidence dir') &&
      !error.message.includes(MEMBER)
  )
})

// Antigravity r16: one entry's error must not hide another entry still in the evidence dir.
test('a failed quarantine names every file still in evidence, with the originals as causes', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, 'a.json', MEMBER)
  writeEvidence(dirs, 'b.json', MEMBER)
  const ops = exdevOps({
    // a: the copy fails, then its source is removed. b: copied, but its source cannot be removed.
    copyFile: (from, to) => {
      if (from.endsWith('a.json')) failing('ENOSPC')()
      FS_OPS.copyFile(from, to)
    },
    unlink: (file) => {
      if (file.endsWith('b.json')) failing('EBUSY')()
      FS_OPS.unlink(file)
    },
  })
  assert.throws(
    () => assertEvidenceClean(dirs, [MEMBER], { ops }),
    (error) =>
      error.code === 'test_store_quarantine_failed' &&
      error.message.includes('b.json') &&
      !error.message.includes('a.json') &&
      error.cause instanceof AggregateError &&
      error.cause.errors.length === 2
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), ['b.json'])
})

test('when every failed entry still left the evidence dir, the first original error stands', (t) => {
  const dirs = outputDirs(tempOut(t))
  writeEvidence(dirs, 'a.json', MEMBER)
  assert.throws(
    () =>
      assertEvidenceClean(dirs, [MEMBER], {
        ops: exdevOps({ copyFile: failing('ENOSPC') }),
      }),
    (error) => error.code === 'ENOSPC'
  )
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
})

/** A process stand-in: events, exit, exitCode and a stderr buffer. */
function fakeProcess() {
  const proc = new EventEmitter()
  proc.exitCode = undefined
  proc.err = ''
  proc.stderr = { write: (text) => (proc.err += text) }
  proc.exits = 0
  proc.exit = (code) => {
    proc.exits += 1
    proc.exitCode = code
    proc.emit('exit', code)
  }
  // Node's rule: a signal with no listener takes the default action and kills the process on
  // the spot, cleanup or not. The stand-in records the kill and aborts the current stack.
  const emit = proc.emit.bind(proc)
  proc.emit = (event, ...args) => {
    if ((event === 'SIGINT' || event === 'SIGTERM') && proc.listenerCount(event) === 0) {
      proc.killed = event
      throw new Error(`killed by ${event}`)
    }
    return emit(event, ...args)
  }
  return proc
}

// Antigravity r16: every exit scans the evidence dir.
test('the exit guard quarantines leaks on a passing exit and fails it', (t) => {
  const dirs = outputDirs(tempOut(t))
  const ids = []
  const proc = fakeProcess()
  installEvidenceGuard({ dirs, ids, proc })
  ids.push(MEMBER)
  writeEvidence(dirs, 'late.json', MEMBER)
  proc.emit('exit', 0)
  assert.equal(proc.exitCode, 1)
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
  assert.match(proc.err, /test_store_evidence_leak: quarantined late\.json/)
  assert.ok(!proc.err.includes(MEMBER))
})

test('SIGINT and SIGTERM exit through the guard with 130 and 143', (t) => {
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const dirs = outputDirs(tempOut(t))
    const proc = fakeProcess()
    installEvidenceGuard({ dirs, ids: [MEMBER], proc })
    writeEvidence(dirs, 'partial.json', MEMBER)
    proc.emit(signal)
    assert.equal(proc.exitCode, code, signal)
    assert.deepEqual(fs.readdirSync(dirs.evidence), [], signal)
  }
})

test('a run that throws mid-run quarantines the leak and keeps the original error as the cause', (t) => {
  const out = tempOut(t)
  const lib = pathToFileURL(
    fileURLToPath(new URL('./test-store-output.mjs', import.meta.url))
  )
  const script = [
    `import { installEvidenceGuard, outputDirs, writeEvidence } from ${JSON.stringify(lib.href)}`,
    `const dirs = outputDirs(${JSON.stringify(out)})`,
    `installEvidenceGuard({ dirs, ids: [${JSON.stringify(MEMBER)}] })`,
    `writeEvidence(dirs, 'metro-copy.log', ${JSON.stringify(`bundling for ${MEMBER}`)})`,
    "throw new Error('mid-run failure')",
  ].join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /mid-run failure/)
  assert.match(result.stderr, /test_store_evidence_leak: quarantined metro-copy\.log/)
  assert.deepEqual(fs.readdirSync(out), [])
  assert.ok(quarantined({ private: `${out}.private` }, 'metro-copy.log'))
})

test('the driver installs the exit guard right after its dirs and feeds it every id it learns', () => {
  const driver = fs.readFileSync('scripts/run-test-store-journey.mjs', 'utf8')
  const dirsAt = driver.indexOf("const dirs = outputDirs(option('out'))")
  const guardAt = driver.indexOf('installEvidenceGuard({ dirs, ids: scanIds })')
  assert.ok(dirsAt > 0 && guardAt > dirsAt)
  // Nothing that can throw sits between them.
  const between = driver
    .slice(dirsAt, guardAt)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.doesNotMatch(between, /require|await|throw/)
  for (const push of [
    'scanIds.push(testStoreKey)',
    'scanIds.push(...Object.values(bypassHeaders))',
    'scanIds.push(member.userId, member.token)',
  ])
    assert.ok(driver.includes(push), push)
  // adb reverse --remove cannot hang the exit path (Antigravity r18).
  assert.match(
    driver,
    /'reverse', '--remove', `tcp:\$\{port\}`\], \{\s*timeout: 5_000,\s*killSignal: 'SIGKILL',/
  )
})

// Antigravity r17 (1): a second Ctrl-C during the exit scan must not kill the run mid-scan.
test('a second SIGINT (or a SIGTERM) during the exit scan is ignored: evidence clean, exit 130', (t) => {
  const dirs = outputDirs(tempOut(t))
  const proc = fakeProcess()
  let repeated = false
  const ops = {
    ...FS_OPS,
    rename: (from, to) => {
      if (!repeated) {
        repeated = true
        proc.emit('SIGINT')
        proc.emit('SIGTERM')
      }
      FS_OPS.rename(from, to)
    },
  }
  installEvidenceGuard({ dirs, ids: [MEMBER], ops, proc })
  writeEvidence(dirs, 'a.json', MEMBER)
  writeEvidence(dirs, 'b.json', MEMBER)
  proc.emit('SIGINT')
  assert.equal(repeated, true)
  assert.equal(proc.killed, undefined)
  // The first signal decides the code; the repeats start no second exit.
  assert.equal(proc.exitCode, 130)
  assert.equal(proc.exits, 1)
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
})

test('teardowns run once each, and a failing one does not stop the rest', (t) => {
  const dirs = outputDirs(tempOut(t))
  const proc = fakeProcess()
  const order = []
  const guard = installEvidenceGuard({ dirs, ids: [MEMBER], proc })
  writeEvidence(dirs, 'leak.json', MEMBER)
  guard.teardown('metro', () => {
    order.push(['metro', fs.readdirSync(dirs.evidence).length])
  })
  guard.teardown('broken', () => {
    throw new Error('already gone')
  })
  guard.teardown('log-stream', () => order.push(['log-stream']))
  guard.runTeardowns()
  proc.emit('SIGTERM')
  assert.equal(proc.exitCode, 143)
  // The normal path ran them first (evidence still dirty then); the exit path did not repeat them.
  assert.deepEqual(order, [['metro', 1], ['log-stream']])
  assert.match(proc.err, /test_store_teardown_failed: broken: already gone/)
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
})

/** Runs `script` as an ES module child; resolves { code, stdout, stderr }. */
function runChild(script, { env = {}, onReady } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (onReady && stdout.includes('ready')) {
        const ready = onReady
        onReady = undefined
        ready(child)
      }
    })
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// Antigravity r17 (2): the teardowns run on every way out of the process.
test('each registered teardown runs on throw, process.exit, SIGINT and SIGTERM', async (t) => {
  const lib = pathToFileURL(
    fileURLToPath(new URL('./test-store-output.mjs', import.meta.url))
  )
  for (const [mode, expected] of [
    ['throw', 1],
    ['exit', 3],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const out = tempOut(t)
    const script = [
      'import fs from "node:fs"',
      `import { installEvidenceGuard, outputDirs } from ${JSON.stringify(lib.href)}`,
      `const dirs = outputDirs(${JSON.stringify(out)})`,
      'const guard = installEvidenceGuard({ dirs, ids: [] })',
      'for (const name of ["metro", "log-stream", "adb-reverse"])',
      '  guard.teardown(name, () => fs.writeFileSync(`${dirs.private}/${name}.done`, ""))',
      `const mode = ${JSON.stringify(mode)}`,
      'if (mode === "throw") throw new Error("crash")',
      'if (mode === "exit") process.exit(3)',
      'console.log("ready")',
      'setInterval(() => {}, 1000)',
    ].join('\n')
    const result = await runChild(script, {
      onReady: (child) => child.kill(mode),
    })
    assert.equal(result.code, expected, `${mode}: ${result.stderr}`)
    for (const name of ['metro', 'log-stream', 'adb-reverse'])
      assert.ok(fs.existsSync(`${out}.private/${name}.done`), `${mode}: ${name}`)
  }
})

// TEA r18 (2): a child still running at the scan could write into evidence after it.
test('teardowns stop their children before the exit scan, so a late write is quarantined too', async (t) => {
  const lib = pathToFileURL(
    fileURLToPath(new URL('./test-store-output.mjs', import.meta.url))
  )
  const out = tempOut(t)
  const script = [
    'import { spawn } from "node:child_process"',
    `import { installEvidenceGuard, outputDirs } from ${JSON.stringify(lib.href)}`,
    `const dirs = outputDirs(${JSON.stringify(out)})`,
    `const guard = installEvidenceGuard({ dirs, ids: [${JSON.stringify(MEMBER)}] })`,
    // A writer that keeps leaking into evidence and leaks once more when told to stop.
    'const writer = spawn("sh", ["-c", `trap \'echo $ID > "$EV/late.json"; exit 0\' TERM; while :; do echo $ID > "$EV/loop.json"; sleep 0.05; done`], {',
    `  env: { ...process.env, ID: ${JSON.stringify(MEMBER)}, EV: dirs.evidence },`,
    '  stdio: "ignore",',
    '})',
    'guard.teardown("writer", () => writer.kill("SIGTERM"), { pids: [writer.pid] })',
    'setTimeout(() => console.log("ready"), 300)',
    'setInterval(() => {}, 1000)',
  ].join('\n')
  const result = await runChild(script, { onReady: (child) => child.kill('SIGTERM') })
  assert.equal(result.code, 143, result.stderr)
  // Anything still running would have written by now.
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.deepEqual(scanForLeaks(out, [MEMBER]), [])
  assert.ok(quarantined({ private: `${out}.private` }, 'late.json'))
})

// Antigravity r18 C26: on a signal, with no runTeardowns call first, teardown runs before scan.
test('the exit path tears down before it scans', (t) => {
  const dirs = outputDirs(tempOut(t))
  const proc = fakeProcess()
  const seen = []
  const guard = installEvidenceGuard({ dirs, ids: [MEMBER], proc })
  writeEvidence(dirs, 'leak.json', MEMBER)
  guard.teardown('metro', () => seen.push(fs.readdirSync(dirs.evidence).length))
  proc.emit('SIGTERM')
  // The leak was still in evidence when the teardown ran, so the scan came after it.
  assert.deepEqual(seen, [1])
  assert.equal(proc.exitCode, 143)
  assert.deepEqual(fs.readdirSync(dirs.evidence), [])
})

// A child that exited while the exit path holds the thread is a zombie until Node reaps it; the
// teardown wait must count it as exited, or every exit would sit out the whole deadline.
test('the teardown wait treats an exited, unreaped child as gone', () => {
  const child = spawn('sh', ['-c', 'sleep 0.2'], { stdio: 'ignore' })
  const started = Date.now()
  const left = awaitExit([child.pid], 3_000)
  assert.deepEqual(left, [])
  assert.ok(Date.now() - started < 2_000, `waited ${Date.now() - started} ms`)
})

/** A shell that ignores SIGTERM; only SIGKILL stops it. */
function stubborn(t, options = {}) {
  const child = spawn('sh', ['-c', "trap '' TERM; while :; do sleep 0.05; done"], {
    stdio: 'ignore',
    ...options,
  })
  t.after(() => {
    try {
      process.kill(options.detached ? -child.pid : child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  })
  return child
}

const exitOf = (child, ms = 3_000) =>
  Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve(signal))),
    new Promise((resolve) => setTimeout(() => resolve('still running'), ms)),
  ])

// Antigravity r19 (2): what outlives the deadline is SIGKILLed.
test('awaitExit SIGKILLs a child that ignores SIGTERM past the deadline', async (t) => {
  const child = stubborn(t)
  await new Promise((resolve) => setTimeout(resolve, 200))
  child.kill('SIGTERM')
  const exited = exitOf(child)
  assert.deepEqual(awaitExit([child.pid], 300), [child.pid])
  assert.equal(await exited, 'SIGKILL')
})

// Antigravity r19 (3): a pid the OS may have recycled is never signalled.
test('a child that exited mid-run is dropped from the teardown and never signalled', async (t) => {
  const dirs = outputDirs(tempOut(t))
  const signalled = []
  const guard = installEvidenceGuard({
    dirs,
    ids: [],
    proc: fakeProcess(),
    kill: (pid, signal) => signalled.push([pid, signal]),
  })
  const done = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' })
  guard.child('done', done)
  await new Promise((resolve) => done.once('exit', resolve))
  const live = stubborn(t)
  guard.child('live', live)
  guard.runTeardowns()
  assert.deepEqual(signalled, [[live.pid, 'SIGTERM']])
})

test('a process group is signalled only while ps shows a member of it', async (t) => {
  const dirs = outputDirs(tempOut(t))
  const signalled = []
  const guard = installEvidenceGuard({
    dirs,
    ids: [],
    proc: fakeProcess(),
    kill: (pid, signal) => signalled.push([pid, signal]),
    waitMs: 100,
  })
  const gone = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore', detached: true })
  await new Promise((resolve) => gone.once('exit', resolve))
  assert.deepEqual(stillRunning([-gone.pid]), [])
  guard.child('gone-group', gone, { group: true })
  const alive = stubborn(t, { detached: true })
  await new Promise((resolve) => setTimeout(resolve, 100))
  guard.child('live-group', alive, { group: true })
  guard.runTeardowns()
  assert.deepEqual(signalled, [[-alive.pid, 'SIGTERM']])
})

// Antigravity r20 M5: guard.child with the real kill escalates to SIGKILL within waitMs.
test('guard.child SIGKILLs a TERM-trapping child within waitMs, with the real kill', async (t) => {
  const dirs = outputDirs(tempOut(t))
  const guard = installEvidenceGuard({ dirs, ids: [], proc: fakeProcess(), waitMs: 300 })
  const child = stubborn(t)
  await new Promise((resolve) => setTimeout(resolve, 200))
  guard.child('stubborn', child)
  const exited = exitOf(child)
  const started = Date.now()
  guard.runTeardowns()
  assert.ok(Date.now() - started < 2_000)
  assert.equal(await exited, 'SIGKILL')
})

// Antigravity r20 (2): a failed spawn has no pid; nothing is registered or signalled.
test('guard.child ignores a child whose spawn failed (no pid)', async (t) => {
  const dirs = outputDirs(tempOut(t))
  const signalled = []
  const guard = installEvidenceGuard({
    dirs,
    ids: [],
    proc: fakeProcess(),
    kill: (pid, signal) => signalled.push([pid, signal]),
  })
  const missing = spawn(path.join(os.tmpdir(), `no-such-binary-${process.pid}`), [], {
    stdio: 'ignore',
  })
  const failed = new Promise((resolve) => missing.once('error', resolve))
  assert.equal(missing.pid, undefined)
  guard.child('missing', missing)
  guard.child('missing-group', missing, { group: true })
  guard.runTeardowns()
  assert.deepEqual(signalled, [])
  assert.equal((await failed).code, 'ENOENT')
})

// Antigravity r20 (3): a stand-in leader and ps table, so a reused group id can be staged.
const PGID = 2 ** 30
function fakeLeader() {
  const child = new EventEmitter()
  child.pid = PGID
  child.exitCode = null
  child.signalCode = null
  return child
}
function groupGuard(t, table) {
  const signalled = []
  const guard = installEvidenceGuard({
    dirs: outputDirs(tempOut(t)),
    ids: [],
    proc: fakeProcess(),
    kill: (pid, signal) => signalled.push([pid, signal]),
    psTable: () => table.rows,
    waitMs: 0,
  })
  return { guard, signalled }
}

test('a Metro group with no member at the leader exit is dropped, even if the id comes back', (t) => {
  const table = { rows: [] }
  const { guard, signalled } = groupGuard(t, table)
  const leader = fakeLeader()
  guard.child('metro', leader, { group: true })
  leader.emit('exit', 0, null)
  // Someone else's group now carries the same id.
  table.rows = [{ pid: 4242, pgid: PGID }]
  guard.runTeardowns()
  assert.deepEqual(signalled, [])
})

test('a Metro group is signalled while a member from the exit snapshot is alive in it', (t) => {
  const table = { rows: [{ pid: 4242, pgid: PGID }] }
  const { guard, signalled } = groupGuard(t, table)
  const leader = fakeLeader()
  guard.child('metro', leader, { group: true })
  leader.emit('exit', 0, null)
  guard.runTeardowns()
  assert.deepEqual(signalled, [[-PGID, 'SIGTERM']])
  // The same snapshot member, now in another group, is no reason to signal this one.
  const moved = { rows: [{ pid: 4242, pgid: PGID }] }
  const other = groupGuard(t, moved)
  const second = fakeLeader()
  other.guard.child('metro', second, { group: true })
  second.emit('exit', 0, null)
  moved.rows = [
    { pid: 4242, pgid: 77 },
    { pid: 5151, pgid: PGID },
  ]
  other.guard.runTeardowns()
  assert.deepEqual(other.signalled, [])
})

test('a Metro group whose leader still runs is signalled', (t) => {
  const { guard, signalled } = groupGuard(t, { rows: [{ pid: PGID, pgid: PGID }] })
  guard.child('metro', fakeLeader(), { group: true })
  guard.runTeardowns()
  assert.deepEqual(signalled, [[-PGID, 'SIGTERM']])
})

// Antigravity r21 (2): with a snapshot, no ps at teardown decides by signal 0 on the group.
test('a Metro group is still signalled when ps fails at teardown', async (t) => {
  const leader = spawn('sh', ['-c', 'sleep 30 & exit 0'], {
    stdio: 'ignore',
    detached: true,
  })
  t.after(() => {
    try {
      process.kill(-leader.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  })
  await new Promise((resolve) => leader.once('exit', resolve))
  // The leader is gone and its sleep lives on in the group.
  assert.deepEqual(stillRunning([-leader.pid]), [-leader.pid])
  let psWorks = true
  const signalled = []
  const guard = installEvidenceGuard({
    dirs: outputDirs(tempOut(t)),
    ids: [],
    proc: fakeProcess(),
    kill: (pid, signal) => signalled.push([pid, signal]),
    psTable: () => (psWorks ? readPsTable() : null),
    waitMs: 0,
  })
  guard.child('metro', leader, { group: true })
  psWorks = false
  guard.runTeardowns()
  assert.deepEqual(signalled, [[-leader.pid, 'SIGTERM']])
})
