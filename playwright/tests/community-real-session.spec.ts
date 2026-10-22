import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { createApiClient, communitySyncClient } from '@couture/api-client'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  provisionRealCommunityAccount,
  readCommunityMailCode,
  readGeneratedCommunityCode,
  realSessionSkipReason,
  signInRealCommunityWeb,
} from '../support/helpers/community-real-session'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

test('N1 real OTP canonical identity, restore, refresh, account switch and offline logout', async ({
  page,
  context,
  apiRequest,
  interceptNetworkCall,
  recurse,
}) => {
  const directory = process.env.STORY65_REAL_SESSION_DIR!
  const mailProof = path.join(directory, 'real-mail-proof.json')
  const first = await provisionRealCommunityAccount(apiRequest, {
    mapping: 'metadata',
    issueMode: fs.existsSync(mailProof) ? 'generated' : 'real-email',
    label: 'web-real-mail',
  })
  const second = await provisionRealCommunityAccount(apiRequest, {
    mapping: 'email',
    label: 'web-verified-email',
  })
  const native = []
  for (const platform of ['android', 'ios']) {
    for (const mapping of ['metadata', 'email'] as const)
      native.push(
        await provisionRealCommunityAccount(apiRequest, {
          mapping,
          label: `${platform}-${mapping}`,
        })
      )
  }
  expect(native).toHaveLength(4)

  const profile = interceptNetworkCall({ method: 'GET', url: '**/api/v1/user/profile' })
  await signInRealCommunityWeb(page, first, async () => {
    if (first.issueMode === 'generated') return readGeneratedCommunityCode(first)
    const code = await recurse(
      () => readCommunityMailCode(first.email),
      (value) => Boolean(value),
      { timeout: 20_000, interval: 250, log: false }
    )
    if (!code)
      throw new Error('The real local Auth email did not contain a sign-in code.')
    return code
  })
  expect((await profile).status).toBe(200)
  if (first.issueMode === 'real-email')
    fs.writeFileSync(
      mailProof,
      JSON.stringify(
        {
          actualOtpRequest: true,
          mailCatcherRead: true,
          realAppVerifyOtp: true,
          profileStatus: 200,
          account: first,
        },
        null,
        2
      )
    )
  await expect(page.getByTestId('lookbook-card-lookbook-1')).toBeVisible()

  const readIdentity = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem('couturecast.auth-session')
      const saved = raw ? (JSON.parse(raw) as { user: { id: string } }) : null
      return {
        sub: saved?.user.id,
        bearer: window.sessionStorage.getItem('couturecast.access-token'),
      }
    })
  const identity = await readIdentity()
  expect(identity.sub).toBe(first.authUserId)
  expect(identity.sub).not.toBe(first.appUserId)
  expect(identity.bearer).toBeTruthy()

  // playwright-utils deviation: production SDK wrappers are the behavior under test here.
  const api = createApiClient('http://127.0.0.1:4077', { accessToken: identity.bearer! })
  expect((await api.apiV1UserProfileGet()).user.id).toBe(first.appUserId)
  const sync = communitySyncClient(api)
  const installationId = randomUUID()
  const bound = await sync.register({
    token: `ExponentPushToken[story65_${randomUUID().replaceAll('-', '')}]`,
    installationId,
    platform: 'android',
    permission: 'granted',
  })
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
  try {
    const row = await prisma.pushToken.findUnique({ where: { id: bound.registrationId } })
    expect(row?.user_id).toBe(first.appUserId)
  } finally {
    await prisma.$disconnect()
  }
  await sync.remove(bound.registrationId, bound.bindingGeneration)

  const restored = interceptNetworkCall({ method: 'GET', url: '**/api/v1/user/profile' })
  await page.reload()
  expect((await restored).status).toBe(200)
  await expect(page.getByTestId('lookbook-card-lookbook-1')).toBeVisible()
  expect((await readIdentity()).sub).toBe(first.authUserId)

  // Arrange only persisted SDK expiry metadata. The signed JWT stays untouched;
  // the SDK must obtain a real replacement from local Auth's refresh endpoint.
  await page.evaluate(() => {
    const raw = window.localStorage.getItem('couturecast.auth-session')
    if (!raw) throw new Error('A real persisted session is required.')
    const session = JSON.parse(raw) as { expires_at: number }
    session.expires_at = Math.floor(Date.now() / 1000) - 1
    window.localStorage.setItem('couturecast.auth-session', JSON.stringify(session))
  })
  const refresh = interceptNetworkCall({ method: 'POST', url: '**/auth/v1/token*' })
  await page.reload()
  expect((await refresh).status).toBe(200)
  await expect(page.getByTestId('lookbook-card-lookbook-1')).toBeVisible()
  expect((await readIdentity()).sub).toBe(first.authUserId)

  await signInRealCommunityWeb(page, second, () =>
    Promise.resolve(readGeneratedCommunityCode(second))
  )
  await expect(page.getByTestId('lookbook-card-lookbook-1')).toBeVisible()
  const switched = await readIdentity()
  expect(switched.sub).toBe(second.authUserId)
  const switchedApi = createApiClient('http://127.0.0.1:4077', {
    accessToken: switched.bearer!,
  })
  expect((await switchedApi.apiV1UserProfileGet()).user.id).toBe(second.appUserId)
  await switchedApi.apiV1WardrobeGarmentsGet()
  const community = await communitySyncClient(switchedApi).events('all')
  expect(community.nextCursor).toBeTruthy()

  await page.goto('/notification-settings')
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await context.setOffline(true)
  const navigation = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await navigation
  await context.setOffline(false)
  await page.goto('/')
  await recurse(
    () =>
      page.evaluate(() => ({
        localCleared: window.localStorage.getItem('couturecast.auth-session') === null,
        bearerCleared: window.sessionStorage.getItem('couturecast.access-token') === null,
      })),
    (state) => state.localCleared && state.bearerCleared,
    { timeout: 10_000, interval: 100, log: false }
  )
  fs.writeFileSync(
    path.join(directory, 'web-real-session-proof.json'),
    JSON.stringify(
      {
        // A generated-issuance run links the earlier real-mail milestone instead of claiming it.
        realMailOtp: first.issueMode === 'real-email',
        realMailProof: first.issueMode === 'real-email' ? 'this run' : mailProof,
        realVerifyOtp: true,
        trustedMetadataCanonicalOwner: first.appUserId,
        trustedMetadataAuthSub: first.authUserId,
        verifiedEmailCanonicalOwner: second.appUserId,
        verifiedEmailAuthSub: second.authUserId,
        restore: true,
        realRefresh: true,
        accountSwitch: true,
        offlineLogoutClearsStorage: true,
        registrationCanonicalOwner: first.appUserId,
        registrationTokenBoundary:
          'controlled synthetic input; real signed bearer and production HTTP wrapper',
        bearerFingerprint: createHash('sha256').update(identity.bearer!).digest('hex'),
      },
      null,
      2
    )
  )
})
