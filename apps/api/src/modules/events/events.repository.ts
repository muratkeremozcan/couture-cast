import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

type CreateEventInput = {
  channel: string
  payload: unknown
  userId?: string
  createdAt?: Date
}

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateEventInput) {
    return this.prisma.eventEnvelope.create({
      data: {
        channel: input.channel,
        payload: input.payload as object,
        user_id: input.userId,
        created_at: input.createdAt ?? new Date(),
      },
    })
  }

  async findSince(since?: Date) {
    return this.prisma.eventEnvelope.findMany({
      where: since ? { created_at: { gt: since } } : undefined,
      orderBy: { created_at: 'asc' },
    })
  }
}
