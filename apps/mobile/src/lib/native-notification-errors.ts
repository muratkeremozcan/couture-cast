// Story 6.5 owner: registration failures that have their own settings copy. Kept free of
// native imports so screens can map errors without loading the notification runtime.
export type NativeNotificationFailureReason = 'bindingConflict' | 'pushUnavailable'

export class NativeNotificationFailure extends Error {
  constructor(
    readonly reason: NativeNotificationFailureReason,
    message: string,
    readonly detail?: unknown
  ) {
    super(message)
    this.name = 'NativeNotificationFailure'
  }
}

export function nativeNotificationFailureKey(error: unknown): string | undefined {
  return error instanceof NativeNotificationFailure
    ? `community.notifications.${error.reason}`
    : undefined
}
