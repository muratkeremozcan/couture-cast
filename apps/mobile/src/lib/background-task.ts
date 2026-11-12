// Story 3.3 Task 3 step 1 owner: define the ritual background task using task manager.
// Story 6.15 moved it from the deprecated expo-background-fetch to expo-background-task.
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { getSavedSettings } from './settings-storage'
import { readLatestRitualCache, ritualCacheOwner, saveRitualCache } from './ritual-cache'
import { createMobileApiClient } from './api-client'
import { mobileApplicationUserId, resolveMobileAccessToken } from './mobile-auth'
import { loadWidgetAlertPreferences } from './widget-alert-preferences'
import { isWidgetCacheFresh } from './widget-cache-freshness'
import {
  defaultSupportedLocale,
  ritualResponseSchema,
} from '@couture/api-client/contracts/http'

const RITUAL_BACKGROUND_TASK = 'RITUAL_BACKGROUND_TASK'
/**
 * The name SDK 54 builds registered through expo-background-fetch. expo-task-manager persists a
 * registered task with its consumer, and registration below skips a name that is already
 * registered, so reusing this name would leave an upgraded install bound to the removed fetch
 * consumer. The new task takes a new name and the old one is unregistered on launch.
 */
const RETIRED_BACKGROUND_FETCH_TASK = 'RITUAL_BACKGROUND_FETCH_TASK'

TaskManager.defineTask(RITUAL_BACKGROUND_TASK, async () => {
  try {
    const settings = await getSavedSettings()
    const locale = settings.locale ?? defaultSupportedLocale

    // The member is known only once the token resolver has verified (and on a cold wake,
    // restored) the session. Deriving the cache owner before that keyed member A's ritual
    // as signed-out, which a signed-out Home or another member's first load then read.
    // Without a verified member there is nothing to fetch: the ritual needs a bearer.
    const token = await resolveMobileAccessToken()
    const member = mobileApplicationUserId()
    if (!token || !member) {
      return BackgroundTask.BackgroundTaskResult.Success
    }
    const userId = ritualCacheOwner(member)

    const cached = await readLatestRitualCache(userId, locale)

    if (cached && isWidgetCacheFresh(cached.timestamp)) {
      return BackgroundTask.BackgroundTaskResult.Success
    }

    const client = createMobileApiClient({
      accessToken: () => Promise.resolve(token || ''),
    })

    const [ritualResult, alertPreferences] = await Promise.all([
      client.apiV1RitualGet({ locale }),
      loadWidgetAlertPreferences(client),
    ])
    const response = ritualResponseSchema.parse(ritualResult)

    await saveRitualCache(userId, locale, {
      data: response,
      timestamp: Date.now(),
      alertPreferences,
    })

    return BackgroundTask.BackgroundTaskResult.Success
  } catch (error) {
    console.error('[BackgroundTask] task execution failed', error)
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

async function retireBackgroundFetchTask() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(RETIRED_BACKGROUND_FETCH_TASK)) {
      await TaskManager.unregisterTaskAsync(RETIRED_BACKGROUND_FETCH_TASK)
    }
  } catch (err) {
    // Builds from Story 6.15 on no longer ship the retired task's consumer; a failure here must
    // not cost the member the new task.
    console.warn('[BackgroundTask] retiring the background fetch task failed', err)
  }
}

export async function registerRitualBackgroundTaskAsync() {
  await retireBackgroundFetchTask()
  try {
    // Re-registering on every launch would reset the OS scheduling budget.
    if (await TaskManager.isTaskRegisteredAsync(RITUAL_BACKGROUND_TASK)) return
    // Minutes; 15 is the platform minimum and the interval the background fetch task used.
    await BackgroundTask.registerTaskAsync(RITUAL_BACKGROUND_TASK, {
      minimumInterval: 15,
    })
  } catch (err) {
    console.warn('[BackgroundTask] registration failed', err)
  }
}
