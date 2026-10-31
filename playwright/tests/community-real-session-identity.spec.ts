// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import fs from 'node:fs'
import path from 'node:path'
import type { Route } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '../support/fixtures/merged-fixtures'
import type { ApiRequestFixture } from '../support/helpers/api-test'
import {
  createRealCommunityAuthAccount,
  provisionRealCommunityAccount,
  readGeneratedCommunityCode,
  realSessionSkipReason,
  realCommunityEmail,
  signInRealCommunityWeb,
  signupRealCommunityAppUser,
  verifyRealCommunityOtp,
} from '../support/helpers/community-real-session'
import { expectCommunityFeedLoaded } from '../support/helpers/community-session'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

const api = 'http://127.0.0.1:4077'
const bearerKey = 'couturecast.access-token'

async function profileWithBearer(apiRequest: ApiRequestFixture, bearer: string) {
  return apiRequest({
    method: 'GET',
    baseUrl: api,
    path: '/api/v1/user/profile',
    headers: { Authorization: `Bearer ${bearer}` },
  })
}

function recordProbe(name: string, result: Record<string, unknown>) {
  const directory = process.env.STORY65_REAL_SESSION_DIR!
  const file = path.join(directory, 'identity-boundary-proof.json')
  const rows = (
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  ) as Record<string, unknown>
  fs.writeFileSync(file, `${JSON.stringify({ ...rows, [name]: result }, null, 2)}\n`)
}

test(
  'N1 a verified Auth identity without an app account is denied by the sign-in UI',
  // The 401 profile response is the subject of this test. The auto networkErrorMonitor
  // fixture would otherwise fail the test before its assertions run.
  { annotation: [{ type: 'skipNetworkMonitoring' }] },
  async ({ page, apiRequest }) => {
    const account = await createRealCommunityAuthAccount({
      email: realCommunityEmail(),
      appUserId: null,
      mapping: 'no-app-account',
      label: 'web-no-app-account',
    })
    const profile = page.waitForResponse('**/api/v1/user/profile')

    await page.goto('/signin')
    await page.locator('input[name="email"]').fill(account.email)
    await page.locator('button[type="submit"]').click()
    await page.locator('input[name="code"]').waitFor({ state: 'visible' })
    await page.locator('input[name="code"]').fill(readGeneratedCommunityCode(account))
    await page.locator('button[type="submit"]').click()

    expect((await profile).status()).toBe(401)
    await expect(page.getByRole('status')).not.toHaveText('')
    await expect(page.getByRole('status')).not.toHaveText(/Check your email/)
    await expect(page).toHaveURL(/\/signin$/)
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), bearerKey)
    ).toBeNull()

    const bearer = await verifyRealCommunityOtp(account)
    expect((await profileWithBearer(apiRequest, bearer)).status).toBe(401)
    recordProbe('noAppAccount', {
      authUserId: account.authUserId,
      uiProfile: 401,
      api: 401,
    })
  }
)

test('N1 case-insensitive duplicate app accounts make verified-email mapping ambiguous', async ({
  apiRequest,
}) => {
  const lower = realCommunityEmail()
  const mixed = lower.replace('story65-real-', 'Story65-Real-')
  const first = await signupRealCommunityAppUser(apiRequest, lower)
  // Signup refuses a case variant of an existing address.
  const refused = await apiRequest({
    method: 'POST',
    baseUrl: api,
    path: '/api/v1/auth/signup',
    body: { email: mixed, birthdate: '1990-06-15' },
  })
  expect(refused.status).toBe(400)
  // Rows created before that rule can still hold case variants. Seed one directly in the
  // owned UUID database so the resolver's ambiguity denial is exercised.
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
  let second: string
  try {
    second = (await prisma.user.create({ data: { email: mixed }, select: { id: true } }))
      .id
  } finally {
    await prisma.$disconnect()
  }
  expect(second).not.toBe(first)
  const account = await createRealCommunityAuthAccount({
    email: lower,
    appUserId: null,
    mapping: 'ambiguous-email',
    label: 'web-ambiguous-email',
  })

  const bearer = await verifyRealCommunityOtp(account)
  expect((await profileWithBearer(apiRequest, bearer)).status).toBe(401)
  recordProbe('ambiguousEmail', {
    authUserId: account.authUserId,
    signupCaseVariantStatus: refused.status,
    caseVariantAppUsers: [first, second],
    api: 401,
  })
})

test('N1 trusted app_user_id without a role keeps its binding over the email-mapped account', async ({
  apiRequest,
}) => {
  const trusted = await signupRealCommunityAppUser(apiRequest, realCommunityEmail())
  const emailOwnerEmail = realCommunityEmail()
  const emailOwner = await signupRealCommunityAppUser(apiRequest, emailOwnerEmail)
  const account = await createRealCommunityAuthAccount({
    email: emailOwnerEmail,
    appUserId: trusted,
    appMetadata: { app_user_id: trusted },
    mapping: 'metadata-without-role',
    label: 'web-metadata-without-role',
  })

  const bearer = await verifyRealCommunityOtp(account)
  const profile = await profileWithBearer(apiRequest, bearer)
  expect(profile.status).toBe(200)
  expect((profile.body as { user: { id: string } }).user.id).toBe(trusted)
  recordProbe('metadataWithoutRole', {
    authUserId: account.authUserId,
    trustedAppUser: trusted,
    emailMatchedAppUser: emailOwner,
    resolved: trusted,
  })
})

test('N1 an unknown metadata role is denied even with a trusted app_user_id', async ({
  apiRequest,
}) => {
  const trusted = await signupRealCommunityAppUser(apiRequest, realCommunityEmail())
  const account = await createRealCommunityAuthAccount({
    email: realCommunityEmail(),
    appUserId: trusted,
    appMetadata: { app_user_id: trusted, app_role: 'superuser' },
    mapping: 'metadata-invalid-role',
    label: 'web-metadata-invalid-role',
  })

  const bearer = await verifyRealCommunityOtp(account)
  expect((await profileWithBearer(apiRequest, bearer)).status).toBe(401)
  recordProbe('metadataInvalidRole', { authUserId: account.authUserId, api: 401 })
})

test('N1 a late profile response from the previous session cannot replace the switched account', async ({
  page,
  apiRequest,
}) => {
  const first = await provisionRealCommunityAccount(apiRequest, {
    mapping: 'metadata',
    label: 'web-late-fence-first',
  })
  const second = await provisionRealCommunityAccount(apiRequest, {
    mapping: 'email',
    label: 'web-late-fence-second',
  })
  await signInRealCommunityWeb(page, first, () =>
    Promise.resolve(readGeneratedCommunityCode(first))
  )
  // The home document restores the session again; its bearer is stored once that
  // canonical verification completes.
  await expectCommunityFeedLoaded(page)
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), bearerKey))
    .toBeTruthy()
  const firstBearer = await page.evaluate((key) => sessionStorage.getItem(key), bearerKey)

  // Hold the restored first-session profile request while the second account signs in.
  let releaseFirst!: () => void
  const firstHeld = new Promise<Route>((resolve) => {
    void page.route('**/api/v1/user/profile', async (route) => {
      if (route.request().headers().authorization !== `Bearer ${firstBearer}`)
        return route.continue()
      resolve(route)
      await new Promise<void>((release) => (releaseFirst = release))
      await route.continue()
    })
  })
  await page.goto('/signin')
  await firstHeld

  // Cancel the post-verification navigation once (ERR_ABORTED keeps the current document),
  // so the late first-session response lands in the document that accepted the switch.
  const navigationHeld = new Promise<void>((resolve) => {
    void page.route(
      'http://127.0.0.1:3077/',
      async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue()
        await route.abort('aborted')
        resolve()
      },
      { times: 1 }
    )
  })
  const secondProfile = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/user/profile') &&
      response.request().headers().authorization !== `Bearer ${firstBearer}`
  )
  await page.locator('input[name="email"]').fill(second.email)
  await page.locator('button[type="submit"]').click()
  await page.locator('input[name="code"]').waitFor({ state: 'visible' })
  await page.locator('input[name="code"]').fill(readGeneratedCommunityCode(second))
  await page.locator('button[type="submit"]').click()
  expect((await secondProfile).status()).toBe(200)
  await navigationHeld
  const secondBearer = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    bearerKey
  )
  expect(secondBearer).toBeTruthy()
  expect(secondBearer).not.toBe(firstBearer)

  const lateFirst = page.waitForEvent(
    'requestfinished',
    (request) => request.headers().authorization === `Bearer ${firstBearer}`
  )
  releaseFirst()
  expect((await (await lateFirst).response())?.status()).toBe(200)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), bearerKey)).toBe(
    secondBearer
  )

  await expect(page).toHaveURL(/\/signin$/)
  await page.goto('/')
  await expectCommunityFeedLoaded(page)
  // The restored session stores its bearer once canonical verification completes.
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), bearerKey))
    .toBeTruthy()
  const stored = await page.evaluate((key) => sessionStorage.getItem(key), bearerKey)
  const owner = await profileWithBearer(apiRequest, stored!)
  expect((owner.body as { user: { id: string } }).user.id).toBe(second.appUserId)
  recordProbe('lateSessionFence', {
    firstAuthUserId: first.authUserId,
    secondAuthUserId: second.authUserId,
    lateFirstProfileStatus: 200,
    canonicalOwnerAfterLateResponse: second.appUserId,
  })
})
