/**
 * Two-way split of the iOS native journey. Run 28 needed about 120 minutes on one runner (85
 * flows passed in 90). Each shard boots its own simulator, Supabase, Metro and signed-in account,
 * installs the app one build job produced, and runs the sections below. `open` and `signin`
 * run in every shard; nothing else repeats.
 *
 * The matrix sections and locales each shard runs live in native-matrix-shards.mjs, which plans
 * both platforms. This module adds the iOS harness commands around the matrix, and the tests
 * prove every section, locale and command belongs to exactly one shard.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  MATRIX_SECTIONS as PLATFORM_MATRIX_SECTIONS,
  MATRIX_SHARD_PLAN,
  SHARD_COUNT,
  LOCALES,
  assertShardEvidence as assertPlatformShardEvidence,
  expectedMatrixCases as platformMatrixCases,
  inMatrixSection as inPlatformMatrixSection,
  localesForShard as platformLocalesForShard,
  parseShard as parsePlatformShard,
  readShardReports,
} from './native-matrix-shards.mjs'

export { SHARD_COUNT, LOCALES }

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

/** The iOS harness commands of each shard, with its matrix sections and locales. */
export const SHARD_PLAN = Object.freeze({
  1: {
    ...MATRIX_SHARD_PLAN.ios[1],
    // Shard 1 finished in 49 of its 100 minutes on main run 41104845732; shard 2 is the longer.
    commands: ['proof', 'share-sheet'],
  },
  2: {
    ...MATRIX_SHARD_PLAN.ios[2],
    // `proof` denies and then grants Photos add-only through the real UI and simctl, and runs in
    // shard 1 only. Shard 2 reaches the same permission state directly. Its commands are listed,
    // never spread from AFTER_MATRIX, so a new post-matrix command lands in one shard by choice.
    commands: ['permission-baseline', 'rapid-watermark', 'a11y', 'fallback-focus'],
  },
})

/** `1/2` or `2/2` to the shard number; anything else throws. */
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
 * or truncated shard can never pass for the whole journey.
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
        `Both iOS shards reported ${assertShardEvidence(readShardReports('ios', value))} cases.`
      )
    else throw new Error('ios_shard_action_invalid')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
