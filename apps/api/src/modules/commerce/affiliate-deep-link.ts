/**
 * Story 5.1 decision 7: outbound URL construction and its host guard.
 *
 * The catalog is operator-managed with no admin console, so a `CommercePartner`
 * row is the only thing standing between an inserted `deep_link_template` and a
 * redirect this API hands to a user. Every rejection below is therefore a
 * defence against a bad or malicious catalog row rather than against a client:
 * a client cannot influence any input here.
 */

/** The literal token a `deep_link_template` must contain. */
export const CLICK_TOKEN_PLACEHOLDER = '{clickToken}'

export type AffiliateRedirectResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: AffiliateRedirectRejection }

export type AffiliateRedirectRejection =
  | 'missing_placeholder'
  | 'unparseable'
  | 'not_https'
  | 'has_userinfo'
  | 'host_not_allowed'

/**
 * Substitutes the token and validates the result, returning a reason rather than
 * throwing so the caller can log which rule a catalog row broke without leaking
 * the URL or the token into the response.
 *
 * The host rule is exact match or dot-suffix: `shop.example.com` matches
 * `example.com`, and `notexample.com` does not. Comparing after `new URL(...)`
 * is what makes that safe, because the parser has already lowercased the host
 * and converted any internationalized label to its punycode form, so a
 * homograph host cannot slip past a string compare.
 */
export function buildAffiliateRedirectUrl(
  deepLinkTemplate: string,
  allowedHost: string,
  clickToken: string
): AffiliateRedirectResult {
  if (!deepLinkTemplate.includes(CLICK_TOKEN_PLACEHOLDER)) {
    return { ok: false, reason: 'missing_placeholder' }
  }

  const substituted = deepLinkTemplate.replaceAll(CLICK_TOKEN_PLACEHOLDER, clickToken)

  let parsed: URL
  try {
    parsed = new URL(substituted)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'not_https' }
  }

  // `https://user:pass@partner.test@evil.test/` and friends. A userinfo
  // component moves the real authority to the right of an `@` that a human
  // reviewing the catalog row will not notice.
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'has_userinfo' }
  }

  const normalizedAllowedHost = allowedHost.trim().toLowerCase()
  const hostname = parsed.hostname.toLowerCase()
  const hostAllowed =
    normalizedAllowedHost.length > 0 &&
    (hostname === normalizedAllowedHost || hostname.endsWith(`.${normalizedAllowedHost}`))

  if (!hostAllowed) {
    return { ok: false, reason: 'host_not_allowed' }
  }

  return { ok: true, url: parsed.toString() }
}
