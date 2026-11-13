// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  restoreFailure,
  sameLayoutShifted,
  windowBounds,
  parseEnvironment,
  activityConfiguration,
  activityToken,
  assertHierarchySource,
  deviceFingerprint,
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

  test('drops a volatile region with everything under it and counts what it dropped', () => {
    const page = node({ bounds: '[0,0][1080,2400]' }, [
      node({ text: 'Create my outfit card', bounds: '[76,1519][1004,1597]' }),
      node({
        'resource-id': 'shop-this-look-offer-title',
        text: 'Everyday Layering Tee',
        bounds: '[81,1862][999,1915]',
      }),
      node({ 'resource-id': 'shop-this-look-cta', bounds: '[81,1936][999,2052]' }, [
        node({ text: 'Shop this look', bounds: '[420,1968][659,2019]' }),
      ]),
      node({
        'resource-id': 'shop-this-lookout',
        text: 'Kept',
        bounds: '[0,2100][9,2110]',
      }),
    ])
    const kept = flattenHierarchy(page, {
      platform: 'android',
      volatile: ['shop-this-look-'],
    })
    assert.deepEqual(
      kept.nodes.map((entry) => entry.text),
      ['Create my outfit card', 'Kept']
    )
    assert.equal(kept.volatileDropped, 2)
    assert.ok(!kept.controls.some((control) => control.id.startsWith('shop-this-look-')))
    const all = flattenHierarchy(page, { platform: 'android' })
    assert.equal(all.nodes.length, 4)
    assert.equal(all.volatileDropped, 0)
  })
})

describe('Android activity facts', () => {
  const component = 'com.couturecast.story68/.MainActivity'

  test('reads the locales and layout direction last reported to MainActivity', () => {
    const record = (pkg, locales, dir) =>
      [
        `    * ActivityRecord{6a1 u0 ${pkg}/.MainActivity t12}`,
        '      mLastReportedConfigurations:',
        '        mGlobalConfig={1.0 310mcc260mnc [en_US] ldltr sw411dp}',
        `        mOverrideConfig={1.0 310mcc260mnc [${locales}] ${dir} sw411dp 420dpi}`,
        `      CurrentConfiguration={1.0 310mcc260mnc [${locales}] ${dir} sw411dp}`,
      ].join('\n')
    const dump = [
      '    topResumedActivity=ActivityRecord{6a1 u0 com.couturecast.story68/.MainActivity t12}',
      record('com.android.settings', 'en_US', 'ldltr'),
      record('com.couturecast.story68', 'ar_EG,en_US', 'ldrtl'),
    ].join('\n')
    assert.deepEqual(activityConfiguration(dump, component), {
      locales: ['ar_EG', 'en_US'],
      rtl: true,
    })
    assert.deepEqual(
      activityConfiguration(
        record('com.couturecast.story68', 'en_US', 'ldltr'),
        component
      ),
      { locales: ['en_US'], rtl: false }
    )
    assert.equal(
      activityConfiguration(record('com.other', 'ar_EG', 'ldrtl'), component),
      undefined
    )
  })

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

  test('counts a tall text once when the viewport clips it differently on each page', () => {
    const box = (text, y, bottom) => ({ text, id: '', bounds: `[0,${y}][100,${bottom}]` })
    // 240 px of disclosure, whole on the first page; on the last short scroll a sticky header
    // clips its top, and the pages align 6 px off on the only other shared text.
    const first = [box('A', 100, 140), box('C', 900, 940), box('Disclosure', 421, 661)]
    const second = [box('C', 632, 672), box('Disclosure', 296, 399), box('B', 700, 740)]
    assert.deepEqual(
      stitchPages([first, second]).map((key) => JSON.parse(key)[1]),
      ['A', 'C', 'Disclosure', 'B']
    )
    // Two copies of the same label that sit apart are both kept.
    const third = [
      box('C', 100, 140),
      box('Disclosure', 300, 540),
      box('Disclosure', 700, 940),
    ]
    assert.equal(
      stitchPages([third]).filter((key) => JSON.parse(key)[1] === 'Disclosure').length,
      2
    )
  })

  test('aligns pages on volatile text but leaves it out of the result', () => {
    const card = (text, y) => ({ ...at(text, y), volatile: true })
    const first = [at('Header', 100), card('Card 1', 500), card('Card 2', 900)]
    const second = [card('Card 2', 100), card('Card 3', 500), at('Footer', 900)]
    assert.deepEqual(
      stitchPages([first, second]).map((key) => JSON.parse(key)[1]),
      ['Header', 'Footer']
    )
  })

  test('grows a taken box as later pages show more of it', () => {
    // Settings' disclosure: cut by the bottom edge, whole, whole, then cut by the sticky header.
    const box = (text, y, bottom) => ({ text, id: '', bounds: `[0,${y}][100,${bottom}]` })
    const pages = [
      [box('Locations', 1762, 1813), box('Disclosure', 2111, 2190)],
      [
        box('Locations', 916, 967),
        box('Disclosure', 1265, 1505),
        box('Status', 1536, 1587),
      ],
      [box('Premium', 336, 393), box('Disclosure', 419, 659), box('Status', 690, 741)],
      [box('Disclosure', 296, 399), box('Status', 430, 481)],
    ]
    pages[1].push(box('Premium', 1182, 1239))
    assert.deepEqual(
      stitchPages(pages).map((key) => JSON.parse(key)[1]),
      ['Locations', 'Disclosure', 'Status', 'Premium']
    )
  })

  test('steps over a page with no shared text by the drag length', () => {
    // A tall image fills the middle page; the drags are 840 px each.
    const first = [at('Header', 100), at('Caption 1', 300)]
    const last = [at('Caption 2', 900), at('Caption 1', 300 - 1680)]
    assert.throws(() => stitchPages([first, [], last]), {
      message: 'live_font_scroll_pages_disjoint',
    })
    assert.deepEqual(
      stitchPages([first, [], last], { expectedShift: 840 }).map(
        (key) => JSON.parse(key)[1]
      ),
      ['Header', 'Caption 1', 'Caption 2']
    )
    // Once a step is measured, a later textless page reuses it.
    const second = [at('Caption 1', -540), at('Footer', 1000)]
    const afterGap = [at('Footer', 1000 - 1680)]
    assert.deepEqual(
      stitchPages([first, second, [], afterGap], { expectedShift: 5 }).map(
        (key) => JSON.parse(key)[1]
      ),
      ['Header', 'Caption 1', 'Footer']
    )
  })

  test('marks a volatile region instead of dropping it when asked', () => {
    const page = node({ bounds: '[0,0][1080,2400]' }, [
      node({ text: 'Header', bounds: '[0,100][500,140]' }),
      node({ 'resource-id': 'community-post-card-1', bounds: '[0,500][1080,900]' }, [
        node({ text: 'Card 1', bounds: '[0,500][500,540]' }),
      ]),
    ])
    const { nodes, volatileDropped } = flattenHierarchy(page, {
      platform: 'android',
      volatile: ['community-post-card-'],
      markVolatile: true,
    })
    assert.deepEqual(
      nodes.map((entry) => [entry.text, Boolean(entry.volatile)]),
      [
        ['Header', false],
        ['Card 1', true],
      ]
    )
    assert.equal(volatileDropped, 0)
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
  const clock = (text) => ({
    id: 'com.android.systemui:id/clock',
    text,
    bounds: '[0,0][9,9]',
  })
  assert.equal(sameLayout([...a, clock('4:44')], [...a, clock('4:45')]), true)
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

test('windowBounds never takes an empty node at the origin (review P3-1)', () => {
  const tree = node({}, [
    node({ bounds: '[0,0][0,0]' }),
    node({ bounds: '[10,20][392,860]' }),
  ])
  assert.equal(windowBounds(tree), '[10,20][392,860]')
})

test('windowBounds takes the app window over content scrolled off screen on iOS', () => {
  const tree = node({}, [
    node({ text: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
      node({ bounds: '[34,-354][367,-300]' }),
      node({ bounds: '[0,800][402,963]' }),
    ]),
  ])
  assert.equal(windowBounds(tree), '[0,0][402,874]')
})

test('windowBounds spans every bounded node when the root has none', () => {
  const tree = node({}, [
    node({ bounds: '[0,0][1080,2400]' }, [node({ bounds: '[42,488][304,657]' })]),
    node({ bounds: '[0,2274][1080,2400]' }),
  ])
  assert.equal(windowBounds(tree), '[0,0][1080,2400]')
  assert.equal(windowBounds(node({})), undefined)
})

test('sameLayoutShifted accepts one small vertical shift and nothing else', () => {
  const at = (text, y) => ({ id: '', text, bounds: `[0,${y}][100,${y + 40}]` })
  const page = [at('A', 100), at('B', 200)]
  assert.equal(sameLayoutShifted(page, [at('A', 106), at('B', 206)]), true)
  assert.equal(sameLayoutShifted(page, [at('A', 120), at('B', 220)]), false)
  assert.equal(sameLayoutShifted(page, [at('A', 106), at('B', 208)]), false)
  assert.equal(sameLayoutShifted(page, [at('A', 100)]), false)
  const withTabs = [...page, at('Home', 2277)]
  assert.equal(
    sameLayoutShifted(withTabs, [at('A', 106), at('B', 206), at('Home', 2277)]),
    true
  )
})

test('restoreFailure tells a relayout on scroll from a lost scroll position', () => {
  const box = (text, y, height = 40) => ({
    id: '',
    text,
    bounds: `[0,${y}][100,${y + height}]`,
  })
  const settled = [box('Home', 166, 92), box('Cloudy', 685, 78)]
  // The scroll-through made the screen measure its text again: heights changed.
  assert.equal(
    restoreFailure(settled, [box('Home', 176, 71), box('Cloudy', 678, 51)]),
    'live_font_relayout_on_scroll'
  )
  // Same heights, moved: the screen came back somewhere else.
  assert.equal(
    restoreFailure(settled, [box('Home', 136, 92), box('Cloudy', 655, 78)]),
    'live_font_scroll_not_restored'
  )
})

test('iOS leaves out the status bar window and the scroll bars', () => {
  const tree = node({ bounds: '[0,0][0,0]' }, [
    node({ accessibilityText: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
      node({ accessibilityText: 'Cloudy', bounds: '[16,160][80,180]' }),
      node({
        accessibilityText: 'Vertical scroll bar, 2 pages',
        text: '0%',
        bounds: '[369,108][399,152]',
      }),
      node({ text: '45%', bounds: '[16,200][60,220]' }),
    ]),
    node({ bounds: '[0,0][0,0]' }, [
      node({ bounds: '[0,0][402,54]' }, [
        node({ accessibilityText: '6:57 AM', bounds: '[55,22][92,42]' }),
      ]),
    ]),
  ])
  assert.deepEqual(
    flattenHierarchy(tree, { platform: 'ios' }).nodes.map((entry) => entry.text),
    ['CoutureCast Story68', 'Cloudy', '45%']
  )
})

describe('hierarchy source (two booted simulators)', () => {
  // Maestro 2.8 serves `hierarchy` on every iOS simulator through the one port 22087: with a
  // driver already up for simulator A, a read for simulator B returns A's screen.
  const statusBar = ({ battery, cellular, wifi }) =>
    node({ bounds: '[0,0][0,0]' }, [
      node({ bounds: '[0,0][402,54]' }, [
        node({ accessibilityText: '9:14 AM', bounds: '[55,22][92,42]' }),
        node({
          accessibilityText: 'Cellular',
          text: `${cellular} of 4 bars, signal strength`,
          bounds: '[288,26][307,38]',
        }),
        node({
          'resource-id': `${wifi} of 3 Wi-Fi bars`,
          text: `SSID, ${wifi} of 3 Wi-Fi bars`,
          bounds: '[315,26][332,38]',
        }),
        node({
          accessibilityText: `${battery}% battery power`,
          bounds: '[340,26][370,38]',
        }),
      ]),
    ])
  const dump = (rn, bar) =>
    node({ bounds: '[0,0][0,0]' }, [
      node({ accessibilityText: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
        node({
          'resource-id': `live-font-env-root~${rn}~light~ltr~3~en-US`,
          bounds: '[0,437][1,438]',
        }),
      ]),
      statusBar(bar),
    ])
  const udidA = '679BE700-51A7-489F-89D1-E509778C6C63'
  const udidB = 'C2AF70AA-B293-4D71-B064-00FFA8A20CE9'

  test('each simulator gets its own status bar fingerprint, never the defaults', () => {
    const [a, b] = [deviceFingerprint(udidA), deviceFingerprint(udidB)]
    assert.notDeepEqual(a, b)
    for (const print of [a, b]) {
      assert.ok(print.battery >= 1 && print.battery <= 99)
      assert.ok(print.cellular >= 0 && print.cellular <= 4)
      assert.ok(print.wifi >= 0 && print.wifi <= 2, 'three bars is the default')
    }
    assert.deepEqual(deviceFingerprint(udidA), a)
  })

  test('a dump from the requested simulator and build passes', () => {
    assert.doesNotThrow(() =>
      assertHierarchySource(dump('0.81.5', deviceFingerprint(udidA)), {
        platform: 'ios',
        fingerprint: deviceFingerprint(udidA),
        reactNativeVersion: '0.81.5',
      })
    )
  })

  test('a dump from the other simulator fails, whatever build it shows', () => {
    const other = dump('0.81.5', deviceFingerprint(udidB))
    assert.throws(
      () =>
        assertHierarchySource(other, {
          platform: 'ios',
          fingerprint: deviceFingerprint(udidA),
          reactNativeVersion: '0.81.5',
        }),
      { message: /^live_font_hierarchy_wrong_device/ }
    )
    // An unmarked simulator shows the defaults: 100% battery, 3 Wi-Fi bars.
    assert.throws(
      () =>
        assertHierarchySource(dump('0.81.5', { battery: 100, cellular: 0, wifi: 3 }), {
          platform: 'ios',
          fingerprint: deviceFingerprint(udidA),
        }),
      { message: /^live_font_hierarchy_wrong_device/ }
    )
  })

  test('a dump with no environment marker fails once the build is known (review P2-2c)', () => {
    const bare = dump('0.81.5', deviceFingerprint(udidA))
    bare.children[0].children = []
    assert.throws(
      () =>
        assertHierarchySource(bare, {
          platform: 'android',
          reactNativeVersion: '0.81.5',
        }),
      { message: 'live_font_hierarchy_wrong_build:missing' }
    )
    // Before the first read there is nothing to compare with.
    assert.doesNotThrow(() => assertHierarchySource(bare, { platform: 'android' }))
  })

  test('a battery level matches only as a whole number (review P3-1)', () => {
    const print = { battery: 5, cellular: 1, wifi: 1 }
    assert.throws(
      () =>
        assertHierarchySource(dump('0.81.5', { ...print, battery: 85 }), {
          platform: 'ios',
          fingerprint: print,
        }),
      { message: /^live_font_hierarchy_wrong_device/ }
    )
    assert.doesNotThrow(() =>
      assertHierarchySource(dump('0.81.5', print), {
        platform: 'ios',
        fingerprint: print,
      })
    )
  })

  test("a dump carrying another build's markers fails", () => {
    assert.throws(
      () =>
        assertHierarchySource(dump('0.88.1', deviceFingerprint(udidA)), {
          platform: 'ios',
          fingerprint: deviceFingerprint(udidA),
          reactNativeVersion: '0.81.5',
        }),
      { message: /^live_font_hierarchy_wrong_build/ }
    )
  })
})

test('iOS lists a static text once, not again as the identical element inside it', () => {
  // XCUITest shows Settings' "Premium" heading as an element and, inside it, a static text
  // with the same label and bounds; counted twice, neither copy could align scroll pages.
  const tree = node({ bounds: '[0,0][0,0]' }, [
    node({ accessibilityText: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
      node({ accessibilityText: 'Premium', bounds: '[34,753][367,772]' }, [
        node({ accessibilityText: 'Premium', bounds: '[34,753][367,772]' }),
      ]),
      node({ accessibilityText: 'Premium', bounds: '[34,900][367,919]' }),
    ]),
  ])
  assert.deepEqual(
    flattenHierarchy(tree, { platform: 'ios' }).nodes.map((entry) => [
      entry.text,
      entry.bounds,
    ]),
    [
      ['CoutureCast Story68', '[0,0][402,874]'],
      ['Premium', '[34,753][367,772]'],
      ['Premium', '[34,900][367,919]'],
    ]
  )
})
