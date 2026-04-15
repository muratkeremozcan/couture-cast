import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildUserProfileResponse,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import { UserController } from './user.controller'
import type { UserService } from './user.service'

const createController = () => {
  const teen = createTeenProfileFixture()
  const getProfile = vi.fn().mockResolvedValue(buildUserProfileResponse(teen, [], []))
  const service = {
    getProfile,
  } as unknown as UserService

  return { controller: new UserController(service), getProfile, teen }
}

describe('UserController', () => {
  afterEach(() => {
    resetCleanupRegistry()
  })

  it('returns the authenticated profile from the service layer', async () => {
    const { controller, getProfile, teen } = createController()
    const auth = {
      token: 'teen-token',
      userId: teen.id,
      role: 'teen' as const,
    }

    const result = await controller.getProfile(auth)

    expect(getProfile).toHaveBeenCalledWith(auth)
    expect(result).toEqual(buildUserProfileResponse(teen, [], []))
  })
})
