// Story 6.6 owner: the City Spotlight module heading the Community tab list.
// Story 6.6 mobile module owner: the horizontal carousel in `apps/mobile/components/community/community-spotlight-module.tsx`
import React, { useCallback, useEffect, useRef } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
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

// Story CC-7.9 D3: the rank badge is a marker, so it is `inverse` with `onInverse`.

/** The heading's native id, so the carousel's list can name itself after it. */
const HEADING_ID = 'community-spotlight-heading'

/** Share of the window one carousel item takes, so the next card peeks. */
export const SPOTLIGHT_ITEM_SHARE = 0.85
/** Keeps a tablet card near phone size, so the feed still starts one card down. */
export const SPOTLIGHT_ITEM_MAX_WIDTH = 420
/** `CommunityCard` keeps this margin on each side, the same inset as the feed. */
const CARD_INSET = 16

export interface SpotlightCarouselMetrics {
  /** Width of one item: the card plus its own insets. */
  itemWidth: number
  /** Distance from one card to the next, which is also the snap interval. */
  step: number
}

/**
 * Story 6.6 R42: the spotlight is one horizontal carousel, so the ranked cards
 * add a single card height above the feed. The reused card keeps its 16px
 * insets, so each item overlaps its neighbours by half an inset on each side:
 * cards sit 16px apart, as feed cards do vertically, and every card snaps to the
 * feed's 16px left edge.
 */
export function spotlightCarouselMetrics(windowWidth: number): SpotlightCarouselMetrics {
  const itemWidth = Math.min(
    Math.round(windowWidth * SPOTLIGHT_ITEM_SHARE),
    SPOTLIGHT_ITEM_MAX_WIDTH
  )
  return { itemWidth, step: itemWidth - CARD_INSET }
}

export interface CommunitySpotlightModuleProps {
  status: SpotlightStatus
  level: CommunitySpotlightLevel
  label: string | null
  items: CommunityReactionSpotlightItem[]
  hasMore: boolean
  isLoadingMore: boolean
  /**
   * Story CC-7.7 D5: page one is being replaced in place. View more keeps its place but is
   * disabled until the fresh page (and its cursor) lands.
   */
  isReplacing?: boolean
  loadMoreFailed: boolean
  focusRequest: SpotlightFocusRequest | null
  /** Retires a handled request in its owner, so a remount never replays it. */
  onFocusRequestHandled?: (serial: number) => void
  /** Checked when a queued focus move runs; false drops it (the screen was left). */
  canMoveFocus?: () => boolean
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
  isReplacing = false,
  loadMoreFailed,
  focusRequest,
  onFocusRequestHandled,
  canMoveFocus,
  onRetry,
  onViewMore,
  renderCard,
  registerRank,
}: CommunitySpotlightModuleProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const { width: windowWidth } = useWindowDimensions()
  const { itemWidth, step } = spotlightCarouselMetrics(windowWidth)
  const rankRefs = useRef(new Map<string, View | null>())
  const carouselRef = useRef<ScrollView>(null)
  const handledFocusRef = useRef(0)
  const translationRef = useRef(t)
  translationRef.current = t
  const handledCallbackRef = useRef(onFocusRequestHandled)
  handledCallbackRef.current = onFocusRequestHandled
  const canMoveFocusRef = useRef(canMoveFocus)
  canMoveFocusRef.current = canMoveFocus
  const itemsRef = useRef(items)
  itemsRef.current = items
  const stepRef = useRef(step)
  stepRef.current = step

  const setRankRef = useCallback(
    (postId: string, node: View | null) => {
      rankRefs.current.set(postId, node)
      registerRank?.(postId, node)
    },
    [registerRank]
  )

  // View more and a stale-cursor restart each move focus to the first new card
  // and announce the change once, through the same announcement path the feed uses.
  // The carousel first brings that card to its start, so a card appended past
  // the right edge never takes focus out of sight.
  useEffect(() => {
    if (!focusRequest || handledFocusRef.current === focusRequest.serial) return
    handledFocusRef.current = focusRequest.serial
    handledCallbackRef.current?.(focusRequest.serial)
    AccessibilityInfo.announceForAccessibility(
      focusRequest.kind === 'appended'
        ? translationRef.current('community.spotlight.announceLoadedMore', {
            count: focusRequest.count,
          })
        : focusRequest.kind === 'targeted'
          ? translationRef.current('community.feed.announceFocused')
          : translationRef.current('community.spotlight.announceRefreshed')
    )
    const { firstId } = focusRequest
    if (firstId === null) return
    requestAnimationFrame(() => {
      if (canMoveFocusRef.current && !canMoveFocusRef.current()) return
      const index = itemsRef.current.findIndex((item) => item.id === firstId)
      if (index >= 0)
        carouselRef.current?.scrollTo({ x: index * stepRef.current, animated: true })
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
      style={[styles.section, { borderColor: palette.line }]}
    >
      <Text
        testID="community-spotlight-heading"
        nativeID={HEADING_ID}
        accessibilityRole="header"
        style={[styles.heading, { color: palette.ink }]}
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
          <ActivityIndicator size="small" color={palette.ink} />
          <Text style={[styles.body, { color: palette.inkMuted }]}>
            {t('community.spotlight.loading')}
          </Text>
        </View>
      )
    }
    if (status === 'disabled') {
      return (
        <Text
          testID="community-spotlight-disabled"
          style={[styles.body, { color: palette.inkMuted }]}
        >
          {t('community.spotlight.disabled')}
        </Text>
      )
    }
    if (status === 'error') {
      return (
        <View testID="community-spotlight-error" style={styles.stateColumn}>
          <Text style={[styles.body, { color: palette.ink }]}>
            {t('community.spotlight.error')}
          </Text>
          <TouchableOpacity
            testID="community-spotlight-retry"
            style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('community.spotlight.retry')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
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
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>
            {t('community.spotlight.emptyTitle')}
          </Text>
          <Text style={[styles.body, { color: palette.inkMuted }]}>
            {t('community.spotlight.emptyBody')}
          </Text>
        </View>
      )
    }
    return (
      <>
        <Text style={[styles.body, { color: palette.inkMuted }]}>
          {t('community.spotlight.intro')}
        </Text>
        {/*
          Horizontal inside the feed's vertical list: a horizontal pan moves the
          carousel and a vertical pan moves the feed. Every loaded card stays
          mounted, which keeps the whole carousel on the accessibility tree for
          VoiceOver and TalkBack.
        */}
        <ScrollView
          ref={carouselRef}
          testID="community-spotlight-row"
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={styles.carouselContent}
        >
          {items.length > 0 ? (
            // The list holds the ranked looks alone; View more trails it, so
            // the count read with each card covers the looks.
            <View
              testID="community-spotlight-list"
              role="list"
              aria-labelledby={HEADING_ID}
              style={styles.list}
            >
              {items.map((item, index) => (
                <View
                  key={item.id}
                  testID={`community-spotlight-item-${item.id}`}
                  role="listitem"
                  style={[styles.item, { width: itemWidth }]}
                >
                  <View
                    ref={(node) => setRankRef(item.id, node)}
                    testID={`community-spotlight-rank-${item.id}`}
                    accessible
                    accessibilityLabel={rankLabel(item.rank, index + 1, items.length)}
                    style={[styles.rankBadge, { backgroundColor: palette.inverse }]}
                  >
                    <Text style={[styles.rankText, { color: palette.onInverse }]}>
                      #{item.rank}
                    </Text>
                  </View>
                  {renderCard(item)}
                </View>
              ))}
            </View>
          ) : null}
          {renderFooter()}
        </ScrollView>
      </>
    )
  }

  /**
   * The rank can skip a number the server filtered, so the position and count
   * among the loaded looks follow it.
   */
  function rankLabel(rank: number, position: number, count: number) {
    return `${t('community.spotlight.rank', { rank })}, ${t(
      'community.spotlight.position',
      { position, count }
    )}`
  }

  /**
   * The carousel's trailing item: View more while a next page exists, or the
   * loading and retry states that stand in for it.
   */
  function renderFooter() {
    if (isLoadingMore) {
      return (
        <View testID="community-spotlight-loading-more" style={styles.trailing}>
          <ActivityIndicator size="small" color={palette.ink} />
          <Text style={[styles.trailingText, { color: palette.inkMuted }]}>
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
          style={styles.trailing}
        >
          <Text style={[styles.trailingText, { color: palette.ink }]}>
            {t('community.spotlight.error')}
          </Text>
          <TouchableOpacity
            testID="community-spotlight-more-retry"
            style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
            onPress={onViewMore}
            accessibilityRole="button"
            accessibilityLabel={t('community.spotlight.retry')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
              {t('community.spotlight.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    if (!hasMore) return null
    return (
      <View style={styles.trailing}>
        <TouchableOpacity
          testID="community-spotlight-view-more"
          style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
          onPress={onViewMore}
          disabled={isReplacing}
          accessibilityRole="button"
          accessibilityLabel={t('community.spotlight.viewMore')}
          accessibilityState={{ disabled: isReplacing }}
        >
          <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
            {t('community.spotlight.viewMore')}
          </Text>
        </TouchableOpacity>
      </View>
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
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  emptyTitle: {
    fontSize: 16,
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
  carouselContent: {
    // Half an inset at each end: the overlapping items below bring the first
    // and last cards back to the full 16px inset.
    paddingHorizontal: CARD_INSET / 2,
  },
  list: {
    flexDirection: 'row',
  },
  item: {
    gap: 8,
    marginHorizontal: -CARD_INSET / 2,
  },
  trailing: {
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 240,
    paddingHorizontal: CARD_INSET / 2,
    gap: 8,
  },
  trailingText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  rankBadge: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    minWidth: 44,
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
})
