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
  route: { name: string }
  navigation: { goBack: () => void; canGoBack: () => boolean }
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
 * screen) that has nothing below it to go back to.
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

/** The root stack's `header`: the screen title and a back control to the screen below it. */
export function renderStackTopBar(props: NavigatorHeaderProps) {
  if (props.options.headerBackVisible === false) {
    return <NavigatorTopBar {...props} showBack={false} />
  }
  if (props.back !== undefined) return <NavigatorTopBar {...props} showBack />
  const parent = PARENT_TAB[props.route.name] ?? '/'
  return (
    <NavigatorTopBar
      {...props}
      navigation={{ ...props.navigation, goBack: () => router.replace(parent) }}
      showBack
    />
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
