// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-UNIT-001..003, the one tab definition and the one icon
// set that web (sticky-bottom-nav, app-top-bar) and native (app/(tabs)/_layout.tsx) read.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { describe, expect, it } from 'vitest'
import { APP_TABS, appTab, type AppTabId } from './app-tabs'
import {
  TAB_ICON_PATHS,
  TAB_ICON_SIZE,
  TAB_ICON_STROKE_WIDTH,
  TAB_ICON_VIEWBOX,
} from './tab-icons'
import * as utils from './index'

const IDS: AppTabId[] = ['home', 'wardrobe', 'looks', 'community', 'settings']

describe('7.11-UNIT-001 tab order and web routes (AC1, D1)', () => {
  it('lists Today, Closet, Looks, Community, Profile in that order', () => {
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
      'Today',
      'Closet',
      'Looks',
      'Community',
      'Profile',
    ])
    expect(APP_TABS.map((tab) => tab.labelKey)).toEqual([
      'today',
      'closet',
      'looks',
      'community',
      'profile',
    ])
  })

  it('keeps the pre-7.11 ids, routes and desktop test ids and adds Looks (D1)', () => {
    expect(APP_TABS.map((tab) => [tab.id, tab.webHref, tab.desktopTestId])).toEqual([
      ['home', '/', 'nav-ritual'],
      ['wardrobe', '/wardrobe', 'nav-wardrobe'],
      ['looks', '/looks', 'nav-looks'],
      ['community', '/community', 'nav-community'],
      ['settings', '/settings', 'nav-profile'],
    ])
  })

  it('labels are sentence case: one capital, then lower case', () => {
    for (const tab of APP_TABS) {
      expect(tab.label, tab.id).toMatch(/^[A-Z][a-z]+$/)
    }
  })
})

describe('7.11-UNIT-002 native routes and keys (AC1, D1, D15)', () => {
  it('maps every tab to its app/(tabs) file and Expo Router path', () => {
    expect(APP_TABS.map((tab) => [tab.id, tab.nativeRoute, tab.nativeHref])).toEqual([
      ['home', 'index', '/'],
      ['wardrobe', 'wardrobe', '/wardrobe'],
      ['looks', 'looks', '/looks'],
      ['community', 'community', '/community'],
      ['settings', 'settings', '/settings'],
    ])
  })

  it('ids, label keys, routes and test ids are unique', () => {
    for (const field of [
      'id',
      'labelKey',
      'webHref',
      'nativeRoute',
      'desktopTestId',
    ] as const) {
      const values = APP_TABS.map((tab) => tab[field])
      expect(new Set(values).size, field).toBe(APP_TABS.length)
    }
  })

  it('appTab returns the tab for each id', () => {
    for (const id of IDS) {
      expect(appTab(id).id).toBe(id)
    }
    expect(appTab('looks')).toBe(APP_TABS[2])
  })

  it('the package index exports the list, the lookup and the icon set', () => {
    expect(utils.APP_TABS).toBe(APP_TABS)
    expect(utils.appTab).toBe(appTab)
    expect(utils.TAB_ICON_PATHS).toBe(TAB_ICON_PATHS)
  })
})

describe('7.11-UNIT-003 one outline icon set (AC1, D2)', () => {
  it('has exactly one path set per tab and nothing else', () => {
    expect(Object.keys(TAB_ICON_PATHS).sort()).toEqual([...IDS].sort())
  })

  it('draws on a 24 x 24 grid with a 2 px stroke', () => {
    expect(TAB_ICON_VIEWBOX).toBe('0 0 24 24')
    expect(TAB_ICON_SIZE).toBe(24)
    expect(TAB_ICON_STROKE_WIDTH).toBe(2)
  })

  it('every path is a well-formed absolute-start path with no color or markup baked in', () => {
    for (const id of IDS) {
      const paths = TAB_ICON_PATHS[id]
      expect(paths.length, id).toBeGreaterThan(0)
      for (const d of paths) {
        expect(d, id).toMatch(/^M[\d.\s-]/)
        // Path data only: command letters, numbers, separators. A color, url() or tag would
        // break the "icon color follows the label color" rule.
        expect(d, id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/)
      }
    }
  })

  it('no two tabs share an icon', () => {
    const joined = IDS.map((id) => TAB_ICON_PATHS[id].join(' '))
    expect(new Set(joined).size).toBe(IDS.length)
  })

  it('absolute move-to points stay on the 24 x 24 grid', () => {
    for (const id of IDS) {
      for (const d of TAB_ICON_PATHS[id]) {
        for (const match of d.matchAll(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
          const [x, y] = [Number(match[1]), Number(match[2])]
          expect(x, `${id} ${d}`).toBeGreaterThanOrEqual(0)
          expect(x, `${id} ${d}`).toBeLessThanOrEqual(24)
          expect(y, `${id} ${d}`).toBeGreaterThanOrEqual(0)
          expect(y, `${id} ${d}`).toBeLessThanOrEqual(24)
        }
      }
    }
  })
})
