// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// The one persistent synthetic member the production run signs in as, so production checks can be
// signed in. Production rejects test tokens and has no test identity, so this member is a real
// adult account that scripts/ops/provision-prod-synthetic-member.mjs creates once, with a password
// only the run holds (GitHub secret PROD_SYNTHETIC_MEMBER_PASSWORD).
//
// Least privilege: the credential opens a session for this one member through Supabase's password
// grant. No admin key reaches CI. The production run is read-only as this member (feed loads,
// profile reachable, city search answers); anything that writes runs on the preview lane. So
// there is nothing for the run to clean up, and sign-out at the end revokes the session it opened.
//
// Specs sign in through the `prodMember` fixture (fixtures/prod-member-fixture.ts); a browser gets
// the same session as the product's own sign-in leaves, through `seedProdMemberBrowserSession`.
import type { BrowserContext } from '@playwright/test'

export const PROD_SYNTHETIC_MEMBER_EMAIL = 'synthetic-prod-member@example.com'
/** The key the web app's Supabase client stores its session under. */
const AUTH_SESSION_STORAGE_KEY = 'couturecast.auth-session'

export type ProdSyntheticMember = {
  email: string
  /** The Supabase Auth user id. */
  authUserId: string
  accessToken: string
  /** The stored session a browser of this member starts from. */
  session: Record<string, unknown>
  /** For sign-out only; it never reaches a browser or a trace. */
  supabaseUrl: string
  publishableKey: string
}

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

export function isProdRun(env: Env = process.env): boolean {
  return env.TEST_ENV?.trim().toLowerCase() === 'prod'
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

/**
 * Signs in as the synthetic member. Throws, naming the missing input, when the run lacks one: a
 * production run that cannot sign in must be red, not silently signed out.
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
  const response = await fetchImpl(
    `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: config.publishableKey!, 'content-type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password }),
    }
  )
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

/** Revokes the session the run opened. Best effort: the access token expires on its own. */
export async function signOutProdSyntheticMember(
  member: ProdSyntheticMember,
  fetchImpl: Fetch = fetch
): Promise<void> {
  await fetchImpl(`${member.supabaseUrl}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: {
      apikey: member.publishableKey,
      authorization: `Bearer ${member.accessToken}`,
    },
  }).catch(() => undefined)
}

/** The headers of a web API call as this member. */
export function prodMemberHeaders(member: ProdSyntheticMember): Record<string, string> {
  return {
    authorization: `Bearer ${member.accessToken}`,
    'x-couture-platform': 'web',
  }
}

/**
 * The stored session of a browser that holds this member. The refresh token is replaced: it would
 * be recorded in traces, and a browser that rotated it would invalidate the run's own session.
 * The access token outlasts any test, so the browser never needs to refresh.
 */
export function browserSessionOf(member: ProdSyntheticMember): Record<string, unknown> {
  return { ...member.session, refresh_token: 'synthetic-member-run-only' }
}

/**
 * Starts every page of the context signed in as the member: the product's own session storage
 * key holds the session before the first script of a page runs, so the web app verifies it the
 * way it verifies a returning member. A page that already stores a session keeps it.
 */
export async function seedProdMemberBrowserSession(
  context: BrowserContext,
  member: ProdSyntheticMember
): Promise<void> {
  await context.addInitScript(
    ({ key, session }) => {
      try {
        if (window.localStorage.getItem(key) === null)
          window.localStorage.setItem(key, JSON.stringify(session))
      } catch {
        // A document without storage starts signed out; the spec's own assertions say so.
      }
    },
    { key: AUTH_SESSION_STORAGE_KEY, session: browserSessionOf(member) }
  )
}
