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
  /** Speaks a message to the screen reader without changing the bar. */
  announce: (message: string, announcementId: string) => void
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
  /** The clock a failure notice's expiry is measured against (D10 seam). */
  now: () => number
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
  /**
   * The hub reports the notice on the root bar at each render, so a Retry the member
   * dismissed or another feature's notice replaced reads as ended.
   */
  observeBar: (noticeId: string | null) => void
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
  now: () => Date.now(),
}

export function createMobileGarmentDeletion(
  controller: DeferredGarmentDeletionController = createDeferredGarmentDeletion(),
  dependencies: Partial<MobileGarmentDeletionDependencies> = {}
): MobileGarmentDeletion {
  const { readEpoch, resolveAccessToken, subscribeIdentity, now } = {
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
  /**
   * Failed pieces still offered a Retry. Their notice shows only while no Undo window is
   * open; another notice that covers it (an Undo, "Undone") brings it back once no window is
   * open, and it ends when it expires on screen, its pieces are sent again, or they are
   * deleted (D9).
   */
  let failures: {
    ids: Set<string>
    epoch: number
    offline: boolean
    /** When the notice on screen expires; 0 while it waits to show. */
    until: number
    /** The Retry notice on screen, and whether the bar was seen showing it. */
    noticeId: string | null
    seenOnBar: boolean
    covered: boolean
  } | null = null
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
    // Any other notice takes a showing failure off the bar; it comes back later.
    if (kind !== 'failed' && failuresLive() && failures) failures.covered = true
    const seq = ++noticeSeq
    const shown = presenter.showNotice({
      ...notice,
      id: `${NOTICE_PREFIX}${kind}-${seq}`,
      announcementId: createAnnouncementToken(`${NOTICE_PREFIX}${kind}`, seq),
    })
    lastNoticeId = shown.id
    return shown
  }

  let barNoticeId: string | null = null

  function failuresLive(): boolean {
    if (!failures) return false
    const showing = !failures.covered && failures.until > 0
    // A showing Retry ends when it expires, or when the member dismissed it or another
    // feature's notice replaced it after the bar was seen showing it.
    const replaced = failures.seenOnBar && barNoticeId !== failures.noticeId
    const ended =
      failures.epoch !== readEpoch() || (showing && (failures.until <= now() || replaced))
    if (ended) failures = null
    return !ended
  }

  const showDeleted = (epoch: number) => {
    if (!presenter) return
    const message = presenter.t('wardrobe.detail.deleteSucceeded')
    // A Retry on the bar stays there: another piece's "Deleted" is only announced.
    if (failuresLive() && failures && !failures.covered) {
      if (epoch !== readEpoch()) return
      const seq = ++noticeSeq
      presenter.announce(message, createAnnouncementToken(`${NOTICE_PREFIX}deleted`, seq))
      return
    }
    show(epoch, 'deleted', { message, tone: 'success' })
  }

  /** Shows the Retry notice unless an Undo window is open; then it waits for the close. */
  const presentFailures = () => {
    if (!presenter || !failures) return
    for (const id of failures.ids) if (controller.isPending(id)) failures.ids.delete(id)
    if (failures.ids.size === 0) {
      failures = null
      return
    }
    if (controller.hasOpenWindow()) {
      failures.covered = true
      return
    }
    const { epoch } = failures
    const ids = [...failures.ids]
    const shown = show(epoch, 'failed', {
      message: presenter.t('wardrobe.detail.deleteFailed'),
      tone: failures.offline ? 'offline' : 'error',
      actions: [
        {
          id: 'retry',
          kind: 'retry',
          label: presenter.t('feedback.retry'),
          onPress: () => void deletion.retry(ids, epoch),
        },
      ],
    })
    if (!shown || !failures) return
    failures.covered = false
    failures.noticeId = shown.id
    failures.seenOnBar = false
    failures.until = now() + shown.durationMs
  }

  /** One notice holds every failure still waiting for its Retry. */
  const addFailures = (
    epoch: number,
    garmentIds: readonly string[],
    offline: boolean
  ) => {
    const current = failuresLive() && failures?.epoch === epoch ? failures : null
    failures = {
      ids: new Set([...(current?.ids ?? []), ...garmentIds]),
      epoch,
      offline: (current?.offline ?? false) || offline,
      until: 0,
      noticeId: null,
      seenOnBar: false,
      covered: true,
    }
    presentFailures()
  }

  const reportFailures = (reported: readonly { id: string; error: unknown }[]) => {
    const current = readEpoch()
    const mine = reported.filter((failure) => epochs.get(failure.id) === current)
    for (const failure of reported) epochs.delete(failure.id)
    if (mine.length === 0 || !presenter) return
    const offline =
      !presenter.isOnline() || mine.some((failure) => isOfflineError(failure.error))
    addFailures(
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
    failures?.ids.delete(garmentId)
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
    handleOne(event)
    if (controller.hasOpenWindow()) return
    // No Undo window is open any more: a held "Deleted" shows, then the Retry of any failure
    // that another notice covered or that waited for the window, so the Retry stays on top.
    if (deletedToAnnounce !== null) {
      const epoch = deletedToAnnounce
      deletedToAnnounce = null
      showDeleted(epoch)
    }
    if (failuresLive() && failures?.covered) presentFailures()
  }

  const handleOne = (event: DeferredGarmentDeletionEvent) => {
    if (event.type === 'failuresToReport') {
      reportFailures(event.failures)
      return
    }
    const epoch = epochs.get(event.id)
    // A delete with no recorded account (dropped by reset) belongs to no one.
    if (epoch === undefined) return
    if (event.type === 'scheduled') {
      // The member deleted this piece again; its old Retry no longer applies.
      failures?.ids.delete(event.id)
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
    failures = null
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
      if (failures?.epoch === epoch) {
        for (const garmentId of garmentIds) failures.ids.delete(garmentId)
        if (failures.ids.size === 0) failures = null
      }
      let accessToken: string | null | undefined = null
      try {
        accessToken = await resolveAccessToken()
      } catch {
        accessToken = null
      }
      // The app may hold another account by the time the bearer read answers.
      if (epoch !== readEpoch()) return
      if (!accessToken) {
        // No bearer to send under: the pieces stay back and Retry stays offered, after any
        // Undo window that opened meanwhile.
        addFailures(epoch, garmentIds, !presenter?.isOnline())
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
    observeBar(noticeId) {
      barNoticeId = noticeId
      if (failures?.noticeId && noticeId === failures.noticeId) failures.seenOnBar = true
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
      failures = null
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
