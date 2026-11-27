// Story CC-7.12 (Codex TEA review #3): status bar notices a saved look screen shows belong to the
// member who acted. They outlive the screen (Remove leaves it with Undo on the bar), so they are
// tracked here and dismissed as soon as the identity changes.
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'

const CAP = 20
const owned = new Map<string, { owner: string; epoch: number; dismiss: () => void }>()
let unsubscribe: (() => void) | null = null

function sweep() {
  const live = mobileApplicationUserId()
  const epoch = mobileIdentityEpoch()
  for (const [id, entry] of owned) {
    if (entry.owner === live && entry.epoch === epoch) continue
    owned.delete(id)
    entry.dismiss()
  }
}

/** Ties notice `id` to the acting identity; `dismiss` runs once that identity is gone. */
export function trackOwnedNotice(
  id: string,
  owner: string,
  epoch: number,
  dismiss: () => void
): void {
  owned.set(id, { owner, epoch, dismiss })
  while (owned.size > CAP) {
    const oldest = owned.keys().next().value
    if (oldest === undefined) break
    owned.delete(oldest)
  }
  unsubscribe ??= subscribeMobileApplicationUser(sweep)
}
