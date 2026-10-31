import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'
import {
  withBrowserWatermarkLock,
  afterInitialCommunityVerification,
  browserWatermarkChecks,
  assertBrowserWatermarkEvidence,
  closedBrowserWatermarkFailure,
} from '../../scripts/lib/story68-browser-watermark.mjs'
import { COMMUNITY_AUTHORIZATION_BUDGET_MS } from '../../apps/api/src/modules/community/community-authorization-budget'
import { createClient, type Session } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import type {
  APIResponse,
  BrowserContext,
  Download,
  Page,
  Locator,
  Request,
  Response,
  Route,
  TestInfo,
} from '@playwright/test'
import {
  interceptNetworkCall as interceptPageNetworkCall,
  type InterceptNetworkCallFn,
} from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  supportedLocales,
  prepareShareCardInputSchema,
  communitySponsoredFeedResponseSchema,
  resolveCommunityTargetsInputSchema,
  resolveCommunityTargetsResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import { decodeShareCardBase64, validateShareCardPng } from '@couture/api-client'
import { test, expect } from '../support/fixtures/share-card-fixtures'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const read = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
const env = read('owned-env.json') as {
  DATABASE_URL: string
  API_BASE_URL: string
}
if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(env.DATABASE_URL).pathname))
  throw new Error('owned_uuid_required')
const fixture = read('fixtures.json') as {
  postId: string
  identities: { email: string; appUserId: string; authUserId: string; label: string }[]
}
const build = read('public-build-env.json') as {
  EXPO_PUBLIC_SUPABASE_ANON_KEY: string
  EXPO_PUBLIC_API_BASE_URL: string
}
const proxy = read('auth-harness.json') as { proxyUrl: string; otpDir: string }
async function session(account: number): Promise<Session> {
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
async function identify(context: BrowserContext, account = 0) {
  const member = await session(account)
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem('cc68-session-initialized')) {
      localStorage.setItem('couturecast.auth-session', JSON.stringify(value))
      sessionStorage.setItem('cc68-session-initialized', 'true')
    }
  }, member)
  return member
}
const modal = (page: Page) => page.locator('[aria-labelledby="share-card-title"]')
const cancellationWitness = (page: Page, request: Request) =>
  page
    .waitForEvent('requestfailed', {
      predicate: (failed) => failed === request,
      timeout: 5000,
    })
    .then(
      () => true,
      () => false
    )
type HandoffProbe = { inflight: Promise<unknown>[]; handoffs: number }
type HandoffProbeWindow = Window &
  typeof globalThis & { __shareCardHandoffProbe?: HandoffProbe }
// Init script. Tracks each asynchronous step a share-card save takes before its
// handoff (preparation fetch, its body read, digest) and counts download clicks.
function handoffProbe() {
  const target = window as HandoffProbeWindow
  if (target.__shareCardHandoffProbe) return
  const probe: HandoffProbe = { inflight: [], handoffs: 0 }
  target.__shareCardHandoffProbe = probe
  const preparation = (url: string) => url.endsWith('/api/v1/share-cards/prepare')
  const track = <T>(pending: Promise<T>) => {
    probe.inflight.push(
      pending.then(
        () => undefined,
        () => undefined
      )
    )
    return pending
  }
  const fetch = target.fetch
  target.fetch = (...args: Parameters<typeof fetch>) => {
    const pending = fetch.apply(target, args)
    const input = args[0]
    const url = typeof input === 'object' && 'url' in input ? input.url : String(input)
    return preparation(url) ? track(pending) : pending
  }
  // The Playwright Response type shadows the DOM one in this file.
  type BodyResponse = InstanceType<typeof target.Response>
  const body = target.Response.prototype as unknown as Record<
    string,
    (this: BodyResponse) => Promise<unknown>
  >
  for (const name of ['json', 'text', 'arrayBuffer', 'blob']) {
    const original = body[name]!
    body[name] = function (this: BodyResponse) {
      const pending = original.call(this)
      return preparation(this.url) ? track(pending) : pending
    }
  }
  const subtle = target.crypto.subtle
  const digest = subtle.digest.bind(subtle)
  subtle.digest = (...args: Parameters<SubtleCrypto['digest']>) => track(digest(...args))
  const anchor = target.HTMLAnchorElement.prototype
  // click is inherited from HTMLElement; read it as a value, then shadow it on anchors.
  const click = Object.getOwnPropertyDescriptor(target.HTMLElement.prototype, 'click')!
    .value as (this: HTMLAnchorElement) => void
  anchor.click = function (this: HTMLAnchorElement) {
    if (this.download) probe.handoffs += 1
    return click.call(this)
  }
}
// Runs in the page. Waits until every tracked step, including steps those steps
// started, has settled and a task boundary has passed, then reports handoffs.
async function settleHandoffProbe() {
  const probe = (window as HandoffProbeWindow).__shareCardHandoffProbe
  if (!probe) throw new Error('share_card_handoff_probe_missing')
  let settled = -1
  while (settled !== probe.inflight.length) {
    settled = probe.inflight.length
    await Promise.all(probe.inflight)
    await new Promise((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve(undefined)
      }
      channel.port2.postMessage(null)
    })
  }
  return probe.handoffs
}
async function expectNoLateDownload(page: Page) {
  // A fulfilled route alone does not mean the browser has run its fetch callbacks.
  // The probe settles only after every continuation of the save path has run.
  expect(await page.evaluate(settleHandoffProbe), 'late download handoffs').toBe(0)
}
// Loads the home feed once the owned post is verified, and returns the API origin.
async function loadOwnFeed(page: Page, interceptNetworkCall: InterceptNetworkCallFn) {
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
async function ownPhoto(
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
async function previewBytes(preview: Locator) {
  const bytes = decodeShareCardBase64((await preview.getAttribute('src'))!.split(',')[1]!)
  validateShareCardPng(bytes)
  return bytes
}
const sha256 = (bytes: Uint8Array | Buffer) =>
  createHash('sha256').update(bytes).digest('hex')
function renderCatalog(locale: string) {
  const catalog = JSON.parse(
    fs.readFileSync(
      path.resolve(`apps/api/src/modules/share-cards/assets/${locale}.json`),
      'utf8'
    )
  ) as {
    community: string
    climateBands: Record<string, string>
    watermarkRole: string
  }
  const body = [
    catalog.community,
    catalog.climateBands.temperate_dry,
    'CoutureCast',
  ].join('. ')
  return { body, watermarked: body + `. ${catalog.watermarkRole}: CoutureCast` }
}
const webCatalog = (locale: string) =>
  JSON.parse(
    fs.readFileSync(path.resolve(`apps/web/src/i18n/locales/${locale}.json`), 'utf8')
  ) as {
    shareCard: { photoPrivacyHelp: string; offline: string; retry: string }
    community: { notifications: { back: string; save: string } }
  }
type ProfileRead = (apiOrigin: string) => Promise<{ status: number; body: unknown }>
function pinnedWatermarkDatabase(apiOrigin: string) {
  const database = new URL(env.DATABASE_URL)
  if (
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    !/^\/tea_community_[a-f0-9]{32}$/.test(database.pathname) ||
    !['http://127.0.0.1:4088', 'http://localhost:4088'].includes(apiOrigin) ||
    new URL(env.API_BASE_URL).origin !== apiOrigin ||
    new URL(build.EXPO_PUBLIC_API_BASE_URL).origin !== apiOrigin
  )
    throw new Error('owned_watermark_database_and_api_required')
  const verified = fs
    .readFileSync(path.join(directory, 'api.log'), 'utf8')
    .split('\n')
    .some((line) => {
      try {
        const entry = JSON.parse(line) as { code?: string; database?: string }
        return (
          entry.code === 'owned_database_verified' &&
          entry.database === database.pathname.slice(1)
        )
      } catch {
        return false
      }
    })
  if (!verified) throw new Error('effective_owned_api_database_proof_required')
  return env.DATABASE_URL
}
async function rapidWatermarkDuringRealPreparation(
  page: Page,
  open: () => Promise<void>,
  apiOrigin: string,
  readProfile: ProfileRead
) {
  const started = performance.now()
  const browser = test.info().project.name
  const record = {
    version: 1,
    browser,
    passed: false,
    code: 'browser_watermark_failed',
    phase: 'profile-before',
    elapsedMs: 0,
    heldMs: 0,
    requests: 0,
    unavailableResponses: 0,
    checks: Object.fromEntries(browserWatermarkChecks.map((check) => [check, false])),
  }
  const phase = (value: string) => {
    record.phase = value
  }
  const check = (name: string, value: boolean) => {
    record.checks[name] = value
    if (!value)
      throw new Error(
        name === 'zero503'
          ? 'browser_watermark_prepare_503'
          : name === 'threeRequests'
            ? 'browser_watermark_three_requests_required'
            : 'browser_watermark_check_failed'
      )
  }
  const requests = new Set<Request>()
  const isPreparation = (request: Request, watermark?: boolean) =>
    request.url() === `${apiOrigin}/api/v1/share-cards/prepare` &&
    (watermark === undefined ||
      prepareShareCardInputSchema.parse(request.postDataJSON()).watermark === watermark)
  const requestObserved = (request: Request) => {
    if (isPreparation(request)) requests.add(request)
  }
  const responseObserved = (response: Response) => {
    if (
      response.url() === `${apiOrigin}/api/v1/share-cards/prepare` &&
      response.status() === 503
    )
      record.unavailableResponses += 1
  }
  // playwright-utils deviation: interceptNetworkCall resolves on one request and
  // matches only URL and method; this proof counts every preparation and every 503.
  page.on('request', requestObserved)
  page.on('response', responseObserved)
  try {
    const connectionString = pinnedWatermarkDatabase(apiOrigin)
    const owner = await readProfile(apiOrigin)
    check(
      'ownerVerified',
      owner.status === 200 &&
        userProfileResponseSchema.parse(owner.body).user.id ===
          fixture.identities[0]!.appUserId
    )
    await withBrowserWatermarkLock({
      connectionString,
      // Every source read the barrier blocks runs under this API budget, and the
      // barrier's own deadline is a share of it.
      authorizationBudgetMs: COMMUNITY_AUTHORIZATION_BUDGET_MS,
      createClient: (options) => new pg.Client(options),
      onPhase: phase,
      onCheck: check,
      onHeld: (ms) => {
        record.heldMs = ms
      },
      whileLocked: async ({ signal, waitForBlocked, checkBlocked }) => {
        const live = () => {
          if (signal.aborted) throw signal.reason
        }
        // playwright-utils deviation: interceptNetworkCall cannot select a request by
        // its body, and each wait here selects the preparation by its watermark value.
        phase('initial')
        const initial = page.waitForRequest((request) => isPreparation(request, true))
        await open()
        await initial
        live()
        check('initialRequest', true)
        phase('blocked')
        await waitForBlocked()
        check('blockedSource', true)
        // Keyboard toggles skip pointer actionability waits, which keeps the held
        // window short on a slow browser.
        const checkbox = modal(page).getByRole('checkbox')
        phase('off')
        const off = page.waitForRequest((request) => isPreparation(request, false))
        await checkbox.press('Space')
        await off
        live()
        check('watermarkOff', true)
        phase('on')
        const on = page.waitForRequest((request) => isPreparation(request, true))
        await checkbox.press('Space')
        await on
        live()
        check('watermarkOn', true)
        phase('profile-after')
        check('authenticatedProfile', (await readProfile(apiOrigin)).status === 200)
        phase('blocked-after')
        check('blockedAtRelease', await checkBlocked())
      },
    })
    phase('preview')
    await expect(modal(page).getByTestId('share-card-preview')).toHaveAttribute(
      'data-loaded',
      'true'
    )
    check('previewLoaded', true)
    phase('requests')
    record.requests = requests.size
    check('threeRequests', record.requests >= 3)
    check('zero503', record.unavailableResponses === 0)
    record.passed = true
    record.code = 'ok'
    phase('complete')
  } catch (error) {
    record.code = closedBrowserWatermarkFailure(error)
    throw new Error(
      `P-WATERMARK ${record.code}; phase=${record.phase}; heldMs=${Math.round(record.heldMs)}; checks=${JSON.stringify(record.checks)}`
    )
  } finally {
    page.off('request', requestObserved)
    page.off('response', responseObserved)
    record.requests = requests.size
    record.elapsedMs = Math.max(0, performance.now() - started)
    assertBrowserWatermarkEvidence(record)
    fs.writeFileSync(
      path.join(directory, `browser-watermark-${browser}.json`),
      JSON.stringify(record, null, 2) + '\n',
      { mode: 0o600 }
    )
    const failureFile = path.join(directory, `browser-watermark-failure-${browser}.json`)
    if (!record.passed && !fs.existsSync(failureFile))
      fs.writeFileSync(failureFile, JSON.stringify(record, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      })
    await test.info().attach('browser-watermark-proof', {
      body: Buffer.from(JSON.stringify(record)),
      contentType: 'application/json',
    })
  }
}

async function markDocument(page: Page) {
  const token = await page.evaluate(() => {
    const token = crypto.randomUUID()
    document.documentElement.dataset.shareCardDocument = token
    return token
  })
  return () =>
    expect(page.locator('html')).toHaveAttribute('data-share-card-document', token)
}
async function activateFocused(control: Locator) {
  await control.focus()
  await expect(control).toBeFocused()
  await control.press('Enter')
}
// One held route step: the handler records the request, signals entry and waits for
// the test to release it.
function routeGate() {
  let release!: () => void
  let enter!: () => void
  let settle!: () => void
  const gate = {
    request: undefined as Request | undefined,
    released: new Promise<void>((resolve) => {
      release = resolve
    }),
    started: new Promise<void>((resolve) => {
      enter = resolve
    }),
    finished: new Promise<void>((resolve) => {
      settle = resolve
    }),
    release: () => release(),
    enter: () => enter(),
    settle: () => settle(),
  }
  return gate
}
const detailModal = (page: Page) =>
  page.locator('[aria-labelledby="community-detail-title"]')
// The page state every open dialog shares: which dialogs are reachable, whether anything
// behind them is still inert or hidden from assistive technology, and the scroll lock.
function modalPageState(page: Page) {
  return page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).map(
      (dialog) => ({
        labelledBy: dialog.getAttribute('aria-labelledby'),
        inert: dialog.inert,
        hidden: dialog.getAttribute('aria-hidden'),
        display: getComputedStyle(dialog).display,
      })
    ),
    background: Array.from(document.body.children)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.matches('script,style,link,[role="dialog"]') &&
          (element.inert || element.getAttribute('aria-hidden') === 'true')
      )
      .map((element) => element.tagName.toLowerCase()),
    overflow: document.body.style.overflow,
  }))
}
// Opens the own post's detail, then its share dialog from inside the detail.
async function openDetailThenShare(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
) {
  await loadOwnFeed(page, interceptNetworkCall)
  const card = page.locator(`[data-testid$="lookbook-card-${fixture.postId}"]`).first()
  await card.getByTestId(`lookbook-open-${fixture.postId}`).click()
  const detail = detailModal(page)
  await expect(detail).toBeVisible()
  await detail.getByTestId('share-card-open').click()
  const share = modal(page)
  await expect(share.getByTestId('share-card-preview')).toHaveAttribute(
    'data-loaded',
    'true'
  )
  return { card, detail, share }
}
// Holds the next catch-up request, then simulates the tab returning to the foreground,
// which hides community content until that request verifies access again.
async function holdForegroundRevalidation(
  page: Page,
  answer: (route: Route) => Promise<void>
) {
  const gate = routeGate()
  await page.route('**/api/v1/community/events**', async (route) => {
    if (gate.request) return route.continue()
    gate.request = route.request()
    gate.enter()
    await gate.released
    try {
      await answer(route)
    } finally {
      gate.settle()
    }
  })
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await gate.started
  return gate
}
async function fulfillUnlessCancelled(route: Route, response: APIResponse) {
  try {
    await route.fulfill({ response })
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/Target closed|Request canceled|Request was aborted|already handled|Invalid InterceptionId/i.test(
        error.message
      )
    )
      throw error
  }
}
async function holdThenFulfill(
  route: Route,
  request: Request,
  gate: ReturnType<typeof routeGate>
) {
  gate.request = request
  const response = await route.fetch()
  gate.enter()
  await gate.released
  try {
    await fulfillUnlessCancelled(route, response)
  } finally {
    gate.settle()
  }
}
// playwright-utils deviation: handleDownload saves the file but does not expose
// Download.suggestedFilename, which these cases assert.
const nextDownload = (page: Page) => page.waitForEvent('download')
async function downloadedDigest(download: Download, file: string) {
  // saveAs works for local and remote browsers; Download.path() only for local ones.
  await download.saveAs(file)
  return sha256(fs.readFileSync(file))
}
// The settings form loads above the page's links; click them only once it is in place.
const settingsLoaded = (page: Page) =>
  expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible()
// Holds identity verification, then the preferences read, and checks that the Back link
// keeps one box and the settings region reports busy until the settings render.
async function expectStableSettingsLayout(
  page: Page,
  locale: string,
  intercept: InterceptNetworkCallFn
) {
  const copy = webCatalog(locale).community.notifications
  const verification = routeGate()
  const preferences = routeGate()
  const hold =
    (gate: ReturnType<typeof routeGate>) => async (route: Route, request: Request) => {
      if (!gate.request) {
        gate.request = request
        gate.enter()
        await gate.released
      }
      await route.continue()
    }
  const heldSession = intercept({
    method: 'GET',
    url: '**/api/v1/user/profile',
    handler: hold(verification),
  })
  const heldPreferences = intercept({
    method: 'GET',
    url: '**/api/v1/community/notification-preferences',
    handler: hold(preferences),
  })
  await page.goto('/notification-settings')
  const back = page.getByRole('link', { name: copy.back, exact: true })
  const region = page.getByRole('main')
  const boxes = []
  try {
    await heldSession
    await verification.started
    await expect(back).toBeVisible()
    await expect(region).toHaveAttribute('aria-busy', 'true')
    boxes.push(await back.boundingBox())
    verification.release()
    await heldPreferences
    await preferences.started
    await expect(region).toHaveAttribute('aria-busy', 'true')
    boxes.push(await back.boundingBox())
  } finally {
    verification.release()
    preferences.release()
  }
  await expect(page.getByRole('button', { name: copy.save, exact: true })).toBeVisible()
  await expect(region).not.toHaveAttribute('aria-busy')
  boxes.push(await back.boundingBox())
  // The form's place is held while identity and settings load, so links never move.
  expect(boxes, `${locale} Back link box while verifying, loading and loaded`).toEqual([
    boxes[0],
    boxes[0],
    boxes[0],
  ])
  return back
}
for (const locale of supportedLocales)
  test.describe(locale, () => {
    test.use({ locale })
    test('P-POST P-PHOTO-PREVIEW P-LOCALE: exact localized labels, privacy help and unclipped layout', async ({
      context,
      page,
      interceptNetworkCall,
    }, info) => {
      await identify(context)
      const { preview, dialog } = await ownPhoto(page, interceptNetworkCall)
      await expect(preview).toHaveAttribute('alt', renderCatalog(locale).watermarked)
      await expect(
        dialog.getByText(webCatalog(locale).shareCard.photoPrivacyHelp, { exact: true })
      ).toBeVisible()
      expect(sha256(await previewBytes(preview))).toBe(
        await preview.getAttribute('data-sha256')
      )
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 })
        await expect(dialog.getByTestId('share-card-save')).toBeVisible()
        await expect(dialog).toHaveJSProperty(
          'scrollWidth',
          await dialog.evaluate((el) => el.clientWidth)
        )
        await page.screenshot({
          path: info.outputPath(`${locale}-${width}.png`),
        })
      }
    })
    test('P-WATERMARK: OFF then ON returns the original approved digest', async ({
      context,
      page,
      interceptNetworkCall,
      apiRequest,
    }) => {
      const member = await identify(context)
      const readProfile: ProfileRead = (apiOrigin) =>
        apiRequest({
          method: 'GET',
          baseUrl: apiOrigin,
          path: '/api/v1/user/profile',
          headers: { Authorization: `Bearer ${member.access_token}` },
          retryConfig: { maxRetries: 0 },
        })
      const { preview, dialog } = await ownPhoto(
        page,
        interceptNetworkCall,
        locale === 'en-US'
          ? (open, origin) =>
              rapidWatermarkDuringRealPreparation(page, open, origin, readProfile)
          : undefined
      )
      const labels = renderCatalog(locale)
      await expect(preview).toHaveAttribute('alt', labels.watermarked)
      const digest = await preview.getAttribute('data-sha256')
      await dialog.getByRole('checkbox').uncheck()
      await expect(preview).toHaveAttribute('alt', labels.body)
      await expect(preview).toHaveAttribute('data-loaded', 'true')
      await dialog.getByRole('checkbox').check()
      await expect(preview).toHaveAttribute('data-sha256', digest!)
      await expect(preview).toHaveAttribute('data-loaded', 'true')
      await expect(preview).toHaveAttribute('alt', labels.watermarked)
    })
    test('P-DOWNLOAD-BYTES: the downloaded file is the approved preview PNG', async ({
      context,
      page,
      interceptNetworkCall,
    }, info) => {
      await identify(context)
      const { preview, dialog } = await ownPhoto(page, interceptNetworkCall)
      const bytes = await previewBytes(preview)
      const downloaded = nextDownload(page)
      await dialog.getByTestId('share-card-save').click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe('couturecast-card.png')
      const file = info.outputPath('couturecast-card.png')
      await download.saveAs(file)
      expect(fs.readFileSync(file)).toEqual(Buffer.from(bytes))
      expect(sha256(fs.readFileSync(file))).toBe(
        await preview.getAttribute('data-sha256')
      )
    })
    test('P-A11Y: axe-clean dialog, keyboard Save keeps focus, opener and fallback focus return', async ({
      context,
      page,
      interceptNetworkCall,
    }) => {
      await identify(context)
      const { opener, preview, dialog } = await ownPhoto(page, interceptNetworkCall)
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-labelledby="share-card-title"]')
            .analyze()
        ).violations
      ).toEqual([])
      const downloaded = nextDownload(page)
      await activateFocused(dialog.getByTestId('share-card-save'))
      await downloaded
      await expect(dialog.getByTestId('share-card-save')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(opener).toBeFocused()
      await opener.click()
      await expect(preview).toHaveAttribute('data-loaded', 'true')
      await opener.evaluate((el) => el.remove())
      await page.keyboard.press('Escape')
      await expect(
        page.locator('[data-share-card-focus-fallback="community"]')
      ).toBeFocused()
    })
  })
test('P-BOOTSTRAP: the rebuilt own feed post is verified before the initial feed response arrives', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let feeds = 0
  let ownedResolution: Promise<boolean> | undefined
  const resolved = (response: Response) => {
    if (
      response.status() !== 200 ||
      new URL(response.url()).pathname !== '/api/v1/community/targets/resolve'
    )
      return
    const input = resolveCommunityTargetsInputSchema.safeParse(
      response.request().postDataJSON()
    )
    if (
      !input.success ||
      !input.data.targets.some(
        (target) => target.key === fixture.postId && target.postId === fixture.postId
      )
    )
      return
    ownedResolution = response
      .json()
      .then((body: unknown) => {
        const parsed = resolveCommunityTargetsResponseSchema.safeParse(body)
        return (
          parsed.success &&
          parsed.data.data.targets.some(
            (target) => target.key === fixture.postId && target.status === 'available'
          )
        )
      })
      .catch(() => false)
  }
  let checkFirstReplay!: (verified: boolean) => void
  const firstReplay = new Promise<boolean>((resolve) => {
    checkFirstReplay = resolve
  })
  let replayObserved = false
  const replayStarted = (request: Request) => {
    const url = new URL(request.url())
    if (
      replayObserved ||
      url.pathname !== '/api/v1/community/events' ||
      !url.searchParams.has('cursor')
    )
      return
    replayObserved = true
    // Freeze the resolution already observed at the first cursor request. A later
    // reconnect must prove its own recovery without satisfying this bootstrap check.
    const beforeReplay = ownedResolution ?? Promise.resolve(false)
    void beforeReplay.then((verified) => {
      checkFirstReplay(verified)
      if (verified) release()
    })
  }
  page.on('response', resolved)
  page.on('request', replayStarted)
  // Retain both real API responses. Deliver the bootstrap rebuild first so its
  // target validation cannot borrow the initial feed's committed React state.
  await page.route('**/api/v1/community/feed?*', async (route) => {
    if (++feeds !== 1) return route.continue()
    const response = await route.fetch()
    await released
    await route.fulfill({ response })
  })
  try {
    const opened = ownPhoto(page, interceptNetworkCall)
    void opened.catch(() => undefined)
    await expect(
      firstReplay,
      'owned target resolved before the first cursor request'
    ).resolves.toBe(true)
    const { preview } = await opened
    expect(feeds).toBeGreaterThanOrEqual(2)
    expect(sha256(await previewBytes(preview))).toBe(
      await preview.getAttribute('data-sha256')
    )
  } finally {
    release()
    page.off('response', resolved)
    page.off('request', replayStarted)
    await page.unrouteAll({ behavior: 'wait' })
  }
})
test('P-FOREIGN P-IDENTITY: a second genuine account has no export action or access to former member source', async ({
  context,
  page,
  interceptNetworkCall,
  apiRequest,
}) => {
  const secondary = await identify(context, 1)
  const profile = interceptNetworkCall({ method: 'GET', url: '**/api/v1/user/profile' })
  const feed = interceptNetworkCall({ method: 'GET', url: '**/api/v1/community/feed*' })
  await page.goto('/')
  const verified = await profile
  expect(verified.status).toBe(200)
  expect(userProfileResponseSchema.parse(verified.responseJson).user.id).toBe(
    fixture.identities[1]!.appUserId
  )
  const listed = await feed
  expect(listed.status).toBe(200)
  expect(listed.request?.headers().authorization).toBe(`Bearer ${secondary.access_token}`)
  const item = communitySponsoredFeedResponseSchema
    .parse(listed.responseJson)
    .data.items.find(({ id }) => id === fixture.postId)
  expect(item?.author.isSelf).toBe(false)
  const foreign = page.locator(`[data-testid$="lookbook-card-${fixture.postId}"]`).first()
  // Reactions render only for a signed-in viewer, the same gate as the export action.
  await expect(
    foreign.locator(`[data-testid$="community-reactions-${fixture.postId}"]`)
  ).toBeVisible()
  await expect(foreign.getByTestId('share-card-open')).toHaveCount(0)
  const { status, body } = await apiRequest({
    method: 'POST',
    baseUrl: env.API_BASE_URL,
    path: '/api/v1/share-cards/prepare',
    headers: { Authorization: `Bearer ${secondary.access_token}` },
    body: {
      source: { kind: 'community_post', postId: fixture.postId },
      locale: 'en-US',
      watermark: true,
      purpose: 'preview',
    },
    retryConfig: { maxRetries: 0 },
  })
  expect(status).toBe(404)
  expect(body).not.toHaveProperty('data')
})
test('P-REVALIDATE P-DOWNLOAD-ERROR: final conflict and handoff error retain the approved preview, and Retry downloads it', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  await identify(context)
  let conflict = true
  let refresh: ReturnType<typeof routeGate> | null = null
  let retry: ReturnType<typeof routeGate> | null = null
  const purposes: string[] = []
  // Body-dependent authorization and a deferred handoff need a route handler.
  const prepareRoute = interceptNetworkCall({
    url: '**/api/v1/share-cards/prepare',
    handler: async (route, request) => {
      const input = prepareShareCardInputSchema.parse(request.postDataJSON())
      purposes.push(input.purpose)
      const gate = input.purpose === 'preview' ? refresh : retry
      if (input.purpose === 'save' && conflict)
        await route.fulfill({
          status: 409,
          json: {
            code: 'preview_changed',
            statusCode: 409,
            message: 'preview_changed',
          },
        })
      else if (gate && !gate.request) await holdThenFulfill(route, request, gate)
      else await route.continue()
    },
  })
  const { dialog, preview } = await ownPhoto(page, interceptNetworkCall)
  await prepareRoute
  const digest = await preview.getAttribute('data-sha256')
  await activateFocused(dialog.getByTestId('share-card-save'))
  await expect(dialog.getByRole('alert')).toContainText('changed')
  await expect(dialog.getByTestId('share-card-save')).toBeFocused()
  await expect(dialog.getByTestId('share-card-save')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  conflict = false
  const recovery = dialog.getByTestId('share-card-recovery')
  await expect(recovery).toHaveText('Refresh preview')
  const refreshGate = routeGate()
  refresh = refreshGate
  try {
    await activateFocused(recovery)
    await refreshGate.started
    await expect(recovery).toBeFocused()
  } finally {
    refreshGate.release()
  }
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(recovery).toHaveCount(0)
  await expect(dialog.getByTestId('share-card-save')).toBeFocused()
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = () => {
      URL.createObjectURL = original
      throw new Error('observable_handoff_failure')
    }
  })
  const downloads: string[] = []
  page.on('download', (item) => downloads.push(item.suggestedFilename()))
  await activateFocused(dialog.getByTestId('share-card-save'))
  await expect(dialog.getByRole('alert')).toContainText('Something went wrong')
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  const retryButton = dialog.getByRole('button', { name: 'Try again', exact: true })
  const retried = nextDownload(page)
  const retryGate = routeGate()
  retry = retryGate
  try {
    await activateFocused(retryButton)
    await retryGate.started
    await expect(retryButton).toBeFocused()
  } finally {
    retryGate.release()
  }
  const download = await retried
  expect(download.suggestedFilename()).toBe('couturecast-card.png')
  expect(await downloadedDigest(download, info.outputPath('retried.png'))).toBe(digest)
  expect(purposes).toEqual(['preview', 'save', 'preview', 'save', 'save'])
  await expect(retryButton).toHaveCount(0)
  await expect(dialog.getByTestId('share-card-save')).toBeFocused()
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(downloads).toEqual(['couturecast-card.png'])
})

test('P-MODAL-STACK: detail and share dialogs resume in order after foreground revalidation and release the page when closed', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  const { card, detail, share } = await openDetailThenShare(page, interceptNetworkCall)
  const open = (await modalPageState(page)).dialogs
  expect(open.find((d) => d.labelledBy === 'share-card-title')).toMatchObject({
    inert: false,
    hidden: null,
  })
  expect(open.find((d) => d.labelledBy === 'community-detail-title')).toMatchObject({
    inert: true,
    hidden: 'true',
  })

  const revalidation = await holdForegroundRevalidation(page, (route) => route.continue())
  await expect(share).toHaveCount(0)
  await expect(detail).toBeHidden()
  revalidation.release()
  await revalidation.finished

  // Both come back together; the share dialog is the one that is reachable.
  await expect(share).toBeVisible()
  await expect(detail).toHaveAttribute('aria-hidden', 'true')
  const resumed = await modalPageState(page)
  expect(resumed.dialogs.find((d) => d.labelledBy === 'share-card-title')).toMatchObject({
    inert: false,
    hidden: null,
  })
  expect(
    resumed.dialogs.find((d) => d.labelledBy === 'community-detail-title')
  ).toMatchObject({ inert: true, hidden: 'true' })
  expect(resumed.overflow).toBe('hidden')

  // Escape closes the share dialog first, then the detail.
  await page.keyboard.press('Escape')
  await expect(share).toHaveCount(0)
  await expect(detail).toBeVisible()
  await expect(detail).not.toHaveAttribute('aria-hidden', 'true')
  expect((await modalPageState(page)).overflow).toBe('hidden')
  // Focus returns to the control inside the detail that opened the share dialog.
  await expect(detail.getByTestId('share-card-open')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  // Revalidation remounted the card that opened the detail; focus returns to its
  // replacement on the same surface.
  await expect(card.getByTestId(`lookbook-open-${fixture.postId}`)).toBeFocused()

  // The shell is interactive again and the scroll lock is gone.
  expect(await modalPageState(page)).toEqual({
    dialogs: [],
    background: [],
    overflow: '',
  })
  // Opened and closed again with no revalidation in between, focus returns to the
  // card control that opened the detail.
  const invoker = card.getByTestId(`lookbook-open-${fixture.postId}`)
  await invoker.click()
  await expect(detailModal(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detailModal(page)).toHaveCount(0)
  await expect(invoker).toBeFocused()
})

test('P-MODAL-STACK: access denied during foreground revalidation removes both dialogs and releases the page', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  const { detail, share } = await openDetailThenShare(page, interceptNetworkCall)
  const revalidation = await holdForegroundRevalidation(page, (route) =>
    route.fulfill({
      status: 403,
      json: { code: 'forbidden', statusCode: 403, message: 'forbidden' },
    })
  )
  revalidation.release()
  await revalidation.finished
  await expect(share).toHaveCount(0)
  await expect(detail).toHaveCount(0)
  expect(await modalPageState(page)).toEqual({
    dialogs: [],
    background: [],
    overflow: '',
  })
})

test('P-OUTFIT P-CANCEL: all persisted scenarios render, and reopening retains each composition', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  const member = await identify(context)
  const profileGate = routeGate()
  const heldProfile = interceptNetworkCall({
    url: '**/api/v1/user/profile',
    handler: async (route) => {
      profileGate.enter()
      await profileGate.released
      await route.continue()
    },
  })
  const ritual = interceptNetworkCall({ method: 'GET', url: '**/api/v1/ritual?*' })
  await page.goto('/')
  await heldProfile
  await profileGate.started
  const launcher = page.getByTestId('ritual-share-card-launcher')
  try {
    await launcher.getByRole('button').first().click()
    await expect(launcher.getByRole('button').first()).toBeDisabled()
  } finally {
    profileGate.release()
  }
  const ritualCall = await ritual
  expect(ritualCall.status).toBe(200)
  expect(ritualCall.request?.headers().authorization).toBe(
    `Bearer ${member.access_token}`
  )
  for (const [scenario, label] of [
    ['morning', 'Morning'],
    ['midday', 'Midday'],
    ['evening', 'Evening'],
  ] as const) {
    await launcher.getByRole('combobox').selectOption(scenario)
    const opener = launcher.getByTestId('share-card-open')
    await opener.click()
    const preview = modal(page).getByTestId('share-card-preview')
    await expect(preview).toHaveAttribute('data-loaded', 'true')
    await expect(preview).toHaveAttribute('alt', new RegExp(`^Outfit\\. ${label}\\.`))
    const digest = await preview.getAttribute('data-sha256')
    await page.keyboard.press('Escape')
    await expect(modal(page)).not.toBeVisible()
    await opener.click()
    await expect(preview).toHaveAttribute('data-loaded', 'true')
    await expect(preview).toHaveAttribute('data-sha256', digest!)
    await page.keyboard.press('Escape')
    await expect(modal(page)).not.toBeVisible()
  }
})
test('P-OFFLINE: a community card refuses export offline and keeps its composition through the reconnect resync', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  await identify(context)
  const { preview, dialog } = await ownPhoto(page, interceptNetworkCall)
  // A non-default composition shows that the reconnect keeps the member's choices.
  await dialog.getByRole('checkbox').uncheck()
  await expect(preview).toHaveAttribute('alt', renderCatalog('en-US').body)
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  const digest = await preview.getAttribute('data-sha256')
  const copy = webCatalog('en-US').shareCard
  const saved = interceptNetworkCall({
    method: 'POST',
    url: '**/api/v1/share-cards/prepare',
  })
  // Reconnecting re-verifies community access, which hides the feed and its cards
  // until this catch-up resolves the rendered posts again.
  const caughtUp = interceptNetworkCall({
    method: 'POST',
    url: '**/api/v1/community/targets/resolve',
  })
  await context.setOffline(true)
  try {
    await dialog.getByTestId('share-card-save').click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.offline)
    await expect(preview).toHaveAttribute('data-sha256', digest!)
  } finally {
    await context.setOffline(false)
  }
  expect((await caughtUp).status).toBe(200)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  const downloaded = nextDownload(page)
  await dialog.getByTestId('share-card-save').click()
  const download = await downloaded
  const authorization = await saved
  expect(authorization.status).toBe(200)
  expect(prepareShareCardInputSchema.parse(authorization.requestJson)).toMatchObject({
    purpose: 'save',
    watermark: false,
    expectedSha256: digest,
  })
  expect(await downloadedDigest(download, info.outputPath('community.png'))).toBe(digest)
})
test('P-OFFLINE: an outfit card refuses export offline, keeps its preview, and the same member retry downloads it', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  await identify(context)
  await page.goto('/')
  const launcher = page.getByTestId('ritual-share-card-launcher')
  await launcher.getByRole('button').first().click()
  await launcher.getByTestId('share-card-open').click()
  const dialog = modal(page)
  const preview = dialog.getByTestId('share-card-preview')
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  const digest = await preview.getAttribute('data-sha256')
  const copy = webCatalog('en-US').shareCard
  // Observes the next preparation; an offline Save that reached the network would
  // resolve this with a failed request before the online retry.
  const saved = interceptNetworkCall({
    method: 'POST',
    url: '**/api/v1/share-cards/prepare',
  })
  await context.setOffline(true)
  try {
    await dialog.getByTestId('share-card-save').click()
    await expect(dialog.getByRole('alert')).toHaveText(copy.offline)
    await expect(preview).toHaveAttribute('data-sha256', digest!)
  } finally {
    await context.setOffline(false)
  }
  const downloaded = nextDownload(page)
  await dialog.getByRole('button', { name: copy.retry, exact: true }).click()
  const download = await downloaded
  const authorization = await saved
  expect(authorization.status).toBe(200)
  expect(prepareShareCardInputSchema.parse(authorization.requestJson)).toMatchObject({
    purpose: 'save',
    expectedSha256: digest,
  })
  expect(download.suggestedFilename()).toBe('couturecast-card.png')
  expect(await downloadedDigest(download, info.outputPath('retried.png'))).toBe(digest)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(preview).toHaveAttribute('data-sha256', digest!)
})
test('P-CANCEL P-IDENTITY: an open dialog drops its held preview across same-document cross-tab sign-out and account switch', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  await context.addInitScript(handoffProbe)
  const gate = routeGate()
  const heldPreview = interceptNetworkCall({
    url: '**/api/v1/share-cards/prepare',
    handler: async (route, request) => {
      if (gate.request) await route.continue()
      else await holdThenFulfill(route, request, gate)
    },
  })
  await page.goto('/')
  const sameDocument = await markDocument(page)
  const opener = page
    .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
    .first()
    .getByTestId('share-card-open')
  await expect(opener).toBeVisible()
  const downloads: string[] = []
  page.on('download', (d) => downloads.push(d.suggestedFilename()))
  await opener.click()
  const { request: heldRequest } = await heldPreview
  await gate.started
  await expect(modal(page)).toBeVisible()
  const control = await context.newPage()
  try {
    await control.goto('/notification-settings')
    await settingsLoaded(control)
    // The original document and open dialog receive Supabase's real storage event.
    await expect(modal(page)).toBeVisible()
    const cancelled = cancellationWitness(page, heldRequest!)
    await control.getByRole('button', { name: 'Sign out', exact: true }).click()
    await control.waitForURL('/')
    await expect(
      page
        .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
        .first()
        .getByTestId('share-card-open')
    ).toHaveCount(0)
    await sameDocument()
    gate.release()
    await gate.finished
    expect(await cancelled, 'former member preview request was cancelled').toBe(true)
    await expectNoLateDownload(page)
    await expect(page.getByTestId('share-card-preview')).toHaveCount(0)
    await control.goto('/notification-settings')
    await control.getByRole('link', { name: 'Sign in', exact: true }).click()
    const since = Date.now()
    const account = fixture.identities[1]!
    await control.getByLabel('Email', { exact: true }).fill(account.email)
    await control.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
    await expect(
      control.getByText('Check your email for the sign-in code.', {
        exact: true,
      })
    ).toBeVisible()
    const code = JSON.parse(
      fs.readFileSync(
        path.join(
          proxy.otpDir,
          createHash('sha256').update(account.email).digest('hex') + '.json'
        ),
        'utf8'
      )
    ) as { issuedAt: number; code: string }
    expect(code.issuedAt).toBeGreaterThanOrEqual(since)
    const switched = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/user/profile',
    })
    await control.getByLabel('Email code', { exact: true }).fill(code.code)
    await control.getByRole('button', { name: 'Verify code', exact: true }).click()
    await control.waitForURL('/')
    const switchedProfile = await switched
    const switchedBearer = await control.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('couturecast.auth-session')!) as {
            access_token: string
          }
        ).access_token
    )
    // The profile is private and never stored, so every engine reads it fresh for the
    // new bearer; its JWT subject and the profile both name the second account.
    expect(switchedProfile.request?.headers().authorization).toBe(
      `Bearer ${switchedBearer}`
    )
    expect(
      (
        JSON.parse(
          Buffer.from(switchedBearer.split('.')[1]!, 'base64url').toString('utf8')
        ) as { sub: string }
      ).sub
    ).toBe(account.authUserId)
    expect(switchedProfile.status).toBe(200)
    expect(switchedProfile.response?.headers()['cache-control']).toBe('private, no-store')
    expect(userProfileResponseSchema.parse(switchedProfile.responseJson).user.id).toBe(
      account.appUserId
    )
    await sameDocument()
    await expect(page.getByTestId('share-card-preview')).toHaveCount(0)
    await expect(
      page
        .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
        .first()
        .getByTestId('share-card-open')
    ).toHaveCount(0)
    expect(downloads).toEqual([])
  } finally {
    gate.release()
    await control.close()
  }
})

test('P-CANCEL-SAVE: closing during held save authorization prevents browser handoff and retains composition', async ({
  browser,
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  await context.addInitScript(handoffProbe)
  let hold: ReturnType<typeof routeGate> | null = null
  const prepareRoute = interceptNetworkCall({
    url: '**/api/v1/share-cards/prepare',
    handler: async (route, request) => {
      const gate = hold
      const input = prepareShareCardInputSchema.parse(request.postDataJSON())
      if (input.purpose !== 'save' || !gate || gate.request) await route.continue()
      else await holdThenFulfill(route, request, gate)
    },
  })
  const back = await expectStableSettingsLayout(page, 'en-US', interceptNetworkCall)
  for (const [locale, width] of [
    ['en-US', 375],
    ['de-DE', 1440],
    ['de-DE', 375],
  ] as const) {
    const variant = await browser.newContext({
      locale,
      viewport: { width, height: 1100 },
      baseURL: test.info().project.use.baseURL,
    })
    try {
      await identify(variant)
      const variantPage = await variant.newPage()
      await expectStableSettingsLayout(variantPage, locale, (options) =>
        interceptPageNetworkCall({ ...options, page: variantPage })
      )
    } finally {
      await variant.close()
    }
  }
  const sameDocument = await markDocument(page)
  await back.click()
  await expect(page).toHaveURL('/')
  await sameDocument()
  const { opener, preview, dialog } = await ownPhoto(page, null)
  await prepareRoute
  const digest = await preview.getAttribute('data-sha256')
  const closeGate = routeGate()
  hold = closeGate
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  try {
    await dialog.getByTestId('share-card-save').click()
    await closeGate.started
    const cancelled = cancellationWitness(page, closeGate.request!)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
    closeGate.release()
    await closeGate.finished
    expect(await cancelled, 'closed save authorization request was cancelled').toBe(true)
  } finally {
    closeGate.release()
  }
  await expectNoLateDownload(page)
  await opener.click()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(downloads).toEqual([])
  await page.keyboard.press('Escape')
  hold = null
  await opener.click()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(dialog).not.toContainText('Saving')
  const navigationGate = routeGate()
  hold = navigationGate
  try {
    await dialog.getByTestId('share-card-save').click()
    await navigationGate.started
    const navigationCancelled = cancellationWitness(page, navigationGate.request!)
    await page.goBack()
    await expect(page).toHaveURL('/notification-settings')
    await sameDocument()
    await expect(page.getByTestId('share-card-save')).toHaveCount(0)
    navigationGate.release()
    await navigationGate.finished
    expect(
      await navigationCancelled,
      'unmounted save authorization request was cancelled'
    ).toBe(true)
  } finally {
    navigationGate.release()
  }
  await expectNoLateDownload(page)
  await sameDocument()
  expect(downloads).toEqual([])
})

// Story 6.9 Web Share. Headless engines expose no share sheet, so an init script stubs
// navigator.canShare and navigator.share per engine and records each shared File. The
// stub reads its configuration from localStorage so a later navigation can change it.
type ShareStubConfig = {
  canShare: boolean | 'missing'
  outcomes: ('resolve' | 'AbortError' | 'NotAllowedError')[]
}
type ShareStubWindow = Window &
  typeof globalThis & {
    __shareCardShareFiles?: File[]
    __enableAnalyticsTestHook?: boolean
    __capturedAnalyticsEvents?: { event: string; properties: Record<string, unknown> }[]
  }
const SHARE_STUB_KEY = 'cc69-share-stub'
function shareStub(fallback: ShareStubConfig) {
  const target = window as ShareStubWindow
  target.__enableAnalyticsTestHook = true
  const stored = localStorage.getItem('cc69-share-stub')
  const config = stored ? (JSON.parse(stored) as ShareStubConfig) : fallback
  const files: File[] = []
  target.__shareCardShareFiles = files
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: config.canShare === 'missing' ? undefined : () => config.canShare,
  })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: (data: { files?: File[] }) => {
      files.push(...(data.files ?? []))
      const outcome = config.outcomes.shift() ?? 'resolve'
      return outcome === 'resolve'
        ? Promise.resolve()
        : Promise.reject(new DOMException(outcome, outcome))
    },
  })
}
// Runs in the page: each File the stub received, with its digest.
function sharedFiles() {
  const files = (window as ShareStubWindow).__shareCardShareFiles ?? []
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      sha256: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join(''),
    }))
  )
}
const shareEvents = (page: Page) =>
  page.evaluate(() =>
    ((window as ShareStubWindow).__capturedAnalyticsEvents ?? [])
      .filter(({ event }) => event === 'share_card_shared')
      .map(({ properties }) => properties)
  )
const shareCopy = (locale = 'en-US') =>
  (
    JSON.parse(
      fs.readFileSync(path.resolve(`apps/web/src/i18n/locales/${locale}.json`), 'utf8')
    ) as {
      shareCard: Record<
        | 'shared'
        | 'sentToApp'
        | 'shareClosed'
        | 'shareTapAgain'
        | 'previewChanged'
        | 'refresh',
        string
      >
    }
  ).shareCard
// Opens the own photo's dialog with the share stub installed and records each share
// preparation's purpose.
async function openForShare(
  context: BrowserContext,
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  config: ShareStubConfig,
  answerShare?: (route: Route) => Promise<void>
) {
  await identify(context)
  await context.addInitScript(shareStub, config)
  const purposes: string[] = []
  const prepareRoute = interceptNetworkCall({
    url: '**/api/v1/share-cards/prepare',
    handler: async (route, request) => {
      const input = prepareShareCardInputSchema.parse(request.postDataJSON())
      purposes.push(input.purpose)
      if (input.purpose === 'share' && answerShare) await answerShare(route)
      else await route.continue()
    },
  })
  const opened = await ownPhoto(page, interceptNetworkCall)
  await prepareRoute
  return { ...opened, purposes, share: opened.dialog.getByTestId('share-card-share') }
}
// At rest with a loaded preview, the photo dialog (its tallest at-rest content, with the
// privacy help) fits short desktop viewports: its surface and the page never scroll,
// Cancel stays inside the viewport, and Download, Share and Cancel share one row.
async function expectRestingDialogFits(page: Page, dialog: Locator, info: TestInfo) {
  const surface = dialog.locator(':scope > div')
  const box = async (target: Locator) => {
    const found = await target.boundingBox()
    expect(found).not.toBeNull()
    return found!
  }
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(dialog.getByTestId('share-card-preview')).toHaveAttribute(
      'data-loaded',
      'true'
    )
    await expect(dialog.getByTestId('share-card-feedback')).toBeEmpty()
    await expect(dialog.getByTestId('share-card-recovery')).toHaveCount(0)
    const pageY = await page.evaluate(() => window.scrollY)
    await surface.hover()
    await page.mouse.wheel(0, 600)
    const scroll = await surface.evaluate(
      (element) =>
        new Promise<{ overflow: number; top: number; pageY: number }>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                overflow: element.scrollHeight - element.clientHeight,
                top: element.scrollTop,
                pageY: window.scrollY,
              })
            )
          )
        )
    )
    expect(scroll.overflow, `${width}x${height} dialog overflow`).toBeLessThanOrEqual(0)
    expect(scroll.top, `${width}x${height} dialog scrollTop after wheel`).toBe(0)
    expect(scroll.pageY, `${width}x${height} page scrollY after wheel`).toBe(pageY)
    const outline = await box(surface)
    const save = await box(dialog.getByTestId('share-card-save'))
    const share = await box(dialog.getByTestId('share-card-share'))
    const cancel = await box(dialog.getByTestId('share-card-cancel'))
    expect(outline.y).toBeGreaterThanOrEqual(0)
    expect(outline.y + outline.height).toBeLessThanOrEqual(height)
    expect(cancel.y + cancel.height).toBeLessThanOrEqual(height)
    expect(share.y, `${width}x${height} Share on Download's row`).toBeCloseTo(save.y, 0)
    expect(cancel.y, `${width}x${height} Cancel on Download's row`).toBeCloseTo(save.y, 0)
    expect(save.x).toBeLessThan(share.x)
    expect(share.x).toBeLessThan(cancel.x)
    await page.screenshot({ path: info.outputPath(`at-rest-${width}x${height}.png`) })
  }
}
test('P-SHARE-BYTES: the shared File is the previewed PNG and one handed_off event is captured', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['resolve'] }
  )
  await expectRestingDialogFits(page, dialog, info)
  const digest = await preview.getAttribute('data-sha256')
  expect(sha256(await previewBytes(preview))).toBe(digest)
  await expect(share).toBeEnabled()
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  await expect(share).toBeFocused()
  expect(await page.evaluate(sharedFiles)).toEqual([
    { name: 'couturecast-card.png', type: 'image/png', sha256: digest },
  ])
  expect(purposes).toEqual(['preview', 'share'])
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect(await shareEvents(page)).toEqual([
    {
      client: 'web',
      target: 'unknown',
      outcome: 'handed_off',
      duration_ms: expect.any(Number),
      locale: 'en-US',
    },
  ])
  await expect(dialog.getByText(shareCopy().shared, { exact: true })).toHaveCount(0)
})
test('P-SHARE-DISMISS: a closed share sheet keeps the preview, watermark and Download', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  const { dialog, preview, share } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['AbortError'] }
  )
  const digest = await preview.getAttribute('data-sha256')
  await activateFocused(share)
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().shareClosed)
  await expect(share).toBeFocused()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect(await shareEvents(page)).toEqual([
    {
      client: 'web',
      target: 'none',
      outcome: 'dismissed',
      duration_ms: expect.any(Number),
      locale: 'en-US',
    },
  ])
})
test('P-SHARE-TAP-AGAIN: an expired activation asks for one more tap that shares the same bytes without a new preparation', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['NotAllowedError', 'resolve'] }
  )
  const digest = await preview.getAttribute('data-sha256')
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().shareTapAgain)
  // The polite prompt is visible too; the status region alone is screen-reader only.
  await expect(
    dialog.locator('p[aria-hidden="true"]', { hasText: shareCopy().shareTapAgain })
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(share).toBeFocused()
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-labelledby="share-card-title"]')
        .analyze()
    ).violations
  ).toEqual([])
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  const files = await page.evaluate(sharedFiles)
  expect(files.map((file) => file.sha256)).toEqual([digest, digest])
  expect(purposes).toEqual(['preview', 'share'])
  await expect.poll(() => shareEvents(page)).toHaveLength(2)
  expect((await shareEvents(page)).map(({ outcome }) => outcome)).toEqual([
    'failed',
    'handed_off',
  ])
})
test('P-SHARE-CAPABILITY-OFF: no Share control when the capability is absent or canShare is missing, and Download still works', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  // playwright-utils deviation: interceptNetworkCall resolves on the first match, and
  // this route must answer every capability read for the first page.
  let absent = true
  let reads = 0
  await page.route('**/api/v1/share-cards/capabilities', (route) => {
    reads += 1
    return absent
      ? route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } })
      : route.continue()
  })
  const first = await openForShare(context, page, interceptNetworkCall, {
    canShare: true,
    outcomes: [],
  })
  await expect.poll(() => reads).toBe(1)
  await expect(first.dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect(first.share).toHaveCount(0)
  await page.keyboard.press('Escape')
  absent = false
  await page.evaluate(
    ([key, config]) => localStorage.setItem(key, JSON.stringify(config)),
    [SHARE_STUB_KEY, { canShare: 'missing', outcomes: [] }] as const
  )
  const { dialog, preview } = await ownPhoto(page, interceptNetworkCall)
  await expect(dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect(dialog.getByTestId('share-card-share')).toHaveCount(0)
  // Without canShare the dialog never asks for the capability.
  expect(reads).toBe(1)
  const downloaded = nextDownload(page)
  await dialog.getByTestId('share-card-save').click()
  const download = await downloaded
  expect(await downloadedDigest(download, info.outputPath('capability-off.png'))).toBe(
    await preview.getAttribute('data-sha256')
  )
  expect(await page.evaluate(sharedFiles)).toEqual([])
  expect(await shareEvents(page)).toEqual([])
})
test('P-SHARE-REVALIDATE: a share preparation conflict takes the stale path and never hands off', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  let conflict = true
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['resolve'] },
    async (route) => {
      if (!conflict) return route.continue()
      conflict = false
      await route.fulfill({
        status: 409,
        json: { code: 'preview_changed', statusCode: 409, message: 'preview_changed' },
      })
    }
  )
  const digest = await preview.getAttribute('data-sha256')
  // The shortest desktop size: the stale alert and Refresh line overflow the dialog.
  await page.setViewportSize({ width: 1280, height: 720 })
  await activateFocused(share)
  await expect(dialog.getByRole('alert')).toHaveText(shareCopy().previewChanged)
  const recovery = dialog.getByTestId('share-card-recovery')
  await expect(recovery).toHaveText(shareCopy().refresh)
  await expect(recovery).toBeFocused()
  // WCAG 2.4.11: the newly focused Refresh is scrolled fully into the viewport and into
  // the dialog's visible scroll area.
  await expect(recovery).toBeInViewport({ ratio: 1 })
  const surface = dialog.locator(':scope > div')
  await expect
    .poll(async () => {
      const visible = await surface.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const top = rect.top + element.clientTop
        return { top, bottom: top + element.clientHeight }
      })
      const box = await recovery.boundingBox()
      return box !== null && box.y >= visible.top && box.y + box.height <= visible.bottom
    }, 'Refresh inside the dialog scroll area')
    .toBe(true)
  await page.screenshot({ path: info.outputPath('stale-1280x720.png') })
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(share).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByTestId('share-card-save')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(await page.evaluate(sharedFiles)).toEqual([])
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect((await shareEvents(page))[0]).toMatchObject({
    outcome: 'failed',
    target: 'none',
  })
  await activateFocused(recovery)
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(share).toBeEnabled()
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  expect(purposes).toEqual(['preview', 'share', 'preview', 'share'])
})
