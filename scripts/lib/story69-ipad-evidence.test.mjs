import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  IPAD_EVIDENCE_DIRECTORY,
  IPAD_EVIDENCE_RECORD,
  assertIpadEvidence,
  ipadEvidenceProblems,
  writeIpadEvidence,
} from './story69-ipad-evidence.mjs'

const repo = path.resolve(import.meta.dirname, '../..')
const screenshotBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('popover anchored to Share'),
])
const valid = () => ({
  test: 'X-IPAD-ANCHOR',
  deviceClass: 'iPad',
  environment: 'simulator',
  osVersion: '18.1',
  commit: '185e827c949a5a038b18f6c1fd1feb22f3aad3e9',
  result: 'anchored_to_share',
  screenshot: {
    file: 'ipad-anchor-proof.png',
    sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
  },
  recordedAt: '2026-10-30T21:00:00.000Z',
})
function evidence(t, record = valid(), { image = screenshotBytes } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-evidence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  if (image) fs.writeFileSync(path.join(directory, 'ipad-anchor-proof.png'), image)
  if (record !== null)
    fs.writeFileSync(
      path.join(directory, IPAD_EVIDENCE_RECORD),
      typeof record === 'string' ? record : JSON.stringify(record)
    )
  return directory
}

describe('X-IPAD-ANCHOR evidence check', () => {
  test('a complete record whose committed screenshot matches its SHA256 passes', (t) => {
    const directory = evidence(t)
    assert.deepEqual(ipadEvidenceProblems(directory), [])
    assert.equal(assertIpadEvidence(directory).deviceClass, 'iPad')
    const onDevice = { ...valid(), environment: 'device', osVersion: '26' }
    assert.deepEqual(ipadEvidenceProblems(evidence(t, onDevice)), [])
  })

  test('a missing or unreadable record fails', (t) => {
    assert.deepEqual(ipadEvidenceProblems(evidence(t, null)), [
      'ipad_evidence_record_missing',
    ])
    assert.deepEqual(ipadEvidenceProblems(evidence(t, '{not json')), [
      'ipad_evidence_record_unreadable',
    ])
    assert.throws(() => assertIpadEvidence(evidence(t, null)), /record_missing/)
  })

  test('the record has exactly its keys: nothing missing and nothing extra', (t) => {
    const missing = valid()
    delete missing.commit
    assert.deepEqual(ipadEvidenceProblems(evidence(t, missing)), [
      'ipad_evidence_record_keys',
    ])
    assert.deepEqual(
      ipadEvidenceProblems(evidence(t, { ...valid(), notes: 'owner account x' })),
      ['ipad_evidence_record_keys']
    )
    assert.deepEqual(ipadEvidenceProblems(evidence(t, [])), ['ipad_evidence_record_keys'])
    assert.deepEqual(
      ipadEvidenceProblems(
        evidence(t, { ...valid(), screenshot: { ...valid().screenshot, path: '/x' } })
      ),
      ['ipad_evidence_screenshot_fields']
    )
  })

  for (const [field, value, code] of [
    ['test', 'X-OTHER', 'ipad_evidence_test'],
    ['deviceClass', 'iPhone', 'ipad_evidence_device_class'],
    ['environment', 'emulator', 'ipad_evidence_environment'],
    ['osVersion', '', 'ipad_evidence_os_version'],
    ['osVersion', 'iPadOS 18', 'ipad_evidence_os_version'],
    ['commit', 'HEAD', 'ipad_evidence_commit'],
    ['commit', '185e827c', 'ipad_evidence_commit'],
    ['result', 'presented', 'ipad_evidence_result'],
    ['result', 'anchored_to_view', 'ipad_evidence_result'],
    ['recordedAt', 'yesterday', 'ipad_evidence_recorded_at'],
    ['recordedAt', '2026-13-45T99:00:00Z', 'ipad_evidence_recorded_at'],
  ])
    test(`${field} ${JSON.stringify(value)} fails as ${code}`, (t) => {
      assert.deepEqual(
        ipadEvidenceProblems(evidence(t, { ...valid(), [field]: value })),
        [code]
      )
    })

  test('the screenshot must be a committed PNG beside the record with the recorded SHA256', (t) => {
    assert.deepEqual(ipadEvidenceProblems(evidence(t, valid(), { image: null })), [
      'ipad_evidence_screenshot_missing',
    ])
    const changed = Buffer.concat([screenshotBytes, Buffer.from('edited')])
    assert.deepEqual(ipadEvidenceProblems(evidence(t, valid(), { image: changed })), [
      'ipad_evidence_screenshot_digest',
    ])
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const record = valid()
    record.screenshot.sha256 = createHash('sha256').update(jpeg).digest('hex')
    assert.deepEqual(ipadEvidenceProblems(evidence(t, record, { image: jpeg })), [
      'ipad_evidence_screenshot_not_png',
    ])
    for (const file of ['../ipad.png', '/tmp/ipad.png', 'ipad.jpg', 'Sub/ipad.png'])
      assert.deepEqual(
        ipadEvidenceProblems(
          evidence(t, { ...valid(), screenshot: { ...valid().screenshot, file } })
        ),
        ['ipad_evidence_screenshot_fields'],
        file
      )
    const directory = evidence(t)
    fs.rmSync(path.join(directory, 'ipad-anchor-proof.png'))
    fs.mkdirSync(path.join(directory, 'ipad-anchor-proof.png'))
    assert.deepEqual(ipadEvidenceProblems(directory), [
      'ipad_evidence_screenshot_missing',
    ])
  })

  test('record writes a verified record for a real screenshot and refuses a missing one', (t) => {
    const directory = evidence(t, null)
    const record = writeIpadEvidence(directory, {
      screenshot: 'ipad-anchor-proof.png',
      osVersion: '18.1',
      environment: 'device',
      commit: valid().commit,
      recordedAt: valid().recordedAt,
    })
    assert.deepEqual(record, { ...valid(), environment: 'device' })
    assert.deepEqual(ipadEvidenceProblems(directory), [])
    assert.throws(
      () =>
        writeIpadEvidence(evidence(t, null, { image: null }), {
          screenshot: 'ipad-anchor-proof.png',
          osVersion: '18.1',
          environment: 'device',
          commit: valid().commit,
        }),
      { code: 'ENOENT' }
    )
  })

  test('the CLI names the closed problem and exits nonzero', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/lib/story69-ipad-evidence.mjs', 'unknown'],
      { cwd: repo, encoding: 'utf8' }
    )
    assert.equal(result.status, 1)
    assert.equal(result.stderr.trim(), 'ipad_evidence_action_invalid')
  })
})

// U-HARNESS-IPAD-EVIDENCE against the repository. This is the gate the spec asks for: it fails the
// pull request until the owner's local iPad proof (X-IPAD-ANCHOR) is committed under
// _bmad-output/test-artifacts/story-6-9/. See the README there for the record format.
test('U-HARNESS-IPAD-EVIDENCE: the committed X-IPAD-ANCHOR record and screenshot pass the check', () => {
  const directory = path.join(repo, IPAD_EVIDENCE_DIRECTORY)
  assert.deepEqual(ipadEvidenceProblems(directory), [])
})
