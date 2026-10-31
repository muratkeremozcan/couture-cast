import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { assertNativeEvidence } from '../lib/story68-native-evidence-schema.mjs'
import {
  ANDROID_MEASURED_MINUTES,
  LOCALES,
  MATRIX_SECTIONS,
  MATRIX_SHARD_PLAN,
  androidNominalMinutes,
  assertShardEvidence,
  expectedMatrixCases,
  inMatrixSection,
  localesForShard,
  parseShard,
  shardsOf,
} from './native-matrix-shards.mjs'

const workflow = parse(
  fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
)
const report = (platform, shard, patch = {}) => ({
  platform,
  completed: true,
  cases: expectedMatrixCases(platform, shard).map((id) => ({ id, passed: true })),
  ...patch,
})
const both = (platform) =>
  Object.fromEntries(shardsOf(platform).map((shard) => [shard, report(platform, shard)]))

describe('native matrix shard partition', () => {
  for (const platform of ['android', 'ios'])
    test(`${platform}: every matrix section and locale belongs to exactly one shard`, () => {
      const shards = shardsOf(platform)
      assert.deepEqual(shards, [1, 2])
      for (const section of Object.keys(MATRIX_SECTIONS[platform]))
        assert.equal(
          shards.filter((s) => inMatrixSection(platform, s, section)).length,
          1,
          section
        )
      for (const locale of LOCALES)
        assert.equal(
          shards.filter((s) => localesForShard(platform, s).includes(locale)).length,
          1,
          locale
        )
    })

  test('the Android shards together report all 43 cases of the unsharded matrix, none twice', () => {
    const whole = expectedMatrixCases('android', undefined)
    // pre-locale 11, large-text 1, precommit 2, save 8, prefs-failed 1, and per locale the
    // dark-dialog status icons and the locale itself.
    assert.equal(whole.length, 11 + 1 + 2 + 8 + 1 + LOCALES.length * 2)
    assert.equal(whole.length, 43)
    const [one, two] = shardsOf('android').map((s) => expectedMatrixCases('android', s))
    assert.deepEqual([...one, ...two].sort(), whole)
    // save-lifecycle reports M-SAVE-OWNERSHIP:current-saving three times, all in one shard.
    const unique = (ids) => new Set(ids)
    assert.equal(
      [...unique(one)].filter((id) => unique(two).has(id)).length,
      0,
      'no case id is reported by both shards'
    )
  })

  test('the iOS shards keep their 34 cases', () => {
    const whole = expectedMatrixCases('ios', undefined)
    assert.equal(whole.length, 34)
    assert.deepEqual(
      shardsOf('ios')
        .flatMap((s) => expectedMatrixCases('ios', s))
        .sort(),
      whole
    )
  })

  test('an unsharded run selects every section and locale', () => {
    for (const platform of ['android', 'ios']) {
      for (const section of Object.keys(MATRIX_SECTIONS[platform]))
        assert.equal(inMatrixSection(platform, undefined, section), true)
      assert.deepEqual(localesForShard(platform, undefined), [...LOCALES])
    }
  })

  test('the plans name only sections the runner knows', () => {
    for (const platform of ['android', 'ios'])
      for (const { sections } of Object.values(MATRIX_SHARD_PLAN[platform]))
        for (const section of sections)
          assert.ok(MATRIX_SECTIONS[platform][section], `${platform} ${section}`)
  })

  test('parseShard accepts only a shard of the platform plan', () => {
    assert.equal(parseShard('android', '1/2'), 1)
    assert.equal(parseShard('android', '2/2'), 2)
    for (const bad of ['3/2', '1/3', '0/2', '', undefined, '1', '1/2; rm'])
      assert.throws(() => parseShard('android', bad), /android_shard_invalid/)
    assert.throws(() => parseShard('web', '1/2'), /shard_platform_invalid/)
  })

  test('every case a shard must report is accepted by the closed published matrix schema', () => {
    for (const platform of ['android', 'ios'])
      for (const shard of shardsOf(platform))
        assert.doesNotThrow(() =>
          assertNativeEvidence(`native-matrix-${platform}.json`, report(platform, shard))
        )
  })
})

describe('native matrix shard merge', () => {
  test('passes only when both Android shards completed their exact cases', () => {
    assert.equal(assertShardEvidence('android', both('android')), 43)
    assert.equal(assertShardEvidence('ios', both('ios')), 34)
  })

  test('a missing Android shard fails the merge', () => {
    assert.throws(
      () => assertShardEvidence('android', { 1: report('android', 1) }),
      /android_shard_missing:2/
    )
    assert.throws(
      () => assertShardEvidence('android', { 2: report('android', 2) }),
      /android_shard_missing:1/
    )
    assert.throws(
      () => assertShardEvidence('android', undefined),
      /android_shard_missing:1,2/
    )
  })

  test('an incomplete, failed, truncated, swapped or foreign shard report fails the merge', () => {
    const run = (patch) => () =>
      assertShardEvidence('android', { ...both('android'), ...patch })
    assert.throws(
      run({ 1: report('android', 1, { completed: false }) }),
      /android_shard_evidence_incomplete:1/
    )
    const failed = report('android', 2)
    failed.cases[0].passed = false
    assert.throws(run({ 2: failed }), /android_shard_evidence_incomplete:2/)
    const truncated = report('android', 2)
    truncated.cases.pop()
    assert.throws(run({ 2: truncated }), /android_shard_evidence_incomplete:2/)
    assert.throws(
      run({ 1: report('android', 2), 2: report('android', 1) }),
      /android_shard_evidence_incomplete:1,2/
    )
    // An unsharded report carries every case, so it is wrong for either shard.
    const whole = {
      platform: 'android',
      completed: true,
      cases: expectedMatrixCases('android', undefined).map((id) => ({
        id,
        passed: true,
      })),
    }
    assert.throws(run({ 1: whole }), /android_shard_evidence_incomplete:1/)
    assert.throws(
      run({ 1: { ...report('android', 1), platform: 'ios' } }),
      /android_shard_evidence_incomplete:1/
    )
  })

  const cli = (args) =>
    spawnSync(process.execPath, ['scripts/ci/native-matrix-shards.mjs', ...args], {
      encoding: 'utf8',
    })
  const writeShards = (platform, shards) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-matrix-shards-'))
    for (const shard of shards) {
      fs.mkdirSync(path.join(directory, `shard-${shard}`))
      fs.writeFileSync(
        path.join(directory, `shard-${shard}`, `native-matrix-${platform}.json`),
        JSON.stringify(report(platform, shard))
      )
    }
    return directory
  }

  test('the merge CLI passes both Android shard artifacts and names a missing one', (t) => {
    const full = writeShards('android', [1, 2])
    const partial = writeShards('android', [1])
    t.after(() => {
      for (const directory of [full, partial])
        fs.rmSync(directory, { recursive: true, force: true })
    })
    const ok = cli(['merge', 'android', full])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /Both android matrix shards reported 43 cases\./)
    const missing = cli(['merge', 'android', partial])
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /android_shard_missing:2/)
    assert.equal(cli(['merge', 'web', full]).status, 1)
  })
})

describe('Android matrix shard balance and journey budget', () => {
  const job = workflow.jobs['android36-native-matrix']
  const rows = job.strategy.matrix.include

  test('the workflow runs exactly one row per Android plan shard', () => {
    assert.deepEqual(
      rows.map((row) => row.suite),
      shardsOf('android').map((shard) => `matrix-${shard}`)
    )
  })

  test('the measured minutes cover every section the plan places', () => {
    for (const section of Object.keys(MATRIX_SECTIONS.android))
      assert.ok(ANDROID_MEASURED_MINUTES[section] > 0, section)
    assert.ok(ANDROID_MEASURED_MINUTES.locale > 0)
    assert.ok(ANDROID_MEASURED_MINUTES.shardSetup > 0)
    // Main run 41104845732 ran the whole matrix in one 43.4 minute journey step.
    assert.ok(Math.abs(androidNominalMinutes(undefined) - 43.4) < 0.5)
  })

  test('the shards are balanced by measured wall time', () => {
    const [one, two] = shardsOf('android').map(androidNominalMinutes)
    assert.ok(Math.abs(one - two) <= 3, `shard 1 ${one} min, shard 2 ${two} min`)
  })

  test('a runner 1.5x slower than main still finishes every shard inside its journey timeout', () => {
    for (const [index, shard] of shardsOf('android').entries()) {
      const timeout = rows[index].journey_timeout
      assert.ok(
        androidNominalMinutes(shard) * 1.5 < timeout,
        `shard ${shard}: ${androidNominalMinutes(shard)} min nominal, ${timeout} min timeout`
      )
    }
    // The single unsharded journey had a 60 minute timeout and needs 65 at 1.5x.
    assert.ok(androidNominalMinutes(undefined) * 1.5 > 60)
  })
})
