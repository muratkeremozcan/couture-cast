// Story 6.8 Task 2 step 5 owner: bound concurrent renders in `apps/api/src/modules/share-cards/share-card-admission.ts`
type Waiting = { grant: () => void; refuse: () => void }
type Slot = { signal: AbortSignal; waiting?: Waiting }

/** One active operation and at most one replacement waiter per member. */
export class ShareCardAdmission {
  private readonly slots = new Map<string, Slot>()

  constructor(
    private readonly limit: number,
    private readonly unavailable: () => Error
  ) {}

  acquire(member: string, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(this.unavailable())
    const predecessor = this.slots.get(member)
    if (!predecessor) return Promise.resolve(this.start(member, signal))
    if (!predecessor.signal.aborted) return Promise.reject(this.unavailable())
    return new Promise((resolve, reject) => {
      const detach = () => {
        signal.removeEventListener('abort', waiting.refuse)
        if (predecessor.waiting === waiting) predecessor.waiting = undefined
      }
      const waiting: Waiting = {
        grant: () => {
          detach()
          try {
            resolve(this.start(member, signal))
          } catch {
            reject(this.unavailable())
          }
        },
        refuse: () => {
          detach()
          reject(this.unavailable())
        },
      }
      // Newer compositions supersede a queued replacement. Rendering stays
      // bounded until the predecessor's actual work releases its slot.
      predecessor.waiting?.refuse()
      predecessor.waiting = waiting
      signal.addEventListener('abort', waiting.refuse, { once: true })
      if (signal.aborted) waiting.refuse()
    })
  }

  private start(member: string, signal: AbortSignal): () => void {
    if (signal.aborted || this.slots.size >= this.limit || this.slots.has(member))
      throw this.unavailable()
    const slot: Slot = { signal }
    this.slots.set(member, slot)
    return () => {
      if (this.slots.get(member) !== slot) return
      this.slots.delete(member)
      const waiting = slot.waiting
      slot.waiting = undefined
      waiting?.grant()
    }
  }
}
