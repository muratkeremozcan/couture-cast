// Story CC-7.6: the Closet's garment delete. D1: an unused piece hides at once with "Deleted"
// and Undo; the DELETE is sent when the window ends, when another delete starts, when the page
// hides or when the Closet unmounts; every send uses keepalive. D2: a confirmed delete of a
// piece in use is sent at once. D6/D9: a failed send returns the piece with "Could not delete"
// and Retry, which sends at once.
'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createAnnouncementToken,
  createDeferredGarmentDeletion,
  isOfflineError,
  type DeferredGarmentDeletionCommit,
  type DeferredGarmentDeletionController,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { deleteGarmentFromWeb } from '../../lib/wardrobe'
import { useStatusBar } from '../components/save-feedback'

/**
 * How the detail asks for a delete: inside an Undo window, at once after the prompt, or at once
 * because the usage read answered 404 `GARMENT_NOT_FOUND` (already gone).
 */
export type GarmentDeleteMode = 'deferred' | 'immediate' | 'gone'

let injectedController: DeferredGarmentDeletionController | null = null

/**
 * D10 test seam. A Next page takes no props, so a test injects the controller the next Closet
 * mount uses here, and passes null to restore the default: one fresh controller per mount.
 */
export function injectWardrobeGarmentDeletionForTests(
  controller: DeferredGarmentDeletionController | null
): void {
  injectedController = controller
}

let deleteNoticeSeq = 0

/**
 * Owns one deferred deletion controller for the Closet. `pendingIds` are hidden from the grid;
 * `onCommitted` runs once the server confirmed a delete.
 */
export function useGarmentDeletion({
  readBearer,
  onCommitted,
}: {
  /** The bearer of the account that taps Delete; its commit speaks for that account. */
  readBearer: () => string | null
  onCommitted: (garmentId: string) => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [controller] = useState(
    () => injectedController ?? createDeferredGarmentDeletion()
  )
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(controller.pendingIds())
  )
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const tRef = useRef(t)
  tRef.current = t
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted
  const readBearerRef = useRef(readBearer)
  readBearerRef.current = readBearer
  // Ids whose commit is the member's confirmation: a confirmed delete or a Retry. A deferred
  // delete already said "Deleted" when it was scheduled.
  const announceOnCommitRef = useRef(new Set<string>())
  const commitsRef = useRef(new Map<string, DeferredGarmentDeletionCommit>())
  const retryRef = useRef<(garmentId: string) => void>(() => undefined)

  const show = (
    kind: string,
    notice: Omit<
      Parameters<typeof statusBar.showNotice>[0],
      'id' | 'announcementId' | 'urgency'
    >
  ) => {
    const seq = ++deleteNoticeSeq
    statusBarRef.current.showNotice({
      ...notice,
      id: `garment-delete-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`garment-delete-${kind}`, seq),
    })
  }

  const commitFor = (garmentId: string): DeferredGarmentDeletionCommit => {
    const existing = commitsRef.current.get(garmentId)
    if (existing) return existing
    const accessToken = readBearerRef.current()
    // Every send uses keepalive (the DELETE has no body), so a window that ends as the tab
    // closes or navigates still reaches the API, whether the timer or a flush sent it.
    const commit: DeferredGarmentDeletionCommit = () =>
      deleteGarmentFromWeb(garmentId, { keepalive: true, accessToken })
    commitsRef.current.set(garmentId, commit)
    return commit
  }

  useEffect(() => {
    const readOnline = () =>
      statusBarRef.current.isOnline &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    const unsubscribe = controller.subscribe((event) => {
      setPendingIds(new Set(controller.pendingIds()))
      const translate = tRef.current
      if (event.type === 'committed') {
        commitsRef.current.delete(event.id)
        onCommittedRef.current(event.id)
        if (announceOnCommitRef.current.delete(event.id)) {
          show('deleted', {
            message: translate('wardrobe.detail.deleteSucceeded'),
            tone: 'success',
          })
        }
        return
      }
      if (event.type === 'failed') {
        announceOnCommitRef.current.delete(event.id)
        // Retry reads the bearer again, so a token that expired inside the window is not reused.
        commitsRef.current.delete(event.id)
        const offline = !readOnline() || isOfflineError(event.error)
        show('failed', {
          message: translate('wardrobe.detail.deleteFailed'),
          tone: offline ? 'offline' : 'error',
          actions: [
            {
              id: 'retry',
              kind: 'retry',
              label: translate('feedback.retry'),
              onPress: () => retryRef.current(event.id),
            },
          ],
        })
      }
    })
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
      // Leaving the Closet sends whatever is still inside its Undo window. The listener stays
      // until that send settles, so a failure still shows "Could not delete" with Retry on the
      // root status bar (D6).
      void controller.flush().finally(unsubscribe)
    }
    // `show` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])

  retryRef.current = (garmentId: string) => {
    announceOnCommitRef.current.add(garmentId)
    void controller.commitNow(garmentId, commitFor(garmentId))
  }

  const requestDelete = (garmentId: string, mode: GarmentDeleteMode) => {
    // A piece the usage read no longer finds still gets the idempotent DELETE at once, so a
    // legal hold that landed after the list read records the request (D4).
    if (mode === 'immediate' || mode === 'gone') {
      announceOnCommitRef.current.add(garmentId)
      void controller.commitNow(garmentId, commitFor(garmentId))
      return
    }
    if (!controller.schedule(garmentId, commitFor(garmentId))) return
    show('scheduled', {
      message: t('wardrobe.detail.deleteSucceeded'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => {
            if (!controller.undo(garmentId)) {
              // Too late to undo. While the send is still out, its answer speaks: "Deleted" on
              // commit or "Could not delete" on failure. Once it landed, say "Deleted" again.
              if (controller.isPending(garmentId)) {
                announceOnCommitRef.current.add(garmentId)
                return
              }
              show('deleted', {
                message: tRef.current('wardrobe.detail.deleteSucceeded'),
                tone: 'success',
              })
              return
            }
            commitsRef.current.delete(garmentId)
            show('undone', {
              message: tRef.current('wardrobe.detail.deleteUndone'),
              tone: 'neutral',
            })
          },
        },
      ],
    })
  }

  return { pendingIds, requestDelete }
}
