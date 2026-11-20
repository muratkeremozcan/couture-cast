// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// The one persistent synthetic member the production run signs in as, so production checks can be
// signed in. Production rejects test tokens and has no test identity, so this member is a real
// adult account that scripts/ops/provision-prod-synthetic-member.mjs creates once, with a password
// only the run holds (the GitHub environment secret PROD_SYNTHETIC_MEMBER_PASSWORD).
//
// Least privilege: the credential opens a session for this one member through Supabase's password
// grant. No admin key reaches CI. The production run is read-only as this member (feed loads,
// profile reachable, city search answers); anything that writes runs on the preview lane. So
// there is nothing for the run to clean up, and sign-out at the end revokes the session it opened.
//
// The bearer is a credential in a public repository's artifacts, so it travels one way only:
// - Node requests (`signInProdSyntheticMember`, `prodMemberApiGet`) go to exact, trusted origins,
//   refuse redirects, and report a status or a category, never the request or its headers (the
//   Playwright API fixture would print them in its call log);
// - a browser receives the session as in-memory storage state for the one trusted web origin
//   (`prodMemberStorageState`), never an init script that would write it into any origin a page
//   reaches;
// - production global setup masks the token in the runner's log before tests start;
//   the artifact scan rejects any JWT.
// Specs sign in through the `prodMember` fixture (fixtures/prod-member-fixture.ts).

export const PROD_SYNTHETIC_MEMBER_EMAIL = 'synthetic-prod-member@example.com'
export const PROD_MEMBER_SESSION_ENV = 'COUTURE_E2E_PROD_MEMBER_SESSION'
/** The only origins the member's credential may reach, whatever a manual run overrides. */
export const TRUSTED_PROD_WEB_ORIGIN = 'https://couture-cast-web.vercel.app'
export const TRUSTED_PROD_API_ORIGIN = 'https://couture-cast-api.vercel.app'
/** The key the web app's Supabase client stores its session under. */
const AUTH_SESSION_STORAGE_KEY = 'couturecast.auth-session'
const REQUEST_TIMEOUT_MS = 15_000
/** Supabase's hosted projects: `https://<20 lowercase letters or digits>.supabase.co`. */
const SUPABASE_PROJECT_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/

export type ProdSyntheticMember = {
  email: string
  /** The Supabase Auth user id. */
  authUserId: string
  accessToken: string
  /** The stored session a browser of this member starts from. */
  session: Record<string, unknown>
  /** For sign-out only. */
  supabaseUrl: string
  publishableKey: string
}

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

export function isProdRun(env: Env = process.env): boolean {
  return env.TEST_ENV?.trim().toLowerCase() === 'prod'
}

/** The origin of a URL, or null when it is not a URL. */
function originOf(value: string | undefined): string | null {
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

/**
 * The credential reaches production only. A manual run can override the base URLs; a token
 * never follows an override, so the run fails instead.
 */
export function assertTrustedProdOrigins(webBaseUrl: string, apiBaseUrl: string): void {
  if (originOf(webBaseUrl) !== TRUSTED_PROD_WEB_ORIGIN)
    throw new Error('The synthetic member runs only against the production web origin.')
  if (originOf(apiBaseUrl) !== TRUSTED_PROD_API_ORIGIN)
    throw new Error('The synthetic member runs only against the production API origin.')
}

/** Where the run reads the member's inputs: the CI variables, or the operator's .env.prod. */
export function prodSyntheticMemberConfig(env: Env = process.env) {
  const supabaseUrl = (env.PROD_SUPABASE_URL ?? env.SUPABASE_URL)
    ?.trim()
    .replace(/\/$/, '')
  const publishableKey = (
    env.PROD_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim()
  const password = env.PROD_SYNTHETIC_MEMBER_PASSWORD
  const email = env.PROD_SYNTHETIC_MEMBER_EMAIL?.trim() || PROD_SYNTHETIC_MEMBER_EMAIL
  const missing = [
    ['PROD_SUPABASE_URL', supabaseUrl],
    ['PROD_SUPABASE_PUBLISHABLE_KEY', publishableKey],
    ['PROD_SYNTHETIC_MEMBER_PASSWORD', password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
  return { supabaseUrl, publishableKey, password, email, missing }
}

/** A request that carries a credential: bounded, no redirects, no ambient headers. */
function guardedFetch(fetchImpl: Fetch, url: string, init: RequestInit) {
  return fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Signs in as the synthetic member. Throws, naming the missing input, when the run lacks one: a
 * production run that cannot sign in must be red, not silently signed out. Errors name a status
 * or a category, never the request: they land in a public report.
 */
export async function signInProdSyntheticMember(
  env: Env = process.env,
  fetchImpl: Fetch = fetch
): Promise<ProdSyntheticMember> {
  const config = prodSyntheticMemberConfig(env)
  if (config.missing.length)
    throw new Error(
      `The production synthetic member cannot sign in: ${config.missing.join(', ')} unset. ` +
        'Run scripts/ops/provision-prod-synthetic-member.mjs --apply --push-secrets.'
    )
  if (!SUPABASE_PROJECT_ORIGIN.test(config.supabaseUrl!))
    throw new Error('PROD_SUPABASE_URL is not a hosted Supabase project origin.')
  let response: Response
  try {
    response = await guardedFetch(
      fetchImpl,
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: { apikey: config.publishableKey!, 'content-type': 'application/json' },
        body: JSON.stringify({ email: config.email, password: config.password }),
      }
    )
  } catch {
    throw new Error('The production synthetic member sign-in request failed to complete.')
  }
  if (!response.ok)
    throw new Error(
      `The production synthetic member's password sign-in answered ${response.status}.`
    )
  const session = (await response.json()) as Record<string, unknown> & {
    access_token?: string
    user?: { id?: string }
  }
  if (!session.access_token || !session.user?.id)
    throw new Error('The production synthetic member sign-in returned no session.')
  return {
    email: config.email,
    authUserId: session.user.id,
    accessToken: session.access_token,
    session,
    supabaseUrl: config.supabaseUrl!,
    publishableKey: config.publishableKey!,
  }
}

/** The CI runner supplies one masked session to its workers through process memory. */
export function prodMemberFromRunner(env: Env = process.env): ProdSyntheticMember {
  const session = env[PROD_MEMBER_SESSION_ENV]
  if (!session) throw new Error('Production member setup did not supply a CI session.')
  let member: ProdSyntheticMember | null
  try {
    member = JSON.parse(session) as ProdSyntheticMember | null
  } catch {
    throw new Error('Production member setup supplied an unreadable CI session.')
  }
  if (!member?.authUserId || !member.accessToken || !member.session) {
    throw new Error('Production member setup supplied an incomplete CI session.')
  }
  return member
}

/**
 * Revokes the session the run opened, bounded and best effort: the access token expires on its
 * own. Returns what happened as a safe category.
 */
export async function signOutProdSyntheticMember(
  member: ProdSyntheticMember,
  fetchImpl: Fetch = fetch
): Promise<'revoked' | `refused ${number}` | 'unreachable'> {
  try {
    const response = await guardedFetch(
      fetchImpl,
      `${member.supabaseUrl}/auth/v1/logout?scope=local`,
      {
        method: 'POST',
        headers: {
          apikey: member.publishableKey,
          authorization: `Bearer ${member.accessToken}`,
        },
      }
    )
    return response.ok ? 'revoked' : `refused ${response.status}`
  } catch {
    return 'unreachable'
  }
}

export async function closeProdSyntheticMember(
  member: ProdSyntheticMember
): Promise<void> {
  const outcome = await signOutProdSyntheticMember(member)
  if (outcome !== 'revoked')
    console.warn(`Synthetic member sign-out: ${outcome}; the token expires on its own.`)
}

/**
 * One read of a production API path as this member, for the canary and the member specs. It is
 * not Playwright's API fixture: a failed fixture request prints its outgoing headers, bearer
 * included, into the error. Here a failure is a category.
 */
export async function prodMemberApiGet(
  member: ProdSyntheticMember,
  apiBaseUrl: string,
  path: string,
  fetchImpl: Fetch = fetch
): Promise<{ status: number; body: unknown }> {
  if (originOf(apiBaseUrl) !== TRUSTED_PROD_API_ORIGIN)
    throw new Error('The synthetic member runs only against the production API origin.')
  try {
    const response = await guardedFetch(fetchImpl, `${TRUSTED_PROD_API_ORIGIN}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${member.accessToken}`,
        'x-couture-platform': 'web',
      },
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  } catch {
    throw new Error(`The production API read of ${path} failed to complete.`)
  }
}

/**
 * The stored session of a browser that holds this member: only the fields the web app reads,
 * and no real refresh token (it would be recorded in artifacts, and a browser that rotated it
 * would invalidate the run's own session). The access token outlasts any test, so the browser
 * never refreshes.
 */
export function browserSessionOf(member: ProdSyntheticMember): Record<string, unknown> {
  const { access_token, token_type, expires_in, expires_at } = member.session
  const user = (member.session.user ?? {}) as Record<string, unknown>
  return {
    access_token,
    token_type,
    expires_in,
    expires_at,
    refresh_token: 'synthetic-member-run-only',
    user: {
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      app_metadata: {},
      user_metadata: {},
      created_at: user.created_at,
    },
  }
}

/**
 * In-memory Playwright storage state for a context that holds this member: the product's own
 * session key in local storage of the one trusted production web origin, and nothing else. A
 * page that leaves that origin, or a frame inside it from another, never sees the token.
 * Use with `browser.newContext({ storageState })`.
 */
export function prodMemberStorageState(member: ProdSyntheticMember, webBaseUrl: string) {
  if (originOf(webBaseUrl) !== TRUSTED_PROD_WEB_ORIGIN)
    throw new Error('The synthetic member runs only against the production web origin.')
  return {
    cookies: [],
    origins: [
      {
        origin: TRUSTED_PROD_WEB_ORIGIN,
        localStorage: [
          {
            name: AUTH_SESSION_STORAGE_KEY,
            value: JSON.stringify(browserSessionOf(member)),
          },
        ],
      },
    ],
  }
}
