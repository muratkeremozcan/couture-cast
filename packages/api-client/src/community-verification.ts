// Story 6.5 owner (D3): community content stays on screen only while access was verified
// recently. A `recovering` signal keeps shown content for at most the revalidation bound
// after the last successful authorization, and a foreground restore keeps content hidden
// until a catch-up verifies access again.
import type { CommunityTransportState } from './realtime/community-transport'

/** D1/D3: at most this long between successful authorizations of shown content. */
export const COMMUNITY_VERIFICATION_BOUND_MS = 8000
/** The server revalidates a live socket at least this often (4 to 6 s with jitter). */
export const COMMUNITY_SOCKET_REVALIDATION_MS = 6000

export type CommunityVisibility = {
  /** Whether verified content may stay on screen after this change. */
  visible: boolean
  /** Whether a catch-up should run now to verify access over HTTP. */
  verify: boolean
}

export class CommunityVerification {
  private verifiedAt = Number.NEGATIVE_INFINITY
  private socketVerified = false
  private restoring = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly stale: () => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Call before a foreground catch-up: nothing shows until it verifies access again. */
  foreground() {
    this.restoring = true
    this.socketVerified = false
    this.clear()
  }

  /** Feed every availability change; the answer says what the view may show. */
  update(state: CommunityTransportState, realtime = false): CommunityVisibility {
    const now = this.now()
    if (state === 'connected') {
      // A completed catch-up is an HTTP authorization; a live socket keeps being
      // revalidated by the server until it drops.
      this.verifiedAt = now
      this.socketVerified = realtime
      this.restoring = false
      this.clear()
      return { visible: true, verify: false }
    }
    if (state !== 'recovering') {
      this.socketVerified = false
      this.clear()
      return { visible: false, verify: false }
    }
    // A socket that just dropped was last revalidated at most one interval ago, so
    // that is when access was last verified. Verify again over HTTP right away.
    const verify = this.socketVerified
    if (verify)
      this.verifiedAt = Math.max(this.verifiedAt, now - COMMUNITY_SOCKET_REVALIDATION_MS)
    this.socketVerified = false
    const remaining = this.verifiedAt + COMMUNITY_VERIFICATION_BOUND_MS - now
    this.clear()
    if (this.restoring || remaining <= 0) return { visible: false, verify }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.stale()
    }, remaining)
    return { visible: true, verify }
  }

  stop() {
    this.clear()
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
