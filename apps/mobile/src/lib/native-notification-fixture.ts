// Story 6.5 owner: deterministic OS injection exists only in the isolated debug application.
import { communityNotificationDataSchema } from '@couture/api-client/contracts/http'

/** The debug-only OS injection URL; it schedules a notification and is never a screen. */
export function isNativeNotificationFixtureUrl(url: string) {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'couturecast-story65:' &&
      parsed.hostname === '__story65__' &&
      parsed.pathname === '/notification'
    )
  } catch {
    return false
  }
}

export async function startNativeNotificationFixture(): Promise<() => void> {
  const application = await import('expo-application')
  if (!__DEV__ || application.applicationId !== 'com.couturecast.story65')
    return () => undefined
  const [linking, notifications] = await Promise.all([
    import('expo-linking'),
    import('expo-notifications'),
  ])
  const schedule = async (url: string) => {
    if (!isNativeNotificationFixtureUrl(url)) return
    const parsed = new URL(url)
    const input: unknown = JSON.parse(parsed.searchParams.get('data') ?? 'null')
    const data = communityNotificationDataSchema.parse(input)
    if (!(await notifications.getPermissionsAsync()).granted)
      await notifications.requestPermissionsAsync()
    await notifications.setNotificationChannelAsync('community', {
      name: 'CoutureCast Story65',
      importance: notifications.AndroidImportance.DEFAULT,
    })
    await notifications.scheduleNotificationAsync({
      content: { title: 'CoutureCast', body: 'Your post has new engagement.', data },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3,
        channelId: 'community',
      },
    })
  }
  const subscription = linking.addEventListener('url', ({ url }) => {
    void schedule(url).catch(() => undefined)
  })
  return () => subscription.remove()
}
