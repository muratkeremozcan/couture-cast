// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityReceiptsWorker } from '../src/modules/community/community-receipts.worker.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import { communityBuildIdentity } from '../src/modules/community/community-operational-telemetry.js'
import { PushTokenRepository } from '../src/modules/notifications/push-token.repository.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
beforeAll(() => db.migrate(), 30_000)
afterEach(() => vi.useRealTimers())
afterAll(async () => {
  await prisma.$disconnect()
  await db.drop()
})

function receiptsClass(): typeof CommunityReceiptsWorker {
  if (process.env.STORY65_RECEIPT_CLAMP_MUTANT !== '1') return CommunityReceiptsWorker
  const path = resolve(__dirname, '../src/modules/community/community-receipts.worker.ts')
  const source = readFileSync(path, 'utf8')
  const clamp = 'Math.min(receipt.expires_at.getTime(), Date.now() + minutes * 60_000)'
  expect(source.split(clamp)).toHaveLength(2)
  const code = transpileModule(source.replace(clamp, 'Date.now() + minutes * 60_000'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText
  const localRequire = createRequire(path)
  const exports = {} as { CommunityReceiptsWorker: typeof CommunityReceiptsWorker }
  runInNewContext(
    code,
    {
      exports,
      Date,
      AbortSignal,
      fetch,
      process,
      require: (id: string): unknown =>
        id === './community-operational-telemetry.js'
          ? { communityBuildIdentity }
          : (localRequire(id) as unknown),
    },
    { filename: `${path}.unclamped-mutant` }
  )
  console.info(
    JSON.stringify({
      evidence: 'T04-receipt-negative-control',
      originalSha256: createHash('sha256').update(source).digest('hex'),
      mutation: 'remove receipt poll expiry clamp',
      canonicalSourceWritten: false,
    })
  )
  return exports.CommunityReceiptsWorker
}

describe('T04 actual receipt 24-hour boundary', () => {
  it('clamps a pending provider lookup to attempt expiry, then settles without another lookup or send', async () => {
    const expires = new Date('2030-01-02T12:00:00.000Z')
    const started = new Date(expires.getTime() - 86_400_000)
    const beforeExpiry = new Date(expires.getTime() - 500)
    const group = await prisma.communityNotificationGroup.create({
      data: {
        eligible_at: started,
        next_attempt_at: started,
        expires_at: expires,
        snapshot_at: started,
        status: 'snapshotted',
      },
    })
    const delivery = await prisma.communityTokenDelivery.create({
      data: {
        group_id: group.id,
        registration_id: randomUUID(),
        binding_generation: 1,
        status: 'accepted',
        next_attempt_at: started,
      },
    })
    const attempt = await prisma.communityDeliveryAttempt.create({
      data: {
        delivery_id: delivery.id,
        ordinal: 1,
        status: 'accepted',
        lease_owner: randomUUID(),
        lease_until: new Date(started.getTime() + 10_000),
        guard_until: new Date(started.getTime() + 3000),
        started_at: started,
        completed_at: new Date(started.getTime() + 100),
        ticket_id: 'receipt-boundary-ticket',
      },
    })
    await prisma.communityDeliveryReceipt.create({
      data: {
        attempt_id: attempt.id,
        next_attempt_at: beforeExpiry,
        expires_at: expires,
      },
    })
    const lookup = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }))
      )
    const send = vi.fn<typeof fetch>()
    const sender = new CommunitySendGuard(
      prisma,
      {
        evaluate: () =>
          Promise.reject(new Error('Accepted delivery must not reauthorize')),
      },
      new CommunityPushProvider(send)
    )
    // Only Date advances. PostgreSQL and provider I/O execute normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(beforeExpiry)
    const receipts = new (receiptsClass())(
      prisma,
      new PushTokenRepository(prisma),
      lookup
    )
    await receipts.sweep()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/getReceipts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: [attempt.ticket_id] }),
        signal: expect.any(AbortSignal) as AbortSignal,
      })
    )
    expect(
      await prisma.communityDeliveryReceipt.findUniqueOrThrow({
        where: { attempt_id: attempt.id },
      })
    ).toMatchObject({
      status: 'pending',
      lookup_count: 1,
      next_attempt_at: expires,
      expires_at: expires,
    })
    expect(expires.getTime() - started.getTime()).toBe(86_400_000)
    await new CommunityNotificationsWorker(prisma, sender).dispatch()
    vi.setSystemTime(expires)
    await receipts.sweep()
    await receipts.sweep()
    await sender.dispatch(delivery.id)
    await new CommunityNotificationsWorker(prisma, sender).dispatch()
    expect(
      await prisma.communityDeliveryReceipt.findUniqueOrThrow({
        where: { attempt_id: attempt.id },
      })
    ).toMatchObject({
      status: 'receipt_unknown',
      lookup_count: 1,
      next_attempt_at: expires,
      expires_at: expires,
    })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(
      await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: delivery.id },
      })
    ).toMatchObject([
      {
        id: attempt.id,
        status: 'accepted',
        started_at: started,
        ticket_id: attempt.ticket_id,
      },
    ])
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'accepted' })
    expect(
      await prisma.communityEngagementTelemetry.count({
        where: { event_type: 'community_receipt_outcome', outcome: 'receipt_unknown' },
      })
    ).toBe(1)
  })
})
