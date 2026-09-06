import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { hasDeepLinkIntent, parseDeepLink } from '@couture/utils'
import type {
  ClimateBand,
  CommunityAuthorPostState,
  CommunityBandUnresolvedReason,
  CommunityExperimentVariant,
  CommunityFeedItem,
  CommunityFeedMode,
  CommunityReportReason,
  EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import { InfoBanner } from '@/components/info-banner'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  communityFailureReason,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  recordCommunityCardOpenedFromMobile,
  reportCommunityPostFromMobile,
  withdrawCommunityPostFromMobile,
} from '@/src/lib/community'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { CommunityFilterChips } from '@/components/community/community-filter-chips'
import { CommunityChallengeBanner } from '@/components/community/community-challenge-banner'
import { CommunityCard } from '@/components/community/community-card'
import { CommunityReportModal } from '@/components/community/community-report-modal'
import {
  CommunityPostSheet,
  communityErrorTranslation,
  useResolvedCommunityLocale,
} from '@/components/community/community-post-sheet'

/**
 * `hero-theme.ts` carries neither the premium gold accent nor the community
 * surface's merlot destructive colour, and this task may not extend it, so both
 * are derived here once and reported as a palette gap. Merlot is a fill with
 * white ink (10.2:1); as text on a dark ground it computes to 2.1:1 and fails.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'
const DESTRUCTIVE_MERLOT = '#7A1F2D'
const ON_DESTRUCTIVE = '#FFFFFF'

const FEED_PAGE_SIZE = 12

/** The four terminal states the `community.removed.*` tree explains. */
const EXPLAINED_AUTHOR_STATES = new Set([
  'flagged',
  'review_failed',
  'withdrawn',
  'consent_suspended',
])

type FeedState = 'loading' | 'ready' | 'error'

export function CommunityScreen() {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  const locale = useResolvedCommunityLocale(i18n.language)
  const analytics = useMobileAnalytics()
  const { source, type, cardId, expiresAt } = useLocalSearchParams()
  const targetRef = useRef<View>(null)
  const newPostButtonRef = useRef<View>(null)
  const cardRefs = useRef(new Map<string, View | null>())
  const [deepLinkPost, setDeepLinkPost] = useState<CommunityFeedItem | null>(null)
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)

  // Feed state
  const [mode, setMode] = useState<CommunityFeedMode>('auto')
  /**
   * The mode the SERVER served, which is not always the one that was requested:
   * the beta experiment resolves a request for `auto` to whichever arm the viewer
   * is assigned. The chip strip and the feed heading read this, so the `all` arm
   * no longer sees the `auto` chip pressed and labelled "Your climate: ..." over a
   * feed carrying every region. Requests keep using `mode`; the server binds the
   * cursor to the effective mode either way.
   */
  const [servedMode, setServedMode] = useState<CommunityFeedMode>('auto')
  const [experimentVariant, setExperimentVariant] =
    useState<CommunityExperimentVariant | null>(null)
  const [items, setItems] = useState<CommunityFeedItem[]>([])
  const [authorStates, setAuthorStates] = useState<CommunityAuthorPostState[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [viewerBand, setViewerBand] = useState<ClimateBand | null>(null)
  const [bandResolved, setBandResolved] = useState(true)
  const [bandUnresolvedReason, setBandUnresolvedReason] =
    useState<CommunityBandUnresolvedReason | null>(null)
  const [activeChallenge, setActiveChallenge] =
    useState<EmbeddedCommunityChallenge | null>(null)
  const [feedState, setFeedState] = useState<FeedState>('loading')
  const [feedError, setFeedError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Action state
  const [reportingPost, setReportingPost] = useState<CommunityFeedItem | null>(null)
  const [reportError, setReportError] = useState<unknown>(null)
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [reportedPostIds, setReportedPostIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [isPostSheetVisible, setIsPostSheetVisible] = useState(false)
  const [challengeOptIn, setChallengeOptIn] = useState(false)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  /**
   * A failed action, carrying the copy to fall back to when the failure cannot be
   * classified. Without the key travelling alongside the error, every unclassified
   * action failure borrowed the withdraw string, so a next page that 500'd told the
   * reader "We could not withdraw this look. It is still in the feed."
   */
  const [actionError, setActionError] = useState<{
    error: unknown
    fallbackKey: string
  } | null>(null)

  useEffect(() => {
    const rawParams = { source, type, cardId, expiresAt }
    const fail = (reason: string) => {
      setIsInvalidDeepLink(true)
      analytics.capture('deep_link_invalid', {
        rawUrl: JSON.stringify(rawParams),
        reason,
        surface: 'mobile',
      })
    }
    if (!hasDeepLinkIntent(rawParams)) {
      return
    }

    const parsed = parseDeepLink(rawParams)
    if (
      !parsed.valid ||
      parsed.payload?.source !== 'notification' ||
      parsed.payload.type !== 'community' ||
      !parsed.payload.cardId
    ) {
      fail(parsed.errorReason ?? 'Invalid community deep link parameters')
      return
    }

    let active = true
    const controller = new AbortController()
    /*
     * Resolved against the community API rather than assembled from the
     * notification's own payload. The synthetic card carried no image, no alt
     * text and no moderation controls, and it could only ever find a post whose
     * `lookbook:new` event was still inside the event-poll window, so a link to
     * anything older failed for a post that was still on the feed. The API is
     * also the only thing that knows whether THIS viewer may see the post: it
     * answers 404 for everything they may not.
     */
    void getCommunityPostFromMobile(parsed.payload.cardId, controller.signal)
      .then((post) => {
        if (!active) {
          return
        }
        setDeepLinkPost(post)
        setIsInvalidDeepLink(false)
        analytics.capture('deep_link_handled', {
          source: 'notification',
          type: 'community',
          cardId: post.id,
          surface: 'mobile',
        })
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }
        fail(
          communityFailureReason(error) === 'not_found'
            ? 'Community card target was not found'
            : 'Community card target could not be loaded'
        )
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [source, type, cardId, expiresAt, analytics])

  const focusNode = useCallback((node: View | null) => {
    if (Platform.OS === 'web' || !node) {
      return
    }
    requestAnimationFrame(() => {
      const handle = safeFindNodeHandle(node)
      if (handle) {
        AccessibilityInfo.setAccessibilityFocus(handle)
      }
    })
  }, [])

  useEffect(() => {
    if (!deepLinkPost) {
      return
    }
    focusNode(targetRef.current)
  }, [focusNode, deepLinkPost])

  /**
   * One in-flight feed request at a time, guarded twice: the `AbortController`
   * cancels the transport, and the generation counter drops any response that
   * outlived the filter it was issued for. Without both, rapidly changing chips
   * let a late response overwrite the current one.
   */
  const requestGenerationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  /**
   * Cursors the server has already rejected as stale. `onEndReached` fires off
   * scroll position rather than off state, so it can arrive again with the dead
   * cursor before the re-render that cleared it, and this is what makes a second
   * send impossible rather than merely unlikely.
   */
  const rejectedCursorsRef = useRef(new Set<string>())

  const loadFeed = useCallback(
    async (
      targetMode: CommunityFeedMode,
      { cursor, refresh = false }: { cursor?: string; refresh?: boolean } = {}
    ): Promise<void> => {
      if (cursor !== undefined && rejectedCursorsRef.current.has(cursor)) {
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation

      const isFirstPage = !cursor && !refresh
      if (refresh) {
        setIsRefreshing(true)
      } else if (cursor) {
        setIsLoadingMore(true)
      } else {
        setFeedState('loading')
      }

      let pageCursor = cursor
      try {
        // Runs at most twice. The retry goes out with no cursor at all, and only a
        // cursor can be rejected as stale, so the loop cannot come round again.
        for (;;) {
          try {
            const feed = await getCommunityFeedFromMobile({
              mode: targetMode,
              cursor: pageCursor,
              limit: FEED_PAGE_SIZE,
              signal: controller.signal,
            })
            if (generation !== requestGenerationRef.current) {
              return
            }
            const isAppend = pageCursor !== undefined
            setItems((previous) => {
              if (!isAppend) {
                return feed.items
              }
              const seen = new Set(previous.map((item) => item.id))
              return [...previous, ...feed.items.filter((item) => !seen.has(item.id))]
            })
            setAuthorStates(feed.authorStates)
            setNextCursor(feed.nextCursor)
            setServedMode(feed.mode)
            setExperimentVariant(feed.experimentVariant)
            setViewerBand(feed.viewerBand)
            setBandResolved(feed.bandResolved)
            setBandUnresolvedReason(feed.bandUnresolvedReason)
            setActiveChallenge(feed.activeChallenge)
            setFeedError(null)
            setFeedState('ready')
            return
          } catch (error: unknown) {
            if (
              generation !== requestGenerationRef.current ||
              controller.signal.aborted
            ) {
              return
            }
            if (
              pageCursor !== undefined &&
              communityFailureReason(error) === 'cursor_invalid'
            ) {
              /*
               * Ordinary operation, not a fault, so it is recovered from silently.
               * The cursor carries the band it was minted under, and under `auto`
               * that band is recomputed per request from weather guaranteed fresh
               * for only 60 minutes; a snapshot going stale mid-scroll is enough to
               * invalidate it. The contract's stated remedy is to restart paging,
               * which is what dropping the cursor here does.
               */
              rejectedCursorsRef.current.add(pageCursor)
              setNextCursor(null)
              pageCursor = undefined
              continue
            }
            // A first page that fails owns the screen; a refresh or a next page that
            // fails keeps what is already on screen and speaks up beside it.
            if (isFirstPage) {
              setFeedError(error)
              setFeedState('error')
            } else {
              setActionError({ error, fallbackKey: 'community.error.load' })
            }
            return
          }
        }
      } finally {
        if (generation === requestGenerationRef.current) {
          setIsRefreshing(false)
          setIsLoadingMore(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadFeed(mode)
    return () => controllerRef.current?.abort()
  }, [loadFeed, mode])

  const modeLabel = useMemo(
    () =>
      servedMode === 'auto' && viewerBand
        ? t('community.filters.mode.autoWithBand', {
            band: t(`community.band.${viewerBand}`),
          })
        : t(`community.filters.mode.${servedMode}`),
    [servedMode, t, viewerBand]
  )

  useEffect(() => {
    if (feedState !== 'ready') {
      return
    }
    AccessibilityInfo.announceForAccessibility(
      t('community.feed.announceLoaded', { filter: modeLabel, count: items.length })
    )
  }, [feedState, items.length, modeLabel, t])

  const handleSelectMode = useCallback((next: CommunityFeedMode) => {
    // The cursor embeds the mode it was minted under, so a filter change restarts
    // paging rather than carrying the old cursor across.
    setNextCursor(null)
    setActionError(null)
    setMode(next)
    // Optimistic so the strip responds to the tap; the response corrects it when
    // the experiment serves a different arm than the one that was asked for.
    setServedMode(next)
  }, [])

  const handleRefresh = useCallback(() => {
    void loadFeed(mode, { refresh: true })
  }, [loadFeed, mode])

  const handleRetry = useCallback(() => {
    void loadFeed(mode)
  }, [loadFeed, mode])

  const handleLoadMore = useCallback(() => {
    if (nextCursor && !isLoadingMore && feedState === 'ready' && !isRefreshing) {
      void loadFeed(mode, { cursor: nextCursor })
    }
  }, [feedState, isLoadingMore, isRefreshing, loadFeed, mode, nextCursor])

  const handleOpenCard = useCallback(
    (post: CommunityFeedItem) => {
      if (!experimentVariant) {
        // The arm is server-assigned and arrives on the feed response. An open
        // recorded before the first read would be filed under an arm the client
        // guessed, and the beta gate compares the two arms against each other.
        return
      }
      // Measurement only: a failure here costs one data point and must never
      // interrupt someone reading the feed.
      void recordCommunityCardOpenedFromMobile(post.id, experimentVariant).catch(
        () => undefined
      )
    },
    [experimentVariant]
  )

  const markReported = useCallback((postId: string) => {
    setReportedPostIds((previous) => new Set(previous).add(postId))
  }, [])

  const handleReportPost = useCallback((post: CommunityFeedItem) => {
    setReportError(null)
    setReportingPost(post)
  }, [])

  const closeReportModal = useCallback(() => {
    const invokerId = reportingPost?.id
    setReportingPost(null)
    setReportError(null)
    if (invokerId) {
      focusNode(cardRefs.current.get(invokerId) ?? null)
    }
  }, [focusNode, reportingPost])

  const handleSubmitReport = useCallback(
    async (postId: string, reason: CommunityReportReason, details?: string) => {
      setIsSubmittingReport(true)
      setReportError(null)
      try {
        await reportCommunityPostFromMobile(postId, reason, details)
        markReported(postId)
        setNoticeKey('community.report.success')
        closeReportModal()
      } catch (error: unknown) {
        setReportError(error)
      } finally {
        setIsSubmittingReport(false)
      }
    },
    [closeReportModal, markReported]
  )

  const handleWithdrawPost = useCallback(
    async (post: CommunityFeedItem) => {
      setActionError(null)
      try {
        await withdrawCommunityPostFromMobile(post.id)
      } catch (error: unknown) {
        // No optimistic removal, and no silent swallow: a failed withdraw leaves
        // the look in the feed and says so.
        setActionError({ error, fallbackKey: 'community.error.withdraw' })
        return
      }
      setNoticeKey('community.removed.withdrawn')
      // The server moves the row into `authorStates`; the client just re-reads.
      await loadFeed(mode, { refresh: true })
    },
    [loadFeed, mode]
  )

  const handleImageExpiry = useCallback(() => {
    void loadFeed(mode, { refresh: true })
  }, [loadFeed, mode])

  const openPostSheet = useCallback((optIntoChallenge: boolean) => {
    setChallengeOptIn(optIntoChallenge)
    setIsPostSheetVisible(true)
  }, [])

  const closePostSheet = useCallback(() => {
    setIsPostSheetVisible(false)
    focusNode(newPostButtonRef.current)
  }, [focusNode])

  const handlePostPublished = useCallback(() => {
    setNoticeKey('community.compose.success')
    // A freshly published look enters screening, so the server files it under
    // `authorStates` until moderation clears it. Re-read rather than guess where
    // it belongs; the acknowledgement the sheet hands back is not a feed row.
    void loadFeed(mode, { refresh: true })
  }, [loadFeed, mode])

  const actionErrorMessage = useMemo(() => {
    if (!actionError) {
      return null
    }
    const { key, options } = communityErrorTranslation(
      actionError.error,
      actionError.fallbackKey,
      locale
    )
    return t(key, options)
  }, [actionError, locale, t])

  const reportErrorMessage = useMemo(() => {
    if (!reportError) {
      return null
    }
    const { key, options } = communityErrorTranslation(
      reportError,
      'community.error.report',
      locale
    )
    return t(key, options)
  }, [locale, reportError, t])

  /** The deep-linked look is drawn once, above the grid; the feed page it also sits on must not draw it again. */
  const listItems = useMemo(
    () => (deepLinkPost ? items.filter((item) => item.id !== deepLinkPost.id) : items),
    [deepLinkPost, items]
  )

  const feedErrorMessage = useMemo(() => {
    const { key, options } = communityErrorTranslation(
      feedError,
      'community.error.load',
      locale
    )
    return t(key, options)
  }, [feedError, locale, t])

  /**
   * The surface's single polite live region. `InfoBanner` owns it, so the invalid
   * deep-link notice and every success confirmation share one channel; failures
   * go to the assertive alert panel below instead of competing for it.
   */
  const bannerMessage = isInvalidDeepLink
    ? t('community.deepLink.invalid')
    : noticeKey
      ? t(noticeKey)
      : null

  const dismissBanner = useCallback(() => {
    setIsInvalidDeepLink(false)
    setNoticeKey(null)
  }, [])

  const renderEmptyComponent = () => {
    if (feedState === 'loading') {
      return (
        <View
          style={styles.skeletonsContainer}
          accessibilityLabel={t('community.feed.loading')}
        >
          {[1, 2, 3].map((index) => (
            <View
              key={index}
              style={[
                styles.skeletonCard,
                { backgroundColor: palette.surface, borderColor: palette.divider },
              ]}
              testID="community-feed-skeleton"
            >
              <View
                style={[styles.skeletonHeader, { backgroundColor: palette.skeleton }]}
              />
              <View
                style={[styles.skeletonImage, { backgroundColor: palette.skeleton }]}
              />
              <View
                style={[styles.skeletonFooter, { backgroundColor: palette.skeleton }]}
              />
            </View>
          ))}
        </View>
      )
    }

    if (feedState === 'error') {
      return (
        <View style={styles.stateContainer} testID="community-feed-error">
          <Text style={[styles.stateTitle, { color: palette.text }]}>
            {t('community.feed.errorTitle')}
          </Text>
          <Text
            style={[styles.stateBody, styles.centeredText, { color: palette.mutedText }]}
          >
            {feedErrorMessage}
          </Text>
          <TouchableOpacity
            testID="community-feed-retry"
            style={[styles.primaryButton, { backgroundColor: ACCENT_GOLD }]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel={t('community.feed.retry')}
          >
            <Text style={[styles.primaryButtonText, { color: ON_ACCENT }]}>
              {t('community.feed.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.stateContainer} testID="community-feed-empty">
        <Text style={[styles.stateTitle, { color: palette.text }]}>
          {t('community.feed.emptyTitle')}
        </Text>
        <Text
          style={[styles.stateBody, styles.centeredText, { color: palette.mutedText }]}
        >
          {t('community.feed.emptyBody')}
        </Text>
        <TouchableOpacity
          testID="community-feed-empty-cta"
          style={[styles.primaryButton, { backgroundColor: ACCENT_GOLD }]}
          onPress={() => openPostSheet(false)}
          accessibilityRole="button"
          accessibilityLabel={t('community.share')}
        >
          <Text style={[styles.primaryButtonText, { color: ON_ACCENT }]}>
            {t('community.share')}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  const renderAuthorStates = () => {
    if (authorStates.length === 0) {
      return null
    }
    return (
      <View
        style={[
          styles.authorStates,
          { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
        ]}
        testID="community-author-states"
      >
        <Text style={[styles.authorStatesTitle, { color: palette.text }]}>
          {t('community.feed.yourPostsTitle')}
        </Text>
        <Text style={[styles.stateBody, { color: palette.mutedText }]}>
          {t('community.feed.yourPostsBody')}
        </Text>
        {authorStates.map((authorState) => (
          <View
            key={authorState.id}
            testID={`community-author-state-${authorState.id}`}
            accessible
            accessibilityRole="summary"
            style={[styles.authorStateRow, { borderColor: palette.divider }]}
          >
            <Text
              testID={`community-author-state-status-${authorState.id}`}
              style={[styles.authorStateStatus, { color: palette.text }]}
            >
              {t(`community.status.${authorState.status}`)}
            </Text>
            {EXPLAINED_AUTHOR_STATES.has(authorState.status) ? (
              <Text
                testID={`community-author-state-explanation-${authorState.id}`}
                style={[styles.stateBody, { color: palette.mutedText }]}
              >
                {t(`community.removed.${authorState.status}`)}
              </Text>
            ) : null}
            {authorState.moderationReason ? (
              <Text
                testID={`community-author-state-reason-${authorState.id}`}
                style={[styles.stateBody, { color: palette.mutedText }]}
              >
                {t('community.status.reason', { reason: authorState.moderationReason })}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    )
  }

  const renderHeaderComponent = () => (
    <View>
      {bannerMessage ? (
        <InfoBanner
          key={bannerMessage}
          message={bannerMessage}
          onDismiss={dismissBanner}
        />
      ) : null}
      {actionErrorMessage ? (
        <View
          testID="community-action-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.errorPanel, { backgroundColor: DESTRUCTIVE_MERLOT }]}
        >
          <Text style={[styles.errorText, { color: ON_DESTRUCTIVE }]}>
            {actionErrorMessage}
          </Text>
        </View>
      ) : null}
      {/*
        Every clause is load-bearing. `bandResolved` was never read, so the banner
        fired on the unresolved reason alone; and the reason is reported whenever
        the viewer's own band fails to resolve, whatever is being served. Someone
        who pinned a band, or chose "Every climate", was told "you are seeing every
        climate band" over a feed that was neither. Only `auto` falls back to every
        region because the band failed, so only `auto` has anything to explain.
      */}
      {servedMode === 'auto' && !bandResolved && bandUnresolvedReason ? (
        <View
          testID="community-band-unresolved"
          style={[
            styles.infoPanel,
            { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
          ]}
        >
          <Text style={[styles.stateBody, { color: palette.text }]}>
            {t(`community.band.unresolved.${bandUnresolvedReason}`)}
          </Text>
        </View>
      ) : null}
      {deepLinkPost ? (
        <View
          testID={`highlighted-community-card-${deepLinkPost.id}`}
          style={styles.highlightSection}
        >
          {/*
            Grouping is deliberate here and only here: the badge is one line of
            text, so collapsing it costs nothing, and it gives accessibility focus
            somewhere to land that announces why this look is at the top. The card
            below it stays ungrouped, so the reader walks into its alt text and
            controls exactly as they would in the feed.
          */}
          <View
            ref={targetRef}
            accessible
            accessibilityRole="header"
            style={styles.highlightBadgeRow}
          >
            <Text style={[styles.highlightBadge, { color: palette.text }]}>
              {t('community.deepLink.highlight')}
            </Text>
          </View>
          <CommunityCard
            item={deepLinkPost}
            isHighlighted
            isReported={reportedPostIds.has(deepLinkPost.id)}
            onReport={handleReportPost}
            onWithdraw={handleWithdrawPost}
            onImageExpiry={handleImageExpiry}
            onOpen={handleOpenCard}
          />
        </View>
      ) : null}
      {activeChallenge && (
        <CommunityChallengeBanner
          challenge={activeChallenge}
          onParticipate={() => openPostSheet(true)}
        />
      )}
      {renderAuthorStates()}
    </View>
  )

  const renderFooterComponent = () => {
    if (isLoadingMore) {
      return (
        <View style={styles.loadingMoreContainer} testID="community-feed-loading-more">
          <ActivityIndicator size="small" color={palette.text} />
          <Text style={[styles.stateBody, { color: palette.mutedText }]}>
            {t('community.feed.loadingMore')}
          </Text>
        </View>
      )
    }
    if (nextCursor && feedState === 'ready') {
      return (
        <View style={styles.loadingMoreContainer}>
          <TouchableOpacity
            testID="community-feed-load-more"
            style={[styles.outlineButton, { borderColor: palette.mutedText }]}
            onPress={handleLoadMore}
            accessibilityRole="button"
            accessibilityLabel={t('community.feed.loadMore')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.text }]}>
              {t('community.feed.loadMore')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    return <View style={styles.footerSpacing} />
  }

  return (
    <View
      style={[styles.container, { backgroundColor: palette.background }]}
      testID="community-screen"
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>
          {t('community.title')}
        </Text>
        <TouchableOpacity
          ref={newPostButtonRef}
          testID="community-new-post-button"
          style={[styles.primaryButton, { backgroundColor: ACCENT_GOLD }]}
          onPress={() => openPostSheet(false)}
          accessibilityRole="button"
          accessibilityLabel={t('community.newPost')}
        >
          <Text style={[styles.primaryButtonText, { color: ON_ACCENT }]}>
            {t('community.newPost')}
          </Text>
        </TouchableOpacity>
      </View>

      <CommunityFilterChips
        selectedMode={servedMode}
        onSelectMode={handleSelectMode}
        viewerBand={viewerBand}
      />

      <FlatList
        data={feedState === 'loading' ? [] : listItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CommunityCard
            item={item}
            isReported={reportedPostIds.has(item.id)}
            containerRef={(node) => {
              cardRefs.current.set(item.id, node)
            }}
            onReport={handleReportPost}
            onWithdraw={handleWithdrawPost}
            onImageExpiry={handleImageExpiry}
            onOpen={handleOpenCard}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={ACCENT_GOLD}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={renderHeaderComponent}
        ListEmptyComponent={renderEmptyComponent}
        ListFooterComponent={renderFooterComponent}
        contentContainerStyle={styles.listContent}
      />

      <CommunityReportModal
        visible={reportingPost !== null}
        post={reportingPost}
        errorMessage={reportErrorMessage}
        isSubmitting={isSubmittingReport}
        onClose={closeReportModal}
        onSubmit={handleSubmitReport}
      />

      <CommunityPostSheet
        visible={isPostSheetVisible}
        challenge={activeChallenge}
        defaultChallengeOptIn={challengeOptIn}
        onClose={closePostSheet}
        onPublished={handlePostPublished}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  outlineButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  highlightSection: {
    marginTop: 12,
  },
  highlightBadgeRow: {
    paddingHorizontal: 16,
  },
  highlightBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  infoPanel: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorPanel: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  authorStates: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  authorStatesTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  authorStateRow: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 6,
    gap: 4,
  },
  authorStateStatus: {
    fontSize: 13,
    fontWeight: '700',
  },
  skeletonsContainer: {
    paddingHorizontal: 16,
    gap: 16,
    marginTop: 12,
  },
  skeletonCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  skeletonHeader: {
    height: 32,
    width: '50%',
    borderRadius: 8,
    marginBottom: 12,
  },
  skeletonImage: {
    height: 240,
    borderRadius: 12,
    marginBottom: 12,
  },
  skeletonFooter: {
    height: 24,
    width: '70%',
    borderRadius: 6,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 10,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  centeredText: {
    textAlign: 'center',
  },
  loadingMoreContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  footerSpacing: {
    height: 16,
  },
})
