'use client'

// Story 6.7 owner: the Home spotlight teaser inside the Hero Ritual Canvas, for
// stacked layouts only, and the layout-level lifecycle that survives its unmount.
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import Image from 'next/image'
import {
  SpotlightTeaserState,
  withRequestDeadline,
  type SpotlightTeaserValue,
} from '@couture/api-client'
import {
  communityCommentsSessionFromWeb,
  communityRetryAfterSeconds,
  getCommunitySpotlightFromWeb,
  openCommunitySpotlightPostFromWeb,
} from '../../lib/community'
import { spotlightCardElementId } from './community-spotlight'
import type { SpotlightFocusIntent } from './community-lookbook-grid'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** One teaser read waits at most this long, so a hung read never blocks the next. */
export const SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS = 10_000

/** How often the member is re-resolved, matching the community grid's session sync. */
const SESSION_SYNC_MS = 1000

/**
 * The member the grid spotlight reads for: the same session source, the same
 * one-second sync and the same session events. Undefined until mounted.
 */
function useCommunityMember(): string | null | undefined {
  const [member, setMember] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const sync = () => setMember(communityCommentsSessionFromWeb())
    sync()
    const timer = setInterval(sync, SESSION_SYNC_MS)
    window.addEventListener('storage', sync)
    window.addEventListener('couture:session', sync)
    window.addEventListener('couture:account-erased', sync)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', sync)
      window.removeEventListener('couture:session', sync)
      window.removeEventListener('couture:account-erased', sync)
    }
  }, [])
  return member
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return visible
}

export interface HomeSpotlightTeaserLifecycle {
  value: SpotlightTeaserValue | null
  removeValue: () => void
}

/**
 * Lives in the layout, so the value and its read time survive the teaser's
 * unmount when the layout leaves the stacked arrangement. Side-by-side layouts
 * are inactive and issue no teaser read; entering stacked is a trigger under
 * the shared 60-second floor, as is the page becoming visible again.
 */
export function useHomeSpotlightTeaser({
  stacked,
}: {
  stacked: boolean
}): HomeSpotlightTeaserLifecycle {
  const [state] = useState(
    () =>
      new SpotlightTeaserState({
        read: (signal) =>
          withRequestDeadline(SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS, [signal], (deadline) =>
            getCommunitySpotlightFromWeb({
              limit: 1,
              surface: 'home_teaser',
              signal: deadline,
            })
          ),
        retryAfterSeconds: communityRetryAfterSeconds,
      })
  )
  const value = useSyncExternalStore(state.subscribe, state.getSnapshot, () => null)
  const member = useCommunityMember()
  const visible = usePageVisible()

  useEffect(() => {
    state.setMember(member)
  }, [member, state])

  useEffect(() => {
    state.setActive(stacked && visible)
  }, [stacked, visible, state])

  useEffect(
    () => () => {
      state.setActive(false)
      state.setMember(null)
    },
    [state]
  )

  return { value, removeValue: state.removeValue }
}

export interface HomeSpotlightTeaserLink extends HomeSpotlightTeaserLifecycle {
  /** The latest activation, resolved in page by the community section. */
  focusIntent: SpotlightFocusIntent | null
  open: () => void
}

/**
 * The teaser as one link: each activation is a fresh focus intent and one
 * home_teaser open for analytics.
 */
export function useHomeSpotlightTeaserLink({
  stacked,
}: {
  stacked: boolean
}): HomeSpotlightTeaserLink {
  const teaser = useHomeSpotlightTeaser({ stacked })
  const [focusIntent, setFocusIntent] = useState<SpotlightFocusIntent | null>(null)
  const serialRef = useRef(0)
  const value = teaser.value
  const open = useCallback(() => {
    if (!value) return
    serialRef.current += 1
    setFocusIntent({
      cardId: value.item.id,
      focusToken: `teaser-${serialRef.current}-${Date.now().toString(36)}`,
    })
    // Measurement only: a failed record never blocks the focus move.
    void openCommunitySpotlightPostFromWeb(
      value.item.id,
      value.item.rank,
      value.level,
      undefined,
      'home_teaser'
    ).catch(() => undefined)
  }, [value])
  return { ...teaser, focusIntent, open }
}

/** The existing card rule: the viewer reads "You", a blank name the fallback. */
export function teaserAuthorName(value: SpotlightTeaserValue, t: Translate): string {
  const { author } = value.item
  if (author.isSelf) return t('community.card.authorSelf')
  return author.displayName.trim() || t('community.card.authorFallback')
}

export interface HomeSpotlightTeaserProps {
  value: SpotlightTeaserValue
  t: Translate
  onOpen: () => void
  onImageError: () => void
  /** Called when the teaser leaves while its link holds focus. */
  onLeaveWhileFocused: () => void
}

export function HomeSpotlightTeaser({
  value,
  t,
  onOpen,
  onImageError,
  onLeaveWhileFocused,
}: HomeSpotlightTeaserProps) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const leaveRef = useRef(onLeaveWhileFocused)
  leaveRef.current = onLeaveWhileFocused
  const { item, label } = value
  const count = item.reactions?.total ?? 0
  const author = teaserAuthorName(value, t)

  // Layout cleanup runs before React removes the link, so focus is still on it.
  useLayoutEffect(() => {
    const link = linkRef.current
    return () => {
      if (link && link === document.activeElement) leaveRef.current()
    }
  }, [])

  return (
    <a
      ref={linkRef}
      href={`#${spotlightCardElementId(item.id)}`}
      data-testid="home-spotlight-teaser-link"
      aria-label={t('home.spotlightTeaser.linkLabel', { label, author, count })}
      onClick={(event) => {
        event.preventDefault()
        onOpen()
      }}
      className="group flex min-h-[44px] items-center gap-4 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-4 text-left motion-safe:transition-colors motion-safe:duration-300 hover:border-[#C9A14A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A14A] motion-reduce:transition-none"
    >
      <Image
        data-testid="home-spotlight-teaser-image"
        src={item.imageAccess.url}
        alt=""
        aria-hidden="true"
        width={72}
        height={72}
        // Signed, short-lived URLs, like the community cards.
        unoptimized
        onError={onImageError}
        className="h-[72px] w-[72px] shrink-0 rounded-[6px] bg-[#E6E6ED] object-cover"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          data-testid="home-spotlight-teaser-heading"
          className="lookbook-display text-base font-semibold text-[#111111]"
        >
          {t('home.spotlightTeaser.heading', { label })}
        </span>
        <span
          data-testid="home-spotlight-teaser-author"
          className="truncate text-xs text-[#36363D]"
        >
          {author}
        </span>
        <span
          data-testid="home-spotlight-teaser-reactions"
          className="lookbook-metrics text-xs text-[#5C5C66]"
        >
          {t('home.spotlightTeaser.reactions', { count })}
        </span>
        <span className="mt-1 text-xs font-semibold text-[#8A691F] group-hover:underline">
          {t('home.spotlightTeaser.cta')}
        </span>
      </span>
    </a>
  )
}

/**
 * Mounted only while the layout is stacked and the value is valid; anything
 * else renders nothing and reserves no space.
 */
export function HomeSpotlightTeaserSlot({
  stacked,
  teaser,
  t,
  onLeaveWhileFocused,
}: {
  stacked: boolean
  teaser: HomeSpotlightTeaserLink
  t: Translate
  onLeaveWhileFocused: () => void
}) {
  if (!stacked || !teaser.value) return null
  return (
    <HomeSpotlightTeaser
      value={teaser.value}
      t={t}
      onOpen={teaser.open}
      onImageError={teaser.removeValue}
      onLeaveWhileFocused={onLeaveWhileFocused}
    />
  )
}
