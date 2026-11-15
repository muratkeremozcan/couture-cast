// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 E-CONV-REAL-STACK (web): a guest signs up from the preview, signs in through
// the real local OTP, and applies the preview's comfort settings through the verified API.
// Runs only in the owned real-session lane (npm run test:pw-real-session).
import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
} from '../support/helpers/community-real-session'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

const choose = (page: Page, testId: string) =>
  page.locator(`label:has([data-testid="${testId}"])`).click()

test('6.16 guest preview carries comfort settings into a real verified account', async ({
  page,
}) => {
  const prisma = new PrismaClient()
  try {
    await page.goto('/preview')
    await page.getByTestId('guest-preview-birthdate').fill('1990-06-15')
    await page.getByTestId('guest-preview-gate-submit').click()
    await choose(page, 'guest-preview-thermal-cold')
    await choose(page, 'guest-preview-wind-low')
    await choose(page, 'guest-preview-rain-high')

    await page.getByTestId('guest-preview-create-account').click()
    await expect(page).toHaveURL(/\/signup\?from=preview$/)
    const email = realCommunityEmail()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Birthdate').fill('1990-06-15')
    const signup = page.waitForResponse('**/api/v1/auth/signup')
    await page.getByRole('button', { name: 'Create account' }).click()
    const { userId } = (await (await signup).json()) as { userId: string }
    // The signup response authenticates nobody: no comfort row exists yet.
    expect(
      await prisma.comfortPreferences.findUnique({ where: { user_id: userId } })
    ).toBeNull()

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
    const row = await prisma.comfortPreferences.findUnique({ where: { user_id: userId } })
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
    await expect(page).toHaveURL(/\/wardrobe\/onboarding$/)
  } finally {
    await prisma.$disconnect()
  }
})
