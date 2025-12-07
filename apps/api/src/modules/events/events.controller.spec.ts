import { describe, expect, it, vi } from 'vitest'
import { EventsController } from './events.controller'
import type { EventsService } from './events.service'

const mockService = () =>
  ({
    poll: vi.fn().mockResolvedValue({ events: [], nextSince: null }),
  }) as unknown as EventsService

describe('EventsController', () => {
  it('returns empty events array and null nextSince when since missing', async () => {
    const controller = new EventsController(mockService())
    const res = await controller.poll()

    expect(res).toMatchObject({ events: [], nextSince: null })
  })

  it('returns error for invalid since', async () => {
    const controller = new EventsController(mockService())
    const res = await controller.poll('not-a-date')

    expect((res as { error?: string }).error).toBe('Invalid since timestamp')
  })
})
