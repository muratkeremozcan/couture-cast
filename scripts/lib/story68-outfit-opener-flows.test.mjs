import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const dir = fileURLToPath(new URL('../../maestro/story68/', import.meta.url))
const read = (name) => fs.readFileSync(`${dir}${name}`, 'utf8')
// Runs 26 and 27: the Home ScrollView has a sticky chip bar over its content, and the iOS scroll
// (centerElement true) left the opener under it, so the tap hit a chip. On iOS the opener is never
// centred: the flows go back to scroll offset 0 and only scroll when it is below the fold.
const POSITIONING = [
  'open-outfit.yaml',
  'preparing-cancel.yaml',
  'expo-go-unavailable.yaml',
  'rapid-ready-outfit.yaml',
]
// The held flow taps the opener where rapid-ready-outfit.yaml left it and may not contain a
// runFlow: its tests pin its exact command list.
const POSITIONED_BY_PREVIOUS_FLOW = ['rapid-watermark-held.yaml']

test('every iOS flow that opens the outfit card positions the opener without centring it', () => {
  for (const name of POSITIONING) {
    const flow = read(name)
    const [ios, android] = flow.split(/when:\s+platform: Android/)
    assert.match(
      ios,
      /when:\s+platform: iOS\s+file: position-outfit-open\.yaml/,
      `${name} positions on iOS`
    )
    assert.doesNotMatch(ios, /centerElement: true/, `${name}: iOS never centres`)
    assert.doesNotMatch(
      flow,
      /header-info-modal/,
      `${name}: the header is not the reference`
    )
    assert.match(
      android,
      /scrollUntilVisible:[\s\S]*centerElement: true/,
      `${name}: Android keeps its scroll`
    )
  }
})

test('the positioning subflow returns to offset 0 and only scrolls when the opener is below the fold', () => {
  const subflow = read('position-outfit-open.yaml')
  assert.match(
    subflow,
    /repeat:\s+times: 3\s+commands:\s+- swipe:\s+start: 50%, 30%\s+end: 50%, 85%/,
    'three swipes down reach the top'
  )
  assert.match(
    subflow,
    /when:\s+notVisible:\s+id: outfit-share-card-open\s+above:\s+id: tab-home/,
    'the scroll runs only when the opener is not above the tab bar at offset 0'
  )
  assert.match(subflow, /centerElement: false/)
  assert.doesNotMatch(subflow, /centerElement: true/)
  assert.match(subflow, /start: 50%, 60%\s+end: 50%, 48%/, 'a 105 pt lift')
  assert.match(
    subflow,
    /assertVisible:\s+id: outfit-share-card-open\s+above:\s+id: tab-home\s+label: outfit_opener_clear_of_tab_bar/
  )
})

test('no story68 flow centres the outfit opener on iOS or taps it past a header reference', () => {
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml'))) {
    if (name === 'release-open-outfit.yaml') continue // Android Release only
    const flow = read(name)
    assert.doesNotMatch(flow, /header-info-modal/, name)
    if (POSITIONED_BY_PREVIOUS_FLOW.includes(name)) continue
    if (!/outfit-share-card-open/.test(flow) || name === 'position-outfit-open.yaml')
      continue
    assert.match(flow, /file: position-outfit-open\.yaml/, `${name} positions the opener`)
  }
})
