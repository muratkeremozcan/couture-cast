import type * as ReactNative from 'react-native'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ os: 'ios', permission: vi.fn(), launch: vi.fn() }))
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof ReactNative>('react-native')
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return state.os
      },
    },
  }
})
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: state.permission,
  launchImageLibraryAsync: state.launch,
}))
import { pickCommunityPhoto } from './community'
beforeEach(() => {
  state.os = 'ios'
  state.permission.mockReset().mockResolvedValue({ granted: true })
  state.launch.mockReset().mockResolvedValue({ canceled: true })
})
it('iOS uses the explicit system selection even when broad read access was declined', async () => {
  state.permission.mockResolvedValue({ granted: false })
  state.launch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///owned.jpg', width: 800, height: 1000 }],
  })
  expect(await pickCommunityPhoto()).toEqual({
    uri: 'file:///owned.jpg',
    width: 800,
    height: 1000,
  })
  expect(state.permission).not.toHaveBeenCalled()
  expect(state.launch).toHaveBeenCalledExactlyOnceWith({
    mediaTypes: ['images'],
    quality: 0.9,
  })
})
it('iOS cancellation needs no broad permission request', async () => {
  expect(await pickCommunityPhoto()).toBeNull()
  expect(state.permission).not.toHaveBeenCalled()
})
it('Android denial preserves its existing permission guard', async () => {
  state.os = 'android'
  state.permission.mockResolvedValue({ granted: false })
  await expect(pickCommunityPhoto()).rejects.toMatchObject({
    reason: 'permission_denied',
  })
  expect(state.launch).not.toHaveBeenCalled()
})
it('Android selection and cancellation retain the existing native picker options', async () => {
  state.os = 'android'
  state.launch.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///owned.jpg', width: 800, height: 1000 }],
  })
  expect(await pickCommunityPhoto()).toEqual({
    uri: 'file:///owned.jpg',
    width: 800,
    height: 1000,
  })
  expect(await pickCommunityPhoto()).toBeNull()
  expect(state.permission).toHaveBeenCalledTimes(2)
})
it('native picker errors retain the existing localized failure reason', async () => {
  state.launch.mockRejectedValue(new Error('Native presentation unavailable'))
  await expect(pickCommunityPhoto()).rejects.toMatchObject({ reason: 'picker_failed' })
})
