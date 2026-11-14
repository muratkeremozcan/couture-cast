import React, { useCallback, useState } from 'react'
import { useAndroidNavigationIntent } from '@/components/android-share-card-presentation'
import { ShareCardTabHeading } from '@/components/share-card-tab-heading'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { Link, Tabs } from 'expo-router'
import {
  Platform,
  Pressable,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import Colors from '@/constants/colors'
import { useClientOnlyValue } from '@/components/use-client-only-value'
import { TabBarLabel, tabBarGrowth } from '@/components/tab-bar-label'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name']
  color: string
  focused: boolean
  tabId: string
  /** How much taller the bar is than at the default text size (see tabBarGrowth). */
  growth: number
}) {
  const { focused, tabId, growth, ...iconProps } = props

  return (
    <View style={styles.iconContainer}>
      <FontAwesome size={28} style={styles.icon} {...iconProps} />
      {focused && (
        <View
          // The bar grows upward with its labels and the icon with it, so the underline drops
          // by the same amount to stay on the bar's bottom edge, below the label.
          style={[
            styles.activeIndicator,
            { backgroundColor: props.color, bottom: INDICATOR_BOTTOM - growth },
          ]}
          testID={`tab-${tabId}-active-indicator`}
        />
      )}
    </View>
  )
}

export default function TabLayout() {
  const navigationIntent = useAndroidNavigationIntent()
  const colorScheme = useColorScheme()
  const palette = colorScheme === 'dark' ? Colors.dark : Colors.light
  const insets = useSafeAreaInsets()
  const analytics = useMobileAnalytics()
  const { t } = useTranslation()
  const { fontScale } = useWindowDimensions()
  // Story 6.15 F-00i: each label reports its height and the bar grows by what the text grew.
  // iOS labels do not scale (Large Content Viewer), so the bar keeps its height there.
  const [labelHeights, setLabelHeights] = useState<Record<string, number>>({})
  const onLabelHeight = useCallback((label: string, height: number) => {
    setLabelHeights((current) =>
      current[label] === height ? current : { ...current, [label]: height }
    )
  }, [])
  const growth = tabBarGrowth(
    Object.values(labelHeights),
    Platform.OS === 'ios' ? 1 : fontScale
  )
  const tabLabels = {
    home: t('tabs.home', { defaultValue: 'Home' }),
    wardrobe: t('tabs.wardrobe', { defaultValue: 'Wardrobe' }),
    community: t('tabs.community', { defaultValue: 'Community' }),
    settings: t('tabs.settings', { defaultValue: 'Settings' }),
  }

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

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.text,
        tabBarInactiveTintColor: palette.mutedText,
        tabBarStyle: {
          borderTopColor: palette.border,
          backgroundColor: palette.background,
          height: 56 + growth + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarLabel: ({ color, children }: { color: string; children: string }) => (
          <TabBarLabel color={color} onHeight={onLabelHeight}>
            {children}
          </TabBarLabel>
        ),
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tabLabels.home,
          headerTitle: (props) => <ShareCardTabHeading {...props} scope="outfit" />,
          tabBarButtonTestID: 'tab-home',
          tabBarAccessibilityLabel: tabLabels.home,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon
              growth={growth}
              name="home"
              color={color}
              focused={focused}
              tabId="home"
            />
          ),
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
                    color={palette.text}
                    style={{ marginRight: 15, opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            </Link>
          ),
        }}
        listeners={{
          tabPress: () => trackTabPress('home', tabLabels.home, '/'),
        }}
      />
      <Tabs.Screen
        name="wardrobe"
        options={{
          title: tabLabels.wardrobe,
          tabBarButtonTestID: 'tab-wardrobe',
          tabBarAccessibilityLabel: tabLabels.wardrobe,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon
              growth={growth}
              name="shopping-bag"
              color={color}
              focused={focused}
              tabId="wardrobe"
            />
          ),
        }}
        listeners={{
          tabPress: () => trackTabPress('wardrobe', tabLabels.wardrobe, '/wardrobe'),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: tabLabels.community,
          headerTitle: (props) => <ShareCardTabHeading {...props} scope="community" />,
          tabBarButtonTestID: 'tab-community',
          tabBarAccessibilityLabel: tabLabels.community,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon
              growth={growth}
              name="users"
              color={color}
              focused={focused}
              tabId="community"
            />
          ),
        }}
        listeners={{
          tabPress: () => trackTabPress('community', tabLabels.community, '/community'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tabLabels.settings,
          tabBarButtonTestID: 'tab-settings',
          tabBarAccessibilityLabel: tabLabels.settings,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon
              growth={growth}
              name="cog"
              color={color}
              focused={focused}
              tabId="settings"
            />
          ),
        }}
        listeners={{
          tabPress: () => trackTabPress('settings', tabLabels.settings, '/settings'),
        }}
      />
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
    marginBottom: -3,
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
