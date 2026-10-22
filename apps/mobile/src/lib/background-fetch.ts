// Story 3.3 Task 3 step 1 owner: define background fetch task using task manager in apps/mobile/src/lib/background-fetch.ts
import * as BackgroundFetch from 'expo-background-fetch'
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

const RITUAL_BACKGROUND_FETCH_TASK = 'RITUAL_BACKGROUND_FETCH_TASK'

TaskManager.defineTask(RITUAL_BACKGROUND_FETCH_TASK, async () => {
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
      return BackgroundFetch.BackgroundFetchResult.NoData
    }
    const userId = ritualCacheOwner(member)

    const cached = await readLatestRitualCache(userId, locale)

    if (cached && isWidgetCacheFresh(cached.timestamp)) {
      return BackgroundFetch.BackgroundFetchResult.NoData
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
