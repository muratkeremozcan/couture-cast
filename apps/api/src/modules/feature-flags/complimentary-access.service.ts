// Story 6.14 owner: the one read seam for complimentary full access.
import { setTimeout as delay } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  getFeatureFlag as resolveFeatureFlag,
  type FeatureFlagStoredValue,
} from '@couture/config'
import { createBaseLogger } from '../../logger/pino.config'

import {
  InjectRemoteFeatureFlagProvider,
  type RemoteFeatureFlagProvider,
} from './remote-feature-flag-provider'

/** The fixed system subject the kill switch is evaluated for; never a member id. */
export const COMPLIMENTARY_ACCESS_KILL_SWITCH_SUBJECT = 'complimentary-access-kill-switch'

/** Remote deadline for the kill switch when the caller brings no signal of its own. */
export const COMPLIMENTARY_KILL_SWITCH_DEADLINE_MS = 500

export type ComplimentaryAccessCheck = 'granted' | 'not_granted' | 'unavailable'

export type ComplimentaryAccessReadOptions = {
  /** Bounds the kill-switch remote read; the community refresh passes its invocation signal. */
  readonly signal?: AbortSignal
  /**
   * Runs each database read (the grant and the kill-switch fallback row); the community
   * refresh wraps them in its connection budget.
   */
  readonly runGrantRead?: <T>(read: () => Promise<T>) => Promise<T>
  /**
   * A cap on the whole answer, grant read and kill switch together. Past it the answer is
   * false, so the caller still has time for its own remote call (TEA-04, TEA-22). The kill
   * switch's remote read gets 80% of it, then falls back to the `FeatureFlag` row.
   */
  readonly budgetMs?: number
}

/**
 * Story 6.14 D2: answers whether a member currently has complimentary full access.
 *
 * True only when an unrevoked `ComplimentaryAccessGrant` exists for the member AND the
 * `complimentary_access_enabled` kill switch evaluates true. The grant is read first, so the
 * kill switch (and PostHog) is asked only for a granted member, and it is asked for one fixed
 * system subject, never for the member. The premium check, the per-member flag shortcut, the
 * community flag cache and through it push dispatch all ask this one method.
 *
 * Depends on Prisma and the remote provider only: `FeatureFlagsService` already injects
 * `CommunityFlagEvaluationService`, which injects this, so this may never inject it back.
 *
 * Fails closed: any error or timeout answers false and logs a closed code with no member id.
 * Nothing is cached in process, so a revoke is visible on the member's next request.
 */
@Injectable()
export class ComplimentaryAccessService {
  private readonly logger = createBaseLogger().child({ feature: 'complimentary-access' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @InjectRemoteFeatureFlagProvider() private readonly remote: RemoteFeatureFlagProvider
  ) {}

  async isActive(
    memberId: string,
    options: ComplimentaryAccessReadOptions = {}
  ): Promise<boolean> {
    return (await this.check(memberId, options)) === 'granted'
  }

  /**
   * The three-way answer behind `isActive`. `unavailable` (an error, or the budget ran out)
   * is no grant for the caller's request; the community refresh also uses it to avoid
   * caching an answer it could not establish.
   */
  async check(
    memberId: string,
    options: ComplimentaryAccessReadOptions = {}
  ): Promise<ComplimentaryAccessCheck> {
    const budgetMs = options.budgetMs
    const answer = this.answer(memberId, options)
    const outcome =
      budgetMs === undefined
        ? await answer
        : await Promise.race([
            answer,
            delay(Math.max(1, Math.floor(budgetMs))).then(() => 'unavailable' as const),
          ])
    if (outcome === 'unavailable') {
      this.logger.warn(
        { code: 'complimentary_access_unavailable' },
        'complimentary_access_unavailable'
      )
    }
    return outcome
  }

  private async answer(
    memberId: string,
    options: ComplimentaryAccessReadOptions
  ): Promise<ComplimentaryAccessCheck> {
    // Both database reads (the grant and the kill-switch fallback row) go through the
    // caller's connection gate, so the community budget accounts for them (Story 6.5).
    const runRead = <T>(read: () => Promise<T>) =>
      options.runGrantRead ? options.runGrantRead(read) : read()
    try {
      const grant = await runRead(() =>
        this.prisma.complimentaryAccessGrant.findFirst({
          where: { member_id: memberId, revoked_at: null },
          select: { id: true },
        })
      )
      if (!grant) return 'not_granted'
      // The kill switch's PostHog read gets most of the budget, so an ordinary ~150 ms answer
      // lands, and the rest is left for the fallback row when PostHog is slow or down.
      const remoteMs =
        options.budgetMs === undefined
          ? COMPLIMENTARY_KILL_SWITCH_DEADLINE_MS
          : Math.max(1, Math.floor(options.budgetMs * 0.8))
      const timeout = AbortSignal.timeout(remoteMs)
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      return (await this.killSwitchOpen(signal, runRead)) === true
        ? 'granted'
        : 'not_granted'
    } catch {
      return 'unavailable'
    }
  }

  private async killSwitchOpen(
    bound: AbortSignal,
    runRead: <T>(read: () => Promise<T>) => Promise<T>
  ): Promise<FeatureFlagStoredValue> {
    return resolveFeatureFlag(
      'complimentary_access_enabled',
      COMPLIMENTARY_ACCESS_KILL_SWITCH_SUBJECT,
      {
        readRemoteFlag: (key, subjectId) =>
          Promise.race([
            this.remote.getFeatureFlagValue(key, subjectId, { signal: bound }),
            aborted(bound),
          ]),
        readFallbackFlag: async (key) => {
          const row = await runRead(() =>
            this.prisma.featureFlag.findUnique({ where: { key } })
          )
          return (row?.value as FeatureFlagStoredValue | undefined) ?? null
        },
      }
    )
  }
}

/** Resolves undefined once the signal aborts, so a slow remote falls through to the row. */
async function aborted(signal: AbortSignal): Promise<undefined> {
  if (signal.aborted) return undefined
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  )
  return undefined
}
