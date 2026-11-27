// Story CC-7.11 D7 owner: Profile > Style, the sub-screen that holds Silhouette, closet setup and
// the color palette. The root stack's top bar carries its title and back (parent Profile).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { StyleMemberControls } from '@/src/features/preview/style-profile-controls'
import { useMobileStyleProfile } from '@/src/lib/style-profile'
import { NavRow } from '@/src/components/nav-row'
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
  const { colors, space } = useTokens()
  const style = useMobileStyleProfile()
  return (
    <ScrollView
      testID="settings-style-screen"
      style={{ backgroundColor: colors.page }}
      contentContainerStyle={[styles.content, { paddingVertical: space[4] }]}
    >
      <StyleMemberControls key={style.scope} style={style} showClear />
      <View style={[styles.rows, { borderTopColor: colors.line }]}>
        {STYLE_ROWS.map((row) => (
          <NavRow
            key={row.testID}
            testID={row.testID}
            label={t(row.labelKey)}
            onPress={() => router.push(row.href)}
          />
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: TAB_BODY_INSET, gap: 16 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
})
