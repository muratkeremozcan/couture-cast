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
import type { BrowserContext, Download, Locator, Page, Request } from '@playwright/test'
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
type TimelineWindow = Window & typeof globalThis & { __shareCardTimeline?: string[] }
// Init script. Records what a missing download needs to name its cause: the share
// dialog appearing, hiding behind another dialog and leaving, Download's busy state, the status and alert text,
// each download handoff, and visibility and connectivity changes.
function shareCardTimeline() {
  const target = window as TimelineWindow
  if (target.__shareCardTimeline) return
  const entries: string[] = []
  target.__shareCardTimeline = entries
  const started = performance.now()
  const note = (text: string) => {
    entries.push(`${Math.round(performance.now() - started)} ms ${text}`)
    if (entries.length > 120) entries.shift()
  }
  // A capturing listener sees the anchor click without replacing click(), which
  // the handoff probe in share-card-export.spec.ts shadows.
  document.addEventListener(
    'click',
    (event) => {
      const anchor = event.target
      if (anchor instanceof HTMLAnchorElement && anchor.download)
        note(`download handoff ${anchor.download}`)
    },
    true
  )
  document.addEventListener('visibilitychange', () =>
    note(`visibility ${document.visibilityState}`)
  )
  target.addEventListener('online', () => note('online'))
  target.addEventListener('offline', () => note('offline'))
  let last = ''
  const observe = () => {
    const dialog = document.querySelector('[aria-labelledby="share-card-title"]')
    const save = dialog?.querySelector('[data-testid="share-card-save"]')
    const state = dialog
      ? [
          dialog.getAttribute('aria-hidden') === 'true'
            ? 'dialog hidden'
            : 'dialog shown',
          `save busy=${save?.getAttribute('aria-busy') ?? 'false'}`,
          `unavailable=${save?.getAttribute('aria-disabled') ?? 'false'}`,
          `status="${dialog.querySelector('[role="status"]')?.textContent?.trim() ?? ''}"`,
          `alert="${dialog.querySelector('[role="alert"]')?.textContent?.trim() ?? ''}"`,
        ].join(' ')
      : 'no dialog'
    if (state !== last) note((last = state))
  }
  const start = () =>
    new MutationObserver(observe).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'aria-disabled', 'aria-hidden', 'aria-labelledby'],
    })
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
export async function identify(context: BrowserContext, account = 0) {
  const member = await session(account)
  await context.addInitScript(shareCardTimeline)
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
const preparePurpose = (request: Request) => {
  try {
    return String((request.postDataJSON() as { purpose?: unknown } | null)?.purpose)
  } catch {
    return 'unreadable'
  }
}
// A save that never hands off fails well inside the test timeout, so the error names
// where the save stopped: no save preparation sent (the click was dropped), a
// preparation that never answered or failed, or an answered one with no handoff.
const DOWNLOAD_WAIT_MS = 30000
// playwright-utils deviation: handleDownload saves the file but does not expose
// Download.suggestedFilename, which these cases assert.
export function nextDownload(page: Page): Promise<Download> {
  const started = Date.now()
  const preparations: string[] = []
  const note = (text: string) => preparations.push(`${Date.now() - started} ms ${text}`)
  const prepare = (request: Request) =>
    request.url().endsWith('/api/v1/share-cards/prepare') && request.method() === 'POST'
  const sent = (request: Request) => {
    if (prepare(request)) note(`prepare ${preparePurpose(request)} sent`)
  }
  const finished = (request: Request) => {
    if (!prepare(request)) return
    // A diagnostic only: a response that cannot be read (page closing) is noted, never thrown.
    void request.response().then(
      (response) =>
        note(
          `prepare ${preparePurpose(request)} answered ${response?.status() ?? 'none'}`
        ),
      () => note(`prepare ${preparePurpose(request)} response unreadable`)
    )
  }
  const failed = (request: Request) => {
    if (prepare(request))
      note(
        `prepare ${preparePurpose(request)} failed ${request.failure()?.errorText ?? ''}`
      )
  }
  page.on('request', sent)
  page.on('requestfinished', finished)
  page.on('requestfailed', failed)
  return page
    .waitForEvent('download', { timeout: DOWNLOAD_WAIT_MS })
    .catch(async (error: unknown) => {
      const timeline = await page
        .evaluate(() => (window as TimelineWindow).__shareCardTimeline ?? ['no timeline'])
        .catch((reason: unknown) => [`timeline unreadable: ${String(reason)}`])
      throw new Error(
        [
          `share_card_download_missing: no download within ${DOWNLOAD_WAIT_MS} ms.`,
          `Preparations since the wait began: ${preparations.join('; ') || 'none'}.`,
          `Page timeline (ms since load): ${timeline.join('; ')}.`,
        ].join('\n'),
        { cause: error }
      )
    })
    .finally(() => {
      page.off('request', sent)
      page.off('requestfinished', finished)
      page.off('requestfailed', failed)
    })
}
export async function downloadedDigest(download: Download, file: string) {
  // saveAs works for local and remote browsers; Download.path() only for local ones.
  await download.saveAs(file)
  return sha256(fs.readFileSync(file))
}
