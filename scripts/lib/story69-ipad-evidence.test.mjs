// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
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
// Stands for the temp repository's HEAD and its anchor source blobs; writeEvidence() writes the
// real values in their place.
const RECORDED = 'recorded-head'
const valid = () => ({
  test: 'X-IPAD-ANCHOR',
  deviceClass: 'iPad',
  environment: 'simulator',
  osVersion: '18.1',
  commit: RECORDED,
  sources: RECORDED,
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
/** The blob SHA of each anchor source in `rev`, keyed by path, as a record stores them. */
const blobsAt = (repo, rev) =>
  Object.fromEntries(
    [...IPAD_ANCHOR_SOURCES]
      .sort()
      .map((file) => [file, git(repo, 'rev-parse', `${rev}:${file}`)])
  )
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
  return { repo, head, sources: blobsAt(repo, head) }
}
function writeEvidence(directory, { head, sources }, record, image) {
  fs.mkdirSync(directory, { recursive: true })
  if (image) fs.writeFileSync(path.join(directory, 'ipad-anchor-proof.png'), image)
  if (record === null) return directory
  const recorded =
    record !== null && typeof record === 'object' && !Array.isArray(record)
      ? {
          ...record,
          ...(record.commit === RECORDED && { commit: head }),
          ...(record.sources === RECORDED && { sources }),
        }
      : record
  fs.writeFileSync(
    path.join(directory, IPAD_EVIDENCE_RECORD),
    typeof recorded === 'string' ? recorded : JSON.stringify(recorded)
  )
  return directory
}
/** Evidence in a temp repository whose HEAD is the recorded commit, unless overridden. */
function evidence(t, record = valid(), { image = screenshotBytes } = {}) {
  const anchors = anchorRepo(t)
  return writeEvidence(
    path.join(anchors.repo, IPAD_EVIDENCE_DIRECTORY),
    anchors,
    record,
    image
  )
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

  test('record reads the anchor source blobs from the proven commit and verifies the record', (t) => {
    const anchors = anchorRepo(t)
    const directory = writeEvidence(
      path.join(anchors.repo, IPAD_EVIDENCE_DIRECTORY),
      anchors,
      null,
      screenshotBytes
    )
    const record = writeIpadEvidence(directory, {
      screenshot: 'ipad-anchor-proof.png',
      osVersion: '18.1',
      environment: 'device',
      commit: anchors.head,
      recordedAt: valid().recordedAt,
    })
    assert.deepEqual(record, {
      ...valid(),
      environment: 'device',
      commit: anchors.head,
      sources: anchors.sources,
    })
    assert.deepEqual(Object.keys(record.sources), [...IPAD_ANCHOR_SOURCES].sort())
    assert.deepEqual(ipadEvidenceProblems(directory), [])
  })

  test('record refuses a missing screenshot, an unknown commit and a commit without the sources', (t) => {
    const write = (directory, commit) => () =>
      writeIpadEvidence(directory, {
        screenshot: 'ipad-anchor-proof.png',
        osVersion: '18.1',
        environment: 'device',
        commit,
      })
    const anchors = anchorRepo(t)
    assert.throws(write(evidence(t, null, { image: null }), anchors.head), {
      code: 'ENOENT',
    })
    const directory = writeEvidence(anchors.repo, anchors, null, screenshotBytes)
    assert.throws(
      write(directory, 'f'.repeat(40)),
      /^Error: ipad_evidence_commit_unknown$/
    )
    const bare = git(
      anchors.repo,
      'commit-tree',
      git(anchors.repo, 'mktree'),
      '-m',
      'empty'
    )
    assert.throws(write(directory, bare), /^Error: ipad_evidence_sources$/)
    assert.equal(fs.existsSync(path.join(directory, IPAD_EVIDENCE_RECORD)), false)
  })

  test('sources names exactly the anchor sources, each with a blob SHA', (t) => {
    const anchors = anchorRepo(t)
    const [first, ...rest] = Object.keys(anchors.sources)
    const cases = [
      Object.fromEntries(rest.map((file) => [file, anchors.sources[file]])),
      { ...anchors.sources, 'apps/mobile/other.tsx': 'a'.repeat(40) },
      { ...anchors.sources, [first]: 'HEAD' },
      { ...anchors.sources, [first]: anchors.sources[first].slice(0, 8) },
      'everything',
      [],
      null,
    ]
    for (const sources of cases)
      assert.deepEqual(
        ipadEvidenceProblems(evidence(t, { ...valid(), sources })),
        ['ipad_evidence_sources'],
        JSON.stringify(sources)
      )
  })

  test('later work outside the anchor sources keeps the proof current', (t) => {
    const anchors = anchorRepo(t)
    commitFiles(anchors.repo, { 'README.md': 'unrelated\n' }, 'later work elsewhere')
    const directory = writeEvidence(
      path.join(anchors.repo, IPAD_EVIDENCE_DIRECTORY),
      anchors,
      valid(),
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), [])
  })

  for (const source of IPAD_ANCHOR_SOURCES)
    test(`a later change to ${path.basename(source)} makes the proof stale`, (t) => {
      const anchors = anchorRepo(t)
      commitFiles(anchors.repo, { [source]: 'moved the anchor\n' }, 'anchor change')
      const directory = writeEvidence(anchors.repo, anchors, valid(), screenshotBytes)
      assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_anchor_changed'])
      assert.throws(() => assertIpadEvidence(directory), /anchor_changed/)
    })

  test('deleting an anchor source makes the proof stale', (t) => {
    const anchors = anchorRepo(t)
    git(anchors.repo, 'rm', '-q', '--', IPAD_ANCHOR_SOURCES[1])
    git(
      anchors.repo,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'drop the anchor configuration'
    )
    const directory = writeEvidence(anchors.repo, anchors, valid(), screenshotBytes)
    assert.deepEqual(ipadEvidenceProblems(directory), ['ipad_evidence_anchor_changed'])
  })

  test('an uncommitted edit to an anchor source does not count until it is committed', (t) => {
    const anchors = anchorRepo(t)
    fs.writeFileSync(path.join(anchors.repo, IPAD_ANCHOR_SOURCES[0]), 'local edit\n')
    const directory = writeEvidence(anchors.repo, anchors, valid(), screenshotBytes)
    assert.deepEqual(ipadEvidenceProblems(directory), [])
  })

  test('a squash merge of the proven branch passes: same blobs, recorded commit outside history', (t) => {
    const anchors = anchorRepo(t)
    const { repo } = anchors
    git(repo, 'switch', '-q', '-c', 'feature')
    const proven = commitFiles(
      repo,
      { [IPAD_ANCHOR_SOURCES[0]]: 'anchored to Share\n' },
      'anchor the popover'
    )
    const record = { ...valid(), commit: proven, sources: blobsAt(repo, proven) }
    git(repo, 'switch', '-q', 'main')
    commitFiles(repo, { 'README.md': 'main moved on\n' }, 'unrelated main work')
    git(repo, 'merge', '-q', '--squash', 'feature')
    git(repo, 'commit', '-q', '--no-verify', '-m', 'anchor the popover (#1)')
    git(repo, 'branch', '-q', '-D', 'feature')
    const merge = spawnSync('git', ['merge-base', '--is-ancestor', proven, 'HEAD'], {
      cwd: repo,
      env: gitEnv,
    })
    assert.equal(merge.status, 1, 'the recorded commit is not an ancestor of HEAD')
    const directory = writeEvidence(
      path.join(repo, IPAD_EVIDENCE_DIRECTORY),
      anchors,
      record,
      screenshotBytes
    )
    assert.deepEqual(ipadEvidenceProblems(directory), [])
    const gone = { ...record, commit: 'f'.repeat(40) }
    writeEvidence(directory, anchors, gone, screenshotBytes)
    assert.deepEqual(ipadEvidenceProblems(directory), [], 'a commit git no longer holds')
  })

  /** A depth-1 clone of `repo` with the given record committed beside its screenshot. */
  function shallowEvidence(t, anchors, record) {
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-shallow-'))
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }))
    git(clone, 'clone', '-q', '--depth', '1', `file://${anchors.repo}`, 'checkout')
    const checkout = path.join(clone, 'checkout')
    assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true')
    return writeEvidence(
      path.join(checkout, IPAD_EVIDENCE_DIRECTORY),
      anchors,
      record,
      screenshotBytes
    )
  }

  test('a depth-1 clone checks the anchor sources without the recorded commit', (t) => {
    const anchors = anchorRepo(t)
    commitFiles(anchors.repo, { 'README.md': 'unrelated\n' }, 'later work elsewhere')
    const current = shallowEvidence(t, anchors, valid())
    assert.equal(
      spawnSync('git', ['cat-file', '-e', `${anchors.head}^{commit}`], {
        cwd: current,
        env: gitEnv,
      }).status === 0,
      false,
      'the clone lacks the recorded commit'
    )
    assert.deepEqual(ipadEvidenceProblems(current), [])
    commitFiles(anchors.repo, { [IPAD_ANCHOR_SOURCES[2]]: 'moved\n' }, 'anchor change')
    assert.deepEqual(ipadEvidenceProblems(shallowEvidence(t, anchors, valid())), [
      'ipad_evidence_anchor_changed',
    ])
  })

  test('evidence outside a git checkout fails closed', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-ipad-no-git-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const sources = Object.fromEntries(
      [...IPAD_ANCHOR_SOURCES].sort().map((file) => [file, 'a'.repeat(40)])
    )
    writeEvidence(directory, { head: 'a'.repeat(40), sources }, valid(), screenshotBytes)
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

// U-HARNESS-IPAD-EVIDENCE against the repository. This is the gate the spec asks for: it fails the
// pull request until the owner's local iPad proof (X-IPAD-ANCHOR) is committed under
// _bmad-output/test-artifacts/story-6-9/. See the README there for the record format.
test('U-HARNESS-IPAD-EVIDENCE: the committed X-IPAD-ANCHOR record and screenshot pass the check', () => {
  const directory = path.join(repo, IPAD_EVIDENCE_DIRECTORY)
  assert.deepEqual(ipadEvidenceProblems(directory), [])
})
