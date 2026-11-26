// Story 6.6 owner: the detail a spotlight card opens into.
// Story 6.6 mobile detail owner: the detail a spotlight card opens in `apps/mobile/components/community/community-spotlight-detail.tsx`
// Story CC-7.11 D12, D13: the native post detail, a full-height layer under the app top bar.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import React, { useRef } from 'react'
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { AppTopBar } from '@/src/components/app-top-bar'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'

export interface CommunitySpotlightDetailProps {
  item: CommunityReactionSpotlightItem | null
  onClose: () => void
  /** iOS reports when the sheet has fully gone, so a follow-up modal can open. */
  onDismissed?: () => void
  /** The same card the module renders, so the detail shows every reused control. */
  renderCard: (item: CommunityReactionSpotlightItem) => React.ReactNode
}

/**
 * Mobile has no separate post detail screen, so a spotlight card opens this
 * layer around the reused card. Opening moves focus to its title and announces
 * the change once; closing hands focus back to the caller.
 */
export function CommunitySpotlightDetail({
  item,
  onClose,
  onDismissed,
  renderCard,
}: CommunitySpotlightDetailProps) {
  const modalAnimation = useModalAnimation('slide')
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const insets = useModalInsets()
  const titleRef = useRef<Text>(null)
  // The sheet stays mounted while it animates away, showing the look it opened.
  const shownRef = useRef<CommunityReactionSpotlightItem | null>(null)
  if (item) shownRef.current = item
  const shown = shownRef.current

  if (!shown) return null

  return (
    <EdgeToEdgeModal
      visible={item !== null}
      animationType={modalAnimation}
      onRequestClose={onClose}
      // Story CC-7.11 D13: the Community screen's closeSpotlightDetail focuses the card's rank.
      returnFocusRef={null}
      onDismiss={onDismissed}
      transparent={false}
      onShow={() => {
        // The feed's own focused-look announcement, so both surfaces say the same.
        AccessibilityInfo.announceForAccessibility(t('community.feed.announceFocused'))
        const node = safeFindNodeHandle(titleRef.current)
        if (node) AccessibilityInfo.setAccessibilityFocus(node)
      }}
    >
      {/* Story CC-7.11 D12: a full-height layer. Its header is the app top bar with back and the
          look's title, and it is the swipe-down handle (D13). */}
      <View
        testID="community-spotlight-detail"
        style={[
          styles.layer,
          { backgroundColor: palette.page, paddingBottom: insets.bottom },
        ]}
        accessibilityViewIsModal
        accessible={false}
      >
        <LayerSwipeHandle>
          <AppTopBar
            title={t('community.spotlight.eyebrow')}
            titleRef={titleRef}
            onBack={onClose}
          />
        </LayerSwipeHandle>
        <ScrollView
          testID="layer-body"
          accessible={false}
          contentContainerStyle={styles.content}
        >
          <Text
            testID="community-spotlight-detail-rank"
            style={[styles.rank, { color: palette.inkMuted }]}
          >
            {t('community.spotlight.rank', { rank: shown.rank })}
          </Text>
          {renderCard(shown)}
        </ScrollView>
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  rank: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  content: { gap: 12, paddingBottom: 12 },
})
