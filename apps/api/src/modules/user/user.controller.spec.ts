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
  const updatePreferences = vi.fn().mockResolvedValue({ success: true })
  const service = {
    getProfile,
    updatePreferences,
  } as unknown as UserService

  return { controller: new UserController(service), getProfile, updatePreferences, teen }
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

  it('updates preferences successfully', async () => {
    const { controller, updatePreferences, teen } = createController()
    const auth = {
      token: 'teen-token',
      userId: teen.id,
      role: 'teen' as const,
    }
    const body = { locale: 'tr-TR' }

    const result = await controller.updatePreferences(auth, body)

    expect(updatePreferences).toHaveBeenCalledWith(teen.id, body)
    expect(result).toEqual({ success: true })
  })

  it('rejects unsupported locale preferences before calling the service', async () => {
    const { controller, updatePreferences, teen } = createController()
    const auth = {
      token: 'teen-token',
      userId: teen.id,
      role: 'teen' as const,
    }

    await expect(controller.updatePreferences(auth, { locale: 'ja-JP' })).rejects.toThrow(
      'Invalid enum value'
    )
    expect(updatePreferences).not.toHaveBeenCalled()
  })
})
