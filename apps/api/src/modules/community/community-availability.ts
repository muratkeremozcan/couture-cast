import { getRequestContext } from '../../logger/request-context.js'
// Story 6.5: one monotonic authorization budget, carried through final use.
import { HttpException, ServiceUnavailableException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
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
