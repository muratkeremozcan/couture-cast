// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-13, F-16, F-17 (Codex R4-03, R4-06, R4-07): the journey's order, coverage, unit choice and
// verdict, with device IO replaced by a scripted fake that renders a healthy screen.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  aggregateVerdict,
  numericScale,
  runScreenJourney,
  SCALES,
  screenRunSteps,
  touchTarget,
} from './live-font-journey.mjs'
import { expectedTextRatio } from './live-font-scale-proof.mjs'

/**
 * A fake device whose screen relayouts correctly at every scale: the 13 sp label's box follows
 * the platform's text scaling, the update adds one line that persists across launches until
 * reverted (as the Settings locale does), and nothing remounts on the live launch. `breakAt` makes one live capture stale or makes a capture throw.
 */
function fakeDevice(platform, { breakAt, throwAt } = {}) {
  const calls = []
  let launches = 0
  let launch = 'launch-0'
  let scale = SCALES[platform].base
  let updated = false
  const height = (at) =>
    Math.round(
      40 *
        expectedTextRatio({
          platform,
          androidApi: 36,
          sizeSp: 13,
          from: 1,
          to: numericScale(platform, at),
        })
    )
  const screen = (stage, at, stale) => {
    const h = stale ? height(SCALES[platform].base) : height(at)
    const nodes = [
      {
        id: 'community-new-post-label',
        text: 'New post',
        bounds: `[0,100][300,${100 + h}]`,
      },
      // A 44 pt icon button centred over a 38 pt row, the same box at every scale.
      {
        id: 'header-info-modal',
        text: 'About',
        bounds: '[358,59][402,103]',
        parent: '[240,62][402,100]',
      },
      ...(updated
        ? [{ id: '', text: 'Every band', bounds: `[0,300][300,${300 + h}]` }]
        : []),
    ]
    return {
      stage,
      launch,
      fontScale: numericScale(platform, at),
      osScale: platform === 'android' ? String(at) : at,
      jsFontScale: numericScale(platform, at),
      pid: launch === 'live' ? '500' : `cold-${launches}`,
      identity:
        platform === 'android'
          ? { root: `root-${launch}`, activity: `act-${launch}`, onCreate: 1 }
          : { root: `root-${launch}` },
      nodes,
      controls: ['tab-home', 'tab-community', 'tab-settings'].map((id, index) => ({
        id,
        bounds: `[${index * 300},2200][${index * 300 + 300},2400]`,
      })),
      window: '[0,0][1080,2400]',
    }
  }
  const step = (name, value) => {
    calls.push(name)
    if (throwAt && throwAt === name) throw new Error('live_font_hierarchy_invalid: fake')
    return value
  }
  return {
    calls,
    io: {
      cold: async (at) => {
        launches += 1
        launch = `cold-${launches}`
        scale = at
        return step(`cold:${at}`, screen('cold', at))
      },
      launch: async () => {
        launch = 'live'
        step('launch')
      },
      setScale: async (at) => {
        scale = at
        step(`setScale:${at}`)
      },
      navigate: async () => step('navigate'),
      capture: async (stage, at) => step(`capture:${stage}:${at}`, screen(stage, at)),
      settle: async (stage, at) =>
        step(`settle:${stage}:${at}`, screen(stage, at, breakAt === `${stage}:${at}`)),
      fullText: async (capture) => capture,
      update: async () => {
        updated = true
        step('update')
      },
      revert: async () => {
        updated = false
        step('revert')
      },
    },
    get scale() {
      return scale
    },
  }
}

const run = (platform, fake, extra = {}) =>
  runScreenJourney({
    io: fake.io,
    platform,
    androidApi: 36,
    name: 'community',
    reactNativeVersion: '0.88.1',
    androidDensity: () => 420,
    ...extra,
  })

describe('runScreenJourney', () => {
  test('iOS walks every category and back on one live launch, cold references apart (F-17)', async () => {
    const fake = fakeDevice('ios')
    const result = await run('ios', fake)
    assert.deepEqual(
      result.legs.map((leg) => [leg.from, leg.to]),
      [
        ['large', 'extra-extra-extra-large'],
        ['extra-extra-extra-large', 'accessibility-medium'],
        ['accessibility-medium', 'large'],
      ]
    )
    const live = fake.calls.slice(fake.calls.indexOf('launch'))
    assert.equal(live.filter((call) => call === 'launch').length, 1)
    assert.ok(
      !live.some((call) => call.startsWith('cold:')),
      'no cold launch inside the live journey'
    )
    assert.deepEqual(
      fake.calls.filter((call) => call.startsWith('cold:')),
      ['cold:large', 'cold:extra-extra-extra-large', 'cold:accessibility-medium']
    )
    // Each cold reference's update is reverted before the next launch, so none inherits it.
    const coldPhase = fake.calls.slice(0, fake.calls.indexOf('launch'))
    for (const [index, call] of coldPhase.entries())
      if (call === 'update')
        assert.equal(coldPhase[index + 2], 'revert', coldPhase.join(' '))
    assert.ok(
      result.controls.every((control) => control.pass),
      JSON.stringify(result.controls)
    )
    assert.ok(
      result.legs.every((leg) => leg.pass),
      JSON.stringify(result.legs.map((l) => l.message))
    )
    assert.deepEqual(aggregateVerdict([result], 'ios'), { pass: true, reasons: [] })
  })

  test('Android goes 1.0 to 1.5 and back on the same launch', async () => {
    const fake = fakeDevice('android')
    const result = await run('android', fake)
    assert.deepEqual(
      result.legs.map((leg) => [leg.from, leg.to]),
      [
        ['1', '1.5'],
        ['1.5', '1'],
      ]
    )
    assert.ok(result.legs.every((leg) => leg.pass))
    assert.equal(aggregateVerdict([result], 'android').pass, true)
  })

  test('a stale leg fails the run (F-13 oracle failure)', async () => {
    const fake = fakeDevice('android', { breakAt: 'settled:1.5' })
    const result = await run('android', fake)
    assert.equal(result.legs[0].pass, false)
    assert.equal(result.legs[0].error, 'live_font_fix_missing')
    const verdict = aggregateVerdict([result], 'android')
    assert.equal(verdict.pass, false)
    assert.match(verdict.reasons.join(' '), /1->1\.5 live_font_fix_missing/)
  })

  test('a capture failure fails the run and reports the missing legs (F-13)', async () => {
    const fake = fakeDevice('android', { throwAt: 'capture:immediate:1.5' })
    const result = await run('android', fake)
    assert.equal(result.error.error, 'live_font_hierarchy_invalid')
    const verdict = aggregateVerdict([result], 'android')
    assert.equal(verdict.pass, false)
    assert.match(verdict.reasons.join(' '), /visited nothing of 1\.5,1/)
  })

  test('no screen is a failed run', () => {
    assert.equal(aggregateVerdict([], 'android').pass, false)
  })
})

describe('touchTarget (F-16)', () => {
  test('iOS uses 44 pt as captured and never asks for an Android density', () => {
    let asked = 0
    assert.equal(
      touchTarget('ios', () => {
        asked += 1
        return 420
      }),
      44
    )
    assert.equal(asked, 0)
  })

  test('Android converts 48 dp to pixels at the device density', () => {
    assert.equal(
      touchTarget('android', () => 420),
      126
    )
    assert.throws(() => touchTarget('android', () => undefined), {
      message: 'live_font_density_required',
    })
  })
})

describe('screenRunSteps', () => {
  test('a config-change run reads the installed React Native version first (review P2-2b)', () => {
    assert.deepEqual(screenRunSteps({ configChange: 'locale', versionKnown: false }), [
      'read-version',
      'config-change',
    ])
    assert.deepEqual(screenRunSteps({ configChange: 'locale', versionKnown: true }), [
      'config-change',
    ])
  })

  test('a journey run reads it once, before the first journey', () => {
    assert.deepEqual(screenRunSteps({ versionKnown: false }), ['read-version', 'journey'])
    assert.deepEqual(screenRunSteps({ versionKnown: true }), ['journey'])
  })
})
