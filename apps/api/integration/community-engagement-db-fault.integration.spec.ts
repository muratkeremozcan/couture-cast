// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  engagementHarness,
  settle,
  until,
  type EngagementHarness,
} from './helpers/community-engagement-harness.js'
let h: EngagementHarness
beforeEach(async () => {
  h = await engagementHarness()
}, 30_000)
afterEach(async () => {
  await h?.close()
}, 30_000)
describe('6.5-INT-019..024 actual server guard lifetime under process/network faults', () => {
  it('provider acceptance followed by a real transaction rollback remains terminal unknown', async () => {
    const f = await h.fixture()
    const proxy = await h.proxy()
    const { child } = await h.sender({ proxy: proxy.url })
    await h.provider.call('mode', 'accept-hold')
    const operation = settle(child.call('dispatch', f.delivery.id))
    await h.provider.event('request')
    expect((await h.ledger())[0]).toMatchObject({ accepted: true })
    await proxy.child.call('cut')
    await h.provider.call('release')
    await operation
    expect(
      await h.prisma.communityTokenDelivery.findUnique({ where: { id: f.delivery.id } })
    ).toMatchObject({ status: 'unknown' })
    expect(
      await h.prisma.communityDeliveryAttempt.findFirst({
        where: { delivery_id: f.delivery.id },
      })
    ).toMatchObject({ status: 'unknown' })
    expect(await h.prisma.communityDeliveryReceipt.count()).toBe(0)
    await child.call('dispatch', f.delivery.id)
    expect(await h.ledger()).toHaveLength(1)
  }, 10_000)

  it.each(['pause', 'cut'] as const)(
    'a suspended sender with TCP %s cannot retain privacy guards beyond the server limit',
    async (fault) => {
      const f = await h.fixture()
      const proxy = await h.proxy()
      const sender = await h.sender({ proxy: proxy.url })
      await h.provider.call('mode', 'hold')
      const operation = settle(sender.child.call('dispatch', f.delivery.id))
      await h.provider.event('request')
      const locks = await h.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM pg_locks WHERE pid=${sender.backend} AND locktype='advisory' AND granted`
      expect(Number(locks[0]!.count)).toBeGreaterThan(0)
      sender.child.signal('SIGSTOP')
      const start = performance.now()
      await proxy.child.call(fault)
      await new CommunityRepository(h.prisma).requestErasureForUser(
        f.actor.id,
        new Date()
      )
      const elapsedMs = performance.now() - start
      expect(elapsedMs).toBeLessThan(4000)
      const remaining = await h.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM pg_locks WHERE pid=${sender.backend} AND locktype='advisory' AND granted`
      expect(Number(remaining[0]!.count)).toBe(0)
      expect(
        await h.prisma.communityArtifactSubject.count({
          where: { member_id: f.actor.id },
        })
      ).toBe(0)
      sender.child.signal('SIGCONT')
      await proxy.child.call('resume')
      await h.provider.call('release')
      await operation
      await h.worker.recover()
      expect(await h.ledger()).toHaveLength(1)
      console.log(
        JSON.stringify({
          evidence: 'server-guard-release',
          fault,
          elapsedMs,
          version: h.version,
          providerCalls: 1,
        })
      )
    },
    15_000
  )
  it('connection loss after final authorization but before actual HTTP bytes honors the local deadline', async () => {
    const f = await h.fixture()
    const proxy = await h.proxy()
    const { child } = await h.sender({ proxy: proxy.url })
    await child.call('barrier', 'transport')
    const operation = settle(child.call('dispatch', f.delivery.id))
    await child.event('authorized')
    const start = performance.now()
    expect(await h.ledger()).toHaveLength(0)
    await proxy.child.call('cut')
    await until(
      () => Promise.resolve(performance.now() - start),
      (ms) => ms > 2050,
      3000
    )
    await child.call('continue')
    await operation
    expect(await h.ledger()).toHaveLength(0)
    expect(
      await h.prisma.communityTokenDelivery.findUnique({ where: { id: f.delivery.id } })
    ).toMatchObject({ status: 'unknown' })
    await child.call('dispatch', f.delivery.id)
    expect(await h.ledger()).toHaveLength(0)
  }, 10_000)
})
