// Story 6.6 owner: the City Spotlight module heading the Community tab list.
import React, { useCallback, useEffect, useRef } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  CommunityReactionSpotlightItem,
  CommunitySpotlightLevel,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import type {
  SpotlightFocusRequest,
  SpotlightStatus,
} from '@/src/features/community/use-community-spotlight'

/** Same derived gold the community screen and challenge banner use. */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'

export interface CommunitySpotlightModuleProps {
  status: SpotlightStatus
  level: CommunitySpotlightLevel
  label: string | null
  items: CommunityReactionSpotlightItem[]
  hasMore: boolean
  isLoadingMore: boolean
  loadMoreFailed: boolean
  focusRequest: SpotlightFocusRequest | null
  onRetry: () => void
  onViewMore: () => void
  renderCard: (item: CommunityReactionSpotlightItem) => React.ReactNode
  /** Lets the screen return focus to a card's rank after its detail closes. */
  registerRank?: (postId: string, node: View | null) => void
}

export function CommunitySpotlightModule({
  status,
  level,
  label,
  items,
  hasMore,
  isLoadingMore,
  loadMoreFailed,
  focusRequest,
  onRetry,
  onViewMore,
  renderCard,
  registerRank,
}: CommunitySpotlightModuleProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const rankRefs = useRef(new Map<string, View | null>())
  const handledFocusRef = useRef(0)
  const translationRef = useRef(t)
  translationRef.current = t

  const setRankRef = useCallback(
    (postId: string, node: View | null) => {
      rankRefs.current.set(postId, node)
      registerRank?.(postId, node)
    },
    [registerRank]
  )

  // View more and a stale-cursor restart each move focus to the first new card
  // and announce the change once, through the same announcement path the feed uses.
  useEffect(() => {
    if (!focusRequest || handledFocusRef.current === focusRequest.serial) return
    handledFocusRef.current = focusRequest.serial
    AccessibilityInfo.announceForAccessibility(
      focusRequest.kind === 'appended'
        ? translationRef.current('community.spotlight.announceLoadedMore', {
            count: focusRequest.count,
          })
        : translationRef.current('community.spotlight.announceRefreshed')
    )
    const { firstId } = focusRequest
    if (firstId === null || Platform.OS === 'web') return
    requestAnimationFrame(() => {
      const handle = safeFindNodeHandle(rankRefs.current.get(firstId) ?? null)
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
    })
  }, [focusRequest])

  const heading = label
    ? t('community.spotlight.heading', { area: label })
    : t('community.spotlight.headingFallback')

  // No member, nothing to rank: the module hides like it does on web.
  if (status === 'idle') return null

  return (
    <View
      testID="community-spotlight"
      // Unboxed, so the reused cards keep the same insets as the feed below and
      // the divider alone separates the two sections.
      style={[styles.section, { borderColor: palette.divider }]}
    >
      <Text
        testID="community-spotlight-heading"
        accessibilityRole="header"
        style={[styles.heading, { color: palette.text }]}
      >
        {heading}
      </Text>
      {renderBody()}
    </View>
  )

  function renderBody() {
    if (status === 'loading') {
      return (
        <View testID="community-spotlight-loading" style={styles.stateRow}>
          <ActivityIndicator size="small" color={palette.text} />
          <Text style={[styles.body, { color: palette.mutedText }]}>
            {t('community.spotlight.loading')}
          </Text>
        </View>
      )
    }
    if (status === 'disabled') {
      return (
        <Text
          testID="community-spotlight-disabled"
          style={[styles.body, { color: palette.mutedText }]}
        >
          {t('community.spotlight.disabled')}
        </Text>
      )
    }
    if (status === 'error') {
      return (
        <View testID="community-spotlight-error" style={styles.stateColumn}>
          <Text style={[styles.body, { color: palette.text }]}>
            {t('community.spotlight.error')}
          </Text>
          <TouchableOpacity
            testID="community-spotlight-retry"
            style={[styles.outlineButton, { borderColor: palette.mutedText }]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('community.spotlight.retry')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.text }]}>
              {t('community.spotlight.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    // Ranks a View more can still reach keep the list, even when every card
    // shown so far has left it.
    if (level === 'none' || (items.length === 0 && !hasMore)) {
      return (
        <View testID="community-spotlight-empty" style={styles.stateColumn}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {t('community.spotlight.emptyTitle')}
          </Text>
          <Text style={[styles.body, { color: palette.mutedText }]}>
            {t('community.spotlight.emptyBody')}
          </Text>
        </View>
      )
    }
    return (
      <View testID="community-spotlight-list" style={styles.list}>
        <Text style={[styles.body, { color: palette.mutedText }]}>
          {t('community.spotlight.intro')}
        </Text>
        {items.map((item) => (
          <View
            key={item.id}
            testID={`community-spotlight-item-${item.id}`}
            style={styles.item}
          >
            <View
              ref={(node) => setRankRef(item.id, node)}
              testID={`community-spotlight-rank-${item.id}`}
              accessible
              accessibilityLabel={t('community.spotlight.rank', { rank: item.rank })}
              style={[styles.rankBadge, { backgroundColor: ACCENT_GOLD }]}
            >
              <Text style={[styles.rankText, { color: ON_ACCENT }]}>#{item.rank}</Text>
            </View>
            {renderCard(item)}
          </View>
        ))}
        {renderFooter()}
      </View>
    )
  }

  function renderFooter() {
    if (isLoadingMore) {
      return (
        <View testID="community-spotlight-loading-more" style={styles.stateRow}>
          <ActivityIndicator size="small" color={palette.text} />
          <Text style={[styles.body, { color: palette.mutedText }]}>
            {t('community.spotlight.loadingMore')}
          </Text>
        </View>
      )
    }
    if (loadMoreFailed) {
      return (
        <View
          testID="community-spotlight-more-error"
          accessibilityRole="alert"
          style={styles.stateColumn}
        >
          <Text style={[styles.body, { color: palette.text }]}>
            {t('community.spotlight.error')}
          </Text>
          <TouchableOpacity
            testID="community-spotlight-more-retry"
            style={[styles.outlineButton, { borderColor: palette.mutedText }]}
            onPress={onViewMore}
            accessibilityRole="button"
            accessibilityLabel={t('community.spotlight.retry')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.text }]}>
              {t('community.spotlight.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    if (!hasMore) return null
    return (
      <TouchableOpacity
        testID="community-spotlight-view-more"
        style={[styles.outlineButton, { borderColor: palette.mutedText }]}
        onPress={onViewMore}
        accessibilityRole="button"
        accessibilityLabel={t('community.spotlight.viewMore')}
      >
        <Text style={[styles.outlineButtonText, { color: palette.text }]}>
          {t('community.spotlight.viewMore')}
        </Text>
      </TouchableOpacity>
    )
  }
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  stateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  stateColumn: {
    gap: 8,
  },
  list: {
    gap: 12,
  },
  item: {
    gap: 6,
  },
  rankBadge: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    minWidth: 44,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  outlineButton: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
})
