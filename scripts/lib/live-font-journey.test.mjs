// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-13, F-16, F-17 (Codex R4-03, R4-06, R4-07): the journey's order, coverage, unit choice and
// verdict, with device IO replaced by a scripted fake that renders a healthy screen.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  aggregateVerdict,
  proofDirInRepo,
  proposedBaselines,
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
function fakeDevice(
  platform,
  { breakAt, throwAt, dropMountAt, remountOnRevert, noScreenMount, staleColdAt } = {}
) {
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
  // The community screen's mount id; remountOnRevert gives it a new one at the first revert.
  let screenMount = 's1'
  const mounts = (stage, at) => {
    const tag = launch.replace(/[^a-z0-9]/g, '')
    const root = `live-font-mount-root-${tag}`
    return noScreenMount || dropMountAt === `${stage}:${at}`
      ? root
      : `live-font-mount-community-${screenMount}${tag},${root}`
  }
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
          ? { root: mounts(stage, at), activity: `act-${launch}`, onCreate: 1 }
          : { root: mounts(stage, at) },
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
        return step(`cold:${at}`, screen('cold', at, staleColdAt === String(at)))
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
        if (remountOnRevert && launch === 'live') screenMount = 's2'
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
    timezone: 'America/Chicago',
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

  // Antigravity handover R1 (P2-1): the screen's own marker is required in every capture, and
  // its id is compared across the legs of one launch.
  test('a capture without the screen marker fails its leg', async () => {
    const fake = fakeDevice('android', { dropMountAt: 'immediate:1.5' })
    const result = await run('android', fake)
    assert.equal(result.legs[0].pass, false)
    assert.equal(result.legs[0].checks.identity.rootKnown, false)
    assert.equal(result.legs[1].pass, true)
    assert.equal(aggregateVerdict([result], 'android').pass, false)
  })

  test('a screen that never shows its own marker fails every leg', async () => {
    const result = await run('ios', fakeDevice('ios', { noScreenMount: true }))
    assert.ok(result.legs.length > 0)
    for (const leg of result.legs) {
      assert.equal(leg.pass, false)
      assert.equal(leg.checks.identity.rootKnown, false)
    }
  })

  test('a screen remounted by the revert between legs fails the later leg', async () => {
    const fake = fakeDevice('ios', { remountOnRevert: true })
    const result = await run('ios', fake)
    assert.equal(result.legs[0].pass, true)
    assert.equal(result.legs[1].pass, false)
    assert.equal(result.legs[1].checks.identity.rootKept, false)
    assert.equal(aggregateVerdict([result], 'ios').pass, false)
  })

  // TEA, 2026-11-13: an unapproved known residual writes the entry a reviewer would approve.
  test('an unapproved known-residual leg proposes its exact baseline entry', async () => {
    const fake = fakeDevice('android', { breakAt: 'settled:1.5' })
    const result = await run('android', fake, {
      reactNativeVersion: '0.81.5',
      label: 'sdk54-release',
    })
    const [leg, back] = result.legs
    assert.equal(leg.error, 'live_font_residual_unapproved')
    assert.equal(leg.verdict, 'known-residual')
    assert.deepEqual(leg.residualProposal, {
      platform: 'android',
      build: 'sdk54-release',
      screen: 'community',
      from: '1',
      to: '1.5',
      timezone: 'America/Chicago',
      staleKeys: ['["community-new-post-label","New post"]#0'],
      review: {
        verdict: 'known-residual',
        structuralPass: true,
        everyMissStale: true,
        growthFailing: ['community-new-post-label'],
        controlPass: true,
      },
    })
    assert.equal(back.residualProposal, undefined)
    const current = { about: 'reviewed', entries: [{ screen: 'home' }] }
    const proposed = proposedBaselines(current, [result])
    assert.equal(proposed.about, 'reviewed')
    assert.deepEqual(proposed.entries[0], { screen: 'home' })
    assert.deepEqual(proposed.entries[1], {
      ...leg.residualProposal,
      evidence: leg.evidence,
    })
    assert.equal(
      proposedBaselines(current, [await run('android', fakeDevice('android'))]),
      null
    )
    // Given the proof dir, each entry names where its captures live.
    const dir = '_bmad-output/test-artifacts/story-6-15/runs/r/proof'
    assert.deepEqual(proposedBaselines(current, [result], { dir }).entries[1].evidence, {
      dir,
      ...leg.evidence,
    })
    // Every screen errored before a leg (device run 2026-11-13): no proposal, no crash.
    assert.equal(
      proposedBaselines(current, [{ screen: 'home', error: 'maestro_failed' }]),
      null
    )
    assert.deepEqual(
      proposedBaselines(current, [{ screen: 'home', error: 'maestro_failed' }, result])
        .entries,
      [{ screen: 'home' }, { ...leg.residualProposal, evidence: leg.evidence }]
    )
    // The proposal, committed as the baseline, approves exactly that leg.
    const approved = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5' }),
      {
        reactNativeVersion: '0.81.5',
        label: 'sdk54-release',
        residualBaselines: [leg.residualProposal],
      }
    )
    assert.equal(approved.legs[0].pass, true)
  })

  // TEA, 2026-11-13: an entry approved in one timezone approves nothing in another, and the leg
  // proposes the entry for the run's own timezone.
  test('an entry from another timezone fails the leg and proposes one for this run', async () => {
    const breaking = () => fakeDevice('android', { breakAt: 'settled:1.5' })
    const options = { reactNativeVersion: '0.81.5', label: 'sdk54-release' }
    const entry = (await run('android', breaking(), options)).legs[0].residualProposal
    const result = await run('android', breaking(), {
      ...options,
      residualBaselines: [entry],
      timezone: 'Europe/Istanbul',
    })
    const [leg] = result.legs
    assert.equal(leg.pass, false)
    assert.equal(leg.error, 'live_font_residual_environment_differs')
    assert.match(
      leg.message,
      /baseline timezone America\/Chicago, run timezone Europe\/Istanbul/
    )
    assert.deepEqual(leg.residualProposal, { ...entry, timezone: 'Europe/Istanbul' })
    assert.equal(aggregateVerdict([result], 'android').pass, false)
  })

  // TEA, 2026-11-13: a control that fails on this run fails it, whatever an approved entry's
  // stored controlPass says.
  test('a live control failure fails the run even with an approved residual entry', async () => {
    const first = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5' }),
      {
        reactNativeVersion: '0.81.5',
        label: 'sdk54-release',
      }
    )
    const entry = first.legs[0].residualProposal
    assert.equal(entry.review.controlPass, true)
    const result = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5', staleColdAt: '1.5' }),
      { reactNativeVersion: '0.81.5', label: 'sdk54-release', residualBaselines: [entry] }
    )
    assert.ok(result.controls.some((control) => !control.pass))
    const verdict = aggregateVerdict([result], 'android')
    assert.equal(verdict.pass, false)
    assert.match(verdict.reasons.join(' '), /control/)
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

// Antigravity r28 (P3, mutant M6): a proposed entry names its proof dir only when the dir sits
// inside the repository, judged on real paths.
describe('proofDirInRepo', () => {
  const tree = (t) => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-dir-')))
    t.after(() => fs.rmSync(base, { recursive: true, force: true }))
    const repo = path.join(base, 'repo')
    const outside = path.join(base, 'outside')
    fs.mkdirSync(path.join(repo, '_bmad-output', 'runs', 'proof'), { recursive: true })
    fs.mkdirSync(path.join(repo, '..cache', 'proof'), { recursive: true })
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(repo, 'linked-out'))
    return { repo, outside }
  }

  test('a dir inside the repository, a ..cache dir among them, names its relative path', (t) => {
    const { repo } = tree(t)
    assert.equal(
      proofDirInRepo(repo, path.join(repo, '_bmad-output', 'runs', 'proof')),
      path.join('_bmad-output', 'runs', 'proof')
    )
    assert.equal(
      proofDirInRepo(repo, path.join(repo, '..cache', 'proof')),
      path.join('..cache', 'proof')
    )
    assert.equal(proofDirInRepo(repo, path.join(repo, '..cache')), '..cache')
  })

  test('a dir outside, a link out of the repository and the repository itself name none', (t) => {
    const { repo, outside } = tree(t)
    assert.equal(proofDirInRepo(repo, outside), undefined)
    assert.equal(proofDirInRepo(repo, path.join(repo, 'linked-out')), undefined)
    assert.equal(proofDirInRepo(repo, repo), undefined)
    assert.equal(proofDirInRepo(repo, path.dirname(repo)), undefined)
  })

  test('a repository reached through a link still sees its own dirs', (t) => {
    const { repo } = tree(t)
    const alias = path.join(path.dirname(repo), 'alias')
    fs.symlinkSync(repo, alias)
    assert.equal(
      proofDirInRepo(alias, path.join(repo, '_bmad-output', 'runs', 'proof')),
      path.join('_bmad-output', 'runs', 'proof')
    )
  })
})
