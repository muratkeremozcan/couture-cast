// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 E-CONV-REAL-STACK (web): a guest signs up from the preview, signs in through
// the real local OTP, and applies the preview's comfort settings through the verified API.
// Runs only in the owned real-session lane (npm run test:pw-real-session).
// CC-7.21: _bmad-output/project-knowledge/learning-path-step-by-step.md#step-78-first-look-and-account-save
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { CONSENT_REQUIRED_TAG } from '../../scripts/e2e-real-session/harness.mjs'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
  type RealCommunityAccount,
  provisionRealCommunityAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
  removeRealSessionGarmentObjects,
  signInRealCommunityWeb,
} from '../support/helpers/community-real-session'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

const choose = (page: Page, testId: string) =>
  page.locator(`label:has([data-testid="${testId}"])`).click()

const cameraRequestKey = 'fixture-camera-requests'
const garmentFixture = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

async function denyCameraAndCountRequests(page: Page) {
  await page.addInitScript((key) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key)) + 1))
          return Promise.reject(
            new DOMException('Fixture denies camera access', 'NotAllowedError')
          )
        },
      },
    })
  }, cameraRequestKey)
}

const cameraRequests = (page: Page) =>
  page.evaluate((key) => Number(sessionStorage.getItem(key)), cameraRequestKey)

// Pick a date away from birthdays and year boundaries in either client or server time.
function teenBirthdate() {
  const now = new Date()
  now.setUTCFullYear(now.getUTCFullYear() - 14)
  now.setUTCDate(now.getUTCDate() - 182)
  return now.toISOString().slice(0, 10)
}

async function signInFromPreview(page: Page, account: RealCommunityAccount) {
  await page.getByTestId('signup-sign-in-to-continue').click()
  await expect(page).toHaveURL(/\/signin\?from=preview$/)
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('button[type="submit"]').click()
  const code = page.locator('input[name="code"]')
  await expect(code).toBeVisible()
  await code.fill(readGeneratedCommunityCode(account))
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/preview\/continue$/)
}

async function createFirstRunAccount(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  birthdate: string,
  email: string
) {
  await page.getByTestId('sample-save-look').click()
  const sheet = page.getByTestId('guest-preview-save-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId('guest-preview-create-account').click()
  await expect(page).toHaveURL(/\/signup\?from=preview$/)
  await expect(page.getByLabel('Birthdate')).toHaveValue(birthdate)
  await page.getByLabel('Email').fill(email)
  const signup = interceptNetworkCall({
    method: 'POST',
    url: '**/api/v1/auth/signup',
  })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const created = await signup
  expect(created.status).toBe(201)
  expect(created.requestJson).toMatchObject({ birthdate })
  return signupResponseSchema.parse(created.responseJson)
}

async function prepareFirstRunLook(page: Page, birthdate: string) {
  await page.goto('/')
  await page.getByTestId('guest-preview-entry').click()
  await page.getByTestId('guest-preview-birthdate').fill(birthdate)
  await page.getByTestId('guest-preview-gate-submit').click()
  await page.getByTestId('style-mood-cozy').click()
  await page.getByText('Pick your style (optional)', { exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Colors', exact: true })
    .selectOption('colorful')
  await page.getByTestId('guest-preview-comfort-toggle').click()
  await choose(page, 'guest-preview-thermal-cold')
  await page.getByTestId('guest-preview-swap-shoes').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { checked: false }).first().click()
  await expect(dialog).toBeHidden()
  const garments = page.getByTestId('guest-preview-garment')
  await expect(garments.nth(2)).toBeVisible()
  return garments.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-garment-id'))
  )
}

test.describe('Guest preview and first garment with verified auth', () => {
  test('6.16 guest preview carries comfort settings and lets the verified member save a first garment', async ({
    interceptNetworkCall,
    page,
  }) => {
    const prisma = new PrismaClient()
    let fixtureOwner: string | undefined
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await denyCameraAndCountRequests(page)
      await page.goto('/preview')
      await page.getByTestId('guest-preview-birthdate').fill('1990-06-15')
      await page.getByTestId('guest-preview-gate-submit').click()
      await page.getByTestId('guest-preview-comfort-toggle').click()
      await choose(page, 'guest-preview-thermal-cold')
      await choose(page, 'guest-preview-wind-low')
      await choose(page, 'guest-preview-rain-high')

      await page.getByTestId('guest-preview-nav-preferences').click()
      await page
        .getByRole('region', { name: 'Add your clothes' })
        .getByRole('link', { name: 'Create account' })
        .click()
      await expect(page).toHaveURL(/\/signup\?from=preview$/)
      const email = realCommunityEmail()
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Birthdate').fill('1990-06-15')
      const signup = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/auth/signup',
      })
      await page.getByRole('button', { name: 'Create account' }).click()
      const created = await signup
      expect(created.status).toBe(201)
      const { userId } = signupResponseSchema.parse(created.responseJson)
      fixtureOwner = userId
      // The signup response authenticates nobody: the account still holds signup's schema
      // defaults, and nothing from the preview.
      const defaults = await prisma.comfortPreferences.findUnique({
        where: { user_id: userId },
      })
      expect({
        runs: defaults?.runs_cold_warm,
        wind: defaults?.wind_tolerance,
        rain: defaults?.precip_preparedness,
      }).toEqual({ runs: 'neutral', wind: 'medium', rain: 'medium' })

      const account = await createRealCommunityAuthAccount({
        email,
        appUserId: userId,
        mapping: 'email',
        label: 'guest-preview-carryover',
      })
      await signInFromPreview(page, account)
      await expect(page.getByTestId('guest-preview-review-proposed')).toContainText(
        'I tend to feel cold'
      )
      await page.getByTestId('guest-preview-review-use').click()
      await expect(page.getByTestId('guest-preview-review-result')).toHaveText(
        'Your comfort preferences are saved.'
      )
      const row = await prisma.comfortPreferences.findUnique({
        where: { user_id: userId },
      })
      expect({
        runs: row?.runs_cold_warm,
        wind: row?.wind_tolerance,
        rain: row?.precip_preparedness,
      }).toEqual({ runs: 'cold', wind: 'low', rain: 'high' })
      expect(
        await page.evaluate(() => localStorage.getItem('couturecast.guest-preview'))
      ).toBeNull()
      // Preview-only choices never became account data, and onboarding is not marked done.
      expect(
        await prisma.wardrobeOnboardingState.findFirst({ where: { user_id: userId } })
      ).toBeNull()
      await page.getByTestId('guest-preview-review-continue').click()
      // Entry is consumed when the wardrobe opens the capture dialog.
      await expect(page).toHaveURL(/\/wardrobe$/)
      const capture = page.getByRole('dialog', { name: 'Add a piece' })
      await expect(capture.getByRole('button', { name: 'Choose File' })).toBeVisible()
      expect(await cameraRequests(page)).toBe(0)

      await capture.getByLabel('Garment image file').setInputFiles(garmentFixture)
      await capture.getByRole('button', { name: 'Use This Image' }).click()
      await expect(capture.getByRole('heading', { name: 'Piece added' })).toBeVisible()
      await capture.getByRole('button', { name: 'Done', exact: true }).click()

      const tagging = page.getByRole('dialog', { name: 'Organize Garment Tags' })
      await tagging.getByRole('radio', { name: 'Top', exact: true }).click()
      await tagging.getByRole('button', { name: 'Save tags' }).click()
      await expect(tagging).toBeHidden()

      const garments = await prisma.garmentItem.findMany({ where: { user_id: userId } })
      expect(garments).toEqual([
        expect.objectContaining({
          category: 'top',
          committed_at: expect.any(Date),
          tags_confirmed_at: expect.any(Date),
        }),
      ])
      expect(
        await prisma.wardrobeOnboardingState.findFirst({ where: { user_id: userId } })
      ).toBeNull()
      const card = page.getByTestId(`garment-card-${garments[0]!.id}`)
      await expect(card.getByTestId(`garment-open-${garments[0]!.id}`)).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Back to outfit', exact: true })
      ).toBeVisible()
      await page.reload()
      await expect(card.getByTestId(`garment-open-${garments[0]!.id}`)).toBeVisible()
      await expect(capture).toBeHidden()
    } finally {
      try {
        if (fixtureOwner) await removeRealSessionGarmentObjects(fixtureOwner)
      } finally {
        await prisma.$disconnect()
      }
    }
  })

  test('[P1] [UX-FIRST-003] a verified member can review a garment file after camera denial', async ({
    apiRequest,
    page,
  }) => {
    const account = await provisionRealCommunityAccount(apiRequest, {
      mapping: 'email',
      label: 'garment-camera-denied',
    })
    await denyCameraAndCountRequests(page)
    await signInRealCommunityWeb(page, account, () =>
      Promise.resolve(readGeneratedCommunityCode(account))
    )

    await page.goto('/wardrobe/onboarding')
    const step = page.getByTestId('onboarding-step-region')
    const requestCamera = step.getByRole('button', {
      name: 'Allow access',
    })
    await expect(requestCamera).toBeVisible()
    expect(await cameraRequests(page)).toBe(0)
    await requestCamera.click()
    await expect(step.getByRole('alert')).toContainText(
      'You can pick a file or try the sample closet.'
    )
    expect(await cameraRequests(page)).toBe(1)

    await step.getByRole('button', { name: 'Add a piece' }).click()
    const capture = page.getByRole('dialog', { name: 'Add a piece' })
    const chooseFile = page.waitForEvent('filechooser')
    await capture.getByRole('button', { name: 'Choose File' }).click()
    await (await chooseFile).setFiles(garmentFixture)
    await expect(capture.getByRole('button', { name: 'Use This Image' })).toBeVisible()
  })

  test('6.16 a full guest journey writes no row (E-NO-DB-WRITES)', async ({ page }) => {
    const prisma = new PrismaClient()
    const counts = async () => ({
      user: await prisma.user.count(),
      userProfile: await prisma.userProfile.count(),
      guardianConsent: await prisma.guardianConsent.count(),
      comfortPreferences: await prisma.comfortPreferences.count(),
      garmentItem: await prisma.garmentItem.count(),
      outfitRecommendation: await prisma.outfitRecommendation.count(),
      outfitCapsule: await prisma.outfitCapsule.count(),
      wardrobeOnboardingState: await prisma.wardrobeOnboardingState.count(),
      silhouetteProfile: await prisma.silhouetteProfile.count(),
      lookbookPost: await prisma.lookbookPost.count(),
      premiumEntitlement: await prisma.premiumEntitlement.count(),
      complimentaryAccessGrant: await prisma.complimentaryAccessGrant.count(),
      telemetryEvent: await prisma.telemetryEvent.count(),
    })
    try {
      // The lane runs one test at a time on its own database, so a whole-database count
      // measures this journey alone.
      const before = await counts()
      await page.goto('/preview')
      await page.getByTestId('guest-preview-birthdate').fill('1990-06-15')
      await page.getByTestId('guest-preview-gate-submit').click()
      await page.getByTestId('guest-preview-comfort-toggle').click()
      await choose(page, 'guest-preview-thermal-cold')
      await page.getByTestId('guest-preview-swap-shoes').click()
      await page.getByTestId('guest-preview-swap-option-white-sneakers').click()
      await page.getByTestId('guest-preview-try-another').click()
      await page.getByTestId('guest-preview-nav-preferences').click()
      await page.getByTestId('guest-preview-vote-like').first().click()
      await page.getByTestId('guest-preview-nav-wardrobe').click()
      await page.getByTestId('guest-preview-item').first().click()
      await page.keyboard.press('Escape')
      await page.getByTestId('guest-preview-exit').click()
      await expect(page).toHaveURL(/\/$/)
      expect(await counts()).toEqual(before)
    } finally {
      await prisma.$disconnect()
    }
  })
})

test.describe('CC-7.21 first-run save with verified auth', () => {
  const prisma = new PrismaClient()
  test.use({ viewport: { width: 390, height: 844 } })
  test.afterAll(() => prisma.$disconnect())

  const scenarios = [
    { member: 'adult', tag: '@first-run', decision: 'use' },
    { member: 'approved teen', tag: CONSENT_REQUIRED_TAG, decision: 'keep' },
    { member: 'guardian-pending teen', tag: CONSENT_REQUIRED_TAG, decision: 'use' },
    { member: 'adult leaving review', tag: '@first-run', decision: 'cancel' },
  ] as const

  for (const { member, tag, decision } of scenarios) {
    test(
      `[P0] [7.21-SAVE] ${member} can ${decision} guest answers after signup`,
      {
        tag,
        ...(member === 'guardian-pending teen'
          ? { annotation: [{ type: 'expectGuardianCapsuleRefusal' }] }
          : {}),
      },
      async ({ apiRequest, interceptNetworkCall, page }) => {
        const birthdate = tag === CONSENT_REQUIRED_TAG ? teenBirthdate() : '1990-06-15'
        const guestPieces = await prepareFirstRunLook(page, birthdate)
        const email = realCommunityEmail()
        const { userId } = await createFirstRunAccount(
          page,
          interceptNetworkCall,
          birthdate,
          email
        )

        if (tag === CONSENT_REQUIRED_TAG) {
          await expect(page.getByLabel('Guardian email')).toBeVisible()
        }
        if (member === 'approved teen') {
          await page.getByLabel('Guardian email').fill(realCommunityEmail())
          await page.getByRole('button', { name: 'Send guardian invite' }).click()
          const invitation = page.getByTestId('guardian-invite-link')
          await expect(invitation).toContainText('/guardian/accept?token=')
          const link = await invitation.innerText()
          const token = new URL(link, page.url()).searchParams.get('token')
          expect(token).toBeTruthy()
          const accepted = await apiRequest({
            method: 'POST',
            baseUrl: 'http://127.0.0.1:4077',
            path: '/api/v1/guardian/accept',
            body: { token },
          })
          expect(accepted.status).toBe(200)
        }

        // The owned real-session harness issues an actual OTP for this synthetic identity.
        const account = await createRealCommunityAuthAccount({
          email,
          appUserId: userId,
          mapping: 'email',
          label: `first-run-${decision}`,
        })
        await signInFromPreview(page, account)
        const proposed = page.getByTestId('guest-preview-review-proposed')
        await expect(proposed).toContainText('I tend to feel cold')
        await expect(proposed).toContainText('Cozy')
        await expect(proposed).toContainText('Colorful')

        const where = { user_id: userId }
        const savedLooks = () =>
          prisma.savedLook.findMany({ where, select: { id: true, comfort: true } })
        const style = () => prisma.styleProfile.findUnique({ where })
        const comfort = () => prisma.comfortPreferences.findUnique({ where })
        expect(await savedLooks()).toEqual([])
        expect(await style()).toBeNull()
        expect(await comfort()).toMatchObject({ runs_cold_warm: 'neutral' })

        await page.getByTestId(`guest-preview-review-${decision}`).click()
        if (decision === 'cancel') {
          await expect(page).toHaveURL(/\/$/)
          await page.goto('/looks?segment=saved')
          await expect(page.getByTestId('looks-filter-empty')).toBeVisible()
          expect(await savedLooks()).toEqual([])
        } else {
          await expect(page).toHaveURL(/\/looks\?segment=saved$/)
          await expect(page.getByTestId('status-feedback-bar')).toContainText(
            'Saved to your looks.'
          )
          const [look, ...extra] = await savedLooks()
          expect(look).toBeDefined()
          expect(look?.comfort).toBeNull()
          expect(extra).toEqual([])
          const card = page.getByTestId(`saved-look-card-${look!.id}`)
          // The Saved feed settles the capsule read before it shows the card.
          await expect(card).toBeVisible()
          await page.reload()
          await card.click()
          const detail = page.getByTestId('saved-look-detail')
          await expect(detail).toBeVisible()
          const pieces = detail.locator('[data-slot-item-id]')
          await expect(pieces).toHaveCount(guestPieces.length)
          expect(
            await pieces.evaluateAll((items) =>
              items.map((item) => item.getAttribute('data-slot-item-id'))
            )
          ).toEqual(guestPieces)
        }

        if (decision === 'use') {
          expect(await style()).toMatchObject({
            mood: 'cozy',
            palette: 'colorful',
            texture: null,
          })
          expect(await comfort()).toMatchObject({ runs_cold_warm: 'cold' })
        } else {
          expect(await style()).toBeNull()
          expect(await comfort()).toMatchObject({ runs_cold_warm: 'neutral' })
        }

        if (tag === CONSENT_REQUIRED_TAG) {
          const profile = await prisma.userProfile.findUnique({ where })
          expect(profile?.preferences).toMatchObject({
            compliance: {
              accountStatus:
                member === 'approved teen' ? 'active' : 'pending_guardian_consent',
            },
          })
        }
      }
    )
  }
})
