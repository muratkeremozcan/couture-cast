// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import test from 'node:test'
import fs from 'node:fs'
import { assertNativeEvidence } from '../lib/story68-native-evidence-schema.mjs'
import assert from 'node:assert/strict'
import {
  AFTER_MATRIX,
  LOCALES,
  MATRIX_SECTIONS,
  SHARD_COUNT,
  SHARD_PLAN,
  assertShardEvidence,
  commandsForShard,
  expectedMatrixCases,
  inMatrixSection,
  localesForShard,
  nominalMinutes,
  parseShard,
  runsCommand,
} from './native-ios-shards.mjs'

const shards = Object.keys(SHARD_PLAN).map(Number)
const report = (shard, patch = {}) => ({
  platform: 'ios',
  completed: true,
  cases: expectedMatrixCases(shard).map((id) => ({ id, passed: true })),
  ...patch,
})
const all = () => Object.fromEntries(shards.map((shard) => [shard, report(shard)]))

test('four shards: with ios-expo-go they fill the five macOS jobs the free plan runs at once', () => {
  assert.equal(SHARD_COUNT, 4)
  assert.deepEqual(shards, [1, 2, 3, 4])
})

test('every matrix section, locale and command belongs to exactly one shard', () => {
  for (const section of Object.keys(MATRIX_SECTIONS))
    assert.equal(shards.filter((s) => inMatrixSection(s, section)).length, 1, section)
  for (const locale of LOCALES)
    assert.equal(
      shards.filter((s) => localesForShard(s).includes(locale)).length,
      1,
      locale
    )
  // permission-baseline sets what proof grants, in every shard that does not run proof.
  for (const command of ['proof', ...AFTER_MATRIX])
    assert.equal(shards.filter((s) => runsCommand(s, command)).length, 1, command)
  assert.deepEqual(
    shards.filter((s) => runsCommand(s, 'permission-baseline')),
    shards.filter((s) => !runsCommand(s, 'proof'))
  )
})

test('the shards are balanced by measured minutes and fit their job limit on a runner 1.5x slower', () => {
  const minutes = shards.map(nominalMinutes)
  assert.ok(
    Math.max(...minutes) - Math.min(...minutes) <= 3,
    `shard minutes ${minutes.join(', ')}`
  )
  const workflow = fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
  const limit = Number(
    /\n {2}ios-shard:\n(?:.*\n)*? {4}timeout-minutes: (\d+)/.exec(workflow)[1]
  )
  for (const shard of shards)
    assert.ok(
      nominalMinutes(shard) * 1.5 < limit,
      `shard ${shard}: ${nominalMinutes(shard)} min`
    )
  // The two shards of main run 41312266186 took 50 and 58 minutes.
  assert.ok(Math.max(...minutes) < 35)
})

test('no shard runs the Expo Go proof: the ios-expo-go job runs it alone', () => {
  for (const shard of Object.keys(SHARD_PLAN).map(Number)) {
    assert.ok(!SHARD_PLAN[shard].commands.includes('expo-go-proof'), `shard ${shard}`)
    assert.ok(!commandsForShard(shard).includes('expo-go-proof'), `shard ${shard}`)
  }
  assert.deepEqual(commandsForShard(3).at(-1), 'fallback-focus')
  assert.ok(!AFTER_MATRIX.includes('expo-go-proof'))
})

test('the plan names only sections and commands the runner knows', () => {
  for (const { sections, commands } of Object.values(SHARD_PLAN)) {
    for (const s of sections) assert.ok(MATRIX_SECTIONS[s], s)
    for (const c of commands)
      assert.ok(['proof', 'permission-baseline', ...AFTER_MATRIX].includes(c), c)
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
  for (const shard of shards) assert.equal(parseShard(`${shard}/4`), shard)
  for (const bad of ['5/4', '1/2', '2/2', '1/5', '0/4', '', undefined, '1', '1/4; rm'])
    assert.throws(() => parseShard(bad), /ios_shard_invalid/)
})

test('merged evidence passes only when every shard completed its exact cases', () => {
  assert.equal(assertShardEvidence(all()), 34)
})

test('every shard runs matrix work, so no shard reports an empty matrix', () => {
  for (const shard of shards)
    assert.ok(SHARD_PLAN[shard].sections.length + SHARD_PLAN[shard].locales.length > 0)
})

test('a missing, incomplete, failed or foreign shard report fails the merge', () => {
  assert.throws(
    () => assertShardEvidence({ ...all(), 4: undefined }),
    /ios_shard_missing:4/
  )
  assert.throws(
    () => assertShardEvidence({ ...all(), 1: report(1, { completed: false }) }),
    /ios_shard_evidence_incomplete:1$/
  )
  const failed = report(2)
  failed.cases[0].passed = false
  assert.throws(
    () => assertShardEvidence({ ...all(), 2: failed }),
    /ios_shard_evidence_incomplete:2$/
  )
  const truncated = report(4)
  truncated.cases.pop()
  assert.throws(
    () => assertShardEvidence({ ...all(), 4: truncated }),
    /ios_shard_evidence_incomplete:4$/
  )
  assert.throws(
    () => assertShardEvidence({ ...all(), 1: report(2), 2: report(1) }),
    /ios_shard_evidence_incomplete:1,2$/
  )
  assert.throws(() => assertShardEvidence(undefined), /ios_shard_missing:1,2,3,4/)
})

test('each shard signs in, only shard 1 proves the original and the others set the same permissions', () => {
  assert.deepEqual(commandsForShard(1), ['signin', 'proof', 'matrix'])
  assert.deepEqual(commandsForShard(2), ['signin', 'permission-baseline', 'matrix'])
  assert.deepEqual(commandsForShard(3), [
    'signin',
    'permission-baseline',
    'matrix',
    'rapid-watermark',
    'a11y',
    'fallback-focus',
  ])
  assert.deepEqual(commandsForShard(4), [
    'signin',
    'permission-baseline',
    'matrix',
    'share-sheet',
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

// Run 40867653316: shard 2 died in precommit-cancel.yaml with the Photos add-only alert up. The
// only `simctl privacy grant photos-add` is in `proof`, which the plan gives to shard 1, so the
// shard that never runs `proof` must establish the same permission state itself, before the matrix.
test('the shard that does not run proof establishes the post-proof Photos permission before the matrix', () => {
  for (const shard of Object.keys(SHARD_PLAN).map(Number)) {
    const commands = commandsForShard(shard)
    const matrix = commands.indexOf('matrix')
    const grant = ['proof', 'permission-baseline'].filter((c) => commands.includes(c))
    assert.equal(grant.length, 1, `shard ${shard} grants exactly once`)
    assert.ok(
      commands.indexOf(grant[0]) < matrix,
      `shard ${shard} grants before the matrix`
    )
  }
  assert.deepEqual(commandsForShard(2).slice(0, 3), [
    'signin',
    'permission-baseline',
    'matrix',
  ])
})

test('permission-baseline revokes read, grants add-only and asserts both, on iOS only', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(
    new URL('../run-story68-native.mjs', import.meta.url),
    'utf8'
  )
  const start = source.indexOf("} else if (command === 'permission-baseline') {")
  assert.ok(start >= 0)
  const branch = source.slice(
    start,
    source.indexOf("} else if (command === 'fixture')", start)
  )
  assert.match(branch, /platform === 'ios'/)
  assert.match(branch, /'revoke', 'photos', appId/)
  assert.match(branch, /'grant', 'photos-add', appId/)
  assert.match(branch, /assertIosReadDenied\(iosPhotoPermissions\(\), true\)/)
  // proof relaunches the dev client after its grant, so the app reads the permission in a fresh
  // JS runtime; the baseline does the same, then returns to the tabs.
  const grant = branch.indexOf("'grant', 'photos-add', appId")
  const relaunch = branch.indexOf('couturecast-story68://expo-development-client/')
  const tabs = branch.indexOf("maestro('maestro/story65/open-app.yaml')")
  assert.ok(grant >= 0 && relaunch > grant && tabs > relaunch)
})

// U-HARNESS-IOS-SHARDS (Story 6.9): share-sheet is dispatchable after the matrix and runs once, in
// shard 4 after permission-baseline gives its Save the post-proof Photos permission.
test('share-sheet is a dispatchable post-matrix command that runs exactly once, in shard 4', () => {
  assert.ok(AFTER_MATRIX.includes('share-sheet'))
  assert.equal(commandsForShard(4).filter((c) => c === 'share-sheet').length, 1)
  for (const shard of [1, 2, 3])
    assert.equal(commandsForShard(shard).includes('share-sheet'), false)
  assert.ok(SHARD_PLAN[4].commands.includes('share-sheet'), 'named explicitly in shard 4')
  assert.ok(
    commandsForShard(4).indexOf('share-sheet') > commandsForShard(4).indexOf('matrix'),
    'after the matrix'
  )
  assert.equal(
    runsCommand(undefined, 'share-sheet'),
    true,
    'an unsharded run includes it'
  )
})

test('shard 3 lists its commands explicitly and they equal the old shard 2 AFTER_MATRIX spread', () => {
  // Before Story 6.9 shard 2 of two was ['permission-baseline', ...AFTER_MATRIX] with AFTER_MATRIX
  // ['rapid-watermark', 'a11y', 'fallback-focus']; shard 3 of four keeps that list.
  assert.deepEqual(SHARD_PLAN[3].commands, [
    'permission-baseline',
    'rapid-watermark',
    'a11y',
    'fallback-focus',
  ])
  assert.deepEqual(AFTER_MATRIX.slice(0, 3), [
    'rapid-watermark',
    'a11y',
    'fallback-focus',
  ])
  const source = fs.readFileSync(
    new URL('./native-ios-shards.mjs', import.meta.url),
    'utf8'
  )
  const plan = source.slice(
    source.indexOf('export const SHARD_PLAN'),
    source.indexOf('export const parseShard')
  )
  assert.ok(
    plan.includes("commands: ['permission-baseline',"),
    'the plan block was found'
  )
  assert.doesNotMatch(plan, /\.\.\.AFTER_MATRIX/, 'no shard spreads AFTER_MATRIX')
})
