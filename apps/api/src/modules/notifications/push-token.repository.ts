import { Injectable } from '@nestjs/common'
import { PrismaClient, type PushToken } from '@prisma/client'

/**
 * Story 0.5 (Task 4): push token persistence for offline/background delivery.
 *
 * Realtime sockets are best for active sessions, but push needs durable device tokens.
 * We upsert by token so reinstall/login changes can rebind ownership without duplicates.
 *
 * Alternative:
 * - Store tokens only in memory/session, which loses offline reachability across restarts.
 */
@Injectable()
export class PushTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveToken(userId: string, token: string, platform?: string): Promise<PushToken> {
    // Normalize inputs before persistence so downstream dispatch can rely on stable token/user values.
    const normalizedUserId = userId.trim()
    const normalizedToken = token.trim()

    if (!normalizedUserId) throw new Error('userId is required')
    if (!normalizedToken) throw new Error('token is required')

    const normalizedPlatform = this.normalizePlatform(platform)
    const now = new Date()
    const record = await this.prisma.pushToken.upsert({
      where: { token: normalizedToken },
      update: {
        user_id: normalizedUserId,
        platform: normalizedPlatform,
        last_used_at: now,
      },
      create: {
        user_id: normalizedUserId,
        token: normalizedToken,
        platform: normalizedPlatform,
        last_used_at: now,
      },
    })
    return record
  }

  async findByUserIds(userIds: string[]): Promise<PushToken[]> {
    // Fan-out lookup for multi-recipient push dispatch.
    if (!userIds.length) return []
    const records = await this.prisma.pushToken.findMany({
      where: { user_id: { in: userIds } },
    })
    return records
  }

  private normalizePlatform(platform?: string): string | null {
    const value = platform?.trim()
    return value && value.length > 0 ? value : null
  }
}
