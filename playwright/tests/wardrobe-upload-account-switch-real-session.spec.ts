// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (round 5): a photo picked under one account belongs to that
// account. When another account signs in on the same browser, the open tab learns of it through
// Supabase's auth state change, drops the picked photo with its preview and confirmation, and
// sends nothing under the new account. The switch needs real Supabase sessions (the local E2E
// token is never verified, so it cannot change accounts), so this runs in the owned real-session
// lane: real GoTrue, real email codes, member B signing in from a second tab of the same browser.
//
// AS-0: the precondition of every case below: a member signed in with a real session opens the
//       wardrobe hub, and again after a reload, with the account loaded.
// AS-1: the garment modal with a picked photo waiting on Use This Image.
// AS-2: My Form with a preview whose upload failed, waiting on Retry.
// AS-3: My Form showing A's ready photo.
// AS-4: an answer to A's My Form poll that arrives after the switch.
// AS-5: an answer to A's manual "Reload the latest version" that arrives after the switch.
// AS-6: a tab still holding A's bearer reloads after the browser's stored session became B's
//       without this tab hearing of it; the reload must drop A's bearer and load B.
//
// Final review F-1: an absence check alone also passes on a load-error screen, so every case
// that keeps the Silhouette screen open asserts B's profile through a marker seeded for B
// (height 73, build 27) before it asserts that nothing of A shows.
//
// Story CC-7.11 D5, D6: Silhouette left the Closet as a modal and is the `/wardrobe/silhouette`
// route, opened from the Closet top bar More menu. On a switch the route stays open and its
// panel follows the new account, where the modal used to close and be reopened.
import path from 'node:path'
import type {
  APIResponse,
  BrowserContext,
  Locator,
  Page,
  Request,
} from '@playwright/test'
import { createNetworkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import { expect, RITUAL_RESPONSE_URL, test } from '../support/fixtures/merged-fixtures'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import {
  createRealCommunityAuthAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
  signupRealCommunityAppUser,
  verifyRealCommunityOtp,
  type RealCommunityAccount,
} from '../support/helpers/community-real-session'
import {
  classifyGuardedErrors,
  guardExpectedError,
} from '../support/helpers/expected-error-guard'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

const WEB = 'http://127.0.0.1:3077'
const API = 'http://127.0.0.1:4077'
const SILHOUETTE_PATH = '/api/v1/wardrobe/silhouette'
const SILHOUETTE_URL = /\/api\/v1\/wardrobe\/silhouette(\?|$)/
/** Member B's seeded sliders: the marker that B's profile, and no error screen, is showing. */
const B_SLIDERS = { heightSlider: 73, buildSlider: 27 }
/** Member A's sliders written behind A's open panel, so A's reload answer carries them. */
const A_SLIDERS = { heightSlider: 11, buildSlider: 12 }
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)
const myFormFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-ready.png'
)

async function member(
  apiRequest: Parameters<typeof signupRealCommunityAppUser>[0],
  label: string
): Promise<RealCommunityAccount> {
  const email = realCommunityEmail()
  const appUserId = await signupRealCommunityAppUser(apiRequest, email)
  return createRealCommunityAuthAccount({ email, appUserId, mapping: 'email', label })
}

/** The product email-code sign-in, ending on the member landing. */
async function signInWithCode(page: Page, account: RealCommunityAccount) {
  await page.goto('/signin')
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('button[type="submit"]').click()
  await page.locator('input[name="code"]').waitFor({ state: 'visible' })
  await page.locator('input[name="code"]').fill(readGeneratedCommunityCode(account))
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(`${WEB}/`)
}

type UploadRequest = { page: 'first' | 'second'; method: string; url: string }

/**
 * Every allocation, commit and byte PUT the browser sends from now on, from any tab. An upload
 * request from the first tab after the switch would be member A's photo going out under B.
 */
function watchUploadRequests(context: BrowserContext, first: Page): UploadRequest[] {
  const seen: UploadRequest[] = []
  context.on('request', (request) => {
    const { pathname } = new URL(request.url())
    const isUpload =
      request.method() === 'PUT' ||
      (request.method() === 'POST' &&
        (/\/upload-url$/.test(pathname) ||
          /\/my-form\/commit$/.test(pathname) ||
          pathname === '/api/v1/wardrobe/garments'))
    if (!isUpload) return
    seen.push({
      page: request.frame().page() === first ? 'first' : 'second',
      method: request.method(),
      url: request.url(),
    })
  })
  return seen
}

/** Member B signs in from a second tab of the same browser; the first tab hears of it. */
async function switchToMemberB(context: BrowserContext, b: RealCommunityAccount) {
  const second = await context.newPage()
  await signInWithCode(second, b)
  return second
}

/**
 * Story CC-7.11 D5, D6: opens the Silhouette route from the Closet More menu, waits for its
 * loaded panel and confirms the basewear guidance. Returns the route's main column.
 */
async function openSilhouette(page: Page) {
  await page.getByTestId('app-header').getByTestId('closet-more-menu').click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Silhouette' }).click()
  await expect(page).toHaveURL('/wardrobe/silhouette')
  const screen = page.locator('main#main-content')
  await expect(screen.getByTestId('silhouette-settings-panel')).toBeVisible()
  return screen
}

/** Opens the Silhouette screen from the Closet and confirms the basewear guidance. */
async function openMyForm(page: Page) {
  await page.goto('/wardrobe')
  await waitForAccessibilityReady(page)
  await expectHubSignedIn(page)
  const screen = await openSilhouette(page)
  await screen.getByLabel(/I'm wearing plain white or black clothing/).check()
  return screen
}

/**
 * The hub has the signed-in account: the user id resolved, the closet and the setup progress
 * loaded, and no signed-out or account error shows.
 */
async function expectHubSignedIn(page: Page) {
  // Story CC-7.11 D4, D6: the Silhouette button that proved the user id resolved left the
  // Closet. The Closet gate opens only once that read answered (CC-7.7 D3), and with a member
  // Add is the capture button, not the visitor's sign-in link.
  await expect(
    page.locator('[data-testid="screen-gate"][data-ready="true"]')
  ).toBeVisible()
  await expect(
    page.getByTestId('app-header').getByTestId('garment-capture-open')
  ).toHaveJSProperty('tagName', 'BUTTON')
  await expect(
    page.getByText('Unable to load your account', { exact: false })
  ).toHaveCount(0)
  await expect(page.getByText('Your session expired', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Unable to check your closet setup progress.')).toHaveCount(
    0
  )
}

type SilhouetteBody = {
  data: { heightSlider: number | null; buildSlider: number | null; revision: number }
}

/**
 * Saves `sliders` as the account's silhouette through the product API, with a bearer from a
 * real email-code sign-in outside the browser.
 */
async function saveSliders(
  apiRequest: Parameters<typeof signupRealCommunityAppUser>[0],
  account: RealCommunityAccount,
  sliders: { heightSlider: number; buildSlider: number }
) {
  if (!account.appUserId) throw new Error('The member has no app account.')
  const headers = { Authorization: `Bearer ${await verifyRealCommunityOtp(account)}` }
  const current = await apiRequest({
    method: 'GET',
    baseUrl: API,
    path: SILHOUETTE_PATH,
    headers,
  })
  expect(current.status, 'silhouette read before the seed').toBe(200)
  const saved = await apiRequest({
    method: 'PUT',
    baseUrl: API,
    path: SILHOUETTE_PATH,
    headers: {
      ...headers,
      'If-Match': `"silhouette:${account.appUserId}:${(current.body as SilhouetteBody).data.revision}"`,
    },
    body: sliders,
  })
  expect(saved.status, 'silhouette seed').toBe(200)
  expect((saved.body as SilhouetteBody).data).toMatchObject(sliders)
}

/** The screen shows member B's seeded profile: B's sliders, in place of a load error. */
async function expectMemberBProfile(screen: Locator) {
  await expect(screen.getByTestId('silhouette-height-slider')).toHaveValue(
    String(B_SLIDERS.heightSlider)
  )
  await expect(screen.getByTestId('silhouette-build-slider')).toHaveValue(
    String(B_SLIDERS.buildSlider)
  )
}

/**
 * Story CC-7.11 D6: after the switch the Silhouette route stays open and its panel now belongs
 * to B. This replaces "the modal closed, the hub reloaded for B and the reopened modal showed
 * B": the route, no account error, and B's seeded profile in the panel.
 */
async function expectSilhouetteFollowsMemberB(page: Page, screen: Locator) {
  await expect(page).toHaveURL('/wardrobe/silhouette')
  await expect(
    page.getByText('Unable to load your account', { exact: false })
  ).toHaveCount(0)
  await expect(page.getByText('Your session expired', { exact: false })).toHaveCount(0)
  await expectMemberBProfile(screen)
}

/** How the browser ended a held read: its answer read in full, or cancelled by the app. */
type HeldEnding = 'delivered' | 'cancelled'

/** A read the route handler holds: the answer it fetched and how the browser ends it. */
type HeldRead = {
  response: APIResponse
  /** How the browser ended the request; any failure but the app's cancellation rejects. */
  ending: Promise<HeldEnding>
  /** Settles once the held answer was handed to the browser; rejects if that threw. */
  delivery: Promise<void>
}

/**
 * Watches how the browser ends `request`. Playwright reports a request's end once, so this is
 * armed in the route handler as soon as the request arrives, before anything can end it. The
 * app's own cancellation (net::ERR_ABORTED) is an expected ending; any other failure rejects.
 */
function watchEnding(page: Page, request: Request): Promise<HeldEnding> {
  return new Promise<HeldEnding>((resolve, reject) => {
    const stop = () => {
      page.off('requestfinished', finished)
      page.off('requestfailed', failed)
    }
    const finished = (seen: Request) => {
      if (seen !== request) return
      stop()
      resolve('delivered')
    }
    const failed = (seen: Request) => {
      if (seen !== request) return
      stop()
      const reason = seen.failure()?.errorText ?? 'no reason'
      if (reason === 'net::ERR_ABORTED') resolve('cancelled')
      else reject(new Error(`The held read failed: ${reason}`))
    }
    page.on('requestfinished', finished)
    page.on('requestfailed', failed)
  })
}

/**
 * Releases a held read and waits until the browser has ended it and the page has painted twice
 * since, so whatever the app did with the answer is on screen before an absence check runs.
 * Records which ending the run observed.
 */
async function releaseHeldRead(
  page: Page,
  held: HeldRead,
  release: () => void
): Promise<HeldEnding> {
  release()
  await held.delivery
  const ending = await held.ending
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  test.info().annotations.push({ type: 'held read ending', description: ending })
  return ending
}

/**
 * For AS-5, whose slider save answers 412 SILHOUETTE_REVISION_MISMATCH by design. The
 * network-error monitor takes URL patterns only, so it stands aside for the silhouette URL alone;
 * a companion guard covers that URL for the whole test on every page and method and requires
 * exactly one PUT 412 SILHOUETTE_REVISION_MISMATCH there and no other error.
 */
const conflictTest = test
  .extend(
    createNetworkErrorMonitorFixture({
      excludePatterns: [SILHOUETTE_URL, RITUAL_RESPONSE_URL],
    })
  )
  .extend<{ silhouetteConflictGuard: void }>({
    silhouetteConflictGuard: [
      async ({ context }, use, testInfo) => {
        const guard = guardExpectedError(context, SILHOUETTE_URL)
        await use()
        if (testInfo.status === 'skipped') return
        expect(
          classifyGuardedErrors(await guard.settle(), {
            method: 'PUT',
            status: 412,
            code: 'SILHOUETTE_REVISION_MISMATCH',
          }),
          'errors on the silhouette URL'
        ).toEqual({ allowedCount: 1, unexpected: [] })
      },
      { auto: true },
    ],
  })

/** The local Auth session key the web client stores (web-session.ts `authStorageKey`). */
const AUTH_SESSION_KEY = 'couturecast.auth-session'

/** The Auth user id (`sub`) of a bearer header, or null when there is none. */
function bearerSubject(authorization: string | undefined): string | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  const payload = token?.split('.')[1]
  if (!payload) return null
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: string
  }
  return claims.sub ?? null
}

/** The Auth user id of every API request this page sends from now on, in order. */
function watchApiBearers(page: Page): (string | null)[] {
  const subjects: (string | null)[] = []
  page.on('request', (request) => {
    // The web calls the API through its own origin in this lane, so match on the path.
    if (!new URL(request.url()).pathname.startsWith('/api/v1/')) return
    subjects.push(bearerSubject(request.headers()['authorization']))
  })
  return subjects
}

/** True when a silhouette profile answer carries a ready My Form photo. */
function isReadyMyForm(body: unknown): boolean {
  const myForm = (body as { data?: { myForm?: { status?: string } | null } } | null)?.data
    ?.myForm
  return myForm?.status === 'ready'
}

test.describe('Upload state follows the signed-in account', () => {
  test('AS-0: a member signed in with a real session opens the wardrobe hub with the account loaded, before and after a reload', async ({
    apiRequest,
    interceptNetworkCall,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-hub-a')
    await signInWithCode(page, a)

    for (const open of [() => page.goto('/wardrobe'), () => page.reload()]) {
      // The hub's own reads must go out with the member's bearer and succeed.
      const closet = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/wardrobe/garments**',
      })
      const progress = interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/wardrobe/onboarding',
      })
      await open()
      await waitForAccessibilityReady(page)
      expect((await closet).status, 'closet read').toBe(200)
      expect((await progress).status, 'setup progress read').toBe(200)
      await expectHubSignedIn(page)
    }
  })

  test('AS-1: a garment photo picked by member A is dropped when member B signs in, and nothing uploads', async ({
    apiRequest,
    context,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-switch-a')
    const b = await member(apiRequest, 'upload-switch-b')
    await signInWithCode(page, a)

    await page.goto('/wardrobe')
    await waitForAccessibilityReady(page)
    await page.getByRole('button', { name: '+ Add Garment' }).click()
    await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
    const dialog = page.getByRole('dialog')
    const useThisImage = dialog.getByRole('button', { name: 'Use This Image' })
    await expect(useThisImage).toBeVisible()
    await expect(dialog.getByRole('img').first()).toBeVisible()

    const uploads = watchUploadRequests(context, page)
    await switchToMemberB(context, b)

    // The picked photo, its preview and the choice to use it are gone from A's tab.
    await expect(useThisImage).toHaveCount(0)
    await expect(dialog.getByRole('img')).toHaveCount(0)
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: '+ Add Garment' }).click()
    // The new owner gets a fresh capture with a choice of sources.
    await expect(dialog.getByRole('button', { name: 'Take Photo' })).toBeVisible()
    expect(uploads, 'upload requests after the switch').toEqual([])
  })

  test('AS-2: a My Form preview waiting on Retry is dropped when member B signs in, and nothing uploads', async ({
    apiRequest,
    context,
    interceptNetworkCall,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-switch-a')
    const b = await member(apiRequest, 'upload-switch-b')
    await saveSliders(apiRequest, b, B_SLIDERS)
    await signInWithCode(page, a)

    // Fail A's byte upload, so the preview waits on Retry with its attempt open.
    void interceptNetworkCall({
      method: 'PUT',
      url: '**/storage/v1/object/upload/sign/**',
      handler: (route) => route.abort('failed'),
    })

    const screen = await openMyForm(page)
    const basewear = screen.getByLabel(/I'm wearing plain white or black clothing/)
    await screen
      .getByRole('button', { name: 'Upload a full-body photo', exact: true })
      .click()
    await screen.getByLabel('My Form photo file').setInputFiles(myFormFixturePath)
    const retry = screen.getByRole('button', { name: 'Retry upload' })
    await expect(retry).toBeVisible({ timeout: 20_000 })

    const uploads = watchUploadRequests(context, page)
    await switchToMemberB(context, b)

    await expectSilhouetteFollowsMemberB(page, screen)
    await expect(retry).toHaveCount(0)
    await expect(screen.getByAltText('My Form')).toHaveCount(0)
    await expect(basewear).not.toBeChecked()
    expect(uploads, 'upload requests after the switch').toEqual([])
  })
  test('AS-3: member A ready My Form photo is cleared when member B signs in', async ({
    apiRequest,
    context,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-switch-a')
    const b = await member(apiRequest, 'upload-switch-b')
    await saveSliders(apiRequest, b, B_SLIDERS)
    await signInWithCode(page, a)

    const screen = await openMyForm(page)
    await screen
      .getByRole('button', { name: 'Upload a full-body photo', exact: true })
      .click()
    await screen.getByLabel('My Form photo file').setInputFiles(myFormFixturePath)
    await expect(screen.getByText('My Form photo ready')).toBeVisible({ timeout: 20_000 })
    await expect(screen.getByAltText('My Form')).toBeVisible()

    const uploads = watchUploadRequests(context, page)
    await switchToMemberB(context, b)

    await expectSilhouetteFollowsMemberB(page, screen)
    await expect(screen.getByAltText('My Form')).toHaveCount(0)
    await expect(screen.getByText('My Form photo ready')).toHaveCount(0)
    expect(uploads, 'upload requests after the switch').toEqual([])
  })

  test('AS-4: an answer to member A My Form poll that lands after the switch shows nothing of A', async ({
    apiRequest,
    context,
    interceptNetworkCall,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-switch-a')
    const b = await member(apiRequest, 'upload-switch-b')
    await saveSliders(apiRequest, b, B_SLIDERS)
    await signInWithCode(page, a)

    // Hold back the first poll answer that carries A's ready photo until B has signed in.
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let holding = true
    let heldReady = false
    let markHeld: (read: HeldRead) => void = () => undefined
    const held = new Promise<HeldRead>((resolve) => {
      markHeld = resolve
    })
    void interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/silhouette',
      handler: async (route) => {
        if (!holding) return route.fallback()
        const ending = watchEnding(page, route.request())
        // Only the held read's ending is awaited; the others pass through.
        void ending.catch(() => undefined)
        const response = await route.fetch()
        const body: unknown = await response.json().catch(() => null)
        if (heldReady || !isReadyMyForm(body)) return route.fulfill({ response })
        heldReady = true
        const delivery = released.then(() => route.fulfill({ response }))
        markHeld({ response, ending, delivery })
        await delivery.catch(() => undefined)
      },
    })
    // The worker can finish before the commit answers (run 45734058635: ready 4 ms before the
    // commit returned), and a commit that already says ready starts no poll, so there would be
    // no poll answer to hold. That commit answer is delivered as the processing state the
    // worker reports on every slower run, so the ready photo always arrives through a poll.
    void interceptNetworkCall({
      method: 'POST',
      url: '**/api/v1/wardrobe/silhouette/my-form/commit',
      handler: async (route) => {
        const response = await route.fetch()
        const body = (await response.json().catch(() => null)) as {
          data?: { myForm?: { status?: string; committedAt?: string } | null }
        } | null
        const myForm = body?.data?.myForm
        if (!body?.data || !myForm || !isReadyMyForm(body))
          return route.fulfill({ response })
        return route.fulfill({
          response,
          json: {
            ...body,
            data: {
              ...body.data,
              myForm: {
                status: 'processing',
                failureReason: null,
                committedAt: myForm.committedAt,
                imageAccess: null,
              },
            },
          },
        })
      },
    })

    const screen = await openMyForm(page)
    await screen
      .getByRole('button', { name: 'Upload a full-body photo', exact: true })
      .click()
    await screen.getByLabel('My Form photo file').setInputFiles(myFormFixturePath)
    await expect.poll(() => heldReady, { timeout: 20_000 }).toBe(true)
    await expect(screen.getByAltText('My Form')).toHaveCount(0)

    await switchToMemberB(context, b)
    holding = false
    await expectSilhouetteFollowsMemberB(page, screen)
    // The app either reads A's ready answer after the switch or cancelled the read on it; either
    // way B's profile stays and nothing of A shows.
    await releaseHeldRead(page, await held, release)

    await expectMemberBProfile(screen)
    await expect(screen.getByAltText('My Form')).toHaveCount(0)
    await expect(screen.getByText('My Form photo ready')).toHaveCount(0)
  })

  conflictTest(
    'AS-5: an answer to member A manual Reload after a revision conflict that lands after the switch shows nothing of A',
    async ({ apiRequest, context, interceptNetworkCall, page }) => {
      const a = await member(apiRequest, 'upload-switch-a')
      const b = await member(apiRequest, 'upload-switch-b')
      // Two saves put B at revision 2, so a revision A's late answer leaves behind (A ends at 1)
      // makes B's next save fail its precondition.
      await saveSliders(apiRequest, b, { heightSlider: 50, buildSlider: 50 })
      await saveSliders(apiRequest, b, B_SLIDERS)
      await signInWithCode(page, a)

      const screen = await openMyForm(page)
      const height = screen.getByTestId('silhouette-height-slider')
      await expect(height).toBeVisible()
      // Another client saves A's sliders behind the open panel, so A's next save is stale.
      await saveSliders(apiRequest, a, A_SLIDERS)
      await height.fill('40')
      const reloadLatest = screen.getByRole('button', {
        name: 'Reload the latest version',
      })
      await expect(reloadLatest).toBeVisible()

      // Hold the answer to A's Reload (it carries A's sliders 11/12) until B has signed in.
      let release: () => void = () => undefined
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let armed = true
      let markHeld: (read: HeldRead) => void = () => undefined
      const held = new Promise<HeldRead>((resolve) => {
        markHeld = resolve
      })
      void interceptNetworkCall({
        method: 'GET',
        url: '**/api/v1/wardrobe/silhouette',
        handler: async (route) => {
          if (!armed) return route.fallback()
          armed = false
          const ending = watchEnding(page, route.request())
          void ending.catch(() => undefined)
          const response = await route.fetch()
          const delivery = released.then(() => route.fulfill({ response }))
          markHeld({ response, ending, delivery })
          await delivery.catch(() => undefined)
        },
      })
      await reloadLatest.click()
      const read = await held
      // The held answer is A's: the sliders the other client saved, at A's revision 1.
      expect(read.response.status(), 'held reload answer').toBe(200)
      expect(await read.response.json()).toMatchObject({
        data: { ...A_SLIDERS, revision: 1 },
      })
      await expect(height).toHaveValue('40')

      await switchToMemberB(context, b)
      await expectSilhouetteFollowsMemberB(page, screen)
      // The app either reads A's answer after the switch or cancelled the read on it; either way
      // B's sliders stay and A's conflict is gone.
      await releaseHeldRead(page, read, release)

      await expectMemberBProfile(screen)
      await expect(reloadLatest).toHaveCount(0)
      await expect(
        screen.getByLabel(/I'm wearing plain white or black clothing/)
      ).not.toBeChecked()

      // B's next save carries B's own revision: a revision left by A's answer would fail it.
      const save = interceptNetworkCall({
        method: 'PUT',
        url: '**/api/v1/wardrobe/silhouette',
      })
      await height.fill('74')
      const saved = await save
      expect(saved.status, 'member B save after the switch').toBe(200)
      // The exact strong tag for B at revision 2: a wildcard would skip the revision check.
      expect(saved.request?.headers()['if-match']).toBe(`"silhouette:${b.appUserId}:2"`)
      expect(saved.responseJson).toMatchObject({
        data: { heightSlider: 74, buildSlider: B_SLIDERS.buildSlider, revision: 3 },
      })
    }
  )

  test('AS-6: a tab holding member A bearer that reloads after the stored session became member B loads B, never A', async ({
    apiRequest,
    browser,
    interceptNetworkCall,
    page,
  }) => {
    const a = await member(apiRequest, 'upload-switch-a')
    const b = await member(apiRequest, 'upload-switch-b')
    await saveSliders(apiRequest, b, B_SLIDERS)
    await signInWithCode(page, a)
    await page.goto('/wardrobe')
    await waitForAccessibilityReady(page)
    await expectHubSignedIn(page)

    // B signs in in another browser profile, so this tab never hears of it; B's stored session
    // is then written into this tab's storage the way another tab's sign-in would leave it. A
    // write from the page itself raises no storage event here, so the tab still holds A's
    // bearer and A as its verified account when it reloads.
    const elsewhere = await browser.newContext({ baseURL: WEB })
    try {
      const other = await elsewhere.newPage()
      await signInWithCode(other, b)
      const bSession = await other.evaluate(
        (key) => window.localStorage.getItem(key),
        AUTH_SESSION_KEY
      )
      expect(bSession, 'member B stored session').not.toBeNull()
      await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
        AUTH_SESSION_KEY,
        bSession!,
      ] as const)
    } finally {
      await elsewhere.close()
    }

    const bearers = watchApiBearers(page)
    const closet = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/garments**',
    })
    await page.reload()
    await waitForAccessibilityReady(page)
    expect((await closet).status, 'closet read').toBe(200)
    await expectHubSignedIn(page)
    // Story CC-7.11 D5, D6: Silhouette opens from the Closet More menu as its own route.
    await expectMemberBProfile(await openSilhouette(page))

    // Every signed API request after the reload carried B's bearer; none went out with A's.
    expect(bearers, 'signed API requests after the reload').toContain(b.authUserId)
    expect(
      bearers.filter((subject) => subject !== null && subject !== b.authUserId)
    ).toEqual([])
  })
})
