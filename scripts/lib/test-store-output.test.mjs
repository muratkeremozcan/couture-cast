// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertEvidenceClean,
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
