// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling 3 on the iOS Community leg. The harness seed publishes thirteen posts (five
// lookbooks, seven City Spotlight posts, the owned post), each a card about 650 pt tall on iOS,
// so the feed took 30 drags at the base scale alone (run 43773613293, pages 1 to 30, the last a
// 49 pt final drag) and failed as live_font_scroll_bottom_unreached; at every larger scale it is
// longer still, and with every page probed (F-00i) one capture took 13 minutes, so the leg's 16
// scrolling captures could never finish inside its step. A drag budget raised to fit would only
// track the seed and the scale. So the leg runs on a feed of known length: before the
// Community screen the run withdraws every published post but the two LIVE_FONT_COMMUNITY_FEED
// names, through the harness's own database only, checks that exactly those two are published,
// and puts the others back after the screen. The two are the owned post ("You", its owner's
// card) and one other member's lookbook, so both card variants are measured.
//
// Android keeps the seeded feed: its drags measure the same feed in fewer, faster pages (the
// 6c85bbb4 Community feed ended 13 pages down) and its approved residual entries were captured
// on it.
import { CC68_SEEDED_POST_ID } from './story68-fallback-post.mjs'
import { harnessDatabaseUrl } from './live-font-weather.mjs'

/** The posts the iOS Community leg's feed publishes, in feed order (newest first). */
export const LIVE_FONT_COMMUNITY_FEED = Object.freeze([CC68_SEEDED_POST_ID, 'lookbook-1'])

/** Whether the run scopes the feed for `screen` on `platform`: the iOS Community screen only. */
export function scopesCommunityFeed({ platform, screen }) {
  return platform === 'ios' && screen === 'community'
}

function coded(code, detail) {
  const error = new Error(`${code}:${detail}`)
  error.code = code
  return error
}

// A post leaving `published` must hold the community privacy guard of its id (migration
// 20261020120000 community_privacy_assert_post); the guard is taken in the same statement, before
// any row changes.
const WITHDRAW = `WITH "guarded" AS (
  SELECT community_privacy_guards(ARRAY[]::text[], array_agg("id"), true)
  FROM "LookbookPost" WHERE "status" = 'published' AND NOT ("id" = ANY($1::text[]))
)
UPDATE "LookbookPost" SET "status" = 'withdrawn'
WHERE "status" = 'published' AND NOT ("id" = ANY($1::text[])) AND EXISTS (SELECT 1 FROM "guarded")
RETURNING "id"`
const PUBLISHED = `SELECT "id" FROM "LookbookPost"
WHERE "status" = 'published' ORDER BY "id"`
/** How many times a failed setup tries to put the withdrawn posts back before it hands over. */
const RESTORE_ATTEMPTS = 3

const RESTORE = `UPDATE "LookbookPost" SET "status" = 'published' WHERE "status" = 'withdrawn' AND "id" = ANY($1::text[])
RETURNING "id"`

/**
 * Scopes the harness feed to LIVE_FONT_COMMUNITY_FEED. `query(url, sql, params)` runs one
 * statement against the harness database and resolves to `{ rowCount, rows }`. Resolves to the
 * posts `kept`, the posts `withdrawn` and `restore()`, which publishes those again (a call after
 * one that succeeded does nothing; one after a failure tries again). Any post the feed names that
 * is not published, or any other post still published, fails as live_font_community_feed_unexpected
 * after the withdrawn posts are put back; a failed check puts them back too. A failed setup tries
 * the restore up to RESTORE_ATTEMPTS times, and when every attempt fails the error carries
 * `restore` and says so.
 */
export async function scopeCommunityFeed({ ownedEnv, query }) {
  const url = harnessDatabaseUrl(ownedEnv)
  const feed = [...LIVE_FONT_COMMUNITY_FEED]
  const run = async (sql, params) => {
    try {
      return await query(url, sql, params)
    } catch (error) {
      throw coded('live_font_community_feed_failed', error?.message ?? String(error))
    }
  }
  const withdrawn = (await run(WITHDRAW, [feed])).rows.map((row) => row.id)
  let restored = false
  const restore = async () => {
    if (restored) return
    if (withdrawn.length) await run(RESTORE, [withdrawn])
    // Done only once the posts are back: a failed restore stays retryable.
    restored = true
  }
  // The caller has no restore() until this resolves, so a failed setup puts the withdrawn posts
  // back itself, up to RESTORE_ATTEMPTS times; a restore that keeps failing rides on the error.
  const failSetup = async (error) => {
    let restoreError
    for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt += 1) {
      try {
        await restore()
        restoreError = undefined
        break
      } catch (caught) {
        restoreError = caught
      }
    }
    if (restoreError) {
      error.message += `; restore failed: ${restoreError.message}`
      error.restore = restore
    }
    throw error
  }
  let published
  try {
    published = (await run(PUBLISHED, [])).rows.map((row) => row.id)
  } catch (error) {
    await failSetup(error)
  }
  const missing = feed.filter((id) => !published.includes(id))
  const extra = published.filter((id) => !feed.includes(id))
  if (missing.length || extra.length) {
    await failSetup(
      coded(
        'live_font_community_feed_unexpected',
        [
          missing.length && `not published: ${missing.join(',')}`,
          extra.length && `still published: ${extra.join(',')}`,
        ]
          .filter(Boolean)
          .join('; ')
      )
    )
  }
  return { kept: feed, withdrawn, restore }
}
