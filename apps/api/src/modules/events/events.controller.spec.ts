import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { EventsController } from './events.controller'
import type { EventsService } from './events.service'

const mockService = () => {
  const poll = vi.fn().mockResolvedValue({ events: [], nextSince: null })

  return {
    poll,
    service: { poll } as unknown as EventsService,
  }
}

describe('EventsController', () => {
  const auth: RequestAuthContext = {
    token: 'test-token',
    userId: 'user-1',
    role: 'teen',
  }

  it('requires request authentication for every polling route', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, EventsController) as unknown[]

    expect(guards).toContain(RequestAuthGuard)
  })

  it('returns empty events array and null nextSince when since missing', async () => {
    const { poll, service } = mockService()
    const controller = new EventsController(service)
    const res = await controller.poll(auth)

    expect(res).toMatchObject({ events: [], nextSince: null })
    expect(poll).toHaveBeenCalledWith('user-1', undefined)
  })

  it('returns error for invalid since', async () => {
    const { poll, service } = mockService()
    const controller = new EventsController(service)
    const res = await controller.poll(auth, 'not-a-date')

    expect((res as { error?: string }).error).toBe('Invalid since timestamp')
    expect(poll).not.toHaveBeenCalled()
  })
})
