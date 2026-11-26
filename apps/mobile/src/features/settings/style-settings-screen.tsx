// Story CC-7.11 D7 owner: Profile > Style, the sub-screen that holds Silhouette, closet setup and
// the color palette. The root stack's top bar carries its title and back (parent Profile).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ShellIcon } from '@/src/components/shell-icons'
import { TAB_BODY_INSET, useTokens } from '@/src/theme/tokens'

const STYLE_ROWS: readonly { testID: string; labelKey: string; href: Href }[] = [
  {
    testID: 'style-row-silhouette',
    labelKey: 'settings.style.silhouette',
    href: '/wardrobe-silhouette',
  },
  {
    testID: 'style-row-setup',
    labelKey: 'settings.style.closetSetup',
    href: '/wardrobe-onboarding',
  },
  {
    testID: 'style-row-palette',
    labelKey: 'settings.style.palette',
    href: '/palette-advisor',
  },
]

export function StyleSettingsScreen() {
  const { t } = useTranslation()
  const { colors, shell, space, type } = useTokens()
  return (
    <ScrollView
      testID="settings-style-screen"
      style={{ backgroundColor: colors.page }}
      contentContainerStyle={[styles.content, { paddingVertical: space[4] }]}
    >
      <View style={[styles.rows, { borderTopColor: colors.line }]}>
        {STYLE_ROWS.map((row) => (
          <Pressable
            key={row.testID}
            testID={row.testID}
            accessibilityRole="link"
            onPress={() => router.push(row.href)}
            style={[
              styles.row,
              {
                minHeight: shell.touchTarget,
                gap: space[3],
                paddingVertical: space[3],
                borderBottomColor: colors.line,
              },
            ]}
          >
            <Text
              style={[styles.label, { color: colors.ink, fontSize: type.base.fontSize }]}
            >
              {t(row.labelKey)}
            </Text>
            <ShellIcon name="forward" size={type.sm.fontSize} color={colors.inkMuted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: TAB_BODY_INSET },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
})
