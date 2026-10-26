import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createClient, type Session } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  supportedLocales,
  prepareShareCardInputSchema,
} from '@couture/api-client/contracts/http'
import { decodeShareCardBase64, validateShareCardPng } from '@couture/api-client'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const read = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
const env = read('owned-env.json') as { DATABASE_URL: string }
if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(env.DATABASE_URL).pathname))
  throw new Error('owned_uuid_required')
const fixture = read('fixtures.json') as {
  postId: string
  identities: { email: string; appUserId: string; label: string }[]
}
const build = read('public-build-env.json') as { EXPO_PUBLIC_SUPABASE_ANON_KEY: string }
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
  await context.addInitScript(
    (value) => {
      if (!sessionStorage.getItem('cc68-session-initialized')) {
        localStorage.setItem('couturecast.auth-session', JSON.stringify(value))
        sessionStorage.setItem('cc68-session-initialized', 'true')
      }
    },
    await session(account)
  )
}
const modal = (page: Page) => page.locator('[aria-labelledby="share-card-title"]')
async function ownPhoto(page: Page) {
  const profile = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/user/profile') && r.status() === 200
  )
  await page.goto('/')
  await profile
  const opener = page
    .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
    .first()
    .getByTestId('share-card-open')
  await opener.click()
  const preview = modal(page).getByTestId('share-card-preview')
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  return { opener, preview, dialog: modal(page) }
}
for (const locale of supportedLocales)
  test.describe(locale, () => {
    test.use({ locale })
    test('P-POST P-PHOTO-PREVIEW P-LOCALE P-WATERMARK P-DOWNLOAD-BYTES P-A11Y: exact full labels, pixels, keyboard, nested and fallback focus', async ({
      context,
      page,
    }, info) => {
      await identify(context)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const { opener, preview, dialog } = await ownPhoto(page)
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
      await expect(preview).toHaveAttribute(
        'alt',
        body + `. ${catalog.watermarkRole}: CoutureCast`
      )
      const digest = await preview.getAttribute('data-sha256')
      await dialog.getByRole('checkbox').uncheck()
      await expect(preview).toHaveAttribute('alt', body)
      await expect(preview).toHaveAttribute('data-loaded', 'true')
      await dialog.getByRole('checkbox').check()
      await expect(preview).toHaveAttribute('data-sha256', digest!)
      await expect(preview).toHaveAttribute('data-loaded', 'true')
      const bytes = decodeShareCardBase64(
        (await preview.getAttribute('src'))!.split(',')[1]!
      )
      validateShareCardPng(bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-labelledby="share-card-title"]')
            .analyze()
        ).violations
      ).toEqual([])
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 })
        await expect(dialog.getByTestId('share-card-save')).toBeVisible()
        await expect(dialog).toHaveJSProperty(
          'scrollWidth',
          await dialog.evaluate((el) => el.clientWidth)
        )
        await page.screenshot({ path: info.outputPath(`${locale}-${width}.png`) })
      }
      const downloaded = page.waitForEvent('download')
      await dialog.getByTestId('share-card-save').click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe('couturecast-card.png')
      const file = info.outputPath('couturecast-card.png')
      await download.saveAs(file)
      expect(fs.readFileSync(file)).toEqual(Buffer.from(bytes))
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
      expect(errors).toEqual([])
    })
  })
test('P-FOREIGN P-IDENTITY: a second genuine account has no export action or access to former member source', async ({
  context,
  page,
  request,
}) => {
  await identify(context, 1)
  await page.goto('/')
  const foreign = page.locator(`[data-testid$="lookbook-card-${fixture.postId}"]`).first()
  await expect(foreign).toBeVisible()
  await expect(foreign.getByTestId('share-card-open')).toHaveCount(0)
  const response = await request.post(
    'http://127.0.0.1:4088/api/v1/share-cards/prepare',
    {
      headers: { Authorization: `Bearer ${(await session(1)).access_token}` },
      data: {
        source: { kind: 'community_post', postId: fixture.postId },
        locale: 'en-US',
        watermark: true,
        purpose: 'preview',
      },
    }
  )
  expect(response.status()).toBe(404)
  expect(await response.json()).not.toHaveProperty('data')
})
test('P-REVALIDATE P-DOWNLOAD-ERROR P-CANCEL: final conflict and handoff error retain approved preview; cancellation prevents download', async ({
  context,
  page,
}) => {
  await identify(context)
  const { dialog, preview } = await ownPhoto(page)
  const digest = await preview.getAttribute('data-sha256')
  let conflict = true
  // Body-dependent authorization and a deferred handoff need a route handler.
  await page.route('**/api/v1/share-cards/prepare', async (route) => {
    if (
      prepareShareCardInputSchema.parse(route.request().postDataJSON()).purpose ===
        'save' &&
      conflict
    )
      await route.fulfill({
        status: 409,
        json: { code: 'preview_changed', statusCode: 409, message: 'preview_changed' },
      })
    else await route.continue()
  })
  await dialog.getByTestId('share-card-save').click()
  await expect(dialog.getByRole('alert')).toContainText('changed')
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  conflict = false
  await dialog.getByRole('button', { name: 'Refresh preview' }).click()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('observable_handoff_failure')
    }
  })
  const downloads: string[] = []
  page.on('download', (item) => downloads.push(item.suggestedFilename()))
  await dialog.getByTestId('share-card-save').click()
  await expect(dialog.getByRole('alert')).toContainText('Something went wrong')
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(downloads).toEqual([])
})

test('P-OUTFIT P-CANCEL P-OFFLINE: all persisted scenarios, retained composition and offline export refusal', async ({
  context,
  page,
}) => {
  await identify(context)
  let releaseProfile!: () => void
  const heldProfile = new Promise<void>((resolve) => {
    releaseProfile = resolve
  })
  let profileEntered!: () => void
  const profileStarted = new Promise<void>((resolve) => {
    profileEntered = resolve
  })
  await page.route('**/api/v1/user/profile', async (route) => {
    profileEntered()
    await heldProfile
    await route.continue()
  })
  await page.route('**/api/v1/ritual?*', async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer .+/)
    await route.continue()
  })
  await page.goto('/')
  await profileStarted
  const launcher = page.getByTestId('ritual-share-card-launcher')
  try {
    await launcher.getByRole('button').first().click()
    await expect(launcher.getByRole('button').first()).toBeDisabled()
  } finally {
    releaseProfile()
  }
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
    await opener.click()
    await expect(preview).toHaveAttribute('data-loaded', 'true')
    await expect(preview).toHaveAttribute('data-sha256', digest!)
    await context.setOffline(true)
    await modal(page).getByTestId('share-card-save').click()
    await expect(modal(page).getByRole('alert')).toContainText('Connect to the internet')
    await expect(preview).toHaveAttribute('data-sha256', digest!)
    await context.setOffline(false)
    await page.keyboard.press('Escape')
  }
})
test('P-CANCEL P-IDENTITY: cancelled late preview never returns across genuine UI sign-out and second sign-in', async ({
  context,
  page,
}) => {
  await identify(context)
  await page.goto('/')
  const opener = page
    .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
    .first()
    .getByTestId('share-card-open')
  await expect(opener).toBeVisible()
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  await page.route(
    '**/api/v1/share-cards/prepare',
    async (route) => {
      const response = await route.fetch()
      entered()
      await held
      await route.fulfill({ response }).catch(() => undefined)
    },
    { times: 1 }
  )
  const downloads: string[] = []
  page.on('download', (d) => downloads.push(d.suggestedFilename()))
  await opener.click()
  await started
  await page.keyboard.press('Escape')
  await expect(modal(page)).not.toBeVisible()
  await page.goto('/notification-settings')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.waitForURL('/')
  release()
  await expect(page.getByTestId('share-card-preview')).toHaveCount(0)
  await page.goto('/notification-settings')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  try {
    const since = Date.now()
    const account = fixture.identities[1]!
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
    await expect(
      page.getByText('Check your email for the sign-in code.', { exact: true })
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
    await page.getByLabel('Email code', { exact: true }).fill(code.code)
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  } catch {
    throw new Error('owned_web_signin_failed')
  }
  await page.waitForURL('/')
  await expect(page.getByTestId('share-card-preview')).toHaveCount(0)
  await expect(
    page
      .locator(`[data-testid$="lookbook-card-${fixture.postId}"]`)
      .first()
      .getByTestId('share-card-open')
  ).toHaveCount(0)
  expect(downloads).toEqual([])
})

test('P-CANCEL-SAVE: closing during held save authorization prevents browser handoff and retains composition', async ({
  context,
  page,
}) => {
  await identify(context)
  // Browser Back now performs a real client navigation that removes the composer.
  await page.goto('/notification-settings')
  const { opener, preview, dialog } = await ownPhoto(page)
  const digest = await preview.getAttribute('data-sha256')
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let settled!: () => void
  const finished = new Promise<void>((resolve) => {
    settled = resolve
  })
  await page.route('**/api/v1/share-cards/prepare', async (route) => {
    const input = prepareShareCardInputSchema.parse(route.request().postDataJSON())
    if (input.purpose !== 'save') return route.continue()
    const response = await route.fetch()
    entered()
    await held
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
    } finally {
      settled()
    }
  })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await dialog.getByTestId('share-card-save').click()
  await started
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(opener).toBeFocused()
  release()
  await finished
  await opener.click()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(downloads).toEqual([])
  await page.keyboard.press('Escape')
  await page.unroute('**/api/v1/share-cards/prepare')
  await opener.click()
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(dialog).not.toContainText('Saving')
  let releaseNavigation!: () => void
  let navigationEntered!: () => void
  let navigationSettled!: () => void
  const navigationHold = new Promise<void>((resolve) => {
    releaseNavigation = resolve
  })
  const navigationStarted = new Promise<void>((resolve) => {
    navigationEntered = resolve
  })
  const navigationFinished = new Promise<void>((resolve) => {
    navigationSettled = resolve
  })
  await page.route('**/api/v1/share-cards/prepare', async (route) => {
    const input = prepareShareCardInputSchema.parse(route.request().postDataJSON())
    if (input.purpose !== 'save') return route.continue()
    const response = await route.fetch()
    navigationEntered()
    await navigationHold
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
    } finally {
      navigationSettled()
    }
  })
  await dialog.getByTestId('share-card-save').click()
  await navigationStarted
  await page.goBack()
  await expect(page).toHaveURL('/notification-settings')
  await expect(page.getByTestId('share-card-save')).toHaveCount(0)
  releaseNavigation()
  await navigationFinished
  expect(downloads).toEqual([])
})
