// Story 3.5 Task 2 step 1 owner: implement community lookbook filter chips, card grid, and ARIA live regions in `apps/web/src/app/components/community-lookbook-grid.tsx`
// Story 1.2b web guided entry owner: the Community add-location link and safe return path in `apps/web/src/app/components/community-lookbook-grid.tsx` and `apps/web/src/app/components/locations/location-format.ts`
// Story 6.1 owner: the web community surface -- climate-band filter chips, the
// published card grid, the caller's own in-progress posts, reporting, and the
// two-step compose flow.
//
// Four things about the shape here are load-bearing rather than stylistic:
//
// - **Every call goes through `../../lib/community`.** That module is the only
//   place community requests pick up `createWebApiClient`'s
//   `credentials: 'include'`. The first draft of this file built
//   `new CommunityApi(new Configuration(...))` inline, dropped cookie auth on
//   every community call, and read a bearer token out of `sessionStorage` as
//   the sole credential.
// - **The reason travels and the words do not.** The wrappers throw
//   untranslated English; this file maps {@link CommunityFailureReason} onto a
//   `community.error.*` key and renders that, following
//   `palette-advisor-panel.tsx`.
// - **Exactly one polite live region.** This file used to carry four competing
//   ones (the filter nav, the grid, the loading skeleton's `role="status"`, and
//   the modal's), which made `getByRole('status')` ambiguous and made a screen
//   reader hear the same state twice. The loading skeleton is `aria-hidden` and
//   the grid carries `aria-busy` instead.
// - **State is stored as a message key plus params, never as a rendered
//   string.** `loadFeed` has no `t` in its dependency list, so a request cannot
//   be re-fired by a language change, and a language change still re-renders
//   every banner in the new language.
'use client'

import {
  CommunityShareCardControl,
  ShareCardDialog,
  ShareCardHostContext,
  type ShareCardHost,
} from './share-card-dialog'

import { CommunityBannedNotice } from './community-banned-notice'
import { CommunityComments } from './community-comments'
import { CommunityExampleInspiration } from './community-example-inspiration'
import {
  ResponseError,
  CommunityCommentsState,
  CommunitySyncState,
  CommunityRequestSuperseded,
  CommunityReactionState,
  CommunityVerification,
  type ReactionControls,
} from '@couture/api-client'
import {
  communityCommentsSessionFromWeb,
  communitySyncFromWeb,
  communityRealtimeTokenFromWeb,
  communityCommentsRootsFromWeb,
  communityCommentsRepliesFromWeb,
  communityCommentsSubmissionsFromWeb,
  communityCommentsCreateFromWeb,
  communityCommentsDeleteFromWeb,
  communityCommentsReportFromWeb,
  allocateCommunityLookFromWeb,
  describeCommunityDraftFromWeb,
  CommunityRequestError,
  communityFailureReason,
  communitySanctionOf,
  setCommunityReactionFromWeb,
  communityRetryAfterSeconds,
  generateIdempotencyKey,
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  openCommunityPostFromWeb,
  openCommunitySpotlightPostFromWeb,
  publishCommunityLookFromWeb,
  reportCommunityPostFromWeb,
  withdrawCommunityPostFromWeb,
  type CommunityFailureReason,
} from '../../lib/community'
import { resolveWebApiBaseUrl } from '../../lib/api-client'
import {
  currentWebSessionScope,
  useHydrating,
  useMemberSession,
  useWebSessionScope,
} from '../../lib/use-web-session'
import {
  COMMUNITY_GRID_SNAPSHOT_PART,
  COMMUNITY_SNAPSHOT_PARTS,
  screenSnapshot,
} from '../../lib/screen-snapshot'
import { useScreenGateOpen, useScreenGateRead, useScreenGateScreen } from './screen-gate'
import { SessionRetryButton } from './session-retry-button'
import { CommunityPostTextEditor } from './community-post-text-editor'
import {
  LiveSponsorshipLedger,
  type LiveReadStamp,
  type LiveSponsorshipAnswers,
} from '../../lib/live-sponsorships'
import { CommunityReactions } from './community-reactions'
import {
  CommunitySponsoredCta,
  useSponsoredShownRegistry,
  type SponsoredShownRegistry,
} from './community-sponsored-cta'
import { useCommunityScrollRestore } from './community-scroll-restore'
import {
  CommunitySpotlightPaging,
  SPOTLIGHT_CARD_SCOPE,
  spotlightCardElementId,
  useCommunitySpotlight,
  type CommunitySpotlightState,
} from './community-spotlight'

import React, {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import {
  parseDeepLink,
  CLIMATE_BANDS,
  communityFeedClimate,
  mergeCommunityLooks,
} from '@couture/utils'
import {
  CommunityPostTextLedger,
  communityModerationReasonCategories,
  communityPostCaptionSchema,
  communityPostTitleSchema,
  COMMUNITY_POST_TITLE_MAX_LENGTH,
  reconcileCommunityPostText,
  type EditCommunityPostTextResponse,
  communityReportReasonSchema,
  defaultSupportedLocale,
  supportedLocaleSchema,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityExperimentVariant,
  type CommunityReactionSummary,
  type AffiliateCommunitySurface,
  type CommunitySponsoredFeed as CommunityFeed,
  type CommunitySponsoredFeedItem as CommunityFeedItem,
  type CommunitySponsoredSpotlightItem as CommunitySpotlightItem,
  type CommunityFeedMode,
  type CommunityReportReason,
  type EmbeddedCommunityChallenge,
  type SupportedLocale,
  type CommunityBannedError,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { AccessibleModal } from './accessible-modal'
import { useDetailOpener } from './detail-opener'
import type { ChipCategory } from './chip-navigation'

/**
 * The filter type is the contract's own enum. A local union here is what let
 * `New`, `Following`, `Near me` and `Brands` survive as chips with no server
 * behind them, and what let an invented `arctic -> cold_dry` alias table drift
 * away from the six real bands.
 */
export type FilterCategory = CommunityFeedMode

/**
 * The chip set, in display order. `all` is a real server mode, not a synonym
 * for `auto`: the beta experiment assigns viewers 50/50 between the two arms,
 * so both have to be requestable.
 */
export const COMMUNITY_FEED_MODES: readonly CommunityFeedMode[] = [
  'auto',
  'all',
  ...CLIMATE_BANDS,
]

/** Author-state statuses that carry their own explanation of why a post is not public. */
const REMOVED_STATUSES = new Set([
  'flagged',
  'review_failed',
  'withdrawn',
  'consent_suspended',
])

/**
 * How many times an expired signed URL is chased automatically before the card
 * settles on its manual "reload image" control. Without a bound, a genuinely
 * dead object refetches the whole feed on every failed paint.
 */
const MAX_AUTOMATIC_IMAGE_REFETCHES = 2

const FEED_PAGE_SIZE = 12
/**
 * Least time left in which a notification target attempt may start: one bearer read, one
 * request and its answer. Below it the attempt would leave after the 10 s operation bound.
 */
const MINIMUM_TARGET_ATTEMPT_MS = 250

/**
 * Deep merlot marks errors and flagged content (`text-merlot-ink border-merlot-ink`, a D2 role
 * with a dark value of its own); a destructive fill uses the `danger` role.
 */
const MERLOT_CLASS = 'border-merlot-ink text-merlot-ink'

/**
 * Every reason the community wrappers can throw, mapped onto catalog copy.
 * Typing this as a total `Record` means a new member of
 * `CommunityFailureReason` fails to typecheck here until it has copy.
 */
function notificationFailureIsRetryable(error: unknown) {
  if (
    error instanceof CommunityRequestError &&
    ['signed_out', 'age_gate', 'banned', 'not_found', 'disabled'].includes(error.reason)
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

const FAILURE_KEYS: Record<CommunityFailureReason, string> = {
  signed_out: 'community.error.signedOut',
  age_gate: 'community.error.ageGate',
  banned: 'community.error.banned',
  rate_limited: 'community.error.rateLimited',
  not_found: 'community.error.notFound',
  reason_changed: 'community.error.reasonChanged',
  self_report: 'community.error.selfReport',
  disabled: 'community.error.disabled',
  media_unavailable: 'community.error.mediaUnavailable',
  // Only the feed read sends a cursor, and `readFeedPage` recovers from this one
  // before any caller sees it, so this entry is the copy of last resort rather
  // than a state the reader is expected to meet.
  cursor_invalid: 'community.error.load',
  upload_failed: 'community.error.upload',
  image_too_small: 'community.validation.imageTooSmall',
  unknown: 'community.error.generic',
}

/** Matches `planner-rail.tsx`'s prop shape for handing `t` to a subcomponent. */
type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * A message held as a key and its interpolation values rather than as rendered
 * text, so a language change repaints it. `filterMode` is resolved to the
 * `filter` interpolation at render time because its label needs `t` itself.
 */
interface Message {
  announcementId?: number
  key: string
  params?: Record<string, unknown>
}

type NoticeTone = 'success' | 'info' | 'error'

interface Notice {
  message: Message
  tone: NoticeTone
}

interface FailedImage {
  /** The signed URL that failed. A newer one clears the failure by not matching. */
  url: string
  attempts: number
}

/**
 * The card surfaces that render a post's image. Each copy recovers through its
 * own refetch (the feed reloads its page, the spotlight re-reads one post), so
 * a failure on one copy never marks the other unavailable.
 */
type ImageSurface = 'feed' | 'spotlight'

type FailedImages = Record<ImageSurface, Record<string, FailedImage>>

const NO_FAILED_IMAGES: FailedImages = { feed: {}, spotlight: {} }

/** One compose attempt: the allocated session plus the key that replays it. */
interface AllocatedLook {
  postId: string
  uploadSessionId: string
  altTextSuggestion: string
  idempotencyKey: string
}

function suggestionOf(allocated: AllocatedLook | null): string | null {
  return allocated?.altTextSuggestion ?? null
}

function bandLabel(band: ClimateBand | null | undefined, t: Translate): string {
  return band ? t(`community.band.${band}`) : t('community.band.unclassified')
}

function authorNameOf(item: CommunityFeedItem, t: Translate): string {
  return item.author.isSelf ? t('community.card.authorSelf') : item.author.displayName
}

/**
 * `?? ` was not enough. `altText` is `z.string().nullable()` on the wire, so a
 * published row can carry an empty string, and `item.altText ?? fallback` hands
 * that straight to `alt=""`, which marks a content image decorative and hides it
 * from a screen reader entirely. Mobile's `community-card.tsx` already falls back
 * on `?.trim() ||`; this is the same rule.
 */
function altTextOf(item: CommunityFeedItem, authorName: string, t: Translate): string {
  return item.altText?.trim() || t('community.card.label', { author: authorName })
}

function modeLabel(
  mode: CommunityFeedMode,
  viewerBand: ClimateBand | null,
  t: Translate,
  // Defaults to the pre-existing behaviour for the two callers describing a
  // served or just-requested mode directly, where `mode` already IS the thing
  // being labelled. The chip strip is different: it renders one button per
  // possible mode and must not let an unselected `auto` button promise a
  // resolved climate the currently served feed is not filtered to.
  isActive = true
): string {
  if (isActive && mode === 'auto' && viewerBand) {
    return t('community.filters.mode.autoWithBand', {
      band: t(`community.band.${viewerBand}`),
    })
  }
  return t(`community.filters.mode.${mode}`)
}

function trackClimateSelection(mode: FilterCategory) {
  try {
    posthog.capture('layout_interaction', { action: 'filter_chip_click', target: mode })
  } catch {
    // Telemetry must never take the feed down with it.
  }
}

/**
 * Null-safe on purpose: every caller holds a `Message | null`, and folding the
 * absent case in here keeps the branch out of each of the five call sites.
 */
function renderMessage(
  message: Message | null,
  t: Translate,
  viewerBand: ClimateBand | null
): string | null {
  if (message === null) {
    return null
  }
  const { filterMode, ...rest } = message.params ?? {}
  if (filterMode === undefined) {
    return t(message.key, rest)
  }
  return t(message.key, {
    ...rest,
    filter: modeLabel(filterMode as CommunityFeedMode, viewerBand, t),
  })
}

/** Wall-clock time the 429's `Retry-After` window closes, in the reader's locale. */
function formatRetryTime(seconds: number, language: string): string {
  const at = new Date(Date.now() + seconds * 1000)
  try {
    return new Intl.DateTimeFormat(language, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(at)
  } catch {
    return at.toLocaleTimeString()
  }
}

function messageForError(error: unknown, fallbackKey: string, language: string): Message {
  const reason = communityFailureReason(error)
  if (reason === 'rate_limited') {
    const seconds = communityRetryAfterSeconds(error)
    return seconds === undefined
      ? { key: 'community.error.rateLimited' }
      : {
          key: 'community.error.rateLimitedUntil',
          params: { time: formatRetryTime(seconds, language) },
        }
  }
  return { key: reason === 'unknown' ? fallbackKey : FAILURE_KEYS[reason] }
}

/**
 * Which caption rule the contract's own schema rejected.
 *
 * The three rules live in `communityPostCaptionSchema` and the two regexes stay
 * there; re-declaring them here is what produced a client copy that could drift
 * from the server's. The refinements differ only by message, so the narrower
 * word separates them without a second regex.
 */
function captionValidationKey(value: string): string | null {
  const result = communityPostCaptionSchema.safeParse(value)
  if (result.success) {
    return null
  }
  if (result.error.issues.some((issue) => issue.code === 'too_big')) {
    return 'community.validation.captionTooLong'
  }
  const mentionsEmail = result.error.issues.some((issue) =>
    issue.message.toLowerCase().includes('email')
  )
  return mentionsEmail
    ? 'community.validation.captionEmail'
    : 'community.validation.captionUrl'
}

/**
 * The whole compose gate in one place, in the order the reader meets it. The
 * alt-text confirmation is a hard gate rather than a nudge: the contract types
 * `altTextConfirmed` as `z.literal(true)` and the spec forbids publishing
 * unconfirmed alt text.
 */
function composeValidationKey(input: {
  hasAllocatedPhoto: boolean
  altText: string
  isAltTextConfirmed: boolean
  caption: string
}): string | null {
  if (!input.hasAllocatedPhoto) {
    return 'community.validation.photoRequired'
  }
  if (input.altText.trim().length === 0) {
    return 'community.validation.altRequired'
  }
  if (!input.isAltTextConfirmed) {
    return 'community.validation.altConfirmRequired'
  }
  return captionValidationKey(input.caption)
}

/**
 * `useTranslation` bound to this app's instance explicitly.
 *
 * `lookbook-prism-layout.tsx` mounts `I18nextProvider` around its two planner
 * slots only, and renders this component outside
 * both, so there is no provider above this subtree. Naming the instance is what
 * makes `t` resolve here rather than depending on whichever component happened
 * to call `getI18n()` first.
 */
function useCommunityTranslation() {
  return useTranslation(undefined, { i18n: getI18n() })
}

function useResolvedLocale(language: string): SupportedLocale {
  return useMemo(() => {
    const parsed = supportedLocaleSchema.safeParse(language)
    return parsed.success ? parsed.data : defaultSupportedLocale
  }, [language])
}

// ---------------------------------------------------------------------------
// Community climate filter
// ---------------------------------------------------------------------------

export function CommunityClimateFilter({
  activeTab,
  viewerBand = null,
  onTabChange,
  children,
}: {
  activeTab: FilterCategory
  viewerBand?: ClimateBand | null
  onTabChange: (mode: FilterCategory) => void
  children?: React.ReactNode
}) {
  const { t } = useCommunityTranslation()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const label = (mode: FilterCategory) =>
    mode === 'all'
      ? t('community.calm.allClimates')
      : modeLabel(mode, viewerBand, t, mode === activeTab)

  return (
    <div>
      <button
        ref={trigger}
        type="button"
        data-testid="community-climate-filter"
        data-share-card-focus-fallback="community"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-line-strong bg-page px-4 py-2 text-left text-sm font-semibold text-ink"
      >
        <span className="min-w-0 break-words">{label(activeTab)}</span>
        <span aria-hidden="true" className="shrink-0">
          ⌄
        </span>
      </button>
      <AccessibleModal
        isOpen={open}
        onClose={() => setOpen(false)}
        invokingElementRef={trigger}
        title={t('community.filters.label')}
        titleId={titleId}
        descriptionId={descriptionId}
      >
        <div data-testid="community-climate-sheet" className="flex flex-col gap-4">
          <p
            id={descriptionId}
            data-testid="community-filters-explainer"
            className="text-sm text-ink-muted"
          >
            {t('community.filters.explainer')}
          </p>
          {children}
          <div className="grid gap-2 sm:grid-cols-2">
            {COMMUNITY_FEED_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`community-filter-${mode}`}
                aria-pressed={mode === activeTab}
                className="min-h-11 min-w-0 break-words rounded-md border border-line-strong px-3 py-2 text-left text-sm aria-pressed:border-ink aria-pressed:bg-inverse aria-pressed:font-semibold aria-pressed:text-on-inverse"
                onClick={() => {
                  setOpen(false)
                  onTabChange(mode)
                  trackClimateSelection(mode)
                }}
              >
                {label(mode)}
              </button>
            ))}
          </div>
        </div>
      </AccessibleModal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WeeklyChallengeBanner
// ---------------------------------------------------------------------------

interface WeeklyChallengeBannerProps {
  challenge: EmbeddedCommunityChallenge
  t: Translate
  /** False for a reader who cannot post: the challenge still shows, without its entry button. */
  canParticipate: boolean
  onParticipate: (challenge: EmbeddedCommunityChallenge) => void
  onDismiss: () => void
}

function WeeklyChallengeBanner({
  challenge,
  t,
  canParticipate,
  onParticipate,
  onDismiss,
}: WeeklyChallengeBannerProps) {
  return (
    <aside
      data-testid="weekly-challenge-banner"
      aria-labelledby="weekly-challenge-title"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-3 py-1"
    >
      <h2
        id="weekly-challenge-title"
        className="min-w-0 flex-1 break-words text-sm font-medium text-ink"
      >
        {t('community.calm.thisWeek', { title: challenge.title })}
      </h2>
      <div className="ml-auto flex items-center gap-1">
        {canParticipate && (
          <button
            type="button"
            data-testid="challenge-participate-button"
            aria-label={t('community.challenge.participateLabel', {
              title: challenge.title,
            })}
            className="min-h-11 px-2 text-sm font-semibold text-ink underline"
            onClick={() => onParticipate(challenge)}
          >
            {t('community.challenge.participate')}
          </button>
        )}
        <button
          type="button"
          data-testid="community-challenge-dismiss"
          aria-label={t('community.calm.dismissChallenge')}
          className="min-h-11 min-w-11 rounded-md text-xl text-ink-muted"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// LookbookCard
// ---------------------------------------------------------------------------

interface LookbookCardImageSurfaceProps {
  /** Prefix for every id and test id, so a spotlight copy never collides with the feed copy. */
  scope: string
  item: CommunityFeedItem
  isFailedImage: boolean
  t: Translate
  onImageError: (item: CommunityFeedItem) => void
  onImageRetry: (item: CommunityFeedItem) => void
  onOpen: (item: CommunityFeedItem) => void
}

/** The id of a card's sponsorship disclosure, which the card's name includes. */
function sponsoredDisclosureId(scope: string, postId: string): string {
  return `${scope}lookbook-card-sponsored-${postId}`
}

function LookbookCardImageSurface({
  scope,
  item,
  isFailedImage,
  t,
  onImageError,
  onImageRetry,
  onOpen,
}: LookbookCardImageSurfaceProps) {
  const authorName = authorNameOf(item, t)
  const altText = altTextOf(item, authorName, t)

  return (
    <div
      data-testid={`${scope}lookbook-image-${item.id}`}
      className="relative flex h-64 w-full items-center justify-center overflow-hidden rounded-t-xl bg-theme-card-bg"
    >
      {isFailedImage ? (
        <div
          data-testid={`${scope}image-unavailable-${item.id}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-theme-card-bg p-4 text-center"
        >
          <span className="text-xs font-medium text-ink-muted">
            {t('community.card.imageUnavailable')}
          </span>
          <button
            type="button"
            data-testid={`${scope}image-retry-button-${item.id}`}
            onClick={() => {
              onImageRetry(item)
            }}
            className="min-h-11 rounded-full border border-theme-card-border px-4 py-2 text-xs font-semibold text-theme-card-text"
          >
            {t('community.card.imageRetry')}
          </button>
        </div>
      ) : (
        <Image
          src={item.imageAccess.url}
          alt={altText}
          fill
          unoptimized
          sizes="(min-width: 768px) 50vw, 100vw"
          onError={() => {
            onImageError(item)
          }}
          className="object-cover motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-[1.02] motion-reduce:transition-none"
        />
      )}

      {/*
       * The card's one real "open". The grid crops every look to 256px and clamps
       * its caption to three lines, so viewing the look whole is an interaction
       * the surface already implies rather than a click target invented to give
       * `community_card_opened` a producer. It covers the image and carries the
       * pill as its visible label; a card whose object will not load has nothing
       * to open, so the failed state offers reload instead.
       */}
      {!isFailedImage && (
        <button
          type="button"
          data-testid={`${scope}lookbook-open-${item.id}`}
          aria-label={t('community.card.openLabel', { author: authorName })}
          onClick={() => {
            onOpen(item)
          }}
          className="absolute inset-0 flex items-end justify-end p-3"
        ></button>
      )}

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center gap-2">
        {scope === SPOTLIGHT_CARD_SCOPE && (
          <span className="rounded-md bg-inverse px-3 py-1 text-xs font-semibold text-on-inverse">
            {t('community.calm.nearYou')}
          </span>
        )}
        {item.status !== 'published' && (
          <span
            data-testid={`${scope}status-badge-${item.id}`}
            className="rounded-md border border-line-strong bg-page/95 px-2 py-0.5 text-xs font-medium uppercase text-ink"
          >
            {t(`community.status.${item.status}`)}
          </span>
        )}
        {/*
         * Story 6.7b: only a live response's sponsorship block makes a card
         * claim a commercial relationship, and the card's accessible name
         * carries the partner through `aria-labelledby`.
         */}
        {item.sponsorship && (
          <span
            data-testid={`${scope}sponsored-badge-${item.id}`}
            className="rounded-md border border-line-strong bg-page/95 px-2 py-0.5 text-xs font-semibold uppercase text-ink"
          >
            <span aria-hidden="true">{t('community.card.sponsored')}</span>
            <span id={sponsoredDisclosureId(scope, item.id)} className="sr-only">
              {t('community.card.sponsoredAnnounce', {
                partner: item.sponsorship.partnerDisplayName,
              })}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

interface LookbookCardContentProps {
  scope: string
  reactionControls: ReactionControls
  item: CommunityFeedItem
  isReported: boolean
  canAct: boolean
  t: Translate
  onReport: (postId: string) => void
  onWithdraw: (postId: string) => void
}

function CompactLookbookCardContent({
  scope,
  reactionControls,
  item,
  isReported,
  canAct,
  t,
  onOpen,
  onReport,
  onWithdraw,
}: LookbookCardContentProps & { onOpen: LookbookCardProps['onOpen'] }) {
  const actions = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const authorName = authorNameOf(item, t)
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3
            id={`${scope}lookbook-card-title-${item.id}`}
            className="text-base font-semibold"
          >
            <button
              type="button"
              data-testid={`${scope}title-${item.id}`}
              className="min-h-11 w-full break-words text-left hover:underline"
              onClick={() => onOpen(item)}
            >
              {item.title || t('community.card.label', { author: authorName })}
            </button>
          </h3>
          <p
            data-testid={`${scope}author-name-${item.id}`}
            className="break-words text-sm text-ink-muted"
          >
            {authorName}
          </p>
        </div>
        {canAct && (
          <details
            ref={actions}
            className="relative shrink-0"
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                event.currentTarget.open = false
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !event.currentTarget.open) return
              event.stopPropagation()
              event.currentTarget.open = false
              trigger.current?.focus()
            }}
          >
            <summary
              ref={trigger}
              aria-label={t('community.calm.cardActions')}
              data-testid="community-card-actions"
              className="grid min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-md text-xl [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">⋯</span>
            </summary>
            <button
              type="button"
              data-testid={`${scope}${item.author.isSelf ? 'withdraw' : 'report'}-button-${item.id}`}
              disabled={!item.author.isSelf && isReported}
              className="absolute right-0 top-full z-10 min-h-11 rounded-md border border-line-strong bg-page px-3 py-2 text-sm font-semibold text-ink shadow-card disabled:text-ink-muted"
              onClick={() => {
                if (actions.current) actions.current.open = false
                trigger.current?.focus()
                if (item.author.isSelf) onWithdraw(item.id)
                else onReport(item.id)
              }}
            >
              {t(
                item.author.isSelf
                  ? 'community.card.withdraw'
                  : isReported
                    ? 'community.card.reported'
                    : 'community.card.report'
              )}
            </button>
          </details>
        )}
      </div>
      {canAct && (
        <CommunityReactions item={item} controls={reactionControls} scope={scope} />
      )}
    </div>
  )
}

interface LookbookCardProps {
  /** Empty for the feed; `spotlight-` for the City Spotlight's copy of a post. */
  scope?: string
  /** Story CC-7.11 P5: the feed's first card marks its photo as Community's first content. */
  firstContent?: boolean
  reactionControls: ReactionControls
  item: CommunityFeedItem
  isHighlighted: boolean
  isFailedImage: boolean
  isReported: boolean
  canAct: boolean
  t: Translate
  sponsored: SponsoredCtaHost
  onImageError: (item: CommunityFeedItem) => void
  onImageRetry: (item: CommunityFeedItem) => void
  onOpen: (item: CommunityFeedItem) => void
  onReport: (postId: string) => void
  onWithdraw: (postId: string) => void
}

/** What every sponsored CTA on this surface shares with its host. */
interface SponsoredCtaHost {
  surface: AffiliateCommunitySurface
  language: string
  shown: SponsoredShownRegistry
  announce: (key: string) => void
}

/**
 * The CTA for one post on one surface. Outside every open action, and only for
 * a viewer who can act: a click is minted against the viewer's session.
 */
function SponsoredCtaSlot({
  scope,
  item,
  canAct,
  t,
  host,
}: {
  scope: string
  item: CommunityFeedItem
  canAct: boolean
  t: Translate
  host: SponsoredCtaHost
}) {
  if (!canAct || !item.sponsorship) return null
  return (
    <div className="px-5 pt-3">
      <CommunitySponsoredCta
        postId={item.id}
        sponsorship={item.sponsorship}
        surface={host.surface}
        scope={scope}
        language={host.language}
        t={t}
        shown={host.shown}
        announce={host.announce}
      />
    </div>
  )
}

function LookbookCard({
  scope = '',
  firstContent = false,
  reactionControls,
  item,
  isHighlighted,
  isFailedImage,
  isReported,
  canAct,
  t,
  sponsored,
  onImageError,
  onImageRetry,
  onOpen,
  onReport,
  onWithdraw,
}: LookbookCardProps) {
  const titleId = `${scope}lookbook-card-title-${item.id}`
  const photo = (
    <LookbookCardImageSurface
      scope={scope}
      item={item}
      isFailedImage={isFailedImage}
      t={t}
      onImageError={onImageError}
      onImageRetry={onImageRetry}
      onOpen={onOpen}
    />
  )
  const contentProps = {
    scope,
    reactionControls,
    item,
    isReported,
    canAct,
    t,
    onReport,
    onWithdraw,
  }
  return (
    <article
      id={`${scope}lookbook-card-${item.id}`}
      data-testid={`${scope}lookbook-card-${item.id}`}
      tabIndex={-1}
      aria-labelledby={
        item.sponsorship ? `${titleId} ${sponsoredDisclosureId(scope, item.id)}` : titleId
      }
      data-highlighted={isHighlighted ? 'true' : 'false'}
      data-surface="card"
      className={`flex flex-col rounded-xl border bg-theme-card-bg text-theme-card-text shadow-card motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200 motion-reduce:transition-none ${
        isHighlighted
          ? 'border-inverse outline outline-2 outline-inverse ring-2 ring-line-strong ring-offset-2 shadow-overlay'
          : 'border-theme-card-border'
      }`}
    >
      {firstContent ? <div data-testid="community-first-content">{photo}</div> : photo}
      <SponsoredCtaSlot
        scope={scope}
        item={item}
        canAct={canAct}
        t={t}
        host={sponsored}
      />
      <CompactLookbookCardContent {...contentProps} onOpen={onOpen} />
    </article>
  )
}

// ---------------------------------------------------------------------------
// LookbookDetailDialog
// ---------------------------------------------------------------------------

function detailRevalidationTargets(
  highlightedId: string | undefined,
  openedItem: CommunityFeedItem | null,
  hasLoadedFeed: boolean
): string[] {
  return [
    ...new Set(
      [hasLoadedFeed ? highlightedId : undefined, openedItem?.id].filter(
        (target): target is string => Boolean(target)
      )
    ),
  ]
}

interface LookbookDetailDialogProps {
  suspended?: boolean
  commentTarget?: {
    commentId: string
    parentId: string | null
    pageCursor: string | null
    parentPageCursor: string | null
  }
  focusComments: boolean
  comments: CommunityCommentsState
  reactionFeedback: { key: string; id: number } | null
  reactionControls: ReactionControls
  item: CommunityFeedItem
  canAct: boolean
  sponsored: SponsoredCtaHost
  t: Translate
  /** Where focus goes after close when the control that opened the detail is gone. */
  restoreFocus: { opener: string | undefined; final: string }
  onTextSaved: (postId: string, text: EditCommunityPostTextResponse['data']) => void
  onTextStatus: (key: string) => void
  onClose: () => void
}

/** Shows the whole photograph, caption and secondary actions for the opened look. */
function LookbookDetailDialog({
  suspended = false,
  focusComments,
  comments,
  reactionFeedback,
  item,
  canAct,
  sponsored,
  t,
  restoreFocus,
  onClose,
  onTextSaved,
  onTextStatus,
  reactionControls,
  commentTarget,
}: LookbookDetailDialogProps) {
  const authorName = authorNameOf(item, t)

  return (
    <AccessibleModal
      suspended={suspended}
      isOpen
      onClose={onClose}
      title={item.title || t('community.card.label', { author: authorName })}
      surface="theme"
      // Story CC-7.11 D12: post detail is a full-height layer under a top bar with back and the
      // post title; it closes like any overlay (back arrow, Escape, swipe down, browser back).
      presentation="screen"
      titleId="community-detail-title"
      fallbackFocusSelector={restoreFocus.opener}
      finalFocusSelector={restoreFocus.final}
    >
      <div data-testid="community-detail" className="flex flex-col gap-4">
        {canAct &&
          item.author.isSelf &&
          item.status === 'published' &&
          item.publishedAt !== null && (
            <CommunityShareCardControl postId={item.id} scope="detail-" />
          )}
        <CommunityReactions item={item} controls={reactionControls} />
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="community-detail-feedback"
        >
          <span key={reactionFeedback?.id}>
            {reactionFeedback ? t(reactionFeedback.key) : null}
          </span>
        </div>
        <div className="relative h-80 w-full overflow-hidden rounded-md bg-theme-card-bg">
          <Image
            src={item.imageAccess.url}
            alt={altTextOf(item, authorName, t)}
            fill
            unoptimized
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid={`community-detail-band-${item.id}`}
            className="rounded-md bg-inverse px-3 py-1 text-xs font-semibold uppercase text-on-inverse"
          >
            {bandLabel(item.climateBand, t)}
          </span>
          <span
            data-testid="community-detail-author"
            className="text-xs font-semibold text-theme-card-text"
          >
            {authorName}
          </span>
          {(item.textRevision ?? 0) > 0 && (
            <span
              data-testid="community-detail-edited"
              className="text-xs font-medium text-ink-muted"
            >
              {t('community.card.edited')}
            </span>
          )}
          {item.sponsorship && (
            <span
              data-testid={`community-detail-sponsored-${item.id}`}
              className="rounded-md border border-theme-card-border px-2 py-0.5 text-xs font-semibold uppercase text-theme-card-text"
            >
              <span aria-hidden="true">{t('community.card.sponsored')}</span>
              <span className="sr-only">
                {t('community.card.sponsoredAnnounce', {
                  partner: item.sponsorship.partnerDisplayName,
                })}
              </span>
            </span>
          )}
        </div>

        {item.caption && (
          <p
            data-testid="community-detail-caption"
            className="text-xs leading-relaxed text-ink-muted"
          >
            {item.caption}
          </p>
        )}
        <CommunityPostTextEditor
          key={item.id}
          item={item}
          enabled={canAct && !suspended}
          onSaved={onTextSaved}
          onStatus={onTextStatus}
          t={t}
        />
        {canAct && item.sponsorship && (
          <CommunitySponsoredCta
            postId={item.id}
            sponsorship={item.sponsorship}
            surface={sponsored.surface}
            scope="community-detail-"
            language={sponsored.language}
            t={t}
            shown={sponsored.shown}
            announce={sponsored.announce}
          />
        )}
        <CommunityComments
          postId={item.id}
          state={comments}
          focusOnOpen={focusComments && !commentTarget}
          target={commentTarget}
          onClose={onClose}
        />
      </div>
    </AccessibleModal>
  )
}

// ---------------------------------------------------------------------------
// AuthorStatesSection
// ---------------------------------------------------------------------------

interface AuthorStatesSectionProps {
  states: readonly CommunityAuthorPostState[]
  t: Translate
}

/**
 * The caller's own non-published posts, which the server keeps out of `items`
 * because they have no `published_at` to keyset on.
 *
 * Rendered as text rather than as cards: a flagged or consent-suspended post's
 * object may already be gone, so there is no image to promise. Flagged reads in
 * merlot, matching the premium accent system's assignment of merlot to errors
 * and destructive states including flagged content.
 */
/**
 * What the author reads about a held post. A stable pipeline code such as
 * `text_policy_match` becomes localized copy that says what to change; only a
 * moderator's free-text takedown reason is shown as written.
 */
function moderationReasonText(reason: string, t: Translate): string {
  const categories = communityModerationReasonCategories(reason)
  if (categories === null) {
    return t('community.status.reason', { reason })
  }
  return categories
    .map((category) => t(`community.moderationReason.${category}`))
    .join(' ')
}

function AuthorStatesSection({ states, t }: AuthorStatesSectionProps) {
  if (states.length === 0) {
    return null
  }

  return (
    <section
      data-testid="community-author-states"
      aria-labelledby="community-author-states-title"
      data-surface="card"
      className="flex flex-col gap-3 rounded-xl border border-theme-card-border bg-theme-card-bg p-5 text-theme-card-text"
    >
      <div className="space-y-1">
        <h3
          id="community-author-states-title"
          className="text-base font-semibold text-theme-card-text"
        >
          {t('community.feed.yourPostsTitle')}
        </h3>
        <p className="text-xs text-ink-muted">{t('community.feed.yourPostsBody')}</p>
      </div>

      <ul className="flex flex-col gap-3">
        {states.map((state) => {
          const isFlagged = state.status === 'flagged'
          return (
            <li
              key={state.id}
              data-testid={`author-state-${state.id}`}
              className="space-y-1 border-t border-theme-card-border pt-3 first:border-t-0 first:pt-0"
            >
              <span
                data-testid={`status-badge-${state.id}`}
                className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${
                  isFlagged
                    ? MERLOT_CLASS
                    : 'border-theme-card-border text-theme-card-text'
                }`}
              >
                {t(`community.status.${state.status}`)}
              </span>
              {REMOVED_STATUSES.has(state.status) && (
                <p
                  data-testid={`author-state-explanation-${state.id}`}
                  className={`text-xs leading-relaxed ${isFlagged ? 'text-merlot-ink' : 'text-ink-muted'}`}
                >
                  {t(`community.removed.${state.status}`)}
                </p>
              )}
              {state.moderationReason && (
                <p
                  data-testid={`author-state-reason-${state.id}`}
                  className="text-xs text-ink-muted"
                >
                  {moderationReasonText(state.moderationReason, t)}
                </p>
              )}
              {state.title && (
                <p
                  data-testid={`author-state-title-${state.id}`}
                  className="break-words text-sm font-semibold"
                >
                  {state.title}
                </p>
              )}
              {state.caption && (
                <p
                  data-testid={`author-state-caption-${state.id}`}
                  className="text-xs leading-relaxed text-ink-muted line-clamp-2"
                >
                  {state.caption}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// CommunityReportModal
// ---------------------------------------------------------------------------

interface CommunityReportModalProps {
  suspended?: boolean
  onClose: () => void
  onSubmit: (reason: CommunityReportReason, details?: string) => void
  isSubmitting: boolean
  errorMessage?: string | null
  t: Translate
}

function CommunityReportModal({
  suspended = false,
  onClose,
  onSubmit,
  isSubmitting,
  errorMessage,
  t,
}: CommunityReportModalProps) {
  const [reason, setReason] = useState<CommunityReportReason>('spam')
  const [details, setDetails] = useState('')

  return (
    <AccessibleModal
      suspended={suspended}
      isOpen
      onClose={onClose}
      // The panel follows the lookbook theme, so a premium palette under a dark system setting
      // keeps its light panel and the controls inside it match.
      surface="theme"
      title={t('community.report.title')}
      titleId="report-modal-title"
      description={t('community.report.description')}
      descriptionId="report-modal-desc"
      closeLabel={t('community.report.close')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(reason, details)
        }}
        className="flex flex-col gap-4"
      >
        {errorMessage && (
          <div
            role="alert"
            data-testid="report-error-message"
            className={`rounded-md border p-3 text-xs ${MERLOT_CLASS}`}
          >
            {errorMessage}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="report-reason-select"
            className="text-xs font-semibold text-theme-card-text"
          >
            {t('community.report.reasonLabel')}
          </label>
          <select
            id="report-reason-select"
            data-testid="report-reason-select"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as CommunityReportReason)
            }}
            className="w-full rounded-md border border-line-strong bg-page px-3 py-2 text-xs text-ink"
          >
            {communityReportReasonSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`community.report.reason.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="report-details-input"
            className="text-xs font-semibold text-theme-card-text"
          >
            {t('community.report.detailsLabel')}
          </label>
          <textarea
            id="report-details-input"
            data-testid="report-details-input"
            value={details}
            onChange={(event) => {
              setDetails(event.target.value)
            }}
            maxLength={500}
            rows={3}
            placeholder={t('community.report.detailsPlaceholder')}
            className="w-full rounded-md border border-line-strong bg-page p-3 text-xs text-ink placeholder:text-ink-muted"
          />
          <span className="text-xs text-ink-muted">
            {t('community.report.detailsCount', { count: details.length })}
          </span>
        </div>

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-11 rounded-full border border-theme-card-border px-4 py-2 text-xs font-medium text-ink-muted"
          >
            {t('community.report.cancel')}
          </button>
          <button
            type="submit"
            data-testid="report-submit-button"
            disabled={isSubmitting}
            className="min-h-11 rounded-full bg-danger px-5 py-2 text-xs font-semibold text-on-danger disabled:opacity-50"
          >
            {isSubmitting
              ? t('community.report.submitting')
              : t('community.report.submit')}
          </button>
        </div>
      </form>
    </AccessibleModal>
  )
}

// ---------------------------------------------------------------------------
// PostCreationModal
// ---------------------------------------------------------------------------

function invalidPostTitle(title: string) {
  return Boolean(title.trim()) && !communityPostTitleSchema.safeParse(title).success
}

function PostTitleField({
  title,
  onChange,
  titleInvalid,
  t,
}: {
  title: string
  onChange: (title: string) => void
  titleInvalid: boolean
  t: Translate
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor="post-title-input"
        className="text-xs font-semibold text-theme-card-text"
      >
        {t('community.compose.titleLabel')}
      </label>
      <input
        id="post-title-input"
        data-testid="post-title-input"
        value={title}
        maxLength={COMMUNITY_POST_TITLE_MAX_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-line-strong bg-page p-3 text-sm text-ink"
      />
      {titleInvalid && (
        <p role="alert" className="text-sm">
          {t('community.compose.titleInvalid')}
        </p>
      )}
    </div>
  )
}

function DraftDescriptionControl({
  canSuggest,
  hasCaption,
  suspended,
  isPublishing,
  status,
  onSuggest,
  t,
}: {
  canSuggest: boolean
  hasCaption: boolean
  suspended: boolean
  isPublishing: boolean
  status: 'idle' | 'loading' | 'failed'
  onSuggest: () => void
  t: Translate
}) {
  return (
    <>
      {canSuggest && !hasCaption && (
        <button
          type="button"
          data-testid="community-suggest-description"
          className="block min-h-11 rounded-md border border-theme-card-border px-3 text-sm font-semibold text-theme-card-text disabled:opacity-60"
          disabled={suspended || isPublishing || status === 'loading'}
          onClick={onSuggest}
        >
          {t(
            status === 'loading'
              ? 'community.compose.descriptionWorking'
              : 'community.compose.suggestDescription'
          )}
        </button>
      )}
      {status === 'failed' && (
        <p role="status" className="text-xs text-theme-card-text">
          {t('community.compose.descriptionFailed')}
        </p>
      )}
    </>
  )
}

function describeDraftRequest(
  allocated: AllocatedLook | null,
  sessionScope: string | null
) {
  if (!allocated) return undefined
  const { postId, uploadSessionId } = allocated
  return (signal: AbortSignal) =>
    describeCommunityDraftFromWeb({ postId, uploadSessionId }, sessionScope, signal)
}

interface PostCreationModalProps {
  suspended?: boolean
  onClose: () => void
  onSelectPhoto: (file: File) => void
  describeDraft?: (signal: AbortSignal) => Promise<string>
  onPublish: (params: {
    altText: string
    caption?: string
    title?: string
    challengeId?: string | null
  }) => void
  /** Preview of the chosen photo, owned by the grid so it can revoke the object URL. */
  photoPreview: string | null
  /** Server-generated starting point, present once allocate has answered. */
  altTextSuggestion: string | null
  isPreparing: boolean
  isPublishing: boolean
  activeChallenge: EmbeddedCommunityChallenge | null
  errorMessage?: string | null
  t: Translate
}

/**
 * The compose flow is two server steps, and the split is not cosmetic: the alt
 * text suggestion is generated server-side and has to reach this form BEFORE
 * the author confirms it, so choosing a photo allocates and uploads, and
 * publishing sends the confirmed text. The client never invents a suggestion.
 */
function ChallengeInstructions({
  challenge,
  selectedId,
}: {
  challenge: EmbeddedCommunityChallenge
  selectedId: string | null
}) {
  if (selectedId !== challenge.id) return null
  return (
    <p className="text-sm text-ink-muted" data-testid="post-challenge-instructions">
      {challenge.body}
    </p>
  )
}

function PostCreationModal({
  suspended = false,
  onClose,
  onSelectPhoto,
  describeDraft,
  onPublish,
  photoPreview,
  altTextSuggestion,
  isPreparing,
  isPublishing,
  activeChallenge,
  errorMessage,
  t,
}: PostCreationModalProps) {
  const [altText, setAltText] = useState('')
  const [isAltTextConfirmed, setIsAltTextConfirmed] = useState(false)
  const [caption, setCaption] = useState('')
  const [descriptionStatus, setDescriptionStatus] = useState<
    'idle' | 'loading' | 'failed'
  >('idle')
  const description = useRef<AbortController | null>(null)
  const autoCaption = useRef<string | null>(null)

  const cancelDescription = () => {
    description.current?.abort()
    description.current = null
  }
  useEffect(() => {
    if (suspended) {
      cancelDescription()
      setDescriptionStatus('idle')
    }
    return cancelDescription
  }, [suspended])

  const suggestDescription = async () => {
    if (suspended || !describeDraft || caption || description.current) return
    const controller = new AbortController()
    description.current = controller
    setDescriptionStatus('loading')
    try {
      const suggested = await describeDraft(controller.signal)
      if (controller.signal.aborted) return
      autoCaption.current = suggested
      setCaption((current) => current || suggested)
      setDescriptionStatus('idle')
    } catch (error) {
      if (!controller.signal.aborted) {
        setDescriptionStatus(
          error instanceof CommunityRequestSuperseded ? 'idle' : 'failed'
        )
      }
    } finally {
      if (description.current === controller) description.current = null
    }
  }
  const [title, setTitle] = useState('')
  const titleInvalid = invalidPostTitle(title)
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(
    activeChallenge?.id ?? null
  )
  const [validationKey, setValidationKey] = useState<string | null>(null)

  useEffect(() => {
    if (altTextSuggestion) {
      setAltText(altTextSuggestion)
      setIsAltTextConfirmed(false)
    }
  }, [altTextSuggestion])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (isPublishing) return
    const failure = composeValidationKey({
      hasAllocatedPhoto: altTextSuggestion !== null,
      altText,
      isAltTextConfirmed,
      caption,
    })
    setValidationKey(failure)
    if (failure !== null || titleInvalid) {
      return
    }
    cancelDescription()
    setDescriptionStatus('idle')
    onPublish({
      altText: altText.trim(),
      caption: caption.trim() || undefined,
      title: title.trim() || undefined,
      challengeId: selectedChallengeId,
    })
  }

  const isPublishBlocked =
    titleInvalid ||
    isPublishing ||
    isPreparing ||
    composeValidationKey({
      hasAllocatedPhoto: altTextSuggestion !== null,
      altText,
      isAltTextConfirmed,
      caption,
    }) !== null

  return (
    <AccessibleModal
      suspended={suspended}
      isOpen
      onClose={() => {
        if (!isPublishing) onClose()
      }}
      // The panel follows the lookbook theme, so a premium palette under a dark system setting
      // keeps its light panel and the controls inside it match.
      surface="theme"
      title={t('community.compose.title')}
      titleId="create-post-modal-title"
      description={t('community.compose.description')}
      descriptionId="create-post-modal-desc"
      closeLabel={t('community.compose.close')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {(errorMessage ?? validationKey) && (
          <div
            role="alert"
            data-testid="create-post-error"
            className={`rounded-md border p-3 text-xs ${MERLOT_CLASS}`}
          >
            {errorMessage ?? (validationKey ? t(validationKey) : '')}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="post-image-file"
            className="text-xs font-semibold text-theme-card-text"
          >
            {t('community.compose.photoLabel')}
          </label>
          <input
            id="post-image-file"
            type="file"
            data-testid="post-image-file-input"
            accept="image/jpeg,image/png,image/webp"
            disabled={isPublishing}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                cancelDescription()
                setDescriptionStatus('idle')
                if (autoCaption.current !== null) setCaption('')
                autoCaption.current = null
                setValidationKey(null)
                onSelectPhoto(file)
              }
            }}
            className="w-full text-xs text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border file:border-solid file:border-line-strong file:bg-page file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ink"
          />
          <p className="text-xs text-ink-muted">{t('community.compose.photoHint')}</p>
          {photoPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt={t('community.compose.preview')}
              data-testid="post-image-preview"
              className="max-h-40 rounded-md object-cover"
            />
          )}
          {isPreparing && (
            <p data-testid="create-post-progress" className="text-xs text-ink-muted">
              {t('community.compose.uploading')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="post-alt-text"
            className="text-xs font-semibold text-theme-card-text"
          >
            {t('community.compose.altLabel')}
          </label>
          <textarea
            id="post-alt-text"
            data-testid="post-alt-text-input"
            value={altText}
            onChange={(event) => {
              setAltText(event.target.value)
              setIsAltTextConfirmed(false)
            }}
            maxLength={200}
            rows={2}
            placeholder={t('community.compose.altPlaceholder')}
            className="w-full rounded-md border border-line-strong bg-page p-3 text-xs text-ink placeholder:text-ink-muted"
          />
          <p className="text-xs text-ink-muted">
            {altTextSuggestion
              ? t('community.compose.altSuggested')
              : t('community.compose.altHint')}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="confirm-alt-text"
              type="checkbox"
              data-testid="confirm-alt-text-checkbox"
              checked={isAltTextConfirmed}
              onChange={(event) => {
                setIsAltTextConfirmed(event.target.checked)
              }}
              className="h-4 w-4 rounded-sm border-theme-card-border accent-ink"
            />
            <label
              htmlFor="confirm-alt-text"
              className="text-xs font-medium text-theme-card-text"
            >
              {t('community.compose.altConfirm')}
            </label>
          </div>
        </div>

        <PostTitleField
          title={title}
          onChange={setTitle}
          titleInvalid={titleInvalid}
          t={t}
        />

        <div className="space-y-2">
          <label
            htmlFor="post-caption-input"
            className="text-xs font-semibold text-theme-card-text"
          >
            {t('community.compose.captionLabel')}
          </label>
          <textarea
            id="post-caption-input"
            data-testid="post-caption-input"
            value={caption}
            onChange={(event) => {
              cancelDescription()
              autoCaption.current = null
              setDescriptionStatus('idle')
              setCaption(event.target.value)
              setValidationKey(captionValidationKey(event.target.value))
            }}
            maxLength={280}
            rows={3}
            placeholder={t('community.compose.captionPlaceholder')}
            className="w-full rounded-md border border-line-strong bg-page p-3 text-xs text-ink placeholder:text-ink-muted"
          />
          <span className="text-xs text-ink-muted">
            {t('community.compose.captionCount', { count: caption.length })}
          </span>
          <DraftDescriptionControl
            canSuggest={Boolean(describeDraft)}
            hasCaption={Boolean(caption)}
            suspended={suspended}
            isPublishing={isPublishing}
            status={descriptionStatus}
            onSuggest={() => void suggestDescription()}
            t={t}
          />
        </div>

        {activeChallenge && (
          <div className="space-y-2">
            <label
              htmlFor="post-challenge-select"
              className="text-xs font-semibold text-theme-card-text"
            >
              {t('community.compose.challengeLabel')}
            </label>
            <select
              id="post-challenge-select"
              data-testid="post-challenge-select"
              value={selectedChallengeId ?? ''}
              onChange={(event) => {
                setSelectedChallengeId(event.target.value || null)
              }}
              className="w-full rounded-md border border-line-strong bg-page px-3 py-2 text-xs text-ink"
            >
              <option value="">{t('community.compose.challengeNone')}</option>
              <option value={activeChallenge.id}>{activeChallenge.title}</option>
            </select>
            <ChallengeInstructions
              challenge={activeChallenge}
              selectedId={selectedChallengeId}
            />
          </div>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="min-h-11 rounded-full border border-theme-card-border px-4 py-2 text-xs font-medium text-ink-muted"
          >
            {t('community.compose.cancel')}
          </button>
          <button
            type="submit"
            data-testid="post-publish-submit"
            data-gold="primary"
            disabled={isPublishBlocked}
            className="min-h-11 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPublishing
              ? t('community.compose.publishing')
              : t('community.compose.publish')}
          </button>
        </div>
      </form>
    </AccessibleModal>
  )
}

// ---------------------------------------------------------------------------
// Grid chrome
//
// Split out of `CommunityLookbookGrid` for the same reason
// `lookbook-prism-layout.tsx` splits its planner slots: this repo caps
// cyclomatic complexity at 15, and the container already carries the feed
// lifecycle.
// ---------------------------------------------------------------------------

interface CommunityHeaderActionsProps {
  /** A member who is not banned: New post holds its place in the row. */
  showShare: boolean
  /** New post works now (Community access is verified). */
  canShare: boolean
  onShare: () => void
  /** Story CC-7.9 D3: gold only where New post is the screen's main action. */
  newPostEmphasis: NewPostEmphasis
  t: Translate
}

/** Story CC-7.9 D3: Community's main action is New post; on Home it is Open wardrobe. */
export type NewPostEmphasis = 'primary' | 'neutral'

const NEW_POST_EMPHASIS_CLASSES: Record<NewPostEmphasis, string> = {
  primary: 'bg-primary text-on-primary',
  neutral: 'border border-line-strong bg-page text-ink',
}

/**
 * Production feedback 2026-11-19: the "Community inspirations" label repeated the "Latest looks"
 * heading, and the notifications link floated alone above it, so both actions share one row.
 */
function CommunityHeaderActions({
  showShare,
  canShare,
  onShare,
  newPostEmphasis,
  t,
}: CommunityHeaderActionsProps) {
  /*
   * Story CC-7.7 (CI 7.7-E2E-005 late on d67800d2): while Community access is not verified (a
   * socket that failed before the first catch-up) New post stays in its place, disabled, so the
   * notifications link beside it never jumps. Only a signed-out, refused or banned reader loses
   * it.
   * `aria-disabled` keeps it in the focus order, like the commerce toggle's busy state.
   */
  return (
    <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
      {showShare && (
        <button
          type="button"
          data-testid="create-post-button"
          aria-disabled={canShare ? undefined : 'true'}
          onClick={canShare ? onShare : undefined}
          data-gold={newPostEmphasis === 'primary' ? 'primary' : undefined}
          className={`min-h-11 max-w-full break-words rounded-full px-3 py-2 text-xs font-semibold motion-safe:transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${NEW_POST_EMPHASIS_CLASSES[newPostEmphasis]}`}
        >
          {t('community.calm.post')}
        </button>
      )}
    </div>
  )
}

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  // Story CC-7.9 D3: a success no longer wears gold; it reads in the success ink.
  success: 'border-line bg-card text-success-ink',
  info: 'border-line bg-card text-ink',
  error: MERLOT_CLASS,
}

/**
 * Story 1.2b: the guided add-location path, which returns to the page that showed the notice
 * after the save: Home, or `/community` since that route renders the lookbook too.
 */
export function communityAddLocationHref(returnPath: string): string {
  return `/settings/places?addLocation=1&returnTo=${encodeURIComponent(returnPath)}#locations`
}

interface CommunityNoticesProps {
  bandUnresolvedReason: CommunityBandUnresolvedReason | null
  canAddLocation: boolean
  returnPath: string
  notice: Notice | null
  noticeText: string | null
  t: Translate
}

/**
 * The band-unresolved explanation (a fog-neutral surface) and the visible
 * confirmation for report, withdraw and publish. The confirmation is visible as
 * well as announced: the UX contract calls for a toast on these transitions,
 * and the previous version put every one of them into the sr-only region only,
 * so a sighted reader saw nothing happen.
 */
function CommunityNotices({
  bandUnresolvedReason,
  canAddLocation,
  returnPath,
  notice,
  noticeText,
  t,
}: CommunityNoticesProps) {
  return (
    <>
      {bandUnresolvedReason && (
        <div
          data-testid="community-band-unresolved"
          className="flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-xs text-ink"
        >
          <p>{t(`community.band.unresolved.${bandUnresolvedReason}`)}</p>
          {bandUnresolvedReason === 'no_location' && canAddLocation && (
            <Link
              href={communityAddLocationHref(returnPath)}
              className="inline-flex min-h-11 items-center self-start font-semibold underline"
              data-testid="community-add-location"
            >
              {t('locations.guided.add')}
            </Link>
          )}
        </div>
      )}
      {notice && (
        <p
          data-testid="community-action-notice"
          data-tone={notice.tone}
          className={`rounded-md border p-3 text-xs ${NOTICE_CLASSES[notice.tone]}`}
        >
          {noticeText}
        </p>
      )}
    </>
  )
}

function climateEmptyAction(
  mode: ClimateBand | null,
  itemCount: number,
  loading: boolean,
  error: Message | null,
  onModeChange: (mode: FilterCategory) => void
) {
  if (mode === null || itemCount > 0 || loading || error) return undefined
  return () => onModeChange('all')
}

interface CommunityFeedStatesProps {
  settled: boolean
  isLoading: boolean
  errorText: string | null
  /**
   * False for a signed-out reader. Retrying cannot sign anyone in, and the Sign in link
   * already sits above the feed, so that reason reads as a note with no Try again button.
   */
  retryable: boolean
  itemCount: number
  gridColumns: string
  canShare: boolean
  onClearFilters: (() => void) | undefined
  onRetry: () => void
  onShare: () => void
  /** Story CC-7.11 P5: the empty state is Community's first content when no Spotlight shows. */
  firstContent: boolean
  t: Translate
}

function CommunityFeedStates({
  settled,
  isLoading,
  errorText,
  retryable,
  itemCount,
  gridColumns,
  canShare,
  onRetry,
  onClearFilters,
  onShare,
  firstContent,
  t,
}: CommunityFeedStatesProps) {
  return (
    <>
      {errorText !== null && !retryable && (
        <p
          data-testid="community-feed-signed-out"
          className="rounded-md border border-line bg-card p-4 text-xs text-ink"
        >
          {errorText}
        </p>
      )}

      {errorText !== null && retryable && (
        <div
          role="alert"
          data-testid="community-feed-error"
          className={`flex items-center justify-between gap-3 rounded-md border p-4 text-xs ${MERLOT_CLASS}`}
        >
          <span>{errorText}</span>
          <button
            type="button"
            data-testid="community-feed-retry-button"
            onClick={onRetry}
            className="min-h-11 rounded-md border border-line-strong bg-page text-ink px-3 py-1 text-xs font-semibold"
          >
            {t('community.feed.retry')}
          </button>
        </div>
      )}

      {isLoading && itemCount === 0 && (
        // Decorative. The one live region announces `community.feed.loading`,
        // and the `role="status"` this used to carry is what made
        // `getByRole('status')` ambiguous across three tests.
        <div
          data-testid="community-feed-loading"
          aria-hidden="true"
          className={`grid gap-6 ${gridColumns}`}
        >
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              data-testid="lookbook-card-skeleton"
              className="h-72 animate-pulse rounded-xl border border-theme-card-border bg-theme-card-bg p-5"
            />
          ))}
        </div>
      )}

      {settled && errorText === null && itemCount === 0 && (
        <div
          data-testid="community-feed-empty"
          data-surface="card"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-theme-card-border bg-theme-card-bg p-4 text-center sm:p-8"
        >
          <p
            data-testid={firstContentTestId(firstContent)}
            className="text-sm font-semibold text-theme-card-text"
          >
            {t(
              onClearFilters ? 'community.calm.climateEmpty' : 'community.feed.emptyTitle'
            )}
          </p>
          {!onClearFilters && (
            <p className="mt-1 text-xs text-ink-muted">{t('community.feed.emptyBody')}</p>
          )}
          {onClearFilters && (
            <button
              type="button"
              className="min-h-11 max-w-full break-words px-3 text-sm font-semibold underline"
              onClick={onClearFilters}
              data-testid="community-clear-filters"
            >
              {t('community.calm.seeAllClimates')}
            </button>
          )}
          {canShare && !onClearFilters && (
            <button
              type="button"
              data-testid="community-feed-empty-share-button"
              onClick={onShare}
              className="mt-4 min-h-11 rounded-full border border-line-strong bg-page text-ink px-5 py-2 text-xs font-semibold"
            >
              {t('community.share')}
            </button>
          )}
        </div>
      )}
    </>
  )
}

interface LoadMoreControlProps {
  nextCursor: string | null
  /** A first load, which hides the control; a return's in-place refresh does not. */
  isLoading: boolean
  /** A page-one read is out: the control stays, disabled. */
  isRefreshing: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  t: Translate
}

function LoadMoreControl({
  nextCursor,
  isLoading,
  isRefreshing,
  isLoadingMore,
  onLoadMore,
  t,
}: LoadMoreControlProps) {
  if (nextCursor === null || isLoading) {
    return null
  }
  return (
    <div className="flex justify-center pt-2">
      {/* CC-7.7 D5: a return's in-place refresh keeps the control in its slot, disabled until
          page one answered. */}
      <button
        type="button"
        data-testid="load-more-button"
        disabled={isLoadingMore || isRefreshing}
        onClick={onLoadMore}
        className="min-h-11 rounded-full border border-line-strong bg-page text-ink px-6 py-2 text-xs font-semibold uppercase tracking-wider disabled:opacity-50"
      >
        {isLoadingMore ? t('community.feed.loadingMore') : t('community.feed.loadMore')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommunityLookbookGrid
// ---------------------------------------------------------------------------

/**
 * One page of the feed, with the single 400 ordinary browsing produces already
 * resolved.
 *
 * A feed cursor is bound to the filter mode AND the resolved climate band it was
 * minted under. Under `auto` that band is recomputed on every request from
 * weather guaranteed fresh for only 60 minutes, so it can move between page one
 * and page two of a single scroll, and the server answers 400 to keep the reader
 * off a keyset that belongs to a differently filtered set. The contract's own
 * words for that rejection are "so the client restarts paging": it is a normal
 * operating condition, not a fault, and putting a whole-feed alert over a grid
 * still holding twelve looks reported it as one.
 *
 * `restarted` tells the caller the rows it is holding are stale: the page came
 * back from the head of the feed and REPLACES what it has rather than appending
 * to it.
 *
 * The retry sends no cursor, so it cannot provoke the rejection it is recovering
 * from; the extra request is bounded at one by construction rather than by a
 * counter.
 */
async function readFeedPage(
  mode: CommunityFeedMode,
  cursor: string | undefined,
  signal: AbortSignal
): Promise<{ feed: CommunityFeed; restarted: boolean }> {
  try {
    return {
      feed: await getCommunityFeedFromWeb({
        mode,
        cursor,
        limit: FEED_PAGE_SIZE,
        signal,
      }),
      restarted: false,
    }
  } catch (error: unknown) {
    if (cursor === undefined || communityFailureReason(error) !== 'cursor_invalid') {
      throw error
    }
    return {
      feed: await getCommunityFeedFromWeb({ mode, limit: FEED_PAGE_SIZE, signal }),
      restarted: true,
    }
  }
}

export interface CommunityLookbookGridProps {
  activeTab?: FilterCategory
  onTabChange?: (tab: FilterCategory) => void
  isMobilePreview?: boolean
  chipCategory?: ChipCategory
  highlightedCardId?: string
  showFilterNav?: boolean
  /** App top bar portal. Null waits for its target. Omit to render Post inline. */
  postActionSlot?: HTMLElement | null
  /** The route hosting this grid, where the add-location flow returns after the save. */
  returnPath?: string
  /**
   * Story CC-7.9 D3: the Community screen passes `primary` (New post is its main action, gold);
   * an embedding host such as Home keeps the neutral outline so its own primary stays the only
   * gold action.
   */
  newPostEmphasis?: NewPostEmphasis
  /** Story 6.11: lifts the ban, so Home's spotlight teaser closes with the feed. */
  onBannedChange?: (banned: boolean) => void
  /**
   * Story 6.7: a Home teaser activation. A new token asks this section to focus
   * that spotlight entry, or to focus one notice saying why it cannot.
   */
  spotlightFocusIntent?: SpotlightFocusIntent | null
}

/** Story 6.7: one Home teaser activation, resolved once per token. */
export interface SpotlightFocusIntent {
  cardId: string
  focusToken: string
}

/** How long a teaser focus intent waits for a loading spotlight module. */
export const SPOTLIGHT_FOCUS_WAIT_MS = 10_000

type SpotlightNoticeKey =
  | 'community.spotlight.targetUnavailable'
  | 'community.spotlight.destinationUnavailable'

/**
 * Story 6.7: the notice for a teaser outcome other than the entry itself. It
 * sits outside every availability gate and is focused, never announced: the
 * focus move is its single announcement.
 */
function SpotlightFocusNotice({
  notice,
  t,
}: {
  notice: { key: SpotlightNoticeKey; serial: number } | null
  t: Translate
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!notice) return
    const element = ref.current
    if (!element) return
    element.scrollIntoView?.({ block: 'nearest' })
    element.focus({ preventScroll: true })
  }, [notice])
  if (!notice) return null
  return (
    <p
      ref={ref}
      tabIndex={-1}
      data-testid="community-spotlight-notice"
      className="rounded-md border border-line bg-card p-3 text-xs text-ink"
    >
      {t(notice.key)}
    </p>
  )
}

/**
 * True for a stored session the API has not refused. `refusedScope` names the session scope the
 * API answered 401 for; a later loading state or a 503 does not lift it, while a successful read
 * or a different session does.
 */
function isMemberSession(
  hasSession: boolean,
  refusedScope: string | null | undefined,
  sessionScope: string | null
): boolean {
  return hasSession && (refusedScope === undefined || refusedScope !== sessionScope)
}

/** A ban hides the feed, its author states and every action, like lost access does. */
const feedVisible = (available: boolean, banned: unknown) => available && !banned

/** New post holds its header slot for a member the API has not refused, unless banned. */
const shareSlotShown = (memberSession: boolean, banned: boolean) =>
  memberSession && !banned

/** A stored session still being verified, or whose verification failed. */
function isSessionPending(status: string): boolean {
  return status === 'checking' || status === 'unavailable'
}

function communityPresentation(
  available: boolean,
  hasSession: boolean,
  /**
   * A stored session still under verification (or one whose check failed) offers neither the
   * member's link nor the guest's sign-in link: the reader may well be signed in, and is not
   * known to be yet (2026-11-19 follow-up).
   */
  sessionPending: boolean,
  items: CommunityFeedItem[],
  authorStates: CommunityAuthorPostState[],
  nextCursor: string | null,
  newLooks: CommunityFeedItem[],
  openedItem: CommunityFeedItem | null
) {
  return {
    items: available ? items : [],
    authorStates: available ? authorStates : [],
    nextCursor: available ? nextCursor : null,
    showNewLooks: available && newLooks.length > 0,
    detail: openedItem,
    canAct: available && hasSession,
    settingsSignIn: !hasSession,
    settingsHref: sessionPending
      ? null
      : hasSession
        ? '/notification-settings'
        : '/signin',
    settingsLabel: hasSession
      ? 'community.notifications.title'
      : 'community.notifications.signin',
  }
}

function isRankedLook(item: CommunityFeedItem): item is CommunitySpotlightItem {
  return 'rank' in item
}

const communityAsideClass = (banned: boolean) =>
  banned ? 'flex flex-col gap-4 pt-6' : 'flex flex-col gap-4'

/** Story CC-7.11 P5: the id of Community's first own content, when this block is it. */
function firstContentTestId(isFirst: boolean): string | undefined {
  return isFirst ? 'community-first-content' : undefined
}

/** Story 6.11: a banned member has no community notifications to manage. */
function CommunitySettingsLink({
  banned,
  href,
  label,
  signIn,
  guestOnly,
}: {
  banned: boolean
  /** Null while the session is still being verified: neither the member's link nor the guest's. */
  href: string | null
  label: string
  /** The link asks the reader to sign in: no session, or one the API refused. */
  signIn: boolean
  /** Hidden by globals.css once the page knows a member is signed in. */
  guestOnly: boolean
}) {
  if (banned || href === null) return null
  if (signIn) {
    return (
      <Link
        href={href}
        // Owner report 2026-11-16: the signed-out link is a sign-in action, so a member, or a
        // stored session not verified yet, never sees it (globals.css, lib/landing-session.ts).
        // A refused stored session keeps the link while the landing reads it as a member, and
        // hides it with the guest link while the landing is still pending (globals.css).
        data-landing={guestOnly ? 'guest-inline' : 'refused-inline'}
        className="flex min-h-11 items-center px-2 text-sm font-medium text-ink underline underline-offset-4"
      >
        {label}
      </Link>
    )
  }
  // A member's link is a bell in the footer; its name stays the full label for assistive
  // technology, and the tooltip shows it to a pointer.
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-ink motion-safe:transition-colors hover:border-inverse"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </Link>
  )
}

/**
 * Story CC-7.7 D5: the feed and spotlight a member last saw on a tab (Home or Community), for a
 * return in the same session. Kept in memory only (lib/screen-snapshot.ts). It is used only when
 * the return asks for the same filter and the same session identity.
 */
type CommunityGridSnapshot = {
  mode: FilterCategory
  scope: string | null
  items: CommunityFeedItem[]
  authorStates: CommunityAuthorPostState[]
  nextCursor: string | null
  servedMode: CommunityFeedMode | null
  viewerBand: ClimateBand | null
  bandResolved: boolean
  bandUnresolvedReason: CommunityBandUnresolvedReason | null
  experimentVariant: CommunityExperimentVariant | null
  activeChallenge: EmbeddedCommunityChallenge | null
  spotlight: CommunitySpotlightState
}

/** Where a mount with no matching snapshot starts. */
const EMPTY_GRID_START: Omit<CommunityGridSnapshot, 'mode' | 'scope' | 'spotlight'> = {
  items: [],
  authorStates: [],
  nextCursor: null,
  servedMode: null,
  viewerBand: null,
  bandResolved: true,
  bandUnresolvedReason: null,
  experimentVariant: null,
  activeChallenge: null,
}

/**
 * Where a mount starts: the snapshot of this tab for this member when it matches the mount's
 * session identity, else nothing loaded. A grid that owns its filter (the Community tab, no
 * `onTabChange`) restores the filter the member last chose with its rows (Codex review P2-5);
 * a grid whose filter its parent holds (Home) restores only a snapshot of the parent's filter.
 */
function useGridStart(
  activeTab: FilterCategory,
  initialScope: string | null,
  ownsFilter: boolean
): {
  restored: boolean
  mode: FilterCategory
  start: typeof EMPTY_GRID_START
  spotlight: CommunitySpotlightState | undefined
} {
  const screen = useScreenGateScreen()
  const [start] = useState(() => {
    const stored = screen
      ? screenSnapshot.recall<CommunityGridSnapshot>(
          currentWebSessionScope(),
          screen,
          COMMUNITY_GRID_SNAPSHOT_PART
        )
      : undefined
    const matches =
      stored !== undefined &&
      stored.scope === initialScope &&
      (ownsFilter || stored.mode === activeTab)
    return matches
      ? { restored: true, mode: stored.mode, start: stored, spotlight: stored.spotlight }
      : {
          restored: false,
          mode: activeTab,
          start: EMPTY_GRID_START,
          spotlight: undefined,
        }
  })
  return start
}

/** The rows a feed read leaves on screen: restored, appended to, or replaced by its page. */
function rowsAfterRead(
  restored: CommunityFeedItem[] | null,
  appended: boolean,
  current: CommunityFeedItem[],
  page: CommunityFeedItem[]
): CommunityFeedItem[] {
  return restored ?? (appended ? mergeFeedPages(current, page) : page)
}

/**
 * Codex review P2-5: a return's first page-one read refreshes the restored rows in place. Rows
 * on that page take its answer where they are, rows it no longer holds stay (the realtime
 * target check removes any that are gone), and posts that are new since go to the New looks
 * buffer, so the list never shrinks or grows under the member's scroll position.
 */
function refreshRestoredRows<T extends CommunityFeedItem>(
  previous: CommunityFeedItem[],
  page: T[],
  rowFor: (post: T, previous: CommunityFeedItem | undefined) => CommunityFeedItem
): { rows: CommunityFeedItem[]; incoming: T[] } {
  const pageById = new Map(page.map((post) => [post.id, post]))
  const shown = new Set(previous.map((post) => post.id))
  return {
    rows: previous.map((post) => {
      const fresh = pageById.get(post.id)
      return fresh ? rowFor(fresh, post) : post
    }),
    incoming: page.filter((post) => !shown.has(post.id)),
  }
}

/** Reports this section's two reads to a screen gate around it, once the session is known. */
function useGridGateReads({
  feedSettled,
  spotlightSettled,
  sessionStatus,
}: {
  feedSettled: boolean
  spotlightSettled: boolean
  sessionStatus: string
}) {
  const sessionKnown = sessionStatus !== 'checking'
  useScreenGateRead('feed', feedSettled && sessionKnown)
  useScreenGateRead('spotlight', spotlightSettled && sessionKnown)
}

/** The first load's skeleton shows; a return's refresh keeps what is on screen. */
const firstLoadShowing = (isLoading: boolean, restoring: boolean) =>
  isLoading && !restoring

/**
 * Story CC-7.7 D3: the spotlight read has answered for the member (rows kept from a snapshot
 * count while they refresh), or no member will read it.
 */
function spotlightReadSettled(
  visible: boolean,
  sessionScope: string | null,
  state: CommunitySpotlightState,
  sessionStatus: string
): boolean {
  if (!visible) return true
  if (!sessionScope)
    return sessionStatus === 'signed_out' || sessionStatus === 'unavailable'
  return state.items.length > 0 || (state.status !== 'idle' && state.status !== 'loading')
}

export function CommunityLookbookGrid({
  activeTab = 'auto',
  onTabChange,
  isMobilePreview = false,
  chipCategory = 'Personal',
  highlightedCardId,
  showFilterNav = true,
  postActionSlot,
  returnPath = '/',
  newPostEmphasis = 'neutral',
  onBannedChange,
  spotlightFocusIntent,
}: CommunityLookbookGridProps) {
  const { t, i18n } = useCommunityTranslation()
  const locale = useResolvedLocale(i18n.language)
  // Story CC-7.7 D5: a client-side mount (a return to the tab) knows the session identity at
  // once, so its spotlight reads without waiting a render; hydration starts from none, as the
  // server rendered.
  const hydrating = useHydrating()
  const [initialScope] = useState<string | null>(() =>
    hydrating ? null : communityCommentsSessionFromWeb()
  )
  const {
    restored,
    mode: startMode,
    start,
    spotlight: startSpotlight,
  } = useGridStart(activeTab, initialScope, onTabChange === undefined)

  const [currentMode, setCurrentMode] = useState<FilterCategory>(startMode)
  /**
   * The filter the rows on screen were read for. It follows `currentMode` only once that
   * filter's page is accepted, so a failed switch keeps the earlier filter with its rows, and a
   * return never restores those rows under a filter they were not read for.
   */
  const [rowsMode, setRowsMode] = useState<FilterCategory>(startMode)
  /**
   * The mode the server said it served, or `null` while the request that would
   * answer that is still in flight. Distinct from `currentMode`, which is what
   * the reader asked for and what the next request sends: a `auto` request is
   * resolved to the viewer's experiment arm, so half the cohort asks for `auto`
   * and is served `all`.
   */
  const [servedMode, setServedMode] = useState<CommunityFeedMode | null>(start.servedMode)
  const [communityAvailable, setCommunityAvailable] = useState(true)
  const [newLooks, setNewLooks] = useState<CommunityFeedItem[]>([])
  const newLooksRef = useRef(newLooks)
  newLooksRef.current = newLooks
  // Advances whenever the feed's scope (filter or session) changes. Buffered looks and an
  // insertion under way belong to the scope they started in.
  const feedScopeRef = useRef(0)
  const [isInsertingLooks, setIsInsertingLooks] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const withdrawnFocus = useRef<{ postId: string; opener: Element } | null>(null)
  // The cards the grid rendered last, so a D3 hide can capture where the reader was.
  const renderedItemsRef = useRef<CommunityFeedItem[]>([])
  const { capture: captureScroll, restore: restoreScroll } = useCommunityScrollRestore({
    grid: gridRef,
    scope: feedScopeRef,
  })

  const [items, setItems] = useState<CommunityFeedItem[]>(start.items)
  const [authorStates, setAuthorStates] = useState<CommunityAuthorPostState[]>(
    start.authorStates
  )
  const [viewerBand, setViewerBand] = useState<ClimateBand | null>(start.viewerBand)
  const [bandResolved, setBandResolved] = useState(start.bandResolved)
  const [bandUnresolvedReason, setBandUnresolvedReason] =
    useState<CommunityBandUnresolvedReason | null>(start.bandUnresolvedReason)
  /**
   * The arm this client was serving, held so a card-open can be attributed to
   * the feed the viewer actually saw. `null` until a feed lands, and no card can
   * be opened before then, so there is never a default to invent.
   */
  const [experimentVariant, setExperimentVariant] =
    useState<CommunityExperimentVariant | null>(start.experimentVariant)
  const [nextCursor, setNextCursor] = useState<string | null>(start.nextCursor)
  /**
   * A deep-link target that is not on the page the grid is holding. Resolved
   * from `GET /posts/{postId}` and rendered at the head of the feed, because the
   * referenced card routinely sits far past the twelve rows of page one.
   */
  const [deepLinkedItem, setDeepLinkedItem] = useState<CommunityFeedItem | null>(null)
  const [commentTarget, setCommentTarget] = useState<
    | {
        commentId: string
        parentId: string | null
        pageCursor: string | null
        parentPageCursor: string | null
      }
    | undefined
  >()
  const [focusComments, setFocusComments] = useState(false)
  const [openedItem, setOpenedItem] = useState<CommunityFeedItem | null>(null)
  const detailOpener = useDetailOpener(openedItem)
  const clearDetailOpener = detailOpener.clear
  const openedItemRef = useRef(openedItem)
  openedItemRef.current = openedItem
  /**
   * Story 6.7b: which surface the open detail came from, so its sponsored CTA
   * mints with the surface the reader actually used. A deep link resolves into
   * the feed.
   */
  const [detailSurface, setDetailSurface] =
    useState<AffiliateCommunitySurface>('community_feed')
  const sponsoredShown = useSponsoredShownRegistry()
  const reactionAnnouncementId = useRef(0)
  // Set once the spotlight hook exists below; reaction updates reach its copies too.
  const spotlightApplyRef = useRef<
    | ((update: (post: CommunityFeedItem | null) => CommunityFeedItem | null) => void)
    | null
  >(null)
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
      setDeepLinkedItem(update)
      setOpenedItem(update)
      spotlightApplyRef.current?.(update)
    },
    []
  )
  /**
   * Story 6.7b: every live read (feed, post, spotlight) is the authority on a
   * post's sponsorship block, so its answer, block or no block, replaces the
   * block on every copy of that post this surface holds. Only the realtime
   * resolve path, which does not opt in, keeps a block from the last live read.
   */
  /**
   * The latest live answer per post, block or explicit absence, ordered by when
   * each read STARTED. Realtime resolve copies do not opt in, so every resolve
   * consumer settles its post against this ledger when it commits.
   */
  const [liveSponsorships] = useState(() => new LiveSponsorshipLedger())
  const [postTextLedger] = useState(() => new CommunityPostTextLedger())
  /**
   * Records one live read, started at `stamp`, then settles every copy of each
   * post it carried against the ledger. Call it as the read lands, BEFORE
   * writing the read's own items; every write of live items then normalizes
   * them through the ledger inside its state update, so a read that started
   * before the answer already recorded for a post never puts its stale block
   * on screen, not even for one render.
   */
  const applyLiveSponsorship = useCallback(
    (posts: readonly CommunityFeedItem[], stamp: LiveReadStamp) => {
      if (posts.length === 0) return
      liveSponsorships.record(posts, stamp)
      const ids = new Set(posts.map((post) => post.id))
      const settle = <T extends CommunityFeedItem>(post: T): T =>
        ids.has(post.id) ? withLiveSponsorship(post, liveSponsorships) : post
      const update = (post: CommunityFeedItem | null) => (post ? settle(post) : post)
      setItems((previous) => previous.map(settle))
      newLooksRef.current = newLooksRef.current.map(settle)
      setNewLooks(newLooksRef.current)
      setOpenedItem(update)
      setDeepLinkedItem(update)
      spotlightApplyRef.current?.(update)
    },
    [liveSponsorships]
  )
  const [dismissedChallenges, setDismissedChallenges] = useState<Set<string>>(new Set())
  const [teaserTarget, setTeaserTarget] = useState<string | null>(null)
  const [activeChallenge, setActiveChallenge] =
    useState<EmbeddedCommunityChallenge | null>(start.activeChallenge)
  const [isLoading, setIsLoading] = useState(false)
  /**
   * Story CC-7.7 D3: the first feed read for this session scope has answered (a page, an error or
   * a ban). The Community gate waits for it, and only the first read shows the skeleton: a
   * refresh keeps what is on screen until its answer replaces it.
   */
  const [feedSettled, setFeedSettled] = useState(restored)
  const feedSettledRef = useRef(restored)
  /** A return to the tab refreshes its snapshot without the first load's skeleton. */
  const [restoring, setRestoring] = useState(restored)
  /**
   * The restored rows still wait for their first page-one refresh, which updates them in place
   * (`refreshRestoredRows`). A filter change, a member change or that refresh ends it.
   */
  const restoringRowsRef = useRef(restored)
  /** The feed's first answer is in (or a terminal state replaced it): the gate may open. */
  const markFeedSettled = useCallback(() => {
    feedSettledRef.current = true
    setFeedSettled(true)
  }, [])
  /** The first page of a read (not an append) answered: the feed counts as settled. */
  const settleFirstPage = useCallback(
    (append: boolean) => {
      if (append) return
      markFeedSettled()
      setRestoring(false)
    },
    [markFeedSettled]
  )
  /**
   * Codex review P3-1: Community access was lost (a ban, a refused realtime session, or
   * verification that lapsed). The rows and teaser kept for a return go, and a write still
   * pending from before the loss can never put them back, until a read answers with access.
   */
  const revokeSnapshot = useCallback(() => {
    screenSnapshot.revoke(COMMUNITY_SNAPSHOT_PARTS, ['community'])
  }, [])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState<Message | null>(null)
  // Story 6.11: the member's own ban replaces the feed with a notice.
  const [bannedSanction, setBannedSanction] = useState<
    CommunityBannedError['sanction'] | null
  >(null)
  // What the one live region holds, in the order it happened. A message replaces the list,
  // except the feed's own completion message, which follows anything announced while that
  // same read was in flight (see announceFeed).
  const [announcements, setAnnouncements] = useState<Message[]>([])
  const bannedRef = useRef(false)
  const banned = Boolean(bannedSanction)
  useEffect(() => {
    bannedRef.current = banned
    onBannedChange?.(banned)
  }, [banned, onBannedChange])
  /** Monotonic request id, so a late response for an abandoned filter is dropped. */
  const feedGenerationRef = useRef(0)
  const announcedDuringReadRef = useRef<number | null>(null)
  const setAnnouncement = useCallback((message: Message | null) => {
    announcedDuringReadRef.current = feedGenerationRef.current
    setAnnouncements(message ? [message] : [])
  }, [])
  /** Every path that learns of a ban leaves the same page: the notice and nothing of the feed. */
  const closeForBan = useCallback(
    (sanction: CommunityBannedError['sanction']) => {
      // A read still in flight was authorized before the ban, so its answer can never land.
      feedGenerationRef.current++
      postTextLedger.clear()
      setIsLoading(false)
      setIsLoadingMore(false)
      markFeedSettled()
      revokeSnapshot()
      actionControllerRef.current?.abort()
      setBannedSanction(sanction)
      setItems([])
      setAuthorStates([])
      setActiveChallenge(null)
      setNextCursor(null)
      setFeedError(null)
      setOpenedItem(null)
      setDeepLinkedItem(null)
      setCommentTarget(undefined)
      setReportingPostId(null)
      setIsCreateModalOpen(false)
      setIsSubmittingReport(false)
      setIsPreparingPhoto(false)
      setIsPublishing(false)
      setNewLooks([])
      // The notice mounts with its words, which a screen reader may not hear, so the live region says it.
      setAnnouncement({ key: 'community.error.banned' })
    },
    [markFeedSettled, postTextLedger, revokeSnapshot, setAnnouncement]
  )
  /**
   * The feed's own messages. The loading message always starts a fresh list; the completion
   * message joins the list when something else was announced during the same read, a
   * deep-link focus for one, so a polite region speaks both instead of dropping the first.
   */
  const announceFeed = useCallback(
    (message: Message, generation: number, join: boolean) => {
      setAnnouncements((previous) =>
        join && announcedDuringReadRef.current === generation && previous.length > 0
          ? [...previous, message]
          : [message]
      )
    },
    []
  )
  const [reactionFeedback, setReactionFeedback] = useState<{
    key: string
    id: number
  } | null>(null)
  const [comments] = useState(
    () =>
      new CommunityCommentsState(
        {
          locate: (input, signal) => communitySyncFromWeb().resolve(input, signal),
          roots: communityCommentsRootsFromWeb,
          replies: communityCommentsRepliesFromWeb,
          submissions: communityCommentsSubmissionsFromWeb,
          create: communityCommentsCreateFromWeb,
          delete: communityCommentsDeleteFromWeb,
          report: communityCommentsReportFromWeb,
        },
        generateIdempotencyKey,
        communityFailureReason,
        (postId) => setOpenedItem((current) => (current?.id === postId ? null : current))
      )
  )
  const [reactionState] = useState(
    () =>
      new CommunityReactionState({
        mutate: setCommunityReactionFromWeb,
        newId: generateIdempotencyKey,
        failureReason: communityFailureReason,
        onChange: handleReactionChange,
        onAnnounce: (key) => {
          const id = ++reactionAnnouncementId.current
          if (openedItemRef.current) setReactionFeedback({ key, id })
          else setAnnouncement({ key, announcementId: id })
        },
      })
  )
  useSyncExternalStore(
    reactionState.subscribe,
    reactionState.getVersion,
    reactionState.getVersion
  )

  const [notice, setNotice] = useState<Notice | null>(null)
  const [failedImages, setFailedImages] = useState<FailedImages>(NO_FAILED_IMAGES)
  // Follows the verified session: `checking` while a stored session is verified, never signed out.
  const sessionState = useMemberSession()
  const hasSession = sessionState.status === 'signed_in'
  /** The realtime sync was denied and stopped; Retry restarts it (`realtimeEpoch`). */
  const realtimeDeniedRef = useRef(false)
  const [realtimeEpoch, setRealtimeEpoch] = useState(0)
  const [sessionScope, setSessionScope] = useState<string | null>(initialScope)
  const sessionScopeRef = useRef<string | null | undefined>(undefined)
  // A stored session the API answered 401 is signed out for this surface: it gets the Sign in
  // link and none of the member actions (New post, challenge entry, the composer, share, report),
  // whatever storage still holds. `undefined` means no refusal.
  const [refusedScope, setRefusedScope] = useState<string | null | undefined>(undefined)
  const memberSession = isMemberSession(hasSession, refusedScope, sessionScope)

  // Story 6.6: the City Spotlight heads this section. Its pages run through the
  // same reaction state as the feed, and its one View more announcement goes
  // through this surface's single live region.
  // Story 6.7b: each spotlight read carries its reaction ticket and its
  // sponsorship stamp, both taken as the read starts, in the token the hook
  // hands back with the page. Nothing is stored per read, so a failed, aborted
  // or superseded read leaves nothing behind.
  const climate = communityFeedClimate(servedMode, viewerBand, bandResolved)
  const spotlight = useCommunitySpotlight<{
    ticket: number
    stamp: LiveReadStamp
    textStamp: number
  }>({
    scope: sessionScope,
    initial: startSpotlight,
    onBanned: closeForBan,
    beginRead: () => ({
      ticket: reactionState.beginRead(),
      stamp: liveSponsorships.begin(),
      textStamp: postTextLedger.begin(),
    }),
    reconcile: (page, { ticket, stamp, textStamp }) => {
      applyLiveSponsorship(page, stamp)
      return page.flatMap((post) => {
        const current = reactionState.read(post, ticket)
        return current
          ? [
              {
                ...postTextLedger.reconcile(
                  withLiveSponsorship(current, liveSponsorships),
                  textStamp
                ),
                rank: post.rank,
              },
            ]
          : []
      })
    },
    visiblePage: (page) => {
      if (!communityAvailable || bannedSanction || rowsMode !== currentMode) return []
      return mergeCommunityLooks(page, [], climate, teaserTarget)
    },
    announce: (message) => {
      setAnnouncement({ ...message, announcementId: ++reactionAnnouncementId.current })
    },
  })
  spotlightApplyRef.current = spotlight.apply

  // Story 6.7: a teaser intent is copied once per token, then resolved against
  // the module: a loading module is awaited for at most 10 seconds; the entry
  // takes focus with one announcement; any other outcome focuses one notice.
  // Either way the intent is consumed, so a later recovery moves no focus.
  const seenFocusTokensRef = useRef(new Set<string>())
  const [pendingFocus, setPendingFocus] = useState<{
    cardId: string
    receivedAt: number
  } | null>(null)
  const [spotlightNotice, setSpotlightNotice] = useState<{
    key: SpotlightNoticeKey
    serial: number
  } | null>(null)
  const spotlightNoticeSerialRef = useRef(0)
  useEffect(() => {
    if (!spotlightFocusIntent) return
    if (seenFocusTokensRef.current.has(spotlightFocusIntent.focusToken)) return
    seenFocusTokensRef.current.add(spotlightFocusIntent.focusToken)
    setSpotlightNotice(null)
    setPendingFocus({ cardId: spotlightFocusIntent.cardId, receivedAt: Date.now() })
  }, [spotlightFocusIntent])
  const { reset: resetSpotlight, apply: applySpotlight } = spotlight
  // Realtime reads the rendered spotlight posts from a ref, so the sync state
  // built once per session always sees the current page.
  const spotlightItemsRef = useRef(spotlight.state.items)
  spotlightItemsRef.current = spotlight.state.items

  const [reportingPostId, setReportingPostId] = useState<string | null>(null)
  const [reportError, setReportError] = useState<Message | null>(null)
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [reportedPostIds, setReportedPostIds] = useState<Set<string>>(new Set())

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [composeError, setComposeError] = useState<Message | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [allocated, setAllocated] = useState<AllocatedLook | null>(null)
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const feedControllerRef = useRef<AbortController | null>(null)
  const actionControllerRef = useRef<AbortController | null>(null)
  const modeRef = useRef<FilterCategory>(currentMode)
  const languageRef = useRef(i18n.language)
  const failedImagesRef = useRef(failedImages)
  // Mirrors the three refs above. `loadFeed` needs the current page to count what
  // an append actually added, and reading it from state would put `items` in that
  // callback's dependency list and re-create it after every page.
  const realtimeDeepLink = useRef(deepLinkedItem)
  realtimeDeepLink.current = deepLinkedItem
  const itemsRef = useRef(items)
  const highlightedIdRef = useRef(highlightedCardId)
  highlightedIdRef.current = highlightedCardId
  const detailGenerationRef = useRef(0)
  const notificationIntentRef = useRef(0)
  const realtimeSyncRef = useRef<CommunitySyncState | null>(null)
  const feedReadsStartedRef = useRef(0)

  useEffect(() => {
    modeRef.current = currentMode
  }, [currentMode])
  useEffect(() => {
    languageRef.current = i18n.language
  }, [i18n.language])
  useEffect(() => {
    failedImagesRef.current = failedImages
  }, [failedImages])
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // A change of the parent's filter applies; the first run keeps the mode this mount started
  // with, which a return restores from its snapshot (Codex review P2-5).
  const syncedTabRef = useRef(activeTab)
  useEffect(() => {
    if (syncedTabRef.current === activeTab) return
    syncedTabRef.current = activeTab
    restoringRowsRef.current = false
    setRestoring(false)
    setCurrentMode(activeTab)
  }, [activeTab])

  /**
   * The mode this surface presents itself as showing. The server's answer wins
   * once it has one, because `auto` is the arm the beta experiment varies and
   * half the viewers who ask for it are served `all`.
   */
  const displayedMode: CommunityFeedMode = servedMode ?? currentMode

  /**
   * One read of the feed.
   *
   * The cursor is bound to the mode it was minted under and the server answers
   * 400 for a mismatch, so a mode change restarts paging rather than carrying
   * the cursor across; `nextCursor` is cleared at the head of every non-append
   * load for exactly that reason. {@link readFeedPage} handles the other way
   * that cursor goes dead -- the viewer's resolved band moving mid-scroll -- and
   * reports it as `restarted`, which turns an append back into a replace.
   *
   * Holds no `t`: everything it stores is a key plus params, so a language
   * change repaints without re-requesting.
   */
  const revalidateHighlighted = useCallback(
    async (
      targets: string[],
      readTicket: number,
      signal: AbortSignal,
      generation: number,
      loadedIds: ReadonlySet<string>
    ) => {
      if (targets.length === 0) return
      const detailGeneration = ++detailGenerationRef.current
      const isCurrent = () =>
        !signal.aborted &&
        generation === feedGenerationRef.current &&
        detailGeneration === detailGenerationRef.current
      for (const target of targets) {
        try {
          const stamp = liveSponsorships.begin()
          const textStamp = postTextLedger.begin()
          const post = await getCommunityPostFromWeb(target, signal)
          if (!isCurrent()) return
          applyLiveSponsorship([post], stamp)
          const read = reactionState.read(post, readTicket)
          const live = read ? withLiveSponsorship(read, liveSponsorships) : read
          if (target === highlightedIdRef.current)
            setDeepLinkedItem((current) =>
              loadedIds.has(target)
                ? null
                : live
                  ? postTextLedger.reconcile(live, textStamp, current)
                  : live
            )
          setOpenedItem((opened) =>
            opened?.id === target
              ? live
                ? postTextLedger.reconcile(live, textStamp, opened)
                : live
              : opened
          )
        } catch (error: unknown) {
          if (isCurrent() && communityFailureReason(error) === 'not_found') {
            postTextLedger.evict(target)
            reactionState.evict(target)
            comments.evict(target)
          }
        }
      }
    },
    [applyLiveSponsorship, comments, liveSponsorships, postTextLedger, reactionState]
  )

  /**
   * The API answered 401 for the stored session. Records the refusal against that session and
   * retires every member action already in flight: the pending action (a photo allocation, a
   * publish or a report) is aborted so its late answer cannot refill the next draft, and the
   * composer and the report dialog close.
   */
  const refuseSession = useCallback(() => {
    setRefusedScope(sessionScopeRef.current ?? null)
    actionControllerRef.current?.abort()
    setIsCreateModalOpen(false)
    setComposeError(null)
    setAllocated(null)
    setIsPreparingPhoto(false)
    setIsPublishing(false)
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setReportingPostId(null)
    setReportError(null)
    setIsSubmittingReport(false)
  }, [])

  /** A failed feed read's note and announcement; a 401 also refuses the session. */
  const reportFeedFailure = useCallback(
    (error: unknown) => {
      const message = messageForError(error, 'community.error.load', languageRef.current)
      if (communityFailureReason(error) === 'signed_out') refuseSession()
      setFeedError(message)
      setAnnouncement(message)
    },
    [refuseSession, setAnnouncement]
  )

  /** Codex review P2-5: the restored rows still wait for their page-one refresh. */
  const restoreRefreshPending = useCallback(
    (append: boolean) =>
      !append && restoringRowsRef.current && itemsRef.current.length > 0,
    []
  )

  /**
   * Codex review P2-5: commits a return's page-one refresh in place (`refreshRestoredRows`):
   * the restored rows take this page's answer where they are, and posts new since go to the
   * New looks buffer. Returns the rows now shown, or null when this read is not that refresh.
   */
  const commitRestoredRefresh = useCallback(
    (
      inPlace: boolean,
      page: CommunityFeedItem[],
      live: <T extends CommunityFeedItem>(post: T) => T,
      textStamp: Parameters<typeof postTextLedger.reconcile>[1]
    ): CommunityFeedItem[] | null => {
      if (!inPlace) return null
      const { rows, incoming } = refreshRestoredRows(
        itemsRef.current,
        page,
        (post, previous) =>
          postTextLedger.reconcile(live(reactionState.current(post)), textStamp, previous)
      )
      restoringRowsRef.current = false
      itemsRef.current = rows
      if (incoming.length) {
        const bufferedById = new Map(newLooksRef.current.map((post) => [post.id, post]))
        const buffered = mergeFeedPages(
          incoming.map((post) =>
            postTextLedger.reconcile(live(post), textStamp, bufferedById.get(post.id))
          ),
          newLooksRef.current.map(live)
        )
        newLooksRef.current = buffered
        setNewLooks(buffered)
      }
      return rows
    },
    [postTextLedger, reactionState]
  )

  const loadFeed = useCallback(
    async (mode: CommunityFeedMode, cursor?: string) => {
      const readTicket = reactionState.beginRead()
      const append = cursor !== undefined
      feedControllerRef.current?.abort()
      const controller = new AbortController()
      feedControllerRef.current = controller
      const generation = feedGenerationRef.current + 1
      feedGenerationRef.current = generation
      // The deep-link effect resolves the highlighted target for the first feed read. A read
      // started after it supersedes that one, finished or not, so it revalidates the target.
      const isFirstRead = feedReadsStartedRef.current++ === 0
      // A return's first page-one read keeps the restored rows and their cursor (P2-5).
      const inPlace = restoreRefreshPending(append)

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setFeedError(null)
        setNextCursor((cursor) => (inPlace ? cursor : null))
        announceFeed({ key: 'community.feed.loading' }, generation, false)
      }

      const stamp = liveSponsorships.begin()
      const textStamp = postTextLedger.begin()
      try {
        const { feed, restarted } = await readFeedPage(mode, cursor, controller.signal)
        if (generation !== feedGenerationRef.current) {
          return
        }
        setServedMode(feed.mode)
        setViewerBand(feed.viewerBand)
        setBandResolved(feed.bandResolved)
        setBandUnresolvedReason(feed.bandUnresolvedReason)
        setExperimentVariant(feed.experimentVariant)
        setAuthorStates(feed.authorStates)
        setActiveChallenge(feed.activeChallenge)
        // A restored row keeps the cursor of the pages it showed; one restored without a cursor
        // takes the fresh page's (CodeRabbit on PR 292).
        setNextCursor((cursor) =>
          inPlace ? (cursor ?? feed.nextCursor) : feed.nextCursor
        )
        setFeedError(null)
        setRefusedScope(undefined)
        setBannedSanction(null)
        // A read that answered with access may keep Community content for a return again.
        screenSnapshot.allow(COMMUNITY_SNAPSHOT_PARTS)
        // A refetch that hands back a freshly signed URL clears the failure: not
        // clearing it is what left a recovered card reading "Image unavailable"
        // for the rest of the session.
        setFailedImages((previous) => ({
          ...previous,
          feed: pruneFailedImages(previous.feed, feed.items),
        }))
        applyLiveSponsorship(feed.items, stamp)
        const page = feed.items.flatMap((post) => {
          const current = reactionState.read(post, readTicket)
          return current ? [current] : []
        })
        const live = <T extends CommunityFeedItem>(post: T): T =>
          withLiveSponsorship(post, liveSponsorships)
        setOpenedItem((post) => (post ? live(reactionState.current(post)) : null))
        // A return's first page-one read refreshes the restored rows in place (P2-5).
        const restoredRows = commitRestoredRefresh(inPlace, page, live, textStamp)
        const merged = rowsAfterRead(
          restoredRows,
          append && !restarted,
          itemsRef.current,
          page
        )
        const loadedIds = new Set(merged.map((post) => post.id))
        setDeepLinkedItem((post) =>
          post && !loadedIds.has(post.id) ? live(reactionState.current(post)) : null
        )
        setItems((previous) => {
          if (restoredRows) return restoredRows
          const previousById = new Map(previous.map((item) => [item.id, item]))
          return (append && !restarted ? mergeFeedPages(previous, page) : page).map(
            (post) =>
              postTextLedger.reconcile(
                live(reactionState.current(post)),
                textStamp,
                previousById.get(post.id)
              )
          )
        })
        setRowsMode(mode)
        announceFeed(
          {
            key:
              append && !restarted
                ? 'community.feed.announceLoadedMore'
                : 'community.feed.announceLoaded',
            params: {
              filterMode: feed.mode,
              count:
                append && !restarted
                  ? merged.length - itemsRef.current.length
                  : page.length,
            },
          },
          generation,
          true
        )
        await revalidateHighlighted(
          detailRevalidationTargets(
            highlightedIdRef.current,
            openedItemRef.current,
            !isFirstRead
          ),
          readTicket,
          controller.signal,
          generation,
          loadedIds
        )
      } catch (error: unknown) {
        if (controller.signal.aborted || generation !== feedGenerationRef.current) {
          return
        }
        const sanction = communitySanctionOf(error)
        if (sanction) {
          closeForBan(sanction)
          return
        }
        reportFeedFailure(error)
      } finally {
        if (!controller.signal.aborted && generation === feedGenerationRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
          settleFirstPage(append)
        }
      }
    },
    [
      announceFeed,
      applyLiveSponsorship,
      closeForBan,
      liveSponsorships,
      postTextLedger,
      reactionState,
      reportFeedFailure,
      revalidateHighlighted,
      settleFirstPage,
      commitRestoredRefresh,
      restoreRefreshPending,
    ]
  )
  /** For the realtime sync, which must not restart whenever `loadFeed` is re-created. */
  const loadFeedRef = useRef(loadFeed)
  useEffect(() => {
    loadFeedRef.current = loadFeed
  }, [loadFeed])

  useEffect(() => {
    const clearScope = () => {
      feedScopeRef.current++
      feedGenerationRef.current++
      detailGenerationRef.current++
      feedControllerRef.current?.abort()
      actionControllerRef.current?.abort()
      reactionState.reset()
      resetSpotlight()
      // Live answers are per viewer.
      liveSponsorships.clear()
      postTextLedger.clear()
      // A teaser intent and its notice belong to the member who tapped it.
      setPendingFocus(null)
      setTeaserTarget(null)
      setDismissedChallenges(new Set())
      withdrawnFocus.current = null
      setActiveChallenge(null)
      setSpotlightNotice(null)
      // A sanction names one member's ban, its expiry and appeal, so it leaves with that member.
      setBannedSanction(null)
      setAnnouncements((previous) =>
        previous.filter((message) => message.key !== 'community.error.banned')
      )
      setItems([])
      itemsRef.current = []
      setAuthorStates([])
      feedSettledRef.current = false
      setFeedSettled(false)
      setRestoring(false)
      restoringRowsRef.current = false
      // The band and why it did not resolve describe the member who left; the
      // notice and its add-location action go with them.
      setViewerBand(null)
      setBandResolved(true)
      setBandUnresolvedReason(null)
      setOpenedItem(null)
      setDeepLinkedItem(null)
      setNewLooks([])
      setNextCursor(null)
      setCommentTarget(undefined)
      setReportingPostId(null)
      setReportedPostIds(new Set())
      setIsCreateModalOpen(false)
      setIsSubmittingReport(false)
      setIsPreparingPhoto(false)
      setIsPublishing(false)
      setAllocated(null)
      setPhotoPreview((value) => {
        if (value) URL.revokeObjectURL(value)
        return null
      })
    }
    const syncSession = () => {
      const identity = communityCommentsSessionFromWeb()
      const previous = sessionScopeRef.current
      sessionScopeRef.current = identity
      comments.setSession(identity)
      setSessionScope(identity)
      if (previous !== undefined && previous !== identity) {
        clearScope()
        if (identity) void loadFeed(modeRef.current)
      }
    }
    syncSession()
    const timer = setInterval(syncSession, 1000)
    window.addEventListener('storage', syncSession)
    window.addEventListener('couture:session', syncSession)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', syncSession)
      window.removeEventListener('couture:session', syncSession)
    }
  }, [
    comments,
    reactionState,
    loadFeed,
    resetSpotlight,
    liveSponsorships,
    postTextLedger,
  ])

  // A return to the tab keeps the served mode it shows while the refresh reads (CC-7.7 D5).
  const keepServedModeOnceRef = useRef(restored)
  useEffect(() => {
    // Cleared alongside the request, so the chips answer with the mode just
    // clicked while the server is deciding what to serve for it, and correct
    // themselves when it answers. Holding the previous served mode instead would
    // leave the click looking like it did nothing.
    if (keepServedModeOnceRef.current) keepServedModeOnceRef.current = false
    else setServedMode(null)
    // Looks buffered under the previous filter are not part of this feed. Target
    // resolution stays filter-agnostic, so the buffer itself has to be dropped.
    feedScopeRef.current++
    newLooksRef.current = []
    setNewLooks([])
    void loadFeed(currentMode)
  }, [currentMode, loadFeed])

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
        const result = await communitySyncFromWeb().resolve(
          {
            targets: buffered
              .slice(offset, offset + 50)
              .map((post) => ({ key: post.id, postId: post.id })),
          },
          AbortSignal.timeout(2000)
        )
        if (!current(generation)) return
        for (const target of result.targets)
          if (target.status === 'available') {
            const post = reactionState.read(target.post, ticket)
            if (post) fresh.push(post)
          }
      }
      // Story 6.7b: the resolve carries no sponsorship answer, so each revealed
      // look takes the latest live answer at the moment it is inserted.
      setItems((previous) => {
        const previousById = new Map(previous.map((post) => [post.id, post]))
        const reconciledFresh = fresh.map((post) =>
          postTextLedger.reconcile(
            withLiveSponsorship(post, liveSponsorships),
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
      const generation = feedGenerationRef.current
      const stamp = liveSponsorships.begin()
      const textStamp = postTextLedger.begin()
      const page = await getCommunityFeedFromWeb({
        mode: currentMode,
        limit: FEED_PAGE_SIZE,
        signal,
      })
      if (!active) return
      if (signal?.aborted) throw new CommunityRequestSuperseded()
      if (generation !== feedGenerationRef.current) throw new CommunityRequestSuperseded()
      // A current, authenticated rebuild answers for this session like a successful filter read:
      // an earlier 401 note and its refusal go, so the member's actions come back.
      setFeedError(null)
      setRefusedScope(undefined)
      // Rows already shown stay where they are, but their blocks follow this read.
      applyLiveSponsorship(page.items, stamp)
      const live = <T extends CommunityFeedItem>(post: T): T =>
        withLiveSponsorship(post, liveSponsorships)
      setAuthorStates(page.authorStates)
      setNextCursor(page.nextCursor)
      setServedMode(page.mode)
      setViewerBand(page.viewerBand)
      setBandResolved(page.bandResolved)
      setBandUnresolvedReason(page.bandUnresolvedReason)
      setActiveChallenge(page.activeChallenge)
      setIsLoadingMore(false)
      setIsLoading(false)
      // Codex review P1-1: a rebuild that replaced the first feed read answers for the gate too.
      markFeedSettled()
      setRestoring(false)
      screenSnapshot.allow(COMMUNITY_SNAPSHOT_PARTS)

      const existing = new Set(itemsRef.current.map((item) => item.id))
      const incoming = page.items.filter((item) => !existing.has(item.id))
      if (!itemsRef.current.length) {
        // Bootstrap validates targets as soon as this rebuild returns. React may
        // commit the queued render later, so publish its feed snapshot now.
        const rebuilt = page.items.map((item) =>
          postTextLedger.reconcile(live(item), textStamp)
        )
        itemsRef.current = rebuilt
        setItems(rebuilt)
        setRowsMode(currentMode)
      } else if (incoming.length) {
        const existingBufferById = new Map(
          newLooksRef.current.map((item) => [item.id, item])
        )
        const reconciledIncoming = incoming.map((item) =>
          postTextLedger.reconcile(live(item), textStamp, existingBufferById.get(item.id))
        )
        const buffered = mergeFeedPages(reconciledIncoming, newLooksRef.current.map(live))
        newLooksRef.current = buffered
        setNewLooks(buffered)
        setAnnouncement({
          key: 'community.realtime.newLooks',
          params: { count: incoming.length },
        })
      }
    }
    const outage: Notice = {
      message: { key: 'community.realtime.unavailable' },
      tone: 'info',
    }
    /** This mount heard `connected` at least once: a later loss of access is a lapse. */
    let verifiedOnce = false
    // D3: shown content outlives a reconnect only while access was verified recently.
    // Once that lapses, the content hides and the outage is announced (D9).
    const hideContent = (accessLost: boolean) => {
      captureScroll(renderedItemsRef.current)
      setCommunityAvailable(false)
      /*
       * Only a loss of access drops what every tab keeps (P3-1). A fresh mount whose socket
       * fails before its first catch-up answers (`recovering`, a slow or flaky connection)
       * has learned nothing about access: it hides its own content until a catch-up verifies,
       * and Home's teaser and rows stay for the next return (CI 7.7-E2E-006 delayed on
       * 3f1986d1: opening Community dropped them, so the return to Home painted without them).
       */
      if (accessLost) revokeSnapshot()
    }
    /** Content this mount may not show (D3/D9): hidden, and revoked when access was lost. */
    const hideUnverified = (state: string) => {
      const unknown = !verifiedOnce && state === 'recovering'
      /*
       * A return that restored its rows from the snapshot keeps them (and Home's teaser) while
       * nothing is known about access: those rows were authorized earlier in this session, and a
       * ban or denial seen since already revoked them (P3-1). Hiding them here would show them
       * and then hide them on a slow catch-up (CI 7.7-E2E-006 delayed). The first catch-up
       * decides: `connected` keeps them, a denial, a ban or `unavailable` hides and revokes.
       */
      if (unknown && restored) return
      hideContent(!unknown)
    }
    /**
     * Codex review P1-1: realtime cancelled the feed read in flight. Before the first page
     * answered, nothing else would settle the gate, so a fresh read replaces it.
     */
    const replaceCancelledFirstRead = () => {
      if (!feedSettledRef.current) void loadFeedRef.current(currentMode)
    }
    const verification = new CommunityVerification(() => {
      if (!active) return
      hideContent(true)
      setNotice(outage)
    })
    const sync = new CommunitySyncState(communitySyncFromWeb(), currentMode, {
      rendered: () => [
        ...itemsRef.current.map((item) => item.id),
        ...(openedItemRef.current ? [openedItemRef.current.id] : []),
        ...newLooksRef.current.map((item) => item.id),
        ...(realtimeDeepLink.current ? [realtimeDeepLink.current.id] : []),
        // Spotlight posts can sit outside every feed page, and a hidden or
        // erased one must still leave the module.
        ...spotlightItemsRef.current.map((item) => item.id),
      ],
      rebuild: refreshFeed,
      reconcile: async (signal) => {
        const open = openedItemRef.current
        if (open) await comments.refresh(open.id, signal)
      },
      apply: (target) => {
        if (!active) return
        if (target.status === 'unavailable') {
          feedGenerationRef.current++
          detailGenerationRef.current++
          if (openedItemRef.current?.id === target.key) openedItemRef.current = null
          if (realtimeDeepLink.current?.id === target.key) realtimeDeepLink.current = null
          feedControllerRef.current?.abort()
          setIsLoading(false)
          setIsLoadingMore(false)
          newLooksRef.current = newLooksRef.current.filter(
            (item) => item.id !== target.key
          )
          setNewLooks(newLooksRef.current)
          postTextLedger.evict(target.key)
          reactionState.evict(target.key)
          comments.evict(target.key)
          setItems((previous) => previous.filter((item) => item.id !== target.key))
          setOpenedItem((item) => (item?.id === target.key ? null : item))
          setDeepLinkedItem((item) => (item?.id === target.key ? null : item))
          applySpotlight((item) => (item?.id === target.key ? null : item))
          replaceCancelledFirstRead()
          return
        }
        const resolved = reactionState.read(target.post, reactionState.beginRead())
        if (!resolved) return
        // Story 6.7b: the target resolve does not opt in to sponsorship, so the
        // post carries the latest live answer for it, block or absence, on
        // every copy, the New looks buffer included.
        const updated = postTextLedger.reconcile(
          withLiveSponsorship(resolved, liveSponsorships),
          postTextLedger.begin()
        )
        postTextLedger.record(updated)
        const update = (item: CommunityFeedItem | null) =>
          item?.id === target.post.id ? reconcileCommunityPostText(updated, item) : item
        newLooksRef.current = newLooksRef.current.map((item) => update(item)!)
        setNewLooks(newLooksRef.current)
        setItems((previous) => previous.map((item) => update(item)!))
        setOpenedItem(update)
        setDeepLinkedItem(update)
        applySpotlight(update)
      },
      changed: async (events, signal) => {
        feedGenerationRef.current++
        detailGenerationRef.current++
        feedControllerRef.current?.abort()
        setIsLoading(false)
        setIsLoadingMore(false)
        if (!feedSettledRef.current) {
          // The first page never answered: a full read (with its own error and Retry) takes
          // its place, whatever the events were.
          replaceCancelledFirstRead()
          return
        }
        if (events.some((event) => event.kind === 'post.published'))
          await refreshFeed(signal)
      },
      availability: (state, realtime) => {
        if (!active) return
        comments.setRealtimeHealthy(state === 'connected' && Boolean(realtime))
        // Only unverified or denied access hides content (D3/D9). While recovering, the
        // feed, drafts and focus stay for at most 8 s after the last successful
        // authorization, so routine reconnects and HTTP polling do not flicker, and a
        // reconnect is not announced as an outage. Content hidden as unverified stays
        // hidden until a catch-up reports 'connected'.
        const { visible, verify } = verification.update(state, realtime)
        if (state === 'connected') {
          setCommunityAvailable(true)
          verifiedOnce = true
        } else if (!visible) hideUnverified(state)
        if (verify) void realtimeSyncRef.current?.catchUp()
        // The outage notice clears only once verified content is visible again.
        if (state === 'connected')
          setNotice((previous) =>
            previous?.message.key === 'community.realtime.unavailable' ? null : previous
          )
        else if (state === 'unavailable') setNotice(outage)
        if (state === 'connected') screenSnapshot.allow(COMMUNITY_SNAPSHOT_PARTS)
        if (state !== 'connected' && state !== 'recovering') {
          feedGenerationRef.current++
          detailGenerationRef.current++
          setIsLoading(false)
          setIsLoadingMore(false)
          feedControllerRef.current?.abort()
          // Codex review P1-1: the outage notice is what the body shows now. A denial settles
          // the gate once its probe below answers, with the error and Retry in place.
          if (state === 'unavailable') markFeedSettled()
        }
        realtimeDeniedRef.current = state === 'denied'
        if (state === 'denied') {
          revokeSnapshot()
          actionControllerRef.current?.abort()
          setIsSubmittingReport(false)
          setIsPreparingPhoto(false)
          setIsPublishing(false)
          comments.reset()
          reactionState.reset()
          resetSpotlight()
          liveSponsorships.clear()
          postTextLedger.clear()
          setItems([])
          setOpenedItem(null)
          setNewLooks([])
          // A denied socket says nothing about why. One read asks, so a member banned while
          // the page was open sees the notice. A member already told needs no second answer.
          if (bannedRef.current) markFeedSettled()
          else {
            // The answer belongs to the session scope it was asked in, and only while no newer
            // feed read (a Retry) has started since: a newer read speaks for the grid.
            const scope = feedScopeRef.current
            const generation = feedGenerationRef.current
            const probeCurrent = () =>
              active &&
              scope === feedScopeRef.current &&
              generation === feedGenerationRef.current
            void getCommunityFeedFromWeb({ mode: currentMode, limit: 1 }).then(
              () => {
                // The feed answers but the realtime connection was refused: the grid stays
                // cleared until a catch-up verifies access, so the load error offers Retry,
                // which restarts the sync. (Restarting here could loop on a lasting denial.)
                if (!probeCurrent()) return
                const message: Message = { key: 'community.error.load' }
                setFeedError(message)
                setAnnouncement(message)
                markFeedSettled()
              },
              (error: unknown) => {
                if (!probeCurrent()) return
                markFeedSettled()
                const sanction = communitySanctionOf(error)
                if (sanction) {
                  closeForBan(sanction)
                  return
                }
                // A refused session gets the same answer a feed read gives it: the signed-out
                // note, the Sign in link, and its member actions retired.
                if (communityFailureReason(error) === 'signed_out') {
                  reportFeedFailure(error)
                  return
                }
                // The denial can abort the feed read still in flight, whose own catch then
                // returns silently. The probe answers the same refusal, so the member ends on
                // the same copy whichever answer lands first.
                const message = messageForError(
                  error,
                  'community.error.load',
                  languageRef.current
                )
                setFeedError(message)
                setAnnouncement(message)
              }
            )
          }
        }
      },
    })
    realtimeSyncRef.current = sync
    sync.start(
      process.env.NEXT_PUBLIC_REALTIME_URL ??
        (resolveWebApiBaseUrl() || window.location.origin),
      communityRealtimeTokenFromWeb
    )
    const foreground = () => {
      if (document.visibilityState !== 'visible') return
      // Revalidate before restoring anything shown while the page was hidden.
      verification.foreground()
      sync.foreground()
    }
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('online', foreground)
    return () => {
      active = false
      verification.stop()
      sync.stop()
      if (realtimeSyncRef.current === sync) realtimeSyncRef.current = null
      comments.setRealtimeHealthy(false)
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('online', foreground)
    }
  }, [
    applyLiveSponsorship,
    closeForBan,
    reportFeedFailure,
    liveSponsorships,
    postTextLedger,
    comments,
    currentMode,
    sessionScope,
    reactionState,
    applySpotlight,
    resetSpotlight,
    captureScroll,
    setAnnouncement,
    realtimeEpoch,
    markFeedSettled,
    revokeSnapshot,
    restored,
  ])

  useEffect(
    () => () => {
      feedControllerRef.current?.abort()
      actionControllerRef.current?.abort()
    },
    []
  )

  /**
   * Resolves a deep-link target the loaded pages do not contain.
   *
   * The feed is keyset-paginated twelve rows at a time and a notification can
   * reference a look from any depth of it, so the old `getElementById` found
   * nothing for every target past page one: no scroll, no focus, no
   * announcement, and a reader who followed a link to one specific look landed on
   * an ordinary feed with no sign of it. `GET /posts/{postId}` answers for the
   * post directly and 404s for anything the caller may not see.
   */
  useEffect(() => {
    const controller = new AbortController()
    // A boolean the closure owns, not the signal. Every fresh page pulls this
    // effect down and back up, and relying on the abort to race the settlement
    // of the SAME call it cancels would leave the superseded promise able to
    // clear a value the newer one had already set, depending on which happened
    // to settle last. The flag makes a torn-down run's callbacks inert
    // regardless of that ordering.
    let cancelled = false
    const detailGeneration = ++detailGenerationRef.current
    const readTicket = reactionState.beginRead()
    const textStamp = postTextLedger.begin()
    if (
      highlightedCardId &&
      !itemsRef.current.some((item) => item.id === highlightedCardId)
    ) {
      const stamp = liveSponsorships.begin()
      void getCommunityPostFromWeb(highlightedCardId, controller.signal)
        .then((post) => {
          if (!cancelled && detailGeneration === detailGenerationRef.current) {
            applyLiveSponsorship([post], stamp)
            const read = reactionState.read(post, readTicket)
            setDeepLinkedItem((current) =>
              read
                ? postTextLedger.reconcile(
                    withLiveSponsorship(read, liveSponsorships),
                    textStamp,
                    current
                  )
                : read
            )
          }
        })
        .catch((error: unknown) => {
          // A target withdrawn between the link being followed and this read is
          // an expected outcome, and `processWebDeepLink` owns the invalid-link
          // copy, so nothing is reported from here.
          if (!cancelled && detailGeneration === detailGenerationRef.current) {
            setDeepLinkedItem(null)
            if (communityFailureReason(error) === 'not_found') {
              postTextLedger.evict(highlightedCardId)
              reactionState.evict(highlightedCardId)
              comments.evict(highlightedCardId)
            }
          }
        })
    } else {
      setDeepLinkedItem(null)
    }
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    applyLiveSponsorship,
    comments,
    highlightedCardId,
    liveSponsorships,
    postTextLedger,
    reactionState,
    sessionScope,
  ])

  useEffect(() => {
    if (!highlightedCardId || !sessionScope) return
    const parsed = parseDeepLink(
      Object.fromEntries(new URLSearchParams(window.location.search))
    )
    if (
      !parsed.valid ||
      !parsed.payload?.commentId ||
      parsed.payload.cardId !== highlightedCardId
    )
      return
    let active = true
    const payload = parsed.payload
    const intent = notificationIntentRef.current
    let generation = detailGenerationRef.current
    const readTicket = reactionState.beginRead()
    const controller = new AbortController()
    const deadline = performance.now() + 10_000
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const operationTimer = setTimeout(() => controller.abort(), 10_000)
    const resolveOwned = async () => {
      do {
        generation = detailGenerationRef.current
        // An attempt is admitted only if it can still dispatch and answer inside the
        // operation's 10 s bound; a boundary attempt would leave after the deadline.
        const remaining = deadline - performance.now()
        if (remaining < MINIMUM_TARGET_ATTEMPT_MS) break
        try {
          const textStamp = postTextLedger.begin()
          const result = await communitySyncFromWeb().resolve(
            {
              targets: [
                {
                  key: 'notification',
                  postId: highlightedCardId,
                  commentId: payload.commentId,
                  ...(payload.parentId ? { parentId: payload.parentId } : {}),
                },
              ],
            },
            AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(Math.min(2000, Math.floor(remaining))),
            ])
          )
          if (
            !active ||
            intent !== notificationIntentRef.current ||
            generation === detailGenerationRef.current
          )
            return { result, textStamp }
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
        // Keep the original per-target read ticket across retries. A withdrawn
        // target stays fenced even when an unrelated invalidation re-owns this read.
      } while (active && !controller.signal.aborted)
      throw new CommunityRequestSuperseded()
    }
    let abortOperation: () => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      abortOperation = () =>
        reject(new DOMException('Target verification is unavailable.', 'AbortError'))
      controller.signal.addEventListener('abort', abortOperation, { once: true })
    })
    void Promise.race([resolveOwned(), aborted])
      .then(({ result, textStamp }) => {
        if (!active || generation !== detailGenerationRef.current) return
        const target = result.targets[0]
        if (!target || target.status === 'unavailable') {
          if (target?.status === 'unavailable') {
            if (openedItemRef.current?.id === highlightedCardId)
              openedItemRef.current = null
            if (realtimeDeepLink.current?.id === highlightedCardId)
              realtimeDeepLink.current = null
            newLooksRef.current = newLooksRef.current.filter(
              (item) => item.id !== highlightedCardId
            )
            setNewLooks(newLooksRef.current)
            postTextLedger.evict(highlightedCardId)
            reactionState.evict(highlightedCardId)
            comments.evict(highlightedCardId)
          }
          if (intent === notificationIntentRef.current)
            setNotice({ message: { key: 'community.deepLink.invalid' }, tone: 'info' })
          return
        }
        if (intent !== notificationIntentRef.current) return
        const focus = target.comment ?? target.parent
        const post = reactionState.read(target.post, readTicket)
        if (!post) return
        setDetailSurface('community_feed')
        clearDetailOpener()
        // A resolve copy: it takes the latest live answer for its post.
        setOpenedItem((current) =>
          postTextLedger.reconcile(
            withLiveSponsorship(post, liveSponsorships),
            textStamp,
            current
          )
        )
        if (focus)
          setCommentTarget({
            commentId: focus.id,
            parentId: target.comment?.parentId ?? null,
            pageCursor: target.comment ? target.pageCursor : target.parentPageCursor,
            parentPageCursor: target.parentPageCursor,
          })
        setFocusComments(true)
      })
      .catch((error: unknown) => {
        if (
          active &&
          intent === notificationIntentRef.current &&
          generation === detailGenerationRef.current
        )
          setNotice({
            message: {
              key: notificationFailureIsRetryable(error)
                ? 'community.realtime.unavailable'
                : 'community.deepLink.invalid',
            },
            tone: 'info',
          })
      })
      .finally(() => {
        clearTimeout(operationTimer)
        clearTimeout(retryTimer)
        controller.signal.removeEventListener('abort', abortOperation)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [
    sessionScope,
    highlightedCardId,
    postTextLedger,
    reactionState,
    comments,
    liveSponsorships,
    clearDetailOpener,
  ])

  /**
   * The rows on screen: the loaded pages, with a deep-link target that is not
   * among them carried at the head. Once paging reaches that target, its
   * accepted feed position determines the order even if an older detail settles.
   */
  const displayedItems = useMemo(
    () =>
      deepLinkedItem && !items.some((post) => post.id === deepLinkedItem.id)
        ? mergeFeedPages([deepLinkedItem], items)
        : items,
    [deepLinkedItem, items]
  )

  const spotlightItems = spotlight.state.items
  const visibleRows = useMemo(() => {
    if (rowsMode !== currentMode && isLoading) return []
    return mergeCommunityLooks(spotlightItems, displayedItems, climate, teaserTarget)
  }, [
    climate,
    currentMode,
    displayedItems,
    isLoading,
    rowsMode,
    spotlightItems,
    teaserTarget,
  ])

  const available = feedVisible(communityAvailable, bannedSanction)
  const focusedTargetRef = useRef<string | null>(null)
  // Codex review P2-8: the deep-link focus is spent only once the screen gate shows the body and
  // the card took focus; a card still hidden under the placeholder would drop it.
  const gateOpen = useScreenGateOpen()
  useEffect(() => {
    if (!highlightedCardId) {
      focusedTargetRef.current = null
      return
    }
    if (focusedTargetRef.current === highlightedCardId || !gateOpen || !available) return
    const cardElement =
      document.getElementById(spotlightCardElementId(highlightedCardId)) ??
      document.getElementById(`lookbook-card-${highlightedCardId}`)
    if (cardElement) {
      cardElement.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      cardElement.focus()
      if (document.activeElement !== cardElement) return
      focusedTargetRef.current = highlightedCardId
      setAnnouncement({ key: 'community.feed.announceFocused' })
    }
  }, [available, gateOpen, highlightedCardId, setAnnouncement, visibleRows])

  const handleModeChange = (mode: FilterCategory) => {
    // Another filter's first page replaces the restored rows.
    if (mode !== currentMode) {
      restoringRowsRef.current = false
      setRestoring(false)
      setIsLoading(true)
    }
    setTeaserTarget(null)
    setCurrentMode(mode)
    setNotice(null)
    setAnnouncement({ key: 'community.filters.announce', params: { filterMode: mode } })
    onTabChange?.(mode)
  }

  const handleLoadMore = () => {
    // A page-one read still out (a return's in-place refresh) would be cancelled by this one.
    if (nextCursor && !isLoadingMore && !isLoading) {
      void loadFeed(currentMode, nextCursor)
    }
  }

  const handleRetry = () => {
    // A realtime denial stopped the sync and hid the grid; only a catch-up that reports
    // 'connected' shows it again. Retry starts a new sync, so a member whose access is back
    // sees the items the retried read loads.
    if (realtimeDeniedRef.current) {
      realtimeDeniedRef.current = false
      setRealtimeEpoch((epoch) => epoch + 1)
    }
    void loadFeed(currentMode)
  }

  const closeReportModal = () => {
    setReportingPostId(null)
    setReportError(null)
  }

  /**
   * Opening a look shows it whole and records the one event AC7's advance
   * condition is measured from.
   *
   * The record is fire-and-forget and its failure is swallowed on purpose: this
   * is measurement, and a telemetry route that is down must not stop a reader
   * seeing a photograph. The event's `isSelf` is decided server-side from the
   * stored author id, so nothing here compares ids.
   */
  const showDetail = (item: CommunityFeedItem, surface: AffiliateCommunitySurface) => {
    notificationIntentRef.current++
    setDetailSurface(surface)
    detailOpener.record(surface, item.id)
    setFocusComments(false)
    setAnnouncement(null)
    setReactionFeedback(null)
    setOpenedItem(reactionState.current(item))
  }

  const handleOpenCard = (item: CommunityFeedItem) => {
    showDetail(item, 'community_feed')
    if (experimentVariant === null) {
      return
    }
    void openCommunityPostFromWeb(item.id, experimentVariant).catch(() => undefined)
  }

  /**
   * Story 6.6: a spotlight open records only the spotlight event, with the
   * card's snapshot rank and the level the module was served at. It never
   * sends the feed card-open, so the feed experiment's lift is measured on
   * feed opens alone.
   */
  const handleOpenSpotlightCard = (item: CommunitySpotlightItem) => {
    const { rank, ...post } = item
    showDetail(post, 'community_spotlight')
    const { level } = spotlight.state
    if (level === 'none') return
    void openCommunitySpotlightPostFromWeb(item.id, rank, level).catch(() => undefined)
  }

  /** Records a failed image on one surface; true while its automatic refetches remain. */
  const recordImageFailure = useCallback(
    (surface: ImageSurface, item: CommunityFeedItem) => {
      const url = item.imageAccess.url
      const previous = failedImagesRef.current[surface][item.id]
      const attempts = previous?.url === url ? previous.attempts : 0
      setFailedImages((current) => ({
        ...current,
        [surface]: { ...current[surface], [item.id]: { url, attempts: attempts + 1 } },
      }))
      return attempts < MAX_AUTOMATIC_IMAGE_REFETCHES
    },
    []
  )

  const clearImageFailure = useCallback((surface: ImageSurface, postId: string) => {
    setFailedImages((current) => {
      if (!(postId in current[surface])) return current
      const next = { ...current[surface] }
      delete next[postId]
      return { ...current, [surface]: next }
    })
  }, [])

  const handleImageError = useCallback(
    (item: CommunityFeedItem) => {
      if (recordImageFailure('feed', item)) void loadFeed(modeRef.current)
    },
    [recordImageFailure, loadFeed]
  )

  const handleImageRetry = useCallback(
    (item: CommunityFeedItem) => {
      clearImageFailure('feed', item.id)
      void loadFeed(modeRef.current)
    },
    [clearImageFailure, loadFeed]
  )

  // A spotlight image refetches only its own post, so a failed image never
  // reloads the feed or drops the spotlight's loaded pages.
  const { refreshItem: refreshSpotlightItem } = spotlight
  const handleSpotlightImageError = useCallback(
    (item: CommunityFeedItem) => {
      if (recordImageFailure('spotlight', item)) void refreshSpotlightItem(item.id)
    },
    [recordImageFailure, refreshSpotlightItem]
  )

  const handleSpotlightImageRetry = useCallback(
    (item: CommunityFeedItem) => {
      clearImageFailure('spotlight', item.id)
      void refreshSpotlightItem(item.id)
    },
    [clearImageFailure, refreshSpotlightItem]
  )

  const beginAction = (): AbortController => {
    actionControllerRef.current?.abort()
    const controller = new AbortController()
    actionControllerRef.current = controller
    return controller
  }

  /** The report control settles into its reported state and the modal closes. */
  const settleReported = (postId: string, message: Message, tone: NoticeTone) => {
    setReportedPostIds((previous) => new Set(previous).add(postId))
    setReportingPostId(null)
    setNotice({ message, tone })
    setAnnouncement(message)
  }

  const handleReportSubmit = async (
    reason: CommunityReportReason,
    details?: string
  ): Promise<void> => {
    if (!reportingPostId || !communityAvailable) return
    const action = beginAction()
    const postId = reportingPostId
    setIsSubmittingReport(true)
    setReportError(null)
    try {
      await reportCommunityPostFromWeb(postId, reason, details, action.signal)
      if (action.signal.aborted) return
      settleReported(postId, { key: 'community.report.success' }, 'success')
    } catch (error: unknown) {
      if (action.signal.aborted) return
      setReportError(
        messageForError(error, 'community.error.report', languageRef.current)
      )
    } finally {
      if (!action.signal.aborted) setIsSubmittingReport(false)
    }
  }

  /**
   * CodeRabbit on PR 292: a return's first page-one refresh keeps every restored row its page
   * lacks, so a post the server confirmed withdrawn before that refresh would stay. It leaves the
   * restored rows now; the other restored rows stay where they are.
   */
  const dropRestoredRow = (postId: string) => {
    if (!restoringRowsRef.current) return
    itemsRef.current = itemsRef.current.filter((post) => post.id !== postId)
    setItems((previous) => previous.filter((post) => post.id !== postId))
  }

  const handleWithdrawPost = async (postId: string): Promise<void> => {
    if (!communityAvailable) return
    const action = beginAction()
    const opener = document.activeElement
    try {
      await withdrawCommunityPostFromWeb(postId, action.signal)
      if (action.signal.aborted) return
      if (opener?.getAttribute('data-testid') === 'community-card-actions') {
        withdrawnFocus.current = { postId, opener }
      }
      // No optimistic removal: `items` is published rows only, and a withdrawn
      // post moves to `authorStates` on the next read. Filtering it out locally
      // is what made it reappear on the following refresh.
      const message: Message = { key: 'community.removed.withdrawn' }
      setNotice({ message, tone: 'success' })
      setAnnouncement(message)
      // The spotlight ranks public posts only and never serves a withdrawn one
      // again, so its copy leaves now rather than on the next page-one read.
      applySpotlight((item) => (item?.id === postId ? null : item))
      dropRestoredRow(postId)
      await loadFeed(modeRef.current)
    } catch (error: unknown) {
      if (action.signal.aborted) return
      const message = messageForError(
        error,
        'community.error.withdraw',
        languageRef.current
      )
      setNotice({ message, tone: 'error' })
      setAnnouncement(message)
    }
  }

  const closeCreateModal = () => {
    actionControllerRef.current?.abort()
    setIsCreateModalOpen(false)
    setComposeError(null)
    setAllocated(null)
    setIsPreparingPhoto(false)
    setIsPublishing(false)
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  const openCreateModal = () => {
    if (!communityAvailable || !memberSession) return
    setComposeError(null)
    setNotice(null)
    setIsCreateModalOpen(true)
  }

  const handleSelectPhoto = async (file: File): Promise<void> => {
    if (!communityAvailable || !memberSession) return
    const preview = URL.createObjectURL(file)
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return preview
    })
    setAllocated(null)
    setComposeError(null)
    setIsPreparingPhoto(true)
    const idempotencyKey = generateIdempotencyKey()
    const action = beginAction()
    try {
      const session = await allocateCommunityLookFromWeb({
        imagePreview: preview,
        locale,
        idempotencyKey,
        signal: action.signal,
      })
      if (action.signal.aborted) return
      setAllocated({ ...session, idempotencyKey })
    } catch (error: unknown) {
      if (action.signal.aborted) return
      setComposeError(
        messageForError(error, 'community.error.upload', languageRef.current)
      )
    } finally {
      if (!action.signal.aborted) setIsPreparingPhoto(false)
    }
  }

  const handlePublishPost = async (params: {
    altText: string
    caption?: string
    title?: string
    challengeId?: string | null
  }): Promise<void> => {
    if (!communityAvailable) return
    if (!allocated) {
      setComposeError({ key: 'community.validation.photoRequired' })
      return
    }
    const action = beginAction()
    setIsPublishing(true)
    setComposeError(null)
    try {
      await publishCommunityLookFromWeb({
        postId: allocated.postId,
        uploadSessionId: allocated.uploadSessionId,
        altText: params.altText,
        caption: params.caption ?? null,
        title: params.title,
        challengeId: params.challengeId,
        locale,
        idempotencyKey: allocated.idempotencyKey,
        signal: action.signal,
      })
      if (action.signal.aborted) return
      closeCreateModal()
      const message: Message = { key: 'community.compose.success' }
      setNotice({ message, tone: 'success' })
      setAnnouncement(message)
      // The new post is `pending_review`, so it lands in `authorStates` rather
      // than in the published grid. Re-read instead of inserting it locally.
      await loadFeed(modeRef.current)
    } catch (error: unknown) {
      if (action.signal.aborted) return
      setComposeError(
        messageForError(error, 'community.error.publish', languageRef.current)
      )
    } finally {
      if (!action.signal.aborted) setIsPublishing(false)
    }
  }

  /**
   * Story 6.7b: a CTA's loading and error states go through the same polite
   * region a reaction uses, the dialog's while it is open and the grid's
   * otherwise, so each is announced once and focus never moves.
   */
  const announceSponsored = (key: string) => {
    const id = ++reactionAnnouncementId.current
    if (openedItemRef.current) setReactionFeedback({ key, id })
    else setAnnouncement({ key, announcementId: id })
  }
  const sponsoredHost = (surface: AffiliateCommunitySurface): SponsoredCtaHost => ({
    surface,
    language: i18n.language,
    shown: sponsoredShown,
    announce: announceSponsored,
  })
  const altTextSuggestion = suggestionOf(allocated)
  const gridColumns = isMobilePreview
    ? 'grid-cols-1'
    : 'grid-cols-1 min-[768px]:grid-cols-2'

  /**
   * The banner explains why `auto` fell back to every region, so it belongs to
   * `auto` alone. Rendering it on `bandUnresolvedReason` by itself told a reader
   * who had pinned `cold_dry`, or chosen "Every climate", that they were "seeing
   * every climate band" over a feed that was neither -- the server reports the
   * reason on every response, including the ones where the band was never going
   * to be used. `bandResolved` is the second half of the same gate: it is the
   * field that actually says whether resolution failed.
   */
  const bandNoticeReason =
    displayedMode === 'auto' && !bandResolved ? bandUnresolvedReason : null

  const spotlightStatus = spotlight.state.status
  const spotlightLevel = spotlight.state.level
  const focusSpotlightEntry = spotlight.focusEntry
  useEffect(() => {
    if (!gateOpen || !pendingFocus) return
    const report = (key: SpotlightNoticeKey) => {
      setPendingFocus(null)
      spotlightNoticeSerialRef.current += 1
      setSpotlightNotice({ key, serial: spotlightNoticeSerialRef.current })
    }
    if (!communityAvailable || spotlightStatus === 'idle') {
      report('community.spotlight.destinationUnavailable')
      return
    }
    if (spotlightStatus === 'loading') {
      const timer = setTimeout(
        () => report('community.spotlight.destinationUnavailable'),
        Math.max(0, pendingFocus.receivedAt + SPOTLIGHT_FOCUS_WAIT_MS - Date.now())
      )
      return () => clearTimeout(timer)
    }
    if (
      spotlightStatus === 'ready' &&
      spotlightLevel !== 'none' &&
      spotlightItems.some((post) => post.id === pendingFocus.cardId)
    ) {
      setPendingFocus(null)
      setTeaserTarget(pendingFocus.cardId)
      focusSpotlightEntry(pendingFocus.cardId)
      setAnnouncement({
        key: 'community.feed.announceFocused',
        announcementId: ++reactionAnnouncementId.current,
      })
      return
    }
    report('community.spotlight.targetUnavailable')
  }, [
    communityAvailable,
    focusSpotlightEntry,
    gateOpen,
    pendingFocus,
    spotlightItems,
    spotlightLevel,
    spotlightStatus,
    setAnnouncement,
  ])

  // Story CC-7.7 D3: the reads a screen gate around this section waits for. The feed's first
  // page counts once the session is known (a stored session's first read may still run as a
  // guest); the spotlight counts once it answered for the member, or when no member will read
  // it. A gate that does not list a read ignores it.
  const spotlightState = spotlight.state
  useGridGateReads({
    feedSettled,
    spotlightSettled: spotlightReadSettled(
      feedVisible(communityAvailable, bannedSanction),
      sessionScope,
      spotlightState,
      sessionState.status
    ),
    sessionStatus: sessionState.status,
  })

  // Story CC-7.7 D5: what a return to this tab shows first, kept for the member who sees it.
  // Nothing is kept while Community access is lost (P3-1): the ban, a hidden feed, or a refused
  // realtime session; the store also refuses the parts until a read answers with access.
  const gateScreen = useScreenGateScreen()
  const snapshotScope = useWebSessionScope()
  useEffect(() => {
    if (!gateScreen || !snapshotScope) return
    if (!feedSettled || isLoading || banned || spotlightState.status === 'loading') return
    if (!communityAvailable || realtimeDeniedRef.current) return
    screenSnapshot.remember(snapshotScope, gateScreen, COMMUNITY_GRID_SNAPSHOT_PART, {
      mode: rowsMode,
      scope: sessionScope,
      items,
      authorStates,
      nextCursor,
      servedMode,
      viewerBand,
      bandResolved,
      bandUnresolvedReason,
      experimentVariant,
      activeChallenge,
      spotlight: {
        ...spotlightState,
        loadingMore: false,
        moreFailed: false,
        focusTargetId: null,
      },
    } satisfies CommunityGridSnapshot)
  }, [
    activeChallenge,
    authorStates,
    bandResolved,
    bandUnresolvedReason,
    banned,
    experimentVariant,
    feedSettled,
    gateScreen,
    isLoading,
    items,
    communityAvailable,
    snapshotScope,
    nextCursor,
    rowsMode,
    servedMode,
    sessionScope,
    spotlightState,
    viewerBand,
  ])

  const presentation = communityPresentation(
    available,
    memberSession,
    isSessionPending(sessionState.status),
    visibleRows,
    authorStates,
    nextCursor,
    newLooks,
    openedItem
  )
  useLayoutEffect(() => {
    if (!communityAvailable) return
    renderedItemsRef.current = presentation.items
    restoreScroll(presentation.items)
  }, [communityAvailable, presentation.items, restoreScroll])

  useLayoutEffect(() => {
    const withdrawn = withdrawnFocus.current
    if (!available || !withdrawn || withdrawn.opener.isConnected) return
    if (presentation.items.some((item) => item.id === withdrawn.postId)) return
    withdrawnFocus.current = null
    if (document.activeElement === document.body) {
      document
        .querySelector<HTMLElement>('[data-testid="community-climate-filter"]')
        ?.focus()
    }
  }, [available, presentation.items])

  const { shareHost, shareDialog } = useCommunityShareHost(
    presentation.items,
    presentation.detail,
    spotlightItems,
    presentation.canAct
  )

  const postAction = (
    <CommunityHeaderActions
      showShare={shareSlotShown(memberSession, banned)}
      canShare={presentation.canAct}
      onShare={openCreateModal}
      newPostEmphasis={newPostEmphasis}
      t={t}
    />
  )
  // A warm ScreenGate restores scroll before the header ref update commits.
  // Keep Post out of the feed until the portal is ready so that commit has the settled height.
  const headerPostAction = postActionSlot
    ? createPortal(postAction, postActionSlot)
    : postActionSlot === undefined
      ? postAction
      : null
  const waitingForLooks =
    firstLoadShowing(isLoading || !feedSettled, restoring) ||
    (spotlightStatus === 'loading' && visibleRows.length === 0)
  const settledClimate =
    available && memberSession && !isLoading && feedSettled ? climate : null
  const handleShowAllClimates = climateEmptyAction(
    settledClimate,
    presentation.items.length,
    waitingForLooks,
    feedError,
    handleModeChange
  )
  const climateEmpty = Boolean(handleShowAllClimates)

  const settingsLink = (
    <CommunitySettingsLink
      banned={banned}
      href={presentation.settingsHref}
      label={t(presentation.settingsLabel)}
      signIn={presentation.settingsSignIn}
      guestOnly={!hasSession}
    />
  )
  const renderSettingsFooter = () => {
    if (banned || (refusedScope !== undefined && refusedScope === sessionScope))
      return null
    if (!memberSession && snapshotScope === null) return null
    const returning = restored && initialScope === snapshotScope
    // Keep the whole footer out of view while the feed hides. A trusted return still needs the
    // footer's height and gap to restore its offset. A focused bell stays reachable in a recheck.
    const pending = returning
      ? 'invisible focus-within:visible'
      : 'hidden focus-within:block'
    return (
      <div className={`min-h-11 ${available && !waitingForLooks ? '' : pending}`}>
        {!presentation.settingsSignIn && settingsLink}
      </div>
    )
  }

  const renderHeader = () => (
    <>
      {headerPostAction}
      {showFilterNav && !banned && (
        <CommunityClimateFilter
          activeTab={displayedMode}
          viewerBand={bandResolved ? viewerBand : null}
          onTabChange={handleModeChange}
        >
          <CommunityNotices
            bandUnresolvedReason={bandNoticeReason}
            canAddLocation={hasSession}
            returnPath={returnPath}
            notice={null}
            noticeText={null}
            t={t}
          />
        </CommunityClimateFilter>
      )}
      {available && activeChallenge && !dismissedChallenges.has(activeChallenge.id) && (
        <WeeklyChallengeBanner
          challenge={activeChallenge}
          t={t}
          canParticipate={presentation.canAct}
          onParticipate={openCreateModal}
          onDismiss={() => {
            setDismissedChallenges((previous) =>
              new Set(previous).add(activeChallenge.id)
            )
            document
              .querySelector<HTMLElement>('[data-testid="community-climate-filter"]')
              ?.focus()
          }}
        />
      )}
      {presentation.settingsSignIn && settingsLink}

      {/* A failed session check: the grid re-checks the session like every member section. */}
      <SessionRetryButton
        session={sessionState}
        testId="community-session-retry"
        className="min-h-11 self-start rounded-md border border-line-strong bg-page text-ink px-4 text-sm font-semibold"
      />

      <CommunityNotices
        bandUnresolvedReason={null}
        canAddLocation={hasSession}
        returnPath={returnPath}
        notice={notice}
        noticeText={renderMessage(notice?.message ?? null, t, viewerBand)}
        t={t}
      />
    </>
  )

  const renderFeed = () => (
    <>
      {bannedSanction ? (
        <CommunityBannedNotice sanction={bannedSanction} language={i18n.language} t={t} />
      ) : (
        <CommunityFeedStates
          settled={available && !waitingForLooks}
          isLoading={available && waitingForLooks}
          errorText={renderMessage(feedError, t, viewerBand)}
          retryable={feedError?.key !== FAILURE_KEYS.signed_out}
          itemCount={presentation.items.length}
          gridColumns={gridColumns}
          canShare={presentation.canAct}
          onRetry={handleRetry}
          onClearFilters={handleShowAllClimates}
          onShare={openCreateModal}
          firstContent
          t={t}
        />
      )}

      {/* Story CC-7.7 D4: the new-looks pill is an overlay pinned to the top of the list. It
            used to sit below the cards and push everything after it down when realtime looks
            arrived; now it takes no space, and the cards never move for it. */}
      <div className="relative">
        <div className="pointer-events-none sticky top-20 z-20 h-0">
          {presentation.showNewLooks && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                data-testid="community-new-looks-pill"
                className="pointer-events-auto rounded-full border border-line-strong bg-page px-4 py-3 text-ink shadow-overlay"
                disabled={isInsertingLooks}
                onClick={() => {
                  void insertNewLooks()
                }}
              >
                {t('community.realtime.showNewLooks', { count: newLooks.length })}
              </button>
            </div>
          )}
        </div>
        <div
          ref={gridRef}
          data-testid="community-card-grid"
          data-chip-category={chipCategory}
          aria-busy={isLoading || isLoadingMore}
          className={`grid gap-6 ${gridColumns}`}
        >
          {presentation.items.map((item, index) => {
            const ranked = isRankedLook(item)
            const surface = ranked ? 'community_spotlight' : 'community_feed'
            const imageSurface = ranked ? 'spotlight' : 'feed'
            return (
              <LookbookCard
                scope={ranked ? SPOTLIGHT_CARD_SCOPE : undefined}
                firstContent={index === 0}
                reactionControls={reactionState.controls(item.id)}
                key={item.id}
                item={item}
                isHighlighted={item.id === highlightedCardId}
                isFailedImage={
                  failedImages[imageSurface][item.id]?.url === item.imageAccess.url
                }
                isReported={reportedPostIds.has(item.id)}
                canAct={presentation.canAct}
                t={t}
                sponsored={sponsoredHost(surface)}
                onImageError={ranked ? handleSpotlightImageError : handleImageError}
                onImageRetry={ranked ? handleSpotlightImageRetry : handleImageRetry}
                onOpen={ranked ? () => handleOpenSpotlightCard(item) : handleOpenCard}
                onReport={(postId) => {
                  setReportError(null)
                  setReportingPostId(postId)
                }}
                onWithdraw={(postId) => {
                  void handleWithdrawPost(postId)
                }}
              />
            )
          })}
        </div>
      </div>

      {available && !climateEmpty && (
        <CommunitySpotlightPaging
          state={spotlightState}
          t={t}
          onLoadMore={() => {
            void spotlight.loadMore()
          }}
          onRetry={() => {
            void spotlight.retry()
          }}
          onFocused={spotlight.clearFocusTarget}
        />
      )}
      <AuthorStatesSection states={presentation.authorStates} t={t} />
      {!climateEmpty && (
        <CommunityExampleInspiration
          available={feedVisible(communityAvailable, bannedSanction)}
          loading={isLoading}
          failed={Boolean(feedError)}
          servedMode={servedMode}
          viewerBand={viewerBand}
          items={presentation.items}
          locale={i18n.language}
        />
      )}

      <LoadMoreControl
        nextCursor={climateEmpty ? null : presentation.nextCursor}
        isLoading={firstLoadShowing(isLoading, restoring)}
        isRefreshing={isLoading}
        isLoadingMore={isLoadingMore}
        onLoadMore={handleLoadMore}
        t={t}
      />

      {renderSettingsFooter()}
    </>
  )

  const renderDialogs = () => (
    <>
      {presentation.detail && (
        <LookbookDetailDialog
          suspended={!communityAvailable}
          comments={comments}
          focusComments={focusComments}
          commentTarget={
            presentation.detail.id === highlightedCardId ? commentTarget : undefined
          }
          reactionControls={reactionState.controls(presentation.detail.id)}
          reactionFeedback={reactionFeedback}
          item={presentation.detail}
          canAct={presentation.canAct}
          sponsored={sponsoredHost(detailSurface)}
          t={t}
          restoreFocus={detailOpener.restoreFocus}
          onTextSaved={(postId, text) => {
            postTextLedger.record({ id: postId, ...text, status: 'published' })
            const update = (post: CommunityFeedItem | null) =>
              post?.id === postId && (post.textRevision ?? 0) <= text.textRevision
                ? { ...post, ...text }
                : post
            newLooksRef.current = newLooksRef.current.map((item) => update(item)!)
            setNewLooks(newLooksRef.current)
            setItems((previous) => previous.map((item) => update(item)!))
            setOpenedItem(update)
            setDeepLinkedItem(update)
            applySpotlight(update)
          }}
          onTextStatus={(key) => {
            const id = ++reactionAnnouncementId.current
            setReactionFeedback({ key, id })
          }}
          onClose={() => {
            notificationIntentRef.current++
            comments.retireFocus(presentation.detail!.id)
            setCommentTarget(undefined)
            setOpenedItem(null)
          }}
        />
      )}

      {reportingPostId !== null && (
        <CommunityReportModal
          suspended={!communityAvailable}
          onClose={closeReportModal}
          onSubmit={(reason, details) => {
            void handleReportSubmit(reason, details)
          }}
          isSubmitting={isSubmittingReport}
          errorMessage={renderMessage(reportError, t, viewerBand)}
          t={t}
        />
      )}

      {isCreateModalOpen && (
        <PostCreationModal
          key={sessionScope}
          suspended={!communityAvailable}
          onClose={closeCreateModal}
          onSelectPhoto={(file) => {
            void handleSelectPhoto(file)
          }}
          onPublish={(params) => {
            void handlePublishPost(params)
          }}
          photoPreview={photoPreview}
          altTextSuggestion={altTextSuggestion}
          describeDraft={describeDraftRequest(allocated, sessionScope)}
          isPreparing={isPreparingPhoto}
          isPublishing={isPublishing}
          activeChallenge={activeChallenge}
          errorMessage={renderMessage(composeError, t, viewerBand)}
          t={t}
        />
      )}
      {shareDialog}
    </>
  )

  return (
    <ShareCardHostContext.Provider value={shareHost}>
      <aside
        aria-label={t('community.sectionLabel')}
        className={communityAsideClass(banned)}
      >
        <SpotlightFocusNotice notice={spotlightNotice} t={t} />
        {renderHeader()}
        {renderFeed()}
        {/* The one polite live region on this surface. */}
        <div
          aria-live="polite"
          role="status"
          data-testid="community-live-region"
          className="sr-only"
        >
          {announcements.map((message, index) => (
            <Fragment
              key={
                index === 0
                  ? `current-${message.announcementId ?? ''}`
                  : `queued-${index}`
              }
            >
              {/* A space between messages, so the region reads as separate sentences. */}
              {index > 0 ? ' ' : null}
              <span>{openedItem ? null : renderMessage(message, t, viewerBand)}</span>
            </Fragment>
          ))}
        </div>

        {renderDialogs()}
      </aside>
    </ShareCardHostContext.Provider>
  )
}

/**
 * Story 6.7b: a copy of `item` carrying exactly what the latest live read said
 * about its block. A post no live read answered for is returned unchanged.
 */
function withLiveSponsorship<T extends CommunityFeedItem>(
  item: T,
  live: LiveSponsorshipAnswers
): T {
  if (!live.has(item.id)) return item
  const block = live.get(item.id)
  if (block) return { ...item, sponsorship: block }
  if (!item.sponsorship) return item
  const ended = { ...item }
  delete ended.sponsorship
  return ended
}

/** Appends a page without duplicating a row the previous page already carried. */
function mergeFeedPages(
  previous: readonly CommunityFeedItem[],
  page: readonly CommunityFeedItem[]
): CommunityFeedItem[] {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...page.filter((item) => !seen.has(item.id))]
}

/**
 * The community share dialog lives above the cards: hiding content while access is
 * re-verified unmounts every card, and the member's composition must survive that.
 * The dialog shows only while its own post is eligible and the viewer can act.
 */
function useCommunityShareHost(
  items: readonly CommunityFeedItem[],
  detail: CommunityFeedItem | null,
  spotlightItems: readonly CommunityFeedItem[],
  canAct: boolean
) {
  const [share, setShare] = useState<{ postId: string; open: boolean } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const invokingSurface = useRef<{ postId: string; scope: string } | null>(null)
  const shareHost = useMemo<ShareCardHost>(
    () => ({
      open: (target, scope, element) => {
        invokingSurface.current = { postId: target, scope }
        opener.current = element
        setShare({ postId: target, open: true })
      },
      register: (target, scope, element) => {
        // The feed, spotlight and detail may all render this post. Rebind only
        // the invoking surface when access re-verification remounts its button.
        if (
          element &&
          target === invokingSurface.current?.postId &&
          scope === invokingSurface.current.scope
        )
          opener.current = element
      },
    }),
    []
  )
  const item = share
    ? (items.find((candidate) => candidate.id === share.postId) ??
      (detail?.id === share.postId ? detail : null) ??
      spotlightItems.find((candidate) => candidate.id === share.postId))
    : null
  const eligible = Boolean(
    item?.author.isSelf && item.status === 'published' && item.publishedAt !== null
  )
  const shareDialog = share && (
    <ShareCardDialog
      key={share.postId}
      source={{ kind: 'community_post', postId: share.postId }}
      open={share.open && canAct && eligible}
      onClose={() => setShare((current) => current && { ...current, open: false })}
      opener={opener}
    />
  )
  return { shareHost, shareDialog }
}

/** Drops image failures whose signed URL the server has since replaced. */
function pruneFailedImages(
  previous: Record<string, FailedImage>,
  page: readonly CommunityFeedItem[]
): Record<string, FailedImage> {
  const currentUrls = new Map(page.map((item) => [item.id, item.imageAccess.url]))
  const next: Record<string, FailedImage> = {}
  for (const [id, entry] of Object.entries(previous)) {
    if (currentUrls.has(id) && currentUrls.get(id) !== entry.url) {
      continue
    }
    next[id] = entry
  }
  return next
}
