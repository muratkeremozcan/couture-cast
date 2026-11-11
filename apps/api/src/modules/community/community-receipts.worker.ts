import { communityBuildIdentity } from './community-operational-telemetry.js'
import { z } from 'zod'
// Story 6.5 owner: receipt uncertainty never authorizes a resend; pruning is generation-scoped.
import type { PrismaClient } from '@prisma/client'
import { type PushTokenRepository } from '../notifications/push-token.repository.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
const receiptBodySchema = z.object({
  data: z.record(
    z.object({
      status: z.enum(['ok', 'error']),
      details: z.object({ error: z.string().optional() }).optional(),
    })
  ),
})
function receiptOutcome(
  body: unknown,
  ticket: string
): 'accepted' | 'invalid_token' | 'pending' | 'receipt_failed' {
  const parsed = receiptBodySchema.safeParse(body)
  if (!parsed.success) return 'pending'
  const receipt = parsed.data.data[ticket]
  if (!receipt) return 'pending'
  if (receipt.status === 'ok') return 'accepted'
  return receipt.details?.error === 'DeviceNotRegistered'
    ? 'invalid_token'
    : 'receipt_failed'
}
export class CommunityReceiptsWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: PushTokenRepository,
    private readonly transport: typeof fetch = fetch
  ) {}
  /**
   * Returns how many receipts and attempts changed state; a row it selects and leaves unchanged
   * counts as idle, so it cannot hold the loop at its busy cadence.
   */
  async sweep(): Promise<number> {
    let moved = 0
    const due = await this.prisma.communityDeliveryReceipt.findMany({
      where: {
        OR: [
          {
            status: 'pending',
            OR: [
              { next_attempt_at: { lte: new Date() } },
              { expires_at: { lte: new Date() } },
            ],
          },
          { status: 'invalid_token_pending_prune', next_attempt_at: { lte: new Date() } },
        ],
      },
      include: { attempt: { include: { delivery: true } } },
      orderBy: { next_attempt_at: 'asc' },
      take: 100,
    })
    for (const receipt of due) {
      if (receipt.status === 'invalid_token_pending_prune') {
        moved += await this.cleanup(receipt.attempt_id, receipt.attempt.delivery)
        continue
      }
      if (receipt.expires_at <= new Date()) {
        moved += await this.settle(receipt.attempt_id, 'receipt_unknown')
        continue
      }
      const ticket = receipt.attempt.ticket_id
      if (!ticket) {
        moved += await this.settle(receipt.attempt_id, 'receipt_unknown')
        continue
      }
      const result = await this.lookup(ticket)
      if (result === 'pending') {
        const minutes = [1, 5, 15][receipt.lookup_count] ?? 60
        const rescheduled = await this.prisma.communityDeliveryReceipt.updateMany({
          where: {
            attempt_id: receipt.attempt_id,
            status: 'pending',
            lookup_count: receipt.lookup_count,
          },
          data: {
            lookup_count: { increment: 1 },
            next_attempt_at: new Date(
              Math.min(receipt.expires_at.getTime(), Date.now() + minutes * 60_000)
            ),
          },
        })
        moved += rescheduled.count
      } else {
        if (result === 'invalid_token') {
          const marked = await this.prisma.communityDeliveryReceipt.updateMany({
            where: { attempt_id: receipt.attempt_id, status: 'pending' },
            data: { status: 'invalid_token_pending_prune' },
          })
          moved += marked.count
          await this.cleanup(receipt.attempt_id, receipt.attempt.delivery)
        } else moved += await this.settle(receipt.attempt_id, result)
      }
    }
    const invalid = await this.prisma.communityDeliveryAttempt.findMany({
      where: { status: 'failed', reason: 'device_not_registered' },
      include: { delivery: true },
      take: 100,
    })
    for (const attempt of invalid) {
      await this.prune(attempt.delivery)
      const pruned = await this.prisma.communityDeliveryAttempt.updateMany({
        where: { id: attempt.id, reason: 'device_not_registered' },
        data: { reason: 'invalid_token_pruned' },
      })
      moved += pruned.count
    }
    return moved
  }
  private async cleanup(
    attempt: string,
    delivery: {
      registration_id: string
      owner_id: string | null
      binding_generation: number
    }
  ): Promise<number> {
    try {
      await this.prune(delivery)
      return await this.settle(attempt, 'invalid_token')
    } catch {
      const retried = await this.prisma.communityDeliveryReceipt.updateMany({
        where: { attempt_id: attempt, status: 'invalid_token_pending_prune' },
        data: { next_attempt_at: new Date(Date.now() + 2000) },
      })
      return retried.count
    }
  }
  private async lookup(
    ticket: string
  ): Promise<'accepted' | 'invalid_token' | 'pending' | 'receipt_failed'> {
    try {
      const response = await this.transport(
        'https://exp.host/--/api/v2/push/getReceipts',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.EXPO_PUSH_ACCESS_TOKEN
              ? { Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({ ids: [ticket] }),
          signal: AbortSignal.timeout(2000),
        }
      )
      if (!response.ok) return 'pending'
      const body: unknown = await response.json()
      return receiptOutcome(body, ticket)
    } catch {
      return 'pending'
    }
  }
  private async settle(attempt: string, status: string): Promise<number> {
    return interactiveTransaction(this.prisma, async (tx) => {
      const settled = await tx.communityDeliveryReceipt.updateMany({
        where: {
          attempt_id: attempt,
          status: { in: ['pending', 'invalid_token_pending_prune'] },
        },
        data: { status },
      })
      if (settled.count)
        await tx.communityEngagementTelemetry.create({
          data: {
            event_type: 'community_receipt_outcome',
            outcome: status,
            build_identity: communityBuildIdentity(),
          },
        })
      return settled.count
    })
  }
  private async prune(delivery: {
    registration_id: string
    owner_id: string | null
    binding_generation: number
  }) {
    if (!delivery.owner_id) return
    const row = await this.prisma.pushToken.findFirst({
      where: {
        id: delivery.registration_id,
        user_id: delivery.owner_id,
        binding_generation: delivery.binding_generation,
      },
    })
    if (!row) return
    await this.tokens.deleteBindings([
      {
        registrationId: row.id,
        ownerId: row.user_id,
        bindingGeneration: row.binding_generation,
        token: row.token,
      },
    ])
  }
}
