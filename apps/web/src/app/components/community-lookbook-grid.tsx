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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  communityPostCaptionSchema,
  communityReportReasonSchema,
  defaultSupportedLocale,
  supportedLocaleSchema,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityExperimentVariant,
  type CommunityFeed,
  type CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityReportReason,
  type EmbeddedCommunityChallenge,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import {
  allocateCommunityLookFromWeb,
  communityFailureReason,
  communityRetryAfterSeconds,
  generateIdempotencyKey,
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  hasWebSession,
  openCommunityPostFromWeb,
  publishCommunityLookFromWeb,
  reportCommunityPostFromWeb,
  withdrawCommunityPostFromWeb,
  type CommunityFailureReason,
} from '../../lib/community'
import { getI18n } from '../../i18n'
import { AccessibleModal } from './accessible-modal'
import { CHIP_NAVIGATION_HEIGHT_PX } from './chip-navigation'
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
      <h2 className="lookbook-display text-2xl font-semibold text-[color:var(--theme-primary)]">
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
            ? 'border-[color:var(--theme-secondary)] font-bold text-[color:var(--theme-primary)] underline underline-offset-4'
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
              className={`min-h-[44px] whitespace-nowrap border-b-2 px-3 py-2 text-xs uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] ${tabletStyles} ${activeStyles}`}
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
            className="lookbook-metrics rounded bg-[var(--theme-secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--theme-primary)]"
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
          className="min-h-[44px] rounded-full bg-[var(--theme-secondary)] px-5 py-2 text-xs font-semibold text-[color:var(--theme-primary)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] motion-safe:transition-colors"
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
  item: CommunityFeedItem
  isFailedImage: boolean
  isSponsored: boolean
  t: Translate
  onImageError: (item: CommunityFeedItem) => void
  onImageRetry: (item: CommunityFeedItem) => void
  onOpen: (item: CommunityFeedItem) => void
}

function LookbookCardImageSurface({
  item,
  isFailedImage,
  isSponsored,
  t,
  onImageError,
  onImageRetry,
  onOpen,
}: LookbookCardImageSurfaceProps) {
  const authorName = authorNameOf(item, t)
  const altText = altTextOf(item, authorName, t)

  return (
    <div
      data-testid={`lookbook-image-${item.id}`}
      className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-[var(--theme-card-bg)]"
    >
      {isFailedImage ? (
        <div
          data-testid={`image-unavailable-${item.id}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--theme-card-bg)] p-4 text-center"
        >
          <span className="text-xs font-medium text-neutral-600">
            {t('community.card.imageUnavailable')}
          </span>
          <button
            type="button"
            data-testid={`image-retry-button-${item.id}`}
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
          data-testid={`lookbook-open-${item.id}`}
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

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        {/*
         * One band badge, not two. The old surface carried a `location-badge`
         * beside this one, but `communityFeedItemSchema` publishes no location:
         * authors are pseudonymous and the spec forbids exposing anything that
         * would place them, so the second badge had nothing real to show.
         */}
        <span
          data-testid={`climate-badge-${item.id}`}
          className="lookbook-metrics rounded-md bg-[var(--theme-secondary)] px-2.5 py-1 text-[10px] font-semibold uppercase text-[color:var(--theme-primary)]"
        >
          {bandLabel(item.climateBand, t)}
        </span>
        {item.status !== 'published' && (
          <span
            data-testid={`status-badge-${item.id}`}
            className="lookbook-metrics rounded-md border border-[color:var(--theme-card-border)] bg-white/95 px-2 py-0.5 text-[9px] font-medium uppercase text-[color:var(--theme-card-text)]"
          >
            {t(`community.status.${item.status}`)}
          </span>
        )}
        {isSponsored && (
          <span
            data-testid={`sponsored-badge-${item.id}`}
            className="lookbook-metrics rounded-md border border-[color:var(--theme-secondary)] bg-white/95 px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--theme-card-text)]"
          >
            <span aria-hidden="true">{t('community.card.sponsored')}</span>
            <span className="sr-only">{t('community.card.sponsoredAnnounce')}</span>
          </span>
        )}
      </div>
    </div>
  )
}

interface LookbookCardContentProps {
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
        <h3 id={`lookbook-card-title-${item.id}`} className="sr-only">
          {t('community.card.label', { author: authorName })}
        </h3>
        <span
          data-testid={`author-name-${item.id}`}
          className="lookbook-metrics block text-xs font-semibold text-[color:var(--theme-card-text)]"
        >
          {authorName}
        </span>

        {item.caption && (
          <p
            data-testid={`caption-${item.id}`}
            className="text-xs leading-relaxed text-neutral-600 line-clamp-3"
          >
            {item.caption}
          </p>
        )}
      </div>

      {canAct && (
        <div className="flex items-center gap-3 border-t border-[color:var(--theme-card-border)] pt-3 text-xs">
          {item.author.isSelf ? (
            <button
              type="button"
              data-testid={`withdraw-button-${item.id}`}
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
              data-testid={`report-button-${item.id}`}
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
  item: CommunityFeedItem
  isHighlighted: boolean
  isFailedImage: boolean
  isReported: boolean
  isSponsored: boolean
  canAct: boolean
  t: Translate
  onImageError: (item: CommunityFeedItem) => void
  onImageRetry: (item: CommunityFeedItem) => void
  onOpen: (item: CommunityFeedItem) => void
  onReport: (postId: string) => void
  onWithdraw: (postId: string) => void
}

function LookbookCard({
  item,
  isHighlighted,
  isFailedImage,
  isReported,
  isSponsored,
  canAct,
  t,
  onImageError,
  onImageRetry,
  onOpen,
  onReport,
  onWithdraw,
}: LookbookCardProps) {
  return (
    <article
      id={`lookbook-card-${item.id}`}
      data-testid={`lookbook-card-${item.id}`}
      tabIndex={-1}
      aria-labelledby={`lookbook-card-title-${item.id}`}
      data-highlighted={isHighlighted ? 'true' : 'false'}
      className={`flex flex-col overflow-hidden rounded-[8px] border bg-[var(--theme-card-bg)] text-[color:var(--theme-card-text)] shadow-sm motion-safe:transition-[border-color,box-shadow] motion-safe:duration-300 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] ${
        isHighlighted
          ? 'border-[color:var(--theme-secondary)] outline outline-2 outline-[color:var(--theme-primary)] ring-2 ring-[color:var(--theme-secondary)] ring-offset-2 shadow-lg'
          : 'border-[color:var(--theme-card-border)]'
      }`}
    >
      <LookbookCardImageSurface
        item={item}
        isFailedImage={isFailedImage}
        isSponsored={isSponsored}
        t={t}
        onImageError={onImageError}
        onImageRetry={onImageRetry}
        onOpen={onOpen}
      />
      <LookbookCardContent
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

interface LookbookDetailDialogProps {
  item: CommunityFeedItem
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
function LookbookDetailDialog({ item, t, onClose }: LookbookDetailDialogProps) {
  const authorName = authorNameOf(item, t)

  return (
    <AccessibleModal
      isOpen
      onClose={onClose}
      title={t('community.card.label', { author: authorName })}
      titleId="community-detail-title"
      closeLabel={t('community.card.detailClose')}
    >
      <div data-testid="community-detail" className="flex flex-col gap-4">
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
            className="lookbook-metrics rounded-md bg-[var(--theme-secondary)] px-2.5 py-1 text-[10px] font-semibold uppercase text-[color:var(--theme-primary)]"
          >
            {bandLabel(item.climateBand, t)}
          </span>
          <span
            data-testid="community-detail-author"
            className="lookbook-metrics text-xs font-semibold text-[color:var(--theme-card-text)]"
          >
            {authorName}
          </span>
        </div>

        {item.caption && (
          <p
            data-testid="community-detail-caption"
            className="text-xs leading-relaxed text-neutral-600"
          >
            {item.caption}
          </p>
        )}
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
                  {t('community.status.reason', { reason: state.moderationReason })}
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
  onClose: () => void
  onSubmit: (reason: CommunityReportReason, details?: string) => void
  isSubmitting: boolean
  errorMessage?: string | null
  t: Translate
}

function CommunityReportModal({
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
            className="w-full text-xs text-neutral-600 file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-[var(--theme-secondary)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
            className="min-h-[44px] rounded-full bg-[var(--theme-secondary)] px-5 py-2 text-xs font-semibold text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
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
          className="min-h-[44px] rounded-full bg-[var(--theme-secondary)] px-4 py-1.5 text-xs font-semibold text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)] motion-safe:transition-colors"
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

interface CommunityNoticesProps {
  bandUnresolvedReason: CommunityBandUnresolvedReason | null
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
  notice,
  noticeText,
  t,
}: CommunityNoticesProps) {
  return (
    <>
      {bandUnresolvedReason && (
        <p
          data-testid="community-band-unresolved"
          className="rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-3 text-xs text-[color:var(--theme-card-text)]"
        >
          {t(`community.band.unresolved.${bandUnresolvedReason}`)}
        </p>
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
              className="mt-4 min-h-[44px] rounded-full bg-[var(--theme-secondary)] px-5 py-2 text-xs font-semibold text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]"
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
   * Posts that carry a paid placement. The feed contract has no sponsorship
   * field, so the only honest source is the caller; a card never claims a
   * commercial relationship the server did not state.
   */
  sponsoredPostIds?: readonly string[]
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
}

export function CommunityLookbookGrid({
  activeTab = 'auto',
  onTabChange,
  isMobilePreview = false,
  chipCategory = 'Personal',
  highlightedCardId,
  showFilterNav = false,
  sponsoredPostIds,
  onViewerBandChange,
  onServedModeChange,
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
  const [openedItem, setOpenedItem] = useState<CommunityFeedItem | null>(null)
  const [activeChallenge, setActiveChallenge] =
    useState<EmbeddedCommunityChallenge | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState<Message | null>(null)
  const [announcement, setAnnouncement] = useState<Message | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, FailedImage>>({})
  const [hasSession, setHasSession] = useState(false)

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
  const itemsRef = useRef(items)

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
  const loadFeed = useCallback(async (mode: CommunityFeedMode, cursor?: string) => {
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
      setFailedImages((previous) => pruneFailedImages(previous, feed.items))
      if (append && !restarted) {
        // Counted from what the merge actually appends, not from the page size:
        // `mergeFeedPages` drops rows the previous page already carried, so
        // announcing `feed.items.length` told a screen-reader reader that more
        // looks had arrived than were added. Read off the ref rather than from
        // inside the updater, because a state setter is not a place for a side
        // effect.
        const merged = mergeFeedPages(itemsRef.current, feed.items)
        setItems(merged)
        setAnnouncement({
          key: 'community.feed.announceLoadedMore',
          params: { count: merged.length - itemsRef.current.length },
        })
      } else {
        setItems(feed.items)
        setAnnouncement({
          // The mode SERVED, not the mode asked for. A viewer in the `all` arm
          // who requests `auto` is otherwise told "Showing Your climate: Cold and
          // dry looks" over a feed carrying every region.
          key: 'community.feed.announceLoaded',
          params: { filterMode: feed.mode, count: feed.items.length },
        })
      }
    } catch (error: unknown) {
      if (controller.signal.aborted || generation !== feedGenerationRef.current) {
        return
      }
      const message = messageForError(error, 'community.error.load', languageRef.current)
      setFeedError(message)
      setAnnouncement(message)
    } finally {
      if (!controller.signal.aborted && generation === feedGenerationRef.current) {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    // Cleared alongside the request, so the chips answer with the mode just
    // clicked while the server is deciding what to serve for it, and correct
    // themselves when it answers. Holding the previous served mode instead would
    // leave the click looking like it did nothing.
    setServedMode(null)
    void loadFeed(currentMode)
  }, [currentMode, loadFeed])

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
    if (highlightedCardId && !items.some((item) => item.id === highlightedCardId)) {
      void getCommunityPostFromWeb(highlightedCardId, controller.signal)
        .then((post) => {
          if (!cancelled) {
            setDeepLinkedItem(post)
          }
        })
        .catch(() => {
          // A target withdrawn between the link being followed and this read is
          // an expected outcome, and `processWebDeepLink` owns the invalid-link
          // copy, so nothing is reported from here.
          if (!cancelled) {
            setDeepLinkedItem(null)
          }
        })
    } else {
      setDeepLinkedItem(null)
    }
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [highlightedCardId, items])

  /**
   * The rows on screen: the loaded pages, with a deep-link target that is not
   * among them carried at the head. `mergeFeedPages` is what keeps the row from
   * appearing twice once paging reaches the page it really belongs to.
   */
  const displayedItems = useMemo(
    () => (deepLinkedItem ? mergeFeedPages([deepLinkedItem], items) : items),
    [deepLinkedItem, items]
  )

  useEffect(() => {
    if (!highlightedCardId) return
    const cardElement = document.getElementById(`lookbook-card-${highlightedCardId}`)
    if (cardElement) {
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
  const handleOpenCard = (item: CommunityFeedItem) => {
    setOpenedItem(item)
    if (experimentVariant === null) {
      return
    }
    void openCommunityPostFromWeb(item.id, experimentVariant).catch(() => undefined)
  }

  const handleImageError = useCallback(
    (item: CommunityFeedItem) => {
      const url = item.imageAccess.url
      const previous = failedImagesRef.current[item.id]
      const attempts = previous?.url === url ? previous.attempts : 0
      setFailedImages((current) => ({
        ...current,
        [item.id]: { url, attempts: attempts + 1 },
      }))
      if (attempts < MAX_AUTOMATIC_IMAGE_REFETCHES) {
        void loadFeed(modeRef.current)
      }
    },
    [loadFeed]
  )

  const handleImageRetry = useCallback(
    (item: CommunityFeedItem) => {
      setFailedImages((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      void loadFeed(modeRef.current)
    },
    [loadFeed]
  )

  const beginAction = (): AbortController => {
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
    if (!reportingPostId) return
    const postId = reportingPostId
    setIsSubmittingReport(true)
    setReportError(null)
    try {
      await reportCommunityPostFromWeb(postId, reason, details, beginAction().signal)
      settleReported(postId, { key: 'community.report.success' }, 'success')
    } catch (error: unknown) {
      setReportError(
        messageForError(error, 'community.error.report', languageRef.current)
      )
    } finally {
      setIsSubmittingReport(false)
    }
  }

  const handleWithdrawPost = async (postId: string): Promise<void> => {
    try {
      await withdrawCommunityPostFromWeb(postId, beginAction().signal)
      // No optimistic removal: `items` is published rows only, and a withdrawn
      // post moves to `authorStates` on the next read. Filtering it out locally
      // is what made it reappear on the following refresh.
      const message: Message = { key: 'community.removed.withdrawn' }
      setNotice({ message, tone: 'success' })
      setAnnouncement(message)
      await loadFeed(modeRef.current)
    } catch (error: unknown) {
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
    setComposeError(null)
    setNotice(null)
    setIsCreateModalOpen(true)
  }

  const handleSelectPhoto = async (file: File): Promise<void> => {
    const preview = URL.createObjectURL(file)
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return preview
    })
    setAllocated(null)
    setComposeError(null)
    setIsPreparingPhoto(true)
    const idempotencyKey = generateIdempotencyKey()
    try {
      const session = await allocateCommunityLookFromWeb({
        imagePreview: preview,
        locale,
        idempotencyKey,
        signal: beginAction().signal,
      })
      setAllocated({ ...session, idempotencyKey })
    } catch (error: unknown) {
      setComposeError(
        messageForError(error, 'community.error.upload', languageRef.current)
      )
    } finally {
      setIsPreparingPhoto(false)
    }
  }

  const handlePublishPost = async (params: {
    altText: string
    caption?: string
    challengeId?: string | null
  }): Promise<void> => {
    if (!allocated) {
      setComposeError({ key: 'community.validation.photoRequired' })
      return
    }
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
        signal: beginAction().signal,
      })
      closeCreateModal()
      const message: Message = { key: 'community.compose.success' }
      setNotice({ message, tone: 'success' })
      setAnnouncement(message)
      // The new post is `pending_review`, so it lands in `authorStates` rather
      // than in the published grid. Re-read instead of inserting it locally.
      await loadFeed(modeRef.current)
    } catch (error: unknown) {
      setComposeError(
        messageForError(error, 'community.error.publish', languageRef.current)
      )
    } finally {
      setIsPublishing(false)
    }
  }

  const sponsored = useMemo(() => new Set(sponsoredPostIds ?? []), [sponsoredPostIds])
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

  return (
    <aside aria-label={t('community.sectionLabel')} className="flex flex-col gap-6">
      {showFilterNav && (
        <LookbookFilterNav
          activeTab={displayedMode}
          isMobilePreview={isMobilePreview}
          onTabChange={handleModeChange}
          viewerBand={viewerBand}
        />
      )}

      <CommunityHeader canShare={hasSession} onShare={openCreateModal} t={t} />

      <CommunityNotices
        bandUnresolvedReason={bandNoticeReason}
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
        canShare={hasSession}
        onRetry={handleRetry}
        onShare={openCreateModal}
        t={t}
      />

      <div
        data-testid="community-card-grid"
        data-chip-category={chipCategory}
        aria-busy={isLoading || isLoadingMore}
        className={`grid gap-6 ${gridColumns}`}
      >
        {displayedItems.map((item) => (
          <LookbookCard
            key={item.id}
            item={item}
            isHighlighted={item.id === highlightedCardId}
            isFailedImage={failedImages[item.id]?.url === item.imageAccess.url}
            isReported={reportedPostIds.has(item.id)}
            isSponsored={sponsored.has(item.id)}
            canAct={hasSession}
            t={t}
            onImageError={handleImageError}
            onImageRetry={handleImageRetry}
            onOpen={handleOpenCard}
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

      <AuthorStatesSection states={authorStates} t={t} />

      <LoadMoreControl
        nextCursor={nextCursor}
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
        {renderMessage(announcement, t, viewerBand)}
      </div>

      {openedItem !== null && (
        <LookbookDetailDialog
          item={openedItem}
          t={t}
          onClose={() => {
            setOpenedItem(null)
          }}
        />
      )}

      {reportingPostId !== null && (
        <CommunityReportModal
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
    </aside>
  )
}

/** Appends a page without duplicating a row the previous page already carried. */
function mergeFeedPages(
  previous: readonly CommunityFeedItem[],
  page: readonly CommunityFeedItem[]
): CommunityFeedItem[] {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...page.filter((item) => !seen.has(item.id))]
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
