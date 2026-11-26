import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { CLIMATE_BANDS } from '@couture/utils'
import type { ClimateBand, CommunityFeedMode } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'

// Story CC-7.9 D3: a selected chip is `inverse` with `onInverse` ink, the same on web and
// native, so gold stays with the five gold roles.

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
        { backgroundColor: palette.page, borderBottomColor: palette.line },
      ]}
    >
      {/* Production feedback 2026-11-19 asked what "Cold and wet" means: the chips name a
          climate band and nothing said what a band is, so one line above them does. */}
      <Text
        testID="community-filters-explainer"
        style={[styles.explainer, { color: palette.inkMuted }]}
      >
        {t('community.filters.explainer')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {COMMUNITY_FILTER_MODES.map((mode) => {
          const isActive = selectedMode === mode
          // The band qualifier is tied to `isActive`, not just to `mode === 'auto'`.
          // The experiment can serve `all` to a viewer who requested `auto`, and
          // `viewerBand` is resolved independently of what was served, so without
          // this the auto chip would promise "Your climate: X" while a completely
          // different, unfiltered feed sits on screen and the `all` chip is the
          // one actually pressed.
          const label =
            isActive && mode === 'auto' && viewerBand
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
                  backgroundColor: isActive ? palette.inverse : palette.page,
                  // Selection never rides on colour alone: the active chip also
                  // doubles its border weight and bolds its label.
                  borderColor: isActive ? palette.inverse : palette.inkMuted,
                  borderWidth: isActive ? 2 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isActive ? palette.onInverse : palette.ink,
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
    paddingVertical: 12,
    zIndex: 10,
  },
  explainer: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
  },
})
