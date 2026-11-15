import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  LIVE_FONT_ARTIFACT_PREFIX,
  LIVE_FONT_REPORT,
  LIVE_FONT_SCREENS,
  legVerdict,
  mergeLiveFontLegs,
} from './ios-live-font-legs.mjs'

const report = (screen, overrides = {}) =>
  JSON.stringify({
    platform: 'ios',
    wallSeconds: 4200,
    verdict: { pass: true, reasons: [] },
    results: [{ screen }],
    ...overrides,
  })

/** download-artifact's layout: one folder per artifact, named after it. */
function downloaded(t, reports) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-live-font-legs-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const [screen, text] of Object.entries(reports)) {
    const leg = path.join(directory, `${LIVE_FONT_ARTIFACT_PREFIX}${screen}`)
    fs.mkdirSync(leg)
    if (text !== undefined) fs.writeFileSync(path.join(leg, LIVE_FONT_REPORT), text)
  }
  return directory
}

test('one leg per screen, in the order the proof always ran them', () => {
  assert.deepEqual(LIVE_FONT_SCREENS, ['home', 'community', 'settings', 'composer'])
})

test('every screen passing on its own leg passes the merge', (t) => {
  const directory = downloaded(
    t,
    Object.fromEntries(LIVE_FONT_SCREENS.map((screen) => [screen, report(screen)]))
  )
  const merged = mergeLiveFontLegs(directory)
  assert.equal(merged.pass, true)
  assert.deepEqual(
    merged.legs.map(({ screen, pass, wallSeconds }) => ({ screen, pass, wallSeconds })),
    LIVE_FONT_SCREENS.map((screen) => ({ screen, pass: true, wallSeconds: 4200 }))
  )
})

test('a missing leg, a leg without its report or a failed leg fails the merge, naming it', (t) => {
  const directory = downloaded(t, {
    home: report('home'),
    community: undefined,
    settings: report('settings', {
      verdict: {
        pass: false,
        reasons: ['settings: large->accessibility-medium clipped'],
      },
    }),
  })
  const merged = mergeLiveFontLegs(directory)
  assert.equal(merged.pass, false)
  assert.deepEqual(
    merged.legs.map(({ screen, pass, reasons }) => [screen, pass, reasons]),
    [
      ['home', true, []],
      ['community', false, ['no live font report']],
      ['settings', false, ['settings: large->accessibility-medium clipped']],
      ['composer', false, ['no live font report']],
    ]
  )
})

test('a leg that ran another screen, more than one, or another platform proves nothing', () => {
  assert.deepEqual(legVerdict('home', report('composer')).reasons, ['screens composer'])
  assert.deepEqual(
    legVerdict(
      'home',
      report('home', { results: [{ screen: 'home' }, { screen: 'settings' }] })
    ).reasons,
    ['screens home,settings']
  )
  assert.deepEqual(legVerdict('home', report('home', { platform: 'android' })).reasons, [
    'platform android',
  ])
  assert.deepEqual(legVerdict('home', report('home', { results: [] })).reasons, [
    'screens none',
  ])
  assert.deepEqual(legVerdict('home', '{').reasons, ['report is no JSON'])
  assert.deepEqual(legVerdict('home', report('home', { verdict: undefined })).reasons, [
    'no passing verdict',
  ])
})

test('the merge command exits nonzero and names each failed leg', (t) => {
  const directory = downloaded(t, { home: report('home') })
  const result = spawnSync(
    process.execPath,
    ['scripts/ci/ios-live-font-legs.mjs', 'merge', directory],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /::error::live font community: no live font report/)
  assert.match(result.stdout, /"iosLiveFontLegs"/)
  const usage = spawnSync(process.execPath, ['scripts/ci/ios-live-font-legs.mjs'], {
    encoding: 'utf8',
  })
  assert.equal(usage.status, 2)
})
