import {
  forbiddenHttpErrorSchema,
  guardianConsentRevokeResponseSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationResponseSchema,
  signupResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import { test, expect } from '../support/fixtures/merged-fixtures'
import { installApiProxy, proxyApiCall } from '../support/helpers/browser-api-proxy'
import {
  authHeaders,
  createGuardianEmail,
  createTeenSignupPayload,
  extractInvitationToken,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from '../support/helpers/api-test'
import {
  cleanupGuardianConsentTestData,
  createAcceptedGuardianConsent,
  type GuardianConsentCleanupTarget,
} from '../support/helpers/guardian-consent'
import { log } from '@seontechnologies/playwright-utils/log'

test.describe('Guardian consent browser smoke', () => {
  let cleanupTargets: GuardianConsentCleanupTarget[] = []

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Skipping guardian consent write-path browser smoke tests outside local runs until cleanup isolation is available for remote environments.'
    )
  })

  test.afterEach(async () => {
    await cleanupGuardianConsentTestData(cleanupTargets)
    cleanupTargets = []
  })

  test('[P0] teen signup shows guardian invite UI and guardian accept records consent', async ({
    interceptNetworkCall,
    page,
  }, testInfo) => {
    const teenSignupPayload = createTeenSignupPayload(testInfo, 'guardian-ui-teen')
    const guardianEmail = createGuardianEmail(testInfo, 'guardian-ui-guardian')
    let signupUserId = ''
    let invitationLink = ''

    cleanupTargets.push({ guardianEmail, teenEmail: teenSignupPayload.email })

    await log.step('Install browser API proxy routes')
    await installApiProxy(page, testInfo)

    await log.step('Submit teen signup and assert guardian invitation UI')
    await page.goto('/signup')
    await page.getByLabel('Email').fill(teenSignupPayload.email)
    await page.getByLabel('Birthdate').fill(teenSignupPayload.birthdate)
    await expect(page.getByTestId('signup-inline-message')).toHaveText(
      'Guardian consent required'
    )

    const signupCallPromise = proxyApiCall({
      interceptNetworkCall,
      method: 'POST',
      page,
      path: '/api/v1/auth/signup',
    })
    await page.getByRole('button', { name: 'Create account' }).click()
    const signupCall = await signupCallPromise
    expect(signupCall.status).toBe(201)
    const signupBody = signupResponseSchema.parse(signupCall.responseJson)
    signupUserId = signupBody.userId
    cleanupTargets.push({ teenId: signupUserId })

    await expect(page.getByTestId('signup-success-message')).toContainText(
      'Guardian consent is required'
    )
    await expect(page.getByRole('heading', { name: 'Guardian invitation' })).toBeVisible()

    await log.step('Send guardian invitation from the signup UI')
    await page.getByLabel('Guardian email').fill(guardianEmail)
    await page.getByLabel('Consent level').selectOption('full_access')

    const invitationCallPromise = proxyApiCall({
      interceptNetworkCall,
      method: 'POST',
      page,
      path: '/api/v1/guardian/invitations',
    })
    await page.getByRole('button', { name: 'Send guardian invite' }).click()
    const invitationCall = await invitationCallPromise
    expect(invitationCall.status).toBe(201)
    const invitationBody = guardianInvitationResponseSchema.parse(
      invitationCall.responseJson
    )
    invitationLink = invitationBody.invitationLink

    expect(invitationBody.teenId).toBe(signupUserId)
    expect(invitationBody.guardianEmail).toBe(guardianEmail)
    await expect(page.getByTestId('guardian-invite-link')).toContainText(
      '/guardian/accept?token='
    )

    await log.step('Accept guardian invitation and assert consent feedback')
    const token = extractInvitationToken(invitationLink)
    await page.goto(`/guardian/accept?token=${encodeURIComponent(token)}`)

    const acceptCallPromise = proxyApiCall({
      interceptNetworkCall,
      method: 'POST',
      page,
      path: '/api/v1/guardian/accept',
    })
    await page.getByRole('button', { name: 'Accept invitation' }).click()
    const acceptCall = await acceptCallPromise
    expect(acceptCall.status).toBe(200)
    const acceptBody = guardianInvitationAcceptResponseSchema.parse(
      acceptCall.responseJson
    )
    cleanupTargets.push({ guardianId: acceptBody.guardianId })

    expect(acceptBody.teenId).toBe(signupUserId)
    expect(acceptBody.guardianEmail).toBe(guardianEmail)
    await expect(page.getByTestId('guardian-accept-success')).toContainText(
      `Consent recorded for ${teenSignupPayload.email}.`
    )
  })

  test('[P0] guardian dashboard shows linked teen and revoke feedback', async ({
    apiRequest,
    interceptNetworkCall,
    page,
  }, testInfo) => {
    cleanupTargets.push({
      guardianEmail: createGuardianEmail(testInfo, 'guardian-ui-dashboard'),
      teenEmail: createTeenSignupPayload(testInfo, 'guardian-ui-dashboard-teen').email,
    })

    await log.step('Create accepted guardian consent setup')
    const consent = await createAcceptedGuardianConsent(apiRequest, testInfo)
    cleanupTargets.push(consent)
    let linkedTeen = page.getByTestId(`linked-teen-${consent.teenId}`)

    await log.step('Install browser API proxy routes')
    await installApiProxy(page, testInfo)

    await log.step('Open dashboard and assert linked teen visibility')
    const profileCallPromise = proxyApiCall({
      interceptNetworkCall,
      method: 'GET',
      page,
      path: '/api/v1/user/profile',
      auth: {
        role: 'guardian',
        userId: consent.guardianId,
      },
    })
    await page.goto('/guardian/dashboard')
    const profileCall = await profileCallPromise
    expect(profileCall.status).toBe(200)
    const profileBody = userProfileResponseSchema.parse(profileCall.responseJson)
    expect(profileBody.linkedTeens).toContainEqual(
      expect.objectContaining({
        teenId: consent.teenId,
        status: 'granted',
      })
    )

    linkedTeen = page.getByTestId(`linked-teen-${consent.teenId}`)
    await expect(linkedTeen).toContainText(consent.teenId)
    await expect(linkedTeen).toContainText('granted')

    await log.step('Revoke consent in the dashboard and assert UI feedback')
    const revokeCallPromise = proxyApiCall({
      interceptNetworkCall,
      method: 'POST',
      page,
      path: '/api/v1/guardian/revoke',
      auth: {
        role: 'guardian',
        userId: consent.guardianId,
      },
    })
    await page
      .getByRole('button', { name: `Revoke consent for ${consent.teenId}` })
      .click()
    const revokeCall = await revokeCallPromise
    expect(revokeCall.status).toBe(200)
    const revokeBody = guardianConsentRevokeResponseSchema.parse(revokeCall.responseJson)

    expect(revokeBody.guardianId).toBe(consent.guardianId)
    expect(revokeBody.teenId).toBe(consent.teenId)
    expect(revokeBody.sessionInvalidated).toBe(true)
    await expect(page.getByTestId('guardian-dashboard-message')).toContainText(
      `Consent revoked for ${consent.teenId}`
    )
    await expect(page.getByTestId('guardian-dashboard-message')).toContainText(
      'Teen session invalidated: yes'
    )
    await expect(linkedTeen).toContainText('revoked')

    await log.step('Assert revoked teen is blocked at the API boundary')
    const revokedTeenProfileResponse = await apiRequest({
      method: 'GET',
      path: '/api/v1/user/profile',
      baseUrl: resolveApiBaseUrl(testInfo),
      headers: authHeaders(consent.teenId, 'teen'),
      retryConfig: { maxRetries: 0 },
    })

    expect(revokedTeenProfileResponse.status).toBe(403)
    const revokedTeenProfileBody = forbiddenHttpErrorSchema.parse(
      revokedTeenProfileResponse.body
    )
    expect(revokedTeenProfileBody.message).toContain(
      'Guardian consent required before continuing'
    )
  })
})
