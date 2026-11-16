// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D10: the Google stand-in for the real local stack.
//
// The app always asks Supabase for `provider=google`. Local GoTrue cannot reach a Google double,
// so this helper (1) records the app's authorize request exactly as sent, (2) rewrites only its
// `provider` to `keycloak`, and (3) sends the browser on to the harness mock OIDC server with a
// one-time ticket that chooses the identity. Everything after that (the mock's authorize,
// GoTrue's callback, the PKCE code exchange, identity linking, the app's callback page) runs in
// the browser for real.
import type { Page, Route } from '@playwright/test'

/** The mock's one origin, for GoTrue and every browser (`mock-oidc-container.mjs`). */
export const MOCK_OIDC_ORIGIN = 'http://127.0.0.1:53052'

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

/** The mock authorize URL GoTrue redirects to, with the ticket as its `login_hint`. */
export function ticketedMockUrl(url: string, ticket: string): string | null {
  if (!url.startsWith(`${MOCK_OIDC_ORIGIN}/`)) return null
  const parsed = new URL(url)
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
 * GoTrue's authorize (with the provider swapped) runs here, server side, because the ticket must
 * go onto the mock URL it answers with: Playwright does not route the hop after a fulfilled
 * redirect, so the browser cannot be handed the rewritten request and intercepted again. The
 * browser is then redirected to that mock URL and runs every later hop itself.
 */
export async function armGoogleStandIn(page: Page, identity: StandInIdentity) {
  const created = await fetch(`${MOCK_OIDC_ORIGIN}/__control/tickets`, {
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
      const mockUrl = toProvider.location && ticketedMockUrl(toProvider.location, ticket)
      if (toProvider.status !== 302 || !mockUrl)
        throw new Error(
          `GoTrue authorize did not redirect to the mock (${toProvider.status}).`
        )
      // Playwright's WebKit cannot fulfill a redirect status, so there the page replaces itself
      // with the mock URL: the same single hop, with no history entry of its own.
      if (page.context().browser()?.browserType().name() === 'webkit')
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><script>location.replace(${JSON.stringify(mockUrl)})</script>`,
        })
      else await route.fulfill({ status: 302, headers: { location: mockUrl } })
    }
  )
  return { authorizes }
}
