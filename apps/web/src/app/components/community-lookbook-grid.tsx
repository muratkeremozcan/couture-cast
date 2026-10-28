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

import { CommunityComments } from './community-comments'
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
  CommunityRequestError,
  communityFailureReason,
  setCommunityReactionFromWeb,
  communityRetryAfterSeconds,
  generateIdempotencyKey,
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  hasWebSession,
  openCommunityPostFromWeb,
  openCommunitySpotlightPostFromWeb,
  publishCommunityLookFromWeb,
  reportCommunityPostFromWeb,
  withdrawCommunityPostFromWeb,
  type CommunityFailureReason,
} from '../../lib/community'
import { resolveWebApiBaseUrl } from '../../lib/api-client'
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
  CommunitySpotlightSection,
  SPOTLIGHT_CARD_SCOPE,
  useCommunitySpotlight,
} from './community-spotlight'

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import Image from 'next/image'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { parseDeepLink, CLIMATE_BANDS } from '@couture/utils'
import {
  communityModerationReasonCategories,
  communityPostCaptionSchema,
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
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { AccessibleModal } from './accessible-modal'
import { CHIP_NAVIGATION_HEIGHT_PX, type ChipCategory } from './chip-navigation'

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
 * Deep merlot. A semantic state colour for errors, destructive actions and
 * flagged content, so it stays a literal while the theme colours come from the
 * custom properties in `globals.css`.
 */
const MERLOT = '#7A1F2D'

/**
 * Every reason the community wrappers can throw, mapped onto catalog copy.
 * Typing this as a total `Record` means a new member of
 * `CommunityFailureReason` fails to typecheck here until it has copy.
 */
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

const FAILURE_KEYS: Record<CommunityFailureReason, string> = {
  signed_out: 'community.error.signedOut',
  age_gate: 'community.error.ageGate',
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
 * slots only, and renders this component and {@link LookbookFilterNav} outside
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
// LookbookFilterNav
// ---------------------------------------------------------------------------

export interface LookbookFilterNavProps {
  activeTab: FilterCategory
  isMobilePreview?: boolean
  onTabChange: (tab: FilterCategory) => void
  /** The band `auto` resolved to, so that chip can name it instead of saying "your climate". */
  viewerBand?: ClimateBand | null
}

export function LookbookFilterNav({
  activeTab,
  isMobilePreview = false,
  onTabChange,
  viewerBand = null,
}: LookbookFilterNavProps) {
  const { t } = useCommunityTranslation()

  const handleTabClick = (tab: FilterCategory) => {
    onTabChange(tab)
    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('layout_interaction', {
          action: 'filter_chip_click',
          target: tab,
        })
      }
    } catch {
      // Telemetry must never take the feed down with it.
    }
  }

  return (
    <nav
      aria-label={t('community.filters.label')}
      style={{ top: CHIP_NAVIGATION_HEIGHT_PX }}
      className="sticky z-10 flex flex-col gap-3 border-b border-[color:var(--theme-card-border)] bg-white/95 py-3 backdrop-blur"
    >
      <h2
        tabIndex={-1}
        data-share-card-focus-fallback="community"
        className="lookbook-display text-2xl font-semibold text-[color:var(--theme-primary)]"
      >
        {t('community.heading')}
      </h2>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {COMMUNITY_FEED_MODES.map((mode) => {
          const isActive = activeTab === mode
          const tabletStyles = isMobilePreview
            ? ''
            : 'min-[768px]:rounded-full min-[768px]:border min-[768px]:px-4 min-[768px]:py-2'
          // Selection is carried by weight and border thickness as well as
          // colour, so it survives a monochrome or high-contrast rendering.
          const activeStyles = isActive
            ? 'border-[color:var(--theme-secondary)] font-bold text-[color:var(--theme-card-text)] underline underline-offset-4'
            : 'border-transparent font-medium text-neutral-600 min-[768px]:border-[color:var(--theme-card-border)] min-[768px]:bg-[var(--theme-card-bg)]'

          return (
            <button
              key={mode}
              type="button"
              data-testid={`community-filter-${mode}`}
              onClick={() => {
                handleTabClick(mode)
              }}
              aria-pressed={isActive}
              className={`min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] ${tabletStyles} ${activeStyles}`}
            >
              {modeLabel(mode, viewerBand, t, isActive)}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// WeeklyChallengeBanner
// ---------------------------------------------------------------------------

interface WeeklyChallengeBannerProps {
  challenge: EmbeddedCommunityChallenge
  language: string
  t: Translate
  onParticipate: (challenge: EmbeddedCommunityChallenge) => void
}

function WeeklyChallengeBanner({
  challenge,
  language,
  t,
  onParticipate,
}: WeeklyChallengeBannerProps) {
  const formattedDates = (() => {
    try {
      const format = new Intl.DateTimeFormat(language, {
        month: 'short',
        day: 'numeric',
      })
      return t('community.challenge.dateRange', {
        start: format.format(new Date(challenge.startsAt)),
        end: format.format(new Date(challenge.endsAt)),
      })
    } catch {
      return t('community.challenge.activeThisWeek')
    }
  })()

  return (
    <aside
      data-testid="weekly-challenge-banner"
      aria-labelledby="weekly-challenge-title"
      className="flex flex-col gap-3 rounded-[8px] border border-[color:var(--theme-secondary)] bg-[var(--theme-card-bg)] p-5 shadow-sm motion-safe:transition-all"
    >
      <div className="flex items-center justify-between">
        <span className="lookbook-metrics text-[11px] font-bold uppercase tracking-wider text-[color:var(--theme-card-text)]">
          {t('community.challenge.eyebrow')}
        </span>
        <div className="flex items-center gap-2">
          <span
            data-testid="challenge-climate-band"
            className="lookbook-metrics rounded bg-[#C9A14A] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#111111]"
          >
            {challenge.climateBand
              ? bandLabel(challenge.climateBand, t)
              : t('community.challenge.allClimates')}
          </span>
          <span className="lookbook-metrics text-[11px] text-neutral-600">
            {formattedDates}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <h3
          id="weekly-challenge-title"
          className="lookbook-display text-lg font-semibold text-[color:var(--theme-card-text)]"
        >
          {challenge.title}
        </h3>
        <p className="text-xs leading-relaxed text-neutral-600">{challenge.body}</p>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          data-testid="challenge-participate-button"
          aria-label={t('community.challenge.participateLabel', {
            title: challenge.title,
          })}
          onClick={() => {
            onParticipate(challenge)
          }}
          className="min-h-[44px] rounded-full bg-[#C9A14A] px-5 py-2 text-xs font-semibold text-[#111111] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] motion-safe:transition-colors"
        >
          {t('community.challenge.participate')}
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
      className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-[var(--theme-card-bg)]"
    >
      {isFailedImage ? (
        <div
          data-testid={`${scope}image-unavailable-${item.id}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--theme-card-bg)] p-4 text-center"
        >
          <span className="text-xs font-medium text-neutral-600">
            {t('community.card.imageUnavailable')}
          </span>
          <button
            type="button"
            data-testid={`${scope}image-retry-button-${item.id}`}
            onClick={() => {
              onImageRetry(item)
            }}
            className="min-h-[44px] rounded-full border border-[color:var(--theme-card-border)] px-4 py-1.5 text-xs font-semibold text-[color:var(--theme-card-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
          className="object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:scale-[1.02] motion-reduce:transition-none"
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
          className="absolute inset-0 flex items-end justify-end p-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--theme-secondary)]"
        >
          <span
            aria-hidden="true"
            className="lookbook-metrics rounded-full bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--theme-card-text)] shadow-sm motion-safe:transition-colors"
          >
            {t('community.card.open')}
          </span>
        </button>
      )}

      {/*
       * Bounded on the right so the badges wrap inside the card. A spotlight
       * card also carries the rank pill in its top-right corner, so its badges
       * stop short of it.
       */}
      <div
        className={`pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2 ${
          scope === SPOTLIGHT_CARD_SCOPE ? 'right-14' : 'right-3'
        }`}
      >
        {/*
         * One band badge, not two. The old surface carried a `location-badge`
         * beside this one, but `communityFeedItemSchema` publishes no location:
         * authors are pseudonymous and the spec forbids exposing anything that
         * would place them, so the second badge had nothing real to show.
         */}
        <span
          data-testid={`${scope}climate-badge-${item.id}`}
          className="lookbook-metrics rounded-md bg-[#C9A14A] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#111111]"
        >
          {bandLabel(item.climateBand, t)}
        </span>
        {item.status !== 'published' && (
          <span
            data-testid={`${scope}status-badge-${item.id}`}
            className="lookbook-metrics rounded-md border border-[color:var(--theme-card-border)] bg-white/95 px-2 py-0.5 text-[9px] font-medium uppercase text-[color:var(--theme-card-text)]"
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
            className="lookbook-metrics rounded-md border border-[color:var(--theme-secondary)] bg-white/95 px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--theme-card-text)]"
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

/**
 * The CTA row shows exactly one moderation affordance.
 *
 * It used to render Withdraw *and* Report for the caller's own post, which
 * offered a self-report the server answers with 403.
 */
function LookbookCardContent({
  scope,
  reactionControls,
  item,
  isReported,
  canAct,
  t,
  onReport,
  onWithdraw,
}: LookbookCardContentProps) {
  const authorName = authorNameOf(item, t)

  return (
    <div className="flex flex-1 flex-col justify-between gap-3 p-5">
      <div className="space-y-2">
        <h3 id={`${scope}lookbook-card-title-${item.id}`} className="sr-only">
          {t('community.card.label', { author: authorName })}
        </h3>
        <span
          data-testid={`${scope}author-name-${item.id}`}
          className="lookbook-metrics block text-xs font-semibold text-[color:var(--theme-card-text)]"
        >
          {authorName}
        </span>

        {item.caption && (
          <p
            data-testid={`${scope}caption-${item.id}`}
            className="text-xs leading-relaxed text-neutral-600 line-clamp-3"
          >
            {item.caption}
          </p>
        )}
      </div>

      {canAct &&
        item.author.isSelf &&
        item.status === 'published' &&
        item.publishedAt !== null && <CommunityShareCardControl postId={item.id} />}
      {canAct && (
        <CommunityReactions item={item} controls={reactionControls} scope={scope} />
      )}
      {canAct && (
        <div className="flex items-center gap-3 border-t border-[color:var(--theme-card-border)] pt-3 text-xs">
          {item.author.isSelf ? (
            <button
              type="button"
              data-testid={`${scope}withdraw-button-${item.id}`}
              onClick={() => {
                onWithdraw(item.id)
              }}
              style={{ color: MERLOT }}
              className="min-h-[44px] font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
            >
              {t('community.card.withdraw')}
            </button>
          ) : (
            <button
              type="button"
              data-testid={`${scope}report-button-${item.id}`}
              disabled={isReported}
              onClick={() => {
                onReport(item.id)
              }}
              className={`min-h-[44px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] ${
                isReported
                  ? 'cursor-default text-[color:var(--theme-card-text)]'
                  : 'text-neutral-600 hover:underline'
              }`}
            >
              {isReported ? t('community.card.reported') : t('community.card.report')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface LookbookCardProps {
  /** Empty for the feed; `spotlight-` for the City Spotlight's copy of a post. */
  scope?: string
  onComments: (item: CommunityFeedItem) => void
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
  onComments,
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
  return (
    <article
      data-focus-surface="light"
      id={`${scope}lookbook-card-${item.id}`}
      data-testid={`${scope}lookbook-card-${item.id}`}
      tabIndex={-1}
      aria-labelledby={
        item.sponsorship ? `${titleId} ${sponsoredDisclosureId(scope, item.id)}` : titleId
      }
      data-highlighted={isHighlighted ? 'true' : 'false'}
      className={`flex flex-col overflow-hidden rounded-[8px] border bg-[var(--theme-card-bg)] text-[color:var(--theme-card-text)] shadow-sm motion-safe:transition-[border-color,box-shadow] motion-safe:duration-300 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] ${
        isHighlighted
          ? 'border-[color:var(--theme-secondary)] outline outline-2 outline-[color:var(--theme-primary)] ring-2 ring-[color:var(--theme-secondary)] ring-offset-2 shadow-lg'
          : 'border-[color:var(--theme-card-border)]'
      }`}
    >
      <LookbookCardImageSurface
        scope={scope}
        item={item}
        isFailedImage={isFailedImage}
        t={t}
        onImageError={onImageError}
        onImageRetry={onImageRetry}
        onOpen={onOpen}
      />
      <SponsoredCtaSlot
        scope={scope}
        item={item}
        canAct={canAct}
        t={t}
        host={sponsored}
      />
      <button
        type="button"
        className="min-h-[44px] px-5 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
        data-testid={`${scope}comments-button-${item.id}`}
        onClick={() => onComments(item)}
      >
        {t('community.comments.title')}
      </button>
      <LookbookCardContent
        scope={scope}
        reactionControls={reactionControls}
        item={item}
        isReported={isReported}
        canAct={canAct}
        t={t}
        onReport={onReport}
        onWithdraw={onWithdraw}
      />
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
  onClose: () => void
}

/**
 * What a card opens into. The grid crops each look to a 256px `object-cover`
 * band and clamps its caption to three lines, so this is the only place the
 * whole photograph and the whole caption are readable.
 *
 * `object-contain` rather than the grid's `object-cover`: cropping is a grid
 * affordance, and a look the reader deliberately opened must not lose its hem
 * or its hat to the frame.
 */
function LookbookDetailDialog({
  suspended = false,
  focusComments,
  comments,
  reactionFeedback,
  item,
  canAct,
  sponsored,
  t,
  onClose,
  reactionControls,
  commentTarget,
}: LookbookDetailDialogProps) {
  const authorName = authorNameOf(item, t)

  return (
    <AccessibleModal
      suspended={suspended}
      isOpen
      onClose={onClose}
      title={t('community.card.label', { author: authorName })}
      surface="theme"
      titleId="community-detail-title"
      closeLabel={t('community.card.detailClose')}
    >
      <div data-testid="community-detail" className="flex flex-col gap-4">
        {canAct &&
          item.author.isSelf &&
          item.status === 'published' &&
          item.publishedAt !== null && <CommunityShareCardControl postId={item.id} />}
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
        <div className="relative h-80 w-full overflow-hidden rounded-[8px] bg-[var(--theme-card-bg)]">
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
            className="lookbook-metrics rounded-md bg-[#C9A14A] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#111111]"
          >
            {bandLabel(item.climateBand, t)}
          </span>
          <span
            data-testid="community-detail-author"
            className="lookbook-metrics text-xs font-semibold text-[color:var(--theme-card-text)]"
          >
            {authorName}
          </span>
          {item.sponsorship && (
            <span
              data-testid={`community-detail-sponsored-${item.id}`}
              className="lookbook-metrics rounded-md border border-[color:var(--theme-secondary)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--theme-card-text)]"
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
            className="text-xs leading-relaxed text-neutral-600"
          >
            {item.caption}
          </p>
        )}
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
      className="flex flex-col gap-3 rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-5"
    >
      <div className="space-y-1">
        <h3
          id="community-author-states-title"
          className="lookbook-display text-base font-semibold text-[color:var(--theme-card-text)]"
        >
          {t('community.feed.yourPostsTitle')}
        </h3>
        <p className="text-xs text-neutral-600">{t('community.feed.yourPostsBody')}</p>
      </div>

      <ul className="flex flex-col gap-3">
        {states.map((state) => {
          const isFlagged = state.status === 'flagged'
          return (
            <li
              key={state.id}
              data-testid={`author-state-${state.id}`}
              className="space-y-1 border-t border-[color:var(--theme-card-border)] pt-3 first:border-t-0 first:pt-0"
            >
              <span
                data-testid={`status-badge-${state.id}`}
                style={isFlagged ? { color: MERLOT, borderColor: MERLOT } : undefined}
                className={`lookbook-metrics inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  isFlagged
                    ? ''
                    : 'border-[color:var(--theme-card-border)] text-[color:var(--theme-card-text)]'
                }`}
              >
                {t(`community.status.${state.status}`)}
              </span>
              {REMOVED_STATUSES.has(state.status) && (
                <p
                  data-testid={`author-state-explanation-${state.id}`}
                  style={isFlagged ? { color: MERLOT } : undefined}
                  className={`text-xs leading-relaxed ${isFlagged ? '' : 'text-neutral-600'}`}
                >
                  {t(`community.removed.${state.status}`)}
                </p>
              )}
              {state.moderationReason && (
                <p
                  data-testid={`author-state-reason-${state.id}`}
                  className="text-xs text-neutral-600"
                >
                  {moderationReasonText(state.moderationReason, t)}
                </p>
              )}
              {state.caption && (
                <p
                  data-testid={`author-state-caption-${state.id}`}
                  className="text-xs leading-relaxed text-neutral-600 line-clamp-2"
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
            style={{ color: MERLOT, borderColor: MERLOT }}
            className="rounded-md border p-3 text-xs"
          >
            {errorMessage}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="report-reason-select"
            className="text-xs font-semibold text-[color:var(--theme-primary)]"
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
            className="w-full rounded-md border border-[color:var(--theme-card-border)] bg-white px-3 py-2 text-xs text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
            className="text-xs font-semibold text-[color:var(--theme-primary)]"
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
            className="w-full rounded-md border border-[color:var(--theme-card-border)] p-2.5 text-xs text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          />
          <span className="text-[10px] text-neutral-500">
            {t('community.report.detailsCount', { count: details.length })}
          </span>
        </div>

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] rounded-full border border-[color:var(--theme-card-border)] px-4 py-2 text-xs font-medium text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          >
            {t('community.report.cancel')}
          </button>
          <button
            type="submit"
            data-testid="report-submit-button"
            disabled={isSubmitting}
            style={{ backgroundColor: MERLOT }}
            className="min-h-[44px] rounded-full px-5 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] disabled:opacity-50"
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

interface PostCreationModalProps {
  suspended?: boolean
  onClose: () => void
  onSelectPhoto: (file: File) => void
  onPublish: (params: {
    altText: string
    caption?: string
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
function PostCreationModal({
  suspended = false,
  onClose,
  onSelectPhoto,
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
    const failure = composeValidationKey({
      hasAllocatedPhoto: altTextSuggestion !== null,
      altText,
      isAltTextConfirmed,
      caption,
    })
    setValidationKey(failure)
    if (failure !== null) {
      return
    }
    onPublish({
      altText: altText.trim(),
      caption: caption.trim() || undefined,
      challengeId: selectedChallengeId,
    })
  }

  const isPublishBlocked =
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
      onClose={onClose}
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
            style={{ color: MERLOT, borderColor: MERLOT }}
            className="rounded-md border p-3 text-xs"
          >
            {errorMessage ?? (validationKey ? t(validationKey) : '')}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="post-image-file"
            className="text-xs font-semibold text-[color:var(--theme-primary)]"
          >
            {t('community.compose.photoLabel')}
          </label>
          <input
            id="post-image-file"
            type="file"
            data-testid="post-image-file-input"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                setValidationKey(null)
                onSelectPhoto(file)
              }
            }}
            className="w-full text-xs text-neutral-600 file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-[#C9A14A] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          />
          <p className="text-[10px] text-neutral-500">
            {t('community.compose.photoHint')}
          </p>
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
            <p
              data-testid="create-post-progress"
              className="text-[10px] text-neutral-500"
            >
              {t('community.compose.uploading')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="post-alt-text"
            className="text-xs font-semibold text-[color:var(--theme-primary)]"
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
            className="w-full rounded-md border border-[color:var(--theme-card-border)] p-2.5 text-xs text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          />
          <p className="text-[10px] text-neutral-500">
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
              className="h-4 w-4 rounded border-[color:var(--theme-card-border)]"
            />
            <label
              htmlFor="confirm-alt-text"
              className="text-xs font-medium text-[color:var(--theme-primary)]"
            >
              {t('community.compose.altConfirm')}
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="post-caption-input"
            className="text-xs font-semibold text-[color:var(--theme-primary)]"
          >
            {t('community.compose.captionLabel')}
          </label>
          <textarea
            id="post-caption-input"
            data-testid="post-caption-input"
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value)
              setValidationKey(captionValidationKey(event.target.value))
            }}
            maxLength={280}
            rows={3}
            placeholder={t('community.compose.captionPlaceholder')}
            className="w-full rounded-md border border-[color:var(--theme-card-border)] p-2.5 text-xs text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          />
          <span className="text-[10px] text-neutral-500">
            {t('community.compose.captionCount', { count: caption.length })}
          </span>
        </div>

        {activeChallenge && (
          <div className="space-y-2">
            <label
              htmlFor="post-challenge-select"
              className="text-xs font-semibold text-[color:var(--theme-primary)]"
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
              className="w-full rounded-md border border-[color:var(--theme-card-border)] bg-white px-3 py-2 text-xs text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
            >
              <option value="">{t('community.compose.challengeNone')}</option>
              <option value={activeChallenge.id}>{activeChallenge.title}</option>
            </select>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="min-h-[44px] rounded-full border border-[color:var(--theme-card-border)] px-4 py-2 text-xs font-medium text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
          >
            {t('community.compose.cancel')}
          </button>
          <button
            type="submit"
            data-testid="post-publish-submit"
            disabled={isPublishBlocked}
            className="min-h-[44px] rounded-full bg-[#C9A14A] px-5 py-2 text-xs font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
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

interface CommunityHeaderProps {
  canShare: boolean
  onShare: () => void
  t: Translate
}

function CommunityHeader({ canShare, onShare, t }: CommunityHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="lookbook-metrics text-xs uppercase tracking-widest text-[color:var(--theme-card-text)]">
        {t('community.inspirations')}
      </span>
      {canShare && (
        <button
          type="button"
          data-testid="create-post-button"
          onClick={onShare}
          className="min-h-[44px] rounded-full bg-[#C9A14A] px-4 py-1.5 text-xs font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] motion-safe:transition-colors"
        >
          {t('community.newPost')}
        </button>
      )}
    </div>
  )
}

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  // Gold accents a success, per the premium accent system.
  success:
    'border-[color:var(--theme-secondary)] bg-[var(--theme-card-bg)] text-[color:var(--theme-card-text)]',
  info: 'border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] text-[color:var(--theme-card-text)]',
  error: '',
}

/** Story 1.2b: the guided add-location path, which returns here after the save. */
export const COMMUNITY_ADD_LOCATION_HREF =
  '/settings?addLocation=1&returnTo=%2F#locations'

interface CommunityNoticesProps {
  bandUnresolvedReason: CommunityBandUnresolvedReason | null
  canAddLocation: boolean
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
  notice,
  noticeText,
  t,
}: CommunityNoticesProps) {
  return (
    <>
      {bandUnresolvedReason && (
        <div
          data-testid="community-band-unresolved"
          className="flex flex-col gap-2 rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-3 text-xs text-[color:var(--theme-card-text)]"
        >
          <p>{t(`community.band.unresolved.${bandUnresolvedReason}`)}</p>
          {bandUnresolvedReason === 'no_location' && canAddLocation && (
            <Link
              href={COMMUNITY_ADD_LOCATION_HREF}
              className="inline-flex min-h-[44px] items-center self-start font-semibold underline"
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
          style={
            notice.tone === 'error' ? { color: MERLOT, borderColor: MERLOT } : undefined
          }
          className={`rounded-[8px] border p-3 text-xs ${NOTICE_CLASSES[notice.tone]}`}
        >
          {noticeText}
        </p>
      )}
    </>
  )
}

interface CommunityFeedStatesProps {
  isLoading: boolean
  errorText: string | null
  itemCount: number
  gridColumns: string
  canShare: boolean
  onRetry: () => void
  onShare: () => void
  t: Translate
}

function CommunityFeedStates({
  isLoading,
  errorText,
  itemCount,
  gridColumns,
  canShare,
  onRetry,
  onShare,
  t,
}: CommunityFeedStatesProps) {
  return (
    <>
      {errorText !== null && (
        <div
          role="alert"
          data-testid="community-feed-error"
          style={{ color: MERLOT, borderColor: MERLOT }}
          className="flex items-center justify-between gap-3 rounded-[8px] border p-4 text-xs"
        >
          <span>{errorText}</span>
          <button
            type="button"
            data-testid="community-feed-retry-button"
            onClick={onRetry}
            style={{ backgroundColor: MERLOT }}
            className="min-h-[44px] rounded-md px-3 py-1 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
              className="h-72 animate-pulse rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-5"
            />
          ))}
        </div>
      )}

      {!isLoading && errorText === null && itemCount === 0 && (
        <div
          data-testid="community-feed-empty"
          className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-10 text-center"
        >
          <p className="text-sm font-semibold text-[color:var(--theme-card-text)]">
            {t('community.feed.emptyTitle')}
          </p>
          <p className="mt-1 text-xs text-neutral-600">{t('community.feed.emptyBody')}</p>
          {canShare && (
            <button
              type="button"
              data-testid="community-feed-empty-share-button"
              onClick={onShare}
              className="mt-4 min-h-[44px] rounded-full bg-[#C9A14A] px-5 py-2 text-xs font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
  isLoading: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  t: Translate
}

function LoadMoreControl({
  nextCursor,
  isLoading,
  isLoadingMore,
  onLoadMore,
  t,
}: LoadMoreControlProps) {
  if (nextCursor === null || isLoading) {
    return null
  }
  return (
    <div className="flex justify-center pt-2">
      <button
        type="button"
        data-testid="load-more-button"
        disabled={isLoadingMore}
        onClick={onLoadMore}
        className="min-h-[44px] rounded-full border border-[color:var(--theme-secondary)] px-6 py-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--theme-card-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] disabled:opacity-50"
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
  /**
   * Reports the band the server resolved for the viewer.
   *
   * `lookbook-prism-layout.tsx` renders a SECOND `LookbookFilterNav` outside
   * this component, and only this component ever sees the feed response. Without
   * this the two navs on the same page answer "which climate am I seeing"
   * differently -- one naming the band, the other saying "Your climate" -- which
   * is a contradiction the reader has to resolve rather than a cosmetic gap.
   */
  onViewerBandChange?: (band: ClimateBand | null) => void
  /**
   * Reports the mode the server actually SERVED, which is not always the one
   * that was requested: the beta experiment resolves a `auto` request to the
   * viewer's arm, so half the cohort asks for `auto` and is served `all`.
   *
   * Exists for the same reason as {@link onViewerBandChange}. Only this
   * component sees the feed response, and `lookbook-prism-layout.tsx` renders a
   * second `LookbookFilterNav` outside it, so without this that nav shows the
   * `auto` chip pressed over a feed carrying every region.
   */
  onServedModeChange?: (mode: CommunityFeedMode) => void
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
      className="rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-3 text-xs text-[color:var(--theme-card-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
    >
      {t(notice.key)}
    </p>
  )
}

function communityPresentation(
  available: boolean,
  hasSession: boolean,
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
    settingsHref: hasSession ? '/notification-settings' : '/signin',
    settingsLabel: hasSession
      ? 'community.notifications.title'
      : 'community.notifications.signin',
  }
}

export function CommunityLookbookGrid({
  activeTab = 'auto',
  onTabChange,
  isMobilePreview = false,
  chipCategory = 'Personal',
  highlightedCardId,
  showFilterNav = false,
  onViewerBandChange,
  onServedModeChange,
  spotlightFocusIntent,
}: CommunityLookbookGridProps) {
  const { t, i18n } = useCommunityTranslation()
  const locale = useResolvedLocale(i18n.language)

  const [currentMode, setCurrentMode] = useState<FilterCategory>(activeTab)
  /**
   * The mode the server said it served, or `null` while the request that would
   * answer that is still in flight. Distinct from `currentMode`, which is what
   * the reader asked for and what the next request sends: a `auto` request is
   * resolved to the viewer's experiment arm, so half the cohort asks for `auto`
   * and is served `all`.
   */
  const [servedMode, setServedMode] = useState<CommunityFeedMode | null>(null)
  const [communityAvailable, setCommunityAvailable] = useState(true)
  const [newLooks, setNewLooks] = useState<CommunityFeedItem[]>([])
  const newLooksRef = useRef(newLooks)
  newLooksRef.current = newLooks
  // Advances whenever the feed's scope (filter or session) changes. Buffered looks and an
  // insertion under way belong to the scope they started in.
  const feedScopeRef = useRef(0)
  const [isInsertingLooks, setIsInsertingLooks] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  // The cards the grid rendered last, so a D3 hide can capture where the reader was.
  const renderedItemsRef = useRef<CommunityFeedItem[]>([])
  const { capture: captureScroll, restore: restoreScroll } = useCommunityScrollRestore({
    grid: gridRef,
    scope: feedScopeRef,
  })

  const [items, setItems] = useState<CommunityFeedItem[]>([])
  const [authorStates, setAuthorStates] = useState<CommunityAuthorPostState[]>([])
  const [viewerBand, setViewerBand] = useState<ClimateBand | null>(null)
  const [bandResolved, setBandResolved] = useState(true)
  const [bandUnresolvedReason, setBandUnresolvedReason] =
    useState<CommunityBandUnresolvedReason | null>(null)
  /**
   * The arm this client was serving, held so a card-open can be attributed to
   * the feed the viewer actually saw. `null` until a feed lands, and no card can
   * be opened before then, so there is never a default to invent.
   */
  const [experimentVariant, setExperimentVariant] =
    useState<CommunityExperimentVariant | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
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
  const [activeChallenge, setActiveChallenge] =
    useState<EmbeddedCommunityChallenge | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState<Message | null>(null)
  const [announcement, setAnnouncement] = useState<Message | null>(null)
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
  const [hasSession, setHasSession] = useState(false)
  const [sessionScope, setSessionScope] = useState<string | null>(null)
  const sessionScopeRef = useRef<string | null | undefined>(undefined)

  // Story 6.6: the City Spotlight heads this section. Its pages run through the
  // same reaction state as the feed, and its one View more announcement goes
  // through this surface's single live region.
  // Story 6.7b: each spotlight read carries its reaction ticket and its
  // sponsorship stamp, both taken as the read starts, in the token the hook
  // hands back with the page. Nothing is stored per read, so a failed, aborted
  // or superseded read leaves nothing behind.
  const spotlight = useCommunitySpotlight<{ ticket: number; stamp: LiveReadStamp }>({
    scope: sessionScope,
    beginRead: () => ({
      ticket: reactionState.beginRead(),
      stamp: liveSponsorships.begin(),
    }),
    reconcile: (page, { ticket, stamp }) => {
      applyLiveSponsorship(page, stamp)
      return page.flatMap((post) => {
        const current = reactionState.read(post, ticket)
        return current
          ? [{ ...withLiveSponsorship(current, liveSponsorships), rank: post.rank }]
          : []
      })
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
  /** Monotonic request id, so a late response for an abandoned filter is dropped. */
  const feedGenerationRef = useRef(0)
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
  const hasLoadedFeedRef = useRef(false)

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

  useEffect(() => {
    setHasSession(hasWebSession())
  }, [])

  useEffect(() => {
    setCurrentMode(activeTab)
  }, [activeTab])

  /**
   * The mode this surface presents itself as showing. The server's answer wins
   * once it has one, because `auto` is the arm the beta experiment varies and
   * half the viewers who ask for it are served `all`.
   */
  const displayedMode: CommunityFeedMode = servedMode ?? currentMode

  // Reported from an effect rather than from inside `loadFeed`, so the caller's
  // callback stays out of that callback's dependency list: a caller that passes
  // an inline arrow would otherwise re-fire the whole feed read on every render.
  useEffect(() => {
    onViewerBandChange?.(viewerBand)
  }, [onViewerBandChange, viewerBand])

  useEffect(() => {
    onServedModeChange?.(displayedMode)
  }, [onServedModeChange, displayedMode])

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
          const post = await getCommunityPostFromWeb(target, signal)
          if (!isCurrent()) return
          applyLiveSponsorship([post], stamp)
          const read = reactionState.read(post, readTicket)
          const live = () => (read ? withLiveSponsorship(read, liveSponsorships) : read)
          if (target === highlightedIdRef.current)
            setDeepLinkedItem(() => (loadedIds.has(target) ? null : live()))
          setOpenedItem((opened) => (opened?.id === target ? live() : opened))
        } catch (error: unknown) {
          if (isCurrent() && communityFailureReason(error) === 'not_found') {
            reactionState.evict(target)
            comments.evict(target)
          }
        }
      }
    },
    [applyLiveSponsorship, comments, liveSponsorships, reactionState]
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

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setFeedError(null)
        setNextCursor(null)
        setAnnouncement({ key: 'community.feed.loading' })
      }

      const stamp = liveSponsorships.begin()
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
        setNextCursor(feed.nextCursor)
        setFeedError(null)
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
        const merged =
          append && !restarted ? mergeFeedPages(itemsRef.current, page) : page
        const loadedIds = new Set(merged.map((post) => post.id))
        setDeepLinkedItem((post) =>
          post && !loadedIds.has(post.id) ? live(reactionState.current(post)) : null
        )
        setItems((previous) =>
          (append && !restarted ? mergeFeedPages(previous, page) : page).map((post) =>
            live(reactionState.current(post))
          )
        )
        setAnnouncement({
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
        })
        await revalidateHighlighted(
          detailRevalidationTargets(
            highlightedIdRef.current,
            openedItemRef.current,
            hasLoadedFeedRef.current
          ),
          readTicket,
          controller.signal,
          generation,
          loadedIds
        )
        hasLoadedFeedRef.current = true
      } catch (error: unknown) {
        if (controller.signal.aborted || generation !== feedGenerationRef.current) {
          return
        }
        const message = messageForError(
          error,
          'community.error.load',
          languageRef.current
        )
        setFeedError(message)
        setAnnouncement(message)
      } finally {
        if (!controller.signal.aborted && generation === feedGenerationRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [applyLiveSponsorship, liveSponsorships, reactionState, revalidateHighlighted]
  )

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
      // A teaser intent and its notice belong to the member who tapped it.
      setPendingFocus(null)
      setSpotlightNotice(null)
      setItems([])
      itemsRef.current = []
      setAuthorStates([])
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
      setHasSession(hasWebSession())
      setSessionScope(identity)
      if (previous !== undefined && previous !== identity) {
        clearScope()
        if (identity) void loadFeed(modeRef.current)
      }
    }
    const erase = () => {
      comments.reset()
      clearScope()
    }
    syncSession()
    const timer = setInterval(syncSession, 1000)
    window.addEventListener('storage', syncSession)
    window.addEventListener('couture:session', syncSession)
    window.addEventListener('couture:account-erased', erase)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', syncSession)
      window.removeEventListener('couture:session', syncSession)
      window.removeEventListener('couture:account-erased', erase)
    }
  }, [comments, reactionState, loadFeed, resetSpotlight, liveSponsorships])

  useEffect(() => {
    // Cleared alongside the request, so the chips answer with the mode just
    // clicked while the server is deciding what to serve for it, and correct
    // themselves when it answers. Holding the previous served mode instead would
    // leave the click looking like it did nothing.
    setServedMode(null)
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
    const buffered = newLooksRef.current
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
      setItems((previous) => [
        ...new Map(
          [
            ...fresh.map((post) => withLiveSponsorship(post, liveSponsorships)),
            ...previous,
          ].map((post) => [post.id, post])
        ).values(),
      ])
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
      const page = await getCommunityFeedFromWeb({
        mode: currentMode,
        limit: FEED_PAGE_SIZE,
        signal,
      })
      if (!active) return
      if (signal?.aborted) throw new CommunityRequestSuperseded()
      if (generation !== feedGenerationRef.current) throw new CommunityRequestSuperseded()
      // Rows already shown stay where they are, but their blocks follow this read.
      applyLiveSponsorship(page.items, stamp)
      const live = <T extends CommunityFeedItem>(post: T): T =>
        withLiveSponsorship(post, liveSponsorships)
      setAuthorStates(page.authorStates)
      setNextCursor(page.nextCursor)
      setServedMode(page.mode)
      setViewerBand(page.viewerBand)
      setActiveChallenge(page.activeChallenge)
      setIsLoadingMore(false)
      setIsLoading(false)

      const existing = new Set(itemsRef.current.map((item) => item.id))
      const incoming = page.items.filter((item) => !existing.has(item.id))
      if (!itemsRef.current.length) setItems(() => page.items.map(live))
      else if (incoming.length) {
        const buffered = mergeFeedPages(incoming, newLooksRef.current).map(live)
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
    // D3: shown content outlives a reconnect only while access was verified recently.
    // Once that lapses, the content hides and the outage is announced (D9).
    const hideContent = () => {
      captureScroll(renderedItemsRef.current)
      setCommunityAvailable(false)
    }
    const verification = new CommunityVerification(() => {
      if (!active) return
      hideContent()
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
          reactionState.evict(target.key)
          comments.evict(target.key)
          setItems((previous) => previous.filter((item) => item.id !== target.key))
          setOpenedItem((item) => (item?.id === target.key ? null : item))
          setDeepLinkedItem((item) => (item?.id === target.key ? null : item))
          applySpotlight((item) => (item?.id === target.key ? null : item))
          return
        }
        const resolved = reactionState.read(target.post, reactionState.beginRead())
        if (!resolved) return
        // Story 6.7b: the target resolve does not opt in to sponsorship, so the
        // post carries the latest live answer for it, block or absence, on
        // every copy, the New looks buffer included.
        const updated = withLiveSponsorship(resolved, liveSponsorships)
        newLooksRef.current = newLooksRef.current.map((item) =>
          item.id === target.post.id ? updated : item
        )
        setNewLooks(newLooksRef.current)
        const update = (item: CommunityFeedItem | null) =>
          item?.id === target.post.id ? updated : item
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
        if (state === 'connected') setCommunityAvailable(true)
        else if (!visible) hideContent()
        if (verify) void realtimeSyncRef.current?.catchUp()
        // The outage notice clears only once verified content is visible again.
        if (state === 'connected')
          setNotice((previous) =>
            previous?.message.key === 'community.realtime.unavailable' ? null : previous
          )
        else if (state === 'unavailable') setNotice(outage)
        if (state !== 'connected' && state !== 'recovering') {
          feedGenerationRef.current++
          detailGenerationRef.current++
          setIsLoading(false)
          setIsLoadingMore(false)
          feedControllerRef.current?.abort()
        }
        if (state === 'denied') {
          actionControllerRef.current?.abort()
          setIsSubmittingReport(false)
          setIsPreparingPhoto(false)
          setIsPublishing(false)
          comments.reset()
          reactionState.reset()
          resetSpotlight()
          liveSponsorships.clear()
          setItems([])
          setOpenedItem(null)
          setNewLooks([])
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
    liveSponsorships,
    comments,
    currentMode,
    sessionScope,
    reactionState,
    applySpotlight,
    resetSpotlight,
    captureScroll,
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
            setDeepLinkedItem(() =>
              read ? withLiveSponsorship(read, liveSponsorships) : read
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
            return result
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
      .then((result) => {
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
        // A resolve copy: it takes the latest live answer for its post.
        setOpenedItem(() => withLiveSponsorship(post, liveSponsorships))
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
  }, [sessionScope, highlightedCardId, reactionState, comments, liveSponsorships])

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

  const focusedTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightedCardId) {
      focusedTargetRef.current = null
      return
    }
    if (focusedTargetRef.current === highlightedCardId) return
    const cardElement = document.getElementById(`lookbook-card-${highlightedCardId}`)
    if (cardElement) {
      focusedTargetRef.current = highlightedCardId
      cardElement.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      cardElement.focus()
      setAnnouncement({ key: 'community.feed.announceFocused' })
    }
  }, [highlightedCardId, displayedItems])

  const handleModeChange = (mode: FilterCategory) => {
    setCurrentMode(mode)
    setNotice(null)
    setAnnouncement({ key: 'community.filters.announce', params: { filterMode: mode } })
    onTabChange?.(mode)
  }

  const handleLoadMore = () => {
    if (nextCursor && !isLoadingMore) {
      void loadFeed(currentMode, nextCursor)
    }
  }

  const handleRetry = () => {
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
  const showDetail = (
    item: CommunityFeedItem,
    commentsFocus: boolean,
    surface: AffiliateCommunitySurface
  ) => {
    notificationIntentRef.current++
    setDetailSurface(surface)
    setFocusComments(commentsFocus)
    setAnnouncement(null)
    setReactionFeedback(null)
    setOpenedItem(reactionState.current(item))
  }

  const handleOpenCard = (
    item: CommunityFeedItem,
    commentsFocus = false,
    surface: AffiliateCommunitySurface = 'community_feed'
  ) => {
    showDetail(item, commentsFocus, surface)
    if (commentsFocus || experimentVariant === null) {
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
    showDetail(post, false, 'community_spotlight')
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

  const handleWithdrawPost = async (postId: string): Promise<void> => {
    if (!communityAvailable) return
    const action = beginAction()
    try {
      await withdrawCommunityPostFromWeb(postId, action.signal)
      if (action.signal.aborted) return
      // No optimistic removal: `items` is published rows only, and a withdrawn
      // post moves to `authorStates` on the next read. Filtering it out locally
      // is what made it reappear on the following refresh.
      const message: Message = { key: 'community.removed.withdrawn' }
      setNotice({ message, tone: 'success' })
      setAnnouncement(message)
      // The spotlight ranks public posts only and never serves a withdrawn one
      // again, so its copy leaves now rather than on the next page-one read.
      applySpotlight((item) => (item?.id === postId ? null : item))
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
    setIsCreateModalOpen(false)
    setComposeError(null)
    setAllocated(null)
    setIsPreparingPhoto(false)
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  const openCreateModal = () => {
    if (!communityAvailable) return
    setComposeError(null)
    setNotice(null)
    setIsCreateModalOpen(true)
  }

  const handleSelectPhoto = async (file: File): Promise<void> => {
    if (!communityAvailable) return
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
  const spotlightItems = spotlight.state.items
  const focusSpotlightEntry = spotlight.focusEntry
  useEffect(() => {
    if (!pendingFocus) return
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
    pendingFocus,
    spotlightItems,
    spotlightLevel,
    spotlightStatus,
  ])

  const presentation = communityPresentation(
    communityAvailable,
    hasSession,
    displayedItems,
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

  const { shareHost, shareDialog } = useCommunityShareHost(
    presentation.items,
    presentation.detail,
    presentation.canAct
  )

  return (
    <ShareCardHostContext.Provider value={shareHost}>
      <aside aria-label={t('community.sectionLabel')} className="flex flex-col gap-6">
        <SpotlightFocusNotice notice={spotlightNotice} t={t} />
        <CommunitySpotlightSection
          state={spotlight.state}
          available={communityAvailable}
          isMobilePreview={isMobilePreview}
          t={t}
          onLoadMore={() => {
            void spotlight.loadMore()
          }}
          onRetry={() => {
            void spotlight.retry()
          }}
          onFocused={spotlight.clearFocusTarget}
          renderCard={(item) => (
            <LookbookCard
              scope={SPOTLIGHT_CARD_SCOPE}
              reactionControls={reactionState.controls(item.id)}
              item={item}
              isHighlighted={false}
              isFailedImage={
                failedImages.spotlight[item.id]?.url === item.imageAccess.url
              }
              isReported={reportedPostIds.has(item.id)}
              canAct={presentation.canAct}
              t={t}
              sponsored={sponsoredHost('community_spotlight')}
              onImageError={handleSpotlightImageError}
              onImageRetry={handleSpotlightImageRetry}
              onOpen={() => {
                handleOpenSpotlightCard(item)
              }}
              onComments={(post) => handleOpenCard(post, true, 'community_spotlight')}
              onReport={(postId) => {
                setReportError(null)
                setReportingPostId(postId)
              }}
              onWithdraw={(postId) => {
                void handleWithdrawPost(postId)
              }}
            />
          )}
        />

        {showFilterNav && (
          <LookbookFilterNav
            activeTab={displayedMode}
            isMobilePreview={isMobilePreview}
            onTabChange={handleModeChange}
            viewerBand={viewerBand}
          />
        )}

        <Link
          href={presentation.settingsHref}
          className="min-h-12 self-start py-3 underline"
        >
          {t(presentation.settingsLabel)}
        </Link>
        <CommunityHeader canShare={presentation.canAct} onShare={openCreateModal} t={t} />

        <CommunityNotices
          bandUnresolvedReason={bandNoticeReason}
          canAddLocation={hasSession}
          notice={notice}
          noticeText={renderMessage(notice?.message ?? null, t, viewerBand)}
          t={t}
        />

        {activeChallenge && (
          <WeeklyChallengeBanner
            challenge={activeChallenge}
            language={i18n.language}
            t={t}
            onParticipate={openCreateModal}
          />
        )}

        <CommunityFeedStates
          isLoading={isLoading}
          errorText={renderMessage(feedError, t, viewerBand)}
          itemCount={displayedItems.length}
          gridColumns={gridColumns}
          canShare={presentation.canAct}
          onRetry={handleRetry}
          onShare={openCreateModal}
          t={t}
        />

        <div
          ref={gridRef}
          data-testid="community-card-grid"
          data-chip-category={chipCategory}
          aria-busy={isLoading || isLoadingMore}
          className={`grid gap-6 ${gridColumns}`}
        >
          {presentation.items.map((item) => (
            <LookbookCard
              reactionControls={reactionState.controls(item.id)}
              key={item.id}
              item={item}
              isHighlighted={item.id === highlightedCardId}
              isFailedImage={failedImages.feed[item.id]?.url === item.imageAccess.url}
              isReported={reportedPostIds.has(item.id)}
              canAct={presentation.canAct}
              t={t}
              sponsored={sponsoredHost('community_feed')}
              onImageError={handleImageError}
              onImageRetry={handleImageRetry}
              onOpen={handleOpenCard}
              onComments={(item) => handleOpenCard(item, true)}
              onReport={(postId) => {
                setReportError(null)
                setReportingPostId(postId)
              }}
              onWithdraw={(postId) => {
                void handleWithdrawPost(postId)
              }}
            />
          ))}
        </div>

        {presentation.showNewLooks && (
          <button
            type="button"
            className="rounded-full border px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
            disabled={isInsertingLooks}
            onClick={() => {
              void insertNewLooks()
            }}
          >
            {t('community.realtime.showNewLooks', { count: newLooks.length })}
          </button>
        )}
        <AuthorStatesSection states={presentation.authorStates} t={t} />

        <LoadMoreControl
          nextCursor={presentation.nextCursor}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
          t={t}
        />

        {/* The one polite live region on this surface. */}
        <div
          aria-live="polite"
          role="status"
          data-testid="community-live-region"
          className="sr-only"
        >
          <span key={announcement?.announcementId}>
            {openedItem ? null : renderMessage(announcement, t, viewerBand)}
          </span>
        </div>

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
            isPreparing={isPreparingPhoto}
            isPublishing={isPublishing}
            activeChallenge={activeChallenge}
            errorMessage={renderMessage(composeError, t, viewerBand)}
            t={t}
          />
        )}
        {shareDialog}
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
  canAct: boolean
) {
  const [share, setShare] = useState<{ postId: string; open: boolean } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const postId = useRef<string | null>(null)
  postId.current = share?.postId ?? null
  const shareHost = useMemo<ShareCardHost>(
    () => ({
      open: (target, element) => {
        opener.current = element
        setShare({ postId: target, open: true })
      },
      register: (target, element) => {
        if (element && target === postId.current) opener.current = element
      },
    }),
    []
  )
  const item = share
    ? (items.find((candidate) => candidate.id === share.postId) ??
      (detail?.id === share.postId ? detail : null))
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
