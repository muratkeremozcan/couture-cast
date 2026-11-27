import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { CLIMATE_BANDS } from '@couture/utils'
import type { ClimateBand, CommunityFeedMode } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useTokens } from '@/src/theme/tokens'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

export const COMMUNITY_FILTER_MODES: readonly CommunityFeedMode[] = [
  'auto',
  'all',
  ...CLIMATE_BANDS,
]

export interface CommunityFilterChipsProps {
  selectedMode: CommunityFeedMode
  onSelectMode: (mode: CommunityFeedMode) => void
  viewerBand?: ClimateBand | null
  active?: boolean
  children?: ReactNode
}

export function CommunityFilterChips({
  selectedMode,
  onSelectMode,
  viewerBand,
  active = true,
  children,
}: CommunityFilterChipsProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const { scrim } = useTokens()
  const insets = useModalInsets()
  const [open, setOpen] = useState(false)
  const trigger = useRef<View>(null)
  const heading = useRef<Text>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])

  const label = (mode: CommunityFeedMode) => {
    if (mode === 'all') return t('community.calm.allClimates')
    if (mode === 'auto' && mode === selectedMode && viewerBand)
      return t('community.filters.mode.autoWithBand', {
        band: t(`community.band.${viewerBand}`),
      })
    return t(`community.filters.mode.${mode}`)
  }

  return (
    <View style={styles.filter}>
      <TouchableOpacity
        ref={trigger}
        testID="community-climate-filter"
        accessibilityRole="button"
        accessibilityLabel={label(selectedMode)}
        accessibilityState={{ expanded: open }}
        style={[styles.trigger, { borderColor: palette.lineStrong }]}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.triggerLabel, { color: palette.ink }]}>
          {label(selectedMode)}
        </Text>
        <Text accessible={false} style={{ color: palette.ink }}>
          ⌄
        </Text>
      </TouchableOpacity>
      <EdgeToEdgeModal
        visible={open && active}
        animationType="slide"
        scrim={scrim}
        onRequestClose={close}
        returnFocusRef={trigger}
        onShow={() => {
          const handle = safeFindNodeHandle(heading.current)
          if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
        }}
      >
        <View style={[styles.sheetPosition, { paddingTop: insets.top }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
          <View
            testID="community-climate-sheet"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { backgroundColor: palette.page, paddingBottom: insets.bottom },
            ]}
          >
            <LayerSwipeHandle>
              <View style={styles.headingRow}>
                <Text
                  ref={heading}
                  accessibilityRole="header"
                  style={[styles.heading, { color: palette.ink }]}
                >
                  {t('community.filters.label')}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('shell.close')}
                  style={styles.close}
                  onPress={close}
                >
                  <Text style={[styles.closeLabel, { color: palette.ink }]}>×</Text>
                </TouchableOpacity>
              </View>
            </LayerSwipeHandle>
            <ScrollView contentContainerStyle={styles.options}>
              <Text
                testID="community-filters-explainer"
                style={{ color: palette.inkMuted }}
              >
                {t('community.filters.explainer')}
              </Text>
              {children}
              {COMMUNITY_FILTER_MODES.map((mode) => {
                const selected = mode === selectedMode
                return (
                  <TouchableOpacity
                    key={mode}
                    testID={`community-filter-chip-${mode}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    aria-pressed={selected}
                    style={[
                      styles.option,
                      {
                        backgroundColor: selected ? palette.inverse : palette.page,
                        borderColor: selected ? palette.inverse : palette.lineStrong,
                      },
                    ]}
                    onPress={() => {
                      close()
                      onSelectMode(mode)
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? palette.onInverse : palette.ink,
                        fontWeight: selected ? '700' : '500',
                      }}
                    >
                      {label(mode)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </EdgeToEdgeModal>
    </View>
  )
}

const styles = StyleSheet.create({
  filter: { marginHorizontal: 16, marginTop: 8, marginBottom: 4 },
  trigger: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  triggerLabel: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  sheetPosition: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  heading: { flex: 1, fontSize: 18, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  closeLabel: { fontSize: 24 },
  options: { padding: 16, gap: 8 },
  option: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
})
