// Story CC-7.6: the native garment delete. The detail is a pushed stack screen and pops back to
// the hub before the Undo window ends, so the deferred deletion lives at module level: the
// detail requests the delete, and the hub (which stays mounted under it) hides the piece and
// shows Deleted, Undo and Retry through the root status bar.
import {
  createDeferredGarmentDeletion,
  type DeferredGarmentDeletionCommit,
  type DeferredGarmentDeletionController,
} from '@couture/utils'

import { mobileIdentityEpoch } from '@/src/lib/mobile-auth'
import { deleteGarmentFromMobile } from '@/src/lib/wardrobe'

/**
 * How the detail asks for a delete: inside an Undo window, at once after the prompt, or at once
 * because the usage read answered 404 `GARMENT_NOT_FOUND`. A gone piece still gets the
 * idempotent DELETE, so a legal hold that landed after the list read records the request (D4).
 */
export type GarmentDeleteMode = 'deferred' | 'immediate' | 'gone'

/**
 * What the hub hears. `scheduled`: hidden with an Undo window. `undone`: back in the grid.
 * `committed`: the server confirmed; `announce` is true when the member has not been told yet
 * (a confirmed delete or a Retry). `failed`: back in the grid with Retry. `changed`: the hidden
 * set changed. `epoch` is the account identity epoch the delete was requested under; a hub of
 * another account ignores the event, so it never offers a Retry that speaks for the old account.
 */
export type GarmentDeletionEvent =
  | { type: 'scheduled'; id: string; epoch: number }
  | { type: 'undone'; id: string; epoch: number }
  | { type: 'committed'; id: string; announce: boolean; epoch: number }
  | { type: 'failed'; id: string; error: unknown; epoch: number }
  | { type: 'changed' }

export interface MobileGarmentDeletion {
  readonly controller: DeferredGarmentDeletionController
  /** Requests a delete under the bearer of the account that tapped Delete. */
  request: (garmentId: string, mode: GarmentDeleteMode, accessToken: string) => void
  /**
   * D9: sends a failed delete again at once, with no new Undo window, under the bearer the
   * caller reads now (a failed send keeps no token).
   */
  retry: (garmentId: string, accessToken: string) => void
  undo: (garmentId: string) => boolean
  pendingIds: () => string[]
  subscribe: (listener: (event: GarmentDeletionEvent) => void) => () => void
  /** Test seam (D10): drops every pending delete without sending it. */
  reset: () => void
}

export function createMobileGarmentDeletion(
  controller: DeferredGarmentDeletionController = createDeferredGarmentDeletion()
): MobileGarmentDeletion {
  const listeners = new Set<(event: GarmentDeletionEvent) => void>()
  const announceOnCommit = new Set<string>()
  // The identity epoch each delete was requested under.
  const epochs = new Map<string, number>()
  const emit = (event: GarmentDeletionEvent) => {
    for (const listener of [...listeners]) listener(event)
  }

  controller.subscribe((event) => {
    emit({ type: 'changed' })
    const epoch = epochs.get(event.id)
    // A delete with no recorded account (dropped by reset) belongs to no hub.
    if (epoch === undefined) return
    if (event.type === 'scheduled') {
      emit({ type: 'scheduled', id: event.id, epoch })
      return
    }
    if (event.type === 'undone') {
      epochs.delete(event.id)
      emit({ type: 'undone', id: event.id, epoch })
      return
    }
    if (event.type === 'committed') {
      epochs.delete(event.id)
      emit({
        type: 'committed',
        id: event.id,
        announce: announceOnCommit.delete(event.id),
        epoch,
      })
      return
    }
    if (event.type === 'failed') {
      epochs.delete(event.id)
      announceOnCommit.delete(event.id)
      emit({ type: 'failed', id: event.id, error: event.error, epoch })
    }
  })

  const commitFor =
    (garmentId: string, accessToken: string): DeferredGarmentDeletionCommit =>
    () =>
      deleteGarmentFromMobile(accessToken, garmentId)

  return {
    controller,
    request(garmentId, mode, accessToken) {
      if (controller.isPending(garmentId)) return
      epochs.set(garmentId, mobileIdentityEpoch())
      if (mode === 'immediate' || mode === 'gone') {
        announceOnCommit.add(garmentId)
        void controller.commitNow(garmentId, commitFor(garmentId, accessToken))
        return
      }
      controller.schedule(garmentId, commitFor(garmentId, accessToken))
    },
    retry(garmentId, accessToken) {
      if (controller.isPending(garmentId)) return
      epochs.set(garmentId, mobileIdentityEpoch())
      announceOnCommit.add(garmentId)
      void controller.commitNow(garmentId, commitFor(garmentId, accessToken))
    },
    undo(garmentId) {
      if (controller.undo(garmentId)) return true
      // Too late to undo while the send is still out: its answer is announced, "Deleted" on
      // commit or "Could not delete" on failure.
      if (controller.isPending(garmentId)) announceOnCommit.add(garmentId)
      return false
    },
    pendingIds: () => controller.pendingIds(),
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
    },
  }
}

/** The app's one garment deletion; the detail and the hub share it. */
export const garmentDeletion = createMobileGarmentDeletion()

/** D10: tests call this between cases so a pending delete never leaks into the next one. */
export function resetGarmentDeletionForTests(): void {
  garmentDeletion.reset()
}
