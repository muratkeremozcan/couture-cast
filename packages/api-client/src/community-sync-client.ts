// Story 6.5 owner: real generated transports with canonical request and response parsing.
import type { DefaultApi } from './generated'
import {
  communityEventsResponseSchema,
  communityNotificationPreferencesResponseSchema,
  patchCommunityNotificationPreferencesSchema,
  resolveCommunityTargetsInputSchema,
  resolveCommunityTargetsResponseSchema,
  registerPushTokenInputSchema,
  registerPushTokenResponseSchema,
  pushRegistrationsResponseSchema,
  removePushRegistrationResponseSchema,
  type CommunityFeedMode,
  type PatchCommunityNotificationPreferences,
  type ResolveCommunityTargetsInput,
  type RegisterPushTokenInput,
} from './contracts/http'
export function communitySyncClient(
  api: Pick<
    DefaultApi,
    | 'getCommunityEvents'
    | 'getCommunityNotificationPreferences'
    | 'patchCommunityNotificationPreferences'
    | 'resolveCommunityTargets'
    | 'registerPushToken'
    | 'getPushRegistrations'
    | 'removePushRegistration'
  >,
  requestInit?: RequestInit | (() => RequestInit)
) {
  const request = (signal?: AbortSignal): RequestInit => {
    const options = typeof requestInit === 'function' ? requestInit() : requestInit
    const signals = [AbortSignal.timeout(5000), options?.signal, signal].filter(
      (value): value is AbortSignal => Boolean(value)
    )
    return { ...options, signal: AbortSignal.any(signals) }
  }
  return {
    events: async (mode: CommunityFeedMode, cursor?: string, signal?: AbortSignal) =>
      communityEventsResponseSchema.parse(
        await api.getCommunityEvents({ mode, cursor }, request(signal))
      ).data,
    preferences: async () =>
      communityNotificationPreferencesResponseSchema.parse(
        await api.getCommunityNotificationPreferences(request())
      ).data,
    patchPreferences: async (input: PatchCommunityNotificationPreferences) =>
      communityNotificationPreferencesResponseSchema.parse(
        await api.patchCommunityNotificationPreferences(
          {
            patchCommunityNotificationPreferencesInput:
              patchCommunityNotificationPreferencesSchema.parse(input),
          },
          request()
        )
      ).data,
    resolve: async (input: ResolveCommunityTargetsInput, signal?: AbortSignal) =>
      resolveCommunityTargetsResponseSchema.parse(
        await api.resolveCommunityTargets(
          {
            resolveCommunityTargetsInput: resolveCommunityTargetsInputSchema.parse(input),
          },
          request(signal)
        )
      ).data,
    register: async (input: RegisterPushTokenInput) =>
      registerPushTokenResponseSchema.parse(
        await api.registerPushToken(
          { registerPushTokenInput: registerPushTokenInputSchema.parse(input) },
          request()
        )
      ).data,
    registrations: async () =>
      pushRegistrationsResponseSchema.parse(await api.getPushRegistrations(request()))
        .data,
    remove: async (registrationId: string, bindingGeneration: number) =>
      removePushRegistrationResponseSchema.parse(
        await api.removePushRegistration({ registrationId, bindingGeneration }, request())
      ).data,
  }
}
export type CommunitySyncClient = ReturnType<typeof communitySyncClient>
