'use client'
// Story 6.16 owner: the web side of the guest preview. One store over localStorage,
// the session check that keeps members out of the preview, guest analytics that can
// never block the page, and the verified comfort read and write for the review step.
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  ResponseError,
  trackGuestPreviewInteracted,
  trackGuestPreviewSignupClicked,
  trackGuestPreviewStarted,
  type GuestPreviewInteractedEvent,
} from '@couture/api-client'
import {
  createGuestPreviewStore,
  SAMPLE_CATALOG,
  type GuestPreviewStorageAdapter,
  type GuestPreviewStore,
  type SampleComfort,
} from '@couture/utils'
import {
  browserAnalytics,
  resetBrowserAnalyticsIdentity,
} from '../analytics/browser-analytics'
import { createWebApiClient } from './api-client'
import { hasWebSession } from './commerce'
import {
  hasStoredWebSession,
  resolveWebSessionToken,
  webSessionIdentity,
} from './web-session'

export const GUEST_PREVIEW_STORAGE_KEY = 'couturecast.guest-preview'

export function localStorageGuestPreviewAdapter(
  storage: () => Storage = () => window.localStorage
): GuestPreviewStorageAdapter {
  return {
    read: () => Promise.resolve(storage().getItem(GUEST_PREVIEW_STORAGE_KEY)),
    write: (value) =>
      Promise.resolve(storage().setItem(GUEST_PREVIEW_STORAGE_KEY, value)),
    remove: () => Promise.resolve(storage().removeItem(GUEST_PREVIEW_STORAGE_KEY)),
  }
}

let store: GuestPreviewStore | undefined

export function webGuestPreviewStore(): GuestPreviewStore {
  store ??= createGuestPreviewStore({
    adapter: localStorageGuestPreviewAdapter(),
    catalog: SAMPLE_CATALOG,
  })
  return store
}

/** Tests replace the store so each starts from its own adapter. */
export function setWebGuestPreviewStoreForTests(next: GuestPreviewStore | undefined) {
  store = next
}

export type WebPreviewSession = 'member' | 'guest' | 'unavailable'

/**
 * D1: a stored session is resolved before the preview picks guest mode. A verified
 * member goes back to the app; a session that cannot be checked right now is kept and
 * reported as unavailable, never treated as a guest or erased.
 */
export async function resolveWebPreviewSession(): Promise<WebPreviewSession> {
  if (webSessionIdentity() !== null || hasWebSession()) return 'member'
  if (!hasStoredWebSession()) return 'guest'
  try {
    return (await resolveWebSessionToken()) ? 'member' : 'guest'
  } catch {
    return 'unavailable'
  }
}

const CATALOG_VERSION = SAMPLE_CATALOG.catalogVersion

function safely(send: () => void) {
  try {
    send()
  } catch {
    // D10: analytics never blocks the preview or the conversion.
  }
}

export const guestPreviewAnalytics = {
  started() {
    safely(() =>
      browserAnalytics.capture(
        'guest_preview_started',
        trackGuestPreviewStarted({ platform: 'web', catalog_version: CATALOG_VERSION })
      )
    )
  },
  interacted(
    action: GuestPreviewInteractedEvent['action'],
    control?: GuestPreviewInteractedEvent['control']
  ) {
    safely(() =>
      browserAnalytics.capture(
        'guest_preview_interacted',
        trackGuestPreviewInteracted({
          platform: 'web',
          catalog_version: CATALOG_VERSION,
          action,
          ...(control ? { control } : {}),
        })
      )
    )
  },
  /** A click is reported as a click; then the anonymous id is rotated (TEA-4). */
  signupClicked(action: 'create_account' | 'sign_in') {
    safely(() =>
      browserAnalytics.capture(
        'guest_preview_signup_clicked',
        trackGuestPreviewSignupClicked({
          platform: 'web',
          catalog_version: CATALOG_VERSION,
          action,
        })
      )
    )
    safely(() => resetBrowserAnalyticsIdentity())
  },
}

const COMFORT_TIMEOUT_MS = 8000

export type WebComfortClient = {
  memberId: string
  read: () => Promise<SampleComfort>
  write: (values: SampleComfort) => Promise<unknown>
}

/** The verified member and an authenticated comfort client, or null when signed out. */
export async function verifiedComfortClient(): Promise<WebComfortClient | null> {
  const token = await resolveWebSessionToken()
  const memberId = webSessionIdentity()
  if (!token || !memberId) return null
  const api = createWebApiClient({ accessToken: token })
  return {
    memberId,
    read: async () =>
      comfortPreferencesResponseSchema.parse(
        await api.apiV1PersonalizationComfortGet({
          signal: AbortSignal.timeout(COMFORT_TIMEOUT_MS),
        })
      ).data,
    write: async (values) =>
      updateComfortPreferencesResponseSchema.parse(
        await api.apiV1PersonalizationComfortPut(
          { updateComfortPreferencesInput: values },
          { signal: AbortSignal.timeout(COMFORT_TIMEOUT_MS) }
        )
      ),
  }
}

/** D2: a server age or consent refusal outranks the proposal. */
export function isConsentRejection(error: unknown): boolean {
  return error instanceof ResponseError && error.response.status === 403
}

/**
 * D8: the real next step, wardrobe onboarding for every member whose profile loads. A teen the
 * guardian lock refuses never gets here (the profile answers 403), and with guardian consent off
 * (2026-11-16) a teen without a guardian is a member like any other.
 */
export async function resolveWebNextStep(
  token: string,
  addGarment = false
): Promise<string> {
  try {
    userProfileResponseSchema.parse(
      await createWebApiClient({ accessToken: token }).apiV1UserProfileGet({
        signal: AbortSignal.timeout(COMFORT_TIMEOUT_MS),
      })
    )
    return addGarment ? '/wardrobe?entry=add' : '/wardrobe/onboarding'
  } catch {
    return '/wardrobe/onboarding'
  }
}
