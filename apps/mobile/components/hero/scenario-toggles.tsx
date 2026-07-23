import React from 'react'
import { StyleSheet, Pressable, Platform } from 'react-native'
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
    <View
      style={[styles.container, { borderBottomColor: palette.divider }]}
      testID="scenario-toggles"
      accessibilityRole="tablist"
    >
      {scenarios.map((tab) => {
        const isActive = activeScenario === tab.key
        return (
          <Pressable
            key={tab.key}
            onPress={() => onScenarioChange(tab.key)}
            style={[styles.tabButton, isActive && styles.activeTabButton]}
            testID={`scenario-toggle-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: palette.mutedText },
                isActive && styles.activeTabLabel,
                isActive && { color: palette.text },
              ]}
            >
              {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
            </Text>
            {isActive && <View style={styles.activeUnderline} />}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6ED',
    backgroundColor: 'transparent',
    marginHorizontal: 16,
    marginVertical: 12,
  },
  tabButton: {
    flex: 1,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#a3a3a3',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
  },
  activeTabLabel: {
    color: '#111111',
    fontWeight: '700',
  },
  activeUnderline: {
    position: 'absolute',
    bottom: -1,
    left: '15%',
    right: '15%',
    height: 2,
    backgroundColor: '#C9A14A', // active gold underline
  },
})
