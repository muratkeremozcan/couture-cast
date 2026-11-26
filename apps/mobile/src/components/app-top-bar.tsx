// Story CC-7.9 D6 owner: the one native top bar, the header of the tab navigator and of every
// root stack screen that shows one.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { router, type Href } from 'expo-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTokens } from '@/src/theme/tokens'

export interface AppTopBarProps {
  title: string
  /** Shows the back control; omitted on a tab root. */
  onBack?: () => void
  /** Replaces the plain title text (the share card focus heading registers itself this way). */
  titleNode?: ReactNode
  trailing?: ReactNode
}

/**
 * D6: 56 pt plus the top safe-area inset, one row: optional back, the title (header role) and an
 * optional trailing slot, on the `page` surface with a `line` rule below.
 */
export function AppTopBar({ title, onBack, titleNode, trailing }: AppTopBarProps) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { colors, shell, space, type, fontWeight } = useTokens()
  const backLabel = t('shell.back')

  return (
    <View
      testID="app-top-bar"
      style={[
        styles.bar,
        {
          height: shell.topBarHeight + insets.top,
          paddingTop: insets.top,
          paddingHorizontal: space[2],
          backgroundColor: colors.page,
          borderBottomColor: colors.line,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          testID="app-top-bar-back"
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          hitSlop={space[1]}
          style={[
            styles.back,
            { minHeight: shell.touchTarget, minWidth: shell.touchTarget, gap: space[1] },
          ]}
        >
          <FontAwesome name="chevron-left" size={type.base.fontSize} color={colors.ink} />
          <Text
            style={{
              color: colors.ink,
              fontSize: type.sm.fontSize,
              fontWeight: fontWeight.medium,
            }}
          >
            {backLabel}
          </Text>
        </Pressable>
      ) : null}
      <View style={[styles.title, { paddingHorizontal: space[2] }]}>
        {titleNode ?? (
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              color: colors.ink,
              fontSize: type.lg.fontSize,
              lineHeight: type.lg.lineHeight,
              fontWeight: fontWeight.semibold,
            }}
          >
            {title}
          </Text>
        )}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  )
}

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
const PARENT_TAB: Readonly<Record<string, Href>> = {
  'wardrobe-capsules': '/wardrobe',
  locations: '/settings',
  'notification-settings': '/settings',
  'palette-advisor': '/settings',
  planner: '/settings',
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
    focus: () => {
      const firstFocus = !seenTabAnchors.has(route.key)
      seenTabAnchors.add(route.key)
      const parent = coldLinkParents.get(route.key)
      coldLinkParents.delete(route.key)
      if (firstFocus && parent !== undefined) router.navigate(parent)
    },
  }
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
  const goBack = () => {
    if (props.back !== undefined && hasCallerBelow(props)) props.navigation.goBack()
    else router.replace(parent)
  }
  return (
    <NavigatorTopBar {...props} navigation={{ ...props.navigation, goBack }} showBack />
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
})
