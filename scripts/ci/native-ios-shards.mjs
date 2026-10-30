/**
 * Two-way split of the iOS native journey. Run 28 needed about 120 minutes on one runner (85
 * flows passed in 90). Each shard boots its own simulator, Supabase, Metro and signed-in account,
 * installs the app one build job produced, and runs the sections below. `open` and `signin`
 * run in every shard; nothing else repeats.
 *
 * The split is data, and the tests prove it is a partition: every matrix section, locale and
 * harness command belongs to exactly one shard, and the cases a shard must report are derived
 * from the same table the runner reads.
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

/** Matrix sections in runner order with the case ids each one marks. */
export const MATRIX_SECTIONS = Object.freeze({
  'pre-locale': [
    'M-CANCEL:preparation-before-commit',
    'M-POST M-SAVE',
    'M-A11Y:community-draft-native-host-foreground',
    'M-CANCEL M-WATERMARK',
    'M-STORAGE:cache_failure',
    'M-STORAGE:cache_failure:retry-recovers',
    'M-STORAGE:storage',
    'M-STORAGE:storage:retry-recovers',
    'M-OFFLINE',
    'M-OFFLINE:retry-recovers',
    'M-NATIVE-UNAVAILABLE:restricted-adapter-boundary',
    'U-PERMISSION-LIMITED:native-adapter-integration',
  ],
  'large-text': ['M-A11Y:large-text-pt-PT'],
  'precommit-lifecycle': [
    'M-CANCEL M-SINGLE-WRITE:precommit-authorization-close',
    'M-CANCEL M-SINGLE-WRITE:precommit-authorization-navigation',
  ],
  'save-lifecycle': [
    'M-SAVE-OWNERSHIP:current-saving',
    'M-SAVE-OWNERSHIP:reopened-finishing',
    'M-WATERMARK:reopen-after-settlement',
    'M-SINGLE-WRITE M-IDENTITY:close',
    'M-SAVE-OWNERSHIP:current-saving',
    'M-SINGLE-WRITE M-IDENTITY:navigation',
    'M-SAVE-OWNERSHIP:current-saving',
    'M-SINGLE-WRITE M-IDENTITY:signout',
  ],
  'prefs-failed': ['M-UI:prefs-failed-state-light-dark'],
})

/**
 * Harness commands that follow the matrix, in runner order; any of them can be dispatched. Each
 * shard names its own in SHARD_PLAN. `expo-go-proof` is no shard's: it has never passed on a shard
 * (runs 40992501585 to 41019906459, last in shard 2 on a host with 74 MB free), so the
 * `ios-expo-go` job runs it alone on a fresh simulator and the shards end here. `share-sheet`
 * (Story 6.9) runs the share fixture flows, the real-sheet smoke and ShareCardShareSheetUITests.
 */
export const AFTER_MATRIX = Object.freeze([
  'rapid-watermark',
  'a11y',
  'fallback-focus',
  'share-sheet',
])

/** The placement. Edit this table, never the runner, to rebalance the shards. */
export const SHARD_PLAN = Object.freeze({
  1: {
    sections: ['pre-locale', 'prefs-failed'],
    locales: LOCALES.slice(0, 5),
    // Shard 1 finished in 49 of its 100 minutes on main run 41104845732; shard 2 is the longer.
    commands: ['proof', 'share-sheet'],
  },
  2: {
    sections: ['large-text', 'precommit-lifecycle', 'save-lifecycle'],
    locales: LOCALES.slice(5),
    // `proof` denies and then grants Photos add-only through the real UI and simctl, and runs in
    // shard 1 only. Shard 2 reaches the same permission state directly. Its commands are listed,
    // never spread from AFTER_MATRIX, so a new post-matrix command lands in one shard by choice.
    commands: ['permission-baseline', 'rapid-watermark', 'a11y', 'fallback-focus'],
  },
})

const shards = () => Object.keys(SHARD_PLAN).map(Number)

/** `1/2` or `2/2` to the shard number; anything else throws. */
export function parseShard(value) {
  const m = /^([1-9])\/([1-9])$/.exec(String(value ?? ''))
  if (!m || Number(m[2]) !== SHARD_COUNT || !SHARD_PLAN[Number(m[1])])
    throw new Error(`ios_shard_invalid:${value}`)
  return Number(m[1])
}

/** With no shard (Android, local runs) every section, locale and command runs. */
export const inMatrixSection = (shard, section) =>
  shard === undefined || SHARD_PLAN[shard].sections.includes(section)

export const localesForShard = (shard) =>
  shard === undefined ? [...LOCALES] : [...SHARD_PLAN[shard].locales]

export const runsCommand = (shard, command) =>
  shard === undefined || SHARD_PLAN[shard].commands.includes(command)

/** Case ids a completed matrix of this shard must report, in sorted order. */
export function expectedMatrixCases(shard) {
  return [
    ...Object.entries(MATRIX_SECTIONS)
      .filter(([section]) => inMatrixSection(shard, section))
      .flatMap(([, ids]) => ids),
    ...localesForShard(shard).map((locale) => `M-LOCALE:${locale}`),
  ].sort()
}

/**
 * Harness commands a shard runs after `open`, in order. Sign-in repeats in every shard because
 * each shard owns its Supabase stack and therefore its account.
 */
export const commandsForShard = (shard) => [
  'signin',
  ...(runsCommand(shard, 'proof') ? ['proof'] : []),
  ...(runsCommand(shard, 'permission-baseline') ? ['permission-baseline'] : []),
  'matrix',
  ...AFTER_MATRIX.filter((command) => runsCommand(shard, command)),
]

/**
 * The merged verdict across shard reports (`native-matrix-ios.json` of each shard). A missing
 * shard, an incomplete report or a case set that differs from the plan is a failure, so a skipped
 * or truncated shard can never pass for the whole journey.
 */
export function assertShardEvidence(byShard) {
  const missing = shards().filter((shard) => !byShard?.[shard])
  if (missing.length) throw new Error(`ios_shard_missing:${missing.join(',')}`)
  const wrong = shards().filter((shard) => {
    const report = byShard[shard]
    const got = (report.cases ?? []).map((c) => c.id).sort()
    return (
      report.completed !== true ||
      (report.cases ?? []).some((c) => c.passed !== true) ||
      JSON.stringify(got) !== JSON.stringify(expectedMatrixCases(shard))
    )
  })
  if (wrong.length) throw new Error(`ios_shard_evidence_incomplete:${wrong.join(',')}`)
  return shards().flatMap((shard) => expectedMatrixCases(shard)).length
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    const [action, value] = process.argv.slice(2)
    if (action === 'commands') console.log(commandsForShard(parseShard(value)).join('\n'))
    else if (action === 'merge') {
      const byShard = Object.fromEntries(
        Object.keys(SHARD_PLAN).map((shard) => [
          shard,
          JSON.parse(
            fs.readFileSync(
              path.join(value, `shard-${shard}`, 'native-matrix-ios.json'),
              'utf8'
            )
          ),
        ])
      )
      console.log(`Both iOS shards reported ${assertShardEvidence(byShard)} cases.`)
    } else throw new Error('ios_shard_action_invalid')
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'ios_shard_missing' : error.message)
    process.exitCode = 1
  }
}
