import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { assertNativeEvidence } from '../lib/story68-native-evidence-schema.mjs'
import {
  LOCALES,
  MATRIX_SECTIONS,
  MATRIX_SHARD_PLANS,
  assertShardEvidence,
  commandsForShard,
  expectedMatrixCases,
  inMatrixSection,
  localesForShard,
  nominalMinutes,
  parseShard,
  planPlatform,
  shardCountOf,
  shardPlanFor,
  shardsOf,
} from './native-matrix-shards.mjs'

const workflow = parse(
  fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
)
const plans = Object.keys(MATRIX_SHARD_PLANS)
const androidPlans = plans.filter((plan) => planPlatform(plan) === 'android')
const report = (plan, shard, patch = {}) => ({
  platform: planPlatform(plan),
  completed: true,
  cases: expectedMatrixCases(plan, shard).map((id) => ({ id, passed: true })),
  ...patch,
})
const all = (plan) =>
  Object.fromEntries(shardsOf(plan).map((shard) => [shard, report(plan, shard)]))
const without = (plan, missing) =>
  Object.fromEntries(
    shardsOf(plan)
      .filter((shard) => !missing.includes(shard))
      .map((shard) => [shard, report(plan, shard)])
  )
// iOS fills four of the five macOS jobs the free plan runs at once; Android shards three ways.
const SHARD_COUNTS = { ios: 4, 'android-36': 3, 'android-32': 3 }
// Each sharded Android lane: its job, the plan it runs and the suite prefix of its rows.
const lanes = [
  ['android36-native-matrix', 'android-36', 'matrix'],
  ['original-resource', 'android-32', 'all'],
]

describe('native matrix shard partition', () => {
  test('the plans are iOS and the two Android emulator APIs', () => {
    assert.deepEqual(plans.sort(), ['android-32', 'android-36', 'ios'])
    assert.equal(shardPlanFor('ios'), 'ios')
    assert.equal(shardPlanFor('android', '36'), 'android-36')
    assert.equal(shardPlanFor('android', 32), 'android-32')
    for (const [platform, sdk] of [
      ['android', '34'],
      ['android', ''],
      ['android', undefined],
      ['web', '36'],
    ])
      assert.throws(() => shardPlanFor(platform, sdk), /shard_plan_invalid/)
  })

  for (const plan of plans)
    test(`${plan}: every matrix section and locale belongs to exactly one shard`, () => {
      const shards = shardsOf(plan)
      assert.equal(shardCountOf(plan), SHARD_COUNTS[plan])
      assert.deepEqual(
        shards,
        Array.from({ length: SHARD_COUNTS[plan] }, (_, index) => index + 1)
      )
      for (const section of Object.keys(MATRIX_SECTIONS[planPlatform(plan)]))
        assert.equal(
          shards.filter((s) => inMatrixSection(plan, s, section)).length,
          1,
          section
        )
      for (const locale of LOCALES)
        assert.equal(
          shards.filter((s) => localesForShard(plan, s).includes(locale)).length,
          1,
          locale
        )
    })

  for (const plan of androidPlans)
    test(`${plan}: the shards together report all 43 cases of the unsharded matrix, none twice`, () => {
      const whole = expectedMatrixCases(plan, undefined)
      // pre-locale 11, large-text 1, precommit 2, save 8, prefs-failed 1, and per locale the
      // dark-dialog status icons and the locale itself.
      assert.equal(whole.length, 11 + 1 + 2 + 8 + 1 + LOCALES.length * 2)
      assert.equal(whole.length, 43)
      const parts = shardsOf(plan).map((s) => expectedMatrixCases(plan, s))
      assert.deepEqual(parts.flat().sort(), whole)
      // save-lifecycle reports M-SAVE-OWNERSHIP:current-saving three times, all in one shard.
      for (const [index, part] of parts.entries())
        for (const other of parts.slice(index + 1)) {
          const ids = new Set(other)
          assert.equal(
            [...new Set(part)].filter((id) => ids.has(id)).length,
            0,
            'no case id is reported by two shards'
          )
        }
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
    for (const plan of plans) {
      for (const section of Object.keys(MATRIX_SECTIONS[planPlatform(plan)]))
        assert.equal(inMatrixSection(plan, undefined, section), true)
      assert.deepEqual(localesForShard(plan, undefined), [...LOCALES])
    }
  })

  test('the plans name only sections the runner knows', () => {
    for (const plan of plans)
      for (const { sections } of Object.values(MATRIX_SHARD_PLANS[plan].shards))
        for (const section of sections)
          assert.ok(MATRIX_SECTIONS[planPlatform(plan)][section], `${plan} ${section}`)
  })

  test('parseShard accepts only a shard of the plan, out of its own count', () => {
    for (const plan of plans) {
      const count = shardCountOf(plan)
      for (const shard of shardsOf(plan))
        assert.equal(parseShard(plan, `${shard}/${count}`), shard)
      for (const bad of [
        `${count + 1}/${count}`,
        `1/${count + 1}`,
        `1/${count - 1}`,
        `0/${count}`,
        '',
        undefined,
        '1',
        `1/${count}; rm`,
      ])
        assert.throws(() => parseShard(plan, bad), new RegExp(`${plan}_shard_invalid`))
    }
    assert.throws(() => parseShard('android', '1/3'), /shard_plan_invalid/)
  })

  test('every case a shard must report is accepted by the closed published matrix schema', () => {
    for (const plan of plans)
      for (const shard of shardsOf(plan))
        assert.doesNotThrow(() =>
          assertNativeEvidence(
            `native-matrix-${planPlatform(plan)}.json`,
            report(plan, shard)
          )
        )
  })
})

describe('Android shard commands', () => {
  test('every Android shard runs the matrix once and every other command in one shard only', () => {
    for (const plan of androidPlans) {
      for (const shard of shardsOf(plan))
        assert.equal(
          commandsForShard(plan, shard).filter((c) => c === 'matrix').length,
          1,
          `${plan} shard ${shard}`
        )
      // permission-baseline repeats: it sets what proof grants, in each shard without proof.
      const others = shardsOf(plan).flatMap((s) =>
        commandsForShard(plan, s).filter(
          (c) => c !== 'matrix' && c !== 'permission-baseline'
        )
      )
      assert.equal(new Set(others).size, others.length, plan)
    }
    for (const shard of shardsOf('android-36'))
      assert.deepEqual(commandsForShard('android-36', shard), ['matrix'])
  })

  // The API32 journey was one 62.7 minute step on run 41202706840: proof, the matrix and
  // rapid-watermark. proof grants WRITE_EXTERNAL_STORAGE through Settings, which API32 Saves need,
  // so the shard without proof sets the same permission before its matrix.
  test('API32 shard 1 proves the original and the rapid watermark; shards 2 and 3 grant storage first', () => {
    assert.deepEqual(commandsForShard('android-32', 1), [
      'proof',
      'matrix',
      'rapid-watermark',
    ])
    assert.deepEqual(commandsForShard('android-32', 2), ['permission-baseline', 'matrix'])
    assert.deepEqual(commandsForShard('android-32', 3), ['permission-baseline', 'matrix'])
    for (const shard of shardsOf('android-32')) {
      const commands = commandsForShard('android-32', shard)
      const grant = ['proof', 'permission-baseline'].filter((c) => commands.includes(c))
      assert.equal(grant.length, 1, `shard ${shard} grants exactly once`)
      assert.ok(commands.indexOf(grant[0]) < commands.indexOf('matrix'))
    }
  })
})

describe('native matrix shard merge', () => {
  test('passes only when every shard completed its exact cases', () => {
    for (const plan of androidPlans)
      assert.equal(assertShardEvidence(plan, all(plan)), 43)
    assert.equal(assertShardEvidence('ios', all('ios')), 34)
  })

  for (const plan of androidPlans)
    test(`a missing ${plan} shard fails the merge`, () => {
      for (const shard of shardsOf(plan))
        assert.throws(
          () => assertShardEvidence(plan, without(plan, [shard])),
          new RegExp(`${plan}_shard_missing:${shard}$`)
        )
      assert.throws(
        () => assertShardEvidence(plan, undefined),
        new RegExp(`${plan}_shard_missing:${shardsOf(plan).join(',')}$`)
      )
    })

  for (const plan of androidPlans)
    test(`an incomplete, failed, truncated, swapped, foreign or unsharded ${plan} report fails the merge`, () => {
      const incomplete = new RegExp(`${plan}_shard_evidence_incomplete:`)
      const run = (patch) => () => assertShardEvidence(plan, { ...all(plan), ...patch })
      assert.throws(run({ 1: report(plan, 1, { completed: false }) }), incomplete)
      const failed = report(plan, 2)
      failed.cases[0].passed = false
      assert.throws(run({ 2: failed }), incomplete)
      const truncated = report(plan, 2)
      truncated.cases.pop()
      assert.throws(run({ 2: truncated }), incomplete)
      assert.throws(
        run({ 1: report(plan, 2), 2: report(plan, 1) }),
        new RegExp(`${plan}_shard_evidence_incomplete:1,2`)
      )
      assert.throws(run({ 1: report(plan, undefined) }), incomplete)
      assert.throws(run({ 1: { ...report(plan, 1), platform: 'ios' } }), incomplete)
    })

  test('the two Android plans are different splits, so one shard report cannot pass for the other', () => {
    assert.notDeepEqual(
      expectedMatrixCases('android-32', 1),
      expectedMatrixCases('android-36', 1)
    )
    assert.throws(
      () => assertShardEvidence('android-32', all('android-36')),
      /android-32_shard_evidence_incomplete/
    )
  })

  const cli = (args) =>
    spawnSync(process.execPath, ['scripts/ci/native-matrix-shards.mjs', ...args], {
      encoding: 'utf8',
    })
  const writeShards = (plan, shards) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-matrix-shards-'))
    for (const shard of shards) {
      fs.mkdirSync(path.join(directory, `shard-${shard}`))
      fs.writeFileSync(
        path.join(
          directory,
          `shard-${shard}`,
          `native-matrix-${planPlatform(plan)}.json`
        ),
        JSON.stringify(report(plan, shard))
      )
    }
    return directory
  }

  for (const plan of androidPlans)
    test(`the merge CLI passes every ${plan} shard artifact and names a missing one`, (t) => {
      const shards = shardsOf(plan)
      const full = writeShards(plan, shards)
      const partial = writeShards(plan, shards.slice(0, -1))
      t.after(() => {
        for (const directory of [full, partial])
          fs.rmSync(directory, { recursive: true, force: true })
      })
      const ok = cli(['merge', plan, full])
      assert.equal(ok.status, 0, ok.stderr)
      assert.match(
        ok.stdout,
        new RegExp(`All ${shards.length} ${plan} matrix shards reported 43 cases\\.`)
      )
      const missing = cli(['merge', plan, partial])
      assert.equal(missing.status, 1)
      assert.match(missing.stderr, new RegExp(`${plan}_shard_missing:${shards.at(-1)}`))
      assert.equal(cli(['merge', 'android', full]).status, 1)
    })
})

describe('Android shard balance and journey budget', () => {
  for (const [job, plan, prefix] of lanes) {
    const rows = workflow.jobs[job].strategy.matrix.include

    test(`${job} runs exactly one row per ${plan} shard`, () => {
      assert.deepEqual(
        rows.map((row) => row.suite),
        shardsOf(plan).map((shard) => `${prefix}-${shard}`)
      )
      assert.ok(rows.every((row) => row.api === Number(plan.split('-')[1])))
    })

    test(`${plan}: the measured minutes cover every section and command the plan places`, () => {
      const minutes = MATRIX_SHARD_PLANS[plan].minutes
      for (const section of Object.keys(MATRIX_SECTIONS.android))
        assert.ok(minutes[section] > 0, section)
      for (const shard of shardsOf(plan))
        for (const command of commandsForShard(plan, shard).filter((c) => c !== 'matrix'))
          assert.ok(minutes[command] > 0, command)
      assert.ok(minutes.locale > 0)
      assert.ok(minutes.shardSetup > 0)
    })

    test(`${plan}: the shards are balanced by measured wall time`, () => {
      const minutes = shardsOf(plan).map((shard) => nominalMinutes(plan, shard))
      assert.ok(
        Math.max(...minutes) - Math.min(...minutes) <= 3,
        `shard minutes ${minutes.join(', ')}`
      )
    })

    test(`${job}: a runner 1.5x slower than the measured run still finishes every shard in its journey timeout`, () => {
      for (const [index, shard] of shardsOf(plan).entries()) {
        const timeout = rows[index].journey_timeout
        assert.ok(
          nominalMinutes(plan, shard) * 1.5 < timeout,
          `shard ${shard}: ${nominalMinutes(plan, shard)} min nominal, ${timeout} min timeout`
        )
      }
    })
  }

  test('the unsharded journeys match their measured runs and could not fit a 1.5x runner', () => {
    // Main run 41104845732: the API36 matrix in one 43.4 minute step with a 60 minute timeout.
    assert.ok(Math.abs(nominalMinutes('android-36', undefined) - 43.4) < 0.5)
    assert.ok(nominalMinutes('android-36', undefined) * 1.5 > 60)
    // Run 41202706840: proof, matrix and rapid-watermark in one 62.7 minute API32 step, in a
    // job with a 90 minute limit.
    assert.ok(Math.abs(nominalMinutes('android-32', undefined) - 62.7) < 0.5)
    assert.ok(nominalMinutes('android-32', undefined) * 1.5 > 90)
  })
})

describe('runner shard wiring', () => {
  const source = fs.readFileSync(
    new URL('../run-story68-native.mjs', import.meta.url),
    'utf8'
  )
  const branch = (from, to) => {
    const start = source.indexOf(from)
    assert.ok(start >= 0, from)
    return source.slice(start, source.indexOf(to, start))
  }

  test('the matrix reads its plan from the platform and the emulator SDK it runs on', () => {
    const matrix = branch("} else if (command === 'matrix') {", "activeLocale = 'en-US'")
    assert.match(matrix, /shardPlanFor\(platform, androidSdk\(\)\)/)
    assert.match(matrix, /parseShard\(plan, option\('shard'\)\)/)
    assert.doesNotMatch(source, /inMatrixSection\(platform, /)
  })

  // Run 41202706840: API32 Saves need WRITE_EXTERNAL_STORAGE, which only `proof` grants.
  test('permission-baseline grants API32 storage, proves the grant and reopens the app on the tabs', () => {
    const baseline = branch(
      "} else if (command === 'permission-baseline') {",
      "} else if (command === 'fixture')"
    )
    const android = baseline
      .slice(baseline.indexOf('androidSdk() < 33'))
      .replace(/\s+/g, ' ')
    assert.ok(baseline.includes('androidSdk() < 33'))
    const at = (needle) => {
      const index = android.indexOf(needle)
      assert.ok(index >= 0, needle)
      return index
    }
    const grant = at("'pm', 'grant', appId, 'android.permission.WRITE_EXTERNAL_STORAGE'")
    const proved = at('WRITE_EXTERNAL_STORAGE: granted=true')
    const stop = at("'am', 'force-stop', appId")
    const reopen = at('couturecast-story68://expo-development-client/')
    const tabs = at("maestro('maestro/story65/open-app.yaml')")
    assert.ok(grant < proved && proved < stop && stop < reopen && reopen < tabs)
  })
})
