// Story CC-7.9 D6 owner: the one native top bar, the header of the tab navigator and of every
// root stack screen that shows one.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.11 D10 to D12: the parent tab of every sub-screen (PARENT_TAB), and the same bar as
// the header of the full-height layers (saved look and post detail) with back and their title.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { router, type Href } from 'expo-router'
import type { ReactNode } from 'react'
import { useTokens } from '@/src/theme/tokens'
import { AppTopBar } from './app-top-bar-view'

export { AppTopBar, type AppTopBarProps } from './app-top-bar-view'

type HeaderTitleOption =
  | string
  | ((props: { children: string; tintColor?: string }) => ReactNode)
  | undefined

interface NavigatorHeaderProps {
  options: {
    title?: string
    headerTitle?: HeaderTitleOption
    headerRight?: (props: { tintColor?: string; canGoBack: boolean }) => ReactNode
    headerBackVisible?: boolean
  }
  route: { key: string; name: string }
  navigation: {
    goBack: () => void
    canGoBack: () => boolean
    getState: () => { routes: readonly { key: string; name: string }[] }
  }
  back?: unknown
}

function NavigatorTopBar({
  options,
  route,
  navigation,
  showBack,
}: NavigatorHeaderProps & { showBack: boolean }) {
  const { colors } = useTokens()
  const title =
    typeof options.headerTitle === 'string'
      ? options.headerTitle
      : (options.title ?? route.name)
  const titleNode =
    typeof options.headerTitle === 'function'
      ? options.headerTitle({ children: title, tintColor: colors.ink })
      : undefined
  const trailing = options.headerRight?.({
    tintColor: colors.ink,
    canGoBack: navigation.canGoBack(),
  })
  return (
    <AppTopBar
      title={title}
      titleNode={titleNode}
      trailing={trailing}
      onBack={showBack ? () => navigation.goBack() : undefined}
    />
  )
}

/** The tab navigator's `header`: the tab label as title, no back on a tab root. */
export function renderTabTopBar(props: NavigatorHeaderProps) {
  return <NavigatorTopBar {...props} showBack={false} />
}

/**
 * The parent tab of each root stack screen, for a direct entry (a deep link or a cold start on the
 * screen) that has no caller below it to go back to.
 */
export const PARENT_TAB: Readonly<Record<string, Href>> = {
  // Story CC-7.11 D10: Capsules and Plan live under Looks; Style under Profile.
  'wardrobe-capsules': '/looks',
  // Story CC-7.12 D5: a saved look's direct entry goes back to Looks on Saved.
  'saved-look/[savedLookId]': { pathname: '/looks', params: { segment: 'saved' } },
  locations: '/settings',
  'notification-settings': '/settings',
  'palette-advisor': '/settings',
  planner: '/looks',
  'settings-style': '/settings',
  'wardrobe-garment': '/wardrobe',
  'wardrobe-onboarding': '/wardrobe',
  'wardrobe-silhouette': '/wardrobe',
  'guardian-dashboard': '/settings',
  'teen-dashboard': '/settings',
}

/** The root stack route of the tab group, the `unstable_settings.initialRouteName` anchor. */
const TABS_ANCHOR = '(tabs)'

/**
 * Root stack keys of tab group routes the member has had in front. A cold deep link makes Expo
 * Router insert the tab group below the linked screen as its initial route, mounted on Home and
 * never focused, and pass `back` for it; such an anchor is no caller to return to.
 */
const seenTabAnchors = new Set<string>()

/**
 * The parent tab owed to an unseen anchor: a cold-linked screen above it records its parent, so
 * a pop that bypasses the top bar (Android hardware back, the iOS swipe, any `goBack()`) still
 * lands on that tab when the anchor comes to the front for the first time.
 */
const coldLinkParents = new Map<string, Href>()

/**
 * The root stack `listeners` of the tab group screen. On focus it marks its anchor as seen, and
 * on the first focus of an anchor a cold link inserted it switches the tab group to the parent
 * tab of the screen that was popped; a real caller's anchor was already seen and keeps its tab.
 */
export function tabsAnchorListeners({ route }: { route: { key: string } }) {
  return {
    // A screen pushed over the tab group blurs it, so a real caller's anchor counts as seen even
    // when its first focus reached no listener (an Android launch delivered none: Home, Add
    // location, Save then landed on Profile).
    blur: () => {
      seenTabAnchors.add(route.key)
      coldLinkParents.delete(route.key)
    },
    focus: () => {
      const firstFocus = !seenTabAnchors.has(route.key)
      seenTabAnchors.add(route.key)
      const parent = coldLinkParents.get(route.key)
      coldLinkParents.delete(route.key)
      if (firstFocus && parent !== undefined) router.navigate(parent)
    },
  }
}

/** Test seam: forget which anchors were seen, as a launch whose first focus went unheard. */
export function forgetSeenTabAnchorsForTesting() {
  seenTabAnchors.clear()
  coldLinkParents.clear()
}

/** The route right below this one in the root stack, if any. */
function routeBelow({ navigation, route }: NavigatorHeaderProps) {
  const { routes } = navigation.getState()
  return routes[routes.findIndex((entry) => entry.key === route.key) - 1]
}

/** Whether the route below this one is a caller the member came from. */
function hasCallerBelow(props: NavigatorHeaderProps) {
  const below = routeBelow(props)
  if (below === undefined) return false
  return below.name !== TABS_ANCHOR || seenTabAnchors.has(below.key)
}

/**
 * The root stack's `header`: the screen title and a back control to the caller below it, or to
 * the parent tab on a direct entry.
 */
export function renderStackTopBar(props: NavigatorHeaderProps) {
  if (props.options.headerBackVisible === false) {
    return <NavigatorTopBar {...props} showBack={false} />
  }
  const parent = PARENT_TAB[props.route.name] ?? '/'
  const below = routeBelow(props)
  if (below?.name === TABS_ANCHOR && !seenTabAnchors.has(below.key))
    coldLinkParents.set(below.key, parent)
  // Story CC-7.12 (TEA T4): a saved look opened by View (no `from`) returns to Looks Saved, not
  // to the screen that saved it; a Saved tile's entry goes back to its caller as usual.
  const viewEntry =
    props.route.name === 'saved-look/[savedLookId]' &&
    !(props.route as { params?: { from?: string } }).params?.from
  const goBack = () => {
    if (viewEntry) router.dismissTo(parent)
    else if (props.back !== undefined && hasCallerBelow(props)) props.navigation.goBack()
    else router.replace(parent)
  }
  return (
    <NavigatorTopBar {...props} navigation={{ ...props.navigation, goBack }} showBack />
  )
}
