import { getRequestContext } from '../../logger/request-context.js'
// Story 6.5: one monotonic authorization budget, carried through final use.
import { HttpException, ServiceUnavailableException } from '@nestjs/common'
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
export class CommunityAuthorizationBudget {
  readonly deadline: number
  constructor(
    deadline = getRequestContext()?.communityAuthorizationDeadline ??
      performance.now() + 1950
  ) {
    this.deadline = deadline
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
export async function communityDependency<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof HttpException) throw error
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
