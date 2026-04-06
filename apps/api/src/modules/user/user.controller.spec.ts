import { describe, expect, it, vi } from 'vitest'
import { UserController } from './user.controller'
import type { UserService } from './user.service'

const createController = () => {
  const getProfile = vi.fn().mockResolvedValue({
    user: {
      id: 'teen-4',
      email: 'teen4@example.com',
      displayName: 'Taylor Brooks',
      birthdate: '2009-03-04T00:00:00.000Z',
      role: 'teen',
    },
    linkedGuardians: [],
    linkedTeens: [],
  })
  const service = {
    getProfile,
  } as unknown as UserService

  return { controller: new UserController(service), getProfile }
}

describe('UserController', () => {
  it('returns the authenticated profile from the service layer', async () => {
    const { controller, getProfile } = createController()
    const auth = {
      token: 'teen-token',
      userId: 'teen-4',
      role: 'teen' as const,
    }

    const result = await controller.getProfile(auth)

    expect(getProfile).toHaveBeenCalledWith(auth)
    expect(result).toEqual({
      user: {
        id: 'teen-4',
        email: 'teen4@example.com',
        displayName: 'Taylor Brooks',
        birthdate: '2009-03-04T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [],
      linkedTeens: [],
    })
  })
})
