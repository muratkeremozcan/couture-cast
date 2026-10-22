// Story 6.5 owner (D7/D8): push binding ownership rules against real PostgreSQL.
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { createUser, persistUser } from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const service = new PushRegistrationService(prisma)

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
const device = () =>
  ({
    installationId: randomUUID(),
    token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
    platform: 'ios',
    permission: 'granted',
  }) as const
const conflictCode = (work: Promise<unknown>) =>
  work.then(
    () => 'resolved',
    (error: unknown) =>
      error && typeof error === 'object' && 'getResponse' in error
        ? ((error as { getResponse: () => { code?: string } }).getResponse().code ??
          'other')
        : 'other'
  )

describe('push binding ownership', () => {
  it('admits five active installations per member and refuses a sixth', async () => {
    const owner = await member()
    for (let index = 0; index < 5; index++) await service.register(owner, device())
    expect(await conflictCode(service.register(owner, device()))).toBe(
      'registration_limit'
    )
    expect((await service.list(owner)).registrations).toHaveLength(5)
  })

  it('keeps the generation for an unchanged re-registration and bumps it for a change', async () => {
    const owner = await member()
    const input = device()
    const first = await service.register(owner, input)
    const again = await service.register(owner, input)
    expect(again).toMatchObject({
      registrationId: first.registrationId,
      bindingGeneration: first.bindingGeneration,
    })
    // A change without naming the binding it replaces is refused.
    expect(
      await conflictCode(service.register(owner, { ...input, permission: 'denied' }))
    ).toBe('binding_changed')
    const changed = await service.register(owner, {
      ...input,
      permission: 'denied',
      expectedBinding: {
        registrationId: first.registrationId,
        bindingGeneration: first.bindingGeneration,
      },
    })
    expect(changed.registrationId).toBe(first.registrationId)
    expect(changed.bindingGeneration).toBe(first.bindingGeneration + 1)
  })

  it('transfers a live binding only with the exact expected binding and an explicit transfer', async () => {
    const previous = await member()
    const next = await member()
    const input = device()
    const bound = await service.register(previous, input)
    const expectedBinding = {
      registrationId: bound.registrationId,
      bindingGeneration: bound.bindingGeneration,
    }
    expect(
      await conflictCode(service.register(next, { ...input, expectedBinding }))
    ).toBe('binding_changed')
    expect(
      await conflictCode(
        service.register(next, {
          ...input,
          expectedBinding: { ...expectedBinding, bindingGeneration: 99 },
          transfer: true,
        })
      )
    ).toBe('binding_changed')
    const moved = await service.register(next, {
      ...input,
      expectedBinding,
      transfer: true,
    })
    expect(moved.bindingGeneration).toBe(bound.bindingGeneration + 1)
    expect((await service.list(previous)).registrations).toEqual([])
    expect((await service.list(next)).registrations).toEqual([moved])
  })

  it('merges a token and an installation that were bound to different rows', async () => {
    const owner = await member()
    const a = device()
    const b = device()
    const byInstallation = await service.register(owner, a)
    await service.register(owner, b)
    // The device now reports installation a with the token that row b holds.
    const merged = await service.register(owner, {
      ...a,
      token: b.token,
      expectedBinding: {
        registrationId: byInstallation.registrationId,
        bindingGeneration: byInstallation.bindingGeneration,
      },
    })
    expect(merged.registrationId).toBe(byInstallation.registrationId)
    expect(await prisma.pushToken.count({ where: { user_id: owner } })).toBe(1)
    expect(
      await prisma.pushToken.findUniqueOrThrow({ where: { id: merged.registrationId } })
    ).toMatchObject({ token: b.token, installation_id: a.installationId })
  })

  it('settles concurrent first registrations of one device on a single binding', async () => {
    const owner = await member()
    const input = device()
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => service.register(owner, input))
    )
    const bound = outcomes.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? [outcome.value.registrationId] : []
    )
    expect(bound.length).toBeGreaterThan(0)
    expect(new Set(bound).size).toBe(1)
    expect(
      await prisma.pushToken.count({ where: { installation_id: input.installationId } })
    ).toBe(1)
  })
})
