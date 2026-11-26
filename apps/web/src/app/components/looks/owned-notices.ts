// Story CC-7.12 (Codex TEA review #3): status bar notices a saved look screen shows belong to the
// member who acted. They outlive the screen (Remove leaves it with Undo on the bar), so they are
// tracked here and dismissed as soon as another member, or nobody, holds the session.
import { currentWebSessionOwner } from '../../../lib/use-web-session'

const CAP = 20
const owned = new Map<string, { owner: string; dismiss: () => void }>()
let listening = false

function sweep() {
  const live = currentWebSessionOwner()
  for (const [id, entry] of owned) {
    if (entry.owner === live) continue
    owned.delete(id)
    entry.dismiss()
  }
}

/** Ties notice `id` to `owner`; `dismiss` runs once the session no longer holds that owner. */
export function trackOwnedNotice(id: string, owner: string, dismiss: () => void): void {
  owned.set(id, { owner, dismiss })
  while (owned.size > CAP) {
    const oldest = owned.keys().next().value
    if (oldest === undefined) break
    owned.delete(oldest)
  }
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('couture:session', sweep)
    window.addEventListener('storage', sweep)
  }
}
