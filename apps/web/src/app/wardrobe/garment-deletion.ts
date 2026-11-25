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
  /** The ids under the "Could not delete" notice still on screen, and when it expires. */
  failureNotice: { ids: string[]; until: number } | null
  /** The status bar and strings of the last mounted Closet (the root bar outlives it). */
  statusBar: StatusBarApi | null
  t: TFunction | null
  /** The mounted Closet's grid update, null while no Closet is mounted. */
  onCommitted: ((garmentId: string) => void) | null
  readBearer: () => string | null
  unsubscribe: () => void
}

let session: DeletionSession | null = null
let injectedControllerFactory:
  | ((owner: string | null) => DeferredGarmentDeletionController)
  | null = null
let deleteNoticeSeq = 0

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
  ending.live = false
  if (session === ending) session = null
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

function retry(owning: DeletionSession, garmentIds: readonly string[]) {
  if (!speaks(owning)) return
  // Its pieces are being sent again; a later failure notice must not offer them a second time.
  owning.failureNotice = null
  for (const garmentId of garmentIds) {
    if (owning.controller.isPending(garmentId)) continue
    // A Retry reads the bearer again, so a token that expired since is not reused.
    owning.commits.delete(garmentId)
    owning.announceOnCommit.add(garmentId)
    void owning.controller.retry(garmentId, commitFor(owning, garmentId))
  }
}

function showFailures(
  owning: DeletionSession,
  failures: readonly { id: string; error: unknown }[]
) {
  const t = owning.t
  if (!t || !owning.statusBar) return
  const online =
    owning.statusBar.isOnline &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  const offline = !online || failures.some((failure) => isOfflineError(failure.error))
  // One notice holds every failure still waiting for its Retry, so a later failure never
  // takes the Retry of an earlier one off the bar.
  const earlier =
    owning.failureNotice && owning.failureNotice.until > Date.now()
      ? owning.failureNotice.ids
      : []
  const ids = [...new Set([...earlier, ...failures.map((failure) => failure.id)])].filter(
    (id) => !owning.controller.isPending(id)
  )
  if (ids.length === 0) return
  const shown = show(owning, 'failed', {
    message: t('wardrobe.detail.deleteFailed'),
    tone: offline ? 'offline' : 'error',
    actions: [
      {
        id: 'retry',
        kind: 'retry',
        label: t('feedback.retry'),
        onPress: () => retry(owning, ids),
      },
    ],
  })
  owning.failureNotice = shown ? { ids, until: Date.now() + shown.durationMs } : null
}

function showDeleted(owning: DeletionSession) {
  if (!owning.t) return
  show(owning, 'deleted', {
    message: owning.t('wardrobe.detail.deleteSucceeded'),
    tone: 'success',
  })
}

function handleEvent(owning: DeletionSession, event: DeferredGarmentDeletionEvent) {
  if (!speaks(owning)) return
  // The last open window closed: a held "Deleted" shows now, before any failure report that
  // the same close releases, so the failure's Retry is what stays on the bar.
  if (owning.deletedToAnnounce && !owning.controller.hasOpenWindow()) {
    owning.deletedToAnnounce = false
    showDeleted(owning)
  }
  if (event.type === 'committed') {
    owning.commits.delete(event.id)
    if (owning.failureNotice) {
      owning.failureNotice.ids = owning.failureNotice.ids.filter((id) => id !== event.id)
    }
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
  // Only the member's Undo cancels a window. "Undone" shows before any failure this Undo
  // releases, so the failure's Retry is what stays on the bar.
  if (event.type === 'undone' && owning.t) {
    owning.commits.delete(event.id)
    show(owning, 'undone', {
      message: owning.t('wardrobe.detail.deleteUndone'),
      tone: 'neutral',
    })
    return
  }
  if (event.type === 'failuresToReport') showFailures(owning, event.failures)
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
    failureNotice: null,
    statusBar: null,
    t: null,
    onCommitted: null,
    readBearer: () => null,
    unsubscribe: () => undefined,
  }
  created.unsubscribe = created.controller.subscribe((event) =>
    handleEvent(created, event)
  )
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
