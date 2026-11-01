/**
 * Four-way split of the iOS native journey. Run 28 needed about 120 minutes on one runner (85
 * flows passed in 90), and two shards still took 50 and 58 minutes on main run 41312266186. Each
 * shard boots its own simulator, Supabase, Metro and signed-in account, installs the development
 * client the build job keyed by its native fingerprint, and runs the sections below. `open` and
 * `signin` run in every shard, and every shard but the one that runs `proof` sets the post-proof
 * Photos permission with `permission-baseline`; nothing else repeats.
 *
 * The matrix sections and locales each shard runs live in native-matrix-shards.mjs, which plans
 * both platforms. This module adds the iOS harness commands around the matrix, and the tests
 * prove every section, locale and command belongs to exactly one shard.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  MATRIX_SECTIONS as PLATFORM_MATRIX_SECTIONS,
  MATRIX_SHARD_PLANS,
  LOCALES,
  assertShardEvidence as assertPlatformShardEvidence,
  expectedMatrixCases as platformMatrixCases,
  inMatrixSection as inPlatformMatrixSection,
  localesForShard as platformLocalesForShard,
  nominalMinutes as platformNominalMinutes,
  parseShard as parsePlatformShard,
  readShardReports,
  shardCountOf,
} from './native-matrix-shards.mjs'

export { LOCALES }

export const SHARD_COUNT = shardCountOf('ios')

/** iOS matrix sections in runner order with the case ids each one marks. */
export const MATRIX_SECTIONS = PLATFORM_MATRIX_SECTIONS.ios

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

/**
 * The iOS harness commands of each shard, with its matrix sections and locales. `proof` denies and
 * then grants Photos add-only through the real UI and simctl, and runs in shard 1 only; the other
 * shards reach the same permission state directly with `permission-baseline` before their matrix.
 * Each list is written out, never spread from AFTER_MATRIX, so a new post-matrix command lands in
 * one shard by choice. rapid-watermark sets en-US before a11y, which sets no locale itself.
 */
export const SHARD_PLAN = Object.freeze({
  1: { ...MATRIX_SHARD_PLANS.ios.shards[1], commands: ['proof'] },
  2: { ...MATRIX_SHARD_PLANS.ios.shards[2], commands: ['permission-baseline'] },
  3: {
    ...MATRIX_SHARD_PLANS.ios.shards[3],
    commands: ['permission-baseline', 'rapid-watermark', 'a11y', 'fallback-focus'],
  },
  4: {
    ...MATRIX_SHARD_PLANS.ios.shards[4],
    commands: ['permission-baseline', 'share-sheet'],
  },
})

/** Expected job minutes of a shard from the measured parts in MATRIX_SHARD_PLANS.ios. */
export const nominalMinutes = (shard) =>
  platformNominalMinutes('ios', shard, SHARD_PLAN[shard].commands)

/** `N/4` to the shard number N; anything else throws. */
export const parseShard = (value) => parsePlatformShard('ios', value)

/** With no shard (local runs) every section, locale and command runs. */
export const inMatrixSection = (shard, section) =>
  inPlatformMatrixSection('ios', shard, section)

export const localesForShard = (shard) => platformLocalesForShard('ios', shard)

export const runsCommand = (shard, command) =>
  shard === undefined || SHARD_PLAN[shard].commands.includes(command)

/** Case ids a completed matrix of this shard must report, in sorted order. */
export const expectedMatrixCases = (shard) => platformMatrixCases('ios', shard)

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
 * or truncated shard can never pass for the whole journey. A shard with no section and no locale
 * still runs the matrix, which reports its exact empty case set.
 */
export const assertShardEvidence = (byShard) =>
  assertPlatformShardEvidence('ios', byShard)

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    const [action, value] = process.argv.slice(2)
    if (action === 'commands') console.log(commandsForShard(parseShard(value)).join('\n'))
    else if (action === 'merge')
      console.log(
        `All ${SHARD_COUNT} iOS shards reported ${assertShardEvidence(readShardReports('ios', value))} cases.`
      )
    else throw new Error('ios_shard_action_invalid')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
