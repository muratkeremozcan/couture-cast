import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { EventsRepository } from './events.repository'

describe('EventsRepository', () => {
  it('queries only authenticated-user and global events after the cursor', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = {
      eventEnvelope: { findMany },
    } as unknown as PrismaClient
    const repository = new EventsRepository(prisma)
    const since = new Date('2026-07-13T12:00:00.000Z')

    await repository.findSince('user-1', since)

    expect(findMany).toHaveBeenCalledWith({
      where: {
        created_at: { gt: since },
        OR: [{ user_id: 'user-1' }, { user_id: null }],
      },
      orderBy: { created_at: 'asc' },
    })
  })

  it('still applies ownership filtering when no cursor is provided', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = {
      eventEnvelope: { findMany },
    } as unknown as PrismaClient
    const repository = new EventsRepository(prisma)

    await repository.findSince('user-1')

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ user_id: 'user-1' }, { user_id: null }],
      },
      orderBy: { created_at: 'asc' },
    })
  })
})
