import { Injectable } from '@nestjs/common'
import { PrismaClient, type PushToken } from '@prisma/client'

@Injectable()
export class PushTokenRepository {
  private readonly prisma = new PrismaClient()

  async saveToken(userId: string, token: string, platform?: string): Promise<PushToken> {
    const now = new Date()
    const record = await this.prisma.pushToken.upsert({
      where: { token },
      update: { user_id: userId, platform, last_used_at: now },
      create: { user_id: userId, token, platform, last_used_at: now },
    })
    return record
  }

  async findByUserIds(userIds: string[]): Promise<PushToken[]> {
    if (!userIds.length) return []
    const records = await this.prisma.pushToken.findMany({
      where: { user_id: { in: userIds } },
    })
    return records
  }
}
