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
  readCheckedHierarchy,
  deviceFingerprint,
  assertLiveProvenance,
  countOnCreate,
  flattenHierarchy,
  missingMounts,
  mountScopes,
  mountTracker,
  settleCapture,
  widenMounts,
  readWithMounts,
  rootIdentity,
  runTimezone,
  LIVE_FONT_TIMEZONE,
  sameLayout,
  stitchPages,
  stitchPlaces,
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

  // iOS run 43773613293, composer: XCUITest gives a switch its value as text ("1") and its name as
  // accessibilityText. The node keeps both, so the probe's element (named by the label) can pair it.
  test('an iOS node keeps an accessibility label apart from its text; Android reads none', () => {
    const screen = node({ bounds: '[0,0][402,874]' }, [
      node({ bounds: '[0,78][402,823]' }, [
        node({
          'resource-id': 'share-card-watermark',
          text: '1',
          accessibilityText: 'Show watermark',
          bounds: '[313,125][378,173]',
        }),
        node({
          text: '',
          accessibilityText: 'Your share card',
          bounds: '[24,78][378,109]',
        }),
        node({ text: 'Save', accessibilityText: 'Save', bounds: '[24,709][195,758]' }),
      ]),
    ])
    const ios = flattenHierarchy({ children: [screen] }, { platform: 'ios' }).nodes
    assert.deepEqual(
      ios.map(({ text, label }) => [text, label]),
      [
        ['1', 'Show watermark'],
        ['Your share card', undefined],
        ['Save', undefined],
      ]
    )
    const android = flattenHierarchy(screen, { platform: 'android' }).nodes
    assert.deepEqual(
      android.map(({ text, label }) => [text, label]),
      [
        ['1', undefined],
        ['Save', undefined],
      ]
    )
  })

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
    // F-00i: each dropped region's bounds, so the probe's records inside it skip matching.
    assert.deepEqual(kept.volatileRegions, ['[81,1862][999,1915]', '[81,1936][999,2052]'])
    // TEA ruling r45: each region's testID, in the same order, keys its records.
    assert.deepEqual(kept.volatileRegionIds, [
      'shop-this-look-offer-title',
      'shop-this-look-cta',
    ])
    const marked = flattenHierarchy(page, {
      platform: 'android',
      volatile: ['shop-this-look-'],
      markVolatile: true,
    })
    assert.deepEqual(marked.volatileRegionIds, kept.volatileRegionIds)
    assert.ok(!kept.controls.some((control) => control.id.startsWith('shop-this-look-')))
    const all = flattenHierarchy(page, { platform: 'android' })
    assert.equal(all.nodes.length, 4)
    assert.equal(all.volatileDropped, 0)
    assert.deepEqual(all.volatileRegions, [])
    assert.deepEqual(all.volatileRegionIds, [])
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

  // F-00i, every page probed: where each page node went, so its probe records are named once.
  test('places each page node on its stitched text, chrome on its page 0 copy', () => {
    const tab = { text: 'Home', id: 'tab-home', bounds: '[0,2200][100,2240]' }
    const card = { ...at('Card', 300), volatile: true }
    const first = [at('A', 100), card, at('B', 200), at('C', 400), tab]
    const second = [at('B', 0), at('C', 200), at('D', 400), tab]
    const { taken, offsets, places } = stitchPlaces([first, second])
    assert.deepEqual(
      taken.map(({ key }) => JSON.parse(key)[1]),
      ['A', 'B', 'C', 'Home', 'D']
    )
    assert.deepEqual(offsets, [0, 200])
    // The volatile card has no place; the tab bar on page 1 is page 0's.
    assert.deepEqual(places, [
      [0, -1, 1, 2, 3],
      [1, 2, 4, 3],
    ])
    assert.deepEqual(
      stitchPages([first, second]),
      taken.map(({ key }) => key)
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
    // Once a step is measured (830 px for a drag of 840), a textless page takes it: the footer
    // two such steps on lands on itself, where the drag's own length would put it 20 px off.
    const second = [at('Caption 1', 300 - 830), at('Footer', 1000)]
    const afterGap = [at('Footer', 1000 - 1660)]
    assert.deepEqual(
      stitchPages([first, second, [], afterGap], { expectedShift: 840 }).map(
        (key) => JSON.parse(key)[1]
      ),
      ['Header', 'Caption 1', 'Footer']
    )
    // A textless page before the first measured step takes it too.
    assert.deepEqual(
      stitchPlaces([first, [], [at('X', 500)], [at('X', 500 - 830)]], {
        expectedShift: 840,
      }).offsets,
      [0, 830, 1660, 2490]
    )
  })

  // Android 6c85bbb4 Community, cold 1.0 launch 002, pages 2 to 3 (drag 840, true step 846):
  // the status-bar clock, which changed minute on a later page so it is no chrome, measured 0;
  // the id-less "Comments" and "Temperate and dry" paired with another card's copy (-930,
  // -993); the cc68 caption, cut by the bottom edge on page 2, measured 844 off a 3 px box. The
  // median was 0, so the caption landed in two places.
  test('measures a step only from shifts that measure the drag', () => {
    const box = (id, text, bounds, extra = {}) => ({ id, text, bounds, ...extra })
    const CAPTION =
      'community-card-caption-cc68-native-7756b8d9-4e43-4afa-bcce-a79bbe01e969'
    const tabs = [
      box('', 'Home', '[99,2277][171,2314]'),
      box('', 'Settings', '[895,2277][994,2314]'),
    ]
    const page2 = [
      box('com.android.systemui:id/clock', '1:40', '[50,43][154,86]'),
      box('community-new-post-label', 'New post', '[847,372][996,419]'),
      box('', 'Comments', '[419,861][591,908]', { volatile: true }),
      box('', 'Temperate and dry', '[725,1104][969,1143]', { volatile: true }),
      box(
        CAPTION,
        'A synthetic CC68 outfit for native export proof.',
        '[44,2187][1036,2190]',
        {
          volatile: true,
        }
      ),
      ...tabs,
    ]
    const page3 = [
      box('com.android.systemui:id/clock', '1:40', '[50,43][154,86]'),
      box('community-new-post-label', 'New post', '[847,372][996,419]'),
      box('', 'Comments', '[543,1791][715,1838]', { volatile: true }),
      box('', 'Temperate and dry', '[300,2097][544,2136]', { volatile: true }),
      box(
        CAPTION,
        'A synthetic CC68 outfit for native export proof.',
        '[44,1343][1036,1419]',
        {
          volatile: true,
        }
      ),
      box('', 'Report', '[800,1500][950,1547]'),
      ...tabs,
    ]
    const page4 = [
      box('com.android.systemui:id/clock', '1:41', '[50,43][154,86]'),
      box('community-new-post-label', 'New post', '[847,372][996,419]'),
      box('', 'Report', '[800,654][950,701]'),
      ...tabs,
    ]
    const { offsets } = stitchPlaces([page2, page3, page4], { expectedShift: 840 })
    assert.deepEqual(offsets, [0, 846, 1692])
    // The caption's page 3 box, moved by the step, lands on its page 2 top.
    assert.ok(Math.abs(1343 + offsets[1] - 2187) <= 4)
    // Status-bar nodes never measure a step, even with no drag length to check against.
    const status = (time, signal) => [
      box('com.android.systemui:id/clock', time, '[50,43][154,86]'),
      box('com.android.systemui:id/mobile_signal', signal, '[900,43][960,86]'),
    ]
    const clocked = [
      [...status('1:40', 'Two bars'), box('card-a', 'A', '[44,1382][1036,1458]')],
      [...status('1:40', 'Two bars'), box('card-a', 'A', '[44,536][1036,612]')],
      [...status('1:41', 'Three bars')],
    ]
    assert.deepEqual(stitchPlaces(clocked).offsets.slice(0, 2), [0, 846])
    // A box the viewport clamps on one page (3 px tall there) never measures a step.
    const clamped = [
      [box('card-a', 'A', '[44,2187][1036,2190]')],
      [
        box('card-a', 'A', '[44,1382][1036,1458]'),
        box('card-b', 'B', '[44,1500][1036,1550]'),
      ],
      [box('card-b', 'B', '[44,654][1036,704]')],
    ]
    assert.deepEqual(
      stitchPlaces(clamped, { expectedShift: 840 }).offsets,
      [0, 846, 1692]
    )
  })

  // r48 P2-1: the drag that reaches the bottom moves only the travel left (200 px of a 600 px
  // drag). Its anchors all sit outside SHIFT_SPREAD of the drag, and the old median fallback
  // stepped 600, so cards 4 to 6 landed twice.
  test('takes a short final drag from anchors that agree, and fails when they do not', () => {
    const card = (n, y) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${y}][100,${y + 100}]`,
    })
    const page0 = [card(1, 100), card(2, 400), card(3, 700), card(4, 1000)]
    const page1 = [card(3, 100), card(4, 400), card(5, 700), card(6, 1000)]
    const page2 = [card(4, 200), card(5, 500), card(6, 800), card(7, 1100)]
    const bottom = { expectedShift: 600, reachedBottom: true }
    const { taken, offsets } = stitchPlaces([page0, page1, page2], bottom)
    assert.deepEqual(offsets, [0, 600, 800])
    // r49 P2-4: a last page the capture does not record as the bottom is never short.
    assert.deepEqual(
      stitchPlaces([page0, page1, page2], { expectedShift: 600 }).offsets,
      [0, 600, 1200]
    )
    assert.deepEqual(
      taken.map(({ key }) => JSON.parse(key)[1]),
      ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5', 'Card 6', 'Card 7']
    )
    // A fixed probe record (a sticky chip, shift 0) and a repeated text paired with a lower
    // copy (negative) never count as anchors of the short drag.
    const comments = (y) => ({
      id: '',
      text: 'Comments',
      bounds: `[0,${y}][100,${y + 40}]`,
    })
    const record = (node) => {
      const [left, top, right, bottom] = node.bounds.match(/-?\d+/g).map(Number)
      return { text: node.text, viewRect: [left, top, right, bottom] }
    }
    const chip = { text: 'Cold and wet', viewRect: [600, 50, 900, 90] }
    const pages = [page0, [...page1, comments(150)], [...page2, comments(560)]]
    assert.deepEqual(
      stitchPlaces(pages, {
        ...bottom,
        records: pages.map((page) => [...page.map(record), chip]),
      }).offsets,
      [0, 600, 800]
    )
    // Anchors of the short drag that disagree (200 and 300) fail loudly.
    const split = [card(4, 200), card(5, 400), card(7, 1100)]
    assert.throws(() => stitchPlaces([page0, page1, split], bottom), {
      message: /^live_font_scroll_short_drag_ambiguous/,
    })
    // Only the drag that reaches the bottom may be short: a short middle step keeps the old
    // fallback (the median measured step).
    assert.deepEqual(
      stitchPlaces([page0, page1, page2, [card(9, 300 - 600)]], bottom).offsets,
      [0, 600, 1200, 1800]
    )
  })

  // r49 P2-4 (probes 4a to 4c): on the short last page a sticky header that jittered 6 px
  // measured 6 px (alone, the step; beside the cards, a disagreement), and one repeated label
  // paired with another copy confirmed a step by itself.
  test('a short final step needs two agreeing texts, and chrome held still stays chrome', () => {
    const card = (n, y) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${y}][100,${y + 100}]`,
    })
    const header = (y) => ({
      id: 'header',
      text: 'Community',
      bounds: `[0,${y}][400,${y + 40}]`,
    })
    const bottom = { expectedShift: 600, reachedBottom: true }
    const page0 = [header(20), card(1, 100), card(2, 400), card(3, 700), card(4, 1000)]
    const page1 = [header(20), card(3, 100), card(4, 400), card(5, 700), card(6, 1000)]
    const page2 = [header(26), card(4, 200), card(5, 500), card(6, 800), card(7, 1100)]
    const { offsets, taken, places } = stitchPlaces([page0, page1, page2], bottom)
    assert.deepEqual(offsets, [0, 600, 800])
    // The header is taken once and the jittered copy takes its page 0 place.
    assert.equal(taken.filter(({ key }) => JSON.parse(key)[1] === 'Community').length, 1)
    assert.equal(places[2][0], places[0][0])
    // The jittered header alone on the last page measures no step: no moving text, fallback.
    assert.deepEqual(
      stitchPlaces([page0, page1, [header(26), card(9, 900)]], bottom).offsets,
      [0, 600, 1200]
    )
    // One label shared by chance confirms nothing.
    const details = (y) => ({
      id: '',
      text: 'View details',
      bounds: `[0,${y}][100,${y + 40}]`,
    })
    assert.throws(
      () =>
        stitchPlaces(
          [page0, [...page1, details(900)], [card(8, 300), details(720)]],
          bottom
        ),
      { message: /^live_font_scroll_short_drag_unconfirmed/ }
    )
  })

  // iOS run 43773613293, Settings at extra-extra-extra-large: the last drag moved 5.4 pt. The
  // probe records (exact points) all measured 5.4; the hierarchy's whole-point bounds round each
  // edge, so the same cards measured 5 and 6, and 6 sat outside 10 percent of 5.4. A whole-unit
  // anchor is read within one unit of the step (its rounding), the step itself from the exact
  // records; anchors farther apart than that still fail.
  test('a short final step reads whole-unit anchors within their rounding', () => {
    const tops = [100.6, 400.4, 700.6, 1000.4, 1300.6]
    const offsets = [0, 300, 305.4]
    const shown = [
      [1, 2, 3, 4],
      [2, 3, 4, 5],
      [2, 3, 4, 5],
    ]
    const y = (n, page) => tops[n - 1] - offsets[page]
    const card = (n, top) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${Math.round(top)}][100,${Math.round(top) + 100}]`,
    })
    const pages = shown.map((cards, page) => cards.map((n) => card(n, y(n, page))))
    const records = shown.map((cards, page) =>
      cards.map((n) => ({
        text: `Card ${n}`,
        viewRect: [0, y(n, page), 100, y(n, page) + 100],
      }))
    )
    const bottom = { expectedShift: 300, reachedBottom: true, records }
    const stitched = stitchPlaces(pages, bottom)
    assert.equal(stitched.offsets.length, 3)
    assert.deepEqual(stitched.offsets.slice(0, 2), [0, 300])
    assert.ok(Math.abs(stitched.offsets[2] - 305.4) < 1e-9, String(stitched.offsets[2]))
    assert.deepEqual(
      stitched.taken.map(({ key }) => JSON.parse(key)[1]),
      ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5']
    )
    // A whole-unit anchor more than its rounding off the step (8 against 5.4) places a text
    // twice: ambiguous.
    const moved = pages.map((page, at) =>
      at === 2
        ? page.map((node) => (node.id === 'c3' ? card(3, y(3, 1) - 8) : node))
        : page
    )
    assert.throws(() => stitchPlaces(moved, bottom), {
      message: /^live_font_scroll_short_drag_ambiguous/,
    })
    // Exact anchors that disagree (5.4 and 9.4) stay ambiguous.
    const split = records.map((list, at) =>
      at === 2
        ? list.map((record) =>
            record.text === 'Card 5'
              ? {
                  ...record,
                  viewRect: record.viewRect.map((v, i) => (i % 2 ? v - 4 : v)),
                }
              : record
          )
        : list
    )
    assert.throws(() => stitchPlaces(pages, { ...bottom, records: split }), {
      message: /^live_font_scroll_short_drag_ambiguous/,
    })
  })

  // iOS dispatch 43852018196, Settings before extra-extra-extra-large: the scroll had already
  // reached the bottom but one, and the last drag moved under a point (page 6 tops -140 where page
  // 5 showed -139). With no anchor beyond the tolerance, the step fell back to a whole drag, so
  // the Premium section was counted twice (42 texts against 33).
  test('a final drag that barely moves takes the step its texts agree on', () => {
    const tops = [100.4, 400.6, 700.4, 1000.6, 1300.4]
    const offsets = [0, 300, 300.6]
    const shown = [
      [1, 2, 3, 4],
      [2, 3, 4, 5],
      [2, 3, 4, 5],
    ]
    const y = (n, page) => tops[n - 1] - offsets[page]
    const card = (n, top) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${Math.round(top)}][100,${Math.round(top) + 100}]`,
    })
    const pages = shown.map((cards, page) => cards.map((n) => card(n, y(n, page))))
    const records = shown.map((cards, page) =>
      cards.map((n) => ({
        text: `Card ${n}`,
        viewRect: [0, y(n, page), 100, y(n, page) + 100],
      }))
    )
    const bottom = { expectedShift: 300, reachedBottom: true, records }
    const stitched = stitchPlaces(pages, bottom)
    assert.deepEqual(stitched.offsets.slice(0, 2), [0, 300])
    assert.ok(Math.abs(stitched.offsets[2] - 300.6) < 1e-9, String(stitched.offsets[2]))
    assert.deepEqual(
      stitched.taken.map(({ key }) => JSON.parse(key)[1]),
      ['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5']
    )
    // Hierarchy bounds alone read the step to the whole unit and still place nothing twice.
    assert.deepEqual(
      stitchPlaces(pages, { expectedShift: 300, reachedBottom: true }).taken.length,
      5
    )
    // A last page not known to be the bottom is never short.
    assert.deepEqual(
      stitchPlaces(pages, { expectedShift: 300, records }).offsets,
      [0, 300, 600]
    )
    // One text that stayed put confirms nothing: a new page that shares one label by chance
    // keeps the whole drag.
    const lone = [pages[0], pages[1], [card(5, y(5, 1)), card(9, 900)]]
    assert.deepEqual(
      stitchPlaces(lone, { expectedShift: 300, reachedBottom: true }).offsets,
      [0, 300, 600]
    )
  })

  // CodeRabbit on PR 242: on two pages nothing marks a sticky record as fixed, so two of them
  // (shift 0) confirmed a zero step for a final drag of 900 between pages that share no text.
  // Only texts an earlier drag moved can confirm that the last one barely moved.
  test('stationary records never confirm a final drag that barely moved', () => {
    const card = (n, y) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${y}][100,${y + 100}]`,
    })
    const chips = [
      { text: 'Cold and wet', viewRect: [0, 50, 100, 90] },
      { text: 'Sunny', viewRect: [120, 50, 220, 90] },
    ]
    const asRecords = (page) => [
      ...page.map((node) => {
        const [left, top, right, bottom] = node.bounds.match(/-?\d+/g).map(Number)
        return { text: node.text, viewRect: [left, top, right, bottom] }
      }),
      ...chips,
    ]
    const two = [
      [card(1, 100), card(2, 400)],
      [card(3, 100), card(4, 400)],
    ]
    assert.deepEqual(
      stitchPlaces(two, {
        expectedShift: 900,
        reachedBottom: true,
        records: two.map(asRecords),
      }).offsets,
      [0, 900]
    )
    // Three pages: the chips stay put on every page, the last page shares no card.
    const three = [...two, [card(7, 100), card(8, 400)]]
    assert.deepEqual(
      stitchPlaces(three, {
        expectedShift: 900,
        reachedBottom: true,
        records: three.map(asRecords),
      }).offsets,
      [0, 900, 1800]
    )
  })

  // CodeRabbit on PR 230: a still header and a new label of the same id-less text on the last
  // page; only the header's copy is chrome, the label is new text with its own place.
  test('still chrome on the last page is one node, nearest its place', () => {
    const save = (y) => ({ id: '', text: 'Save', bounds: `[0,${y}][100,${y + 40}]` })
    const card = (n, y) => ({
      id: `c${n}`,
      text: `Card ${n}`,
      bounds: `[0,${y}][100,${y + 100}]`,
    })
    const pages = [
      [save(20), card(1, 100), card(2, 400), card(3, 700), card(4, 1000)],
      [save(20), card(3, 100), card(4, 400), card(5, 700), card(6, 1000)],
      [save(26), card(4, 200), card(5, 500), card(6, 800), save(1100)],
    ]
    const { taken, places } = stitchPlaces(pages, {
      expectedShift: 600,
      reachedBottom: true,
    })
    assert.equal(taken.filter(({ key }) => JSON.parse(key)[1] === 'Save').length, 2)
    assert.equal(places[2][0], places[0][0])
    assert.notEqual(places[2][4], places[0][0])
    assert.ok(places[2][4] >= 0)
  })

  // Android 6c85bbb4 Community, before 1.0 launch 005, pages 4 to 5: the viewport clamps every
  // shared box of the spotlight card (39 px tall on page 4, 26 on page 5), so no node measures
  // the step, and the drags before it were 847 px. Its probe records, never cut, moved 837.
  test('measures a step from the probe records when no node does', () => {
    const box = (id, text, bounds) => ({ id, text, bounds })
    const record = (text, rect) => ({ text, viewRect: rect })
    const pages = [
      [box('header', 'Header', '[44,1500][1036,1550]')],
      [
        box('header', 'Header', '[44,653][1036,703]'),
        box('', 'Partnered', '[103,1469][235,1508]'),
      ],
      [box('', 'Partnered', '[103,632][235,658]')],
    ]
    const records = [
      [record('Header', [44, 1500, 1036, 1550])],
      [
        record('Header', [44, 653, 1036, 703]),
        record('Partnered', [103, 1469, 235, 1508]),
      ],
      [
        record('Partnered', [103, 632, 235, 671]),
        record('Style Explorer 9BC8AA75', [103, 500, 600, 551]),
      ],
    ]
    // Fixed on every page, a sticky chip shifts by 0 and measures nothing.
    for (const list of records) list.push(record('Cold and wet', [695, 535, 900, 582]))
    records[1].push(record('Style Explorer 9BC8AA75', [103, 1337, 600, 1388]))
    assert.deepEqual(stitchPlaces(pages, { expectedShift: 840 }).offsets, [0, 847, 1694])
    assert.deepEqual(
      stitchPlaces(pages, { expectedShift: 840, records }).offsets,
      [0, 847, 1684]
    )
    // Without the drag's length the records measure nothing: they carry no chrome of their own.
    assert.deepEqual(
      stitchPlaces(pages, { records }).offsets,
      stitchPlaces(pages).offsets
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

  // Dispatch 43962043900, home leg: the simulator was set to 57% and its status bar read
  // "56% battery power"; 43924119388's community leg was set to 58% and failed the same way.
  // Simulator status bars keep the level as a fraction, and 0.57 * 100 is 56.99999999999999,
  // shown as 56. Every fingerprint takes a level that survives the round trip, in double and
  // single precision.
  test('every fingerprint takes a battery level the status bar shows as set', () => {
    const shown = (level) => [
      Math.floor((level / 100) * 100),
      Math.floor(Math.fround(Math.fround(level / 100) * 100)),
    ]
    for (let index = 0; index < 5000; index += 1) {
      const { battery } = deviceFingerprint(`${udidA}-${index}`)
      assert.deepEqual(shown(battery), [battery, battery], `battery ${battery}`)
    }
    assert.deepEqual(shown(57), [56, 57], 'the level dispatch 43962043900 set')
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

  // Dispatch 43924119388, community leg: the first read lacked only the battery part of the
  // fingerprint (cellular and Wi-Fi matched), and the message could not show what the status
  // bar did say.
  test('a wrong device names what the status bar showed', () => {
    const print = deviceFingerprint(udidA)
    const tree = dump('0.81.5', print)
    tree.children[1].children[0].children.pop()
    assert.throws(
      () => assertHierarchySource(tree, { platform: 'ios', fingerprint: print }),
      (error) =>
        error.message.startsWith(
          `live_font_hierarchy_wrong_device:${print.battery}% battery power seen `
        ) && error.message.includes('of 3 Wi-Fi bars')
    )
  })

  test('a missing marker is read again, a wrong device or build fails at once', () => {
    const print = deviceFingerprint(udidA)
    const good = dump('0.81.5', print)
    const bare = dump('0.81.5', print)
    bare.children[0].children = []
    const check = (tree) =>
      assertHierarchySource(tree, {
        platform: 'ios',
        fingerprint: print,
        reactNativeVersion: '0.81.5',
      })
    const reads = (trees) => {
      const queue = [...trees]
      const seen = []
      return {
        read: () => queue.shift(),
        onRetry: (error) => seen.push(error.message),
        seen,
      }
    }
    const marker = reads([bare, good])
    assert.equal(readCheckedHierarchy({ ...marker, check }), good)
    assert.deepEqual(marker.seen, ['live_font_hierarchy_wrong_build:missing'])
    const stillBare = reads([bare, bare, bare, good])
    assert.throws(() => readCheckedHierarchy({ ...stillBare, check }), {
      message: 'live_font_hierarchy_wrong_build:missing',
    })
    assert.equal(stillBare.seen.length, 2)
    const other = reads([dump('0.81.5', deviceFingerprint(udidB)), good])
    assert.throws(() => readCheckedHierarchy({ ...other, check }), {
      message: /^live_font_hierarchy_wrong_device/,
    })
    const build = reads([dump('0.88.1', print), good])
    assert.throws(() => readCheckedHierarchy({ ...build, check }), {
      message: 'live_font_hierarchy_wrong_build:0.88.1',
    })
    assert.deepEqual([other.seen, build.seen], [[], []])
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

// Antigravity handover R1 (P3): a skipped copy with no id hands its descendants the element it
// repeats, so a deeper copy carrying that element's id is skipped too.
test('iOS skips a deeper copy with the labelled id below a skipped copy without one', () => {
  const tree = node({ bounds: '[0,0][0,0]' }, [
    node({ accessibilityText: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
      node(
        {
          accessibilityText: 'Premium',
          bounds: '[34,753][367,772]',
          'resource-id': 'settings-premium-title',
        },
        [
          node({ accessibilityText: 'Premium', bounds: '[34,753][367,772]' }, [
            node({
              accessibilityText: 'Premium',
              bounds: '[34,753][367,772]',
              'resource-id': 'settings-premium-title',
            }),
          ]),
        ]
      ),
    ]),
  ])
  assert.deepEqual(
    flattenHierarchy(tree, { platform: 'ios' }).nodes.map((entry) => [
      entry.id,
      entry.text,
    ]),
    [
      ['', 'CoutureCast Story68'],
      ['settings-premium-title', 'Premium'],
    ]
  )
})

// iOS 9adc0d1a, Community: the card image carries its testID on an element inside an id-less
// element with the same alt text and bounds. Kept as two nodes, a record either could take tied
// between them (live_font_text_probe_ambiguous); it is one element, kept once with the testID.
test('iOS keeps an element repeated inside an id-less copy once, with the inner testID', () => {
  const card = (inner) =>
    node({ bounds: '[0,0][0,0]' }, [
      node({ accessibilityText: 'CoutureCast Story68', bounds: '[0,0][402,874]' }, [
        node(
          {
            'resource-id': 'community-card-open-seed-spotlight-1',
            bounds: '[17,721][325,1029]',
          },
          [
            node(
              {
                accessibilityText: 'Spotlight look 1 styled for the season',
                bounds: '[17,721][325,1029]',
              },
              [
                node({
                  accessibilityText: 'Spotlight look 1 styled for the season',
                  bounds: '[17,721][325,1029]',
                  'resource-id': inner,
                }),
              ]
            ),
          ]
        ),
      ]),
    ])
  const flat = flattenHierarchy(card('community-card-image-seed-spotlight-1'), {
    platform: 'ios',
  })
  assert.deepEqual(
    flat.nodes.map((entry) => [entry.id, entry.text]),
    [
      ['', 'CoutureCast Story68'],
      ['community-card-image-seed-spotlight-1', 'Spotlight look 1 styled for the season'],
    ]
  )
  assert.deepEqual(
    flat.controls.map((control) => control.id),
    ['community-card-open-seed-spotlight-1', 'community-card-image-seed-spotlight-1']
  )
  // Two different testIDs are two elements, whatever their label.
  const twoIds = node({ bounds: '[0,0][0,0]' }, [
    node({ accessibilityText: 'X', bounds: '[0,0][10,10]', 'resource-id': 'outer' }, [
      node({ accessibilityText: 'X', bounds: '[0,0][10,10]', 'resource-id': 'inner' }),
    ]),
  ])
  assert.deepEqual(
    flattenHierarchy(twoIds, { platform: 'ios' }).nodes.map((entry) => entry.id),
    ['outer', 'inner']
  )
})

test('missingMounts names the required scopes no marker carries', () => {
  const markers = ['live-font-mount-root-r1', 'live-font-mount-settings-s1']
  assert.deepEqual(missingMounts(markers, ['root', 'settings']), [])
  assert.deepEqual(missingMounts(markers, ['root', 'modal']), ['modal'])
  assert.deepEqual(missingMounts([], ['root']), ['root'])
})

test('readWithMounts rereads a dump that drops a required marker, three reads at most', () => {
  const reads = (lists) => {
    let index = 0
    const read = () => ({ markers: lists[Math.min(index++, lists.length - 1)] })
    return { read, count: () => index }
  }
  const whole = ['live-font-mount-root-r1', 'live-font-mount-settings-s1']
  const dropped = ['live-font-mount-root-r1']
  const second = reads([dropped, whole])
  assert.deepEqual(readWithMounts(second.read, ['root', 'settings']).markers, whole)
  assert.equal(second.count(), 2)
  const never = reads([dropped])
  assert.deepEqual(readWithMounts(never.read, ['root', 'settings']).markers, dropped)
  assert.equal(never.count(), 3)
  const first = reads([whole])
  readWithMounts(first.read, ['root', 'settings'])
  assert.equal(first.count(), 1)
})

test('widenMounts adds every scope the markers carry, once', () => {
  const markers = ['live-font-mount-home-h1', 'live-font-mount-root-r1', 'other-id']
  assert.deepEqual(mountScopes(markers), ['home', 'root'])
  assert.deepEqual(widenMounts(['root', 'settings'], markers), [
    'root',
    'settings',
    'home',
  ])
  assert.deepEqual(widenMounts(['root'], []), ['root'])
})

test('mountTracker widens after a before capture and resets at each launch', () => {
  const tracker = mountTracker(['root', 'settings'])
  const before = ['live-font-mount-home-h1', 'live-font-mount-root-r1']
  tracker.captured('cold', before)
  assert.deepEqual(tracker.scopes(), ['root', 'settings'])
  tracker.captured('before', before)
  assert.deepEqual(tracker.scopes(), ['root', 'settings', 'home'])
  // A later before read that drops Home keeps it: the settle's reads only add scopes.
  tracker.captured('before', ['live-font-mount-root-r1'])
  assert.deepEqual(tracker.scopes(), ['root', 'settings', 'home'])
  tracker.captured('settled', ['live-font-mount-modal-m1'])
  assert.deepEqual(tracker.scopes(), ['root', 'settings', 'home'])
  tracker.launched()
  assert.deepEqual(tracker.scopes(), ['root', 'settings'])
})

// Antigravity handover r4 (P3): the settle's own reads widen the tracker, so a Home marker the
// first read shows and every later read drops is still reread for by the capture.
describe('settleCapture', () => {
  const clock = () => {
    let time = 0
    return { now: () => time, pause: async (ms) => void (time += ms) }
  }
  const nodes = [{ id: 'title', text: 'Settings', bounds: '[0,0][100,20]' }]
  const home = [
    'live-font-mount-home-h1',
    'live-font-mount-root-r1',
    'live-font-mount-settings-s1',
  ]
  const dropped = ['live-font-mount-root-r1', 'live-font-mount-settings-s1']

  test('a scope only the first settle read showed is reread for by the capture', async () => {
    const mounts = mountTracker(['root', 'settings'])
    const settleReads = [home, dropped, dropped, dropped, dropped]
    let index = 0
    const read = () => ({
      nodes,
      markers: settleReads[Math.min(index++, settleReads.length - 1)],
    })
    const captureReads = [dropped, home]
    let captureIndex = 0
    const { now, pause } = clock()
    const captured = await settleCapture({
      read,
      capture: () =>
        readWithMounts(
          () => ({ markers: captureReads[captureIndex++] }),
          mounts.scopes()
        ),
      mounts,
      stage: 'before',
      pause,
      now,
      deadlineError: 'deadline',
    })
    assert.deepEqual(mounts.scopes(), ['root', 'settings', 'home'])
    assert.equal(captureIndex, 2, 'the capture reread once for home')
    assert.deepEqual(captured.markers, home)
  })

  test('only a before settle widens, and the capture waits for a stable layout', async () => {
    const mounts = mountTracker(['root', 'settings'])
    const layouts = [[], nodes, nodes, nodes, nodes]
    let index = 0
    const read = () => ({
      nodes: layouts[Math.min(index++, layouts.length - 1)],
      markers: home,
    })
    const { now, pause } = clock()
    let at
    await settleCapture({
      read,
      capture: () => (at = now()),
      mounts,
      stage: 'settled',
      pause,
      now,
      deadlineError: 'deadline',
    })
    assert.deepEqual(mounts.scopes(), ['root', 'settings'])
    // Changed at 500 ms, identical at 1000 and 1500 ms: stable for 1000 ms at 1500 ms.
    assert.equal(at, 1500)
  })

  test('a screen that never settles throws the deadline error', async () => {
    let index = 0
    const read = () => ({
      nodes: [{ id: 'n', text: String(index++), bounds: '[0,0][1,1]' }],
      markers: [],
    })
    const { now, pause } = clock()
    await assert.rejects(
      settleCapture({
        read,
        capture: () => assert.fail('no capture'),
        mounts: mountTracker(['root']),
        stage: 'before',
        pause,
        now,
        deadlineError: 'live_font_stable_state_deadline:home:before',
      }),
      { message: 'live_font_stable_state_deadline:home:before' }
    )
  })
})

// TEA, 2026-11-13: residual keys hold time labels, so every run captures in one timezone.
describe('runTimezone', () => {
  /** A fake adb whose `persist.sys.timezone` is `zone` and moves with set-timezone unless `stuck`. */
  const fakeAdb = (zone, { stuck, failOn } = {}) => {
    const calls = []
    const adb = (...args) => {
      calls.push(args.join(' '))
      if (failOn && args.includes(failOn))
        throw new Error('live_font_command_failed:adb shell cmd alarm:1:')
      if (args[1] === 'cmd') {
        if (!stuck) zone = args.at(-1)
        return ''
      }
      if (args[1] === 'getprop') return `${zone}\n`
      throw new Error(`unexpected ${args.join(' ')}`)
    }
    return { adb, calls }
  }

  test('Android pins the timezone of the approved runs by default and reads it back', () => {
    assert.equal(LIVE_FONT_TIMEZONE, 'America/Chicago')
    const { adb, calls } = fakeAdb('GMT')
    assert.deepEqual(runTimezone({ platform: 'android', adb }), {
      timezone: 'America/Chicago',
      previous: 'GMT',
    })
    assert.deepEqual(calls, [
      'shell getprop persist.sys.timezone',
      'shell cmd alarm set-timezone America/Chicago',
      'shell getprop persist.sys.timezone',
    ])
    const requested = fakeAdb('America/Chicago')
    assert.deepEqual(
      runTimezone({
        platform: 'android',
        requested: 'Europe/Istanbul',
        adb: requested.adb,
      }),
      { timezone: 'Europe/Istanbul', previous: 'America/Chicago' }
    )
  })

  test('Android fails when the readback differs or adb fails', () => {
    assert.throws(
      () =>
        runTimezone({ platform: 'android', adb: fakeAdb('GMT', { stuck: true }).adb }),
      (error) =>
        error.code === 'live_font_timezone_pin_failed' &&
        error.message === 'live_font_timezone_pin_failed:America/Chicago set, GMT read'
    )
    assert.throws(
      () => runTimezone({ platform: 'android', adb: fakeAdb('', { stuck: true }).adb }),
      { message: 'live_font_timezone_pin_failed:America/Chicago set, nothing read' }
    )
    assert.throws(
      () =>
        runTimezone({ platform: 'android', adb: fakeAdb('GMT', { failOn: 'cmd' }).adb }),
      (error) =>
        error.code === 'live_font_timezone_pin_failed' &&
        /^live_font_timezone_pin_failed:America\/Chicago: live_font_command_failed/.test(
          error.message
        )
    )
  })

  // Antigravity r30 item 3: the timezone to put back is known before the device changes, so a
  // pin that fails after the change still restores it.
  test('Android hands over the previous timezone before it changes the device', () => {
    for (const options of [{}, { stuck: true }, { failOn: 'cmd' }]) {
      const { adb, calls } = fakeAdb('GMT', options)
      const heard = []
      const pin = () =>
        runTimezone({
          platform: 'android',
          adb,
          onPrevious: (previous) => heard.push([previous, calls.length]),
        })
      if (options.stuck || options.failOn)
        assert.throws(pin, { code: 'live_font_timezone_pin_failed' })
      else pin()
      // Heard once, after the first getprop and before set-timezone.
      assert.deepEqual(heard, [['GMT', 1]], JSON.stringify(options))
    }
  })

  test('iOS records the host timezone and refuses any other, touching no device', () => {
    const adb = () => assert.fail('iOS runs no adb')
    assert.deepEqual(
      runTimezone({ platform: 'ios', hostTimezone: 'America/Chicago', adb }),
      {
        timezone: 'America/Chicago',
      }
    )
    assert.deepEqual(
      runTimezone({
        platform: 'ios',
        requested: 'America/Chicago',
        hostTimezone: 'America/Chicago',
        adb,
      }),
      { timezone: 'America/Chicago' }
    )
    assert.throws(
      () =>
        runTimezone({
          platform: 'ios',
          requested: 'Europe/Istanbul',
          hostTimezone: 'America/Chicago',
          adb,
        }),
      { code: 'live_font_timezone_pin_failed' }
    )
    assert.throws(() => runTimezone({ platform: 'ios', adb }), {
      message: 'live_font_timezone_pin_failed:host timezone unknown',
    })
  })
})
