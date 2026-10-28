import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const flow = fs.readFileSync(
  fileURLToPath(new URL('../../maestro/story68/open-post.yaml', import.meta.url)),
  'utf8'
)
// One iOS feed swipe, its animation wait and the visibility check cost up to this long.
const ITERATION_MS = 6000
// The Maestro process budget is 120 s; the walk may use at most this share of it.
const WALK_BUDGET_MS = 80_000

test('the feed walk is bounded well inside the Maestro process budget', () => {
  const iterations = [...flow.matchAll(/^\s*times:\s*(\d+)\s*$/gm)].reduce(
    (total, match) => total + Number(match[1]),
    0
  )
  assert.ok(iterations > 0)
  assert.ok(iterations * ITERATION_MS <= WALK_BUDGET_MS, `${iterations} iterations`)
})

test('every way the post can be missing fails with its own named reason', () => {
  for (const reason of [
    'community_screen_absent',
    'feed_skeleton_still_showing',
    'feed_error_state',
    'feed_unavailable_state',
    'post_not_within_8_swipes',
    'share_card_preview_not_loaded',
  ])
    assert.match(flow, new RegExp(`label: '${reason}'`), reason)
})

test('the walk waits for the feed to finish loading before it swipes', () => {
  const skeleton = flow.indexOf('id: community-feed-skeleton')
  const firstSwipe = flow.indexOf('- swipe:')
  assert.ok(skeleton > 0 && skeleton < firstSwipe)
})

test('the card is found on the feed surface, not through the highlighted deep-link copy', () => {
  assert.doesNotMatch(flow, /highlighted-community-card|openLink|source=notification/)
  assert.match(flow, /community-card-author-\$\{MAESTRO_POST_ID\}/)
})

test('the swipe count in the failure label matches the declared bound', () => {
  const first = /times:\s*(\d+)/.exec(flow)[1]
  assert.match(flow, new RegExp(`post_not_within_${first}_swipes`))
})
