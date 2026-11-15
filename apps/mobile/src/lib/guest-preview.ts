// Story 6.16 owner: the mobile side of the guest preview. One store over a local file,
// guest analytics that can never block the screen, and the verified comfort read and
// write for the review step.
import { Platform } from 'react-native'
import {
  withRequestDeadline,
  ResponseError,
  trackGuestPreviewInteracted,
  trackGuestPreviewSignupClicked,
  trackGuestPreviewStarted,
  type GuestPreviewInteractedEvent,
} from '@couture/api-client'
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import { SAMPLE_CATALOG, type SampleComfort } from '@couture/utils'
import {
  mobileAnalyticsClient,
  resetMobileAnalyticsIdentity,
} from '../analytics/mobile-analytics'
import { createMobileApiClient } from './api-client'
import { mobileApplicationUserId, resolveMobileAccessToken } from './mobile-auth'

export {
  fileGuestPreviewAdapter,
  GUEST_PREVIEW_FILE_NAME,
  GUEST_PREVIEW_STORAGE_KEY,
  mobileGuestPreviewStore,
  setMobileGuestPreviewStoreForTests,
} from './guest-preview-store'

const CATALOG_VERSION = SAMPLE_CATALOG.catalogVersion
const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android')

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
      mobileAnalyticsClient.capture(
        'guest_preview_started',
        trackGuestPreviewStarted({
          platform: platform(),
          catalog_version: CATALOG_VERSION,
        })
      )
    )
  },
  interacted(
    action: GuestPreviewInteractedEvent['action'],
    control?: GuestPreviewInteractedEvent['control']
  ) {
    safely(() =>
      mobileAnalyticsClient.capture(
        'guest_preview_interacted',
        trackGuestPreviewInteracted({
          platform: platform(),
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
      mobileAnalyticsClient.capture(
        'guest_preview_signup_clicked',
        trackGuestPreviewSignupClicked({
          platform: platform(),
          catalog_version: CATALOG_VERSION,
          action,
        })
      )
    )
    resetMobileAnalyticsIdentity()
  },
}

const REQUEST_DEADLINE_MS = 8000

export type MobileComfortClient = {
  memberId: string
  read: () => Promise<SampleComfort>
  write: (values: SampleComfort) => Promise<unknown>
}

/** The verified member and an authenticated comfort client, or null when signed out. */
export async function verifiedComfortClient(): Promise<MobileComfortClient | null> {
  const token = await resolveMobileAccessToken()
  const memberId = mobileApplicationUserId()
  if (!token || !memberId) return null
  const api = createMobileApiClient({ accessToken: token })
  return {
    memberId,
    read: async () =>
      comfortPreferencesResponseSchema.parse(
        await withRequestDeadline(REQUEST_DEADLINE_MS, [], (signal) =>
          api.apiV1PersonalizationComfortGet({ signal })
        )
      ).data,
    write: async (values) =>
      updateComfortPreferencesResponseSchema.parse(
        await withRequestDeadline(REQUEST_DEADLINE_MS, [], (signal) =>
          api.apiV1PersonalizationComfortPut(
            { updateComfortPreferencesInput: values },
            { signal }
          )
        )
      ),
  }
}

/** D2: a server age or consent refusal outranks the proposal. */
export function isConsentRejection(error: unknown): boolean {
  return error instanceof ResponseError && error.response.status === 403
}

/**
 * D8: the real next step. A teen whose guardian has not granted consent goes to the teen
 * dashboard, where the existing guardian flow continues; everyone else to onboarding.
 */
export async function resolveMobileNextStep(): Promise<string> {
  try {
    const token = await resolveMobileAccessToken()
    if (!token) return '/signin'
    const profile = userProfileResponseSchema.parse(
      await withRequestDeadline(REQUEST_DEADLINE_MS, [], (signal) =>
        createMobileApiClient({ accessToken: token }).apiV1UserProfileGet({ signal })
      )
    )
    const consented = profile.linkedGuardians.some((link) => link.status === 'granted')
    return profile.user.role === 'teen' && !consented
      ? '/teen-dashboard'
      : '/wardrobe-onboarding'
  } catch {
    return '/wardrobe-onboarding'
  }
}
