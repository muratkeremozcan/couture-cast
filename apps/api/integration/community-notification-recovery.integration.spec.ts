import 'reflect-metadata'
import type { Prisma } from '@prisma/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  engagementHarness,
  type EngagementHarness,
} from './helpers/community-engagement-harness.js'

let h: EngagementHarness
beforeAll(async () => {
  h = await engagementHarness()
}, 30_000)
afterAll(async () => {
  await h?.close()
}, 30_000)

it('recovers a real one-second grouping expiry with rollback and exactly one provider delivery', async () => {
  const originalGroup = h.worker.group.bind(h.worker) as () => Promise<number>
  const attach = Reflect.get(h.worker, 'attach') as (
    tx: Prisma.TransactionClient,
    ...rest: unknown[]
  ) => Promise<void>
  let expired = false
  let passes = 0
  const group = vi.spyOn(h.worker, 'group').mockImplementation(async () => {
    passes++
    if (passes === 2) {
      expect(await h.prisma.communityNotificationGroup.count()).toBe(0)
      expect(
        await h.prisma.communityNotificationIntent.count({ where: { group_id: null } })
      ).toBe(1)
      expect(await h.prisma.communityTokenDelivery.count()).toBe(0)
      expect(await h.ledger()).toEqual([])
    }
    return originalGroup()
  })
  Reflect.set(
    h.worker,
    'attach',
    async (tx: Prisma.TransactionClient, ...rest: unknown[]) => {
      if (!expired) {
        expired = true
        // Exercise the real product timeout after the group row was written.
        await tx.$queryRaw`SELECT pg_sleep(1.05)`
      }
      await Reflect.apply(attach, h.worker, [tx, ...rest])
    }
  )
  try {
    await h.fixture()
    expect(passes).toBe(2)
    expect(await h.prisma.communityNotificationGroup.count()).toBe(1)
    expect(
      await h.prisma.communityNotificationIntent.count({ where: { group_id: null } })
    ).toBe(0)
    expect(await h.prisma.communityTokenDelivery.count()).toBe(1)
    await h.worker.dispatch()
    expect(await h.ledger()).toEqual([expect.objectContaining({ accepted: true })])
    await h.worker.group()
    await h.worker.fanout()
    await h.worker.dispatch()
    expect(await h.ledger()).toHaveLength(1)
    expect(await h.prisma.communityNotificationGroup.count()).toBe(1)
    expect(await h.prisma.communityTokenDelivery.count()).toBe(1)
  } finally {
    Reflect.set(h.worker, 'attach', attach)
    group.mockRestore()
  }
}, 15_000)
