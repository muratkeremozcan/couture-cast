// Story 3.3 Task 3 step 1 owner: define background fetch task using task manager in apps/mobile/src/lib/background-fetch.ts
import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import { getSavedSettings } from './settings-storage'
import { readLatestRitualCache, saveRitualCache } from './ritual-cache'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'
import { mobileAnalyticsClient } from '../analytics/mobile-analytics'
import { isWidgetCacheFresh } from './widget-cache-freshness'
import {
  defaultSupportedLocale,
  ritualResponseSchema,
} from '@couture/api-client/contracts/http'

const RITUAL_BACKGROUND_FETCH_TASK = 'RITUAL_BACKGROUND_FETCH_TASK'

TaskManager.defineTask(RITUAL_BACKGROUND_FETCH_TASK, async () => {
  try {
    const settings = await getSavedSettings()
    const locale = settings.locale ?? defaultSupportedLocale
    const userId = mobileAnalyticsClient.getDistinctId() || 'mobile-anonymous-user'

    const cached = await readLatestRitualCache(userId, locale)

    if (cached && isWidgetCacheFresh(cached.timestamp)) {
      return BackgroundFetch.BackgroundFetchResult.NoData
    }

    const token = await resolveMobileAccessToken()
    const client = createMobileApiClient({
      accessToken: () => Promise.resolve(token || ''),
    })

    const response = ritualResponseSchema.parse(await client.apiV1RitualGet({ locale }))

    await saveRitualCache(userId, locale, {
      data: response,
      timestamp: Date.now(),
    })

    return BackgroundFetch.BackgroundFetchResult.NewData
  } catch (error) {
    console.error('[BackgroundFetch] task execution failed', error)
    return BackgroundFetch.BackgroundFetchResult.Failed
  }
})

export async function registerBackgroundFetchAsync() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      RITUAL_BACKGROUND_FETCH_TASK
    )
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(RITUAL_BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false,
        startOnBoot: true,
      })
    }
  } catch (err) {
    console.warn('[BackgroundFetch] registration failed', err)
  }
}
