import { Client } from 'pg'

/**
 * The privacy capability every integration database runs with.
 *
 * At `privacy_version` 1 the privacy triggers refuse a write to a member's or a post's
 * privacy state unless the transaction holds that subject's exclusive guard
 * (`community_require_guard`). The migration leaves the row at 0 so a deploy cannot
 * switch the guard on by itself; production advances it once, deliberately. Every
 * product write path takes the guard either way, and the integration tier runs with
 * the guard on so a path that forgets it fails here, never in production.
 *
 * Suites that need the guard off for one step set 0 and restore 1 themselves.
 */
export const INTEGRATION_PRIVACY_VERSION = 1

export const ENABLE_PRIVACY_GUARD_SQL = `UPDATE "CommunityRuntimeCapability" SET privacy_version = ${INTEGRATION_PRIVACY_VERSION} WHERE id = 1`

/** Opens a client, or answers null when the database cannot be reached. */
async function connect(url: string): Promise<Client | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    return client
  } catch {
    return null
  }
}

/**
 * Turns the guard on in a migrated database and answers the version it found, so the
 * caller can put it back. A database without the capability table, or one that cannot
 * be reached, is left alone (null): the suites that need it probe for their schema and
 * skip, as they always have.
 */
export async function enablePrivacyGuard(url: string): Promise<number | null> {
  const client = await connect(url)
  if (!client) return null
  try {
    const table = await client.query<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      ['public."CommunityRuntimeCapability"']
    )
    if (!table.rows[0]?.present) return null
    const found = await client.query<{ privacy_version: number }>(
      'SELECT privacy_version FROM "CommunityRuntimeCapability" WHERE id = 1'
    )
    await client.query(ENABLE_PRIVACY_GUARD_SQL)
    return found.rows[0]?.privacy_version ?? null
  } finally {
    await client.end()
  }
}

/** Puts back the version `enablePrivacyGuard` found. */
export async function restorePrivacyVersion(url: string, version: number): Promise<void> {
  const client = await connect(url)
  if (!client) return
  try {
    await client.query(
      'UPDATE "CommunityRuntimeCapability" SET privacy_version = $1 WHERE id = 1',
      [version]
    )
  } finally {
    await client.end()
  }
}
