import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { CLIMATE_BANDS } from '@couture/utils'
import type { ClimateBand, CommunityFeedMode } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

/**
 * `hero-theme.ts` carries background/surface/text/mutedText/divider/subtleSurface/
 * skeleton/danger and no premium accent, and this task may not extend it, so the
 * gold selection colour and the ink that sits on it are derived here. Reported as
 * a palette gap: the community surface needs `accent` and `onAccent` tokens.
 * `#111111` on `#C9A14A` computes to 8.7:1, well over the 4.5:1 floor.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'

/**
 * The filter strip is the feed's `mode` query parameter, nothing else. It is
 * built straight off `communityFeedModeSchema`'s own shape -- `auto`, `all` and
 * the six real `CLIMATE_BANDS` -- so there is no alias table to drift. The
 * invented arctic/subtropical/tropical/hyperarid ids never existed on the server.
 */
export const COMMUNITY_FILTER_MODES: readonly CommunityFeedMode[] = [
  'auto',
  'all',
  ...CLIMATE_BANDS,
]

export interface CommunityFilterChipsProps {
  selectedMode: CommunityFeedMode
  onSelectMode: (mode: CommunityFeedMode) => void
  /** Resolved viewer band, folded into the `auto` chip's label when present. */
  viewerBand?: ClimateBand | null
}

export function CommunityFilterChips({
  selectedMode,
  onSelectMode,
  viewerBand,
}: CommunityFilterChipsProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View
      testID="community-sticky-filter-chips"
      accessibilityLabel={t('community.filters.label')}
      style={[
        styles.stickyHeader,
        { backgroundColor: palette.background, borderBottomColor: palette.divider },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {COMMUNITY_FILTER_MODES.map((mode) => {
          const isActive = selectedMode === mode
          const label =
            mode === 'auto' && viewerBand
              ? t('community.filters.mode.autoWithBand', {
                  band: t(`community.band.${viewerBand}`),
                })
              : t(`community.filters.mode.${mode}`)

          return (
            <TouchableOpacity
              key={mode}
              testID={`community-filter-chip-${mode}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              // `accessibilityState` is native-only: react-native-web's
              // forwardedProps table has no entry for the object form, so without
              // an `aria-*` prop the selected chip is not announced as selected on
              // the web target (`app.json` ships one). It is `aria-pressed` rather
              // than `aria-selected` because ARIA allows `aria-selected` only on
              // option/tab/row/gridcell/treeitem, never on a button -- axe rejects
              // it as `aria-allowed-attr`. A toggle button takes `aria-pressed`,
              // which is what the web chip strip uses too, so the two surfaces
              // announce selection the same way.
              aria-pressed={isActive}
              accessibilityLabel={label}
              onPress={() => onSelectMode(mode)}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? ACCENT_GOLD : palette.surface,
                  // Selection never rides on colour alone: the active chip also
                  // doubles its border weight and bolds its label.
                  borderColor: isActive ? ON_ACCENT : palette.mutedText,
                  borderWidth: isActive ? 2 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isActive ? ON_ACCENT : palette.text,
                    fontWeight: isActive ? '700' : '500',
                  },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  stickyHeader: {
    borderBottomWidth: 1,
    paddingVertical: 10,
    zIndex: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
  },
})
