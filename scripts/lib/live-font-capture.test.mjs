// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  parseEnvironment,
  activityToken,
  assertLiveProvenance,
  countOnCreate,
  flattenHierarchy,
  rootIdentity,
  sameLayout,
  stitchPages,
} from './live-font-capture.mjs'

const node = (attributes, children = []) => ({ attributes, children })

describe('flattenHierarchy', () => {
  const tree = node({ bounds: '[0,0][1080,2400]' }, [
    node({ 'resource-id': 'live-font-mount-root-ab12c1', bounds: '[0,0][1,1]' }),
    node({ 'resource-id': 'weather-header', bounds: '[0,400][1080,700]' }, [
      node({
        'resource-id': 'current-temperature',
        text: '57°F',
        bounds: '[42,488][304,657]',
      }),
      node({ text: '', accessibilityText: 'Cloudy', bounds: '[42,667][155,718]' }),
    ]),
    node({ 'resource-id': 'live-font-mount-home-ab12c2', bounds: '[0,0][1,1]' }),
    node({ 'resource-id': 'live-font-scale-home-1.5', bounds: '[0,0][1,1]' }),
    node({ 'resource-id': 'live-font-scale-root-1.5', bounds: '[0,0][1,1]' }),
  ])

  test('keeps text with its parent bounds, controls and sorted mount markers', () => {
    const { nodes, controls, markers } = flattenHierarchy(tree, { platform: 'android' })
    assert.deepEqual(nodes, [
      {
        text: '57°F',
        id: 'current-temperature',
        bounds: '[42,488][304,657]',
        parent: '[0,400][1080,700]',
      },
    ])
    assert.ok(controls.some((control) => control.id === 'weather-header'))
    assert.deepEqual(markers, [
      'live-font-mount-home-ab12c2',
      'live-font-mount-root-ab12c1',
    ])
    assert.equal(
      rootIdentity(markers),
      'live-font-mount-home-ab12c2,live-font-mount-root-ab12c1'
    )
    assert.equal(rootIdentity([]), undefined)
  })

  test('on iOS a static text label stands in for empty text', () => {
    const { nodes } = flattenHierarchy(tree, { platform: 'ios' })
    assert.deepEqual(
      nodes.map((entry) => entry.text),
      ['57°F', 'Cloudy']
    )
  })
})

describe('Android activity facts', () => {
  const component = 'com.couturecast.story68/.MainActivity'

  test('reads the one resumed MainActivity token', () => {
    const dump = `TASK 12\n  ACTIVITY ${component} 9f3a21c pid=19127\n    mResumed=true`
    assert.equal(activityToken(dump, component), '9f3a21c')
    assert.equal(
      activityToken(`${dump}\n  ACTIVITY ${component} 1b2c3d4 pid=19127`, component),
      undefined
    )
    assert.equal(activityToken('nothing', component), undefined)
  })

  // F-15: lines as Android 16 (API 36) writes them, from the cc68-api36 emulator.
  const className = 'com.couturecast.story68.MainActivity'
  const roomy =
    'events: ring buffer is 256 KiB (40 KiB consumed, 953 KiB readable), max entry is 5120 B, max payload is 4068 B'

  test('counts MainActivity onCreate calls by the logged class name', () => {
    const log = [
      '11-12 17:16:20.526  1366  1366 I wm_on_create_called: [68515176,com.google.android.apps.nexuslauncher.NexusLauncherActivity,performCreate,59]',
      `11-12 17:16:21.256 20514 20514 I wm_on_create_called: [77496459,${className},performCreate,30]`,
      `11-12 17:16:21.392 20514 20514 I wm_on_create_called: [19120456,${className},performCreate,19]`,
    ].join('\n')
    assert.equal(countOnCreate(log, className, roomy), 2)
    assert.equal(countOnCreate(log, 'com.couturecast.story68/.MainActivity', roomy), 0)
  })

  test('an unavailable or nearly full log is unknown, never zero', () => {
    assert.equal(countOnCreate(undefined, className, roomy), undefined)
    assert.equal(countOnCreate('', className, undefined), undefined)
    const full =
      'events: ring buffer is 256 KiB (252 KiB consumed, 953 KiB readable), max entry is 5120 B, max payload is 4068 B'
    assert.equal(countOnCreate('', className, full), undefined)
    assert.equal(countOnCreate('', className, roomy), 0)
  })
})

describe('stitchPages', () => {
  const at = (text, y) => ({ text, id: '', bounds: `[0,${y}][100,${y + 40}]` })

  test('joins overlapping pages and keeps repeated labels that sit apart', () => {
    const first = [at('A', 100), at('B', 200), at('57°F', 300), at('C', 400)]
    const second = [
      at('B', 0),
      at('57°F', 100),
      at('C', 200),
      at('57°F', 300),
      at('D', 400),
    ]
    // The second 57°F lands where the first one was; a third page shows it moved, so it is
    // content, not chrome.
    const third = [at('C', 0), at('57°F', 100), at('D', 200), at('E', 300)]
    assert.deepEqual(
      stitchPages([first, second, third]).map((key) => JSON.parse(key)[1]),
      ['A', 'B', '57°F', 'C', '57°F', 'D', 'E']
    )
  })

  test('counts chrome that sits still on every page once', () => {
    const tabs = (y) => [at('Home', y), at('Settings', y)]
    const first = [at('Top', 100), at('A', 300), at('B', 500), ...tabs(2300)]
    const second = [at('A', 100), at('B', 300), at('C', 500), ...tabs(2300)]
    const third = [at('B', 100), at('C', 300), at('D', 500), ...tabs(2300)]
    assert.deepEqual(
      stitchPages([first, second, third]).map((key) => JSON.parse(key)[1]),
      ['Top', 'A', 'B', 'Home', 'Settings', 'C', 'D']
    )
  })

  test('a node cut by the viewport matches on its visible edge', () => {
    const box = (text, topEdge, bottomEdge) => ({
      text,
      id: '',
      bounds: `[0,${topEdge}][100,${bottomEdge}]`,
    })
    // Page one shows "Long" cut at the bottom (top 900 visible); after a 600 px scroll page two
    // shows it whole, its top at 300 and bottom at 500.
    const first = [box('A', 100, 140), box('B', 500, 540), box('Long', 900, 960)]
    const second = [box('B', -100, -60), box('Long', 300, 500), box('C', 700, 740)]
    const third = [box('Long', -300, -100), box('C', 100, 140), box('D', 500, 540)]
    assert.deepEqual(
      stitchPages([first, second, third]).map((key) => JSON.parse(key)[1]),
      ['A', 'B', 'Long', 'C', 'D']
    )
  })

  test('refuses pages with no shared anchor', () => {
    assert.throws(() => stitchPages([[at('A', 0)], [at('Z', 0)]]), {
      message: 'live_font_scroll_pages_disjoint',
    })
  })
})

test('sameLayout compares text and bounds', () => {
  const a = [{ id: 'x', text: 'A', bounds: '[0,0][1,1]' }]
  assert.equal(sameLayout(a, structuredClone(a)), true)
  assert.equal(sameLayout(a, [{ ...a[0], bounds: '[0,0][1,2]' }]), false)
})

test('flattenHierarchy reads one JavaScript font scale or none', () => {
  const tree = (...ids) =>
    node(
      { bounds: '[0,0][10,10]' },
      ids.map((id) => node({ 'resource-id': id, bounds: '[0,0][1,1]' }))
    )
  assert.equal(
    flattenHierarchy(tree('live-font-scale-root-1.5', 'live-font-scale-modal-1.5'), {
      platform: 'android',
    }).jsFontScale,
    1.5
  )
  assert.equal(
    flattenHierarchy(tree('live-font-scale-root-1', 'live-font-scale-modal-1.5'), {
      platform: 'android',
    }).jsFontScale,
    undefined
  )
})

describe('assertLiveProvenance', () => {
  const stage = (name, launch, scale) => ({
    stage: name,
    launch,
    fontScale: scale,
    osScale: String(scale),
    jsFontScale: scale,
  })
  const live = () => ({
    platform: 'android',
    before: stage('before', 'launch-2', 1),
    immediate: stage('immediate', 'launch-2', 1.5),
    settled: stage('settled', 'launch-2', 1.5),
    cold: stage('cold', 'launch-1', 1.5),
  })

  test('accepts one launch for the live stages and another for the cold reference', () => {
    assert.deepEqual(assertLiveProvenance(live()), {
      launch: 'launch-2',
      coldLaunch: 'launch-1',
    })
  })

  test('refuses a real cold capture presented as the settled live stage', () => {
    const change = live()
    change.settled = { ...change.cold, stage: 'settled' }
    assert.throws(() => assertLiveProvenance(change), {
      message: 'live_font_provenance_launch_changed',
    })
    assert.throws(
      () =>
        assertLiveProvenance({ ...live(), cold: { ...live().cold, launch: 'launch-2' } }),
      {
        message: 'live_font_provenance_cold_is_live',
      }
    )
  })

  test('refuses a scale change JavaScript never saw, or an OS setting that did not move', () => {
    const silent = live()
    silent.settled.jsFontScale = 1
    assert.throws(() => assertLiveProvenance(silent), {
      message: 'live_font_provenance_js_scale:settled',
    })
    const unset = live()
    unset.settled.osScale = '1.0'
    assert.throws(() => assertLiveProvenance(unset), {
      message: 'live_font_provenance_os_scale:settled',
    })
  })

  test('reads iOS content-size categories as multipliers', () => {
    const ios = live()
    ios.platform = 'ios'
    ios.before.osScale = 'large'
    ios.settled = {
      ...ios.settled,
      fontScale: 1.353,
      osScale: 'extra-extra-extra-large',
      jsFontScale: 1.353,
    }
    assert.equal(assertLiveProvenance(ios).launch, 'launch-2')
  })
})

test('flattenHierarchy reads the environment every marked window agrees on', () => {
  const tree = (...ids) =>
    node(
      { bounds: '[0,0][10,10]' },
      ids.map((id) => node({ 'resource-id': id, bounds: '[0,0][1,1]' }))
    )
  const env = '~0.81.5~dark~rtl~2.625~ar-EG'
  assert.deepEqual(
    flattenHierarchy(tree(`live-font-env-root${env}`, `live-font-env-home${env}`), {
      platform: 'android',
    }).environment,
    {
      reactNativeVersion: '0.81.5',
      scheme: 'dark',
      direction: 'rtl',
      density: 2.625,
      language: 'ar-EG',
    }
  )
  assert.equal(
    flattenHierarchy(
      tree(`live-font-env-root${env}`, 'live-font-env-home~0.81.5~light~ltr~2.625~en-US'),
      {
        platform: 'android',
      }
    ).environment,
    undefined
  )
  assert.equal(parseEnvironment('live-font-env-home~0.81.5'), undefined)
})
