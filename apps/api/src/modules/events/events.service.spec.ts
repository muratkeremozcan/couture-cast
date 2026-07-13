import { describe, expect, it, vi } from 'vitest'
import type { EventEnvelope } from '@prisma/client'
import type { EventsRepository } from './events.repository'
import { EventsService } from './events.service'

const sampleEvents: EventEnvelope[] = [
  {
    id: 'e1',
    channel: 'lookbook:new',
    payload: { foo: 'bar' },
    user_id: 'user-1',
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
  },
  {
    id: 'e2',
    channel: 'alert:weather',
    payload: { severity: 'warning' },
    user_id: null,
    created_at: new Date('2025-01-02T00:00:00Z'),
    updated_at: new Date('2025-01-02T00:00:00Z'),
  },
  {
    id: 'e3',
    channel: 'alert:weather',
    payload: { severity: 'critical' },
    user_id: 'other-user',
    created_at: new Date('2025-01-03T00:00:00Z'),
    updated_at: new Date('2025-01-03T00:00:00Z'),
  },
]

const createService = (events: EventEnvelope[]) => {
  const findSince = vi.fn().mockResolvedValue(events)
  const repo = {
    findSince,
    create: vi.fn(),
  } as unknown as EventsRepository
  return { findSince, service: new EventsService(repo) }
}

describe('EventsService', () => {
  it('returns events and nextSince iso string', async () => {
    const { service } = createService(sampleEvents)

    const result = await service.poll('user-1')

    expect(result.events).toHaveLength(2)
    expect(result.nextSince).toBe('2025-01-02T00:00:00.000Z')
    expect(result.events.map((event) => event.userId)).toEqual(['user-1', null])
  })

  it('returns null nextSince when no events', async () => {
    const { findSince, service } = createService([])

    const since = new Date('2025-01-01T00:00:00.000Z')
    const result = await service.poll('user-1', since)

    expect(result.events).toHaveLength(0)
    expect(result.nextSince).toBeNull()
    expect(findSince).toHaveBeenCalledWith('user-1', since)
  })
})
