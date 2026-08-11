// Story 5.1 Task 6 owner: mobile commerce boundary (affiliate CTA + opt-out).
//
// Everything the affiliate CTA needs from the network lives here so the hero
// card and the settings screen stay presentational. Two rules in this file are
// load-bearing:
//
// 1. A CTA is only ever rendered from a payload that came off the network.
//    `resolveRenderableShopThisLook` is the single predicate both the screen
//    (which emits the impression event) and the card (which draws the control)
//    call, so the "is this eligible" answer cannot drift between them and leave
//    an impression counted for a control nobody saw, or a control drawn from a
//    cached payload that survived an opt-out.
// 2. A click is minted before any navigation. If the mint fails the caller must
//    not navigate: unattributed traffic is worthless to the partner and
//    unauditable for us.
import {
  affiliateClickResponseSchema,
  commercePreferenceResponseSchema,
  updateCommercePreferenceResponseSchema,
  type AffiliateClickRequest,
  type CommercePreference,
  type ScenarioOutfit,
  type ShopThisLook,
} from '@couture/api-client/contracts/http'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'

const COMMERCE_REQUEST_TIMEOUT_MS = 15_000

/**
 * The '*' sentinel a catalog row carries to publish globally. It is also what a
 * locale with no region subtag resolves to, so an unregioned UI language sees
 * global offers rather than none.
 */
export const GLOBAL_LOCALE_REGION = '*'

function commerceClient() {
  return createMobileApiClient({
    accessToken: async () => (await resolveMobileAccessToken()) || '',
  })
}

/**
 * Bounds every commerce request. Without this a hung click leaves the CTA in
 * its busy state forever, which reads as a frozen button and no amount of
 * tapping recovers it.
 */
async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  request: (requestSignal: AbortSignal) => Promise<T>,
  timeoutMs = COMMERCE_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)

  if (signal?.aborted) {
    abortFromCaller()
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await request(controller.signal)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * The uppercased region subtag of the resolved UI language, which is what the
 * catalog's `locale_region` column is keyed on. This is a UI-language region and
 * not a commerce jurisdiction: a user in the US reading the app in `fr-FR` gets
 * `FR` offers. `es-419` yields `419`, a UN M.49 macro-region rather than a
 * country. A locale with no region subtag yields the global sentinel.
 */
export function resolveAffiliateLocaleRegion(locale: string): string {
  const region = locale.split('-')[1]?.toUpperCase()
  return region && /^[A-Z0-9]{2,3}$/.test(region) ? region : GLOBAL_LOCALE_REGION
}

/**
 * The one place that decides whether a card may show an affiliate CTA.
 *
 * A cache-served payload never qualifies, however fresh it looks. The device
 * cache holds a ritual for fifteen minutes online and indefinitely offline, so
 * rendering from it would keep a CTA alive for fifteen minutes after an opt-out
 * and forever on a device that cannot reach the network. That reads to a user as
 * an opt-out that did not work.
 */
export function resolveRenderableShopThisLook(
  outfit: ScenarioOutfit | undefined,
  isCacheServed: boolean
): ShopThisLook | null {
  if (!outfit || isCacheServed) {
    return null
  }
  return outfit.shopThisLook
}

export async function getCommercePreferenceFromMobile(
  signal?: AbortSignal
): Promise<CommercePreference> {
  const response = await withRequestTimeout(signal, (requestSignal) =>
    commerceClient().apiV1CommercePreferencesGet({ signal: requestSignal })
  )
  return commercePreferenceResponseSchema.parse(response).data
}

export async function updateCommercePreferenceFromMobile(
  affiliateCtasEnabled: boolean,
  signal?: AbortSignal
): Promise<CommercePreference> {
  const response = await withRequestTimeout(signal, (requestSignal) =>
    commerceClient().apiV1CommercePreferencesPut(
      { updateCommercePreferenceInput: { affiliateCtasEnabled } },
      { signal: requestSignal }
    )
  )
  return updateCommercePreferenceResponseSchema.parse(response).data
}

/**
 * Mints the attributed click and returns the outbound partner URL.
 *
 * `scenario` and `localeRegion` are deliberately not sent: the API derives both
 * from the recommendation and the resolved locale, so a client cannot influence
 * what the attribution record says.
 */
export async function mintAffiliateClickFromMobile(
  input: AffiliateClickRequest,
  signal?: AbortSignal
): Promise<string> {
  const response = await withRequestTimeout(signal, (requestSignal) =>
    commerceClient().apiV1CommerceAffiliateClicksPost(
      { affiliateClickRequest: input },
      { signal: requestSignal }
    )
  )
  return affiliateClickResponseSchema.parse(response).data.redirectUrl
}

/**
 * Hands the minted URL to the in-app browser, matching
 * `components/external-link.tsx`. `Linking.openURL` appears nowhere in this
 * repo, and because this opens an in-app browser the localized line under the
 * CTA reads "in an in-app browser" rather than "your browser".
 *
 * Imported lazily, following the `expo-file-system/legacy` precedent in
 * `ritual-cache.ts`: `expo-web-browser` pulls in `expo-modules-core`, which
 * cannot be evaluated in a web bundle, so a static import here would break
 * every module that transitively reaches this file.
 */
export async function openAffiliatePartnerSite(redirectUrl: string): Promise<void> {
  const webBrowser = await import('expo-web-browser')
  await webBrowser.openBrowserAsync(redirectUrl)
}
