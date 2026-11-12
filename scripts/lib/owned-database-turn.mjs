// The share-card browser matrix runs three Playwright workers against one owned database.
// The P-WATERMARK barrier (story68-browser-watermark.mjs) locks the whole LookbookPost
// table and counts any blocked SELECT on it as its own request, so for its window no
// other worker may touch the database. This is a reader-writer turn on a Postgres
// advisory lock: every test holds it shared for its duration, and the barrier takes it
// exclusive. Postgres queues a new shared request behind a waiting exclusive one, so the
// barrier waits only for the tests already running, and none starts until it is done.
// Codex review of PR 211.

/** Advisory lock key: "6.14", then the PR number. */
export const OWNED_DATABASE_TURN_KEY = 614211

/**
 * @param {{ query: (sql: string, values?: unknown[]) => Promise<unknown> }} client
 *   a connected pg client of its own, used for nothing else
 */
export function ownedDatabaseTurn(client) {
  let held = /** @type {'none' | 'shared' | 'exclusive'} */ ('none')
  const call = (fn) => client.query(`SELECT ${fn}($1)`, [OWNED_DATABASE_TURN_KEY])
  return {
    get held() {
      return held
    },
    /** Waits while a barrier holds or waits for the turn, then shares it. */
    async share() {
      if (held === 'shared') return
      if (held === 'exclusive') await call('pg_advisory_unlock')
      held = 'none'
      await call('pg_advisory_lock_shared')
      held = 'shared'
    },
    /** Gives up this test's share, then waits until no other test holds one. */
    async exclusive() {
      if (held === 'exclusive') return
      // Holding a share while waiting would deadlock two barriers waiting for each other.
      if (held === 'shared') await call('pg_advisory_unlock_shared')
      held = 'none'
      await call('pg_advisory_lock')
      held = 'exclusive'
    },
    async release() {
      if (held === 'shared') await call('pg_advisory_unlock_shared')
      if (held === 'exclusive') await call('pg_advisory_unlock')
      held = 'none'
    },
  }
}
