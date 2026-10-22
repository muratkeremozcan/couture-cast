import { beforeEach, describe, expect, it, vi } from 'vitest'
const os = vi.hoisted(() => ({
  applicationId: 'com.couturecast.story65',
  receive: undefined as undefined | ((event: { url: string }) => void),
  remove: vi.fn(),
  granted: true,
  permission: vi.fn().mockResolvedValue({ granted: true }),
  channel: vi.fn().mockResolvedValue(undefined),
  schedule: vi.fn().mockResolvedValue('fixture-id'),
}))
vi.mock('expo-application', () => ({ applicationId: 'com.couturecast.story65' }))
vi.mock('expo-linking', () => ({
  addEventListener: (_: string, fn: typeof os.receive) => {
    os.receive = fn
    return { remove: os.remove }
  },
}))
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: () => Promise.resolve({ granted: os.granted }),
  requestPermissionsAsync: os.permission,
  setNotificationChannelAsync: os.channel,
  scheduleNotificationAsync: os.schedule,
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}))
import { startNativeNotificationFixture } from './native-notification-fixture'
const data = {
  version: 1,
  notificationId: '63100000-0000-4000-8000-000000000006',
  source: 'notification',
  type: 'community',
  cardId: 'fixture-post',
  expiresAt: '2099-01-01T00:00:00.000Z',
}
const url = (value: unknown) =>
  `couturecast-story65://__story65__/notification?data=${encodeURIComponent(JSON.stringify(value))}`
beforeEach(() => {
  os.applicationId = 'com.couturecast.story65'
  os.receive = undefined
  os.granted = true
})
describe('isolated native notification fixture', () => {
  it('requests permission and schedules only validated fixture content, then removes its listener', async () => {
    os.granted = false
    const close = await startNativeNotificationFixture()
    os.receive!({ url: url(data) })
    await vi.waitFor(() => expect(os.schedule).toHaveBeenCalledTimes(1))
    expect(os.permission).toHaveBeenCalledTimes(1)
    expect(os.channel).toHaveBeenCalledWith('community', {
      name: 'CoutureCast Story65',
      importance: 3,
    })
    expect(os.schedule).toHaveBeenCalledWith({
      content: { title: 'CoutureCast', body: 'Your post has new engagement.', data },
      trigger: { type: 'timeInterval', seconds: 3, channelId: 'community' },
    })
    close()
    expect(os.remove).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong routes, malformed JSON and extra payload fields without scheduling', async () => {
    const close = await startNativeNotificationFixture()
    for (const input of [
      'https://__story65__/notification',
      'couturecast-story65://wrong/notification',
      'couturecast-story65://__story65__/wrong',
      'couturecast-story65://__story65__/notification?data=%7B',
      url({ ...data, token: 'forbidden' }),
    ])
      os.receive!({ url: input })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(os.schedule).not.toHaveBeenCalled()
    expect(os.permission).not.toHaveBeenCalled()
    close()
  })
  it('contains OS scheduling failure and allows a later valid request', async () => {
    os.schedule.mockRejectedValueOnce(new Error('OS offline'))
    const close = await startNativeNotificationFixture()
    os.receive!({ url: url(data) })
    await vi.waitFor(() => expect(os.schedule).toHaveBeenCalledTimes(1))
    os.receive!({ url: url(data) })
    await vi.waitFor(() => expect(os.schedule).toHaveBeenCalledTimes(2))
    expect(os.permission).not.toHaveBeenCalled()
    close()
  })
})
