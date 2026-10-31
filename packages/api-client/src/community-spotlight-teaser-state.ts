// Story 6.7 lifecycle owner: the member-scoped read, re-read, expiry, floor and deferral in `packages/api-client/src/community-spotlight-teaser-state.ts`
// Story 6.7 owner: the Home spotlight teaser's member-scoped read lifecycle,
// shared by web and mobile so both clients follow one set of timing rules.
import type {
  CommunityReactionSpotlight,
  CommunityReactionSpotlightItem,
  CommunityServedSpotlightLevel,
} from './contracts/http'

/** A teaser value expires this long after its read completed. */
export const SPOTLIGHT_TEASER_EXPIRY_MS = 5 * 60_000
/** While Home is shown, the client re-reads this long after the last read attempt. */
export const SPOTLIGHT_TEASER_REREAD_MS = 4 * 60_000
/** Reads never run more often than once per this interval. */
export const SPOTLIGHT_TEASER_READ_FLOOR_MS = 60_000

/** One renderable teaser: the viewer's rank-1 spotlight entry. */
export interface SpotlightTeaserValue {
  /** The member the value was read for; it is never shown to anyone else. */
  memberId: string
  item: CommunityReactionSpotlightItem
  level: CommunityServedSpotlightLevel
  label: string
  /** Clock time the read completed; the value expires five minutes later. */
  completedAt: number
}

export interface SpotlightTeaserTimers {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SpotlightTeaserDependencies {
  /** One page-one read with `limit=1` and `surface=home_teaser`. */
  read(signal: AbortSignal): Promise<CommunityReactionSpotlight>
  /** Seconds from a 429 `Retry-After`, or undefined for any other failure. */
  retryAfterSeconds(error: unknown): number | undefined
  timers?: SpotlightTeaserTimers
}

const systemTimers: SpotlightTeaserTimers = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * The render rule: a served level, one entry and a label to name the area (the
 * contract requires every entry's signed image URL). Anything else renders
 * nothing and reserves no space.
 */
export function spotlightTeaserValueOf(
  spotlight: CommunityReactionSpotlight,
  memberId: string,
  completedAt: number
): SpotlightTeaserValue | null {
  const item = spotlight.items[0]
  if (spotlight.level === 'none' || !item || !spotlight.label) return null
  return {
    memberId,
    item,
    level: spotlight.level,
    label: spotlight.label,
    completedAt,
  }
}

/**
 * Owns one teaser value for the current member and decides when to read.
 *
 * - A read runs only for a resolved member while the surface is active (Home
 *   shown, app or tab in the foreground, and on web a stacked layout).
 * - Becoming active, or `trigger()` on focus, foreground or visibility, reads
 *   only when the last attempt is older than 60 seconds and no `Retry-After`
 *   deferral is pending.
 * - After a successful read, a renderable one or not, the client re-reads 4
 *   minutes after that attempt started, while still active. A failed read removes the value and schedules
 *   nothing; the next trigger reads again.
 * - A value expires 5 minutes after its read completed.
 * - A member change clears the value, aborts the read in flight, drops any late
 *   response, and resets the attempt time, floor and deferral, so the new member
 *   reads at once.
 */
export class SpotlightTeaserState {
  private readonly timers: SpotlightTeaserTimers
  private readonly listeners = new Set<() => void>()
  private value: SpotlightTeaserValue | null = null
  private memberId: string | null = null
  private active = false
  private lastAttemptAt: number | null = null
  /** A failed attempt schedules no timed re-read; the next trigger reads again. */
  private lastAttemptFailed = false
  private deferredUntil = 0
  private generation = 0
  private controller: AbortController | null = null
  private rereadTimer: unknown = null
  private expiryTimer: unknown = null
  private disposed = false

  constructor(private readonly dependencies: SpotlightTeaserDependencies) {
    this.timers = dependencies.timers ?? systemTimers
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): SpotlightTeaserValue | null => this.value

  /** True while a read is in flight; a shown value stays until it settles. */
  isReading(): boolean {
    return this.controller !== null
  }

  /** Undefined or null means no member is resolved: nothing reads or shows. */
  setMember(memberId: string | null | undefined): void {
    const next = memberId ?? null
    if (next === this.memberId) return
    this.memberId = next
    this.cancelRead()
    this.clearTimer('reread')
    this.lastAttemptAt = null
    this.lastAttemptFailed = false
    this.deferredUntil = 0
    this.setValue(null)
    this.maybeRead()
  }

  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (!active) {
      this.clearTimer('reread')
      return
    }
    this.maybeRead()
    if (!this.isReading()) this.scheduleReread()
  }

  /** Home focus, app foreground or page visibility regained. */
  trigger(): void {
    this.maybeRead()
  }

  /** The image failed to load: the teaser leaves and reserves no space. */
  readonly removeValue = (): void => {
    this.setValue(null)
  }

  dispose(): void {
    this.disposed = true
    this.cancelRead()
    this.clearTimer('reread')
    this.clearTimer('expiry')
    this.listeners.clear()
  }

  private maybeRead(): void {
    if (this.disposed || !this.active || this.memberId === null || this.isReading())
      return
    const now = this.timers.now()
    if (now < this.deferredUntil) return
    if (
      this.lastAttemptAt !== null &&
      now - this.lastAttemptAt < SPOTLIGHT_TEASER_READ_FLOOR_MS
    )
      return
    void this.read(this.memberId, now)
  }

  private async read(memberId: string, startedAt: number): Promise<void> {
    this.clearTimer('reread')
    this.lastAttemptAt = startedAt
    const generation = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    const current = () => !this.disposed && generation === this.generation
    try {
      const spotlight = await this.dependencies.read(controller.signal)
      if (!current()) return
      this.controller = null
      this.lastAttemptFailed = false
      this.setValue(spotlightTeaserValueOf(spotlight, memberId, this.timers.now()))
      this.scheduleReread()
    } catch (error: unknown) {
      if (!current()) return
      this.controller = null
      this.lastAttemptFailed = true
      const retryAfter = this.dependencies.retryAfterSeconds(error)
      if (retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0)
        this.deferredUntil = this.timers.now() + retryAfter * 1000
      this.setValue(null)
    }
  }

  private scheduleReread(): void {
    this.clearTimer('reread')
    if (!this.active || this.lastAttemptAt === null || this.lastAttemptFailed) return
    const delay = Math.max(
      0,
      this.lastAttemptAt + SPOTLIGHT_TEASER_REREAD_MS - this.timers.now()
    )
    this.rereadTimer = this.timers.setTimeout(() => {
      this.rereadTimer = null
      this.maybeRead()
    }, delay)
  }

  private cancelRead(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
  }

  private setValue(value: SpotlightTeaserValue | null): void {
    this.clearTimer('expiry')
    if (value)
      this.expiryTimer = this.timers.setTimeout(
        () => {
          this.expiryTimer = null
          this.setValue(null)
        },
        Math.max(0, value.completedAt + SPOTLIGHT_TEASER_EXPIRY_MS - this.timers.now())
      )
    if (value === this.value) return
    this.value = value
    for (const listener of this.listeners) listener()
  }

  private clearTimer(kind: 'reread' | 'expiry'): void {
    const handle = kind === 'reread' ? this.rereadTimer : this.expiryTimer
    if (handle === null) return
    this.timers.clearTimeout(handle)
    if (kind === 'reread') this.rereadTimer = null
    else this.expiryTimer = null
  }
}
