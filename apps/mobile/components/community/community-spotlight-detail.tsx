// Story 6.6 owner: the detail a spotlight card opens into.
// Story 6.6 mobile detail owner: the detail a spotlight card opens in `apps/mobile/components/community/community-spotlight-detail.tsx`
import React, { useRef } from 'react'
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityReactionSpotlightItem } from '@couture/api-client/contracts/http'
import { EdgeToEdgeModal, useModalInsets } from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

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
 * sheet around the reused card. Opening moves focus to its title and announces
 * the change once; closing hands focus back to the caller.
 */
export function CommunitySpotlightDetail({
  item,
  onClose,
  onDismissed,
  renderCard,
}: CommunitySpotlightDetailProps) {
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
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismissed}
      scrim="rgba(0,0,0,0.5)"
      onShow={() => {
        // The feed's own focused-look announcement, so both surfaces say the same.
        AccessibilityInfo.announceForAccessibility(t('community.feed.announceFocused'))
        const node = safeFindNodeHandle(titleRef.current)
        if (node) AccessibilityInfo.setAccessibilityFocus(node)
      }}
    >
      <View style={styles.backdrop}>
        <View
          testID="community-spotlight-detail"
          style={[
            styles.sheet,
            { backgroundColor: palette.surface, paddingBottom: 32 + insets.bottom },
          ]}
          accessibilityViewIsModal
          accessible={false}
        >
          <View style={styles.row}>
            <View style={styles.titleBlock}>
              <Text
                ref={titleRef}
                testID="community-spotlight-detail-title"
                accessibilityRole="header"
                style={[styles.title, { color: palette.text }]}
              >
                {t('community.spotlight.eyebrow')}
              </Text>
              <Text
                testID="community-spotlight-detail-rank"
                style={[styles.rank, { color: palette.mutedText }]}
              >
                {t('community.spotlight.rank', { rank: shown.rank })}
              </Text>
            </View>
            <TouchableOpacity
              testID="community-spotlight-detail-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              style={[styles.closeButton, { borderColor: palette.mutedText }]}
            >
              <Text style={[styles.closeText, { color: palette.text }]}>
                {t('common.back')}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView accessible={false} contentContainerStyle={styles.content}>
            {renderCard(shown)}
          </ScrollView>
        </View>
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    paddingTop: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 12,
  },
  titleBlock: { flexShrink: 1, gap: 2 },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  rank: {
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  content: { paddingBottom: 12 },
})
