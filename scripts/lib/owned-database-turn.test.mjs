// The reader-writer turn the share-card browser workers take on their one owned database
// (owned-database-turn.mjs). Codex review of PR 211: three workers ran the P-WATERMARK
// barrier, which locks the whole LookbookPost table, against each other's traffic.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OWNED_DATABASE_TURN_KEY, ownedDatabaseTurn } from './owned-database-turn.mjs'

const recording = () => {
  const calls = []
  return {
    calls,
    client: {
      query: async (sql, values) => {
        assert.deepEqual(values, [OWNED_DATABASE_TURN_KEY])
        calls.push(/SELECT (\w+)\(/.exec(sql)[1])
      },
    },
  }
}

test('a test shares the turn, and the barrier gives up its share before taking it alone', async () => {
  const { calls, client } = recording()
  const turn = ownedDatabaseTurn(client)
  await turn.share()
  await turn.exclusive()
  assert.equal(turn.held, 'exclusive')
  await turn.share()
  await turn.release()
  assert.equal(turn.held, 'none')
  assert.deepEqual(calls, [
    'pg_advisory_lock_shared',
    // Two barriers each still sharing while they wait would deadlock.
    'pg_advisory_unlock_shared',
    'pg_advisory_lock',
    'pg_advisory_unlock',
    'pg_advisory_lock_shared',
    'pg_advisory_unlock_shared',
  ])
})

test('asking for what is already held takes nothing twice', async () => {
  const { calls, client } = recording()
  const turn = ownedDatabaseTurn(client)
  await turn.share()
  await turn.share()
  await turn.exclusive()
  await turn.exclusive()
  await turn.release()
  await turn.release()
  assert.deepEqual(calls, [
    'pg_advisory_lock_shared',
    'pg_advisory_unlock_shared',
    'pg_advisory_lock',
    'pg_advisory_unlock',
  ])
})
