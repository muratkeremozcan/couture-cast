// Story 6.5 owner: real generated transports with canonical request and response parsing.
import { ResponseError, type DefaultApi } from './generated'
import { withRequestDeadline } from './request-deadline'
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
/**
 * Drains a handled error response's network body, then hands callers a buffered copy.
 *
 * An unread 409/403/503 body keeps its loader and connection until GC, so repeated resync or
 * denial answers can exhaust the per-host pool and stall later requests on web and native.
 * Callers keep the same typed outcome: the same status, headers and readable body (native
 * registration reads its `binding_changed` code through a clone). `text()` is used because
 * React Native's fetch has no response streams to cancel.
 */
async function releaseErrorBody(error: unknown): Promise<never> {
  if (error instanceof ResponseError && !error.response.bodyUsed) {
    const original = error.response
    let text: string | null = null
    try {
      text = await original.text()
    } catch {
      // An aborted read already released the body; there is nothing left to buffer.
    }
    error.response = new Response(text, {
      status: original.status,
      statusText: original.statusText,
      headers: original.headers,
    })
  }
  throw error
}
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
  requestInit?: RequestInit | (() => RequestInit),
  timeoutMs = 5000
) {
  function request<T>(work: (options: RequestInit) => Promise<T>, signal?: AbortSignal) {
    const options = typeof requestInit === 'function' ? requestInit() : requestInit
    // The body read stays inside the deadline, so a stalled error body cannot outlive it.
    return withRequestDeadline(timeoutMs, [options?.signal, signal], (combined) =>
      work({ ...options, signal: combined }).catch(releaseErrorBody)
    )
  }
  return {
    events: async (mode: CommunityFeedMode, cursor?: string, signal?: AbortSignal) =>
      communityEventsResponseSchema.parse(
        await request(
          (options) => api.getCommunityEvents({ mode, cursor }, options),
          signal
        )
      ).data,
    preferences: async () =>
      communityNotificationPreferencesResponseSchema.parse(
        await request((options) => api.getCommunityNotificationPreferences(options))
      ).data,
    patchPreferences: async (input: PatchCommunityNotificationPreferences) =>
      communityNotificationPreferencesResponseSchema.parse(
        await request((options) =>
          api.patchCommunityNotificationPreferences(
            {
              patchCommunityNotificationPreferencesInput:
                patchCommunityNotificationPreferencesSchema.parse(input),
            },
            options
          )
        )
      ).data,
    resolve: async (input: ResolveCommunityTargetsInput, signal?: AbortSignal) =>
      resolveCommunityTargetsResponseSchema.parse(
        await request(
          (options) =>
            api.resolveCommunityTargets(
              {
                resolveCommunityTargetsInput:
                  resolveCommunityTargetsInputSchema.parse(input),
              },
              options
            ),
          signal
        )
      ).data,
    register: async (input: RegisterPushTokenInput) =>
      registerPushTokenResponseSchema.parse(
        await request((options) =>
          api.registerPushToken(
            { registerPushTokenInput: registerPushTokenInputSchema.parse(input) },
            options
          )
        )
      ).data,
    registrations: async () =>
      pushRegistrationsResponseSchema.parse(
        await request((options) => api.getPushRegistrations(options))
      ).data,
    remove: async (registrationId: string, bindingGeneration: number) =>
      removePushRegistrationResponseSchema.parse(
        await request((options) =>
          api.removePushRegistration({ registrationId, bindingGeneration }, options)
        )
      ).data,
  }
}
export type CommunitySyncClient = ReturnType<typeof communitySyncClient>
