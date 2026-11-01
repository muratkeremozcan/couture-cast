import { getRequestContext } from '../../logger/request-context.js'
// Story 6.5: one monotonic authorization budget, carried through final use.
import { HttpException, ServiceUnavailableException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
import { COMMUNITY_AUTHORIZATION_BUDGET_MS } from './community-authorization-budget.js'
export class CommunityUnavailableException extends ServiceUnavailableException {
  constructor(readonly retryAfterSeconds = 2) {
    super({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'unavailable',
      retryAfterSeconds,
      message: 'Access could not be verified.',
    })
  }
}
export type CommunityGrant = { value: boolean; expiresAt: Date; validUntil: number }
let budgets = 0
export class CommunityAuthorizationBudget {
  readonly deadline: number
  /** Breaks deadline ties at a connection gate: the budget created first goes first. */
  readonly sequence = ++budgets
  constructor(
    deadline = getRequestContext()?.communityAuthorizationDeadline ??
      performance.now() + COMMUNITY_AUTHORIZATION_BUDGET_MS,
    private readonly connections?: CommunityConnectionGate
  ) {
    this.deadline = deadline
  }
  /**
   * Runs one unit of database work. A budget bound to a connection gate first waits
   * for one of the gate's connections, in deadline order; any other budget runs the
   * work at once. It never races the deadline itself, so a caller that must observe a
   * late commit still can; wrap it in `run` to answer at the deadline.
   */
  async connection<T>(work: () => Promise<T>): Promise<T> {
    if (!this.connections) return work()
    return this.connections.run(this, work)
  }
  remaining() {
    const remaining = this.deadline - performance.now()
    if (remaining <= 0) throw new CommunityUnavailableException()
    return Math.max(1, Math.floor(remaining))
  }
  check(grant?: CommunityGrant) {
    this.remaining()
    if (grant && performance.now() >= grant.validUntil)
      throw new CommunityUnavailableException()
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.check()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          const expire = () => {
            const remaining = this.deadline - performance.now()
            if (remaining > 0) {
              timer = setTimeout(expire, Math.max(1, Math.ceil(remaining)))
              return
            }
            reject(new CommunityUnavailableException())
          }
          timer = setTimeout(
            expire,
            Math.max(1, Math.ceil(this.deadline - performance.now()))
          )
        }),
      ])
      this.check()
      return result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
type GateWaiter = {
  budget: CommunityAuthorizationBudget
  admit: () => void
  timer?: ReturnType<typeof setTimeout>
}
const dueBefore = (a: CommunityAuthorizationBudget, b: CommunityAuthorizationBudget) =>
  a.deadline < b.deadline || (a.deadline === b.deadline && a.sequence < b.sequence)

/**
 * Hands one process's pooled database connections to community authorizations, at most
 * `capacity` at a time, earliest deadline first.
 *
 * A burst of handshakes (every deploy or restart reconnects an instance's sockets at
 * once) needs several short transactions per member. Prisma queues connection requests
 * in arrival order, so each member's next transaction lands behind every other member's
 * first one and the whole burst misses its budget together. Holding a slot for a whole
 * authorization kept connections idle through the remote flag call, which capped a
 * cold burst at five members per remote round trip. Gating each transaction by
 * deadline avoids both: a member part way through goes ahead of members that arrived
 * after it, and a slot is held only while a transaction needs its connection.
 */
export class CommunityConnectionGate {
  private active = 0
  private readonly waiting: GateWaiter[] = []
  constructor(private readonly capacity: number) {}

  async run<T>(budget: CommunityAuthorizationBudget, work: () => Promise<T>): Promise<T> {
    await this.acquire(budget)
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private acquire(budget: CommunityAuthorizationBudget): Promise<void> {
    budget.check()
    if (this.active < this.capacity && !this.waiting.length) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: GateWaiter = { budget, admit: resolve }
      const expire = () => {
        const remaining = budget.deadline - performance.now()
        if (remaining > 0) {
          waiter.timer = setTimeout(expire, Math.max(1, Math.ceil(remaining)))
          return
        }
        this.waiting.splice(this.waiting.indexOf(waiter), 1)
        reject(new CommunityUnavailableException())
      }
      waiter.timer = setTimeout(
        expire,
        Math.max(1, Math.ceil(budget.deadline - performance.now()))
      )
      const later = this.waiting.findIndex((other) => dueBefore(budget, other.budget))
      this.waiting.splice(later === -1 ? this.waiting.length : later, 0, waiter)
    })
  }

  private release() {
    const next = this.waiting.shift()
    if (!next) {
      this.active--
      return
    }
    // The slot passes straight to the earliest deadline, so nothing can barge in.
    clearTimeout(next.timer)
    next.admit()
  }
}

export const communityAvailabilityLogger = createBaseLogger().child({
  feature: 'community-availability',
})

/** What failed, without its message: a Prisma code and SQL state, or the error's type. */
function dependencyCause(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return {
      type: error.name,
      prismaCode: error.code,
      sqlState: (error.meta as { code?: unknown } | undefined)?.code ?? null,
    }
  return { type: error instanceof Error ? error.name : typeof error }
}

/**
 * Runs a dependency an authorization decision needs. A denial passes through;
 * anything else answers "unavailable", and is logged first, so the cause behind
 * the 503 can be found.
 */
export async function communityDependency<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof HttpException) throw error
    communityAvailabilityLogger.warn(
      { cause: dependencyCause(error) },
      'community_dependency_unavailable'
    )
    throw new CommunityUnavailableException()
  }
}

// Assistance is optional and cannot hold required authorization or head reads hostage.
export async function optionalCommunityAssist(work: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 500)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
