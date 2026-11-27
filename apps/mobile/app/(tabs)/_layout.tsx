// Story CC-7.11 D1 to D3 owner: the five tabs (Today, Closet, Looks, Community, Profile) from the
// one `@couture/utils` tab definition, with the shared outline icons.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import React, { useEffect } from 'react'
import { useAndroidNavigationIntent } from '@/components/android-share-card-presentation'
import {
  DEFAULT_MOBILE_TAB_BAR_HEIGHT,
  setMobileTabBarHeight,
} from '@/components/save-feedback'
import { ShareCardTabHeading } from '@/components/share-card-tab-heading'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { APP_TABS, type AppTab, type AppTabId } from '@couture/utils'
import { Link, Tabs } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { renderTabTopBar } from '@/src/components/app-top-bar'
import { useTokens } from '@/src/theme/tokens'
import { useClientOnlyValue } from '@/components/use-client-only-value'
import { TabBarLabel, useTabBarSizing } from '@/components/tab-bar-label'
import { TabIcon } from '@/components/tab-bar-icon'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

/** A tab screen's options object (Tabs.Screen also takes a function form). */
type TabScreenOptions = Exclude<
  NonNullable<React.ComponentProps<typeof Tabs.Screen>['options']>,
  (...args: never[]) => unknown
>
/** What a tab adds to the shared options: its own heading or top bar actions. */
type TabExtraOptions = Pick<TabScreenOptions, 'headerTitle' | 'headerRight'>

/**
 * Story CC-7.11 D2, D3: the shared outline icon in the label color, and the underline that marks
 * the active tab with the gold and the semibold label, so the state never relies on color alone.
 */
function TabBarIcon(props: {
  color: string
  focused: boolean
  tabId: AppTabId
  /** How far the underline drops below the icon as the bar grows (useTabBarSizing). */
  growth: number
}) {
  const { focused, tabId, growth, color } = props

  return (
    <View style={styles.iconContainer}>
      <View style={styles.icon}>
        <TabIcon tabId={tabId} color={color} />
      </View>
      {focused && (
        <View
          // The bar grows upward with its labels and the icon with it, so the underline drops
          // by the same amount to stay on the bar's bottom edge, below the label.
          style={[
            styles.activeIndicator,
            { backgroundColor: color, bottom: INDICATOR_BOTTOM - growth },
          ]}
          testID={`tab-${tabId}-active-indicator`}
        />
      )}
    </View>
  )
}

/**
 * The tab buttons' test ids, spelled out so flows and their static checks find each one in the
 * source (scripts/lib/test-store-runner.test.mjs). Story CC-7.11 D1: the routes' old ids stay.
 */
const TAB_TEST_IDS: Record<AppTabId, string> = {
  home: 'tab-home',
  wardrobe: 'tab-wardrobe',
  looks: 'tab-looks',
  community: 'tab-community',
  settings: 'tab-settings',
}

export default function TabLayout() {
  const navigationIntent = useAndroidNavigationIntent()
  const { colors, shell } = useTokens()
  const insets = useSafeAreaInsets()
  const analytics = useMobileAnalytics()
  const { t } = useTranslation()
  // Story 6.15 F-00i: each label reports its height and the bar grows by what the text grew.
  const { growth, indicatorDrop, onLabelHeight, tallestLabel } = useTabBarSizing()
  useEffect(() => {
    setMobileTabBarHeight(DEFAULT_MOBILE_TAB_BAR_HEIGHT + growth)
    return () => {
      setMobileTabBarHeight(DEFAULT_MOBILE_TAB_BAR_HEIGHT)
    }
  }, [growth])
  // Story CC-7.11 D1: the five tabs and their order come from the one shared tab definition.
  const tabLabel = (tab: AppTab) => t(`tabs.${tab.labelKey}`, { defaultValue: tab.label })

  const trackTabPress = (tabId: string, label: string, targetPath: string) => {
    navigationIntent(targetPath)
    try {
      analytics.capture('bottom_nav_clicked', {
        tabId,
        label,
        targetPath,
      })
    } catch {
      // Analytics must never block navigation.
    }
  }

  /** The options a tab adds to the shared ones: its own heading or top bar actions. */
  const tabOptions: Partial<Record<AppTabId, TabExtraOptions>> = {
    home: {
      headerTitle: (props) => <ShareCardTabHeading {...props} scope="outfit" />,
      headerRight: () => (
        <Link href="/modal" asChild>
          <Pressable
            testID="header-info-modal"
            accessibilityRole="button"
            accessibilityLabel={t('common.about_couturecast')}
            style={styles.headerButton}
          >
            {({ pressed }) => (
              <FontAwesome
                name="info-circle"
                size={25}
                color={colors.ink}
                style={{ marginRight: 16, opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>
        </Link>
      ),
    },
    // The Closet's Add and More live in its top bar; the hub sets them (D4), since Add opens
    // the hub's own capture flow.
    community: {
      headerTitle: (props) => (
        <ShareCardTabHeading {...props} scope="community" wrapTitle />
      ),
    },
  }

  return (
    <Tabs
      screenOptions={{
        // Story CC-7.9 D3: the active tab is gold (`tabActive`) with its existing label weight
        // change and underline, so the state never relies on color alone.
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          borderTopColor: colors.line,
          backgroundColor: colors.page,
          height: shell.tabBarHeight + growth + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarLabel: ({
          color,
          children,
          focused,
          position,
        }: {
          color: string
          children: string
          focused: boolean
          position: 'below-icon' | 'beside-icon'
        }) => (
          <TabBarLabel
            color={color}
            focused={focused}
            onHeight={onLabelHeight}
            position={position}
            lineBoxHeight={tallestLabel}
          >
            {children}
          </TabBarLabel>
        ),
        // Story CC-7.9 D6: the one app top bar is every tab's header.
        header: renderTabTopBar,
        sceneStyle: { backgroundColor: colors.page },
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      {APP_TABS.map((tab) => {
        const label = tabLabel(tab)
        return (
          <Tabs.Screen
            key={tab.id}
            name={tab.nativeRoute}
            options={{
              title: label,
              tabBarButtonTestID: TAB_TEST_IDS[tab.id],
              tabBarAccessibilityLabel: label,
              tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
                <TabBarIcon
                  growth={indicatorDrop}
                  color={color}
                  focused={focused}
                  tabId={tab.id}
                />
              ),
              ...tabOptions[tab.id],
            }}
            listeners={{
              // Analytics records the English tab name whatever the reader's language.
              tabPress: () => trackTabPress(tab.id, tab.label, tab.nativeHref),
            }}
          />
        )
      })}
      {/* Kept routable: Android navigation restoration still lists /two. */}
      <Tabs.Screen
        name="two"
        options={{
          href: null,
        }}
      />
    </Tabs>
  )
}

/** The underline's offset below the icon at the default text size. */
const INDICATOR_BOTTOM = -23

const styles = StyleSheet.create({
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginBottom: -4,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: INDICATOR_BOTTOM,
    width: 64,
    height: 4,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
})
