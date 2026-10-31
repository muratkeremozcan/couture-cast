import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  IPAD_ANCHOR_SOURCES,
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
// Stands for the temp repository's HEAD; evidence() writes the real commit in its place.
const RECORDED = 'recorded-head'
const valid = () => ({
  test: 'X-IPAD-ANCHOR',
  deviceClass: 'iPad',
  environment: 'simulator',
  osVersion: '18.1',
  commit: RECORDED,
  result: 'anchored_to_share',
  screenshot: {
    file: 'ipad-anchor-proof.png',
    sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
  },
  recordedAt: '2026-10-30T21:00:00.000Z',
})
// Git without the caller's GIT_* variables, so a hook's GIT_DIR cannot redirect it.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
)
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim()
/** Commits `content` to each named path and returns the new commit. */
function commitFiles(repo, files, message) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), content)
  }
  git(repo, 'add', '--', ...Object.keys(files))
  git(repo, 'commit', '-q', '--no-verify', '-m', message)
  return git(repo, 'rev-parse', 'HEAD')
}
/** A temp repository holding the anchor sources, the commit a proof records. */
function anchorRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-evidence-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'evidence@example.invalid')
  git(repo, 'config', 'user.name', 'Evidence Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  const head = commitFiles(
    repo,
    Object.fromEntries(IPAD_ANCHOR_SOURCES.map((file) => [file, `${file} v1\n`])),
    'anchor sources'
  )
  return { repo, head }
}
function writeEvidence(directory, head, record, image) {
  fs.mkdirSync(directory, { recursive: true })
  if (image) fs.writeFileSync(path.join(directory, 'ipad-anchor-proof.png'), image)
  if (record === null) return directory
  const recorded = record?.commit === RECORDED ? { ...record, commit: head } : record
  fs.writeFileSync(
    path.join(directory, IPAD_EVIDENCE_RECORD),
    typeof recorded === 'string' ? recorded : JSON.stringify(recorded)
  )
  return directory
}
/** Evidence in a temp repository whose HEAD is the recorded commit, unless overridden. */
function evidence(t, record = valid(), { image = screenshotBytes } = {}) {
  const { repo, head } = anchorRepo(t)
  return writeEvidence(path.join(repo, IPAD_EVIDENCE_DIRECTORY), head, record, image)
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
    const head = git(directory, 'rev-parse', 'HEAD')
    const record = writeIpadEvidence(directory, {
      screenshot: 'ipad-anchor-proof.png',
      osVersion: '18.1',
      environment: 'device',
      commit: head,
      recordedAt: valid().recordedAt,
    })
    assert.deepEqual(record, { ...valid(), environment: 'device', commit: head })
    assert.deepEqual(ipadEvidenceProblems(directory), [])
    assert.throws(
      () =>
        writeIpadEvidence(evidence(t, null, { image: null }), {
          screenshot: 'ipad-anchor-proof.png',
          osVersion: '18.1',
          environment: 'device',
          commit: 'a'.repeat(40),
        }),
      { code: 'ENOENT' }
    )
  })

  test('a recorded commit that HEAD descends from, with the anchor sources unchanged, passes', (t) => {
    const { repo, head } = anchorRepo(t)
    commitFiles(repo, { 'README.md': 'unrelated\n' }, 'later work elsewhere')
    const directory = writeEvidence(
      path.join(repo, IPAD_EVIDENCE_DIRECTORY),
      head,
      valid(),
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), [])
  })

  for (const source of IPAD_ANCHOR_SOURCES)
    test(`a later change to ${path.basename(source)} makes the proof stale`, (t) => {
      const { repo, head } = anchorRepo(t)
      commitFiles(repo, { [source]: 'moved the anchor\n' }, 'anchor change')
      const directory = writeEvidence(repo, head, valid(), screenshotBytes)
      assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_anchor_changed'])
      assert.throws(() => assertIpadEvidence(directory), /anchor_changed/)
    })

  test('a recorded commit that HEAD does not descend from fails', (t) => {
    const { repo, head } = anchorRepo(t)
    const side = git(repo, 'commit-tree', `${head}^{tree}`, '-m', 'side proof')
    const directory = writeEvidence(
      repo,
      head,
      { ...valid(), commit: side },
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), [
      'ipad_evidence_commit_not_ancestor',
    ])
  })

  test('a recorded commit the repository does not hold fails', (t) => {
    const { repo, head } = anchorRepo(t)
    const directory = writeEvidence(
      repo,
      head,
      { ...valid(), commit: 'f'.repeat(40) },
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_commit_unknown'])
  })

  test('a shallow clone cannot prove the lineage and fails with its own code', (t) => {
    const { repo, head } = anchorRepo(t)
    commitFiles(repo, { 'README.md': 'unrelated\n' }, 'later work elsewhere')
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-shallow-'))
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }))
    git(clone, 'clone', '-q', '--depth', '1', `file://${repo}`, 'checkout')
    const directory = writeEvidence(
      path.join(clone, 'checkout'),
      head,
      valid(),
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_shallow_clone'])
  })

  test('a shallow clone deep enough to hold the recorded commit is checked as usual', (t) => {
    const { repo, head } = anchorRepo(t)
    commitFiles(repo, { 'README.md': 'unrelated\n' }, 'later work elsewhere')
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-shallow-'))
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }))
    git(clone, 'clone', '-q', '--depth', '2', `file://${repo}`, 'checkout')
    const directory = writeEvidence(
      path.join(clone, 'checkout'),
      head,
      valid(),
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), [])
  })

  test('evidence outside a git checkout fails closed', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-no-git-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    writeEvidence(directory, 'a'.repeat(40), valid(), screenshotBytes)
    assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_git_unavailable'])
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

// The native-harness gate runs this file on CI. A depth-1 checkout lacks the recorded commit
// and would fail as ipad_evidence_shallow_clone, so every job that runs the gate fetches
// full history.
test('every CI job that runs the native-harness gate checks out full history', () => {
  const workflow = parse(
    fs.readFileSync(path.join(repo, '.github/workflows/pr-share-card-native.yml'), 'utf8')
  )
  const gated = Object.entries(workflow.jobs).filter(([, job]) =>
    job.steps.some((row) => /node-test-gate\.mjs native-harness/.test(row.run ?? ''))
  )
  assert.ok(gated.length > 0)
  for (const [name, job] of gated) {
    const checkout = job.steps.find((row) => row.uses?.startsWith('actions/checkout@'))
    assert.equal(checkout?.with?.['fetch-depth'], 0, name)
  }
})

// U-HARNESS-IPAD-EVIDENCE against the repository. This is the gate the spec asks for: it fails the
// pull request until the owner's local iPad proof (X-IPAD-ANCHOR) is committed under
// _bmad-output/test-artifacts/story-6-9/. See the README there for the record format.
test('U-HARNESS-IPAD-EVIDENCE: the committed X-IPAD-ANCHOR record and screenshot pass the check', () => {
  const directory = path.join(repo, IPAD_EVIDENCE_DIRECTORY)
  assert.deepEqual(ipadEvidenceProblems(directory), [])
})
