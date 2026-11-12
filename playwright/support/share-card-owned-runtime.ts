/**
 * The owned UUID runtime the share-card Playwright specs read (scripts/e2e-share-card
 * provisions it), plus the sign-in, feed and dialog helpers both specs share:
 * `share-card-export.spec.ts` (Story 6.8) and `share-card-native-share.spec.ts` (Story 6.9).
 * Importing this module refuses any database that is not an owned `tea_community_<uuid>`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createClient, type Session } from '@supabase/supabase-js'
import type { BrowserContext, Download, Locator, Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { decodeShareCardBase64, validateShareCardPng } from '@couture/api-client'
import { afterInitialCommunityVerification } from '../../scripts/lib/story68-browser-watermark.mjs'
import { expect } from './fixtures/share-card-fixtures'
export const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
export const read = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
export const env = read('owned-env.json') as {
  DATABASE_URL: string
  API_BASE_URL: string
}
if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(env.DATABASE_URL).pathname))
  throw new Error('owned_uuid_required')
export const fixture = read('fixtures.json') as {
  postId: string
  identities: { email: string; appUserId: string; authUserId: string; label: string }[]
}
export const build = read('public-build-env.json') as {
  EXPO_PUBLIC_SUPABASE_ANON_KEY: string
  EXPO_PUBLIC_API_BASE_URL: string
}
export const proxy = read('auth-harness.json') as { proxyUrl: string; otpDir: string }
export async function session(account: number): Promise<Session> {
  const auth = createClient(proxy.proxyUrl, build.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const filename = `session-${account === 0 ? 'primary' : 'secondary'}.json`
  if (fs.existsSync(path.join(directory, filename))) {
    const existing = read(filename) as Session
    if ((existing.expires_at ?? 0) * 1000 > Date.now() + 60000) {
      // An earlier genuine UI sign-out revokes this session before its JWT expires.
      const current = await auth.auth.getUser(existing.access_token)
      if (current.data.user) {
        expect(current.data.user.id).toBe(existing.user.id)
        return existing
      }
      if (
        current.error?.code !== 'session_not_found' &&
        !(
          current.error?.name === 'AuthSessionMissingError' &&
          current.error.status === 400
        )
      )
        throw new Error('owned_cached_session_verification_failed')
    }
  }
  const identity = fixture.identities[account]!
  const since = Date.now()
  const issued = await auth.auth.signInWithOtp({
    email: identity.email,
    options: { shouldCreateUser: false },
  })
  expect(issued.error).toBeNull()
  const code = JSON.parse(
    fs.readFileSync(
      path.join(
        proxy.otpDir,
        createHash('sha256').update(identity.email).digest('hex') + '.json'
      ),
      'utf8'
    )
  ) as { issuedAt: number; code: string }
  expect(code.issuedAt).toBeGreaterThanOrEqual(since)
  const verified = await auth.auth.verifyOtp({
    email: identity.email,
    token: code.code,
    type: 'email',
  })
  expect(verified.error).toBeNull()
  expect(verified.data.session).toBeTruthy()
  fs.writeFileSync(
    path.join(directory, filename),
    JSON.stringify(verified.data.session),
    { mode: 0o600 }
  )
  return verified.data.session!
}
export async function identify(context: BrowserContext, account = 0) {
  const member = await session(account)
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem('cc68-session-initialized')) {
      localStorage.setItem('couturecast.auth-session', JSON.stringify(value))
      sessionStorage.setItem('cc68-session-initialized', 'true')
    }
  }, member)
  return member
}
export const modal = (page: Page) => page.locator('[aria-labelledby="share-card-title"]')
// Loads the home feed once the owned post is verified, and returns the API origin.
export async function loadOwnFeed(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  const profile = interceptNetworkCall({ method: 'GET', url: '**/api/v1/user/profile' })
  // The feed settles only after the owned target resolves and the cursor replay lands,
  // and the spotlight above it grows past its skeleton's height when its cards land.
  // A click pressed before both can release over another element and never open.
  await afterInitialCommunityVerification({
    page,
    postId: fixture.postId,
    navigate: () => page.goto('/').then(() => undefined),
  })
  await expect(page.getByTestId('community-spotlight-loading')).toHaveCount(0)
  const verified = await profile
  expect(verified.status).toBe(200)
  return new URL(verified.request!.url()).origin
}
export async function ownPhoto(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn | null,
  preparationJourney?: (open: () => Promise<void>, apiOrigin: string) => Promise<void>
) {
  const apiOrigin = interceptNetworkCall
    ? await loadOwnFeed(page, interceptNetworkCall)
    : ''
  const opener = page
    .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
    .first()
    .getByTestId('share-card-open')
  await expect(opener).toBeVisible()
  if (preparationJourney) await preparationJourney(() => opener.click(), apiOrigin)
  else await opener.click()
  const preview = modal(page).getByTestId('share-card-preview')
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  return { opener, preview, dialog: modal(page) }
}
export async function previewBytes(preview: Locator) {
  const bytes = decodeShareCardBase64((await preview.getAttribute('src'))!.split(',')[1]!)
  validateShareCardPng(bytes)
  return bytes
}
export const sha256 = (bytes: Uint8Array | Buffer) =>
  createHash('sha256').update(bytes).digest('hex')
export async function activateFocused(control: Locator) {
  await control.focus()
  await expect(control).toBeFocused()
  await control.press('Enter')
}
// playwright-utils deviation: handleDownload saves the file but does not expose
// Download.suggestedFilename, which these cases assert.
export const nextDownload = (page: Page) => page.waitForEvent('download')
export async function downloadedDigest(download: Download, file: string) {
  // saveAs works for local and remote browsers; Download.path() only for local ones.
  await download.saveAs(file)
  return sha256(fs.readFileSync(file))
}
