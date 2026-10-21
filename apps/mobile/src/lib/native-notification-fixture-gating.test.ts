import { expect, it, vi } from 'vitest'
const listen = vi.hoisted(() => vi.fn())
vi.mock('expo-application', () => ({ applicationId: 'com.couturecast' }))
vi.mock('expo-linking', () => ({ addEventListener: listen }))
vi.mock('expo-notifications', () => {
  throw new Error('Native notifications must not load in the normal application')
})
import { startNativeNotificationFixture } from './native-notification-fixture'
it('never installs the debug injection route into the normal application', async () => {
  const cleanup = await startNativeNotificationFixture()
  cleanup()
  expect(listen).not.toHaveBeenCalled()
})
