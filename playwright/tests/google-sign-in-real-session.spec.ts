// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 E lane: Google sign-in on the real local stack through the Keycloak stand-in (D10).
// The app asks Supabase for `provider=google`; the stand-in helper records that request, swaps the
// provider for the harness mock and picks the identity. GoTrue's authorize, callback, PKCE exchange
// and identity linking, the app's callback page, the finish step, the federated API and the
// isolated database are all real. Runs only in the owned real-session lane.
// E-NEW-ADULT, E-TEEN, E-UNDER13, E-LINK, E-CANCEL, E-RESUME, E-RESUME-NEW-TAB, E-CHOOSER-CANCELLED,
// E-CONV-GOOGLE.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
  localAuthUsersByEmail,
  realCommunityEmail,
  realSessionSkipReason,
  recordStandInIdentity,
  signupRealCommunityAppUser,
} from '../support/helpers/community-real-session'
import { armGoogleStandIn } from '../support/helpers/google-stand-in'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

// A Google identity without an account answers 401 on the profile check, a refused finish
// answers 403, and signing out a deleted Auth user answers 403: those responses are what these
// tests assert on, so the automatic network error monitor is off for them (the identity spec's
// precedent). Every outcome is asserted on the page and in both databases instead.
const EXPECTED_AUTH_ERRORS = { annotation: [{ type: 'skipNetworkMonitoring' }] }

const WEB = 'http://127.0.0.1:3077'
const prisma = new PrismaClient()
test.afterAll(() => prisma.$disconnect())

/** A birthdate `age` years and half a year ago, so the age holds whatever the date. */
function birthdate(age: number) {
  const now = new Date()
  const birthday = Date.UTC(
    now.getUTCFullYear() - age,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return new Date(birthday - 182 * 86_400_000).toISOString().slice(0, 10)
}

function standInPerson(label: string) {
  const email = realCommunityEmail()
  recordStandInIdentity(email, label)
  return {
    sub: `stand-in-${randomUUID()}`,
    email,
    email_verified: true,
    name: 'Stand In',
  }
}

async function continueWithGoogle(page: Page, door: string) {
  await page.goto(door)
  await page.getByTestId('google-sign-in').click()
}

/** The Supabase Auth user id the browser session holds, read from the app's own storage. */
async function sessionAuthUserId(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('couturecast.auth-session')
    return raw ? ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null) : null
  })
}

const accounts = (email: string) =>
  prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { profile: true },
  })

test(
  'E-NEW-ADULT: a new adult finishes with a birthdate and lands signed in',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const person = standInPerson('google-new-adult')
    const { authorizes } = await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signin')

    await expect(page).toHaveURL(`${WEB}/signup/finish`)
    // What the app asked Supabase for, before the stand-in swapped the provider (D1, D5).
    expect(authorizes).toEqual([
      {
        provider: 'google',
        prompt: 'select_account',
        redirectTo: `${WEB}/auth/callback`,
        codeChallengeMethod: 's256',
        hasCodeChallenge: true,
      },
    ])
    await expect(
      page.getByRole('heading', { name: 'Finish creating your account' })
    ).toBeVisible()
    await expect(page.getByTestId('finish-signup-email')).toHaveText(person.email)
    // Nothing about the callback is left in history once the finish step shows (D5, TEA-12).
    expect(new URL(page.url()).search).toBe('')

    await page.getByLabel('Birthdate').fill(birthdate(30))
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(`${WEB}/`)

    const [account, ...extra] = await accounts(person.email)
    expect(extra).toEqual([])
    expect(account!.profile!.preferences).toEqual({
      compliance: { accountStatus: 'active', guardianConsentRequired: false },
    })
    expect(account!.profile!.display_name).toBeNull()
    const authUsers = await localAuthUsersByEmail(person.email)
    expect(authUsers.map((user) => user.providers)).toEqual([['keycloak']])
  }
)

test(
  'E-TEEN: a 14-year-old is pending guardian consent and sees the invite step',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const person = standInPerson('google-new-teen')
    await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signup')
    await expect(page).toHaveURL(`${WEB}/signup/finish?door=signup`)
    await page.getByLabel('Birthdate').fill(birthdate(14))
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByTestId('finish-signup-outcome')).toBeVisible()
    await expect(page.getByLabel('Guardian email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send guardian invite' })).toBeVisible()
    const [account, ...extra] = await accounts(person.email)
    expect(extra).toEqual([])
    expect(account!.profile!.preferences).toEqual({
      compliance: {
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
  }
)

test(
  'E-UNDER13: a child is refused, the Supabase identity is deleted and nothing is stored',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const person = standInPerson('google-new-child')
    await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signup')
    await expect(page).toHaveURL(`${WEB}/signup/finish?door=signup`)
    const authUserId = await sessionAuthUserId(page)
    expect(authUserId).not.toBeNull()

    await page.getByLabel('Birthdate').fill(birthdate(12))
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('finish-signup-outcome')).toBeVisible()

    expect(await accounts(person.email)).toEqual([])
    expect(await localAuthUsersByEmail(person.email)).toEqual([])
    expect(await sessionAuthUserId(page)).toBeNull()
  }
)

test('E-LINK: an email-code member continues with Google into the same account', async ({
  page,
  apiRequest,
}) => {
  const email = realCommunityEmail()
  const appUserId = await signupRealCommunityAppUser(apiRequest, email)
  const member = await createRealCommunityAuthAccount({
    email,
    appUserId,
    mapping: 'email',
    label: 'google-link-email-member',
  })
  const before = await accounts(email)

  await armGoogleStandIn(page, {
    sub: `stand-in-${randomUUID()}`,
    email,
    email_verified: true,
    name: 'Linked Member',
  })
  await continueWithGoogle(page, '/signin')
  await expect(page).toHaveURL(`${WEB}/`)

  expect(await accounts(email)).toEqual(before)
  const authUsers = await localAuthUsersByEmail(email)
  expect(authUsers).toEqual([{ id: member.authUserId, providers: ['email', 'keycloak'] }])
})

test(
  'E-CANCEL: cancelling the finish step deletes the Supabase identity',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const person = standInPerson('google-cancel')
    await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signin')
    await expect(page).toHaveURL(`${WEB}/signup/finish`)
    expect(await localAuthUsersByEmail(person.email)).toHaveLength(1)

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(`${WEB}/signin`)
    expect(await localAuthUsersByEmail(person.email)).toEqual([])
    expect(await accounts(person.email)).toEqual([])
  }
)

test(
  'E-RESUME: a session without an account always returns to the finish step',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const person = standInPerson('google-resume')
    await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signin')
    await expect(page).toHaveURL(`${WEB}/signup/finish`)

    for (const path of ['/', '/wardrobe', '/settings']) {
      await page.goto(path)
      await expect(page).toHaveURL(`${WEB}/signup/finish`)
    }
    await page.reload()
    await expect(page.getByTestId('finish-signup-email')).toHaveText(person.email)
    expect(await accounts(person.email)).toEqual([])
  }
)

// D3: the finish marker must not be the only way back. A new tab starts with empty
// sessionStorage, while the Google session in localStorage survives the closed tab.
test(
  'E-RESUME-NEW-TAB: a closed tab, then a new tab, resumes at the finish step',
  EXPECTED_AUTH_ERRORS,
  async ({ page, context }) => {
    const person = standInPerson('google-resume-new-tab')
    await armGoogleStandIn(page, person)
    await continueWithGoogle(page, '/signin')
    await expect(page).toHaveURL(`${WEB}/signup/finish`)
    await page.close()

    const tab = await context.newPage()
    await tab.goto(`${WEB}/wardrobe`)
    await expect(tab).toHaveURL(`${WEB}/signup/finish`)
    await expect(tab.getByTestId('finish-signup-email')).toHaveText(person.email)
    expect(await accounts(person.email)).toEqual([])
  }
)

test('E-CHOOSER-CANCELLED: a closed chooser returns to the door with no session', async ({
  page,
}) => {
  const person = { ...standInPerson('google-denied'), deny: true }
  await armGoogleStandIn(page, person)
  await continueWithGoogle(page, '/signin')
  await expect(page).toHaveURL(`${WEB}/signin?google=cancelled`)
  await expect(page.getByTestId('google-sign-in-status')).toBeVisible()
  expect(await sessionAuthUserId(page)).toBeNull()
  expect(await localAuthUsersByEmail(person.email)).toEqual([])
  // The email form still works.
  await expect(page.locator('input[name="email"]')).toBeEditable()
})

const choose = (page: Page, testId: string) =>
  page.locator(`label:has([data-testid="${testId}"])`).click()

test(
  'E-CONV-GOOGLE: a guest proposal reaches the review through Google and a new account',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    await page.goto('/preview')
    await page.getByTestId('guest-preview-birthdate').fill(birthdate(30))
    await page.getByTestId('guest-preview-gate-submit').click()
    await choose(page, 'guest-preview-thermal-cold')
    await choose(page, 'guest-preview-wind-low')
    await choose(page, 'guest-preview-rain-high')
    await page.getByTestId('guest-preview-create-account').click()
    await expect(page).toHaveURL(`${WEB}/signup?from=preview`)

    const person = standInPerson('google-guest-conversion')
    const { authorizes } = await armGoogleStandIn(page, person)
    await page.getByTestId('google-sign-in').click()
    await expect(page).toHaveURL(`${WEB}/signup/finish?door=signup&from=preview`)
    expect(authorizes.map((request) => request.redirectTo)).toEqual([
      `${WEB}/auth/callback?door=signup&from=preview`,
    ])

    await page.getByLabel('Birthdate').fill(birthdate(30))
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(`${WEB}/preview/continue`)
    await expect(page.getByTestId('guest-preview-review-proposed')).toContainText(
      'I tend to feel cold'
    )
    await page.getByTestId('guest-preview-review-use').click()
    await expect(page.getByTestId('guest-preview-review-result')).toHaveText(
      'Your comfort preferences are saved.'
    )
    const [account] = await accounts(person.email)
    const row = await prisma.comfortPreferences.findUnique({
      where: { user_id: account!.id },
    })
    expect({
      runs: row?.runs_cold_warm,
      wind: row?.wind_tolerance,
      rain: row?.precip_preparedness,
    }).toEqual({ runs: 'cold', wind: 'low', rain: 'high' })
  }
)
