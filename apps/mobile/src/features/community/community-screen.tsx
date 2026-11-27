import type { SavedCommunityText } from '@/components/community/community-post-text-editor'
// Story 6.7 mobile destination owner: intent copy, outcomes and the focused notice in `apps/mobile/src/features/community/community-screen.tsx`, with handled-request retirement in `apps/mobile/src/features/community/use-community-spotlight.ts`
// Step 58 step 7 owner: searchable owner anchor
import { useAndroidSpotlightDetailPresentation } from '@/components/android-spotlight-detail-presentation'
import {
  ScreenShareCardComposer,
  useShareCardPresentationOpener,
} from '@/components/android-share-card-presentation'
import { focusShareCardElement, shareCardHeadingNode } from '@/src/lib/share-card-focus'
import {
  type ShareCardSource,
  abortError,
  ResponseError,
  withRequestDeadline,
  CommunityCommentsState,
  CommunityReactionState,
  CommunitySyncState,
  CommunityRequestSuperseded,
  CommunityVerification,
} from '@couture/api-client'
import { onLocationsChanged } from '@/src/lib/locations'
import { resolveMobileApiBaseUrl } from '@/src/lib/api-client'
import {
  resolveMobileAccessToken,
  mobileApplicationUserId,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { CommunityCommentsSheet } from '@/components/community/community-comments-sheet'
import { CommunityBannedNotice } from './community-banned-notice'
import { useCommunityScrollRestore } from './use-community-scroll-restore'
import { CommunityCommentDrafts } from './community-comment-drafts'
import { CommunityExampleInspiration } from './community-example-inspiration'
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
  communitySanctionOf,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  recordCommunityCardOpenedFromMobile,
  recordCommunitySpotlightOpenedFromMobile,
  reportCommunityPostFromMobile,
  withdrawCommunityPostFromMobile,
} from '@/src/lib/community'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  AppState,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router'
import {
  communityFeedClimate,
  hasDeepLinkIntent,
  mergeCommunityLooks,
  parseDeepLink,
} from '@couture/utils'
import {
  type CommunityBannedError,
  CommunityPostTextLedger,
  communityModerationReasonCategories,
  reconcileCommunityPostText,
  type CommunityReactionSummary,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityExperimentVariant,
  type CommunitySponsoredFeedItem as CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityReactionSpotlightItem,
  type CommunityReportReason,
  type EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import { InfoBanner } from '@/components/info-banner'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { TAB_BODY_INSET } from '@/src/theme/tokens'
import { CommunityFilterChips } from '@/components/community/community-filter-chips'
import { CommunityChallengeBanner } from '@/components/community/community-challenge-banner'
import { CommunityCard } from '@/components/community/community-card'
import { CommunityReportModal } from '@/components/community/community-report-modal'
import { CommunitySpotlightDetail } from '@/components/community/community-spotlight-detail'
import { SponsoredCtaImpressions } from '@/src/features/community/sponsored-cta-impressions'
import { LiveCommunitySponsorships } from '@/src/features/community/live-sponsorships'
import { LiveFontMountMarker } from '@/components/live-font-mount-marker'
import { ScreenGate } from '@/src/components/screen-gate'
import { useStatusBar } from '@/components/save-feedback'
import {
  useCommunitySpotlight,
  type CommunitySpotlightView,
  type SpotlightStatus,
} from '@/src/features/community/use-community-spotlight'
import {
  CommunityPostSheet,
  communityErrorTranslation,
  useResolvedCommunityLocale,
} from '@/components/community/community-post-sheet'

// Story CC-7.9 D3: New post is the screen's one main action, so it alone is `primary` (gold).
// Retry and the empty state's Share are neutral outline buttons, the new-looks pill is
// `inverse`, pull-to-refresh spins in `ink`, and an action error is the danger panel.

const FEED_PAGE_SIZE = 12
/**
 * Least time left in which a notification target attempt may start: one bearer read, one
 * request and its answer. Below it the attempt would leave after the 10 s operation bound.
 */
const MINIMUM_TARGET_ATTEMPT_MS = 250
/** Story 6.7: how long a teaser focus intent waits for a loading spotlight module. */
export const SPOTLIGHT_FOCUS_WAIT_MS = 10_000

/** Story 6.7: a Home teaser activation, copied out of the route params once per token. */
interface SpotlightFocusIntent {
  cardId: string
  focusToken: string
  receivedAt: number
}

type SpotlightNoticeKey =
  | 'community.spotlight.targetUnavailable'
  | 'community.spotlight.destinationUnavailable'

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

export type FeedState = 'loading' | 'ready' | 'error'

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

/**
 * R48: the open post outlives a blur, and access can return while another tab is on
 * screen. The comments sheet mounts, and gives back composer focus, only while verified
 * content shows on a focused Community screen.
 */
function sheetPostId(
  postId: string | null,
  available: boolean,
  focused: boolean
): string | null {
  return available && focused ? postId : null
}

/** Story CC-7.11 D16: the Community top bar's New post action, the screen's one primary. */
function CommunityNewPostButton({
  buttonRef,
  onPress,
}: {
  buttonRef: RefObject<View | null>
  onPress: () => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  return (
    <View style={styles.topBarAction}>
      <TouchableOpacity
        ref={buttonRef}
        testID="community-new-post-button"
        style={[styles.primaryButton, { backgroundColor: palette.primary }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('community.calm.post')}
      >
        <Text
          style={[styles.primaryButtonText, { color: palette.onPrimary }]}
          testID="community-new-post-label"
        >
          {t('community.calm.post')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

function isRankedLook(post: CommunityFeedItem): post is CommunityReactionSpotlightItem {
  return 'rank' in post
}

/** Story CC-7.11 P5: the test id of Community's first own content, on the block that leads. */
function firstContentId(leads: boolean): string | undefined {
  return leads ? 'community-first-content' : undefined
}

function spotlightDetailForVisit<T>(
  item: T | null,
  available: boolean,
  currentVisit: boolean
) {
  return available && currentVisit ? item : null
}

/** Story CC-7.11 D12: the open feed detail's post as the feed holds it now, or null once gone. */
function liveFeedPost(
  shown: CommunityFeedItem | null,
  items: readonly CommunityFeedItem[],
  deepLinkPost: CommunityFeedItem | null
): CommunityFeedItem | null {
  if (!shown) return null
  const listed = items.find((post) => post.id === shown.id)
  if (listed) return listed
  return deepLinkPost?.id === shown.id ? deepLinkPost : null
}

type CommunityActionError = { error: unknown; fallbackKey: string }

/**
 * A feed read that failed after the first page spoke up beside the feed
 * (`community.error.load`). A later read that answers, a pull or a realtime rebuild, makes that
 * message stale, so it goes; an unrelated action's failure (a withdraw, a report) stays.
 */
function withoutStaleLoadError(
  current: CommunityActionError | null
): CommunityActionError | null {
  return current?.fallbackKey === 'community.error.load' ? null : current
}

export function CommunityScreen() {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  const locale = useResolvedCommunityLocale(i18n.language)
  const analytics = useMobileAnalytics()
  const { source, type, cardId, commentId, parentId, expiresAt, focus, focusToken } =
    useLocalSearchParams()
  const router = useRouter()
  const targetRef = useRef<View>(null)
  const climateTriggerRef = useRef<View>(null)
  const pendingNotificationFocus = useRef<{
    postId: string
    intent: number
    scope: string
  } | null>(null)
  const visibleFeedRows = useRef<readonly CommunityFeedItem[]>([])
  const newPostButtonRef = useRef<View>(null)
  const cardRefs = useRef(new Map<string, View>())
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
  // Story 6.7: the teaser focus intent and the notice that reports an outcome
  // other than the entry itself. The serial re-focuses a repeated notice.
  const [teaserTarget, setTeaserTarget] = useState<string | null>(null)
  const [dismissedChallenges, setDismissedChallenges] = useState<Set<string>>(new Set())
  const [spotlightIntent, setSpotlightIntent] = useState<SpotlightFocusIntent | null>(
    null
  )
  const seenFocusTokensRef = useRef(new Set<string>())
  const [spotlightNotice, setSpotlightNotice] = useState<{
    key: SpotlightNoticeKey
    serial: number
  } | null>(null)
  const spotlightNoticeSerialRef = useRef(0)
  const noticeRef = useRef<View>(null)

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
  const [realtimeAvailable, setCommunityAvailable] = useState(true)
  // Story 6.11: everything that follows availability closes with a ban.
  const [bannedSanction, setBannedSanction] = useState<
    CommunityBannedError['sanction'] | null
  >(null)
  const bannedRef = useRef(false)
  // A denial stops the sync for good, so an authorized read has to start a new one.
  const syncDeniedRef = useRef(false)
  const [syncEpoch, setSyncEpoch] = useState(0)
  const communityAvailable = realtimeAvailable && !bannedSanction
  // Undefined until the first identity resolution, so the spotlight can tell a
  // later sign-in apart from the first one.
  const [sessionScope, setSessionScope] = useState<string | null | undefined>(undefined)
  const sessionScopeRef = useRef<string | null | undefined>(undefined)
  const actionGenerationRef = useRef(0)
  const actionControllerRef = useRef<AbortController | null>(null)
  const [newLooks, setNewLooks] = useState<CommunityFeedItem[]>([])
  const newLooksRef = useRef(newLooks)
  newLooksRef.current = newLooks
  // Advances whenever the feed's scope (filter or session) changes. Buffered looks and an
  // insertion under way belong to the scope they started in.
  const feedScopeRef = useRef(0)
  const [isInsertingLooks, setIsInsertingLooks] = useState(false)

  const [items, setItems] = useState<CommunityFeedItem[]>([])
  const realtimeDeepLink = useRef(deepLinkPost)
  realtimeDeepLink.current = deepLinkPost
  const realtimeItems = useRef(items)
  realtimeItems.current = items
  const realtimeOpenPost = useRef<string | null>(null)
  // Story 6.6: spotlight copies reconcile through the same reaction owner.
  const spotlightReactionRef = useRef<
    CommunitySpotlightView['applyReactionChange'] | null
  >(null)
  const handleReactionChange = useCallback(
    (postId: string, summary: CommunityReactionSummary | null | undefined) => {
      spotlightReactionRef.current?.(postId, summary)
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
  // R46: the member's own unsent comments outlive an unverified-access hide.
  const [commentDrafts] = useState(() => new CommunityCommentDrafts())
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
  // Story 6.7b: the latest live sponsorship answer per post, for every copy.
  const [sponsorships] = useState(() => new LiveCommunitySponsorships())
  const [postTextLedger] = useState(() => new CommunityPostTextLedger())
  // Story CC-7.7 D4: a Spotlight refresh that failed over shown cards reports in the root
  // status bar, a floating slot, so the row and the feed below it stay where they are.
  const statusBar = useStatusBar()
  const spotlight = useCommunitySpotlight({
    sessionScope,
    reactionState,
    sponsorships,
    postTextLedger,
    onBanned: setBannedSanction,
    visiblePage: (page, append) => {
      if (!communityAvailable || (append && feedState !== 'ready')) return []
      const matching = mergeCommunityLooks(page, [], climate, teaserTarget)
      if (!append) return matching
      const shown = new Set(visibleFeedRows.current.map((item) => item.id))
      return matching.filter((item) => !shown.has(item.id))
    },
    onRefreshFailed: (retry) => {
      statusBar.showNotice({
        id: 'community-spotlight-refresh-failed',
        message: t('community.spotlight.error'),
        tone: 'error',
        actions: [
          {
            id: 'community-spotlight-refresh-retry',
            kind: 'retry',
            label: t('community.spotlight.retry'),
            onPress: retry,
          },
        ],
      })
    },
  })
  // Every live read (feed page, rebuild, single post, spotlight) applies its
  // sponsorship answers to the copies already on screen.
  useEffect(
    () =>
      sponsorships.subscribe(() => {
        setItems((previous) => sponsorships.applyAll(previous))
        newLooksRef.current = sponsorships.applyAll(newLooksRef.current)
        setNewLooks(newLooksRef.current)
        setDeepLinkPost((item) => (item ? sponsorships.apply(item) : item))
      }),
    [sponsorships]
  )
  spotlightReactionRef.current = spotlight.applyReactionChange
  // Read by the realtime callbacks, which outlive any one render.
  const spotlightRef = useRef(spotlight)
  spotlightRef.current = spotlight

  /**
   * Story 6.7: a teaser intent belongs to the visit that received it. Leaving
   * Community (the Home tab, Android back) retires the intent and any targeted
   * focus not yet carried out, so nothing resolves, announces or moves focus on
   * a screen the member has left. Declared before the intent effects, so their
   * first run already sees this visit as focused. The state re-runs them when
   * focus arrives after an intent the router delivered first; the ref guards
   * their timers and frames.
   */
  const openAndroidShareCard = useShareCardPresentationOpener()
  const shareCardInvoker = useRef<{
    node: (() => number | null) | null
    member: string | null
  }>({
    node: null,
    member: null,
  })
  const [shareCardSource, setShareCardSource] = useState<ShareCardSource | null>(null)
  const [shareCardOpen, setShareCardOpen] = useState(false)
  useEffect(() => {
    setShareCardSource(null)
    setShareCardOpen(false)
  }, [sessionScope])
  const openShareCard = (postId: string, opener: () => number | null) => {
    if (openAndroidShareCard({ kind: 'community_post', postId }, 'community', opener))
      return
    shareCardInvoker.current = { node: opener, member: mobileApplicationUserId() }
    setShareCardSource({ kind: 'community_post', postId })
    setShareCardOpen(true)
  }
  const screenFocusedRef = useRef(false)
  const [screenFocused, setScreenFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true
      setScreenFocused(true)
      return () => {
        setShareCardSource(null)
        setShareCardOpen(false)
        screenFocusedRef.current = false
        setScreenFocused(false)
        setSpotlightIntent(null)
        setTeaserTarget(null)
        pendingSpotlightFocus.current = null
        setDismissedChallenges(new Set())
        const request = spotlightRef.current.focusRequest
        if (request?.kind === 'targeted')
          spotlightRef.current.acknowledgeFocusRequest(request.serial)
      }
    }, [])
  )
  const retainedSpotlight = useAndroidSpotlightDetailPresentation()
  const [spotlightDetail, setSpotlightDetail] =
    useState<CommunityReactionSpotlightItem | null>(null)
  const spotlightRankRefs = useRef(new Map<string, View>())
  const pendingSpotlightFocus = useRef<string | null>(null)
  /** Where focus returns when a report opened from the spotlight closes. */
  const spotlightReturnRef = useRef<View | null>(null)
  /** A report or comments action chosen inside the detail, run once it has closed. */
  const pendingSpotlightActionRef = useRef<(() => void) | null>(null)
  // Story CC-7.11 D12: a regular feed card opens the same full-height detail as Spotlight.
  const [feedDetail, setFeedDetail] = useState<CommunityFeedItem | null>(null)
  // Story CC-7.11 D13: each layer's opener, recorded when it opens; EdgeToEdgeModal hands
  // accessibility focus back to it on close.
  const feedDetailOpenerRef = useRef<View | null>(null)
  const spotlightDetailOpenerRef = useRef<View | null>(null)
  const reportOpenerRef = useRef<View | null>(null)
  const postSheetOpenerRef = useRef<View | null>(null)
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
  const [actionError, setActionError] = useState<CommunityActionError | null>(null)

  useEffect(() => {
    highlightedTargetRef.current = null
    pendingNotificationFocus.current = null
    if (!sessionScope) return
    // Story 6.7: an in-app spotlight focus intent is resolved by its own effect
    // and never reaches the notification path or its invalid-link banner.
    if (source === 'app' && (focus !== undefined || focusToken !== undefined)) return
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
    const deadline = performance.now() + 10_000
    // The bearer is read first, so the admission check sees the time it took: an attempt
    // that can no longer dispatch and answer inside the 10 s bound is never started.
    // A live read: stamped as it starts, so an answer that lands after a newer
    // read of the same post cannot overwrite it.
    const readTargetPost = (timeout: number, token: string) => {
      const stamp = sponsorships.begin()
      return getCommunityPostFromMobile(
        targetPostId,
        controller.signal,
        timeout,
        token
      ).then((post) => {
        sponsorships.record([post], stamp)
        return post
      })
    }
    const requestTarget = async () => {
      const token = (await resolveMobileAccessToken()) ?? ''
      const remaining = deadline - performance.now()
      if (remaining < MINIMUM_TARGET_ATTEMPT_MS) throw new CommunityRequestSuperseded()
      const timeout = Math.min(2000, Math.floor(remaining))
      const textStamp = postTextLedger.begin()
      const target = payload.commentId
        ? await withRequestDeadline(timeout, [controller.signal], (signal) =>
            communitySyncFromMobile(token).resolve(
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
        : await readTargetPost(timeout, token).then((post) => ({
            status: 'available' as const,
            post,
            comment: null,
            parent: null,
            pageCursor: null,
            parentPageCursor: null,
          }))
      return { target, textStamp }
    }
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const targetRequest = async () => {
      do {
        detailGeneration = detailGenerationRef.current
        try {
          const attempt = await requestTarget()
          if (
            !active ||
            intent !== notificationIntentRef.current ||
            detailGeneration === detailGenerationRef.current
          )
            return attempt
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
      } while (
        active &&
        !controller.signal.aborted &&
        deadline - performance.now() >= MINIMUM_TARGET_ATTEMPT_MS
      )
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
    /** The target post is gone for this viewer: every copy and its state leave. */
    const forgetTarget = () => {
      if (realtimeOpenPost.current === targetPostId) realtimeOpenPost.current = null
      if (realtimeDeepLink.current?.id === targetPostId) realtimeDeepLink.current = null
      newLooksRef.current = newLooksRef.current.filter((item) => item.id !== targetPostId)
      setNewLooks(newLooksRef.current)
      postTextLedger.evict(targetPostId)
      reactionState.evict(targetPostId)
      comments.evict(targetPostId)
    }
    void Promise.race([targetRequest(), aborted])
      .then(({ target, textStamp }) => {
        if (!active || detailGeneration !== detailGenerationRef.current) return
        if (!target || target.status === 'unavailable') {
          if (target?.status === 'unavailable') forgetTarget()
          setDeepLinkPost(null)
          if (intent === notificationIntentRef.current) setIsInvalidDeepLink(true)
          return
        }
        // A comment target resolves through the sync route, which carries no
        // sponsorship answer; the latest live one applies.
        const post = reactionState.read(target.post, readTicket)
        setDeepLinkPost((current) =>
          post
            ? postTextLedger.reconcile(sponsorships.apply(post), textStamp, current)
            : post
        )
        if (!post) return
        setIsInvalidDeepLink(false)
        reportHandled()
        setNoticeKey((previous) =>
          previous === 'community.realtime.unavailable' ? null : previous
        )
        if (intent !== notificationIntentRef.current) return
        const focus = target.comment ?? target.parent
        if (!focus) {
          pendingNotificationFocus.current = {
            postId: post.id,
            intent,
            scope: sessionScope,
          }
          return
        }
        setCommentTarget({
          commentId: focus.id,
          parentId: target.comment?.parentId ?? null,
          pageCursor: target.comment ? target.pageCursor : target.parentPageCursor,
          parentPageCursor: target.parentPageCursor,
        })
        setCommentsPostId(target.post.id)
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
    focus,
    focusToken,
    analytics,
    postTextLedger,
    reactionState,
    comments,
  ])

  /**
   * Story 6.7: the first sight of a new token copies the intent into screen
   * state, then the spotlight params clear. Clearing never cancels the copy,
   * and a token already seen moves no focus.
   */
  useEffect(() => {
    if (source !== 'app' || (focus === undefined && focusToken === undefined)) return
    const parsed = parseDeepLink({ source, type, cardId, focus, focusToken })
    const payload = parsed.valid ? parsed.payload : undefined
    if (
      payload?.focus === 'spotlight' &&
      payload.cardId &&
      payload.focusToken &&
      !seenFocusTokensRef.current.has(payload.focusToken)
    ) {
      seenFocusTokensRef.current.add(payload.focusToken)
      setSpotlightNotice(null)
      setSpotlightIntent({
        cardId: payload.cardId,
        focusToken: payload.focusToken,
        receivedAt: Date.now(),
      })
    }
    router.setParams({
      source: undefined,
      type: undefined,
      cardId: undefined,
      focus: undefined,
      focusToken: undefined,
    })
  }, [source, type, cardId, focus, focusToken, router])

  const focusNode = useCallback((node: View | null, isCurrent?: () => boolean) => {
    if (Platform.OS === 'web' || !node) {
      return
    }
    requestAnimationFrame(() => {
      if (isCurrent && !isCurrent()) return
      const handle = safeFindNodeHandle(node)
      if (handle) {
        AccessibilityInfo.setAccessibilityFocus(handle)
      }
    })
  }, [])

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
        const stamp = sponsorships.begin()
        const textStamp = postTextLedger.begin()
        const post = await getCommunityPostFromMobile(target, signal)
        if (isCurrent()) sponsorships.record([post], stamp)
        if (isCurrent()) {
          const read = reactionState.read(post, readTicket)
          // Normalized as the state commits, so a newer answer recorded in the
          // meantime wins over this response's own block.
          setDeepLinkPost((current) =>
            read
              ? postTextLedger.reconcile(sponsorships.apply(read), textStamp, current)
              : read
          )
        }
      } catch (error: unknown) {
        if (isCurrent() && communityFailureReason(error) === 'not_found') {
          postTextLedger.evict(target)
          reactionState.evict(target)
          comments.evict(target)
          setIsInvalidDeepLink(true)
        }
      }
    },
    [postTextLedger, reactionState]
  )

  const reportFeedFailure = useCallback((error: unknown, isFirstPage: boolean) => {
    const sanction = communitySanctionOf(error)
    if (sanction) {
      setBannedSanction(sanction)
      setFeedError(null)
      setFeedState('ready')
      return
    }
    // A first page that fails owns the screen; a refresh or a next page that
    // fails keeps what is already on screen and speaks up beside it.
    if (isFirstPage) {
      setFeedError(error)
      setFeedState('error')
    } else {
      setActionError({ error, fallbackKey: 'community.error.load' })
    }
  }, [])

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
            const stamp = sponsorships.begin()
            const textStamp = postTextLedger.begin()
            const feed = await getCommunityFeedFromMobile({
              mode: targetMode,
              cursor: pageCursor,
              limit: FEED_PAGE_SIZE,
              signal: controller.signal,
            })
            if (!isCurrent()) {
              return
            }
            sponsorships.record(feed.items, stamp)
            const isAppend = pageCursor !== undefined
            const page = feed.items.flatMap((post) => {
              const current = reactionState.read(post, readTicket)
              return current ? [current] : []
            })
            setItems((previous) => {
              const previousById = new Map(previous.map((item) => [item.id, item]))
              const seen = new Set(previous.map((item) => item.id))
              // Normalized as the state commits: a page whose read started
              // before the latest recorded answer never shows its own block.
              return (
                isAppend
                  ? [...previous, ...page.filter((item) => !seen.has(item.id))]
                  : page
              ).map((post) =>
                postTextLedger.reconcile(
                  sponsorships.apply(reactionState.current(post)),
                  textStamp,
                  previousById.get(post.id)
                )
              )
            })
            setDeepLinkPost((post) =>
              post ? sponsorships.apply(reactionState.current(post)) : null
            )
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
            setActionError(withoutStaleLoadError)
            setBannedSanction(null)
            if (syncDeniedRef.current) {
              syncDeniedRef.current = false
              setCommunityAvailable(true)
              setSyncEpoch((epoch) => epoch + 1)
            }
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
            reportFeedFailure(error, isFirstPage)
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
    [postTextLedger, reactionState, revalidateHighlighted]
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
      // A sanction names one member's ban, so it leaves with that member.
      setBannedSanction(null)
      // An action error names what the previous member tried; it leaves with them too.
      setActionError(null)
      // A block is per viewer: a new member starts with no live answers.
      sponsorships.clear()
      postTextLedger.clear()
      commentDrafts.forgetAll()
      feedScopeRef.current++
      requestGenerationRef.current++
      detailGenerationRef.current++
      actionGenerationRef.current++
      controllerRef.current?.abort()
      actionControllerRef.current?.abort()
      reactionState.reset()
      setItems([])
      realtimeItems.current = []
      newLooksRef.current = []
      setNewLooks([])
      setAuthorStates([])
      setNextCursor(null)
      // The band and its no-location notice describe the previous member. Web
      // clears them the same way in clearScope.
      setViewerBand(null)
      setBandResolved(true)
      setBandUnresolvedReason(null)
      setDeepLinkPost(null)
      setCommentsPostId(null)
      setCommentTarget(undefined)
      setReportingPost(null)
      setSpotlightDetail(null)
      setFeedDetail(null)
      pendingSpotlightActionRef.current = null
      // A teaser intent belongs to the member who tapped it.
      setSpotlightIntent(null)
      setTeaserTarget(null)
      pendingSpotlightFocus.current = null
      setDismissedChallenges(new Set())
      setActiveChallenge(null)
      setSpotlightNotice(null)
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
        // A failed first resolution leaves no member to read the spotlight for, so
        // it idles as signed out until a later sync resolves one. The ref stays
        // undefined, so that later sync counts as the first resolution and keeps
        // the feed and drafts.
        if (active && sessionScopeRef.current === undefined)
          setSessionScope((current) => current ?? null)
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
  }, [commentDrafts, comments, postTextLedger, reactionState, loadFeed])

  useEffect(() => {
    void loadFeed(mode)
    return () => controllerRef.current?.abort()
  }, [loadFeed, mode])

  useEffect(() => {
    // Looks buffered under the previous filter are not part of this feed. Target
    // resolution stays filter-agnostic, so the buffer itself has to be dropped.
    feedScopeRef.current++
    newLooksRef.current = []
    setNewLooks([])
  }, [mode])

  const insertNewLooks = async () => {
    if (isInsertingLooks) return
    const scope = feedScopeRef.current
    const current = (generation: number) =>
      generation === detailGenerationRef.current && scope === feedScopeRef.current
    const generation = detailGenerationRef.current
    const ticket = reactionState.beginRead()
    const textStamp = postTextLedger.begin()
    const buffered = newLooksRef.current
    const bufferedById = new Map(buffered.map((post) => [post.id, post]))
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
        if (!current(generation)) return
        for (const target of result.targets)
          if (target.status === 'available') {
            const post = reactionState.read(target.post, ticket)
            if (post) fresh.push(post)
          }
      }
      setItems((previous) => {
        const previousById = new Map(previous.map((post) => [post.id, post]))
        const reconciledFresh = fresh.map((post) =>
          postTextLedger.reconcile(
            sponsorships.apply(post),
            textStamp,
            bufferedById.get(post.id) ?? previousById.get(post.id)
          )
        )
        return [
          ...new Map(
            [...reconciledFresh, ...previous].map((post) => [post.id, post])
          ).values(),
        ]
      })
      newLooksRef.current = []
      setNewLooks([])
    } catch {
      if (current(generation)) realtimeSyncRef.current?.recover()
    } finally {
      setIsInsertingLooks(false)
    }
  }

  useEffect(() => {
    if (!sessionScope) return
    let active = true
    const refreshFeed = async (signal?: AbortSignal) => {
      const generation = requestGenerationRef.current
      const stamp = sponsorships.begin()
      const textStamp = postTextLedger.begin()
      const page = await getCommunityFeedFromMobile({
        mode,
        limit: FEED_PAGE_SIZE,
        signal,
      })
      if (!active) return
      if (signal?.aborted) throw new CommunityRequestSuperseded()
      if (generation !== requestGenerationRef.current)
        throw new CommunityRequestSuperseded()
      // Story 6.7b: the rebuild is a live read, so it is the latest word on the
      // block of every post it carries, including posts already on screen.
      sponsorships.record(page.items, stamp)
      setAuthorStates(page.authorStates)
      setNextCursor(page.nextCursor)
      setServedMode(page.mode)
      setViewerBand(page.viewerBand)
      setBandResolved(page.bandResolved)
      setBandUnresolvedReason(page.bandUnresolvedReason)
      setActiveChallenge(page.activeChallenge)
      setIsLoadingMore(false)
      setIsRefreshing(false)
      // A realtime rebuild that answered is the same recovery as a pull that answered.
      setActionError(withoutStaleLoadError)
      setFeedState('ready')

      const ids = new Set(realtimeItems.current.map((item) => item.id))
      const incoming = page.items.filter((item) => !ids.has(item.id))
      if (!realtimeItems.current.length)
        setItems(() =>
          page.items.map((item) =>
            postTextLedger.reconcile(sponsorships.apply(item), textStamp)
          )
        )
      else if (incoming.length) {
        const existingBufferById = new Map(
          newLooksRef.current.map((item) => [item.id, item])
        )
        const reconciledIncoming = incoming.map((item) =>
          postTextLedger.reconcile(
            sponsorships.apply(item),
            textStamp,
            existingBufferById.get(item.id)
          )
        )
        const buffered = [
          ...new Map(
            [
              ...reconciledIncoming,
              ...newLooksRef.current.map((item) => sponsorships.apply(item)),
            ].map((item) => [item.id, item])
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
    // D3: shown content outlives a reconnect only while access was verified recently.
    const verification = new CommunityVerification(() => {
      if (active) setCommunityAvailable(false)
    })
    const sync = new CommunitySyncState(communitySyncFromMobile(), mode, {
      rendered: () => [
        ...realtimeItems.current.map((item) => item.id),
        ...(realtimeOpenPost.current ? [realtimeOpenPost.current] : []),
        ...newLooksRef.current.map((item) => item.id),
        ...(realtimeDeepLink.current ? [realtimeDeepLink.current.id] : []),
        // Spotlight posts can sit outside every feed page, and a hidden or
        // erased one must still leave the module.
        ...spotlightRef.current.items.map((item) => item.id),
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
          postTextLedger.evict(target.key)
          reactionState.evict(target.key)
          comments.evict(target.key)
          setItems((previous) => previous.filter((item) => item.id !== target.key))
          setDeepLinkPost((item) => (item?.id === target.key ? null : item))
          setCommentsPostId((current) => (current === target.key ? null : current))
          // Leaving the spotlight also closes its detail when it shows this post.
          spotlightRef.current.evict(target.key)
        } else {
          const updated = reactionState.read(target.post, reactionState.beginRead())
          if (!updated) return
          const merged = postTextLedger.reconcile(
            sponsorships.apply(updated),
            postTextLedger.begin()
          )
          postTextLedger.record(merged)
          // Story 6.7b: a resolved copy carries no sponsorship answer (the route
          // takes no opt-in), so each copy takes the latest live answer.
          const replace = <T extends CommunityFeedItem>(item: T) =>
            item.id === target.post.id
              ? reconcileCommunityPostText(merged as T, item)
              : item
          newLooksRef.current = newLooksRef.current.map(replace)
          setNewLooks(newLooksRef.current)
          setItems((previous) => previous.map(replace))
          setDeepLinkPost((item) => (item ? replace(item) : item))
          spotlightRef.current.applyPost(merged)
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
        // Only unverified or denied access hides content (D3/D9). While recovering, the
        // feed, drafts and focus stay for at most 8 s after the last successful
        // authorization, so routine reconnects and HTTP polling do not flicker. Content
        // hidden as unverified stays hidden until a catch-up reports 'connected'.
        const { visible, verify } = verification.update(state, realtime)
        if (state === 'connected') setCommunityAvailable(true)
        else if (!visible) setCommunityAvailable(false)
        if (verify) void realtimeSyncRef.current?.catchUp()
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
          // The socket authorized this member, so any ban has ended.
          setBannedSanction(null)
        }
        if (state === 'denied') {
          syncDeniedRef.current = true
          setIsPostSheetVisible(false)
          actionControllerRef.current?.abort()
          setIsSubmittingReport(false)
          actionGenerationRef.current++
          comments.reset()
          reactionState.reset()
          postTextLedger.clear()
          setItems([])
          setNewLooks([])
          setCommentsPostId(null)
          // A denied socket says nothing about why. One read asks, so a member banned while
          // the screen was open sees the notice.
          if (!bannedRef.current) {
            const scope = feedScopeRef.current
            void getCommunityFeedFromMobile({ mode, limit: 1 }).catch(
              (error: unknown) => {
                const sanction = communitySanctionOf(error)
                if (active && scope === feedScopeRef.current && sanction)
                  setBannedSanction(sanction)
              }
            )
          }
        }
      },
    })
    realtimeSyncRef.current = sync
    sync.start(resolveMobileApiBaseUrl(), resolveMobileAccessToken)
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      // Revalidate before restoring anything shown before the app went to background.
      verification.foreground()
      sync.foreground()
    })
    return () => {
      active = false
      verification.stop()
      sync.stop()
      if (realtimeSyncRef.current === sync) realtimeSyncRef.current = null
      comments.setRealtimeHealthy(false)
      lifecycle.remove()
    }
  }, [comments, mode, postTextLedger, reactionState, sessionScope, syncEpoch])

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
    if (modeRef.current === next) return
    setTeaserTarget(null)
    pendingSpotlightFocus.current = null
    setFeedState('loading')
    setNextCursor(null)
    setActionError(null)
    setMode(next)
    // Optimistic so the strip responds to the tap; the response corrects it when
    // the experiment serves a different arm than the one that was asked for.
    setServedMode(next)
  }, [])

  const reloadSpotlight = spotlight.reload
  const handleRefresh = useCallback(() => {
    void loadFeed(mode, { refresh: true })
    reloadSpotlight()
  }, [loadFeed, mode, reloadSpotlight])

  const handleRetry = useCallback(() => {
    void loadFeed(mode)
  }, [loadFeed, mode])

  // Story 1.2b: a saved or switched location changes the viewer's band and
  // spotlight area, so the feed and spotlight reload when any screen reports it.
  const refreshRef = useRef(handleRefresh)
  refreshRef.current = handleRefresh
  useEffect(() => onLocationsChanged(() => refreshRef.current()), [])

  const handleLoadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (cursor && !loadingMoreRef.current && feedState === 'ready' && !isRefreshing) {
      void loadFeed(mode, { cursor })
    }
  }, [feedState, isRefreshing, loadFeed, mode])

  const handleOpenCard = useCallback(
    (post: CommunityFeedItem) => {
      feedDetailOpenerRef.current =
        cardRefs.current.get(post.id) ??
        (deepLinkPost?.id === post.id ? targetRef.current : null)
      setFeedDetail(post)
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
    [deepLinkPost, experimentVariant]
  )

  /**
   * Story 6.6: a spotlight open records only the spotlight event with the
   * card's rank, then opens the detail. The feed's card open never fires here.
   */
  const spotlightLevel = spotlight.level
  const handleOpenSpotlight = useCallback(
    (post: CommunityReactionSpotlightItem) => {
      // The open carries the level the cards were served at; a `none` level
      // serves no cards, so there is nothing to record.
      if (spotlightLevel !== 'none')
        void recordCommunitySpotlightOpenedFromMobile(
          post.id,
          post.rank,
          spotlightLevel
        ).catch(() => undefined)
      spotlightDetailOpenerRef.current = spotlightRankRefs.current.get(post.id) ?? null
      retainedSpotlight.setPostId(post.id)
      setSpotlightDetail(post)
    },
    [spotlightLevel, retainedSpotlight.setPostId]
  )

  // A look that left the spotlight (hidden, erased, withdrawn or the member
  // changed) cannot stay open in its detail. While it stays, the detail shows the
  // live copy, so a refreshed image or realtime update reaches it too.
  const spotlightItems = spotlight.items
  useEffect(() => {
    if (!retainedSpotlight.managed) return
    if (!retainedSpotlight.active || !retainedSpotlight.postId) {
      setSpotlightDetail(null)
      return
    }
    if (spotlight.status === 'ready') {
      const fresh = spotlightItems.find((post) => post.id === retainedSpotlight.postId)
      setSpotlightDetail(fresh ?? null)
      if (!fresh) retainedSpotlight.setPostId(null)
    } else if (spotlight.status === 'disabled') {
      retainedSpotlight.setPostId(null)
      setSpotlightDetail(null)
    }
  }, [
    retainedSpotlight.managed,
    retainedSpotlight.active,
    retainedSpotlight.postId,
    retainedSpotlight.setPostId,
    spotlight.status,
    spotlightItems,
  ])
  const spotlightDetailItem = spotlightDetail
    ? (spotlightItems.find((post) => post.id === spotlightDetail.id) ?? null)
    : null
  useEffect(() => {
    if (spotlightDetail && !spotlightItems.some((post) => post.id === spotlightDetail.id))
      setSpotlightDetail(null)
  }, [spotlightDetail, spotlightItems])

  const focusSpotlightTitle = useCallback((postId: string) => {
    requestAnimationFrame(() => {
      if (!screenFocusedRef.current || pendingSpotlightFocus.current !== postId) return
      const handle = safeFindNodeHandle(spotlightRankRefs.current.get(postId) ?? null)
      if (!handle) return
      pendingSpotlightFocus.current = null
      AccessibilityInfo.setAccessibilityFocus(handle)
    })
  }, [])

  const registerSpotlightTitle = useCallback(
    (postId: string, node: View | null) => {
      if (node) {
        spotlightRankRefs.current.set(postId, node)
        if (pendingSpotlightFocus.current === postId) focusSpotlightTitle(postId)
      } else {
        spotlightRankRefs.current.delete(postId)
      }
    },
    [focusSpotlightTitle]
  )

  const runPendingSpotlightAction = useCallback(() => {
    const action = pendingSpotlightActionRef.current
    pendingSpotlightActionRef.current = null
    action?.()
  }, [])

  const closeSpotlightDetail = useCallback(
    (action?: () => void) => {
      retainedSpotlight.setPostId(null)
      setSpotlightDetail(null)
      if (action) {
        // The action's own layer takes focus, so the rank does not.
        spotlightDetailOpenerRef.current = null
        pendingSpotlightActionRef.current = action
        // iOS cannot present a second modal while this one is still leaving, so
        // the action waits for its dismissal there; other platforms run it now.
        if (Platform.OS !== 'ios') runPendingSpotlightAction()
      }
    },
    [runPendingSpotlightAction, retainedSpotlight.setPostId]
  )

  /** Closes a feed post's detail; an action from inside it runs once the layer has gone. */
  const closeFeedDetail = useCallback(
    (action?: () => void) => {
      setFeedDetail(null)
      if (!action) return
      feedDetailOpenerRef.current = null
      pendingSpotlightActionRef.current = action
      if (Platform.OS !== 'ios') runPendingSpotlightAction()
    },
    [runPendingSpotlightAction]
  )
  const feedDetailItem = liveFeedPost(feedDetail, items, deepLinkPost)

  const markReported = useCallback((postId: string) => {
    setReportedPostIds((previous) => new Set(previous).add(postId))
  }, [])

  const handleReportPost = useCallback(
    (post: CommunityFeedItem, opener?: View | null) => {
      // A report from the Spotlight returns to its rank, any other to the reported card.
      reportOpenerRef.current =
        opener ?? spotlightReturnRef.current ?? cardRefs.current.get(post.id) ?? null
      spotlightReturnRef.current = null
      setReportError(null)
      setReportingPost(post)
    },
    []
  )

  const closeReportModal = useCallback(() => {
    setReportingPost(null)
    setReportError(null)
  }, [])

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
      // The spotlight ranks public posts only and never serves a withdrawn one
      // again, so its copy and any detail showing it leave now.
      spotlightRef.current.evict(post.id)
      // The server moves the row into `authorStates`; the client just re-reads.
      await loadFeed(mode, { refresh: true })
    },
    [loadFeed, mode, communityAvailable]
  )

  const handleImageExpiry = useCallback(() => {
    void loadFeed(mode, { refresh: true })
  }, [loadFeed, mode])

  const openPostSheet = useCallback((optIntoChallenge: boolean, opener?: View | null) => {
    postSheetOpenerRef.current = opener ?? newPostButtonRef.current
    setChallengeOptIn(optIntoChallenge)
    setIsPostSheetVisible(true)
  }, [])

  const closePostSheet = useCallback(() => {
    setIsPostSheetVisible(false)
  }, [])

  // Story CC-7.11 D16: New post sits in the Community top bar's trailing slot, as the Closet's
  // Add does, so no row above the first content holds a lone button. A banned member has
  // nothing to post to (Story 6.11), so the slot stays empty.
  const navigation = useNavigation()
  const canPost = bannedSanction === null
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: canPost
        ? () => (
            <CommunityNewPostButton
              buttonRef={newPostButtonRef}
              onPress={() => openPostSheet(false)}
            />
          )
        : undefined,
    })
  }, [canPost, navigation, openPostSheet])

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

  const climate = communityFeedClimate(servedMode, viewerBand, bandResolved)
  const feedRows = useMemo(() => {
    if (feedState !== 'ready' || !communityAvailable) return []
    const ordinary = deepLinkPost ? [deepLinkPost, ...items] : items
    return mergeCommunityLooks(spotlightItems, ordinary, climate, teaserTarget)
  }, [
    climate,
    communityAvailable,
    deepLinkPost,
    feedState,
    items,
    spotlightItems,
    teaserTarget,
  ])
  visibleFeedRows.current = feedRows
  const climateEmpty = climate !== null && feedRows.length === 0 && Boolean(sessionScope)
  // Story CC-7.7 D3: the Community gate waits for the first feed page and the City Spotlight,
  // so the Spotlight never arrives above a feed the member is already reading. A Spotlight
  // error or a disabled Spotlight counts as settled and shows inside the gate.
  const communityGateReady = communityGateSettled({
    available: communityAvailable,
    feedState,
    sessionScope,
    spotlightStatus: spotlight.status,
  })
  const feedScroll = useCommunityScrollRestore({
    available: communityAvailable,
    data: feedRows,
    scope: feedScopeRef,
  })

  /**
   * Story 6.7: resolves a teaser focus intent against the spotlight module. A
   * loading module is awaited for at most 10 seconds. The entry, when shown,
   * takes focus with one announcement; every other outcome focuses one notice.
   * Either way the intent is consumed, so a later recovery moves no focus.
   * Story CC-7.7 D3: the module sits inside the screen gate, which stays closed until the
   * first feed page settles too. A ready Spotlight behind a closed gate is still waiting, so
   * the intent is consumed only once the entry is on screen and can take focus.
   */
  const spotlightStatus = spotlight.status
  const focusSpotlightEntry = spotlight.focusEntry
  const feedListRef = feedScroll.listRef
  useEffect(() => {
    if (!spotlightIntent || !screenFocused) return
    const report = (key: SpotlightNoticeKey) => {
      if (!screenFocusedRef.current) return
      setSpotlightIntent(null)
      spotlightNoticeSerialRef.current += 1
      setSpotlightNotice({ key, serial: spotlightNoticeSerialRef.current })
    }
    if (!communityAvailable || spotlightStatus === 'idle') {
      report('community.spotlight.destinationUnavailable')
      return
    }
    if (spotlightStatus === 'loading' || !communityGateReady) {
      const timer = setTimeout(
        () => report('community.spotlight.destinationUnavailable'),
        Math.max(0, spotlightIntent.receivedAt + SPOTLIGHT_FOCUS_WAIT_MS - Date.now())
      )
      return () => clearTimeout(timer)
    }
    if (
      spotlightStatus === 'ready' &&
      spotlightLevel !== 'none' &&
      spotlightItems.some((post) => post.id === spotlightIntent.cardId)
    ) {
      setSpotlightIntent(null)
      setTeaserTarget(spotlightIntent.cardId)
      focusSpotlightEntry(spotlightIntent.cardId)
      return
    }
    report('community.spotlight.targetUnavailable')
  }, [
    communityAvailable,
    communityGateReady,
    focusSpotlightEntry,
    screenFocused,
    spotlightIntent,
    spotlightItems,
    spotlightLevel,
    spotlightStatus,
  ])

  const focusedNoticeSerialRef = useRef<number | null>(null)
  // Story CC-7.7 D3: the notice sits in the list header, inside the screen gate. It is focused
  // only once the gate actually shows it, the gate's deadline opening included, so an intent
  // that timed out behind the placeholder still focuses its notice when the body appears.
  const [communityGateOpen, setCommunityGateOpen] = useState(false)

  // The direct read can beat the feed and the gate. Keep focus pending until its title mounts.
  const focusNotificationTitle = useCallback(() => {
    const pending = pendingNotificationFocus.current
    if (!pending) return
    const stillCurrent = () =>
      pending.intent === notificationIntentRef.current &&
      pending.scope === sessionScopeRef.current
    if (!stillCurrent() || commentsPostId !== null) {
      pendingNotificationFocus.current = null
      return
    }
    if (
      !communityAvailable ||
      !communityGateOpen ||
      !screenFocused ||
      deepLinkPost?.id !== pending.postId ||
      !targetRef.current
    )
      return
    pendingNotificationFocus.current = null
    AccessibilityInfo.announceForAccessibility(t('community.feed.announceFocused'))
    const title = targetRef.current
    focusNode(
      title,
      () => screenFocusedRef.current && stillCurrent() && targetRef.current === title
    )
  }, [
    commentsPostId,
    communityAvailable,
    communityGateOpen,
    deepLinkPost?.id,
    focusNode,
    screenFocused,
    t,
  ])

  useEffect(() => {
    focusNotificationTitle()
  }, [feedRows, focusNotificationTitle])

  // Focusing the notice is its single announcement: the list returns to its
  // top, then focus moves to the message. No live region repeats it.
  useEffect(() => {
    if (!spotlightNotice || !screenFocused || !communityGateOpen) return
    // Focused once: a later visit leaves focus where the member puts it.
    if (focusedNoticeSerialRef.current === spotlightNotice.serial) return
    focusedNoticeSerialRef.current = spotlightNotice.serial
    feedListRef.current?.scrollToOffset({ offset: 0, animated: false })
    requestAnimationFrame(() => {
      if (!screenFocusedRef.current) return
      if (Platform.OS === 'web') {
        ;(noticeRef.current as unknown as { focus?: () => void } | null)?.focus?.()
        return
      }
      const handle = safeFindNodeHandle(noticeRef.current)
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
    })
  }, [communityGateOpen, feedListRef, screenFocused, spotlightNotice])

  // A read still in flight was authorized before the ban, so its answer can never land.
  useEffect(() => {
    bannedRef.current = bannedSanction !== null
    if (!bannedSanction) return
    requestGenerationRef.current++
    detailGenerationRef.current++
    controllerRef.current?.abort()
    actionControllerRef.current?.abort()
    setItems([])
    setNewLooks([])
    setAuthorStates([])
    setActiveChallenge(null)
    setNextCursor(null)
    setIsPostSheetVisible(false)
    setCommentsPostId(null)
    setIsSubmittingReport(false)
    setIsLoadingMore(false)
    setIsRefreshing(false)
    comments.reset()
    reactionState.reset()
    postTextLedger.clear()
  }, [bannedSanction, comments, postTextLedger, reactionState])

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
  const bannerMessage = spotlightNotice
    ? t(spotlightNotice.key)
    : isInvalidDeepLink
      ? t('community.deepLink.invalid')
      : noticeKey
        ? t(noticeKey)
        : null

  const dismissBanner = useCallback(() => {
    setIsInvalidDeepLink(false)
    setNoticeKey(null)
    setSpotlightNotice(null)
  }, [])

  const spotlightFocusRequest = spotlight.focusRequest
  const acknowledgeSpotlightFocus = spotlight.acknowledgeFocusRequest
  const focusedSpotlightSerial = useRef<number | null>(null)
  useEffect(() => {
    if (
      !spotlightFocusRequest ||
      !communityGateOpen ||
      !screenFocused ||
      focusedSpotlightSerial.current === spotlightFocusRequest.serial
    )
      return
    const { firstId, kind, serial } = spotlightFocusRequest
    const index = feedRows.findIndex((item) => item.id === firstId && isRankedLook(item))
    focusedSpotlightSerial.current = serial
    acknowledgeSpotlightFocus(serial)
    if (kind !== 'refreshed' && index === -1) return
    const message =
      kind === 'appended'
        ? t('community.spotlight.announceLoadedMore', {
            count: spotlightFocusRequest.count,
          })
        : t(
            kind === 'targeted'
              ? 'community.feed.announceFocused'
              : 'community.spotlight.announceRefreshed'
          )
    AccessibilityInfo.announceForAccessibility(message)
    if (index === -1 || !firstId) return
    pendingSpotlightFocus.current = firstId
    feedListRef.current?.scrollToIndex({ index, viewPosition: 0.25, animated: false })
    focusSpotlightTitle(firstId)
  }, [
    acknowledgeSpotlightFocus,
    communityGateOpen,
    feedListRef,
    feedRows,
    focusSpotlightTitle,
    screenFocused,
    spotlightFocusRequest,
    t,
  ])

  const renderEmptyComponent = () => {
    if (bannedSanction)
      return (
        <CommunityBannedNotice
          sanction={bannedSanction}
          locale={locale}
          textColor={palette.ink}
          mutedColor={palette.inkMuted}
        />
      )
    if (!communityAvailable)
      return (
        <View style={styles.stateContainer} testID="community-feed-unavailable">
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.stateBody, { color: palette.inkMuted }]}
          >
            {t('community.realtime.unavailable')}
          </Text>
        </View>
      )

    if (
      feedState === 'loading' ||
      (feedState === 'ready' && spotlight.status === 'loading')
    ) {
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
                { backgroundColor: palette.card, borderColor: palette.line },
              ]}
              testID="community-feed-skeleton"
            >
              <View
                style={[styles.skeletonHeader, { backgroundColor: palette.cardMuted }]}
              />
              <View
                style={[styles.skeletonImage, { backgroundColor: palette.cardMuted }]}
              />
              <View
                style={[styles.skeletonFooter, { backgroundColor: palette.cardMuted }]}
              />
            </View>
          ))}
        </View>
      )
    }

    if (feedState === 'error') {
      return (
        <View style={styles.stateContainer} testID="community-feed-error">
          <Text style={[styles.stateTitle, { color: palette.ink }]}>
            {t('community.feed.errorTitle')}
          </Text>
          <Text
            style={[styles.stateBody, styles.centeredText, { color: palette.inkMuted }]}
          >
            {feedErrorMessage}
          </Text>
          <TouchableOpacity
            testID="community-feed-retry"
            style={[
              styles.primaryButton,
              {
                backgroundColor: palette.page,
                borderColor: palette.lineStrong,
                borderWidth: 1,
              },
            ]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel={t('community.feed.retry')}
          >
            <Text style={[styles.primaryButtonText, { color: palette.ink }]}>
              {t('community.feed.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.stateContainer} testID="community-feed-empty">
        <Text style={[styles.stateTitle, { color: palette.ink }]}>
          {t(climateEmpty ? 'community.calm.climateEmpty' : 'community.feed.emptyTitle')}
        </Text>
        {!climateEmpty && (
          <Text
            style={[styles.stateBody, styles.centeredText, { color: palette.inkMuted }]}
          >
            {t('community.feed.emptyBody')}
          </Text>
        )}
        {climateEmpty ? (
          <TouchableOpacity
            testID="community-clear-filters"
            accessibilityRole="button"
            style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
            onPress={() => handleSelectMode('all')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
              {t('community.calm.seeAllClimates')}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="community-feed-empty-cta"
            style={[
              styles.primaryButton,
              {
                backgroundColor: palette.page,
                borderColor: palette.lineStrong,
                borderWidth: 1,
              },
            ]}
            onPress={(event) =>
              openPostSheet(false, event.currentTarget as unknown as View | null)
            }
            accessibilityRole="button"
            accessibilityLabel={t('community.share')}
          >
            <Text style={[styles.primaryButtonText, { color: palette.ink }]}>
              {t('community.share')}
            </Text>
          </TouchableOpacity>
        )}
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
          { backgroundColor: palette.card, borderColor: palette.line },
        ]}
        testID="community-author-states"
      >
        <Text style={[styles.authorStatesTitle, { color: palette.ink }]}>
          {t('community.feed.yourPostsTitle')}
        </Text>
        <Text style={[styles.stateBody, { color: palette.inkMuted }]}>
          {t('community.feed.yourPostsBody')}
        </Text>
        {authorStates.map((authorState) => (
          <View
            key={authorState.id}
            testID={`community-author-state-${authorState.id}`}
            accessible
            accessibilityRole="summary"
            style={[styles.authorStateRow, { borderColor: palette.line }]}
          >
            <Text
              testID={`community-author-state-status-${authorState.id}`}
              style={[styles.authorStateStatus, { color: palette.ink }]}
            >
              {t(`community.status.${authorState.status}`)}
            </Text>
            {EXPLAINED_AUTHOR_STATES.has(authorState.status) ? (
              <Text
                testID={`community-author-state-explanation-${authorState.id}`}
                style={[styles.stateBody, { color: palette.inkMuted }]}
              >
                {t(`community.removed.${authorState.status}`)}
              </Text>
            ) : null}
            {authorState.title ? (
              <Text
                testID={`community-author-state-title-${authorState.id}`}
                style={[styles.authorStateStatus, { color: palette.ink }]}
              >
                {authorState.title}
              </Text>
            ) : null}
            {authorState.moderationReason ? (
              <Text
                testID={`community-author-state-reason-${authorState.id}`}
                style={[styles.stateBody, { color: palette.inkMuted }]}
              >
                {moderationReasonText(authorState.moderationReason, t)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    )
  }

  /**
   * The spotlight reuses the feed card with every control. Inside the detail,
   * comments and report first close the sheet and return focus to the card's
   * rank in the module when they finish.
   */
  const updateSavedText = (postId: string, text: SavedCommunityText) => {
    postTextLedger.record({ id: postId, ...text, status: 'published' })
    const update = (post: CommunityFeedItem | null) =>
      post?.id === postId && (post.textRevision ?? 0) <= text.textRevision
        ? { ...post, ...text }
        : post
    newLooksRef.current = newLooksRef.current.map((item) => update(item)!)
    setNewLooks(newLooksRef.current)
    setItems((previous) => previous.map((item) => update(item)!))
    setDeepLinkPost(update)
    spotlight.applyText(postId, text)
  }

  /** A feed post inside its detail: every control first closes the layer (D12). */
  const renderFeedDetailCard = (post: CommunityFeedItem) => (
    <CommunityCard
      onExport={(postId, opener) => closeFeedDetail(() => openShareCard(postId, opener))}
      onComments={(target) => {
        notificationIntentRef.current++
        closeFeedDetail(() => {
          commentsInvokerRef.current =
            cardRefs.current.get(target.id) ??
            (deepLinkPost?.id === target.id ? targetRef.current : null)
          setCommentsPostId(target.id)
        })
      }}
      reactionControls={reactionState.controls(post.id)}
      item={post}
      onTextSaved={updateSavedText}
      textEditingEnabled={communityAvailable && screenFocused}
      isReported={reportedPostIds.has(post.id)}
      onReport={(target) => closeFeedDetail(() => handleReportPost(target))}
      onWithdraw={(target) => closeFeedDetail(() => void handleWithdrawPost(target))}
      onImageExpiry={handleImageExpiry}
    />
  )

  const renderSpotlightCard = (
    post: CommunityReactionSpotlightItem,
    inDetail: boolean,
    highlighted = false
  ) => {
    const viaDetail = (action: () => void) =>
      inDetail ? closeSpotlightDetail(action) : action()
    return (
      <CommunityCard
        feedCard={!inDetail}
        isHighlighted={highlighted}
        feedTitleRef={
          inDetail
            ? undefined
            : (node) => {
                registerSpotlightTitle(post.id, node)
                if (highlighted) {
                  targetRef.current = node
                  focusNotificationTitle()
                }
              }
        }
        onExport={
          inDetail
            ? (postId, opener) => viaDetail(() => openShareCard(postId, opener))
            : undefined
        }
        onComments={
          inDetail
            ? (target) => {
                notificationIntentRef.current++
                viaDetail(() => {
                  commentsInvokerRef.current =
                    spotlightRankRefs.current.get(target.id) ?? null
                  setCommentsPostId(target.id)
                })
              }
            : undefined
        }
        reactionControls={reactionState.controls(post.id)}
        item={reactionState.current(post)}
        shopSurface="community_spotlight"
        isReported={reportedPostIds.has(post.id)}
        onReport={(target, opener) =>
          viaDetail(() => {
            spotlightReturnRef.current = spotlightRankRefs.current.get(target.id) ?? null
            handleReportPost(target, opener)
          })
        }
        onWithdraw={(target) => viaDetail(() => void handleWithdrawPost(target))}
        onTextSaved={updateSavedText}
        textEditingEnabled={communityAvailable && screenFocused}
        // Only this post is re-read, so every loaded page and the reader's place
        // survive a fresh signed image URL.
        onImageExpiry={(target) => spotlight.refreshItem(target.id)}
        onOpen={inDetail ? undefined : () => handleOpenSpotlight(post)}
      />
    )
  }

  const renderLeadNotices = () => (
    <View>
      {bannerMessage ? (
        <InfoBanner
          ref={noticeRef}
          message={bannerMessage}
          onDismiss={dismissBanner}
          liveRegion={!spotlightNotice}
        />
      ) : null}
      {actionErrorMessage ? (
        <View
          testID="community-action-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[
            styles.errorPanel,
            { backgroundColor: palette.dangerSurface, borderColor: palette.dangerLine },
          ]}
        >
          <Text style={[styles.errorText, { color: palette.dangerInk }]}>
            {actionErrorMessage}
          </Text>
        </View>
      ) : null}
      {renderAuthorStates()}
    </View>
  )

  const unresolvedClimateNotice =
    servedMode === 'auto' && !bandResolved && bandUnresolvedReason ? (
      <View
        testID="community-band-unresolved"
        style={[
          styles.infoPanel,
          { backgroundColor: palette.card, borderColor: palette.line },
        ]}
      >
        <Text style={[styles.stateBody, { color: palette.ink }]}>
          {t(`community.band.unresolved.${bandUnresolvedReason}`)}
        </Text>
        {bandUnresolvedReason === 'no_location' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/locations?guided=1')}
            style={[
              styles.outlineButton,
              styles.bandAction,
              { borderColor: palette.inkMuted },
            ]}
            testID="community-add-location"
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
              {t('locations.guided.add')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null

  const renderHeaderComponent = () => (
    <View>
      {communityAvailable &&
        activeChallenge &&
        !dismissedChallenges.has(activeChallenge.id) && (
          <CommunityChallengeBanner
            challenge={activeChallenge}
            onParticipate={(opener) => openPostSheet(true, opener)}
            onDismiss={() => {
              setDismissedChallenges((previous) =>
                new Set(previous).add(activeChallenge.id)
              )
              focusNode(climateTriggerRef.current)
            }}
          />
        )}
      {spotlightNotice && renderLeadNotices()}
    </View>
  )

  const renderFeedRow = (item: CommunityFeedItem, index: number) => {
    const ranked = isRankedLook(item)
    const highlighted = item.id === deepLinkPost?.id
    return (
      <View>
        <View testID={firstContentId(index === 0)}>
          {ranked ? (
            <View testID={`community-spotlight-item-${item.id}`}>
              {renderSpotlightCard(item, false, highlighted)}
            </View>
          ) : (
            <View
              testID={highlighted ? `highlighted-community-card-${item.id}` : undefined}
              style={highlighted ? styles.highlightSection : undefined}
            >
              <CommunityCard
                feedCard
                reactionControls={reactionState.controls(item.id)}
                item={item}
                isHighlighted={highlighted}
                isReported={reportedPostIds.has(item.id)}
                feedTitleRef={(node) => {
                  if (node) cardRefs.current.set(item.id, node)
                  else cardRefs.current.delete(item.id)
                  if (highlighted) {
                    targetRef.current = node
                    focusNotificationTitle()
                  }
                }}
                onReport={handleReportPost}
                onWithdraw={handleWithdrawPost}
                onImageExpiry={handleImageExpiry}
                onOpen={handleOpenCard}
              />
            </View>
          )}
        </View>
        {index === 0 && !spotlightNotice ? renderLeadNotices() : null}
      </View>
    )
  }

  const renderExampleInspiration = () => {
    if (
      communityAvailable &&
      !bannedSanction &&
      feedState === 'ready' &&
      !climateEmpty &&
      feedRows.every((post) => post.author.isSelf)
    ) {
      return (
        <CommunityExampleInspiration
          band={
            servedMode === 'auto' ? viewerBand : servedMode === 'all' ? null : servedMode
          }
          locale={locale}
          palette={palette}
        />
      )
    }
    return null
  }

  const renderSpotlightPaging = () => {
    if (spotlight.status !== 'error' && !spotlight.hasMore) return null
    const retryFirst = spotlight.status === 'error'
    const retry = retryFirst || spotlight.loadMoreFailed
    const id = retryFirst
      ? 'retry'
      : spotlight.loadMoreFailed
        ? 'more-retry'
        : 'view-more'
    const label = t(retry ? 'community.spotlight.retry' : 'community.spotlight.viewMore')
    return (
      <View style={styles.loadingMoreContainer}>
        {retry && (
          <Text
            accessibilityRole="alert"
            style={[styles.stateBody, { color: palette.dangerInk }]}
            testID={
              retryFirst ? 'community-spotlight-error' : 'community-spotlight-more-error'
            }
          >
            {t('community.spotlight.error')}
          </Text>
        )}
        <TouchableOpacity
          testID={`community-spotlight-${id}`}
          accessibilityRole="button"
          disabled={spotlight.isLoadingMore || spotlight.isReplacing}
          style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
          onPress={retryFirst ? spotlight.reload : spotlight.loadMore}
        >
          <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
            {spotlight.isLoadingMore ? t('community.spotlight.loadingMore') : label}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  const renderPagingFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={styles.loadingMoreContainer} testID="community-feed-loading-more">
          <ActivityIndicator size="small" color={palette.ink} />
          <Text style={[styles.stateBody, { color: palette.inkMuted }]}>
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
            style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
            onPress={handleLoadMore}
            accessibilityRole="button"
            accessibilityLabel={t('community.feed.loadMore')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
              {t('community.feed.loadMore')}
            </Text>
          </TouchableOpacity>
        </View>
      )
    }
    return <View style={styles.footerSpacing} />
  }

  const renderFeedViewport = () => (
    <>
      {!bannedSanction && (
        <CommunityFilterChips
          selectedMode={servedMode}
          triggerRef={climateTriggerRef}
          onSelectMode={handleSelectMode}
          viewerBand={bandResolved ? viewerBand : null}
          active={screenFocused}
        >
          {unresolvedClimateNotice}
        </CommunityFilterChips>
      )}

      <ScreenGate
        screen="community"
        ready={communityGateReady}
        style={styles.feedArea}
        onOpenChange={setCommunityGateOpen}
      >
        <FlatList
          ref={feedScroll.listRef}
          testID="community-feed-list"
          data={feedRows}
          onScroll={feedScroll.onScroll}
          onScrollBeginDrag={feedScroll.onScrollBeginDrag}
          onContentSizeChange={feedScroll.onContentSizeChange}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => renderFeedRow(item, index)}
          onScrollToIndexFailed={({ averageItemLength, index }) =>
            feedListRef.current?.scrollToOffset({
              offset: averageItemLength * index,
              animated: false,
            })
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={palette.ink}
            />
          }
          onEndReached={climateEmpty ? undefined : handleLoadMore}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={renderHeaderComponent()}
          // Elements keep the empty state and the load-more control mounted across
          // renders; a fresh function per render would remount them and drop focus.
          // Story CC-7.11 P5: with no cards, the empty state is the first own content.
          ListEmptyComponent={
            <View>
              <View testID={firstContentId(true)}>{renderEmptyComponent()}</View>
              {!spotlightNotice && renderLeadNotices()}
            </View>
          }
          ListFooterComponent={
            <>
              {communityAvailable &&
                feedState === 'ready' &&
                !climateEmpty &&
                renderSpotlightPaging()}
              {renderExampleInspiration()}
              {!climateEmpty && renderPagingFooter()}
            </>
          }
          contentContainerStyle={styles.listContent}
        />
        {/* Story CC-7.7 D4: pinned over the top of the list, so arriving looks never push the
            feed down under the member's thumb. */}
        {newLooks.length > 0 && communityAvailable && (
          <View pointerEvents="box-none" style={styles.newLooksOverlay}>
            <TouchableOpacity
              testID="community-new-looks-pill"
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: palette.inverse }]}
              disabled={isInsertingLooks}
              onPress={() => {
                void insertNewLooks()
              }}
            >
              <Text style={{ color: palette.onInverse }}>
                {t('community.realtime.showNewLooks', { count: newLooks.length })}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScreenGate>
    </>
  )

  const renderDialogs = () => (
    <>
      <CommunityReportModal
        suspended={!communityAvailable}
        visible={reportingPost !== null}
        post={reportingPost}
        errorMessage={reportErrorMessage}
        isSubmitting={isSubmittingReport}
        onClose={closeReportModal}
        onSubmit={handleSubmitReport}
        returnFocusRef={reportOpenerRef}
      />

      <CommunityCommentsSheet
        postId={sheetPostId(commentsPostId, communityAvailable, screenFocused)}
        target={commentsPostId === deepLinkPost?.id ? commentTarget : undefined}
        state={comments}
        drafts={commentDrafts}
        member={sessionScope ?? null}
        locale={locale}
        onClose={() => {
          notificationIntentRef.current++
          if (commentsPostId) comments.retireFocus(commentsPostId)
          setCommentTarget(undefined)
          const highlighted =
            deepLinkPost?.id === commentsPostId ? targetRef.current : null
          const feed = commentsPostId
            ? (cardRefs.current.get(commentsPostId) ?? null)
            : null
          const spotlightInvoker = commentsPostId
            ? (spotlightRankRefs.current.get(commentsPostId) ?? null)
            : null
          const original = commentsInvokerRef.current
          const target =
            original &&
            (original === highlighted ||
              original === feed ||
              original === spotlightInvoker)
              ? original
              : (highlighted ?? feed ?? spotlightInvoker)
          const node = safeFindNodeHandle(target)
          setCommentsPostId(null)
          if (node) AccessibilityInfo.setAccessibilityFocus(node)
        }}
      />
      <CommunitySpotlightDetail
        item={spotlightDetailForVisit(
          spotlightDetailItem,
          communityAvailable,
          retainedSpotlight.active
        )}
        onClose={() => closeSpotlightDetail()}
        onDismissed={runPendingSpotlightAction}
        renderCard={(post) => renderSpotlightCard(post, true)}
        fallbackTitle={t('community.spotlight.eyebrow')}
        returnFocusRef={spotlightDetailOpenerRef}
      />
      <CommunitySpotlightDetail
        testID="community-post-detail"
        item={spotlightDetailForVisit(feedDetailItem, communityAvailable, screenFocused)}
        onClose={() => closeFeedDetail()}
        onDismissed={runPendingSpotlightAction}
        renderCard={renderFeedDetailCard}
        fallbackTitle={t('community.feed.detailTitle')}
        returnFocusRef={feedDetailOpenerRef}
      />
      <ScreenShareCardComposer
        source={shareCardSource}
        open={
          shareCardOpen && shareCardInvoker.current.member === mobileApplicationUserId()
        }
        onClose={() => setShareCardOpen(false)}
        onRestoreFocus={() => {
          if (
            !screenFocusedRef.current ||
            shareCardInvoker.current.member !== mobileApplicationUserId()
          )
            return
          const node =
            shareCardInvoker.current.node?.() ?? shareCardHeadingNode('community')
          focusShareCardElement(node)
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
        returnFocusRef={postSheetOpenerRef}
      />
    </>
  )

  return (
    <SponsoredCtaImpressions focused={screenFocused}>
      <View
        style={[styles.container, { backgroundColor: palette.page }]}
        testID="community-screen"
      >
        <LiveFontMountMarker scope="community" />
        {renderFeedViewport()}
        {renderDialogs()}
      </View>
    </SponsoredCtaImpressions>
  )
}

/** Story CC-7.7 D3: whether the Community gate's reads (first feed page, Spotlight) settled. */
export function communityGateSettled({
  available,
  feedState,
  sessionScope,
  spotlightStatus,
}: {
  available: boolean
  feedState: FeedState
  sessionScope: string | null | undefined
  spotlightStatus: SpotlightStatus
}): boolean {
  // Lost access or a ban owns the screen: there is nothing more to wait for.
  if (!available) return true
  if (feedState === 'loading' || sessionScope === undefined) return false
  // Signed out, the Spotlight idles and renders nothing.
  if (sessionScope === null) return true
  return spotlightStatus !== 'loading' && spotlightStatus !== 'idle'
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBarAction: {
    flexShrink: 1,
    paddingEnd: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  feedArea: {
    flex: 1,
  },
  newLooksOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 9999,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '600',
  },
  highlightSection: {
    marginTop: 12,
  },
  bandAction: {
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  infoPanel: {
    marginHorizontal: TAB_BODY_INSET,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorPanel: {
    marginHorizontal: TAB_BODY_INSET,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
  },
  authorStates: {
    marginHorizontal: TAB_BODY_INSET,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  authorStatesTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  authorStateRow: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 8,
    gap: 4,
  },
  authorStateStatus: {
    fontSize: 14,
    fontWeight: '700',
  },
  skeletonsContainer: {
    paddingHorizontal: TAB_BODY_INSET,
    gap: 16,
    marginTop: 12,
  },
  skeletonCard: {
    borderRadius: 16,
    padding: 16,
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
    borderRadius: 8,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 12,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 20,
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
