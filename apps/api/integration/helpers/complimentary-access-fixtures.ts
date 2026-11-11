// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA: shared fixtures for the complimentary access integration suites.
//
// Every override proof seeds the six member flags false in its own database and asks a
// fake remote provider that answers false, so a pass proves the override and never the
// seed (TEA-15). Each test also asserts a non-grantee control in the same database.
import { type PrismaClient } from '@prisma/client'
import { COMPLIMENTARY_MEMBER_FLAGS, type FeatureFlagKey } from '@couture/config'
import { createUser, persistUser } from '@couture/testing'
import { ComplimentaryAccessOperatorService } from '../../src/modules/commerce/complimentary-access-operator.service.js'
import { installAuthUsers, seedAdmin } from './community-sponsorship-fixtures.js'

export type RemoteCall = { flagKey: FeatureFlagKey; subjectId: string; signal: boolean }

/**
 * A remote provider that records every call. `answers` maps a flag to its answer;
 * a function answer can hang or throw. Unlisted flags answer `false`.
 */
export function recordingRemote(answers: Partial<Record<FeatureFlagKey, unknown>> = {}) {
  const calls: RemoteCall[] = []
  return {
    calls,
    provider: {
      getFeatureFlagValue: async (
        flagKey: FeatureFlagKey,
        subjectId: string,
        options?: { signal: AbortSignal }
      ): Promise<unknown> => {
        calls.push({ flagKey, subjectId, signal: Boolean(options?.signal) })
        // PostHog defines no kill-switch flag by default, so it answers undefined and the
        // row or the code default decides. Every other unlisted flag is off remotely.
        const answer =
          flagKey in answers
            ? answers[flagKey]
            : flagKey === 'complimentary_access_enabled'
              ? undefined
              : false
        return typeof answer === 'function'
          ? await (answer as (s: string, signal?: AbortSignal) => unknown)(
              subjectId,
              options?.signal
            )
          : answer
      },
    },
  }
}

/** A promise that never settles, for a dependency that hangs. */
export const never = <T>() => new Promise<T>(() => undefined)

export async function seedFlag(
  prisma: PrismaClient,
  key: FeatureFlagKey,
  value: unknown
) {
  await prisma.featureFlag.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  })
}

/** The six member flags false globally: the production shape this story must open. */
export async function seedMemberFlagsOff(prisma: PrismaClient) {
  for (const key of COMPLIMENTARY_MEMBER_FLAGS) await seedFlag(prisma, key, false)
}

export async function member(prisma: PrismaClient) {
  return (
    await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
  ).id
}

const admins = new WeakMap<PrismaClient, Promise<{ email: string; userId: string }>>()

/** One owner per database: an admin auth user and its app user (6.7b fixture). */
export function owner(prisma: PrismaClient) {
  let existing = admins.get(prisma)
  if (!existing) {
    existing = installAuthUsers(prisma).then(() => seedAdmin(prisma, 'tea-614-owner'))
    admins.set(prisma, existing)
  }
  return existing
}

async function emailOf(prisma: PrismaClient, memberId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).email
}

/**
 * Grants through the real operator service (D7): the row, the audit row and the
 * member's cache rows deleted under the privacy guards, in one transaction (TEA-01).
 */
export async function grant(prisma: PrismaClient, memberId: string) {
  const outcome = await new ComplimentaryAccessOperatorService(prisma).grant({
    actorEmail: (await owner(prisma)).email,
    memberEmail: await emailOf(prisma, memberId),
    reason: 'tea fixture grant',
    dryRun: false,
  })
  return outcome.grantId!
}

export async function revoke(prisma: PrismaClient, memberId: string) {
  await new ComplimentaryAccessOperatorService(prisma).revoke({
    actorEmail: (await owner(prisma)).email,
    memberEmail: await emailOf(prisma, memberId),
    reason: 'tea fixture revoke',
    dryRun: false,
  })
}

/** A gate a test opens when it is ready; until then the awaiting code is paused. */
export function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  let reached!: () => void
  const arrived = new Promise<void>((resolve) => {
    reached = resolve
  })
  return {
    /** Called by the paused code: reports arrival, then waits for `open`. */
    pass: async () => {
      reached()
      await opened
    },
    arrived,
    open: () => open(),
  }
}

export async function cacheRow(prisma: PrismaClient, memberId: string) {
  const rows = await prisma.$queryRaw<
    {
      remote_value: boolean | null
      expires_at: Date | null
      remote_evaluated_at: Date | null
      refresh_owner: string | null
    }[]
  >`SELECT remote_value, expires_at, remote_evaluated_at, refresh_owner FROM "CommunityFlagEvaluation"
    WHERE member_id = ${memberId} AND flag_key = 'community_read_enabled'`
  return rows[0] ?? null
}

/** Makes a cached row stale and claimable now, the state 60 s and 45 s later. */
export async function ageCacheRow(prisma: PrismaClient, memberId: string) {
  await prisma.$executeRaw`UPDATE "CommunityFlagEvaluation"
    SET expires_at = clock_timestamp() - interval '1 second',
        remote_evaluated_at = clock_timestamp() - interval '61 seconds',
        next_claim_at = clock_timestamp() - interval '1 second'
    WHERE member_id = ${memberId}`
}
