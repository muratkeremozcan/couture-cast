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
]

const createService = (events: EventEnvelope[]) => {
  const repo = {
    findSince: vi.fn().mockResolvedValue(events),
    create: vi.fn(),
  } as unknown as EventsRepository
  return { service: new EventsService(repo), repo }
}

describe('EventsService', () => {
  it('returns events and nextSince iso string', async () => {
    const { service } = createService(sampleEvents)

    const result = await service.poll()

    expect(result.events).toHaveLength(2)
    expect(result.nextSince).toBe('2025-01-02T00:00:00.000Z')
  })

  it('returns null nextSince when no events', async () => {
    const { service } = createService([])

    const result = await service.poll()

    expect(result.events).toHaveLength(0)
    expect(result.nextSince).toBeNull()
  })
})
