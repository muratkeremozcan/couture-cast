// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
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

const OPENER = 'community-share-card-open-${MAESTRO_POST_ID}'
const guardHead =
  /^\s+- runFlow:\n\s+when:\n\s+notVisible:\n\s+id: share-card-title\n\s+commands:\n/

/** The retry body of the opener attempt: its top-level commands, in order. */
function attemptCommands(text) {
  const retry =
    /- retry:\n\s+maxRetries: 2\n\s+commands:\n([\s\S]*?)\n- extendedWaitUntil:\n\s+visible:\n\s+id: share-card-preview-loaded/.exec(
      text
    )
  return retry ? retry[1].split(/\n(?= {6}- )/) : null
}

/** Everything wrong with the attempt: the lift and the tap are only reachable while the title is absent. */
function openerAttemptProblems(text) {
  const items = attemptCommands(text)
  if (!items || items.length !== 2) return ['retry holds a guard and the strict wait']
  const [guard, wait] = items
  const problems = []
  if (!guardHead.test(guard)) problems.push('attempt not guarded on the title')
  const inner = guard.replace(guardHead, '').split(/\n(?= {12}- )/)
  if (inner.length !== 2) problems.push('guard holds the lift and the guarded tap')
  const [lift = '', tap = ''] = inner
  if (!/platform: iOS/.test(lift) || !/- swipe:/.test(lift) || /- tapOn:/.test(lift))
    problems.push('the lift is an iOS-only swipe without a tap')
  if (
    !guardHead.test(tap) ||
    tap.replace(guardHead, '').trim() !== `- tapOn:\n                      id: ${OPENER}`
  )
    problems.push('the opener tap is alone inside its own title guard')
  if (/- swipe:|- tapOn:/.test(wait)) problems.push('nothing acts after the guard')
  if (
    !/^\s+- extendedWaitUntil:\n\s+visible:\n\s+id: share-card-title\n\s+timeout: 5000\n\s+label: 'share_card_press_not_received'$/.test(
      wait
    )
  )
    problems.push('the strict wait names share_card_press_not_received')
  return problems
}

test('the opener tap is guarded twice: attempt and tap, then a strict wait for the composer title', () => {
  assert.deepEqual(openerAttemptProblems(flow), [])
  // The only tapOn of the opener sits inside the retry.
  const taps = [...flow.matchAll(/- tapOn:\n\s+id: community-share-card-open/g)]
  assert.equal(taps.length, 1)
  assert.ok(flow.indexOf('- retry:') < taps[0].index)
})

test('the opener attempt check rejects a swipe or tap that sits outside its guards', () => {
  const guarded = attemptCommands(flow)[0]
  const tapBlock = guarded.slice(guarded.lastIndexOf('            - runFlow:'))
  const mutations = {
    'a tap after the outer guard': flow.replace(
      '      - extendedWaitUntil:\n          visible:\n            id: share-card-title',
      `      - tapOn:\n          id: ${OPENER}\n      - extendedWaitUntil:\n          visible:\n            id: share-card-title`
    ),
    'a swipe after the outer guard': flow.replace(
      '      - extendedWaitUntil:\n          visible:\n            id: share-card-title',
      '      - swipe:\n          start: 50%, 70%\n          end: 50%, 55%\n      - extendedWaitUntil:\n          visible:\n            id: share-card-title'
    ),
    'a tap outside the inner guard': flow.replace(
      tapBlock,
      `            - tapOn:\n                id: ${OPENER}\n`
    ),
    'no outer guard': flow.replace(
      / {6}- runFlow:\n\s+when:\n\s+notVisible:\n\s+id: share-card-title\n\s+commands:\n/,
      '      - runFlow:\n          when:\n            platform: iOS\n          commands:\n'
    ),
    'a weaker wait': flow.replace("label: 'share_card_press_not_received'", ''),
  }
  for (const [name, mutated] of Object.entries(mutations)) {
    assert.notEqual(mutated, flow, `${name} must change the flow`)
    assert.notDeepEqual(openerAttemptProblems(mutated), [], name)
  }
})
