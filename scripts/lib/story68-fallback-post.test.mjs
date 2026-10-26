import assert from 'node:assert/strict'
import test from 'node:test'
import { withUnavailableOwnedFallbackPost } from './story68-fallback-post.mjs'

const owner = 'cc68-native-11111111-1111-4111-8111-111111111111'
const id = 'cc68-native-22222222-2222-4222-8222-222222222222'
const database = `tea_community_${'a'.repeat(32)}`
const runtime = () => ({
  environment: {
    DATABASE_URL: `postgresql://x@127.0.0.1:54322/${database}`,
    API_BASE_URL: 'http://127.0.0.1:4088',
  },
  build: {
    EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
    STORY68_NATIVE_TEST_BUILD: '1',
  },
  resources: {
    owner: 'cc68-impl',
    createdDatabase: true,
    database,
    apiPort: 4088,
    createdIdentities: [{ appUserId: owner }],
  },
  apiLog: JSON.stringify({ code: 'owned_database_verified', database }),
})
const fixtures = () => ({
  postId: id,
  identities: [{ label: 'cc68-primary', appUserId: owner, pending: false }],
})
function fixture({ loseCommit = false } = {}) {
  const row = {
    id,
    user_id: owner,
    status: 'published',
    published_at: new Date(),
    erasure_requested_at: null,
    anonymized_at: null,
    fingerprint: 'b'.repeat(32),
    community_revision: '7',
    reaction_generation: 3,
  }
  const queries = []
  const writes = []
  let ended = false
  let transaction
  const client = {
    async connect() {
      return undefined
    },
    on() {
      return undefined
    },
    async query(sql, parameters) {
      queries.push(sql)
      if (sql.includes('current_database() AS name'))
        return { rows: [{ name: database }] }
      if (sql === 'BEGIN') transaction = { ...row }
      if (sql === 'COMMIT') {
        transaction = undefined
        if (loseCommit) {
          loseCommit = false
          throw new Error('commit_acknowledgement_lost')
        }
      }
      if (sql === 'ROLLBACK' && transaction) Object.assign(row, transaction)
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...row }] }
      if (sql.startsWith('UPDATE')) {
        assert.match(sql, /WHERE id = \$1 AND user_id = \$2 AND status = \$4/)
        assert.deepEqual(parameters.slice(0, 2), [id, owner])
        assert.equal(row.status, parameters[3])
        assert.equal(row.fingerprint, parameters[4])
        assert.equal(row.community_revision, parameters[5])
        assert.equal(row.reaction_generation, parameters[6])
        writes.push(parameters[2])
        row.status = parameters[2]
        row.reaction_generation++
        const returning = { ...row }
        row.community_revision = String(BigInt(row.community_revision) + 1n)
        return { rowCount: 1, rows: [returning] }
      }
      return { rows: [] }
    },
    async end() {
      ended = true
    },
  }
  return { row, writes, queries, client, ended: () => ended }
}
test('only the declared owned primary post can be hidden and its exact row is restored', async () => {
  const f = fixture()
  const before = { ...f.row }
  const result = await withUnavailableOwnedFallbackPost({
    runtime: runtime(),
    fixtures: fixtures(),
    createClient: () => f.client,
    whileUnavailable: async () => {
      assert.equal(f.row.status, 'withdrawn')
      return 'actual-native-proof'
    },
  })
  assert.deepEqual(f.row, {
    ...before,
    community_revision: String(BigInt(before.community_revision) + 2n),
    reaction_generation: before.reaction_generation + 2,
  })
  assert.deepEqual(f.writes, ['withdrawn', 'published'])
  assert.equal(result.contentRestored, true)
  assert.equal(result.value, 'actual-native-proof')
  assert.equal(f.ended(), true)
})
test('misrouted runtime or undeclared owner fails before constructing a database client', async () => {
  for (const corrupt of [
    (r) => {
      r.environment.DATABASE_URL = 'postgresql://x@127.0.0.1/postgres'
    },
    (r) => {
      r.resources.createdIdentities = []
    },
  ]) {
    const r = runtime()
    corrupt(r)
    let constructed = 0
    await assert.rejects(
      withUnavailableOwnedFallbackPost({
        runtime: r,
        fixtures: fixtures(),
        createClient: () => {
          constructed++
          return fixture().client
        },
        whileUnavailable: async () => assert.fail('must guard before UI'),
      }),
      /owned_uuid_loopback_database_required|owned_fallback_post_identity_required/
    )
    assert.equal(constructed, 0)
  }
})
test('a non-public or wrong-owner row is rejected before any write', async () => {
  for (const change of [
    { status: 'flagged' },
    { user_id: 'another-user' },
    { published_at: null },
  ]) {
    const f = fixture()
    Object.assign(f.row, change)
    await assert.rejects(
      withUnavailableOwnedFallbackPost({
        runtime: runtime(),
        fixtures: fixtures(),
        createClient: () => f.client,
        whileUnavailable: async () => assert.fail('must validate before UI'),
      }),
      /owned_fallback_post/
    )
    assert.deepEqual(f.writes, [])
    assert.ok(f.queries.includes('ROLLBACK'))
    assert.equal(f.ended(), true)
  }
})
test('a native proof failure still restores the exact original row and preserves its error', async () => {
  const f = fixture()
  const original = new Error('native_cursor_assertion_failed')
  await assert.rejects(
    withUnavailableOwnedFallbackPost({
      runtime: runtime(),
      fixtures: fixtures(),
      createClient: () => f.client,
      whileUnavailable: async () => {
        throw original
      },
    }),
    (error) => error === original
  )
  assert.equal(f.row.status, 'published')
  assert.deepEqual(f.writes, ['withdrawn', 'published'])
})
test('a concurrent row change fails restoration before overwriting it', async () => {
  const f = fixture()
  await assert.rejects(
    withUnavailableOwnedFallbackPost({
      runtime: runtime(),
      fixtures: fixtures(),
      createClient: () => f.client,
      whileUnavailable: async () => {
        f.row.fingerprint = 'c'.repeat(32)
      },
    }),
    /owned_fallback_restore_failed/
  )
  assert.deepEqual(f.writes, ['withdrawn'])
  assert.equal(f.row.fingerprint, 'c'.repeat(32))
  assert.equal(f.ended(), true)
})
test('a lost first commit acknowledgement still restores the status before returning failure', async () => {
  const f = fixture({ loseCommit: true })
  await assert.rejects(
    withUnavailableOwnedFallbackPost({
      runtime: runtime(),
      fixtures: fixtures(),
      createClient: () => f.client,
      whileUnavailable: async () => assert.fail('uncertain commit must not start UI'),
    }),
    /commit_acknowledgement_lost/
  )
  assert.equal(f.row.status, 'published')
  assert.deepEqual(f.writes, ['withdrawn', 'published'])
})
test('the effective database is checked before any transaction or write', async () => {
  const f = fixture()
  const query = f.client.query.bind(f.client)
  f.client.query = async (sql, parameters) =>
    sql.includes('current_database() AS name')
      ? { rows: [{ name: 'postgres' }] }
      : query(sql, parameters)
  await assert.rejects(
    withUnavailableOwnedFallbackPost({
      runtime: runtime(),
      fixtures: fixtures(),
      createClient: () => f.client,
      whileUnavailable: async () => assert.fail('misroute must not reach UI'),
    }),
    /effective_owned_database_mismatch/
  )
  assert.equal(f.queries.includes('BEGIN'), false)
  assert.deepEqual(f.writes, [])
})

test('concurrent generation changes prevent restoration without overwriting them', async () => {
  for (const field of ['community_revision', 'reaction_generation']) {
    const f = fixture()
    await assert.rejects(
      withUnavailableOwnedFallbackPost({
        runtime: runtime(),
        fixtures: fixtures(),
        createClient: () => f.client,
        whileUnavailable: async () => {
          f.row[field] = field === 'community_revision' ? '99' : 99
        },
      }),
      /owned_fallback_restore_failed/
    )
    assert.deepEqual(f.writes, ['withdrawn'])
    assert.equal(f.row[field], field === 'community_revision' ? '99' : 99)
  }
})
test('unexpected trigger deltas roll back before UI and leave the original content intact', async () => {
  const f = fixture()
  const before = { ...f.row }
  const query = f.client.query.bind(f.client)
  f.client.query = async (sql, parameters) => {
    const result = await query(sql, parameters)
    if (sql.startsWith('UPDATE'))
      f.row.community_revision = String(BigInt(f.row.community_revision) + 1n)
    return result
  }
  await assert.rejects(
    withUnavailableOwnedFallbackPost({
      runtime: runtime(),
      fixtures: fixtures(),
      createClient: () => f.client,
      whileUnavailable: async () =>
        assert.fail('unexpected database writes must not reach UI'),
    }),
    /owned_fallback_post_write_mismatch/
  )
  assert.deepEqual(f.row, before)
})
