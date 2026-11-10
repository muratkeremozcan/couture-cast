// Story 6.14 TEA, slice 5: the community flag cache with complimentary grants, on real
// Postgres. These are the TEA-01 and TEA-04 proofs: a grant or revoke is visible on the
// next request with no 503, an in-flight refresh can never write a stale answer back,
// and a slow grant read or kill switch never turns a cold read into a 503.
//
// Races are forced with a gate inside the complimentary seam: the refresh is paused
// after it has its grant answer and before it writes the cache row.
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  ageCacheRow,
  cacheRow,
  gate,
  grant,
  member,
  never,
  recordingRemote,
  revoke,
  seedFlag,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
} from '../src/modules/community/community-availability.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })

beforeAll(async () => {
  await database.migrate()
  await seedMemberFlagsOff(prisma)
}, 120_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

type Seam = ConstructorParameters<typeof CommunityFlagEvaluationService>[2]

function evaluator(remote = recordingRemote(), seam?: Seam) {
  const complimentary = seam ?? new ComplimentaryAccessService(prisma, remote.provider)
  return {
    remote,
    service: new CommunityFlagEvaluationService(prisma, remote.provider, complimentary),
  }
}

/** The real seam, paused by `held` after it has its answer. */
function pausedSeam(
  remote: ReturnType<typeof recordingRemote>,
  held: ReturnType<typeof gate>
) {
  const real = new ComplimentaryAccessService(prisma, remote.provider)
  return {
    isActive: async (...args: Parameters<Seam['isActive']>) => {
      const answer = await real.isActive(...args)
      await held.pass()
      return answer
    },
    check: async (...args: Parameters<Seam['check']>) => {
      const answer = await real.check(...args)
      await held.pass()
      return answer
    },
  } satisfies Seam
}

const value = async (service: CommunityFlagEvaluationService, id: string) =>
  (await service.evaluate(id, new CommunityAuthorizationBudget())).value

describe('complimentary grants in the community flag cache', () => {
  it('I-CACHE-KEYED: a grant writes true for the grantee only, and its invalidation deletes only the grantee row', async () => {
    const a = await member(prisma)
    const b = await member(prisma)
    const { service } = evaluator()
    expect(await value(service, a)).toBe(false)
    expect(await value(service, b)).toBe(false)
    const bBefore = await cacheRow(prisma, b)

    await grant(prisma, a)
    expect(await cacheRow(prisma, a)).toBeNull()
    expect(await cacheRow(prisma, b)).toEqual(bBefore)

    expect(await value(service, a)).toBe(true)
    expect((await cacheRow(prisma, a))?.remote_value).toBe(true)
    expect(await cacheRow(prisma, b)).toEqual(bBefore)
  })

  it('I-CACHE-GRANT-IMMEDIATE: a grant after a fresh false answer opens the next request with no 503', async () => {
    const id = await member(prisma)
    const { service } = evaluator()
    // A fresh claim: false, cached for 60 s, next claim 45 s away.
    expect(await value(service, id)).toBe(false)

    await grant(prisma, id)
    expect(await value(service, id)).toBe(true)
  })

  it('I-CACHE-REVOKE-IMMEDIATE: a revoke after a fresh true answer closes the next request with no 503', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const { service } = evaluator()
    expect(await value(service, id)).toBe(true)

    await revoke(prisma, id)
    expect(await value(service, id)).toBe(false)
  })

  it('I-CACHE-REVOKE-INFLIGHT: a refresh that read the grant before a revoke never writes its true back', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const held = gate()
    const remote = recordingRemote()
    const { service } = evaluator(remote, pausedSeam(remote, held))

    const inflight = service.evaluate(id, new CommunityAuthorizationBudget()).then(
      (grantAnswer) => ({ ok: true as const, value: grantAnswer.value }),
      (error: unknown) => ({ ok: false as const, error })
    )
    await held.arrived
    await revoke(prisma, id)
    held.open()
    const outcome = await inflight

    // The paused request may answer 503 (its lease is gone) but never true.
    if (outcome.ok) expect(outcome.value).toBe(false)
    else expect(outcome.error).toBeInstanceOf(CommunityUnavailableException)
    expect((await cacheRow(prisma, id))?.remote_value ?? null).not.toBe(true)
    expect(await value(evaluator().service, id)).toBe(false)
  })

  it('I-CACHE-GRANT-INFLIGHT: a refresh that read no grant before a grant never writes its false back', async () => {
    const id = await member(prisma)
    const held = gate()
    const remote = recordingRemote()
    const { service } = evaluator(remote, pausedSeam(remote, held))

    const inflight = service.evaluate(id, new CommunityAuthorizationBudget()).then(
      (grantAnswer) => ({ ok: true as const, value: grantAnswer.value }),
      (error: unknown) => ({ ok: false as const, error })
    )
    await held.arrived
    await grant(prisma, id)
    held.open()
    const outcome = await inflight

    if (outcome.ok) expect(outcome.value).toBe(true)
    else expect(outcome.error).toBeInstanceOf(CommunityUnavailableException)
    expect((await cacheRow(prisma, id))?.remote_value ?? null).not.toBe(false)
    expect(await value(evaluator().service, id)).toBe(true)
  })

  it('U-REFRESH-BOUNDED: a hanging grant read still lets the remote answer inside the budget', async () => {
    const id = await member(prisma)
    const remote = recordingRemote({ community_read_enabled: true })
    // The real seam over a client whose grant read never returns: the seam owns its bound.
    const hangingGrantRead = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === 'complimentaryAccessGrant')
          return new Proxy({}, { get: () => () => never() })
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const { service } = evaluator(
      remote,
      new ComplimentaryAccessService(hangingGrantRead, remote.provider)
    )

    const started = performance.now()
    expect(await value(service, id)).toBe(true)
    expect(performance.now() - started).toBeLessThan(1_950)
  })

  it('U-REFRESH-ERROR: a failing grant read falls through to the remote answer', async () => {
    const id = await member(prisma)
    const remote = recordingRemote({ community_read_enabled: true })
    // The real seam over a client whose grant table read fails.
    const failingGrantRead = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === 'complimentaryAccessGrant')
          return new Proxy(
            {},
            { get: () => () => Promise.reject(new Error('grant read failed')) }
          )
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const { service } = evaluator(
      remote,
      new ComplimentaryAccessService(failingGrantRead, remote.provider)
    )

    expect(await value(service, id)).toBe(true)
  })

  it('I-KILL-REMOTE-SLOW: a hanging kill-switch remote still answers a cold grantee inside the budget', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const remote = recordingRemote({ complimentary_access_enabled: () => never() })
    const { service } = evaluator(remote)

    const started = performance.now()
    expect(await value(service, id)).toBe(true)
    expect(performance.now() - started).toBeLessThan(1_950)
  })

  it('I-KILL-COMMUNITY-BOUND: the kill switch off reaches a cached true row only when the row expires, 60 s after it was written', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const { service } = evaluator()
    expect(await value(service, id)).toBe(true)
    const row = await cacheRow(prisma, id)
    expect(row!.expires_at!.getTime() - row!.remote_evaluated_at!.getTime()).toBe(60_000)

    await seedFlag(prisma, 'complimentary_access_enabled', false)
    expect(await value(service, id)).toBe(true)

    await ageCacheRow(prisma, id)
    expect(await value(service, id)).toBe(false)
    await prisma.featureFlag.deleteMany({
      where: { key: 'complimentary_access_enabled' },
    })
  })
})
