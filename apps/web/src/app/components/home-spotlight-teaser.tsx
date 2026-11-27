// Story 6.7 web teaser owner: the teaser and its layout-level lifecycle in `apps/web/src/app/components/home-spotlight-teaser.tsx`, mounted by `apps/web/src/app/components/lookbook-prism-layout.tsx`
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
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SpotlightTeaserState,
  withRequestDeadline,
  type SpotlightTeaserValue,
} from '@couture/api-client'
import {
  communityCommentsSessionFromWeb,
  communityRetryAfterSeconds,
  getCommunitySpotlightFromWeb,
  openCommunitySpotlightPostFromWeb,
  sponsorshipOf,
} from '../../lib/community'
import { getI18n } from '../../i18n'
import { createWebSpotlightActivation } from '../lib/deep-link-handler'
import {
  CommunitySponsoredCta,
  useSponsoredShownRegistry,
  type SponsoredShownRegistry,
} from './community-sponsored-cta'
import { useScreenGateScreen } from './screen-gate'
import { HOME_TEASER_SNAPSHOT_PART, screenSnapshot } from '../../lib/screen-snapshot'
import {
  currentWebSessionScope,
  useHydrating,
  useWebSessionScope,
} from '../../lib/use-web-session'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** One teaser read waits at most this long, so a hung read never blocks the next. */
export const SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS = 10_000

/** How often the member is re-resolved, matching the community grid's session sync. */
const SESSION_SYNC_MS = 1000

/**
 * The member the grid spotlight reads for: the same session source, the same
 * one-second sync and the same session events. Undefined until mounted while hydrating; a
 * client-side mount (a return to Home) knows it at once, so its remembered teaser is in the
 * first frame and the gate never reveals Home before it (CC-7.7, Codex review P2-4).
 */
function useCommunityMember(): string | null | undefined {
  const hydrating = useHydrating()
  const [member, setMember] = useState<string | null | undefined>(() =>
    hydrating ? undefined : communityCommentsSessionFromWeb()
  )
  useEffect(() => {
    const sync = () => setMember(communityCommentsSessionFromWeb())
    sync()
    const timer = setInterval(sync, SESSION_SYNC_MS)
    window.addEventListener('storage', sync)
    window.addEventListener('couture:session', sync)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', sync)
      window.removeEventListener('couture:session', sync)
    }
  }, [])
  return member
}

/** Null until mounted, then whether the page is visible. */
function usePageVisible(): boolean | null {
  const [visible, setVisible] = useState<boolean | null>(null)
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
  /**
   * Story CC-7.7 D4: the teaser's read for the current member has answered, or no read will run
   * (no member, or a hidden page). Home's screen gate waits for it while the layout is stacked,
   * so the teaser is in place when the body appears instead of pushing the page down later.
   */
  settled: boolean
  /**
   * CodeRabbit r2 #7: the height a return holds for the teaser while it has none to show,
   * because the one it remembered expired and the fresh read is still out. Null otherwise.
   */
  reservedHeight: number | null
  /** Reports the rendered teaser's height, kept with the snapshot for `reservedHeight`. */
  measure: (height: number) => void
  /** Story 6.7b: shown blocks for this Home visit, kept across the teaser's unmount. */
  sponsoredShown: SponsoredShownRegistry
}

/**
 * The teaser a member last saw on Home, for a return in the same session (CC-7.7 D5), with the
 * height it rendered at.
 */
type TeaserSnapshot = {
  scope: string
  memberId: string
  value: SpotlightTeaserValue | null
  height?: number
}

function snapshotValueExpired(value: SpotlightTeaserValue | null, now: number): boolean {
  return value !== null && value.completedAt + SPOTLIGHT_TEASER_EXPIRY_MS <= now
}

/**
 * CodeRabbit r2 #7: the height a return holds for a remembered teaser that expired, until the
 * fresh read answers (`live` ends then) or a live value takes the place.
 */
function reservedTeaserHeight(
  snapshot: TeaserSnapshot | undefined,
  live: boolean,
  expired: boolean,
  liveValue: SpotlightTeaserValue | null
): number | null {
  if (!live || !expired || liveValue !== null) return null
  return snapshot?.height ?? null
}

/**
 * Lives in the layout, so the value and its read time survive the teaser's
 * unmount when the layout leaves the stacked arrangement. Side-by-side layouts
 * are inactive and issue no teaser read; entering stacked is a trigger under
 * the shared 60-second floor, as is the page becoming visible again.
 */
function scopedTeaserValue(
  value: SpotlightTeaserValue | null,
  sameMember: boolean,
  sameScope: boolean
): SpotlightTeaserValue | null {
  return sameMember && sameScope ? value : null
}

function teaserReadHasSettled(
  member: string | null | undefined,
  settledFor: string | null | undefined,
  sameScope: boolean
): boolean {
  return member !== undefined && settledFor === member && sameScope
}

function snapshotForScope(snapshot: TeaserSnapshot | undefined, scope: string | null) {
  return snapshot?.scope === scope ? snapshot : undefined
}

export function useHomeSpotlightTeaser({
  stacked,
}: {
  stacked: boolean
}): HomeSpotlightTeaserLifecycle {
  // The member each read started for, so a settled read counts only for that member.
  const readingForRef = useRef<string | null | undefined>(undefined)
  const [settledFor, setSettledFor] = useState<string | null | undefined>(undefined)
  /** The session scope of the read whose answer is shown (Codex review P2-1). */
  const shownScopeRef = useRef<string | null>(null)
  const [state] = useState(
    () =>
      new SpotlightTeaserState({
        read: (signal) => {
          const readFor = readingForRef.current
          const readScope = currentWebSessionScope()
          return withRequestDeadline(
            SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS,
            [signal],
            (deadline) =>
              getCommunitySpotlightFromWeb({
                limit: 1,
                surface: 'home_teaser',
                signal: deadline,
              })
          ).finally(() => {
            // After the state stored its answer (it does so as this promise settles), so the
            // gate never opens on the settled flag before the value is there to render.
            if (!signal.aborted)
              setTimeout(() => {
                if (signal.aborted || currentWebSessionScope() !== readScope) return
                shownScopeRef.current = readScope
                setSettledFor(readFor)
              }, 0)
          })
        },
        retryAfterSeconds: communityRetryAfterSeconds,
      })
  )
  const storedValue = useSyncExternalStore(state.subscribe, state.getSnapshot, () => null)
  const sponsoredShown = useSponsoredShownRegistry()
  const member = useCommunityMember()
  /*
   * The member `state` reads for, set where `state.setMember` runs. Its value belongs to that
   * member only: a member change (a fixture bearer switch keeps the owner) drops it in the same
   * render, before the effect points `state` at the next member (CI 7.7-E2E-009 on d67800d2).
   */
  const [stateMember, setStateMember] = useState(member)
  const visible = usePageVisible()

  // Story CC-7.7 D5: a return to Home shows the teaser it last showed this member (or none)
  // until the teaser's own read answers, then the read's answer, in place.
  const screen = useScreenGateScreen()
  const scope = useWebSessionScope()
  const [snapshot] = useState(() =>
    screen && scope
      ? screenSnapshot.recall<TeaserSnapshot>(scope, screen, HOME_TEASER_SNAPSHOT_PART)
      : undefined
  )
  const [snapshotDropped, setSnapshotDropped] = useState(false)
  /** The remembered value has passed the expiry `SpotlightTeaserState` enforces on a live one. */
  const [snapshotExpired, setSnapshotExpired] = useState(() =>
    snapshotValueExpired(snapshot?.value ?? null, Date.now())
  )
  useEffect(() => {
    const remembered = snapshot?.value
    if (!remembered || snapshotExpired) return
    const timer = setTimeout(
      () => setSnapshotExpired(true),
      Math.max(0, remembered.completedAt + SPOTLIGHT_TEASER_EXPIRY_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [snapshot, snapshotExpired])
  const fromCurrentRead = shownScopeRef.current === scope
  const liveValue = scopedTeaserValue(
    storedValue,
    stateMember === member,
    fromCurrentRead
  )
  const memberSettled = teaserReadHasSettled(member, settledFor, fromCurrentRead)
  const scopedSnapshot = snapshotForScope(snapshot, scope)
  const snapshotLive = Boolean(
    !snapshotDropped &&
      !memberSettled &&
      scopedSnapshot &&
      scopedSnapshot.memberId === member
  )
  const rememberedValue = snapshotLive && !snapshotExpired ? scopedSnapshot?.value : null
  const value = liveValue ?? rememberedValue ?? null
  const settled = member === null || visible === false || memberSettled || snapshotLive
  /*
   * CodeRabbit r2 #7: a return whose remembered teaser expired shows none, and a return opens
   * Home's gate from its snapshot at once, so the fresh teaser would land later and push the
   * feed down. The expired teaser's place is held at its last height until the fresh read
   * answers (`snapshotLive` ends then), and the answer takes that place.
   */
  const reservedHeight = reservedTeaserHeight(
    scopedSnapshot,
    snapshotLive,
    snapshotExpired,
    liveValue
  )
  /** The rendered teaser's height, once it is laid out (a closed gate lays out nothing). */
  const [height, setHeight] = useState<number | undefined>(undefined)
  const measure = useCallback((next: number) => {
    if (next > 0) setHeight(next)
  }, [])
  const removeValue = useCallback(() => {
    setSnapshotDropped(true)
    state.removeValue()
  }, [state])

  useEffect(() => {
    if (!screen || !scope || !member || !memberSettled) return
    // Under the scope its read started in; the store drops it once that scope left, and while
    // Community access is revoked (P3-1).
    screenSnapshot.remember(shownScopeRef.current, screen, HOME_TEASER_SNAPSHOT_PART, {
      scope,
      memberId: member,
      value: liveValue,
      height: liveValue ? height : undefined,
    } satisfies TeaserSnapshot)
  }, [height, liveValue, member, memberSettled, scope, screen])

  useEffect(() => {
    readingForRef.current = member
    state.setMember(member)
    setStateMember(member)
  }, [member, state])

  useEffect(() => {
    state.setActive(stacked && visible === true)
  }, [stacked, visible, state])

  useEffect(
    () => () => {
      state.setActive(false)
      state.setMember(null)
    },
    [state]
  )

  return { value, removeValue, sponsoredShown, settled, reservedHeight, measure }
}

export interface HomeSpotlightTeaserLink extends HomeSpotlightTeaserLifecycle {
  open: () => string | null
  isCurrent: () => boolean
}

export function useHomeSpotlightTeaserLink(): HomeSpotlightTeaserLink {
  const teaser = useHomeSpotlightTeaser({ stacked: true })
  const { value } = teaser
  const scope = useWebSessionScope()
  const isCurrent = useCallback(
    () => scope !== null && currentWebSessionScope() === scope,
    [scope]
  )
  const open = useCallback(() => {
    if (!value || !scope || !isCurrent()) return null
    const focusToken = createWebSpotlightActivation(value.item.id, scope)
    void openCommunitySpotlightPostFromWeb(
      value.item.id,
      value.item.rank,
      value.level,
      undefined,
      'home_teaser'
    ).catch(() => undefined)
    return focusToken
  }, [isCurrent, scope, value])
  return { ...teaser, open, isCurrent }
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
  sponsoredShown: SponsoredShownRegistry
  onOpen: () => string | null
  isCurrent: () => boolean
  onImageError: () => void
  /** Called when the teaser leaves while its link holds focus. */
  onLeaveWhileFocused: () => void
  /** Called after each commit with the teaser's laid-out height (CodeRabbit r2 #7). */
  onMeasure?: (height: number) => void
}

export function HomeSpotlightTeaser({
  value,
  t,
  sponsoredShown,
  onOpen,
  isCurrent,
  onImageError,
  onLeaveWhileFocused,
  onMeasure,
}: HomeSpotlightTeaserProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const leaveRef = useRef(onLeaveWhileFocused)
  leaveRef.current = onLeaveWhileFocused
  const { item, label } = value
  const router = useRouter()
  const spotlightHref = (focusToken: string) => {
    const destination = new URLSearchParams({
      source: 'app',
      type: 'community',
      cardId: item.id,
      focus: 'spotlight',
      focusToken,
    })
    return `/community?${destination.toString()}`
  }
  const count = item.reactions?.total ?? 0
  const author = teaserAuthorName(value, t)
  // Story 6.7b: the block exactly as the live teaser read returned it.
  const sponsorship = sponsorshipOf(item)
  const [announcement, setAnnouncement] = useState<{ key: string; id: number } | null>(
    null
  )
  const announcementIdRef = useRef(0)

  // Layout cleanup runs before React removes the teaser, so focus is still on
  // its link or its CTA.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement)) leaveRef.current()
    }
  }, [])

  // Every commit, so the height read once the gate shows the body (and after a wrap change)
  // is the one kept. A hidden body measures 0, which `measure` ignores.
  useLayoutEffect(() => {
    if (rootRef.current) onMeasure?.(rootRef.current.offsetHeight)
  })

  return (
    <div
      ref={rootRef}
      data-testid="home-spotlight-teaser"
      className="flex flex-col gap-3"
    >
      <Link
        href={spotlightHref(`link-${item.id}`)}
        prefetch={false}
        data-testid="home-spotlight-teaser-link"
        onClick={(event) => {
          if (!isCurrent()) {
            event.preventDefault()
            return
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          const focusToken = onOpen()
          if (event.defaultPrevented) return
          event.preventDefault()
          if (focusToken) router.push(spotlightHref(focusToken))
        }}
        className="group flex min-h-11 items-center gap-4 border-t border-line pt-4 text-left"
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
          className="h-[72px] w-[72px] shrink-0 rounded-md bg-card-muted object-cover"
        />
        {/*
        The name comes from content, so it always contains what the link says.
        The visual lines repeat it in short form and stay out of the tree.
      */}
        <span className="sr-only">
          {t('home.spotlightTeaser.linkLabel', { label, author, count })}
          {sponsorship
            ? ` ${t('community.card.sponsoredAnnounce', {
                partner: sponsorship.partnerDisplayName,
              })}`
            : null}
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-col gap-0.5">
          <span
            data-testid="home-spotlight-teaser-heading"
            className="text-base font-semibold text-ink"
          >
            {t('home.spotlightTeaser.heading', { label })}
          </span>
          <span
            data-testid="home-spotlight-teaser-author"
            className="truncate text-xs text-ink-soft"
          >
            {author}
          </span>
          {sponsorship && (
            <span
              data-testid="home-spotlight-teaser-sponsored"
              className="self-start rounded-md border border-line-strong px-2 py-0.5 text-xs font-semibold uppercase text-ink"
            >
              {t('community.card.sponsored')}
            </span>
          )}
          <span
            data-testid="home-spotlight-teaser-reactions"
            className="text-xs text-ink-muted"
          >
            {t('home.spotlightTeaser.reactions', { count })}
          </span>
          <span className="mt-1 text-xs font-semibold text-ink group-hover:underline">
            {t('home.spotlightTeaser.cta')}
          </span>
        </span>
      </Link>
      {/*
        Story 6.7b: a sibling of the link, so activating the CTA leaves focus
        here and records no spotlight open.
      */}
      {sponsorship && (
        // The link has no side padding, so the CTA lines up with its image.
        <div>
          <CommunitySponsoredCta
            postId={item.id}
            sponsorship={sponsorship}
            surface="home_teaser"
            scope="home-spotlight-teaser-"
            language={getI18n().language}
            t={t}
            shown={sponsoredShown}
            isCurrent={isCurrent}
            announce={(key) => {
              announcementIdRef.current += 1
              setAnnouncement({ key, id: announcementIdRef.current })
            }}
          />
        </div>
      )}
      {sponsorship && (
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="home-spotlight-teaser-cta-live"
        >
          <span key={announcement?.id}>{announcement ? t(announcement.key) : null}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Mounted only while the layout is stacked and the value is valid. Without a value it
 * renders nothing, except the held place of an expired teaser on a return (CodeRabbit r2 #7).
 */
export function HomeSpotlightTeaserSlot({
  teaser,
  t,
  onLeaveWhileFocused,
}: {
  teaser: HomeSpotlightTeaserLink
  t: Translate
  onLeaveWhileFocused: () => void
}) {
  if (!teaser.value)
    return teaser.reservedHeight ? (
      <div
        aria-hidden="true"
        data-testid="home-spotlight-teaser-reserved"
        style={{ height: teaser.reservedHeight }}
      />
    ) : null
  return (
    <HomeSpotlightTeaser
      value={teaser.value}
      t={t}
      sponsoredShown={teaser.sponsoredShown}
      onOpen={teaser.open}
      isCurrent={teaser.isCurrent}
      onImageError={teaser.removeValue}
      onLeaveWhileFocused={onLeaveWhileFocused}
      onMeasure={teaser.measure}
    />
  )
}
