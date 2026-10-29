import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const dir = fileURLToPath(new URL('../../maestro/story68/', import.meta.url))
const read = (name) => fs.readFileSync(`${dir}${name}`, 'utf8')
const BELOW =
  /id: outfit-share-card-open\n(\s+)below:\n\s+id: header-info-modal\n\s+index: 0/
// Run 26: the scroll left the opener under the Home header, a tap hit the status bar, and the
// share-card dialog never opened. Every iOS tap on the opener now requires it below the header.
const TAPPING = ['open-outfit.yaml', 'preparing-cancel.yaml', 'expo-go-unavailable.yaml']
// The held flow taps the opener where rapid-ready-outfit.yaml left it (below the header, asserted
// there) and may not contain a runFlow: its tests pin its exact command list.
const POSITIONED_BY_PREVIOUS_FLOW = ['rapid-watermark-held.yaml']

test('every iOS tap on the outfit opener requires the opener below the Home header', () => {
  for (const name of TAPPING) {
    const flow = read(name)
    const [ios, android] = flow.split(/platform: Android/)
    assert.match(
      ios,
      /platform: iOS[\s\S]*tapOn:[\s\S]*below:\s+id: header-info-modal/,
      name
    )
    assert.match(ios, BELOW, name)
    assert.doesNotMatch(android, /below:/, `${name}: Android keeps its plain tap`)
    assert.match(android, /tapOn:\s+id: outfit-share-card-open\n\s+index: 0/, name)
  }
})

test('the positioning subflow swipes the content down at most three times until the opener is below the header', () => {
  const subflow = read('position-outfit-open.yaml')
  assert.match(
    subflow,
    /while:\s+notVisible:\s+id: outfit-share-card-open\s+below:\s+id: header-info-modal/
  )
  assert.match(subflow, /times: 3/)
  assert.match(subflow, /start: 50%, 30%\s+end: 50%, 55%/)
  assert.match(
    subflow,
    /assertVisible:[\s\S]*below:[\s\S]*label: outfit_opener_under_header/
  )
  for (const name of [
    'open-outfit.yaml',
    'preparing-cancel.yaml',
    'expo-go-unavailable.yaml',
    'rapid-ready-outfit.yaml',
  ])
    assert.match(read(name), /runFlow: position-outfit-open\.yaml/, name)
})

test('no story68 flow taps the opener without the Android or below-header guard', () => {
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml'))) {
    if (name === 'release-open-outfit.yaml') continue // Android Release only
    if (POSITIONED_BY_PREVIOUS_FLOW.includes(name)) continue
    const flow = read(name)
    const taps = [...flow.matchAll(/tapOn:\s+id: outfit-share-card-open\n(\s+)(\S+)/g)]
    for (const tap of taps)
      assert.ok(['below:', 'index:'].includes(tap[2]), `${name}: ${tap[2]}`)
    if (taps.length) assert.match(flow, /header-info-modal/, `${name} guards its iOS tap`)
  }
})

test(
  'Maestro accepts the changed flows',
  { skip: spawnSync('maestro', ['--version']).status !== 0 },
  () => {
    for (const name of [
      'position-outfit-open.yaml',
      ...TAPPING,
      'rapid-ready-outfit.yaml',
    ]) {
      const result = spawnSync('maestro', ['check-syntax', `${dir}${name}`], {
        encoding: 'utf8',
        env: {
          JAVA_HOME: '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
          ...process.env,
          MAESTRO_APP_ID: 'app',
        },
      })
      assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`)
    }
  }
)
