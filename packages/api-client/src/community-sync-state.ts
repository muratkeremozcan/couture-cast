// Story 6.5 owner: shared single-flight catch-up and per-target revision/ownership fences.
import type { z } from 'zod'
import type {
  CommunityFeedMode,
  CommunityStreamEvent,
  resolvedCommunityTargetSchema,
} from './contracts/http'
import type { CommunitySyncClient } from './community-sync-client'
import { abortError } from './request-deadline'
import {
  connectCommunityTransport,
  type CommunityTransportState,
} from './realtime/community-transport'
export class CommunityRequestSuperseded extends Error {}
/**
 * Fallback polls start 5 to 5.5 s apart, start to start, while no socket serves the feed.
 * A poll plus its 2 s request deadline then completes inside the 8 s verification bound.
 */
const FALLBACK_MIN_MS = 5000
const FALLBACK_JITTER_MS = 500
type Target = z.infer<typeof resolvedCommunityTargetSchema>
type EventPage = Awaited<ReturnType<CommunitySyncClient['events']>>
function responseStatus(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined
  const response: unknown = error.response
  return response && typeof response === 'object' && 'status' in response
    ? response.status
    : undefined
}
/** Whether the server answered: a generated response error, or an app error keeping its status. */
function answered(error: unknown): boolean {
  if (typeof responseStatus(error) === 'number') return true
  return (
    !!error &&
    typeof error === 'object' &&
    'httpStatus' in error &&
    typeof error.httpStatus === 'number'
  )
}
export type CommunitySyncCallbacks = {
  rendered: () => string[]
  rebuild: (signal?: AbortSignal) => Promise<void>
  reconcile?: (signal?: AbortSignal) => Promise<void>
  apply: (target: Target) => void
  changed: (events: CommunityStreamEvent[], signal?: AbortSignal) => Promise<void>
  availability: (state: CommunityTransportState, realtime?: boolean) => void
}
export class CommunitySyncState {
  private cursor: string | undefined
  private generation = 0
  private readonly revisions = new Map<string, bigint>()
  private readonly projections = new Map<string, bigint>()
  private readonly pending = new Set<AbortController>()
  private flight: Promise<void> | undefined
  private dirty = false
  private stopped = false
  private connected = false
  private socketConnected = false
  private fallback: ReturnType<typeof setTimeout> | undefined
  private disconnect: (() => void) | undefined
  private nextTargetValidation = 0
  private replayAfterRecovery = false
  constructor(
    private readonly client: Pick<CommunitySyncClient, 'events' | 'resolve'>,
    private readonly mode: CommunityFeedMode,
    private readonly callbacks: CommunitySyncCallbacks
  ) {}

  start(baseUrl: string, token: () => Promise<string | undefined>) {
    this.disconnect = connectCommunityTransport({
      baseUrl,
      token,
      changed: () => {
        void this.catchUp()
      },
      state: (state) => {
        if (this.stopped) return
        if (this.socketConnected && state !== 'connected') {
          this.nextTargetValidation = 0
          this.replayAfterRecovery = true
        }
        this.socketConnected = state === 'connected'
        if (!this.socketConnected) this.connected = false
        if (state === 'connected' && this.fallback) {
          clearTimeout(this.fallback)
          this.fallback = undefined
        }
        if (state !== 'connected') this.callbacks.availability(state, false)
        if (state === 'denied') {
          this.stop()
          return
        }
        if (state === 'connected') void this.catchUp()
        else this.scheduleFallback()
      },
    })
    void this.catchUp()
    this.scheduleFallback()
  }
  foreground() {
    if (!this.stopped) {
      this.nextTargetValidation = 0
      this.connected = false
      this.callbacks.availability('recovering', false)
      void this.catchUp()
    }
  }
  recover() {
    if (this.stopped) return
    this.nextTargetValidation = 0
    this.replayAfterRecovery = true
    this.connected = false
    this.callbacks.availability('unavailable', false)
    this.scheduleFallback()
  }
  stop() {
    this.stopped = true
    this.generation++
    this.disconnect?.()
    this.pending.forEach((controller) => controller.abort())
    this.pending.clear()
    if (this.fallback) clearTimeout(this.fallback)
    this.revisions.clear()
    this.projections.clear()
    this.cursor = undefined
  }

  catchUp(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.dirty = true
    if (this.flight) return this.flight
    const generation = this.generation
    this.flight = this.run(generation).finally(() => {
      this.flight = undefined
      if (this.dirty && !this.stopped) void this.catchUp()
    })
    return this.flight
  }
  private current(generation: number) {
    return !this.stopped && generation === this.generation
  }
  private resync(retryImmediately: boolean, unavailable = true) {
    this.generation++
    this.cursor = undefined
    this.revisions.clear()
    this.projections.clear()
    this.nextTargetValidation = 0
    this.dirty = retryImmediately
    if (unavailable) {
      this.connected = false
      this.callbacks.availability('unavailable', false)
    }
    if (!retryImmediately) this.scheduleFallback()
  }
  private async run(generation: number) {
    while (this.dirty && this.current(generation)) {
      this.dirty = false
      try {
        const page = await this.ownedRequest((signal) =>
          this.client.events(this.mode, this.cursor, signal)
        )
        if (!this.current(generation)) return
        if (page.resyncRequired) {
          // A routine removal marker can rebuild from verified heads without
          // suspending mounted composition. Unverifiable bootstrap still hides.
          this.resync(Boolean(this.cursor), !this.cursor)
          return
        }
        await this.applyPage(page, generation)
      } catch (error) {
        if (!this.current(generation)) return
        this.handleFailure(error)
        return
      }
    }
  }
  private handleFailure(error: unknown) {
    const status = responseStatus(error)
    if (error instanceof CommunityRequestSuperseded) {
      this.dirty = true
      return
    }
    if (status === 409) this.resync(Boolean(this.cursor))
    else if (status === 401 || status === 403) {
      this.callbacks.availability('denied')
      this.stop()
    } else {
      this.connected = false
      // Only a server answer says community is unavailable. A deadline abort, a network
      // error or an unknown shape is transient: verified content stays until the D3 bound
      // lapses, and the fallback retries meanwhile.
      this.callbacks.availability(answered(error) ? 'unavailable' : 'recovering', false)
      this.scheduleFallback()
    }
  }
  private newerEvents(events: CommunityStreamEvent[]) {
    return events.filter((event) => {
      if (!('communityRevision' in event)) return true
      return BigInt(event.communityRevision) > (this.revisions.get(event.postId) ?? -1n)
    })
  }
  private recordRevisions(events: CommunityStreamEvent[]) {
    for (const event of events) {
      if (!('communityRevision' in event)) continue
      const revision = BigInt(event.communityRevision)
      if (revision > (this.revisions.get(event.postId) ?? -1n))
        this.revisions.set(event.postId, revision)
    }
  }
  private async applyPage(page: EventPage, generation: number) {
    const bootstrap = !this.cursor
    if (bootstrap) await this.ownedOperation((signal) => this.callbacks.rebuild(signal))
    if (!this.current(generation)) return
    const filtered = this.newerEvents(page.events)
    if (filtered.length)
      await this.ownedOperation((signal) => this.callbacks.changed(filtered, signal))
    if (!this.current(generation)) return
    if (
      bootstrap ||
      filtered.length ||
      (!this.connected && Date.now() >= this.nextTargetValidation)
    ) {
      await this.validateTargets()
      if (this.callbacks.reconcile)
        await this.ownedOperation((signal) => this.callbacks.reconcile!(signal))
      if (!this.current(generation)) return
      this.nextTargetValidation = Date.now() + 15_000
      if (this.replayAfterRecovery) {
        // Capture again after recovered views, as during bootstrap. Appending is optional
        // on the server path and can commit between the first head read and these views.
        this.replayAfterRecovery = false
        this.dirty = true
      }
    }
    this.completePage(page, filtered, bootstrap)
  }
  private completePage(
    page: EventPage,
    filtered: CommunityStreamEvent[],
    bootstrap: boolean
  ) {
    this.recordRevisions(filtered)
    this.cursor = page.nextCursor
    this.connected = this.socketConnected
    if (this.connected && this.fallback) {
      clearTimeout(this.fallback)
      this.fallback = undefined
    }
    this.callbacks.availability('connected', this.connected)
    this.dirty ||= bootstrap || page.hasMore
  }
  private async validateTargets() {
    const ids = [...new Set(this.callbacks.rendered())]
    for (let offset = 0; offset < ids.length; offset += 50) {
      const targets = ids
        .slice(offset, offset + 50)
        .map((postId) => ({ key: postId, postId }))
      const result = await this.ownedRequest((signal) =>
        this.client.resolve({ targets }, signal)
      )
      // The run is the only flight, so only a stop can intervene: one that lands after
      // the response settled and before this continuation. Nothing applies after it.
      if (this.stopped) return
      for (const target of result.targets) {
        if (target.status === 'available') {
          const revision = BigInt(target.communityRevision)
          if (revision < (this.projections.get(target.key) ?? -1n)) continue
          this.projections.set(target.key, revision)
        }
        this.callbacks.apply(target)
      }
    }
  }
  private ownedOperation<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // HTTP wrappers start a fresh deadline per request. A multi-page view has a
    // separate total bound and remains cancellable by stop/session retirement.
    return this.ownedRequest(work, 10_000)
  }
  private async ownedRequest<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeout = 2000
  ): Promise<T> {
    const controller = new AbortController()
    this.pending.add(controller)
    // The executor runs synchronously, so the deadline timer always exists below.
    let timer!: ReturnType<typeof setTimeout>
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(abortError('Community request aborted')),
        { once: true }
      )
      timer = setTimeout(() => controller.abort(), timeout)
    })
    try {
      return await Promise.race([work(controller.signal), aborted])
    } finally {
      clearTimeout(timer)
      this.pending.delete(controller)
    }
  }
  private scheduleFallback() {
    if (this.fallback || this.connected || this.stopped) return
    this.fallback = setTimeout(
      () => {
        this.fallback = undefined
        // Re-arm from the start, so HTTP/view duration cannot stretch cadence.
        this.scheduleFallback()
        void this.catchUp()
      },
      FALLBACK_MIN_MS + Math.random() * FALLBACK_JITTER_MS
    )
  }
}
