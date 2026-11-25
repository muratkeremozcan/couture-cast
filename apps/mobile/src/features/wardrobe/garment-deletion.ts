// Story CC-7.6: the native garment delete. The detail is a pushed stack screen and pops back to
// the hub before the Undo window ends, so the deferred deletion lives at module level: the
// detail requests the delete, the hub hides the piece, and this module shows Deleted, Undo and
// Retry through the root status bar the hub hands it. The notices and their actions outlive a
// hub mount, so a Retry pressed after the member left the Closet still has its answer heard.
// D11: every notice, action and late answer belongs to the account identity epoch it started
// under; once the app holds another account, it says nothing and its notice leaves the bar.
import {
  createDeferredGarmentDeletion,
  isOfflineError,
  createAnnouncementToken,
  type DeferredGarmentDeletionCommit,
  type DeferredGarmentDeletionController,
  type DeferredGarmentDeletionEvent,
  type StatusBarNoticeInput,
} from '@couture/utils'

import {
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { deleteGarmentFromMobile } from '@/src/lib/wardrobe'

/**
 * How the detail asks for a delete: inside an Undo window, at once after the prompt, or at once
 * because the usage read answered 404 `GARMENT_NOT_FOUND`. A gone piece still gets the
 * idempotent DELETE, so a legal hold that landed after the list read records the request (D4).
 */
export type GarmentDeleteMode = 'deferred' | 'immediate' | 'gone'

/** The root status bar and strings, as the hub hands them over. */
export interface GarmentDeletionPresenter {
  showNotice: (input: StatusBarNoticeInput) => { id: string; durationMs: number }
  dismissNotice: (noticeId?: string) => void
  isOnline: () => boolean
  t: (key: string) => string
}

export interface GarmentDeletionHub {
  /** The account identity epoch the hub belongs to. */
  epoch: number
  presenter: GarmentDeletionPresenter
  /** The hub's grid update once the server confirmed a delete. */
  onCommitted: (garmentId: string) => void
}

export interface MobileGarmentDeletionDependencies {
  readEpoch: () => number
  /** The verified bearer of the account the app holds now; Retry reads it when pressed. */
  resolveAccessToken: () => Promise<string | null | undefined>
  subscribeIdentity: (listener: () => void) => () => void
}

export interface MobileGarmentDeletion {
  readonly controller: DeferredGarmentDeletionController
  /** Requests a delete under the bearer of the account that tapped Delete. */
  request: (garmentId: string, mode: GarmentDeleteMode, accessToken: string) => void
  /**
   * D9: sends each failed delete again at once, alone, with no new Undo window, under the
   * bearer the app holds when Retry is pressed. Nothing is sent once the app holds another
   * account than `epoch`.
   */
  retry: (garmentIds: readonly string[], epoch: number) => Promise<void>
  undo: (garmentId: string) => boolean
  pendingIds: () => string[]
  /** Hands over the hub's status bar and grid; the returned function detaches the grid. */
  attach: (hub: GarmentDeletionHub) => () => void
  /** Runs when the hidden set changes. */
  subscribe: (listener: () => void) => () => void
  /** Test seam (D10): drops every pending delete, notice and hub without sending anything. */
  reset: () => void
  /** Stops following the controller and the account; for an instance a test built. */
  dispose: () => void
}

const NOTICE_PREFIX = 'garment-delete-'

const defaultDependencies: MobileGarmentDeletionDependencies = {
  readEpoch: mobileIdentityEpoch,
  resolveAccessToken: resolveMobileAccessToken,
  subscribeIdentity: subscribeMobileApplicationUser,
}

export function createMobileGarmentDeletion(
  controller: DeferredGarmentDeletionController = createDeferredGarmentDeletion(),
  dependencies: Partial<MobileGarmentDeletionDependencies> = {}
): MobileGarmentDeletion {
  const { readEpoch, resolveAccessToken, subscribeIdentity } = {
    ...defaultDependencies,
    ...dependencies,
  }
  const listeners = new Set<() => void>()
  const announceOnCommit = new Set<string>()
  // The identity epoch each delete was requested under, kept through a failure until its
  // notice shows.
  const epochs = new Map<string, number>()
  let presenter: GarmentDeletionPresenter | null = null
  let hub: GarmentDeletionHub | null = null
  let lastNoticeId: string | null = null
  let failureNotice: { ids: string[]; epoch: number; until: number } | null = null
  let noticeSeq = 0
  // A confirmed delete or Retry that landed while another delete was inside its Undo window:
  // its "Deleted" waits for that window to close, so it never takes the Undo off the bar.
  let deletedToAnnounce: number | null = null
  let heldEpoch = readEpoch()

  const show = (
    epoch: number,
    kind: string,
    notice: Omit<StatusBarNoticeInput, 'id' | 'announcementId'>
  ) => {
    if (!presenter || epoch !== readEpoch()) return null
    const seq = ++noticeSeq
    const shown = presenter.showNotice({
      ...notice,
      id: `${NOTICE_PREFIX}${kind}-${seq}`,
      announcementId: createAnnouncementToken(`${NOTICE_PREFIX}${kind}`, seq),
    })
    lastNoticeId = shown.id
    return shown
  }

  const showDeleted = (epoch: number) => {
    if (!presenter) return
    show(epoch, 'deleted', {
      message: presenter.t('wardrobe.detail.deleteSucceeded'),
      tone: 'success',
    })
  }

  const showFailed = (epoch: number, garmentIds: readonly string[], offline: boolean) => {
    if (!presenter) return
    // One notice holds every failure still waiting for its Retry, so a later failure never
    // takes the Retry of an earlier one off the bar.
    const earlier =
      failureNotice && failureNotice.epoch === epoch && failureNotice.until > Date.now()
        ? failureNotice.ids
        : []
    const ids = [...new Set([...earlier, ...garmentIds])].filter(
      (id) => !controller.isPending(id)
    )
    if (ids.length === 0) return
    const shown = show(epoch, 'failed', {
      message: presenter.t('wardrobe.detail.deleteFailed'),
      tone: offline ? 'offline' : 'error',
      actions: [
        {
          id: 'retry',
          kind: 'retry',
          label: presenter.t('feedback.retry'),
          onPress: () => void deletion.retry(ids, epoch),
        },
      ],
    })
    failureNotice = shown ? { ids, epoch, until: Date.now() + shown.durationMs } : null
  }

  const reportFailures = (failures: readonly { id: string; error: unknown }[]) => {
    const current = readEpoch()
    const mine = failures.filter((failure) => epochs.get(failure.id) === current)
    for (const failure of failures) epochs.delete(failure.id)
    if (mine.length === 0 || !presenter) return
    const offline =
      !presenter.isOnline() || mine.some((failure) => isOfflineError(failure.error))
    showFailed(
      current,
      mine.map((failure) => failure.id),
      offline
    )
  }

  const showScheduled = (garmentId: string, epoch: number) => {
    if (!presenter) return
    show(epoch, 'scheduled', {
      message: presenter.t('wardrobe.detail.deleteSucceeded'),
      tone: 'success',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: presenter.t('feedback.undo'),
          onPress: () => {
            // Too late to undo: while the send is out its answer is announced; once it
            // landed, say "Deleted" again with no Undo. An account change sends this delete
            // and silences its answer first, so a late tap from the last account shows nothing.
            if (!deletion.undo(garmentId) && !controller.isPending(garmentId)) {
              showDeleted(epoch)
            }
          },
        },
      ],
    })
  }

  const handleCommitted = (garmentId: string, epoch: number) => {
    epochs.delete(garmentId)
    if (failureNotice) {
      failureNotice.ids = failureNotice.ids.filter((id) => id !== garmentId)
    }
    const announce = announceOnCommit.delete(garmentId)
    if (epoch !== readEpoch()) return
    // The hub updates its grid and tells the other screens; with no hub mounted (a Retry
    // after leaving the Closet) Capsules and Today still hear it.
    if (hub?.epoch === epoch) hub.onCommitted(garmentId)
    else notifyWardrobeChanged()
    if (announce) {
      if (controller.hasOpenWindow()) deletedToAnnounce = epoch
      else showDeleted(epoch)
    }
  }

  const handle = (event: DeferredGarmentDeletionEvent) => {
    for (const listener of [...listeners]) listener()
    // The last open window closed: a held "Deleted" shows now, before any failure report
    // that the same close releases, so the failure's Retry is what stays on the bar.
    if (deletedToAnnounce !== null && !controller.hasOpenWindow()) {
      const epoch = deletedToAnnounce
      deletedToAnnounce = null
      showDeleted(epoch)
    }
    if (event.type === 'failuresToReport') {
      reportFailures(event.failures)
      return
    }
    const epoch = epochs.get(event.id)
    // A delete with no recorded account (dropped by reset) belongs to no one.
    if (epoch === undefined) return
    if (event.type === 'scheduled') {
      showScheduled(event.id, epoch)
      return
    }
    if (event.type === 'undone') {
      epochs.delete(event.id)
      if (!presenter) return
      show(epoch, 'undone', {
        message: presenter.t('wardrobe.detail.deleteUndone'),
        tone: 'neutral',
      })
      return
    }
    if (event.type === 'committed') {
      handleCommitted(event.id, epoch)
      return
    }
    if (event.type === 'failed') announceOnCommit.delete(event.id)
  }
  const stopFollowingController = controller.subscribe(handle)

  // A new account: the last one's notice leaves the bar and what is still inside its window is
  // sent with that account's own bearer, its answer heard by no one (D11).
  const stopFollowingIdentity = subscribeIdentity(() => {
    const epoch = readEpoch()
    if (epoch === heldEpoch) return
    heldEpoch = epoch
    if (lastNoticeId) presenter?.dismissNotice(lastNoticeId)
    lastNoticeId = null
    failureNotice = null
    deletedToAnnounce = null
    void controller.flush()
  })

  const commitFor =
    (garmentId: string, accessToken: string): DeferredGarmentDeletionCommit =>
    () =>
      deleteGarmentFromMobile(accessToken, garmentId)

  const deletion: MobileGarmentDeletion = {
    controller,
    request(garmentId, mode, accessToken) {
      if (controller.isPending(garmentId)) return
      epochs.set(garmentId, readEpoch())
      if (mode === 'immediate' || mode === 'gone') {
        announceOnCommit.add(garmentId)
        void controller.commitNow(garmentId, commitFor(garmentId, accessToken))
        return
      }
      controller.schedule(garmentId, commitFor(garmentId, accessToken))
    },
    async retry(garmentIds, epoch) {
      if (epoch !== readEpoch()) return
      // Its pieces are being sent again; a later failure notice must not offer them twice.
      if (failureNotice?.epoch === epoch) failureNotice = null
      let accessToken: string | null | undefined = null
      try {
        accessToken = await resolveAccessToken()
      } catch {
        accessToken = null
      }
      // The app may hold another account by the time the bearer read answers.
      if (epoch !== readEpoch()) return
      if (!accessToken) {
        // No bearer to send under: the pieces stay back and Retry stays offered.
        showFailed(epoch, garmentIds, !presenter?.isOnline())
        return
      }
      for (const garmentId of garmentIds) {
        if (controller.isPending(garmentId)) continue
        epochs.set(garmentId, epoch)
        announceOnCommit.add(garmentId)
        void controller.retry(garmentId, commitFor(garmentId, accessToken))
      }
    },
    undo(garmentId) {
      if (controller.undo(garmentId)) return true
      // Too late to undo while the send is still out: its answer is announced, "Deleted" on
      // commit or "Could not delete" on failure.
      if (controller.isPending(garmentId)) announceOnCommit.add(garmentId)
      return false
    },
    pendingIds: () => controller.pendingIds(),
    attach(next) {
      hub = next
      presenter = next.presenter
      return () => {
        // The root status bar outlives the hub, so a Retry still shows its answer there.
        if (hub === next) hub = null
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      controller.reset()
      announceOnCommit.clear()
      epochs.clear()
      hub = null
      presenter = null
      lastNoticeId = null
      failureNotice = null
      deletedToAnnounce = null
      heldEpoch = readEpoch()
    },
    dispose() {
      stopFollowingController()
      stopFollowingIdentity()
    },
  }
  return deletion
}

/** The app's one garment deletion; the detail and the hub share it. */
export const garmentDeletion = createMobileGarmentDeletion()

/** D10: tests call this between cases so a pending delete never leaks into the next one. */
export function resetGarmentDeletionForTests(): void {
  garmentDeletion.reset()
}
