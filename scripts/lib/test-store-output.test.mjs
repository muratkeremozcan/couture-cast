// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertEvidenceClean,
  FS_OPS,
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
