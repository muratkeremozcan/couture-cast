// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): a tab navigator double for `useNavigation()`. The Closet hub
// puts Add and More in its tab's top bar through `navigation.setOptions({ headerRight })`
// (spec D4), so a suite that renders the hub outside a navigator renders `TabTopBar` beside it:
// the real `renderTabTopBar` with the options the screen set, as the tab navigator merges them.
//
// Use it like `focus-effect.ts`: the expo-router mock factory returns
// `useNavigation: (await import('<path>/test-utils/tab-navigation-store.js')).useTabNavigation`,
// and the suite imports `TabTopBar` and `tabNavigation` from '@/src/test-utils/tab-navigation'.
// The factory must load the store, never this module: this one imports AppTopBar, which imports
// expo-router, the module the factory is still building.
// AppTopBar imports `@expo/vector-icons/FontAwesome`, so the suite mocks that module too.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { useSyncExternalStore, type ReactNode } from 'react'
import { renderTabTopBar } from '@/src/components/app-top-bar'
import { currentTabOptions, subscribeTabOptions } from './tab-navigation-store'

export { tabNavigation, useTabNavigation } from './tab-navigation-store'

/**
 * The tab's top bar as the navigator draws it: `renderTabTopBar` with the layout's `title` under
 * the options the screen set (headerRight included). A tab root has no back.
 */
export function TabTopBar({ title, route }: { title: string; route: string }): ReactNode {
  const options = useSyncExternalStore(subscribeTabOptions, currentTabOptions)
  return renderTabTopBar({
    options: { title, ...options },
    route: { key: `${route}-tab`, name: route },
    navigation: {
      goBack: () => undefined,
      canGoBack: () => false,
      getState: () => ({ routes: [] }),
    },
  })
}
