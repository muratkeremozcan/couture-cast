// Story CC-7.11 D2 owner: the one tab icon set. Web draws these paths as inline `<svg>`, native
// through react-native-svg; both stroke them in the label color, so emoji and FontAwesome leave
// the tab bars.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import type { AppTabId } from './app-tabs'

/** Every icon is a 24 x 24 outline drawn with a round 2 px stroke and no fill. */
export const TAB_ICON_VIEWBOX = '0 0 24 24'
export const TAB_ICON_SIZE = 24
export const TAB_ICON_STROKE_WIDTH = 2

/**
 * One outline path set per tab: Today a sun, Closet a hanger, Looks layered cards, Community two
 * people, Profile a person.
 */
export const TAB_ICON_PATHS: Readonly<Record<AppTabId, readonly string[]>> = {
  home: [
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
    'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
  ],
  wardrobe: [
    'M10 5a2 2 0 1 1 2 2v1.5',
    'M12 8.5l-8.4 6.5a1.2 1.2 0 0 0 .7 2.1h15.4a1.2 1.2 0 0 0 .7-2.1z',
  ],
  looks: [
    'M5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
    'M7 3h12a2 2 0 0 1 2 2v12',
  ],
  community: [
    'M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6z',
    'M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1',
    'M16 5.13a3 3 0 0 1 0 5.74',
    'M21 20v-1a5 5 0 0 0-3.5-4.77',
  ],
  settings: [
    'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z',
    'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  ],
}
