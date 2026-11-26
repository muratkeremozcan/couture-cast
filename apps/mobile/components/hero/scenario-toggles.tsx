import React from 'react'
import { StyleSheet, Pressable, ScrollView } from 'react-native'
import { Text, View } from '@/components/themed'
import { useHeroPalette } from './hero-theme'
import { useTranslation } from 'react-i18next'

type ScenarioType = 'morning' | 'midday' | 'evening'

type ScenarioTogglesProps = {
  activeScenario: ScenarioType
  onScenarioChange: (scenario: ScenarioType) => void
}

const scenarios: { key: ScenarioType; labelKey: string; defaultLabel: string }[] = [
  { key: 'morning', labelKey: 'hero.scenarios.morning', defaultLabel: 'Morning commute' },
  { key: 'midday', labelKey: 'hero.scenarios.midday', defaultLabel: 'Midday' },
  { key: 'evening', labelKey: 'hero.scenarios.evening', defaultLabel: 'Evening plans' },
]

export function ScenarioToggles({
  activeScenario,
  onScenarioChange,
}: ScenarioTogglesProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View style={styles.container} testID="scenario-toggles" accessibilityRole="tablist">
      {/* Tabs size to their localized label on one line (it-IT and pt-PT outgrow a third
          of a 360-point phone) and scroll sideways only when the labels cannot all fit. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {scenarios.map((tab) => {
          const isActive = activeScenario === tab.key
          return (
            <Pressable
              key={tab.key}
              onPress={() => onScenarioChange(tab.key)}
              style={[
                styles.tabButton,
                { borderBottomColor: palette.line },
                isActive && styles.activeTabButton,
              ]}
              testID={`scenario-toggle-${tab.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  { color: palette.inkMuted },
                  isActive && styles.activeTabLabel,
                  isActive && { color: palette.ink },
                ]}
              >
                {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
              </Text>
              {isActive && (
                <View
                  style={[styles.activeUnderline, { backgroundColor: palette.ink }]}
                />
              )}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    marginHorizontal: 16,
    marginVertical: 12,
  },
  scrollContent: {
    flexGrow: 1,
  },
  // Each tab carries its own share of the divider so the line scrolls with the tabs and
  // the active underline can overlap it without being clipped by the scroll view.
  tabButton: {
    flexGrow: 1,
    flexShrink: 0,
    borderBottomWidth: 1,
    // 8 keeps the three short en-US labels on a 360-point phone at the 14-point step.
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  activeTabButton: {
    backgroundColor: 'transparent',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabLabel: {
    fontWeight: '700',
  },
  activeUnderline: {
    position: 'absolute',
    bottom: -1,
    left: '15%',
    right: '15%',
    // The active underline is ink: a selected toggle never paints gold (Story CC-7.9 D3).
    height: 2,
  },
})
