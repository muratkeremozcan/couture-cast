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
import { createClient, type Session } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import type {
  APIResponse,
  BrowserContext,
  Page,
  Locator,
  Request,
  Response,
  Route,
} from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  supportedLocales,
  prepareShareCardInputSchema,
  communitySponsoredFeedResponseSchema,
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
  identities: { email: string; appUserId: string; label: string }[]
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
async function ownPhoto(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn | null,
  preparationJourney?: (open: () => Promise<void>, apiOrigin: string) => Promise<void>
) {
  let apiOrigin = ''
  if (interceptNetworkCall) {
    const profile = interceptNetworkCall({ method: 'GET', url: '**/api/v1/user/profile' })
    const navigateHome = () => page.goto('/').then(() => undefined)
    if (preparationJourney)
      await afterInitialCommunityVerification({
        page,
        postId: fixture.postId,
        navigate: navigateHome,
      })
    else await navigateHome()
    const verified = await profile
    expect(verified.status).toBe(200)
    apiOrigin = new URL(verified.request!.url()).origin
  }
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
  (
    JSON.parse(
      fs.readFileSync(path.resolve(`apps/web/src/i18n/locales/${locale}.json`), 'utf8')
    ) as { shareCard: { photoPrivacyHelp: string; offline: string; retry: string } }
  ).shareCard
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
        const checkbox = modal(page).getByRole('checkbox')
        phase('off')
        const off = page.waitForRequest((request) => isPreparation(request, false))
        await checkbox.uncheck()
        await off
        live()
        check('watermarkOff', true)
        phase('on')
        const on = page.waitForRequest((request) => isPreparation(request, true))
        await checkbox.check()
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
// The settings form loads above the page's links; click them only once it is in place.
const settingsLoaded = (page: Page) =>
  expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible()
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
        dialog.getByText(webCatalog(locale).photoPrivacyHelp, { exact: true })
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
}) => {
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
  expect(sha256(fs.readFileSync(await download.path()))).toBe(digest)
  expect(purposes).toEqual(['preview', 'save', 'preview', 'save', 'save'])
  await expect(retryButton).toHaveCount(0)
  await expect(dialog.getByTestId('share-card-save')).toBeFocused()
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(downloads).toEqual(['couturecast-card.png'])
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
test('P-OFFLINE: offline Save refuses export and keeps the preview; the same member retry downloads it', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  await identify(context)
  const { preview, dialog } = await ownPhoto(page, interceptNetworkCall)
  const digest = await preview.getAttribute('data-sha256')
  const copy = webCatalog('en-US')
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
  expect(sha256(fs.readFileSync(await download.path()))).toBe(digest)
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
    expect(switchedProfile.status).toBe(200)
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
  const verification = routeGate()
  const preferences = routeGate()
  const heldSession = interceptNetworkCall({
    method: 'GET',
    url: '**/api/v1/user/profile',
    handler: async (route, request) => {
      if (!verification.request) {
        verification.request = request
        verification.enter()
        await verification.released
      }
      await route.continue()
    },
  })
  const heldPreferences = interceptNetworkCall({
    method: 'GET',
    url: '**/api/v1/community/notification-preferences',
    handler: async (route, request) => {
      if (!preferences.request) {
        preferences.request = request
        preferences.enter()
        await preferences.released
      }
      await route.continue()
    },
  })
  await page.goto('/notification-settings')
  const back = page.getByRole('link', { name: 'Back to community', exact: true })
  const boxes = []
  try {
    await heldSession
    await verification.started
    await expect(back).toBeVisible()
    boxes.push(await back.boundingBox())
    verification.release()
    await heldPreferences
    await preferences.started
    boxes.push(await back.boundingBox())
  } finally {
    verification.release()
    preferences.release()
  }
  await settingsLoaded(page)
  boxes.push(await back.boundingBox())
  // The form's place is held while identity and settings load, so links never move.
  expect(boxes, 'Back link box while verifying, loading and loaded').toEqual([
    boxes[0],
    boxes[0],
    boxes[0],
  ])
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
