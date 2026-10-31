/**
 * Two-way split of the native share-card matrix, one plan per lane that shards it: iOS, the
 * Android API36 matrix and the Android API32 journey. Each shard boots its own simulator or
 * emulator, Supabase, Metro and signed-in account and runs the sections and locales its plan
 * gives it. The runner picks the plan from the platform and the emulator SDK and reads this table
 * through `--shard N/2`; an unsharded run (local runs) runs every section and locale.
 *
 * The split is data, and the tests prove it is a partition: every section and locale belongs to
 * exactly one shard per plan, and the cases a shard must report come from the same table the
 * runner reads. This module imports only Node built-ins, so the evidence jobs run it straight
 * from a checkout.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SHARD_COUNT = 2

export const LOCALES = Object.freeze([
  'en-US',
  'en-CA',
  'fr-FR',
  'fr-CA',
  'de-DE',
  'es-419',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
])

/** Matrix sections in runner order with the case ids each one marks on the platform. */
const sections = (platform) =>
  Object.freeze({
    'pre-locale': Object.freeze([
      'M-CANCEL:preparation-before-commit',
      'M-POST M-SAVE',
      ...(platform === 'ios' ? ['M-A11Y:community-draft-native-host-foreground'] : []),
      'M-CANCEL M-WATERMARK',
      'M-STORAGE:cache_failure',
      'M-STORAGE:cache_failure:retry-recovers',
      'M-STORAGE:storage',
      'M-STORAGE:storage:retry-recovers',
      'M-OFFLINE',
      'M-OFFLINE:retry-recovers',
      'M-NATIVE-UNAVAILABLE:restricted-adapter-boundary',
      'U-PERMISSION-LIMITED:native-adapter-integration',
    ]),
    'large-text': Object.freeze(['M-A11Y:large-text-pt-PT']),
    'precommit-lifecycle': Object.freeze([
      'M-CANCEL M-SINGLE-WRITE:precommit-authorization-close',
      'M-CANCEL M-SINGLE-WRITE:precommit-authorization-navigation',
    ]),
    'save-lifecycle': Object.freeze([
      'M-SAVE-OWNERSHIP:current-saving',
      'M-SAVE-OWNERSHIP:reopened-finishing',
      'M-WATERMARK:reopen-after-settlement',
      'M-SINGLE-WRITE M-IDENTITY:close',
      'M-SAVE-OWNERSHIP:current-saving',
      'M-SINGLE-WRITE M-IDENTITY:navigation',
      'M-SAVE-OWNERSHIP:current-saving',
      'M-SINGLE-WRITE M-IDENTITY:signout',
    ]),
    'prefs-failed': Object.freeze(['M-UI:prefs-failed-state-light-dark']),
  })

export const MATRIX_SECTIONS = Object.freeze({
  android: sections('android'),
  ios: sections('ios'),
})

/** Cases one locale iteration marks. Android also proves the dark dialog status icons. */
export const localeCases = (platform, locale) =>
  platform === 'android'
    ? [`M-A11Y:dark-dialog-status-icons:${locale}`, `M-LOCALE:${locale}`]
    : [`M-LOCALE:${locale}`]

const shard = (sections, locales, commands = ['matrix']) =>
  Object.freeze({
    sections: Object.freeze(sections),
    locales: Object.freeze(locales),
    commands: Object.freeze(commands),
  })
const lifecycle = ['large-text', 'precommit-lifecycle', 'save-lifecycle']

/**
 * The placement. Edit this table, never the runner, to rebalance a lane. `commands` is what the
 * Android journey script runs after sign-in for each shard (share-card-android.test.mjs proves
 * it); iOS names its commands in native-ios-shards.mjs. `minutes` is what each part took on the
 * run named beside it: `shardSetup` is what every shard repeats (emulator boot inside the journey
 * step, install and open, sign-in and the en-US Settings locale the matrix starts from), and
 * `save-lifecycle` includes its sign-in after sign-out.
 */
export const MATRIX_SHARD_PLANS = Object.freeze({
  ios: Object.freeze({
    platform: 'ios',
    shards: Object.freeze({
      1: shard(['pre-locale', 'prefs-failed'], LOCALES.slice(0, 5)),
      2: shard(lifecycle, LOCALES.slice(5)),
    }),
  }),
  // The iOS sections with one more locale in shard 1, because the lifecycle sections weigh 13.0
  // minutes against 7.5 for pre-locale and prefs-failed. Nominal journey steps: shard 1 23.8
  // minutes, shard 2 25.9. Run 41202706840 took 32.0 and 34.3.
  'android-36': Object.freeze({
    platform: 'android',
    shards: Object.freeze({
      1: shard(['pre-locale', 'prefs-failed'], LOCALES.slice(0, 6)),
      2: shard(lifecycle, LOCALES.slice(6)),
    }),
    unsharded: Object.freeze(['matrix']),
    // Main run 41104845732: the whole matrix in one 43.4 minute journey step.
    minutes: Object.freeze({
      shardSetup: 6.2,
      'pre-locale': 7.0,
      locale: 1.68,
      'large-text': 1.8,
      'precommit-lifecycle': 4.7,
      'save-lifecycle': 6.5,
      'prefs-failed': 0.5,
    }),
  }),
  // proof and rapid-watermark ride with pre-locale and prefs-failed, which balances at five
  // locales each. proof grants WRITE_EXTERNAL_STORAGE through Settings, so shard 2 sets the same
  // grant with permission-baseline before its Saves. Nominal journey steps: shard 1 35.6
  // minutes, shard 2 34.4.
  'android-32': Object.freeze({
    platform: 'android',
    shards: Object.freeze({
      1: shard(['pre-locale', 'prefs-failed'], LOCALES.slice(0, 5), [
        'proof',
        'matrix',
        'rapid-watermark',
      ]),
      2: shard(lifecycle, LOCALES.slice(5), ['permission-baseline', 'matrix']),
    }),
    unsharded: Object.freeze(['proof', 'matrix', 'rapid-watermark']),
    // Run 41202706840: proof, the matrix and rapid-watermark in one 62.7 minute journey step.
    // permission-baseline is one grant and an app reopen, budgeted like the large-text reopen.
    minutes: Object.freeze({
      shardSetup: 6.8,
      proof: 6.1,
      'rapid-watermark': 2.0,
      'permission-baseline': 0.5,
      'pre-locale': 9.0,
      locale: 2.22,
      'large-text': 2.2,
      'precommit-lifecycle': 5.9,
      'save-lifecycle': 7.9,
      'prefs-failed': 0.6,
    }),
  }),
})

const planOf = (plan) => {
  const value = Object.hasOwn(MATRIX_SHARD_PLANS, String(plan))
    ? MATRIX_SHARD_PLANS[plan]
    : undefined
  if (!value) throw new Error(`shard_plan_invalid:${plan}`)
  return value
}

export const planPlatform = (plan) => planOf(plan).platform

/** The plan a matrix run uses: iOS, or the Android plan of the emulator SDK it runs on. */
export function shardPlanFor(platform, sdk) {
  const plan = platform === 'ios' ? 'ios' : `${platform}-${sdk}`
  if (!Object.hasOwn(MATRIX_SHARD_PLANS, plan) || planOf(plan).platform !== platform)
    throw new Error(`shard_plan_invalid:${plan}`)
  return plan
}

export const shardsOf = (plan) => Object.keys(planOf(plan).shards).map(Number)

/** `1/2` or `2/2` to the shard number; anything else throws. */
export function parseShard(plan, value) {
  const { shards } = planOf(plan)
  const m = /^([1-9])\/([1-9])$/.exec(String(value ?? ''))
  if (!m || Number(m[2]) !== SHARD_COUNT || !shards[Number(m[1])])
    throw new Error(`${plan}_shard_invalid:${value}`)
  return Number(m[1])
}

/** With no shard every section and locale runs. */
export const inMatrixSection = (plan, shard, section) =>
  shard === undefined || planOf(plan).shards[shard].sections.includes(section)

export const localesForShard = (plan, shard) =>
  shard === undefined ? [...LOCALES] : [...planOf(plan).shards[shard].locales]

/** The Android journey commands of a shard after sign-in, or of the unsharded lane with none. */
export const commandsForShard = (plan, shard) =>
  shard === undefined
    ? [...(planOf(plan).unsharded ?? ['matrix'])]
    : [...planOf(plan).shards[shard].commands]

/** Case ids a completed matrix of this plan and shard must report, in sorted order. */
export function expectedMatrixCases(plan, shard) {
  const platform = planPlatform(plan)
  return [
    ...Object.entries(MATRIX_SECTIONS[platform])
      .filter(([section]) => inMatrixSection(plan, shard, section))
      .flatMap(([, ids]) => ids),
    ...localesForShard(plan, shard).flatMap((locale) => localeCases(platform, locale)),
  ].sort()
}

/** Expected journey-step minutes of an Android shard, or of the unsharded lane with none. */
export function nominalMinutes(plan, shard) {
  const { minutes } = planOf(plan)
  if (!minutes) throw new Error(`shard_plan_unmeasured:${plan}`)
  const work = [
    ...Object.keys(MATRIX_SECTIONS[planPlatform(plan)]).filter((section) =>
      inMatrixSection(plan, shard, section)
    ),
    ...commandsForShard(plan, shard).filter((command) => command !== 'matrix'),
  ].reduce((sum, part) => sum + minutes[part], 0)
  const total =
    minutes.shardSetup + work + localesForShard(plan, shard).length * minutes.locale
  return Math.round(total * 10) / 10
}

/**
 * The merged verdict across shard reports (`native-matrix-<platform>.json` of each shard). A
 * missing shard, an incomplete report or a case set that differs from the plan is a failure, so
 * a skipped or truncated shard can never pass for the whole matrix.
 */
export function assertShardEvidence(plan, byShard) {
  const platform = planPlatform(plan)
  const shards = shardsOf(plan)
  const missing = shards.filter((shard) => !byShard?.[shard])
  if (missing.length) throw new Error(`${plan}_shard_missing:${missing.join(',')}`)
  const wrong = shards.filter((shard) => {
    const report = byShard[shard]
    const got = (report.cases ?? []).map((c) => c.id).sort()
    return (
      report.platform !== platform ||
      report.completed !== true ||
      (report.cases ?? []).some((c) => c.passed !== true) ||
      JSON.stringify(got) !== JSON.stringify(expectedMatrixCases(plan, shard))
    )
  })
  if (wrong.length)
    throw new Error(`${plan}_shard_evidence_incomplete:${wrong.join(',')}`)
  return shards.flatMap((shard) => expectedMatrixCases(plan, shard)).length
}

/** Reads `<directory>/shard-N/native-matrix-<platform>.json`; an absent report stays absent. */
export function readShardReports(plan, directory) {
  const platform = planPlatform(plan)
  return Object.fromEntries(
    shardsOf(plan).flatMap((shard) => {
      const file = path.join(
        directory,
        `shard-${shard}`,
        `native-matrix-${platform}.json`
      )
      return fs.existsSync(file)
        ? [[shard, JSON.parse(fs.readFileSync(file, 'utf8'))]]
        : []
    })
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    const [action, plan, value] = process.argv.slice(2)
    if (action === 'merge') {
      const total = assertShardEvidence(plan, readShardReports(plan, value))
      console.log(`Both ${plan} matrix shards reported ${total} cases.`)
    } else if (action === 'cases')
      console.log(expectedMatrixCases(plan, parseShard(plan, value)).join('\n'))
    else throw new Error('matrix_shard_action_invalid')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
