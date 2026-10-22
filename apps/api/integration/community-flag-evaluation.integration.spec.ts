// Story 6.5 owner: cross-process rollout evaluation against real PostgreSQL claims.
//
// The wall-clock 45/60 timeline is the acceptance lane; these cases pin the claim
// coordination branches every request takes: an unknown member, a second instance waiting
// on another owner's refresh, and a caller that joined a shorter-lived flight.
import { PrismaClient } from '@prisma/client'
import { createUser, persistUser } from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { until } from './helpers/community-engagement-harness.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
} from '../src/modules/community/community-availability.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })

beforeAll(async () => {
  await database.migrate()
}, 60_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

const member = async () =>
  (
    await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
  ).id
function heldRemote() {
  let release!: (value: boolean) => void
  const answer = new Promise<boolean>((resolve) => {
    release = resolve
  })
  let calls = 0
  return {
    provider: {
      getFeatureFlagValue: () => {
        calls++
        return answer
      },
    },
    release: (value: boolean) => release(value),
    calls: () => calls,
  }
}

describe('community flag evaluation claims', () => {
  it('reports an unknown member as unavailable with the default retry, without a remote call', async () => {
    const remote = heldRemote()
    const service = new CommunityFlagEvaluationService(prisma, remote.provider)
    const outcome = await service
      .evaluate('member-without-subject')
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBe(2)
    expect(remote.calls()).toBe(0)
  })

  it('serves a second instance the refresh another instance owns once it lands', async () => {
    const id = await member()
    const remote = heldRemote()
    const owner = new CommunityFlagEvaluationService(prisma, remote.provider)
    const waiter = new CommunityFlagEvaluationService(prisma, remote.provider)
    const owned = owner.evaluate(id)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    // The second instance finds the live claim and waits on it instead of claiming again.
    const waiting = waiter.evaluate(id)
    setTimeout(() => remote.release(true), 150)
    const [first, second] = await Promise.all([owned, waiting])
    expect(first.value).toBe(true)
    expect(second.value).toBe(true)
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime())
    expect(remote.calls()).toBe(1)
  })

  it('reports unavailable with the claim cadence when another owner never lands its refresh', async () => {
    const id = await member()
    const remote = heldRemote()
    const owner = new CommunityFlagEvaluationService(prisma, remote.provider)
    const waiter = new CommunityFlagEvaluationService(prisma, remote.provider)
    const owned = owner.evaluate(id).catch((error: unknown) => error)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    const outcome = await waiter.evaluate(id).catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    // The claim set the next claim 45 s out; the retry names that cadence, not 2 s.
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBeGreaterThan(
      40
    )
    expect(await owned).toBeInstanceOf(CommunityUnavailableException)
    remote.release(true)
    expect(remote.calls()).toBe(1)
  })

  it('lets a caller with a longer budget retry when the flight it joined expires first', async () => {
    const id = await member()
    const remote = heldRemote()
    const service = new CommunityFlagEvaluationService(prisma, remote.provider)
    const short = service
      .evaluate(id, new CommunityAuthorizationBudget(performance.now() + 300))
      .catch((error: unknown) => error)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    // Joins the in-flight evaluation, which carries the shorter deadline.
    const long = service.evaluate(id).catch((error: unknown) => error)
    expect(await short).toBeInstanceOf(CommunityUnavailableException)
    const outcome = await long
    // The joined flight failed at its own deadline; the longer caller started its own
    // evaluation rather than inheriting that failure, and is bounded by its own budget.
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBeGreaterThan(
      40
    )
    remote.release(true)
  })
})
