import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import type { Page } from '@playwright/test'
import type { ApiRequestFixture } from './api-test'

export type RealCommunityAccount = {
  /** Null when the probe deliberately has no single canonical app account. */
  appUserId: string | null
  authUserId: string
  email: string
  mapping:
    | 'metadata'
    | 'email'
    | 'metadata-without-role'
    | 'metadata-invalid-role'
    | 'no-app-account'
    | 'ambiguous-email'
  issueMode: 'generated' | 'real-email'
  label: string
}

/**
 * Real-session acceptance needs an owned harness: an isolated UUID database, the local Auth
 * proxy and a web build without fixture auth. Normal Playwright runs have none of these, so
 * the specs skip with this reason instead of failing.
 */
export function realSessionSkipReason(): string | undefined {
  const directory = process.env.STORY65_REAL_SESSION_DIR
  if (!directory)
    return 'Story 6.5 real-session acceptance runs only in an owned harness (STORY65_REAL_SESSION_DIR is unset).'
  if (!fs.existsSync(path.join(directory, 'auth-harness.json')))
    return 'Story 6.5 real-session acceptance needs the owned local Auth harness (auth-harness.json is missing).'
  let database = ''
  try {
    database = new URL(process.env.DATABASE_URL ?? '').pathname
  } catch {
    database = ''
  }
  if (!/^\/tea_community_[a-f0-9]{32}$/.test(database))
    return 'Story 6.5 real-session acceptance needs an isolated UUID database.'
  return undefined
}

/**
 * How the first web account receives its sign-in code. The harness passes the mode
 * it resolved in STORY65_REAL_SESSION_OTP_MODE (`real-email` when Mailpit is up);
 * without it, a directory that already holds a real-mail proof uses generated codes.
 */
export function realSessionMailIssueMode(
  directory: string,
  env: NodeJS.ProcessEnv = process.env
): RealCommunityAccount['issueMode'] {
  const mode = env.STORY65_REAL_SESSION_OTP_MODE
  if (mode === 'generated' || mode === 'real-email') return mode
  return fs.existsSync(path.join(directory, 'real-mail-proof.json'))
    ? 'generated'
    : 'real-email'
}

function harnessDirectory() {
  const directory = process.env.STORY65_REAL_SESSION_DIR
  if (!directory) throw new Error('An owned real-session harness is required.')
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (!/^\/tea_community_[a-f0-9]{32}$/.test(database.pathname))
    throw new Error('Real-session fixtures require an isolated UUID database.')
  return directory
}

function adminClient() {
  const origin = new URL(process.env.SUPABASE_URL ?? '')
  if (!['localhost', '127.0.0.1'].includes(origin.hostname))
    throw new Error('Real-session fixtures require local Supabase Auth.')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('The local Auth Admin fixture credential is unavailable.')
  return createClient(origin.href, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const realCommunityEmail = () => `story65-real-${randomUUID()}@example.test`

/** Creates an eligible adult app account through the product signup endpoint. */
export async function signupRealCommunityAppUser(
  apiRequest: ApiRequestFixture,
  email: string
): Promise<string> {
  harnessDirectory()
  const response = await apiRequest({
    method: 'POST',
    baseUrl: 'http://127.0.0.1:4077',
    path: '/api/v1/auth/signup',
    body: { email, birthdate: '1990-06-15' },
  })
  if (response.status !== 201) throw new Error('Owned eligible app signup failed.')
  return signupResponseSchema.parse(response.body).userId
}

/**
 * Node-only local Auth account creation. Admin credentials never enter application code or
 * bundles. Every created identity is recorded so the owned Auth harness will issue its OTP.
 */
export async function createRealCommunityAuthAccount(options: {
  email: string
  appUserId: string | null
  appMetadata?: Record<string, string>
  mapping: RealCommunityAccount['mapping']
  issueMode?: RealCommunityAccount['issueMode']
  label: string
}): Promise<RealCommunityAccount> {
  const directory = harnessDirectory()
  const { data, error } = await adminClient().auth.admin.createUser({
    email: options.email,
    email_confirm: true,
    ...(options.appMetadata ? { app_metadata: options.appMetadata } : {}),
  })
  if (error || !data.user) throw new Error('Owned local Auth account creation failed.')
  if (data.user.id === options.appUserId)
    throw new Error('The auth/app identity mismatch is required.')
  const account: RealCommunityAccount = {
    appUserId: options.appUserId,
    authUserId: data.user.id,
    email: options.email,
    mapping: options.mapping,
    issueMode: options.issueMode ?? 'generated',
    label: options.label,
  }
  const file = path.join(directory, 'created-identities.json')
  const rows = (
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  ) as RealCommunityAccount[]
  fs.writeFileSync(file, `${JSON.stringify([...rows, account], null, 2)}\n`, {
    mode: 0o600,
  })
  return account
}

/** An eligible app account whose local Auth sub deliberately differs from the app User.id. */
export async function provisionRealCommunityAccount(
  apiRequest: ApiRequestFixture,
  options: {
    mapping: 'metadata' | 'email'
    issueMode?: RealCommunityAccount['issueMode']
    label: string
  }
): Promise<RealCommunityAccount & { appUserId: string }> {
  const email = realCommunityEmail()
  const userId = await signupRealCommunityAppUser(apiRequest, email)
  const account = await createRealCommunityAuthAccount({
    email,
    appUserId: userId,
    appMetadata:
      options.mapping === 'metadata'
        ? { app_user_id: userId, app_role: 'guardian' }
        : undefined,
    mapping: options.mapping,
    issueMode: options.issueMode,
    label: options.label,
  })
  return { ...account, appUserId: userId }
}

/**
 * Real local Auth OTP issuance and verifyOtp from Node, through the owned harness proxy.
 * Used for identity-mapping probes that need a genuine signed bearer outside the UI.
 */
export async function verifyRealCommunityOtp(
  account: RealCommunityAccount
): Promise<string> {
  const config = JSON.parse(
    fs.readFileSync(path.join(harnessDirectory(), 'auth-harness.json'), 'utf8')
  ) as { proxyUrl: string }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('The public Auth configuration is unavailable.')
  const auth = createClient(config.proxyUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth
  const issued = await auth.signInWithOtp({
    email: account.email,
    options: { shouldCreateUser: false },
  })
  if (issued.error) throw new Error('Owned OTP issuance failed.')
  const { data, error } = await auth.verifyOtp({
    email: account.email,
    token: readGeneratedCommunityCode(account),
    type: 'email',
  })
  if (error || !data.session) throw new Error('Owned OTP verification failed.')
  if (data.session.user.id !== account.authUserId)
    throw new Error('The verified Auth subject does not match the owned account.')
  return data.session.access_token
}

export function readGeneratedCommunityCode(account: RealCommunityAccount): string {
  const config = JSON.parse(
    fs.readFileSync(path.join(harnessDirectory(), 'auth-harness.json'), 'utf8')
  ) as { otpDir: string }
  const filename = `${createHash('sha256').update(account.email).digest('hex')}.json`
  const value = JSON.parse(
    fs.readFileSync(path.join(config.otpDir, filename), 'utf8')
  ) as {
    code: string
    issuedAt: number
  }
  if (!/^\d{6,10}$/.test(value.code) || Date.now() - value.issuedAt > 120_000)
    throw new Error('A fresh owned OTP is required.')
  return value.code
}

/** Mailpit is a harness dependency; message bodies and codes stay out of test logs. */
export async function readCommunityMailCode(email: string): Promise<string | undefined> {
  // playwright-utils deviation: secret mail content must bypass response-body logging.
  const response = await fetch('http://127.0.0.1:54324/api/v1/messages')
  if (!response.ok) throw new Error('The local mail catcher is unavailable.')
  const data = (await response.json()) as {
    messages: { ID: string; To: { Address: string }[] }[]
  }
  const message = data.messages.find((row) =>
    row.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase())
  )
  if (!message) return undefined
  const body = await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)
  if (!body.ok) throw new Error('The owned sign-in message could not be read.')
  const content = (await body.json()) as { Text?: string; HTML?: string }
  return `${content.Text ?? ''}\n${content.HTML ?? ''}`.match(/\b(\d{6,10})\b/)?.[1]
}

/** Run the product sign-in UI and its real verifyOtp; no bearer/storage injection. */
export async function signInRealCommunityWeb(
  page: Page,
  account: RealCommunityAccount,
  code: () => Promise<string>
) {
  // playwright-utils deviation: the standard provider issues bypass tokens; this lane proves real OTP UI.
  await page.goto('/signin')
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('button[type="submit"]').click()
  await page.locator('input[name="code"]').waitFor({ state: 'visible' })
  const secret = await code()
  await page.locator('input[name="code"]').fill(secret)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('http://127.0.0.1:3077/')
}
