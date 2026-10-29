import test from 'node:test'
import { assertNativeEvidence } from '../lib/story68-native-evidence-schema.mjs'
import assert from 'node:assert/strict'
import {
  AFTER_MATRIX,
  LOCALES,
  MATRIX_SECTIONS,
  SHARD_PLAN,
  assertShardEvidence,
  commandsForShard,
  expectedMatrixCases,
  inMatrixSection,
  localesForShard,
  parseShard,
  runsCommand,
} from './native-ios-shards.mjs'

const report = (shard, patch = {}) => ({
  platform: 'ios',
  completed: true,
  cases: expectedMatrixCases(shard).map((id) => ({ id, passed: true })),
  ...patch,
})

test('every matrix section, locale and command belongs to exactly one shard', () => {
  const shards = Object.keys(SHARD_PLAN).map(Number)
  for (const section of Object.keys(MATRIX_SECTIONS))
    assert.equal(shards.filter((s) => inMatrixSection(s, section)).length, 1, section)
  for (const locale of LOCALES)
    assert.equal(
      shards.filter((s) => localesForShard(s).includes(locale)).length,
      1,
      locale
    )
  for (const command of ['proof', ...AFTER_MATRIX])
    assert.equal(shards.filter((s) => runsCommand(s, command)).length, 1, command)
})

test('the plan names only sections and commands the runner knows', () => {
  for (const { sections, commands } of Object.values(SHARD_PLAN)) {
    for (const s of sections) assert.ok(MATRIX_SECTIONS[s], s)
    for (const c of commands) assert.ok(['proof', ...AFTER_MATRIX].includes(c), c)
  }
})

test('the shards together report every case an unsharded run reports', () => {
  const whole = expectedMatrixCases(undefined)
  const parts = Object.keys(SHARD_PLAN)
    .flatMap((s) => expectedMatrixCases(Number(s)))
    .sort()
  assert.deepEqual(parts, whole)
  // pre-locale 12 (3 retry-recovers), prefs-failed 1, locales 10, large-text 1, precommit 2, save 8
  assert.equal(whole.length, 12 + 1 + 10 + 1 + 2 + 8)
})

test('no shard is given the unsharded plan by accident', () => {
  assert.equal(inMatrixSection(undefined, 'large-text'), true)
  assert.equal(runsCommand(undefined, 'a11y'), true)
  assert.deepEqual(localesForShard(undefined), [...LOCALES])
})

test('parseShard accepts only a shard of this plan', () => {
  assert.equal(parseShard('1/2'), 1)
  assert.equal(parseShard('2/2'), 2)
  for (const bad of ['3/2', '1/3', '0/2', '', undefined, '1', '1/2; rm'])
    assert.throws(() => parseShard(bad), /ios_shard_invalid/)
})

test('merged evidence passes only when both shards completed their exact cases', () => {
  assert.equal(assertShardEvidence({ 1: report(1), 2: report(2) }), 34)
})

test('a missing, incomplete, failed or foreign shard report fails the merge', () => {
  assert.throws(() => assertShardEvidence({ 1: report(1) }), /ios_shard_missing:2/)
  assert.throws(
    () => assertShardEvidence({ 1: report(1, { completed: false }), 2: report(2) }),
    /ios_shard_evidence_incomplete:1/
  )
  const failed = report(2)
  failed.cases[0].passed = false
  assert.throws(
    () => assertShardEvidence({ 1: report(1), 2: failed }),
    /ios_shard_evidence_incomplete:2/
  )
  const truncated = report(2)
  truncated.cases.pop()
  assert.throws(
    () => assertShardEvidence({ 1: report(1), 2: truncated }),
    /ios_shard_evidence_incomplete:2/
  )
  assert.throws(
    () => assertShardEvidence({ 1: report(2), 2: report(1) }),
    /ios_shard_evidence_incomplete:1,2/
  )
  assert.throws(() => assertShardEvidence(undefined), /ios_shard_missing:1,2/)
})

test('each shard signs in, and only shard 1 proves the original', () => {
  assert.deepEqual(commandsForShard(1), ['signin', 'proof', 'matrix'])
  assert.deepEqual(commandsForShard(2), [
    'signin',
    'matrix',
    'rapid-watermark',
    'a11y',
    'fallback-focus',
    'expo-go-proof',
  ])
})

test('every case a shard must report is accepted by the closed published matrix schema', () => {
  for (const shard of Object.keys(SHARD_PLAN).map(Number))
    assert.doesNotThrow(
      () => assertNativeEvidence('native-matrix-ios.json', report(shard)),
      `shard ${shard}`
    )
  assert.throws(() =>
    assertNativeEvidence('native-matrix-ios.json', {
      ...report(1),
      cases: [{ id: 'M-UNKNOWN', passed: true }],
    })
  )
})
