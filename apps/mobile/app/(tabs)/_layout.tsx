import React from 'react'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { Link, Tabs } from 'expo-router'
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import Colors from '@/constants/colors'
import { useClientOnlyValue } from '@/components/use-client-only-value'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name']
  color: string
  focused: boolean
  tabId: string
}) {
  const { focused, tabId, ...iconProps } = props

  return (
    <View style={styles.iconContainer}>
      <FontAwesome size={28} style={styles.icon} {...iconProps} />
      {focused && (
        <View style={styles.activeIndicator} testID={`tab-${tabId}-active-indicator`} />
      )}
    </View>
  )
}

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const palette = colorScheme === 'dark' ? Colors.dark : Colors.light
  const insets = useSafeAreaInsets()
  const analytics = useMobileAnalytics()
  const { t } = useTranslation()
  const inactiveTintColor = colorScheme === 'dark' ? '#B8B8C2' : '#5C5C66'
  const tabLabels = {
    home: t('tabs.home', { defaultValue: 'Home' }),
    wardrobe: t('tabs.wardrobe', { defaultValue: 'Wardrobe' }),
    community: t('tabs.community', { defaultValue: 'Community' }),
    settings: t('tabs.settings', { defaultValue: 'Settings' }),
  }

  const trackTabPress = (tabId: string, label: string, targetPath: string) => {
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
        tabBarActiveTintColor: '#C9A14A',
        tabBarInactiveTintColor: inactiveTintColor,
        tabBarStyle: {
          borderTopColor: '#E6E6ED',
          backgroundColor: palette.background,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tabLabels.home,
          tabBarButtonTestID: 'tab-home',
          tabBarAccessibilityLabel: tabLabels.home,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name="home" color={color} focused={focused} tabId="home" />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable>
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
          tabBarButtonTestID: 'tab-community',
          tabBarAccessibilityLabel: tabLabels.community,
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name="users" color={color} focused={focused} tabId="community" />
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
            <TabBarIcon name="cog" color={color} focused={focused} tabId="settings" />
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

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginBottom: -3,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -23,
    width: 64,
    height: 4,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: '#C9A14A',
  },
})
