import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const flow = fs.readFileSync(
  fileURLToPath(new URL('../../maestro/story68/open-post.yaml', import.meta.url)),
  'utf8'
)
const AUTHOR = 'community-card-author-${MAESTRO_POST_ID}'
const repeats = [...flow.matchAll(/- repeat:[\s\S]*?times:\s*(\d+)/g)].map((m) => ({
  at: m.index,
  times: Number(m[1]),
  target: /id:\s*(\S+)/.exec(m[0])?.[1],
}))

test('every way the post can be missing fails with its own named reason', () => {
  for (const reason of [
    'community_screen_absent',
    'feed_skeleton_still_showing',
    'feed_error_state',
    'feed_unavailable_state',
    'share_card_preview_not_loaded',
  ])
    assert.match(flow, new RegExp(`label: '${reason}'`), reason)
})

test('the walk restores the list position upward, then walks down, both bounded and both named', () => {
  const [up, down, opener] = repeats
  assert.equal(repeats.length, 3)
  assert.equal(up.target, AUTHOR)
  assert.equal(down.target, AUTHOR)
  assert.ok(up.at < down.at && down.at < opener.at)
  // The upward drag moves toward the top: it ends lower on the screen than it starts.
  const upDrag = /start: 50%, (\d+)%\n\s*end: 50%, (\d+)%/.exec(
    flow.slice(up.at, down.at)
  )
  assert.ok(Number(upDrag[1]) < Number(upDrag[2]))
  const downDrag = /start: 50%, (\d+)%\n\s*end: 50%, (\d+)%/.exec(flow.slice(down.at))
  assert.ok(Number(downDrag[1]) > Number(downDrag[2]))
  assert.match(
    flow,
    new RegExp(`label: 'post_not_within_${up.times}_up_${down.times}_down_swipes'`)
  )
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

test('the opener tap is guarded: lift, tap and wait for the composer title, retried on a lost press', () => {
  const guard =
    /- retry:\n\s+maxRetries: 2\n\s+commands:\n([\s\S]*?)\n- extendedWaitUntil:\n\s+visible:\n\s+id: share-card-preview-loaded/.exec(
      flow
    )
  assert.ok(guard, 'retry sits right before the preview wait')
  const body = guard[1]
  // A press that lands late has opened the composer: neither the lift nor the tap may run then.
  const guarded =
    /- runFlow:\n\s+when:\n\s+notVisible:\n\s+id: share-card-title\n\s+commands:\n([\s\S]*)\n\s+- extendedWaitUntil:/.exec(
      body
    )
  assert.ok(guarded, 'lift and tap sit inside the composer-title-absent guard')
  assert.match(guarded[1], /- swipe:/)
  assert.match(guarded[1], /- tapOn:/)
  assert.ok(body.indexOf('- swipe:') < body.indexOf('- tapOn:'))
  assert.ok(body.indexOf('- tapOn:') < body.lastIndexOf('id: share-card-title'))
  assert.match(body, /platform: iOS/)
  assert.match(body, /label: 'share_card_press_not_received'/)
  // The only tapOn of the opener sits inside the retry.
  const taps = [...flow.matchAll(/- tapOn:\n\s+id: community-share-card-open/g)]
  assert.equal(taps.length, 1)
  assert.ok(flow.indexOf('- retry:') < taps[0].index)
})
