// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 E-CONV-REAL-STACK (web): a guest signs up from the preview, signs in through
// the real local OTP, and applies the preview's comfort settings through the verified API.
// Runs only in the owned real-session lane (npm run test:pw-real-session).
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
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
      await choose(page, 'guest-preview-thermal-cold')
      await choose(page, 'guest-preview-wind-low')
      await choose(page, 'guest-preview-rain-high')

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
      await page.getByTestId('signup-sign-in-to-continue').click()
      await expect(page).toHaveURL(/\/signin\?from=preview$/)
      await page.locator('input[name="email"]').fill(email)
      await page.locator('button[type="submit"]').click()
      await page.locator('input[name="code"]').waitFor({ state: 'visible' })
      await page.locator('input[name="code"]').fill(readGeneratedCommunityCode(account))
      await page.locator('button[type="submit"]').click()

      await expect(page).toHaveURL(/\/preview\/continue$/)
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
      const capture = page.getByRole('dialog', { name: 'Garment Capture Flow' })
      await expect(capture.getByRole('button', { name: 'Choose File' })).toBeVisible()
      expect(await cameraRequests(page)).toBe(0)

      await capture.getByLabel('Garment image file').setInputFiles(garmentFixture)
      await capture.getByRole('button', { name: 'Use This Image' }).click()
      await expect(
        capture.getByRole('heading', { name: 'Garment Upload Complete!' })
      ).toBeVisible()
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
        page.getByRole('link', { name: /back to today.s outfit/i })
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
    const capture = page.getByRole('dialog', { name: 'Garment Capture Flow' })
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
