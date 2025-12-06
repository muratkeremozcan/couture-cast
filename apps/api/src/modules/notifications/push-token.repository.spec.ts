import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, PushToken } from '@prisma/client'

import { PushTokenRepository } from './push-token.repository'

const mockPushTokens: PushToken[] = [
  {
    id: 'token-1',
    user_id: 'user-a',
    token: 'ExponentPushToken[token-1]',
    platform: 'ios',
    last_used_at: new Date('2024-01-01T00:00:00Z'),
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
  },
  {
    id: 'token-2',
    user_id: 'user-b',
    token: 'ExponentPushToken[token-2]',
    platform: 'android',
    last_used_at: new Date('2024-01-02T00:00:00Z'),
    created_at: new Date('2024-01-02T00:00:00Z'),
    updated_at: new Date('2024-01-02T00:00:00Z'),
  },
]

const createRepository = () => {
  const findMany = vi.fn().mockResolvedValue(mockPushTokens)
  const upsert = vi.fn().mockResolvedValue(mockPushTokens[0])
  const prisma = { pushToken: { findMany, upsert } } satisfies Pick<
    PrismaClient,
    'pushToken'
  >
  return { repo: new PushTokenRepository(prisma as PrismaClient), findMany, upsert }
}

describe('PushTokenRepository', () => {
  it('validates userId and token', async () => {
    const { repo, upsert } = createRepository()

    await expect(repo.saveToken('  ', '', 'ios')).rejects.toThrow(/userId is required/)
    await expect(repo.saveToken('user-a', '   ', 'ios')).rejects.toThrow(
      /token is required/
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('normalizes platform and trims inputs before saving', async () => {
    const { repo, upsert } = createRepository()

    await repo.saveToken(' user-a ', ' ExponentPushToken[token-1] ', ' ios ')

    expect(upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[token-1]' },
      update: {
        user_id: 'user-a',
        platform: 'ios',
        last_used_at: expect.any(Date) as Date,
      },
      create: {
        user_id: 'user-a',
        token: 'ExponentPushToken[token-1]',
        platform: 'ios',
        last_used_at: expect.any(Date) as Date,
      },
    })
  })

  it('short-circuits when no user IDs are provided', async () => {
    const { repo, findMany } = createRepository()

    const result = await repo.findByUserIds([])

    expect(result).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('fetches push tokens for provided user IDs', async () => {
    const { repo, findMany } = createRepository()

    const result = await repo.findByUserIds(['user-a', 'user-b'])

    expect(findMany).toHaveBeenCalledWith({
      where: { user_id: { in: ['user-a', 'user-b'] } },
    })
    expect(result).toEqual(mockPushTokens)
  })
})
