// Story 6.5 owner: remote-only, cross-process member rollout evaluation.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  InjectRemoteFeatureFlagProvider,
  type RemoteFeatureFlagProvider,
} from './remote-feature-flag-provider.js'

import {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
  type CommunityGrant,
} from '../community/community-availability.js'
export { CommunityUnavailableException } from '../community/community-availability.js'
type Evaluation = CommunityGrant
type CacheRow = {
  remote_value: boolean | null
  expires_at: Date | null
  next_claim_at: Date
  refresh_owner: string | null
  refresh_until: Date | null
  remote_evaluated_at: Date | null
  subject_generation: number
  now: Date
}

@Injectable()
export class CommunityFlagEvaluationService {
  private readonly flights = new Map<
    string,
    { promise: Promise<Evaluation>; deadline: number }
  >()
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @InjectRemoteFeatureFlagProvider() private readonly remote: RemoteFeatureFlagProvider
  ) {}

  async evaluate(
    memberId: string,
    budget = new CommunityAuthorizationBudget()
  ): Promise<Evaluation> {
    let flight = this.flights.get(memberId)
    if (!flight) {
      const promise = this.resolve(memberId, budget).catch((error: unknown) => {
        if (error instanceof CommunityUnavailableException) throw error
        throw new CommunityUnavailableException()
      })
      flight = { promise, deadline: budget.deadline }
      this.flights.set(memberId, flight)
      const owned = flight
      void promise
        .finally(() => {
          if (this.flights.get(memberId) === owned) this.flights.delete(memberId)
        })
        .catch(() => undefined)
    }
    try {
      const result = await budget.run(() => flight.promise)
      budget.check(result)
      return result
    } catch (error) {
      if (
        error instanceof CommunityUnavailableException &&
        flight.deadline < budget.deadline &&
        performance.now() >= flight.deadline
      ) {
        budget.check()
        if (this.flights.get(memberId) === flight) this.flights.delete(memberId)
        return this.evaluate(memberId, budget)
      }
      throw error
    }
  }

  private async read(
    member: string,
    budget: CommunityAuthorizationBudget
  ): Promise<CacheRow | undefined> {
    const timeout = Math.min(500, budget.remaining())
    return budget.run(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeout}ms'`)
          return (
            await tx.$queryRaw<CacheRow[]>`
        SELECT e.*,clock_timestamp() AS now FROM "CommunityFlagEvaluation" e
        JOIN "CommunitySubject" s ON s.member_id=e.member_id AND s.generation=e.subject_generation
        WHERE e.member_id=${member} AND e.flag_key='community_read_enabled'
      `
          )[0]
        },
        { timeout, maxWait: budget.remaining() }
      )
    )
  }

  private valid(row: CacheRow | undefined, observedAt: number): Evaluation | undefined {
    if (row?.remote_value === null || row?.remote_value === undefined || !row.expires_at)
      return undefined
    const validUntil = observedAt + row.expires_at.getTime() - row.now.getTime()
    if (performance.now() >= validUntil) return undefined
    return { value: row.remote_value, expiresAt: row.expires_at, validUntil }
  }

  private async resolve(
    member: string,
    budget: CommunityAuthorizationBudget
  ): Promise<Evaluation> {
    let observedAt = performance.now()
    let row = await this.read(member, budget)
    const valid = this.valid(row, observedAt)
    if (
      valid &&
      row?.remote_evaluated_at &&
      row.now.getTime() - row.remote_evaluated_at.getTime() < 45000
    )
      return valid
    const owner = randomUUID()
    const claimStarted = performance.now()
    const claiming = this.claim(member, owner, budget)
    void claiming
      .then(async (late) => {
        if (late && performance.now() >= budget.deadline)
          await this.releaseFailedClaim(member, owner, late.subject_generation)
      })
      .catch(() => undefined)
    const claim = await budget.run(() => claiming)
    if (claim) {
      const refreshObservedAt = performance.now()
      const refreshed = this.valid(
        await this.refresh(member, owner, claim, budget, claimStarted),
        refreshObservedAt
      )
      // The guarded UPDATE returns the persisted, generation-checked row after
      // commit. Its database clock keeps the original expiry, and observing
      // before the transaction makes the monotonic lifetime conservative.
      if (refreshed) return refreshed
    }
    // Never return the pre-claim observation. Its lease may have expired while claiming.
    do {
      observedAt = performance.now()
      row = await this.read(member, budget)
      const refreshed = this.valid(row, observedAt)
      if (refreshed) return refreshed
      if (!row?.refresh_until || row.refresh_until <= row.now) break
      const remaining = Math.min(
        budget.remaining(),
        row.refresh_until.getTime() - row.now.getTime()
      )
      if (remaining <= 0) break
      await delay(Math.min(25 + Math.floor(Math.random() * 20), remaining))
    } while (budget.remaining() > 0)
    const retry = row
      ? Math.max(1, Math.ceil((row.next_claim_at.getTime() - row.now.getTime()) / 1000))
      : 2
    throw new CommunityUnavailableException(retry)
  }

  private async claim(
    member: string,
    owner: string,
    budget: CommunityAuthorizationBudget
  ): Promise<CacheRow | undefined> {
    // Another instance can hold an uncommitted INSERT for this member. Its
    // lock timeout rolls back only our transaction; the original deadline and
    // guarded claim UPDATE still govern every retry and remote invocation.
    for (let attempt = 0; ; attempt++) {
      budget.check()
      let inserting = false
      try {
        const timeout = Math.min(400, budget.remaining())
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
            await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${member}]::text[],ARRAY[]::text[],false)`
            inserting = true
            await tx.$executeRaw`
            INSERT INTO "CommunityFlagEvaluation" (member_id,flag_key,subject_generation)
              SELECT member_id,'community_read_enabled',generation FROM "CommunitySubject" WHERE member_id = ${member}
              ON CONFLICT DO NOTHING
          `
            inserting = false
            return (
              await tx.$queryRaw<CacheRow[]>`
            UPDATE "CommunityFlagEvaluation" e SET refresh_owner = ${owner}::uuid,
              refresh_until = clock_timestamp() + interval '2 seconds',
              remote_evaluated_at = CASE WHEN remote_value IS NULL THEN NULL ELSE remote_evaluated_at END,
              next_claim_at = clock_timestamp() + interval '45 seconds', last_used_at = clock_timestamp()
            FROM "CommunitySubject" s WHERE e.member_id = ${member} AND e.flag_key = 'community_read_enabled'
              AND s.member_id = e.member_id AND s.generation = e.subject_generation
              AND e.next_claim_at <= clock_timestamp() AND (e.refresh_until IS NULL OR e.refresh_until <= clock_timestamp())
            RETURNING e.*, next_claim_at - interval '45 seconds' AS now
          `
            )[0]
          },
          { timeout, maxWait: budget.remaining() }
        )
      } catch (error) {
        if (
          !inserting ||
          attempt >= 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2010' ||
          error.meta?.code !== '55P03'
        )
          throw error
        await delay(Math.min(25, budget.remaining()))
      }
    }
  }

  private async refresh(
    member: string,
    owner: string,
    claim: CacheRow,
    budget: CommunityAuthorizationBudget,
    claimStarted: number
  ) {
    const origin = claim.now
    const invokeBy = Math.min(budget.deadline - 100, claimStarted + 1000)
    if (performance.now() >= invokeBy) {
      await this.releaseFailedClaim(member, owner, claim.subject_generation)
      return
    }
    const invocationDeadline = Math.min(
      performance.now() + 1000,
      budget.deadline - 100,
      claimStarted + 1900
    )
    let value: unknown
    try {
      const signal = AbortSignal.timeout(
        Math.max(1, Math.floor(invocationDeadline - performance.now()))
      )
      // The provider is remote-only. Synthetic fallback values never enter this table.
      value = await Promise.race([
        this.remote.getFeatureFlagValue('community_read_enabled', member, { signal }),
        delay(Math.max(1, Math.floor(invocationDeadline - performance.now()))).then(
          () => undefined
        ),
      ])
    } catch {
      value = undefined
    }
    if (typeof value !== 'boolean' || performance.now() >= invocationDeadline) {
      await this.releaseFailedClaim(member, owner, claim.subject_generation)
      return
    }
    try {
      return await budget.run(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
            await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${member}]::text[],ARRAY[]::text[],false)`
            // No upsert: erasure or an expired owner can never recreate a cache result.
            return (
              await tx.$queryRaw<CacheRow[]>`
        UPDATE "CommunityFlagEvaluation" e SET remote_value = ${value}, remote_evaluated_at = ${origin},
          expires_at = ${origin} + interval '60 seconds', refresh_until = NULL, refresh_owner = NULL
        FROM "CommunitySubject" s WHERE e.member_id = ${member} AND e.flag_key = 'community_read_enabled'
          AND e.refresh_owner = ${owner}::uuid AND e.refresh_until > clock_timestamp()
          AND e.subject_generation = ${claim.subject_generation} AND s.member_id = e.member_id
          AND s.generation = e.subject_generation
        RETURNING e.*,clock_timestamp() AS now
      `
            )[0]
          },
          {
            timeout: Math.min(400, budget.remaining()),
            maxWait: budget.remaining(),
          }
        )
      )
    } catch (error) {
      void this.releaseFailedClaim(member, owner, claim.subject_generation).catch(
        () => undefined
      )
      throw error
    }
  }
  private async releaseFailedClaim(member: string, owner: string, generation: number) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
        await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${member}]::text[],ARRAY[]::text[],false)`
        // Failure finishes this claim without changing its original cadence or authorization.
        await tx.$executeRaw`
        UPDATE "CommunityFlagEvaluation" e SET refresh_until = NULL, refresh_owner = NULL
        FROM "CommunitySubject" s WHERE e.member_id = ${member} AND e.flag_key = 'community_read_enabled'
          AND e.refresh_owner = ${owner}::uuid AND e.refresh_until > clock_timestamp()
          AND e.subject_generation = ${generation} AND s.member_id = e.member_id AND s.generation = e.subject_generation
      `
      },
      { timeout: 400, maxWait: 100 }
    )
  }
}
