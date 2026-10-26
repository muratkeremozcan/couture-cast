import { assertRapidWatermarkRuntime } from './story68-rapid-watermark.mjs'

const uuid = /^cc68-native-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const snapshotColumns = `id, user_id, status::text AS status,
  published_at, erasure_requested_at, anonymized_at,
  community_revision::text AS community_revision, reaction_generation,
  md5((to_jsonb(p) - 'status' - 'community_revision' - 'reaction_generation')::text) AS fingerprint`
const readPost = `SELECT ${snapshotColumns}
  FROM "LookbookPost" p WHERE id = $1 AND user_id = $2 FOR UPDATE`
function postMatches(row, identity, status, expected) {
  return (
    row?.id === identity.post &&
    row.user_id === identity.owner &&
    row.status === status &&
    row.published_at != null &&
    row.erasure_requested_at === null &&
    row.anonymized_at === null &&
    /^[a-f0-9]{32}$/.test(row.fingerprint) &&
    /^(0|[1-9][0-9]*)$/.test(row.community_revision) &&
    Number.isSafeInteger(row.reaction_generation) &&
    row.reaction_generation >= 0 &&
    (expected === undefined ||
      (row.fingerprint === expected.fingerprint &&
        row.community_revision === expected.community_revision &&
        row.reaction_generation === expected.reaction_generation))
  )
}
function nextGeneration(row) {
  return {
    ...row,
    community_revision: String(BigInt(row.community_revision) + 1n),
    reaction_generation: row.reaction_generation + 1,
  }
}
async function transition(
  client,
  identity,
  from,
  to,
  expected,
  onAttempt = () => undefined,
  alreadyRestored
) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL lock_timeout = '1000ms'")
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5000ms'")
    const read = await client.query(readPost, [identity.post, identity.owner])
    const row = read.rows[0]
    if (
      alreadyRestored &&
      read.rows.length === 1 &&
      postMatches(row, identity, to, alreadyRestored)
    ) {
      await client.query('COMMIT')
      return row
    }
    if (read.rows.length !== 1 || !postMatches(row, identity, from, expected))
      throw new Error('owned_fallback_post_changed')
    const next = nextGeneration(row)
    onAttempt(row, next)
    const changed = await client.query(
      `UPDATE "LookbookPost" p SET status = $3::"CommunityPostStatus"
      WHERE id = $1 AND user_id = $2 AND status = $4::"CommunityPostStatus"
        AND md5((to_jsonb(p) - 'status' - 'community_revision' - 'reaction_generation')::text) = $5
        AND community_revision = $6::bigint AND reaction_generation = $7::integer
      RETURNING ${snapshotColumns}`,
      [
        identity.post,
        identity.owner,
        to,
        from,
        row.fingerprint,
        row.community_revision,
        row.reaction_generation,
      ]
    )
    // RETURNING precedes the AFTER trigger that advances the stream revision.
    // Reread under the same row lock to verify both expected trigger effects.
    const actual = await client.query(readPost, [identity.post, identity.owner])
    if (
      changed.rowCount !== 1 ||
      actual.rows.length !== 1 ||
      !postMatches(actual.rows[0], identity, to, next)
    )
      throw new Error('owned_fallback_post_write_mismatch')
    await client.query('COMMIT')
    return next
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

/** Change the owned post's status; preserve content and verify trigger-owned generations. */
export async function withUnavailableOwnedFallbackPost({
  runtime,
  fixtures,
  createClient,
  whileUnavailable,
}) {
  const connectionString = assertRapidWatermarkRuntime(runtime)
  const primary = fixtures.identities.find((item) => item.label === 'cc68-primary')
  if (
    !uuid.test(fixtures.postId) ||
    !primary ||
    primary.pending !== false ||
    !uuid.test(primary.appUserId) ||
    !runtime.resources.createdIdentities.some(
      (item) => item.appUserId === primary.appUserId
    )
  )
    throw new Error('owned_fallback_post_identity_required')
  const identity = { post: fixtures.postId, owner: primary.appUserId }
  const client = createClient({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  })
  let failure
  let hidden = false
  let original
  let unavailable
  let value
  client.on('error', (error) => {
    failure ??= error
  })
  try {
    await client.connect()
    const effective = await client.query('SELECT current_database() AS name')
    if (effective.rows[0]?.name !== new URL(connectionString).pathname.slice(1))
      throw new Error('effective_owned_database_mismatch')
    unavailable = await transition(
      client,
      identity,
      'published',
      'withdrawn',
      undefined,
      (before, next) => {
        original = before
        unavailable = next
        hidden = true
      }
    )
    value = await whileUnavailable()
  } catch (error) {
    failure ??= error
  } finally {
    if (hidden) {
      try {
        await transition(
          client,
          identity,
          'withdrawn',
          'published',
          unavailable,
          undefined,
          original
        )
      } catch (error) {
        failure = new AggregateError(
          [failure, error].filter(Boolean),
          'owned_fallback_restore_failed'
        )
      }
    }
    try {
      await client.end()
    } catch (error) {
      failure ??= error
    }
  }
  if (failure) throw failure
  return { contentRestored: true, triggerGenerationsAdvanced: true, value }
}
