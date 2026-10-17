/*
 * The code defaults of the two Community rollout flags, read from the shared
 * flag contract in `packages/config/src/flags.ts`.
 *
 * Story 6.2b. The readiness evidence's `rollout-closed` gate requires both
 * defaults to be false, and the hosted canary refuses to run while
 * `community_read_enabled` defaults to anything else, because its synthetic
 * post publishes into whatever feed the production API serves (final review,
 * RF5). The file is TypeScript the scripts cannot import directly, so each
 * default is read from its `defaultValue`; a flag whose default cannot be read
 * comes back null, and every caller treats null as not closed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FLAGS_SOURCE = 'packages/config/src/flags.ts'

/** The boolean `defaultValue` of `key` in the flag contract's source, or null. */
export function flagDefault(source, key) {
  const match = new RegExp(
    `\\b${key}\\s*:\\s*\\{[^}]*?defaultValue\\s*:\\s*(true|false)\\b`,
    's'
  ).exec(source)
  return match ? match[1] === 'true' : null
}

export function readCommunityRolloutDefaults(
  source = fs.readFileSync(path.resolve(__dirname, '../..', FLAGS_SOURCE), 'utf8')
) {
  return {
    communityReadEnabled: flagDefault(source, 'community_read_enabled'),
    communityWriteEnabled: flagDefault(source, 'community_write_enabled'),
    source: `${FLAGS_SOURCE} defaultValue`,
  }
}
