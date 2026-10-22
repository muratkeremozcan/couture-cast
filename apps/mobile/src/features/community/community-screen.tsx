import { resolveMobileApiBaseUrl } from '@/src/lib/api-client'
import {
  resolveMobileAccessToken,
  mobileApplicationUserId,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  abortError,
  ResponseError,
  withRequestDeadline,
  CommunityCommentsState,
  CommunityReactionState,
  CommunitySyncState,
  CommunityRequestSuperseded,
} from '@couture/api-client'
import { CommunityCommentsSheet } from '@/components/community/community-comments-sheet'
import {
  communityCommentsSessionFromMobile,
  communitySyncFromMobile,
  communityCommentsRootsFromMobile,
  communityCommentsRepliesFromMobile,
  communityCommentsSubmissionsFromMobile,
  communityCommentsCreateFromMobile,
  communityCommentsDeleteFromMobile,
  communityCommentsReportFromMobile,
  CommunityRequestError,
  communityFailureReason,
  generateIdempotencyKey,
  setCommunityReactionFromMobile,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  recordCommunityCardOpenedFromMobile,
  reportCommunityPostFromMobile,
  withdrawCommunityPostFromMobile,
} from '@/src/lib/community'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  AppState,
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
import {
  communityModerationReasonCategories,
  type CommunityReactionSummary,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityExperimentVariant,
  type CommunityReactionFeedItem as CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityReportReason,
  type EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import { InfoBanner } from '@/components/info-banner'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
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

function notificationFailureIsRetryable(error: unknown) {
  if (
    error instanceof CommunityRequestError &&
    ['signed_out', 'age_gate', 'not_found', 'disabled'].includes(error.reason)
  )
    return false
  const status =
    error instanceof CommunityRequestError
      ? error.httpStatus
      : error instanceof ResponseError
        ? error.response.status
        : undefined
  return status === undefined || status === 408 || status === 429 || status >= 500
}

type FeedState = 'loading' | 'ready' | 'error'

function isInitialFeedRequest(cursor: string | undefined, refresh: boolean): boolean {
  return cursor === undefined && !refresh
}

/**
 * What the author reads about a held post. A stable pipeline code such as
 * `text_policy_match` becomes localized copy that says what to change; only a
 * moderator's free-text takedown reason is shown as written. Mirrors the web
 * author-states section, which reads the same shared category map.
 */
function moderationReasonText(
  reason: string,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const categories = communityModerationReasonCategories(reason)
  if (categories === null) {
    return t('community.status.reason', { reason })
  }
  return categories
    .map((category) => t(`community.moderationReason.${category}`))
    .join(' ')
}

export function CommunityScreen() {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  const locale = useResolvedCommunityLocale(i18n.language)
  const analytics = useMobileAnalytics()
  const { source, type, cardId, commentId, parentId, expiresAt } = useLocalSearchParams()
  const targetRef = useRef<View>(null)
  const newPostButtonRef = useRef<View>(null)
  const cardRefs = useRef(new Map<string, View | null>())
  const [deepLinkPost, setDeepLinkPost] = useState<CommunityFeedItem | null>(null)
  const [commentTarget, setCommentTarget] = useState<
    | {
        commentId: string
        parentId: string | null
        pageCursor: string | null
        parentPageCursor: string | null
      }
    | undefined
  >()
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)

  // Feed state
  const [mode, setMode] = useState<CommunityFeedMode>('auto')
  const modeRef = useRef(mode)
  modeRef.current = mode
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
  const [communityAvailable, setCommunityAvailable] = useState(true)
  const [sessionScope, setSessionScope] = useState<string | null>(null)
  const sessionScopeRef = useRef<string | null | undefined>(undefined)
  const actionGenerationRef = useRef(0)
  const actionControllerRef = useRef<AbortController | null>(null)
  const [newLooks, setNewLooks] = useState<CommunityFeedItem[]>([])
  const newLooksRef = useRef(newLooks)
  newLooksRef.current = newLooks
  const [isInsertingLooks, setIsInsertingLooks] = useState(false)

  const [items, setItems] = useState<CommunityFeedItem[]>([])
  const realtimeDeepLink = useRef(deepLinkPost)
  realtimeDeepLink.current = deepLinkPost
  const realtimeItems = useRef(items)
  realtimeItems.current = items
  const realtimeOpenPost = useRef<string | null>(null)
  const handleReactionChange = useCallback(
    (postId: string, summary: CommunityReactionSummary | null | undefined) => {
      const update = (post: CommunityFeedItem | null): CommunityFeedItem | null => {
        if (!post || post.id !== postId) return post
        if (summary === null) return null
        if (summary === undefined) return { ...post, reactions: undefined }
        if (post.status !== 'published') return post
        if (
          post.reactions &&
          (post.reactions.revision > summary.revision ||
            post.reactions.generation > summary.generation)
        )
          return post
        return { ...post, reactions: summary }
      }
      setItems((previous) =>
        previous.flatMap((post) => {
          const next = update(post)
          return next ? [next] : []
        })
      )
      setDeepLinkPost(update)
    },
    []
  )
  const translationRef = useRef(t)
  translationRef.current = t
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null)
  realtimeOpenPost.current = commentsPostId
  const commentsInvokerRef = useRef<View | null>(null)
  const highlightedCommentsButtonRef = useRef<View | null>(null)
  const commentsButtonRefs = useRef(new Map<string, View | null>())
  const [comments] = useState(
    () =>
      new CommunityCommentsState(
        {
          locate: (input, signal) => communitySyncFromMobile().resolve(input, signal),
          roots: communityCommentsRootsFromMobile,
          replies: communityCommentsRepliesFromMobile,
          submissions: communityCommentsSubmissionsFromMobile,
          create: communityCommentsCreateFromMobile,
          delete: communityCommentsDeleteFromMobile,
          report: communityCommentsReportFromMobile,
        },
        generateIdempotencyKey,
        communityFailureReason,
        (postId) => setCommentsPostId((current) => (current === postId ? null : current))
      )
  )
  const [reactionState] = useState(
    () =>
      new CommunityReactionState({
        mutate: setCommunityReactionFromMobile,
        newId: generateIdempotencyKey,
        failureReason: communityFailureReason,
        onChange: handleReactionChange,
        onAnnounce: (key, success) => {
          AccessibilityInfo.announceForAccessibility(translationRef.current(key))
          if (success)
            void import('expo-haptics')
              .then((haptics) => haptics.selectionAsync())
              .catch(() => undefined)
        },
      })
  )
  useSyncExternalStore(
    reactionState.subscribe,
    reactionState.getVersion,
    reactionState.getVersion
  )
  const highlightedTargetRef = useRef<string | null>(null)
  const detailGenerationRef = useRef(0)
  const notificationIntentRef = useRef(0)
  const realtimeSyncRef = useRef<CommunitySyncState | null>(null)
  const [authorStates, setAuthorStates] = useState<CommunityAuthorPostState[]>([])
  const [nextCursor, setNextCursorState] = useState<string | null>(null)
  // The load-more control and onEndReached can both act on a render whose cursor a page
  // that just landed has already consumed. The ref holds the latest cursor, so a stale
  // handler cannot re-request a page that is already in the feed.
  const nextCursorRef = useRef<string | null>(null)
  const setNextCursor = useCallback((value: string | null) => {
    nextCursorRef.current = value
    setNextCursorState(value)
  }, [])
  const [viewerBand, setViewerBand] = useState<ClimateBand | null>(null)
  const [bandResolved, setBandResolved] = useState(true)
  const [bandUnresolvedReason, setBandUnresolvedReason] =
    useState<CommunityBandUnresolvedReason | null>(null)
  const [activeChallenge, setActiveChallenge] =
    useState<EmbeddedCommunityChallenge | null>(null)
  const [feedState, setFeedState] = useState<FeedState>('loading')
  const [feedError, setFeedError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingMore, setIsLoadingMoreState] = useState(false)
  // FlatList can call onEndReached in the same frame as a tap on the load-more control,
  // and both read one render's state, so a state-only guard let two next-page requests
  // start (the second aborted the first). The ref is the synchronous owner: one request
  // until it settles or a reset releases it.
  const loadingMoreRef = useRef(false)
  const setIsLoadingMore = useCallback((value: boolean) => {
    loadingMoreRef.current = value
    setIsLoadingMoreState(value)
  }, [])

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
    highlightedTargetRef.current = null
    if (!sessionScope) return
    const rawParams = { source, type, cardId, commentId, parentId, expiresAt }
    const fail = (_reason: string) => {
      setIsInvalidDeepLink(true)
      analytics.capture('deep_link_invalid', {
        rawUrl: 'community-notification',
        reason: 'target_unavailable',
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

    const payload = parsed.payload
    const targetPostId = parsed.payload.cardId
    highlightedTargetRef.current = targetPostId
    const intent = notificationIntentRef.current
    let detailGeneration = ++detailGenerationRef.current
    const readTicket = reactionState.beginRead()
    let active = true
    const controller = new AbortController()
    const operationTimer = setTimeout(() => controller.abort(), 10_000)
    /*
     * Resolved against the community API rather than assembled from the
     * notification's own payload. The synthetic card carried no image, no alt
     * text and no moderation controls, and it could only ever find a post whose
     * `lookbook:new` event was still inside the event-poll window, so a link to
     * anything older failed for a post that was still on the feed. The API is
     * also the only thing that knows whether THIS viewer may see the post: it
     * answers 404 for everything they may not.
     */
    const requestTarget = () =>
      payload.commentId
        ? withRequestDeadline(2000, [controller.signal], (signal) =>
            communitySyncFromMobile().resolve(
              {
                targets: [
                  {
                    key: 'notification',
                    postId: targetPostId,
                    ...(payload.commentId ? { commentId: payload.commentId } : {}),
                    ...(payload.parentId ? { parentId: payload.parentId } : {}),
                  },
                ],
              },
              signal
            )
          ).then((result) => result.targets[0])
        : getCommunityPostFromMobile(targetPostId, controller.signal, 2000).then(
            (post) => ({
              status: 'available' as const,
              post,
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
            })
          )
    const deadline = performance.now() + 10_000
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const targetRequest = async () => {
      do {
        detailGeneration = detailGenerationRef.current
        try {
          const target = await requestTarget()
          if (
            !active ||
            intent !== notificationIntentRef.current ||
            detailGeneration === detailGenerationRef.current
          )
            return target
        } catch (error) {
          if (
            !notificationFailureIsRetryable(error) ||
            controller.signal.aborted ||
            !active ||
            intent !== notificationIntentRef.current
          )
            throw error
          await new Promise<void>((resolve) => {
            retryTimer = setTimeout(
              resolve,
              Math.min(250, Math.max(0, deadline - performance.now()))
            )
          })
        }
      } while (active && !controller.signal.aborted && performance.now() < deadline)
      throw new CommunityRequestSuperseded()
    }
    let abortOperation: () => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      abortOperation = () => reject(abortError('Target verification is unavailable.'))
      controller.signal.addEventListener('abort', abortOperation, { once: true })
    })
    const reportHandled = () => {
      if (intent === notificationIntentRef.current)
        analytics.capture('deep_link_handled', {
          source: 'notification',
          type: 'community',
          surface: 'mobile',
        })
    }
    void Promise.race([targetRequest(), aborted])
      .then((target) => {
        if (!active || detailGeneration !== detailGenerationRef.current) return
        if (!target || target.status === 'unavailable') {
          if (target?.status === 'unavailable') {
            if (realtimeOpenPost.current === targetPostId) realtimeOpenPost.current = null
            if (realtimeDeepLink.current?.id === targetPostId)
              realtimeDeepLink.current = null
            newLooksRef.current = newLooksRef.current.filter(
              (item) => item.id !== targetPostId
            )
            setNewLooks(newLooksRef.current)
            reactionState.evict(targetPostId)
            comments.evict(targetPostId)
          }
          setDeepLinkPost(null)
          if (intent === notificationIntentRef.current) setIsInvalidDeepLink(true)
          return
        }
        const post = reactionState.read(target.post, readTicket)
        setDeepLinkPost(post)
        if (!post) return
        setIsInvalidDeepLink(false)
        reportHandled()
        setNoticeKey((previous) =>
          previous === 'community.realtime.unavailable' ? null : previous
        )
        const focus = target.comment ?? target.parent
        if (focus && intent === notificationIntentRef.current) {
          setCommentTarget({
            commentId: focus.id,
            parentId: target.comment?.parentId ?? null,
            pageCursor: target.comment ? target.pageCursor : target.parentPageCursor,
            parentPageCursor: target.parentPageCursor,
          })
          setCommentsPostId(target.post.id)
        }
      })
      .catch((error: unknown) => {
        if (!active || detailGeneration !== detailGenerationRef.current) {
          return
        }
        setDeepLinkPost(null)
        if (communityFailureReason(error) === 'not_found' && payload?.cardId) {
          reactionState.evict(targetPostId)
          comments.evict(targetPostId)
        }
        if (intent !== notificationIntentRef.current) return
        if (notificationFailureIsRetryable(error)) {
          setIsInvalidDeepLink(false)
          setNoticeKey('community.realtime.unavailable')
          return
        }
        fail(
          communityFailureReason(error) === 'not_found'
            ? 'Community card target was not found'
            : 'Community card target could not be loaded'
        )
      })
      .finally(() => {
        clearTimeout(operationTimer)
        clearTimeout(retryTimer)
        controller.signal.removeEventListener('abort', abortOperation)
      })
    return () => {
      active = false
      clearTimeout(operationTimer)
      controller.abort()
    }
  }, [
    source,
    type,
    sessionScope,
    cardId,
    commentId,
    parentId,
    expiresAt,
    analytics,
    reactionState,
    comments,
  ])

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

  /**
   * Mirrors web's own deep-link focus effect: focus lands on the card itself
   * (web calls `cardElement.focus()`), and `community.feed.announceFocused` is
   * the same key web already announces through its own live region. Reusing it
   * means the two surfaces need no new locale key for this, and no separate
   * visible badge either -- web's highlighted card carries no such badge, only a
   * border treatment, which is what `CommunityCard`'s `isHighlighted` prop gives
   * mobile already.
   */
  const focusedTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deepLinkPost || commentTarget) {
      return
    }
    if (focusedTargetRef.current === deepLinkPost.id) return
    focusedTargetRef.current = deepLinkPost.id
    AccessibilityInfo.announceForAccessibility(t('community.feed.announceFocused'))
    focusNode(targetRef.current)
  }, [focusNode, deepLinkPost, commentTarget, t])

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

  const revalidateHighlighted = useCallback(
    async (
      target: string | null,
      readTicket: number,
      signal: AbortSignal,
      generation: number
    ) => {
      if (!target) return
      const detailGeneration = ++detailGenerationRef.current
      const isCurrent = () =>
        generation === requestGenerationRef.current &&
        detailGeneration === detailGenerationRef.current
      try {
        const post = await getCommunityPostFromMobile(target, signal)
        if (isCurrent()) setDeepLinkPost(reactionState.read(post, readTicket))
      } catch (error: unknown) {
        if (isCurrent() && communityFailureReason(error) === 'not_found') {
          reactionState.evict(target)
          comments.evict(target)
          setIsInvalidDeepLink(true)
        }
      }
    },
    [reactionState]
  )

  const loadFeed = useCallback(
    async (
      targetMode: CommunityFeedMode,
      { cursor, refresh = false }: { cursor?: string; refresh?: boolean } = {}
    ): Promise<void> => {
      const readTicket = reactionState.beginRead()
      if (cursor !== undefined && rejectedCursorsRef.current.has(cursor)) {
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      const isCurrent = () =>
        !controller.signal.aborted && generation === requestGenerationRef.current

      const isFirstPage = isInitialFeedRequest(cursor, refresh)
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
            if (!isCurrent()) {
              return
            }
            const isAppend = pageCursor !== undefined
            const page = feed.items.flatMap((post) => {
              const current = reactionState.read(post, readTicket)
              return current ? [current] : []
            })
            setItems((previous) => {
              const seen = new Set(previous.map((item) => item.id))
              return (
                isAppend
                  ? [...previous, ...page.filter((item) => !seen.has(item.id))]
                  : page
              ).map((post) => reactionState.current(post))
            })
            setDeepLinkPost((post) => (post ? reactionState.current(post) : null))
            await revalidateHighlighted(
              refresh ? highlightedTargetRef.current : null,
              readTicket,
              controller.signal,
              generation
            )
            if (!isCurrent()) {
              return
            }
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
            if (!isCurrent()) {
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
    [reactionState, revalidateHighlighted]
  )

  useEffect(() => {
    let active = true
    let syncing = false
    const assignIdentity = (identity: string | null) => {
      const previous = sessionScopeRef.current
      sessionScopeRef.current = identity
      comments.setSession(identity)
      setSessionScope(identity)
      if (previous === undefined || previous === identity) return
      requestGenerationRef.current++
      detailGenerationRef.current++
      actionGenerationRef.current++
      controllerRef.current?.abort()
      actionControllerRef.current?.abort()
      reactionState.reset()
      setItems([])
      realtimeItems.current = []
      setNewLooks([])
      setAuthorStates([])
      setNextCursor(null)
      setDeepLinkPost(null)
      setCommentsPostId(null)
      setCommentTarget(undefined)
      setReportingPost(null)
      setReportedPostIds(new Set())
      setIsSubmittingReport(false)
      setIsPostSheetVisible(false)
      if (identity) void loadFeed(modeRef.current)
    }
    const sync = async () => {
      if (syncing) return
      syncing = true
      try {
        const identity = await communityCommentsSessionFromMobile()
        if (active) assignIdentity(identity)
      } catch {
        /* Transient token/storage failure retains permitted same-owner drafts. */
      } finally {
        syncing = false
      }
    }
    void sync()
    const unsubscribeIdentity = subscribeMobileApplicationUser(() => {
      assignIdentity(mobileApplicationUserId())
      void sync()
    })
    const timer = setInterval(() => {
      void sync()
    }, 1000)
    return () => {
      active = false
      unsubscribeIdentity()
      clearInterval(timer)
      comments.reset()
    }
  }, [comments, reactionState, loadFeed])

  useEffect(() => {
    void loadFeed(mode)
    return () => controllerRef.current?.abort()
  }, [loadFeed, mode])

  const insertNewLooks = async () => {
    if (isInsertingLooks) return
    const generation = detailGenerationRef.current
    const ticket = reactionState.beginRead()
    const buffered = newLooksRef.current
    setIsInsertingLooks(true)
    try {
      const fresh: CommunityFeedItem[] = []
      for (let offset = 0; offset < buffered.length; offset += 50) {
        const result = await withRequestDeadline(2000, [], (signal) =>
          communitySyncFromMobile().resolve(
            {
              targets: buffered
                .slice(offset, offset + 50)
                .map((post) => ({ key: post.id, postId: post.id })),
            },
            signal
          )
        )
        if (generation !== detailGenerationRef.current) return
        for (const target of result.targets)
          if (target.status === 'available') {
            const post = reactionState.read(target.post, ticket)
            if (post) fresh.push(post)
          }
      }
      setItems((previous) => [
        ...new Map([...fresh, ...previous].map((post) => [post.id, post])).values(),
      ])
      newLooksRef.current = []
      setNewLooks([])
    } catch {
      if (generation === detailGenerationRef.current) realtimeSyncRef.current?.recover()
    } finally {
      setIsInsertingLooks(false)
    }
  }

  useEffect(() => {
    if (!sessionScope) return
    let active = true
    const refreshFeed = async (signal?: AbortSignal) => {
      const generation = requestGenerationRef.current
      const page = await getCommunityFeedFromMobile({
        mode,
        limit: FEED_PAGE_SIZE,
        signal,
      })
      if (!active) return
      if (signal?.aborted) throw new CommunityRequestSuperseded()
      if (generation !== requestGenerationRef.current)
        throw new CommunityRequestSuperseded()
      setAuthorStates(page.authorStates)
      setNextCursor(page.nextCursor)
      setServedMode(page.mode)
      setViewerBand(page.viewerBand)
      setActiveChallenge(page.activeChallenge)
      setIsLoadingMore(false)
      setIsRefreshing(false)
      setFeedState('ready')

      const ids = new Set(realtimeItems.current.map((item) => item.id))
      const incoming = page.items.filter((item) => !ids.has(item.id))
      if (!realtimeItems.current.length) setItems(page.items)
      else if (incoming.length) {
        const buffered = [
          ...new Map(
            [...incoming, ...newLooksRef.current].map((item) => [item.id, item])
          ).values(),
        ]
        newLooksRef.current = buffered
        setNewLooks(buffered)
        AccessibilityInfo.announceForAccessibility(
          translationRef.current('community.realtime.newLooks', {
            count: incoming.length,
          })
        )
      }
    }
    const sync = new CommunitySyncState(communitySyncFromMobile(), mode, {
      rendered: () => [
        ...realtimeItems.current.map((item) => item.id),
        ...(realtimeOpenPost.current ? [realtimeOpenPost.current] : []),
        ...newLooksRef.current.map((item) => item.id),
        ...(realtimeDeepLink.current ? [realtimeDeepLink.current.id] : []),
      ],
      rebuild: refreshFeed,
      reconcile: async (signal) => {
        const post = realtimeOpenPost.current
        if (post) await comments.refresh(post, signal)
      },
      apply: (target) => {
        if (!active) return
        if (target.status === 'unavailable') {
          requestGenerationRef.current++
          detailGenerationRef.current++
          if (realtimeOpenPost.current === target.key) realtimeOpenPost.current = null
          if (realtimeDeepLink.current?.id === target.key) realtimeDeepLink.current = null
          controllerRef.current?.abort()
          setIsLoadingMore(false)
          setIsRefreshing(false)
          newLooksRef.current = newLooksRef.current.filter(
            (item) => item.id !== target.key
          )
          setNewLooks(newLooksRef.current)
          reactionState.evict(target.key)
          comments.evict(target.key)
          setItems((previous) => previous.filter((item) => item.id !== target.key))
          setDeepLinkPost((item) => (item?.id === target.key ? null : item))
          setCommentsPostId((current) => (current === target.key ? null : current))
        } else {
          const updated = reactionState.read(target.post, reactionState.beginRead())
          if (!updated) return
          newLooksRef.current = newLooksRef.current.map((item) =>
            item.id === target.post.id ? updated : item
          )
          setNewLooks(newLooksRef.current)
          setItems((previous) =>
            previous.map((item) => (item.id === target.post.id ? updated : item))
          )
          setDeepLinkPost((item) => (item?.id === target.post.id ? updated : item))
        }
      },
      changed: async (events, signal) => {
        requestGenerationRef.current++
        detailGenerationRef.current++
        controllerRef.current?.abort()
        setIsLoadingMore(false)
        setIsRefreshing(false)
        if (events.some((event) => event.kind === 'post.published'))
          await refreshFeed(signal)
      },
      availability: (state, realtime) => {
        if (!active) return
        comments.setRealtimeHealthy(state === 'connected' && Boolean(realtime))
        setCommunityAvailable(state === 'connected')
        if (state !== 'connected' && state !== 'recovering') {
          requestGenerationRef.current++
          detailGenerationRef.current++
          setIsLoadingMore(false)
          setIsRefreshing(false)
          controllerRef.current?.abort()
        }
        if (state === 'connected') {
          setFeedState('ready')
          setFeedError(null)
        }
        if (state === 'denied') {
          actionControllerRef.current?.abort()
          setIsSubmittingReport(false)
          actionGenerationRef.current++
          comments.reset()
          reactionState.reset()
          setItems([])
          setNewLooks([])
          setCommentsPostId(null)
        }
      },
    })
    realtimeSyncRef.current = sync
    sync.start(resolveMobileApiBaseUrl(), resolveMobileAccessToken)
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync.foreground()
    })
    return () => {
      active = false
      sync.stop()
      if (realtimeSyncRef.current === sync) realtimeSyncRef.current = null
      comments.setRealtimeHealthy(false)
      lifecycle.remove()
    }
  }, [comments, mode, reactionState, sessionScope])

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
    const cursor = nextCursorRef.current
    if (cursor && !loadingMoreRef.current && feedState === 'ready' && !isRefreshing) {
      void loadFeed(mode, { cursor })
    }
  }, [feedState, isRefreshing, loadFeed, mode])

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
      if (!communityAvailable) return
      const generation = actionGenerationRef.current
      const controller = new AbortController()
      actionControllerRef.current?.abort()
      actionControllerRef.current = controller
      setIsSubmittingReport(true)
      setReportError(null)
      try {
        await reportCommunityPostFromMobile(postId, reason, details, controller.signal)
        if (controller.signal.aborted || generation !== actionGenerationRef.current)
          return
        markReported(postId)
        setNoticeKey('community.report.success')
        closeReportModal()
      } catch (error: unknown) {
        if (controller.signal.aborted || generation !== actionGenerationRef.current)
          return
        setReportError(error)
      } finally {
        if (!controller.signal.aborted) setIsSubmittingReport(false)
      }
    },
    [closeReportModal, markReported, communityAvailable]
  )

  const handleWithdrawPost = useCallback(
    async (post: CommunityFeedItem) => {
      if (!communityAvailable) return
      const generation = actionGenerationRef.current
      const controller = new AbortController()
      actionControllerRef.current?.abort()
      actionControllerRef.current = controller
      setActionError(null)
      try {
        await withdrawCommunityPostFromMobile(post.id, controller.signal)
        if (controller.signal.aborted || generation !== actionGenerationRef.current)
          return
      } catch (error: unknown) {
        if (controller.signal.aborted || generation !== actionGenerationRef.current)
          return
        // No optimistic removal, and no silent swallow: a failed withdraw leaves
        // the look in the feed and says so.
        setActionError({ error, fallbackKey: 'community.error.withdraw' })
        return
      }
      setNoticeKey('community.removed.withdrawn')
      // The server moves the row into `authorStates`; the client just re-reads.
      await loadFeed(mode, { refresh: true })
    },
    [loadFeed, mode, communityAvailable]
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
    if (!communityAvailable)
      return (
        <View style={styles.stateContainer} testID="community-feed-unavailable">
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.stateBody, { color: palette.mutedText }]}
          >
            {t('community.realtime.unavailable')}
          </Text>
        </View>
      )

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
    if (!communityAvailable || authorStates.length === 0) {
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
                {moderationReasonText(authorState.moderationReason, t)}
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
      {deepLinkPost && communityAvailable ? (
        <View
          testID={`highlighted-community-card-${deepLinkPost.id}`}
          style={styles.highlightSection}
        >
          <CommunityCard
            onComments={(post) => {
              notificationIntentRef.current++
              commentsInvokerRef.current = highlightedCommentsButtonRef.current
              setCommentsPostId(post.id)
            }}
            commentsButtonRef={(node) => {
              highlightedCommentsButtonRef.current = node
            }}
            reactionControls={reactionState.controls(deepLinkPost.id)}
            item={deepLinkPost}
            isHighlighted
            containerRef={targetRef}
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
      {/* The tab header already names the screen, as on every other tab. */}
      <View style={styles.header}>
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

      {newLooks.length > 0 && communityAvailable && (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.primaryButton, { backgroundColor: ACCENT_GOLD }]}
          disabled={isInsertingLooks}
          onPress={() => {
            void insertNewLooks()
          }}
        >
          <Text style={{ color: ON_ACCENT }}>
            {t('community.realtime.showNewLooks', { count: newLooks.length })}
          </Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={feedState === 'loading' || !communityAvailable ? [] : listItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CommunityCard
            onComments={(post) => {
              notificationIntentRef.current++
              commentsInvokerRef.current = commentsButtonRefs.current.get(post.id) ?? null
              setCommentsPostId(post.id)
            }}
            commentsButtonRef={(node) => {
              commentsButtonRefs.current.set(item.id, node)
            }}
            reactionControls={reactionState.controls(item.id)}
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
        ListHeaderComponent={renderHeaderComponent()}
        ListEmptyComponent={renderEmptyComponent}
        ListFooterComponent={renderFooterComponent}
        contentContainerStyle={styles.listContent}
      />

      <CommunityReportModal
        suspended={!communityAvailable}
        visible={reportingPost !== null}
        post={reportingPost}
        errorMessage={reportErrorMessage}
        isSubmitting={isSubmittingReport}
        onClose={closeReportModal}
        onSubmit={handleSubmitReport}
      />

      <CommunityCommentsSheet
        postId={communityAvailable ? commentsPostId : null}
        target={commentsPostId === deepLinkPost?.id ? commentTarget : undefined}
        state={comments}
        locale={locale}
        onClose={() => {
          notificationIntentRef.current++
          if (commentsPostId) comments.retireFocus(commentsPostId)
          setCommentTarget(undefined)
          const highlighted =
            deepLinkPost?.id === commentsPostId
              ? highlightedCommentsButtonRef.current
              : null
          const feed = commentsPostId
            ? (commentsButtonRefs.current.get(commentsPostId) ?? null)
            : null
          const original = commentsInvokerRef.current
          const target =
            original && (original === highlighted || original === feed)
              ? original
              : (highlighted ?? feed)
          const node = safeFindNodeHandle(target)
          setCommentsPostId(null)
          if (node) AccessibilityInfo.setAccessibilityFocus(node)
        }}
      />
      <CommunityPostSheet
        key={sessionScope ?? 'anonymous'}
        suspended={!communityAvailable}
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
    justifyContent: 'flex-end',
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
