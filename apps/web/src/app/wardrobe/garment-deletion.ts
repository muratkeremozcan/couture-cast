// Story CC-7.6: the Closet's garment delete. D1: an unused piece hides at once with "Deleted"
// and Undo; the DELETE is sent when the window ends, when another delete starts, when the page
// hides or when the Closet unmounts; every send uses keepalive. D2: a confirmed delete of a
// piece in use is sent at once. D6/D9: a failed send returns the piece with "Could not delete"
// and Retry, which sends that piece alone at once. D11: every notice, action and late answer
// belongs to the member who started it; once the tab holds another member, it says nothing.
'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createAnnouncementToken,
  createDeferredGarmentDeletion,
  isOfflineError,
  type DeferredGarmentDeletionCommit,
  type DeferredGarmentDeletionController,
  type DeferredGarmentDeletionEvent,
} from '@couture/utils'
import type { TFunction } from 'i18next'
import { getI18n } from '../../i18n'
import { currentWebSessionOwner } from '../../lib/use-web-session'
import { deleteGarmentFromWeb } from '../../lib/wardrobe'
import { useStatusBar } from '../components/save-feedback'

/**
 * How the detail asks for a delete: inside an Undo window, at once after the prompt, or at once
 * because the usage read answered 404 `GARMENT_NOT_FOUND` (already gone).
 */
export type GarmentDeleteMode = 'deferred' | 'immediate' | 'gone'

type StatusBarApi = ReturnType<typeof useStatusBar>
type NoticeInput = Omit<
  Parameters<StatusBarApi['showNotice']>[0],
  'id' | 'announcementId' | 'urgency'
>

const NOTICE_PREFIX = 'garment-delete-'

/**
 * One member's deletes in this tab. It outlives a Closet mount, so a Retry pressed after the
 * member left the Closet, or after they came back, still has its answer heard: the notice on
 * the root status bar and, when a Closet is mounted, its grid.
 */
type DeletionSession = {
  owner: string | null
  controller: DeferredGarmentDeletionController
  /** False once the tab holds another member or a test replaced the session. */
  live: boolean
  /** The commit of each id, built with the bearer of the member who asked. */
  commits: Map<string, DeferredGarmentDeletionCommit>
  /** Ids whose commit is the member's confirmation: a confirmed delete or a Retry. */
  announceOnCommit: Set<string>
  /**
   * A confirmed delete or Retry that landed while another delete was inside its Undo window:
   * its "Deleted" waits for that window to close, so it never takes the Undo off the bar.
   */
  deletedToAnnounce: boolean
  /** The id of the last notice this session showed, dismissed when the session ends. */
  lastNoticeId: string | null
  /**
   * Failed pieces still offered a Retry. Their notice shows only while no Undo window is open;
   * another notice that covers it (an Undo, "Undone") brings it back once no window is open,
   * and it ends when it expires on screen, its pieces are sent again, or they are deleted.
   */
  failures: FailureNotice | null
  /** The status bar and strings of the last mounted Closet (the root bar outlives it). */
  statusBar: StatusBarApi | null
  t: TFunction | null
  /** The mounted Closet's grid update, null while no Closet is mounted. */
  onCommitted: ((garmentId: string) => void) | null
  readBearer: () => string | null
  unsubscribe: () => void
  /** Stops following the tab's member. */
  stopWatchingOwner: () => void
}

type FailureNotice = {
  ids: Set<string>
  offline: boolean
  /** When the notice on screen expires; 0 while it waits to show. */
  until: number
  /** The id of the Retry notice on screen, null while it waits to show. */
  noticeId: string | null
  /** True once a render of the bar showed that notice, so its absence means it was replaced. */
  seenOnBar: boolean
  /** True when another notice replaced it, or it waits for an Undo window to close. */
  covered: boolean
}

let session: DeletionSession | null = null
let injectedControllerFactory:
  | ((owner: string | null) => DeferredGarmentDeletionController)
  | null = null
let deleteNoticeSeq = 0
let readNow: () => number = () => Date.now()

/**
 * D10 clock seam: the time the failure notice's expiry is measured against, so a test can run
 * it on the same clock as the status bar. Null restores `Date.now`.
 */
export function injectWardrobeGarmentDeletionClockForTests(
  now: (() => number) | null
): void {
  readNow = now ?? (() => Date.now())
}

/**
 * D10 test seam. A Next page takes no props, so a test injects here the factory each new
 * member session builds its controller with (one call per session, so two members never share
 * one), and passes null to restore the default. Either way the current session ends without
 * sending anything, so no test hears another test's deletes.
 */
export function injectWardrobeGarmentDeletionForTests(
  factory: ((owner: string | null) => DeferredGarmentDeletionController) | null
): void {
  injectedControllerFactory = factory
  if (session) endSession(session, { send: false })
}

/** Whether `owning` may still speak: it is current and the tab still holds its member. */
function speaks(owning: DeletionSession): boolean {
  return owning.live && session === owning && currentWebSessionOwner() === owning.owner
}

function endSession(ending: DeletionSession, { send }: { send: boolean }) {
  if (!ending.live) return
  ending.live = false
  if (session === ending) session = null
  ending.stopWatchingOwner()
  // A new member's Closet ends the last session while it renders, so the rest waits for a
  // microtask: no status bar or grid of another component updates during that render.
  queueMicrotask(() => {
    // Dismissing by id leaves any newer notice in place.
    if (ending.lastNoticeId) ending.statusBar?.dismissNotice(ending.lastNoticeId)
    // The member's last word stands: what is still inside its window is sent with that
    // member's own bearer, and nothing about it shows to whoever holds the tab next (D11).
    const settled = send ? ending.controller.flush() : Promise.resolve()
    void settled.finally(() => {
      ending.unsubscribe()
      if (!send) ending.controller.reset()
    })
  })
}

function show(owning: DeletionSession, kind: string, notice: NoticeInput) {
  const statusBar = owning.statusBar
  if (!statusBar || !speaks(owning)) return null
  // Any other notice takes a showing failure off the bar; it comes back later (D9).
  if (kind !== 'failed' && failuresLive(owning)) owning.failures!.covered = true
  const seq = ++deleteNoticeSeq
  const shown = statusBar.showNotice({
    ...notice,
    id: `${NOTICE_PREFIX}${kind}-${seq}`,
    announcementId: createAnnouncementToken(`${NOTICE_PREFIX}${kind}`, seq),
  })
  owning.lastNoticeId = shown.id
  return shown
}

function commitFor(owning: DeletionSession, garmentId: string) {
  const existing = owning.commits.get(garmentId)
  if (existing) return existing
  const accessToken = owning.readBearer()
  // Every send uses keepalive (the DELETE has no body), so a window that ends as the tab
  // closes or navigates still reaches the API, whether the timer or a flush sent it.
  const commit: DeferredGarmentDeletionCommit = () =>
    deleteGarmentFromWeb(garmentId, { keepalive: true, accessToken })
  owning.commits.set(garmentId, commit)
  return commit
}

function failuresLive(owning: DeletionSession): boolean {
  const failures = owning.failures
  if (!failures) return false
  // A notice that ran its course on screen has ended; one that was covered has not.
  if (!failures.covered && failures.until > 0) {
    // A Retry that expired, that the member dismissed, or that another feature's notice
    // replaced has ended; the bar is read while a Closet is mounted to see the last two.
    const onBar = owning.statusBar?.hasProvider ? owning.statusBar.notice?.id : undefined
    if (onBar === failures.noticeId) failures.seenOnBar = true
    const replaced = failures.seenOnBar && onBar !== failures.noticeId
    if (failures.until <= readNow() || replaced) {
      owning.failures = null
      return false
    }
  }
  return true
}

function retry(owning: DeletionSession, garmentIds: readonly string[]) {
  if (!speaks(owning)) return
  for (const garmentId of garmentIds) {
    // Its piece is being sent again, so no later notice offers it a second time.
    owning.failures?.ids.delete(garmentId)
    if (owning.controller.isPending(garmentId)) continue
    // A Retry reads the bearer again, so a token that expired since is not reused.
    owning.commits.delete(garmentId)
    owning.announceOnCommit.add(garmentId)
    void owning.controller.retry(garmentId, commitFor(owning, garmentId))
  }
  if (owning.failures?.ids.size === 0) owning.failures = null
}

function addFailures(
  owning: DeletionSession,
  failures: readonly { id: string; error: unknown }[]
) {
  if (!owning.statusBar) return
  const online =
    owning.statusBar.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  const offline = !online || failures.some((failure) => isOfflineError(failure.error))
  // One notice holds every failure still waiting for its Retry, so a later failure never
  // takes the Retry of an earlier one off the bar.
  const current = failuresLive(owning) ? owning.failures! : null
  owning.failures = {
    ids: new Set([...(current?.ids ?? []), ...failures.map((failure) => failure.id)]),
    offline: (current?.offline ?? false) || offline,
    until: 0,
    noticeId: null,
    seenOnBar: false,
    covered: true,
  }
  presentFailures(owning)
}

/** Shows the Retry notice unless an Undo window is open; then it waits for the close. */
function presentFailures(owning: DeletionSession) {
  const failures = owning.failures
  const t = owning.t
  if (!failures || !t) return
  for (const id of failures.ids) {
    if (owning.controller.isPending(id)) failures.ids.delete(id)
  }
  if (failures.ids.size === 0) {
    owning.failures = null
    return
  }
  if (owning.controller.hasOpenWindow()) {
    failures.covered = true
    return
  }
  const ids = [...failures.ids]
  const shown = show(owning, 'failed', {
    message: t('wardrobe.detail.deleteFailed'),
    tone: failures.offline ? 'offline' : 'error',
    actions: [
      {
        id: 'retry',
        kind: 'retry',
        label: t('feedback.retry'),
        onPress: () => retry(owning, ids),
      },
    ],
  })
  if (!shown) return
  failures.covered = false
  failures.noticeId = shown.id
  failures.seenOnBar = false
  failures.until = readNow() + shown.durationMs
}

function showDeleted(owning: DeletionSession) {
  if (!owning.t || !owning.statusBar) return
  const message = owning.t('wardrobe.detail.deleteSucceeded')
  // A Retry on the bar stays there: another piece's "Deleted" is only announced.
  if (failuresLive(owning) && !owning.failures!.covered) {
    if (!speaks(owning)) return
    const seq = ++deleteNoticeSeq
    owning.statusBar.announce(message, {
      announcementId: createAnnouncementToken(`${NOTICE_PREFIX}deleted`, seq),
    })
    return
  }
  show(owning, 'deleted', { message, tone: 'success' })
}

function handleEvent(owning: DeletionSession, event: DeferredGarmentDeletionEvent) {
  if (!speaks(owning)) return
  handleOneEvent(owning, event)
  if (owning.controller.hasOpenWindow()) return
  // No Undo window is open any more: a held "Deleted" shows, then the Retry of any failure
  // that another notice covered or that waited for the window, so the Retry stays on top.
  if (owning.deletedToAnnounce) {
    owning.deletedToAnnounce = false
    showDeleted(owning)
  }
  if (failuresLive(owning) && owning.failures!.covered) presentFailures(owning)
}

function handleOneEvent(owning: DeletionSession, event: DeferredGarmentDeletionEvent) {
  if (event.type === 'scheduled') {
    // The member deleted this piece again; its old Retry no longer applies.
    owning.failures?.ids.delete(event.id)
    return
  }
  if (event.type === 'committed') {
    owning.commits.delete(event.id)
    owning.failures?.ids.delete(event.id)
    owning.onCommitted?.(event.id)
    if (owning.announceOnCommit.delete(event.id)) {
      if (owning.controller.hasOpenWindow()) owning.deletedToAnnounce = true
      else showDeleted(owning)
    }
    return
  }
  if (event.type === 'failed') {
    owning.announceOnCommit.delete(event.id)
    owning.commits.delete(event.id)
    return
  }
  // Only the member's Undo cancels a window.
  if (event.type === 'undone' && owning.t) {
    owning.commits.delete(event.id)
    show(owning, 'undone', {
      message: owning.t('wardrobe.detail.deleteUndone'),
      tone: 'neutral',
    })
    return
  }
  if (event.type === 'failuresToReport') addFailures(owning, event.failures)
}

/** The session of `owner`, started when the tab holds a new member (ending the last one). */
function acquireSession(owner: string | null): DeletionSession {
  if (session && session.owner === owner && session.live) return session
  if (session) endSession(session, { send: true })
  const created: DeletionSession = {
    owner,
    controller: injectedControllerFactory?.(owner) ?? createDeferredGarmentDeletion(),
    live: true,
    commits: new Map(),
    announceOnCommit: new Set(),
    deletedToAnnounce: false,
    lastNoticeId: null,
    failures: null,
    statusBar: null,
    t: null,
    onCommitted: null,
    readBearer: () => null,
    unsubscribe: () => undefined,
    stopWatchingOwner: () => undefined,
  }
  created.unsubscribe = created.controller.subscribe((event) =>
    handleEvent(created, event)
  )
  // The tab can change member with no Closet mounted (sign-out or a switch from another
  // page): the session ends then, so its notice leaves the bar at once (D11).
  if (typeof window !== 'undefined') {
    const onSessionChange = () => {
      if (currentWebSessionOwner() !== created.owner) endSession(created, { send: true })
    }
    window.addEventListener('couture:session', onSessionChange)
    window.addEventListener('storage', onSessionChange)
    created.stopWatchingOwner = () => {
      window.removeEventListener('couture:session', onSessionChange)
      window.removeEventListener('storage', onSessionChange)
    }
  }
  session = created
  return created
}

/**
 * The Closet's view of its member's deletes. `pendingIds` are hidden from the grid;
 * `onCommitted` runs once the server confirmed a delete while this Closet is mounted.
 */
export function useGarmentDeletion({
  owner,
  readBearer,
  onCommitted,
}: {
  /** The member this Closet belongs to; the parent keys the Closet by it. */
  owner: string | null
  /** The bearer of the account that taps Delete; its commit speaks for that account. */
  readBearer: () => string | null
  onCommitted: (garmentId: string) => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [owning] = useState(() => acquireSession(owner))
  const controller = owning.controller
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(controller.pendingIds())
  )
  const statusBar = useStatusBar()
  owning.statusBar = statusBar
  // Every bar change renders the Closet: note when the Retry notice is on screen, so its later
  // absence reads as dismissed or replaced.
  const failures = owning.failures
  if (failures?.noticeId && statusBar.notice?.id === failures.noticeId)
    failures.seenOnBar = true
  owning.t = t
  owning.readBearer = readBearer
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted

  useEffect(() => {
    owning.onCommitted = (garmentId) => onCommittedRef.current(garmentId)
    const unsubscribe = controller.subscribe(() => {
      setPendingIds(new Set(controller.pendingIds()))
    })
    setPendingIds(new Set(controller.pendingIds()))
    // Hiding the page sends every pending delete at once; keepalive lets it outlive the page.
    const flushOnHide = () => void controller.flush({ keepalive: true })
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushOnHide()
    }
    window.addEventListener('pagehide', flushOnHide)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushOnHide)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      unsubscribe()
      owning.onCommitted = null
      // Leaving the Closet sends whatever is still inside its Undo window. The session keeps
      // listening, so a failure still shows "Could not delete" with a working Retry on the
      // root status bar (D6), and a later Closet hears that Retry's answer.
      void controller.flush()
    }
  }, [controller, owning])

  const requestDelete = (garmentId: string, mode: GarmentDeleteMode) => {
    if (!speaks(owning)) return
    // A piece the usage read no longer finds still gets the idempotent DELETE at once, so a
    // legal hold that landed after the list read records the request (D4).
    if (mode === 'immediate' || mode === 'gone') {
      owning.announceOnCommit.add(garmentId)
      void controller.commitNow(garmentId, commitFor(owning, garmentId))
      return
    }
    if (!controller.schedule(garmentId, commitFor(owning, garmentId))) return
    show(owning, 'scheduled', {
      message: t('wardrobe.detail.deleteSucceeded'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => undoDelete(owning, garmentId),
        },
      ],
    })
  }

  return { pendingIds, requestDelete }
}

function undoDelete(owning: DeletionSession, garmentId: string) {
  if (!speaks(owning) || !owning.t) return
  // Inside the window the `undone` event says "Undone".
  if (owning.controller.undo(garmentId)) return
  // Too late to undo. While the send is still out, its answer speaks: "Deleted" on commit or
  // "Could not delete" on failure. Once it landed, say "Deleted" again.
  if (owning.controller.isPending(garmentId)) {
    owning.announceOnCommit.add(garmentId)
    return
  }
  showDeleted(owning)
}
