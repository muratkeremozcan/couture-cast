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
  probeRecord,
  rectOf,
  withTextProbe,
} from './fixtures/live-font-text-probe-records.mjs'
import {
  aggregateVerdict,
  proofDirInRepo,
  proposedBaselines,
  numericScale,
  residualBaselineFor,
  runScreenJourney,
  SCALES,
  screenRunSteps,
  touchTarget,
} from './live-font-journey.mjs'
import {
  expectedTextRatio,
  WEATHER_BANNER_MARKER,
  WEATHER_STALE_TEXT,
} from './live-font-scale-proof.mjs'

/**
 * A fake device whose screen relayouts correctly at every scale: the 13 sp label's box follows
 * the platform's text scaling, the update adds one line that persists across launches until
 * reverted (as the Settings locale does), and nothing remounts on the live launch. `breakAt` makes one live capture stale or makes a capture throw.
 * `banner` shows the out-of-date forecast notice; `hourStart` adds a ribbon of three hour labels
 * from that hour, which go stale with the rest of the text.
 */
function fakeDevice(
  platform,
  {
    breakAt,
    throwAt,
    dropMountAt,
    remountOnRevert,
    noScreenMount,
    staleColdAt,
    banner,
    hourStart,
    probe,
    staleScale,
  } = {}
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
    const h = stale ? height(staleScale ?? SCALES[platform].base) : height(at)
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
      ...(banner
        ? [{ id: '', text: WEATHER_STALE_TEXT, bounds: '[0,500][1000,560]' }]
        : []),
      ...(hourStart
        ? [0, 1, 2].map((index) => ({
            id: '',
            text: `${hourStart + index}\u202fAM`,
            bounds: `[${index * 100},700][${index * 100 + 80},${700 + h}]`,
          }))
        : []),
    ]
    const capture = {
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
      controls: [
        ...['tab-home', 'tab-community', 'tab-settings'].map((id, index) => ({
          id,
          bounds: `[${index * 300},2200][${index * 300 + 300},2400]`,
        })),
        ...(banner ? [{ id: WEATHER_BANNER_MARKER, bounds: '[0,480][1080,580]' }] : []),
      ],
      window: '[0,0][1080,2400]',
    }
    // F-00i: the probe answer a healthy screen gives, then any record `probe` changes.
    const probed = withTextProbe(capture, platform)
    return probe ? probe({ stage, at, stale, capture: probed, updated }) : probed
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
        step(
          `settle:${stage}:${at}`,
          screen(stage, at, [breakAt].flat().includes(`${stage}:${at}`))
        ),
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
    weatherBanner: 'none',
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
      weatherBanner: 'none',
      staleKeys: ['cold:["community-new-post-label","New post"]#0'],
      // TD-05 as amended 2026-11-14: a run with no layout clip proposes none, and says so.
      clippedKeys: [],
      review: {
        verdict: 'known-residual',
        structuralPass: true,
        everyMissStale: true,
        growthFailing: ['community-new-post-label'],
        clipsStale: true,
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

  // Antigravity r30 item 2: the entry for a leg is chosen by its timezone too, so of two entries
  // that differ only by timezone each run uses its own.
  test('of two entries that differ only by timezone, each run uses its own', async () => {
    const breaking = () => fakeDevice('android', { breakAt: 'settled:1.5' })
    const options = { reactNativeVersion: '0.81.5', label: 'sdk54-release' }
    const chicago = (await run('android', breaking(), options)).legs[0].residualProposal
    // The Istanbul entry lists a key this run never misses, so only the Chicago entry approves.
    const istanbul = {
      ...chicago,
      timezone: 'Europe/Istanbul',
      staleKeys: [...chicago.staleKeys, 'cold:["","Elsewhere"]#0'],
    }
    for (const entries of [
      [chicago, istanbul],
      [istanbul, chicago],
    ]) {
      const here = await run('android', breaking(), {
        ...options,
        residualBaselines: entries,
      })
      assert.equal(here.legs[0].pass, true, here.legs[0].message)
      const there = await run('android', breaking(), {
        ...options,
        residualBaselines: entries,
        timezone: 'Europe/Istanbul',
      })
      assert.equal(there.legs[0].error, 'live_font_residual_unapproved')
      assert.match(
        there.legs[0].message,
        /baseline key no miss hit: cold:\["","Elsewhere"\]#0/
      )
    }
    // A timezone with no entry still reports the environment and proposes its own entry.
    const utc = await run('android', breaking(), {
      ...options,
      residualBaselines: [chicago, istanbul],
      timezone: 'UTC',
    })
    assert.equal(utc.legs[0].error, 'live_font_residual_environment_differs')
    assert.match(
      utc.legs[0].message,
      /baseline timezone America\/Chicago, run timezone UTC/
    )
    assert.deepEqual(utc.legs[0].residualProposal, { ...chicago, timezone: 'UTC' })
  })

  // TEA ruling on Antigravity r30 item 1: the banner state is part of an entry's environment.
  test('an entry approved with the out-of-date banner fails a run whose screen shows none', async () => {
    const options = {
      reactNativeVersion: '0.81.5',
      label: 'sdk54-release',
      weatherBanner: 'out-of-date',
    }
    const shown = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5', banner: true }),
      options
    )
    const entry = shown.legs[0].residualProposal
    assert.equal(entry.weatherBanner, 'out-of-date')
    const approved = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5', banner: true }),
      { ...options, residualBaselines: [entry] }
    )
    assert.equal(approved.legs[0].pass, true, approved.legs[0].message)
    const hidden = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5' }),
      {
        ...options,
        residualBaselines: [entry],
      }
    )
    assert.equal(hidden.legs[0].error, 'live_font_residual_environment_differs')
    assert.match(
      hidden.legs[0].message,
      /baseline weather banner out-of-date, before capture shows none/
    )
  })

  // TEA ruling on Antigravity r30 item 1: stale hour labels are keyed by place, so an entry
  // approved at one hour approves the same residual an hour later.
  test('stale hour labels approve an hour later and still count as stale keys', async () => {
    const options = { reactNativeVersion: '0.81.5', label: 'sdk54-release' }
    const first = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5', hourStart: 1 }),
      options
    )
    const entry = first.legs[0].residualProposal
    assert.deepEqual(entry.staleKeys, [
      'cold:["","<hour>"]#0',
      'cold:["","<hour>"]#1',
      'cold:["","<hour>"]#2',
      'cold:["community-new-post-label","New post"]#0',
    ])
    const later = await run(
      'android',
      fakeDevice('android', { breakAt: 'settled:1.5', hourStart: 2 }),
      { ...options, residualBaselines: [entry] }
    )
    assert.equal(later.legs[0].pass, true, later.legs[0].message)
    // The full labels stay in the parity check itself.
    assert.deepEqual(
      later.legs[0].checks.coldParity.misses.map((miss) => miss.key).sort(),
      [
        '["","2\u202fAM"]#0',
        '["","3\u202fAM"]#0',
        '["","4\u202fAM"]#0',
        '["community-new-post-label","New post"]#0',
      ]
    )
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

describe('residualBaselineFor', () => {
  const leg = {
    platform: 'android',
    build: 'sdk54-release',
    screen: 'home',
    from: '1',
    to: '1.5',
    timezone: 'America/Chicago',
    weatherBanner: 'out-of-date',
  }
  test('picks the entry for the leg, its timezone and its banner', () => {
    const chicago = { ...leg, from: 1, to: 1.5, id: 'chicago' }
    const istanbul = { ...leg, timezone: 'Europe/Istanbul', id: 'istanbul' }
    assert.equal(residualBaselineFor([istanbul, chicago], leg).id, 'chicago')
    assert.equal(
      residualBaselineFor([chicago, istanbul], { ...leg, timezone: 'Europe/Istanbul' })
        .id,
      'istanbul'
    )
    // No entry for the run's timezone: one for the same leg, so the environment is reported.
    assert.equal(
      residualBaselineFor([chicago], { ...leg, timezone: 'UTC' }).id,
      'chicago'
    )
    const quiet = { ...leg, weatherBanner: 'none', id: 'quiet' }
    assert.equal(residualBaselineFor([quiet, chicago], leg).id, 'chicago')
    assert.equal(
      residualBaselineFor([chicago, quiet], { ...leg, weatherBanner: 'none' }).id,
      'quiet'
    )
    // The timezone outranks the banner when neither entry matches both.
    assert.equal(
      residualBaselineFor([istanbul, quiet], { ...leg, weatherBanner: 'other' }).id,
      'quiet'
    )
    for (const other of [
      { platform: 'ios' },
      { build: 'sdk54-debug' },
      { screen: 'settings' },
      { from: '1.5' },
      { to: '1' },
    ])
      assert.equal(residualBaselineFor([chicago], { ...leg, ...other }), undefined)
  })

  test('proposedBaselines replaces the entry with the same identity and keeps the others', () => {
    const proposal = { ...leg, staleKeys: ['cold:["","Home"]#0'] }
    const old = { ...leg, staleKeys: ['cold:["","Away"]#0'] }
    const istanbul = { ...old, timezone: 'Europe/Istanbul' }
    const quiet = { ...old, weatherBanner: 'none' }
    const results = [
      { legs: [{ residualProposal: proposal, evidence: { before: 'b' } }] },
    ]
    const weatherAging = { locationKey: 'san-francisco-ca', ageMinutes: 120 }
    const proposed = proposedBaselines(
      { about: 'x', entries: [old, istanbul, quiet] },
      results,
      { dir: 'runs/proof', weatherAging }
    )
    assert.deepEqual(proposed.entries, [
      istanbul,
      quiet,
      { ...proposal, evidence: { dir: 'runs/proof', before: 'b', weatherAging } },
    ])
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

// F-00i (TD-01, TEA review of 2026-11-14) through the journey: the cold control, the report's
// review lists, and TD-05 clipped keys proposed and approved from a run.
describe('runScreenJourney with the text layout probe', () => {
  const NEW_POST = JSON.stringify(['community-new-post-label', 'New post'])
  const options = { reactNativeVersion: '0.81.5', label: 'sdk54-release' }
  /** Every capture's records with `change(record, context)` applied to each. */
  const editRecords =
    (change) =>
    ({ capture, ...context }) => ({
      ...capture,
      textProbe: {
        ...capture.textProbe,
        records: capture.textProbe.records.map((record) =>
          change({ ...record }, context)
        ),
      },
    })

  test('an ellipsis every cold launch shows passes and is listed per scale for review', async () => {
    const probe = editRecords((record) =>
      record.text === 'About' ? { ...record, ellipsized: 1 } : record
    )
    const result = await run('android', fakeDevice('android', { probe }))
    assert.ok(
      result.legs.every((leg) => leg.pass),
      JSON.stringify(result.legs.map((l) => l.message))
    )
    for (const scale of ['1', '1.5'])
      for (const stage of ['reference', 'updated'])
        assert.deepEqual(result.coldTextProbe[scale][stage].ellipsized, [
          {
            key: '["header-info-modal","About"]#0',
            via: 'text',
            text: 'About',
            ellipsized: 1,
          },
        ])
    assert.equal(aggregateVerdict([result], 'android').pass, true)
  })

  test('an ellipsis only the live screen shows fails its leg', async () => {
    const probe = editRecords((record, { stage, at }) =>
      record.text === 'About' && stage === 'settled' && at === '1.5'
        ? { ...record, ellipsized: 1 }
        : record
    )
    const result = await run('android', fakeDevice('android', { probe }))
    assert.equal(result.legs[0].error, 'live_font_fix_missing')
    assert.match(result.legs[0].message, /failing clipping/)
    assert.equal(result.legs[1].pass, true)
  })

  test('a layout clip at a cold launch fails the F-01 control and the run', async () => {
    const probe = editRecords((record, { stage, at }) =>
      record.text === 'New post' && stage === 'cold' && at === '1.5'
        ? {
            ...record,
            contentRect: [...record.contentRect.slice(0, 3), record.contentRect[3] + 30],
          }
        : record
    )
    const result = await run('android', fakeDevice('android', { probe }))
    assert.equal(result.controls[0].pass, false)
    assert.equal(result.controls[0].error, 'live_font_control_clipped_by_layout')
    const verdict = aggregateVerdict([result], 'android')
    assert.equal(verdict.pass, false)
    assert.match(
      verdict.reasons.join(' '),
      /control 1\.5 live_font_control_clipped_by_layout/
    )
  })

  test('an entry from before the amendment approves nothing and the leg proposes it again', async () => {
    const breaking = () => fakeDevice('android', { breakAt: 'settled:1.5' })
    const fresh = (await run('android', breaking(), options)).legs[0].residualProposal
    const old = { ...fresh, review: { ...fresh.review } }
    delete old.clippedKeys
    delete old.review.clipsStale
    const result = await run('android', breaking(), {
      ...options,
      residualBaselines: [old],
    })
    const [leg] = result.legs
    assert.equal(leg.pass, false)
    assert.equal(leg.error, 'live_font_residual_unapproved')
    assert.match(leg.message, /predates the TD-05 clip amendment/)
    assert.deepEqual(leg.residualProposal, fresh)
    const proposed = proposedBaselines({ entries: [old] }, [result])
    assert.deepEqual(proposed.entries, [{ ...fresh, evidence: leg.evidence }])
    // The amended entry, once committed, approves the leg and proposes nothing more.
    const again = await run('android', breaking(), {
      ...options,
      residualBaselines: [fresh],
    })
    assert.equal(again.legs[0].pass, true)
    assert.equal(again.legs[0].residualProposal, undefined)
  })

  // iOS: the New post label is an accessibility group over two text views, "New" and "post".
  // On a stale settled or updated screen "post" draws at the new scale inside its stale box.
  const splitNewPost = ({ stage, stale, capture }) => {
    const label = capture.nodes.find((node) => node.id === 'community-new-post-label')
    const [left, top, right, bottom] = rectOf(label.bounds)
    const post = probeRecord('ios', 'post', [left + 150, top, right, bottom])
    if (['settled', 'updated'].includes(stage) && stale)
      post.contentRect = [left + 150, top, right, bottom + 20]
    return {
      ...capture,
      textProbe: {
        ...capture.textProbe,
        records: [
          ...capture.textProbe.records.filter((record) => record.text !== 'New post'),
          probeRecord('ios', 'New', [left, top, left + 140, bottom]),
          post,
        ],
      },
    }
  }
  const groupBreaking = () =>
    fakeDevice('ios', { breakAt: 'settled:extra-extra-extra-large', probe: splitNewPost })

  // TEA ruling 2026-11-14: the iOS leg from extra-extra-extra-large keeps that scale's box, and
  // its clip is the stale box's own, judged against the cold launch it starts from.
  test('a stale clip on a leg that starts above the base keeps the starting-scale box', async () => {
    const xxxl = 'extra-extra-extra-large'
    const fake = () =>
      fakeDevice('ios', {
        breakAt: ['settled:accessibility-medium', 'updated:accessibility-medium'],
        staleScale: xxxl,
        probe: splitNewPost,
      })
    const result = await run('ios', fake(), options)
    const leg = result.legs[1]
    assert.deepEqual([leg.from, leg.to], [xxxl, 'accessibility-medium'])
    assert.equal(leg.error, 'live_font_residual_unapproved', leg.message)
    // Both stages: the settled box against the cold xxxl launch, the updated box against that
    // launch's update.
    assert.deepEqual(leg.residualProposal.clippedKeys, [
      `staleBox:cold:${NEW_POST}#0>["","post"]#0`,
      `staleBox:updated:${NEW_POST}#0>["","post"]#0`,
    ])
    assert.equal(leg.residualProposal.review.clipsStale, true)
    const approved = await run('ios', fake(), {
      ...options,
      residualBaselines: [leg.residualProposal],
    })
    assert.equal(approved.legs[1].pass, true, approved.legs[1].message)
  })

  // The 6.8 bug's second face (TEA ruling 2026-11-14, Android Release 791123d1, Home and
  // Settings 1.5 to 1.0): the box resizes to 1.0 while the text keeps its 1.5 layout. The fake
  // leg back to 1.0 shows it on New post: a fresh box (the cold 1.0 launch's) whose content is
  // the cold 1.5 launch's height.
  const tall = Math.round(
    40 *
      expectedTextRatio({
        platform: 'android',
        androidApi: 36,
        sizeSp: 13,
        from: 1,
        to: 1.5,
      })
  )
  const secondFace = (change) =>
    editRecords((record, { stage, at }) =>
      record.text === 'New post' && stage === 'settled' && at === '1'
        ? change(record)
        : record
    )
  const staleContent = (record) => ({
    ...record,
    contentRect: [...record.contentRect.slice(0, 3), record.contentRect[1] + tall],
  })
  const NEW_POST_KEY = `cold:${NEW_POST}#0`

  test('the second face: a fresh box with stale content is proposed as staleContent and approves', async () => {
    const fake = () => fakeDevice('android', { probe: secondFace(staleContent) })
    const result = await run('android', fake(), options)
    const back = result.legs[1]
    assert.deepEqual([back.from, back.to], ['1.5', '1'])
    assert.equal(back.error, 'live_font_residual_unapproved', back.message)
    const clip = back.checks.clipping.clipped[0]
    assert.deepEqual(
      [clip.face, clip.stale, clip.staleContent, clip.height],
      ['staleContent', false, true, 40]
    )
    // Its parity passes, so it lists no stale key.
    assert.deepEqual(back.residualProposal.staleKeys, [])
    assert.deepEqual(back.residualProposal.clippedKeys, [`staleContent:${NEW_POST_KEY}`])
    assert.equal(back.residualProposal.review.clipsStale, true)
    assert.equal(back.residualProposal.review.everyMissStale, true)
    const approved = await run('android', fake(), {
      ...options,
      residualBaselines: [back.residualProposal],
    })
    assert.equal(approved.legs[1].pass, true, approved.legs[1].message)
    // From 0.87 every clip fails.
    const fixed = await run('android', fake(), {
      label: 'sdk54-release',
      reactNativeVersion: '0.88.1',
    })
    assert.equal(fixed.legs[1].error, 'live_font_fix_missing')
  })

  test('a fresh box with fresh content that clips is neither face and fails', async () => {
    const cut = (record) => ({
      ...record,
      clipRect: [...record.clipRect.slice(0, 3), record.clipRect[1] + 20],
    })
    const result = await run(
      'android',
      fakeDevice('android', { probe: secondFace(cut) }),
      options
    )
    assert.equal(result.legs[1].error, 'live_font_baseline_unexpected')
    assert.equal(result.legs[1].checks.clipping.clipped[0].face, null)
  })

  test('stale content in a box that is not the target cold box fails', async () => {
    const grown = (record) => {
      const stale = staleContent(record)
      const viewRect = [...record.viewRect.slice(0, 3), record.viewRect[3] + 10]
      return { ...stale, viewRect, clipRect: viewRect, visibleRect: viewRect }
    }
    const result = await run(
      'android',
      fakeDevice('android', { probe: secondFace(grown) }),
      options
    )
    assert.equal(result.legs[1].error, 'live_font_baseline_unexpected')
    const [clip] = result.legs[1].checks.clipping.clipped
    assert.deepEqual([clip.staleContent, clip.staleBox, clip.face], [false, false, null])
  })

  test('a clipped record inside an iOS group is keyed under the group and proposed exactly', async () => {
    const result = await run('ios', groupBreaking(), options)
    const [leg] = result.legs
    assert.equal(leg.error, 'live_font_residual_unapproved')
    assert.deepEqual(leg.checks.textProbe.stages.settled.groups, [
      { node: NEW_POST, records: ['New', 'post'] },
    ])
    const groupKey = `staleBox:cold:${NEW_POST}#0>["","post"]#0`
    assert.deepEqual(leg.residualProposal.staleKeys, [`cold:${NEW_POST}#0`])
    assert.deepEqual(leg.residualProposal.clippedKeys, [groupKey])
    assert.equal(leg.residualProposal.review.clipsStale, true)
    // Committed, the proposal approves the leg; without the group key it approves nothing.
    const approved = await run('ios', groupBreaking(), {
      ...options,
      residualBaselines: [leg.residualProposal],
    })
    assert.equal(approved.legs[0].pass, true, approved.legs[0].message)
    const unlisted = await run('ios', groupBreaking(), {
      ...options,
      residualBaselines: [{ ...leg.residualProposal, clippedKeys: [] }],
    })
    assert.equal(unlisted.legs[0].error, 'live_font_residual_unapproved')
    assert.match(
      unlisted.legs[0].message,
      /clip outside clippedKeys: staleBox:cold:.*>\["","post"\]#0/
    )
    // The node's own key is not the record's: listing it fails both ways.
    const nodeKeyed = await run('ios', groupBreaking(), {
      ...options,
      residualBaselines: [
        { ...leg.residualProposal, clippedKeys: [`staleBox:cold:${NEW_POST}#0`] },
      ],
    })
    assert.match(nodeKeyed.legs[0].message, /1 extra, 1 missing/)
  })
})
