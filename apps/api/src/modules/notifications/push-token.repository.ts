// Step 6 push token owner: searchable owner anchor
import { Injectable } from '@nestjs/common'
import { PrismaClient, Prisma, type PushToken } from '@prisma/client'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

/**
 * Story 0.5 support file: push token persistence for offline/background delivery.
 *
 * Realtime sockets are best for active sessions, but push needs durable device tokens.
 * We upsert by token so reinstall/login changes can rebind ownership without duplicates.
 *
 * Alternative:
 * - Store tokens only in memory/session, which loses offline reachability across restarts.
 *
 * Flow refs:
 * - S0.5/T3: push dispatch depends on durable tokens that survive reconnects.
 * - S0.5/T4: token persistence is the stable storage layer behind the push path.
 */
export type CapturedPushBinding = {
  registrationId: string
  ownerId: string
  bindingGeneration: number
  token: string
  inactiveBefore?: Date
}
@Injectable()
export class PushTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveToken(userId: string, token: string, platform?: string): Promise<PushToken> {
    // Flow ref S0.5/T4: normalize inputs before persistence so downstream dispatch can rely on stable values.
    const normalizedUserId = userId.trim()
    const normalizedToken = token.trim()

    if (!normalizedUserId) throw new Error('userId is required')
    if (!normalizedToken) throw new Error('token is required')

    const normalizedPlatform = this.normalizePlatform(platform)
    const now = new Date()
    const previous = await this.prisma.pushToken.findUnique({
      where: { token: normalizedToken },
    })
    const owners = [
      ...new Set([normalizedUserId, ...(previous ? [previous.user_id] : [])]),
    ]
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join(owners)}]::text[],ARRAY[]::text[],true)`
      )
      const locked = await tx.$queryRaw<
        PushToken[]
      >`SELECT * FROM "PushToken" WHERE token = ${normalizedToken} FOR UPDATE`
      const current = locked[0]
      if (
        current?.id !== previous?.id ||
        current?.binding_generation !== previous?.binding_generation
      )
        throw new Error('Push binding changed; retry registration.')
      const transferred = current && current.user_id !== normalizedUserId
      if (transferred)
        await tx.communityTokenDelivery.updateMany({
          where: {
            registration_id: current.id,
            owner_id: current.user_id,
            binding_generation: current.binding_generation,
            status: { in: ['pending', 'deferred', 'retryable_rejection'] },
          },
          data: { status: 'suppressed' },
        })
      return tx.pushToken.upsert({
        where: { token: normalizedToken },
        update: {
          user_id: normalizedUserId,
          platform: normalizedPlatform,
          last_used_at: now,
          ...(transferred ? { binding_generation: { increment: 1 } } : {}),
        },
        create: {
          user_id: normalizedUserId,
          token: normalizedToken,
          platform: normalizedPlatform,
          last_used_at: now,
        },
      })
    })
  }

  async findByUserIds(userIds: string[]): Promise<PushToken[]> {
    // Flow ref S0.5/T3: fan-out lookup for multi-recipient push dispatch.
    if (!userIds.length) return []
    const records = await this.prisma.pushToken.findMany({
      where: { user_id: { in: userIds } },
    })
    return records
  }

  async deleteBindings(bindings: CapturedPushBinding[]): Promise<number> {
    if (!bindings.length) return 0
    const owners = [...new Set(bindings.map((b) => b.ownerId))]
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join(owners)}]::text[],ARRAY[]::text[],true)`
      )
      const result = await tx.pushToken.deleteMany({
        where: {
          OR: bindings.map((binding) => ({
            id: binding.registrationId,
            user_id: binding.ownerId,
            binding_generation: binding.bindingGeneration,
            token: binding.token,
            ...(binding.inactiveBefore
              ? { last_used_at: { lte: binding.inactiveBefore } }
              : {}),
          })),
        },
      })
      return result.count
    })
  }

  private normalizePlatform(platform?: string): string | null {
    const value = platform?.trim()
    return value && value.length > 0 ? value : null
  }
}
