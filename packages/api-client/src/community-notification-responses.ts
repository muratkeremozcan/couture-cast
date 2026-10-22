// Story 6.5 owner: OS response dedupe, bounded buffering and authenticated routing readiness.
import {
  communityNotificationDataSchema,
  type CommunityNotificationData,
} from './contracts/http/community-sync'

export class CommunityNotificationResponses {
  private readonly pending = new Map<string, CommunityNotificationData>()
  private readonly consumed = new Set<string>()
  private stopped = false
  constructor(
    private readonly options: {
      ready: () => boolean
      open: (payload: CommunityNotificationData) => void
      consumed: () => void
    }
  ) {}
  receive(data: unknown, action: string) {
    if (this.stopped) return
    const parsed = communityNotificationDataSchema.safeParse(data)
    if (!parsed.success) return
    const key = `${parsed.data.notificationId}:${action}`
    if (this.consumed.has(key)) return
    if (this.pending.size >= 32)
      this.pending.delete(this.pending.keys().next().value ?? '')
    this.pending.set(key, parsed.data)
    this.drain()
  }
  drain() {
    if (this.stopped || !this.options.ready()) return
    for (const [key, payload] of this.pending) {
      // Expiry remains in the routed payload so the destination announces safe fallback.
      // Resolve current visibility only after the authenticated destination opens.
      this.options.open(payload)
      this.pending.delete(key)
      this.consumed.add(key)
      if (this.consumed.size > 256)
        this.consumed.delete(this.consumed.values().next().value ?? '')
      this.options.consumed()
    }
  }
  stop() {
    this.stopped = true
    this.pending.clear()
    this.consumed.clear()
  }
}
