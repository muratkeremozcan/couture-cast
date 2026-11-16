// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling 3 on the iOS community leg (run 43773613293): the seeded feed of thirteen posts took
// 30 drags at the base scale alone and failed as live_font_scroll_bottom_unreached. The leg runs
// on a feed of known length instead: the harness database publishes exactly the posts it names.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { CC68_SEEDED_POST_ID } from './story68-fallback-post.mjs'
import {
  LIVE_FONT_COMMUNITY_FEED,
  scopeCommunityFeed,
  scopesCommunityFeed,
} from './live-font-community-feed.mjs'

const DATABASE = `tea_community_${'c3'.repeat(16)}`
const URL = `postgresql://postgres:pw@127.0.0.1:54322/${DATABASE}`
const owned = { DATABASE_URL: URL }

/**
 * A harness database of `published` post ids: answers the statements scopeCommunityFeed sends,
 * by their shape, and records each.
 */
function fakeDatabase(published, { failOn } = {}) {
  const status = new Map(published.map((id) => [id, 'published']))
  const calls = []
  const query = async (url, sql, params) => {
    calls.push({ url, sql, params })
    if (failOn && sql.includes(failOn)) throw new Error('connection refused')
    const [ids] = params
    if (/SET "status" = 'withdrawn'/.test(sql)) {
      const rows = [...status]
        .filter(([id, state]) => state === 'published' && !ids.includes(id))
        .map(([id]) => ({ id }))
      for (const { id } of rows) status.set(id, 'withdrawn')
      return { rowCount: rows.length, rows }
    }
    if (/SET "status" = 'published'/.test(sql)) {
      const rows = ids
        .filter((id) => status.get(id) === 'withdrawn')
        .map((id) => ({ id }))
      for (const { id } of rows) status.set(id, 'published')
      return { rowCount: rows.length, rows }
    }
    if (/^SELECT "id" FROM "LookbookPost"\s+WHERE "status" = 'published'/.test(sql)) {
      const rows = [...status]
        .filter(([, state]) => state === 'published')
        .map(([id]) => ({ id }))
      return { rowCount: rows.length, rows }
    }
    throw new Error(`unexpected statement: ${sql}`)
  }
  return { query, calls, status }
}

const SEEDED = [
  CC68_SEEDED_POST_ID,
  'lookbook-1',
  'lookbook-2',
  'lookbook-3',
  'lookbook-4',
  'lookbook-5',
  ...Array.from({ length: 7 }, (_, index) => `seed-spotlight-${index + 1}`),
]

describe('the live font Community feed', () => {
  test('names the owned post and one other member post, two cards of known length', () => {
    assert.deepEqual(LIVE_FONT_COMMUNITY_FEED, [CC68_SEEDED_POST_ID, 'lookbook-1'])
    assert.ok(Object.isFrozen(LIVE_FONT_COMMUNITY_FEED))
  })

  test('only the iOS Community screen scopes the feed', () => {
    assert.equal(scopesCommunityFeed({ platform: 'ios', screen: 'community' }), true)
    for (const [platform, screen] of [
      ['android', 'community'],
      ['ios', 'home'],
      ['ios', 'settings'],
      ['ios', 'composer'],
    ])
      assert.equal(
        scopesCommunityFeed({ platform, screen }),
        false,
        `${platform} ${screen}`
      )
  })

  test('withdraws every other published post, proves the feed, and restores exactly those', async () => {
    const db = fakeDatabase(SEEDED)
    const scoped = await scopeCommunityFeed({ ownedEnv: owned, query: db.query })
    assert.deepEqual(scoped.kept, [...LIVE_FONT_COMMUNITY_FEED])
    assert.deepEqual(
      [...scoped.withdrawn].sort(),
      SEEDED.filter((id) => !LIVE_FONT_COMMUNITY_FEED.includes(id)).sort()
    )
    assert.deepEqual(
      [...db.status].filter(([, state]) => state === 'published').map(([id]) => id),
      [...LIVE_FONT_COMMUNITY_FEED]
    )
    // Every statement reaches the harness's own database only.
    assert.ok(db.calls.every((call) => call.url === URL))
    await scoped.restore()
    assert.deepEqual(
      [...db.status].filter(([, state]) => state === 'published').map(([id]) => id),
      SEEDED
    )
    // A second restore changes nothing.
    await scoped.restore()
    assert.equal(
      db.calls.filter((call) => /'published'\s+WHERE/.test(call.sql)).length,
      1
    )
  })

  test('a post the feed names that is not published fails before any capture', async () => {
    const db = fakeDatabase(SEEDED.filter((id) => id !== 'lookbook-1'))
    await assert.rejects(scopeCommunityFeed({ ownedEnv: owned, query: db.query }), {
      code: 'live_font_community_feed_unexpected',
      message: /lookbook-1/,
    })
    // What it withdrew is put back before it fails.
    assert.deepEqual(
      [...db.status].filter(([, state]) => state === 'published').map(([id]) => id),
      SEEDED.filter((id) => id !== 'lookbook-1')
    )
  })

  test('a published post the feed does not name fails before any capture', async () => {
    const db = fakeDatabase(SEEDED)
    const leaky = async (url, sql, params) => {
      const result = await db.query(url, sql, params)
      // A post published again between the withdrawal and the check (another writer).
      if (/SET "status" = 'withdrawn'/.test(sql)) db.status.set('lookbook-5', 'published')
      return result
    }
    await assert.rejects(scopeCommunityFeed({ ownedEnv: owned, query: leaky }), {
      code: 'live_font_community_feed_unexpected',
      message: /lookbook-5/,
    })
  })

  // CodeRabbit on PR 242: a failed restoration must not count as done, so the runner's next
  // restore() still publishes the withdrawn posts.
  test('a failed restore can be retried', async () => {
    const db = fakeDatabase(SEEDED)
    let refuseRestore = true
    const flaky = async (url, sql, params) => {
      if (refuseRestore && /SET "status" = 'published'/.test(sql)) {
        refuseRestore = false
        throw new Error('connection reset')
      }
      return db.query(url, sql, params)
    }
    const scoped = await scopeCommunityFeed({ ownedEnv: owned, query: flaky })
    await assert.rejects(scoped.restore(), {
      code: 'live_font_community_feed_failed',
      message: /connection reset/,
    })
    await scoped.restore()
    assert.deepEqual(
      [...db.status].filter(([, state]) => state === 'published').map(([id]) => id),
      SEEDED
    )
  })

  // CodeRabbit on PR 242: the runner has no handle until the scope resolves, so a failed check
  // after the withdrawal puts the posts back itself.
  test('a failed check after the withdrawal restores the withdrawn posts', async () => {
    const db = fakeDatabase(SEEDED)
    const checkFails = async (url, sql, params) => {
      if (/^SELECT "id" FROM "LookbookPost"/.test(sql))
        throw new Error('connection refused')
      return db.query(url, sql, params)
    }
    await assert.rejects(scopeCommunityFeed({ ownedEnv: owned, query: checkFails }), {
      code: 'live_font_community_feed_failed',
      message: /connection refused/,
    })
    assert.deepEqual(
      [...db.status].filter(([, state]) => state === 'published').map(([id]) => id),
      SEEDED
    )
  })

  test('refuses a database that is not the harness database, and reports a failed write', async () => {
    const db = fakeDatabase(SEEDED)
    await assert.rejects(
      scopeCommunityFeed({
        ownedEnv: { DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:54322/postgres' },
        query: db.query,
      }),
      { code: 'live_font_harness_database_required' }
    )
    assert.equal(db.calls.length, 0)
    await assert.rejects(
      scopeCommunityFeed({
        ownedEnv: owned,
        query: fakeDatabase(SEEDED, { failOn: 'withdrawn' }).query,
      }),
      { code: 'live_font_community_feed_failed', message: /connection refused/ }
    )
  })
})
