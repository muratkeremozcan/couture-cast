// Story CC-7.11 D1, D2 owner: the one tab definition web and native read, so a sixth tab or a
// rename touches this file only.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern

/**
 * A tab's id. Ids and routes predate the five-tab labels (UX review rule 5): `home` reads Today,
 * `wardrobe` reads Closet and `settings` reads Profile, so every route and test id stays.
 */
export type AppTabId = 'home' | 'wardrobe' | 'looks' | 'community' | 'settings'

/** The catalog leaf of a tab's label: web reads `nav.<key>`, native `tabs.<key>`. */
export type AppTabLabelKey = 'today' | 'closet' | 'looks' | 'community' | 'profile'

export interface AppTab {
  id: AppTabId
  /** The English name analytics records, whatever the reader's language. */
  label: string
  labelKey: AppTabLabelKey
  /** The web route. */
  webHref: string
  /** The native Expo Router path of the tab screen. */
  nativeHref: string
  /** The native file name under `app/(tabs)`. */
  nativeRoute: string
  /** The web desktop top bar link test id; the bottom bar uses `bottom-nav-<id>`. */
  desktopTestId: string
}

/** D1: Today, Closet, Looks, Community, Profile, in this order on both platforms. */
export const APP_TABS: readonly AppTab[] = [
  {
    id: 'home',
    label: 'Today',
    labelKey: 'today',
    webHref: '/',
    nativeHref: '/',
    nativeRoute: 'index',
    desktopTestId: 'nav-ritual',
  },
  {
    id: 'wardrobe',
    label: 'Closet',
    labelKey: 'closet',
    webHref: '/wardrobe',
    nativeHref: '/wardrobe',
    nativeRoute: 'wardrobe',
    desktopTestId: 'nav-wardrobe',
  },
  {
    id: 'looks',
    label: 'Looks',
    labelKey: 'looks',
    webHref: '/looks',
    nativeHref: '/looks',
    nativeRoute: 'looks',
    desktopTestId: 'nav-looks',
  },
  {
    id: 'community',
    label: 'Community',
    labelKey: 'community',
    webHref: '/community',
    nativeHref: '/community',
    nativeRoute: 'community',
    desktopTestId: 'nav-community',
  },
  {
    id: 'settings',
    label: 'Profile',
    labelKey: 'profile',
    webHref: '/settings',
    nativeHref: '/settings',
    nativeRoute: 'settings',
    desktopTestId: 'nav-profile',
  },
]

/** The tab with this id. Every id has a tab, so this never returns undefined. */
export function appTab(id: AppTabId): AppTab {
  return APP_TABS.find((tab) => tab.id === id) as AppTab
}
