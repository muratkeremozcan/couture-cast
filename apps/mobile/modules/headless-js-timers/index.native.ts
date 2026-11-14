import { requireOptionalNativeModule } from 'expo-modules-core'
import { AppRegistry } from 'react-native'
import { createHeadlessTimers, type HeadlessTimersNative } from './scope'

/** Android only; iOS runs background work with its timers live and has no such module. */
export const withHeadlessJsTimers = createHeadlessTimers(
  requireOptionalNativeModule<HeadlessTimersNative>('HeadlessJsTimers'),
  (key, provider) => AppRegistry.registerHeadlessTask(key, provider)
)
