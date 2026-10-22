// Story 6.5: sparse policy edits preserve concurrent shared weather settings.
import {
  type CommunityNotificationSettings,
  type PatchCommunityNotificationPreferences,
} from './contracts/http'
export function communityPreferenceChanges(
  base: CommunityNotificationSettings,
  draft: CommunityNotificationSettings
): Omit<PatchCommunityNotificationPreferences, 'baseRevision'> {
  return {
    ...(draft.enabled !== base.enabled ? { enabled: draft.enabled } : {}),
    ...(draft.quietHoursEnabled !== base.quietHoursEnabled
      ? { quietHoursEnabled: draft.quietHoursEnabled }
      : {}),
    ...(draft.quietHoursStart !== base.quietHoursStart
      ? { quietHoursStart: draft.quietHoursStart }
      : {}),
    ...(draft.quietHoursEnd !== base.quietHoursEnd
      ? { quietHoursEnd: draft.quietHoursEnd }
      : {}),
    ...(!base.timezoneConfigured || draft.timezone !== base.timezone
      ? { timezone: draft.timezone }
      : {}),
  }
}
export function communityDeviceTimezoneDraft(
  settings: CommunityNotificationSettings,
  timezone: string | undefined
) {
  if (settings.timezoneConfigured || !timezone) return settings
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
    return { ...settings, timezone }
  } catch {
    return settings
  }
}
export function isCommunityPreferenceConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response instanceof Response &&
      error.response.status === 409
  )
}

export function communityPreferenceFailureKey(error: unknown) {
  return error instanceof Error && error.message === 'notification_permission_denied'
    ? 'community.notifications.permission'
    : 'community.notifications.failed'
}

export function rebaseCommunityPreferenceDraft(
  base: CommunityNotificationSettings,
  current: CommunityNotificationSettings,
  draft: CommunityNotificationSettings,
  suggestedTimezone?: string
) {
  const changes = communityPreferenceChanges(base, draft)
  if (
    !base.timezoneConfigured &&
    current.timezoneConfigured &&
    draft.timezone === suggestedTimezone
  )
    delete changes.timezone
  return { ...current, ...changes }
}
