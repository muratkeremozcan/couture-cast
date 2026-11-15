// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D10: the Google stand-in for the real local stack.
//
// The app always asks Supabase for `provider=google`. Local GoTrue cannot reach a Google double,
// so this helper (1) records the app's authorize request exactly as sent, (2) rewrites only its
// `provider` to `keycloak`, and (3) carries the browser to the harness mock OIDC server, choosing
// the identity with a one-time ticket. Everything after that (GoTrue's callback, the PKCE code
// exchange, identity linking, the app's callback page) runs for real.
import type { Page, Route } from '@playwright/test'

export const MOCK_OIDC_INTERNAL_ORIGIN = 'http://couturecast-mock-oidc:8080'
export const MOCK_OIDC_PUBLIC_ORIGIN = 'http://127.0.0.1:53052'

export type StandInIdentity = {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
  /** The provider answers `error=access_denied`, as a chooser closed by the person does. */
  deny?: boolean
}

/** The authorize request as the app sent it, before the rewrite. */
export type RecordedAuthorize = {
  provider: string | null
  prompt: string | null
  redirectTo: string | null
  codeChallengeMethod: string | null
  hasCodeChallenge: boolean
}

/** The one authorize URL shape the stand-in rewrites: `/auth/v1/authorize?provider=google`. */
export function rewriteAuthorizeUrl(url: string): string | null {
  const parsed = new URL(url)
  if (!/\/auth\/v1\/authorize$/.test(parsed.pathname)) return null
  if (parsed.searchParams.get('provider') !== 'google') return null
  parsed.searchParams.set('provider', 'keycloak')
  return parsed.toString()
}

/** The mock's internal URL GoTrue redirects to, as the browser can reach it, with the ticket. */
export function publicMockUrl(url: string, ticket: string): string | null {
  if (!url.startsWith(`${MOCK_OIDC_INTERNAL_ORIGIN}/`)) return null
  const parsed = new URL(
    MOCK_OIDC_PUBLIC_ORIGIN + url.slice(MOCK_OIDC_INTERNAL_ORIGIN.length)
  )
  parsed.searchParams.set('login_hint', ticket)
  return parsed.toString()
}

export function recordAuthorize(url: string): RecordedAuthorize {
  const query = new URL(url).searchParams
  return {
    provider: query.get('provider'),
    prompt: query.get('prompt'),
    redirectTo: query.get('redirect_to'),
    codeChallengeMethod: query.get('code_challenge_method'),
    hasCodeChallenge: (query.get('code_challenge') ?? '').length > 0,
  }
}

/** One hop with no redirect following: the status and Location of `url`. */
async function hop(route: Route, url: string) {
  const response = await route.fetch({ url, maxRedirects: 0 })
  return { status: response.status(), location: response.headers()['location'] ?? null }
}

/**
 * Arms the stand-in for the next Google start on `page`. Returns the recorded authorize
 * requests (one per start) so a test can assert what the app asked Supabase for.
 *
 * The two hops the browser cannot make itself (GoTrue's authorize, answered with a redirect to
 * the mock's container-only host, and the mock's own authorize) run here, server side. The
 * browser is then sent to the URL the mock returned: GoTrue's real `/auth/v1/callback` with the
 * one-time code and GoTrue's own state, from which everything runs in the browser. Playwright
 * does not route the hop after a fulfilled redirect, so the chain cannot be left to the browser.
 */
export async function armGoogleStandIn(page: Page, identity: StandInIdentity) {
  const created = await fetch(`${MOCK_OIDC_PUBLIC_ORIGIN}/__control/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  })
  if (created.status !== 201)
    throw new Error(`Mock OIDC ticket refused: ${created.status}`)
  const { ticket } = (await created.json()) as { ticket: string }
  const authorizes: RecordedAuthorize[] = []

  await page.route(
    (url) => rewriteAuthorizeUrl(url.toString()) !== null,
    async (route) => {
      const original = route.request().url()
      authorizes.push(recordAuthorize(original))
      const toProvider = await hop(route, rewriteAuthorizeUrl(original)!)
      const mockUrl = toProvider.location && publicMockUrl(toProvider.location, ticket)
      if (toProvider.status !== 302 || !mockUrl)
        throw new Error(
          `GoTrue authorize did not redirect to the mock (${toProvider.status}).`
        )
      const fromProvider = await hop(route, mockUrl)
      if (fromProvider.status !== 302 || !fromProvider.location)
        throw new Error(`The mock authorize did not redirect (${fromProvider.status}).`)
      await route.fulfill({ status: 302, headers: { location: fromProvider.location } })
    }
  )
  return { authorizes }
}
