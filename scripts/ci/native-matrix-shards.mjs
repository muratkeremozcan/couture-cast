/**
 * Two-way split of the native share-card matrix on iOS and Android. Each shard boots its own
 * simulator or emulator, Supabase, Metro and signed-in account and runs the sections and locales
 * its platform plan gives it. The runner reads this table through `--shard N/2`; an unsharded
 * run (API32, local runs) runs every section and locale.
 *
 * The split is data, and the tests prove it is a partition: every section and locale belongs to
 * exactly one shard per platform, and the cases a shard must report come from the same table the
 * runner reads. This module imports only Node built-ins, so the evidence jobs run it straight
 * from a checkout.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SHARD_COUNT = 2
export const PLATFORMS = Object.freeze(['android', 'ios'])

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

/**
 * Minutes each part of the Android API36 matrix journey took on main run 41104845732, whose one
 * journey step ran all 43 cases in 43.4 minutes. `shardSetup` is what every shard repeats:
 * emulator boot inside the step (1.5), install and open (0.7), sign-in (3.5) and the en-US
 * Settings locale the matrix starts from (0.5). `save-lifecycle` includes its sign-in after
 * sign-out. Run 41190704639 ran every one of these parts about 1.4x slower.
 */
export const ANDROID_MEASURED_MINUTES = Object.freeze({
  shardSetup: 6.2,
  'pre-locale': 7.0,
  locale: 1.68,
  'large-text': 1.8,
  'precommit-lifecycle': 4.7,
  'save-lifecycle': 6.5,
  'prefs-failed': 0.5,
})

/** The placement. Edit this table, never the runner, to rebalance a platform. */
export const MATRIX_SHARD_PLAN = Object.freeze({
  ios: Object.freeze({
    1: Object.freeze({
      sections: ['pre-locale', 'prefs-failed'],
      locales: LOCALES.slice(0, 5),
    }),
    2: Object.freeze({
      sections: ['large-text', 'precommit-lifecycle', 'save-lifecycle'],
      locales: LOCALES.slice(5),
    }),
  }),
  // The iOS sections with one more locale in shard 1, because the Android lifecycle sections
  // weigh 13.0 minutes against 7.5 for pre-locale and prefs-failed. Nominal journey steps:
  // shard 1 23.8 minutes, shard 2 25.9 (androidNominalMinutes).
  android: Object.freeze({
    1: Object.freeze({
      sections: ['pre-locale', 'prefs-failed'],
      locales: LOCALES.slice(0, 6),
    }),
    2: Object.freeze({
      sections: ['large-text', 'precommit-lifecycle', 'save-lifecycle'],
      locales: LOCALES.slice(6),
    }),
  }),
})

const planOf = (platform) => {
  const plan = MATRIX_SHARD_PLAN[platform]
  if (!plan) throw new Error(`shard_platform_invalid:${platform}`)
  return plan
}

export const shardsOf = (platform) => Object.keys(planOf(platform)).map(Number)

/** `1/2` or `2/2` to the shard number; anything else throws. */
export function parseShard(platform, value) {
  const plan = planOf(platform)
  const m = /^([1-9])\/([1-9])$/.exec(String(value ?? ''))
  if (!m || Number(m[2]) !== SHARD_COUNT || !plan[Number(m[1])])
    throw new Error(`${platform}_shard_invalid:${value}`)
  return Number(m[1])
}

/** With no shard every section and locale runs. */
export const inMatrixSection = (platform, shard, section) =>
  shard === undefined || planOf(platform)[shard].sections.includes(section)

export const localesForShard = (platform, shard) =>
  shard === undefined ? [...LOCALES] : [...planOf(platform)[shard].locales]

/** Case ids a completed matrix of this platform and shard must report, in sorted order. */
export function expectedMatrixCases(platform, shard) {
  return [
    ...Object.entries(MATRIX_SECTIONS[platform])
      .filter(([section]) => inMatrixSection(platform, shard, section))
      .flatMap(([, ids]) => ids),
    ...localesForShard(platform, shard).flatMap((locale) =>
      localeCases(platform, locale)
    ),
  ].sort()
}

/** Expected Android journey-step minutes for a shard, or for the whole matrix with none. */
export function androidNominalMinutes(shard) {
  const m = ANDROID_MEASURED_MINUTES
  const work = Object.keys(MATRIX_SECTIONS.android)
    .filter((section) => inMatrixSection('android', shard, section))
    .reduce((sum, section) => sum + m[section], 0)
  const minutes =
    m.shardSetup + work + localesForShard('android', shard).length * m.locale
  return Math.round(minutes * 10) / 10
}

/**
 * The merged verdict across shard reports (`native-matrix-<platform>.json` of each shard). A
 * missing shard, an incomplete report or a case set that differs from the plan is a failure, so
 * a skipped or truncated shard can never pass for the whole matrix.
 */
export function assertShardEvidence(platform, byShard) {
  const shards = shardsOf(platform)
  const missing = shards.filter((shard) => !byShard?.[shard])
  if (missing.length) throw new Error(`${platform}_shard_missing:${missing.join(',')}`)
  const wrong = shards.filter((shard) => {
    const report = byShard[shard]
    const got = (report.cases ?? []).map((c) => c.id).sort()
    return (
      report.platform !== platform ||
      report.completed !== true ||
      (report.cases ?? []).some((c) => c.passed !== true) ||
      JSON.stringify(got) !== JSON.stringify(expectedMatrixCases(platform, shard))
    )
  })
  if (wrong.length)
    throw new Error(`${platform}_shard_evidence_incomplete:${wrong.join(',')}`)
  return shards.flatMap((shard) => expectedMatrixCases(platform, shard)).length
}

/** Reads `<directory>/shard-N/native-matrix-<platform>.json`; an absent report stays absent. */
export function readShardReports(platform, directory) {
  return Object.fromEntries(
    shardsOf(platform).flatMap((shard) => {
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
    const [action, platform, value] = process.argv.slice(2)
    if (action === 'merge') {
      const total = assertShardEvidence(platform, readShardReports(platform, value))
      console.log(`Both ${platform} matrix shards reported ${total} cases.`)
    } else if (action === 'cases')
      console.log(expectedMatrixCases(platform, parseShard(platform, value)).join('\n'))
    else throw new Error('matrix_shard_action_invalid')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
