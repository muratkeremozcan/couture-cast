import {
  forbiddenHttpErrorSchema,
  guardianConsentRevokeResponseSchema,
  guardianInvitationAcceptResponseSchema,
  guardianInvitationResponseSchema,
  signupResponseSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  authHeaders,
  createGuardianEmail,
  createTeenSignupPayload,
  extractErrorMessage,
  extractInvitationToken,
  isProdEnvironment,
  resolveApiBaseUrl,
} from '../../support/helpers/api-test'
import {
  cleanupGuardianConsentTestData,
  type GuardianConsentCleanupTarget,
} from '../../support/helpers/guardian-consent'
import {
  CONSENT_LANE_ONLY,
  CONSENT_OFF_ONLY,
  CONSENT_REQUIRED_TAG,
  e2eConsentPolicy,
} from '../../support/helpers/guardian-consent-policy'

type GuardianInvitationPayload = {
  teenId: string
  guardianEmail: string
  consentLevel: 'read_only' | 'full_access'
}

type GuardianAcceptPayload = {
  token: string
}

type GuardianRevokePayload = {
  guardianId: string
  teenId: string
}

test.describe(
  'Guardian consent lifecycle API contracts',
  { tag: CONSENT_REQUIRED_TAG },
  () => {
    let cleanupTargets: GuardianConsentCleanupTarget[] = []

    test.beforeEach(({}, testInfo) => {
      // This journey creates users, invitations, consent links, queue records,
      // and audit rows. Keep production blocked unless a dedicated seeded write
      // path exists.
      test.skip(
        isProdEnvironment(testInfo),
        'Skipping guardian consent lifecycle write-path contract tests in production.'
      )
      test.skip(e2eConsentPolicy() !== 'required_13_15', CONSENT_LANE_ONLY)
    })

    test.afterEach(async () => {
      await cleanupGuardianConsentTestData(cleanupTargets)
      cleanupTargets = []
    })

    test('[P0] grants consent, restores teen access, and blocks the teen again after revoke', async ({
      apiRequest,
      validateSchema,
    }, testInfo) => {
      const baseUrl = resolveApiBaseUrl(testInfo)
      const teenSignupPayload = createTeenSignupPayload(
        testInfo,
        'guardian-lifecycle-teen'
      )

      await log.step('Arrange: create a teen account that requires guardian consent.')
      const signupResponse = await apiRequest({
        method: 'POST',
        path: '/api/v1/auth/signup',
        baseUrl,
        body: teenSignupPayload,
      })

      expect(signupResponse.status).toBe(201)
      const signupBody = signupResponseSchema.parse(signupResponse.body)
      cleanupTargets.push({
        teenEmail: teenSignupPayload.email,
        teenId: signupBody.userId,
      })
      await validateSchema(signupResponseSchema, signupResponse.body, {
        shape: {
          age: 15,
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
        },
      })

      const invitationPayload: GuardianInvitationPayload = {
        teenId: signupBody.userId,
        guardianEmail: createGuardianEmail(testInfo, 'guardian-lifecycle-guardian'),
        consentLevel: 'full_access',
      }
      cleanupTargets.push({ guardianEmail: invitationPayload.guardianEmail })

      await log.step('Act: create a guardian invitation for the teen account.')
      const invitationResponse = await apiRequest({
        method: 'POST',
        path: '/api/v1/guardian/invitations',
        baseUrl,
        body: invitationPayload,
      })

      expect(invitationResponse.status).toBe(201)
      await validateSchema(guardianInvitationResponseSchema, invitationResponse.body, {
        shape: {
          teenId: signupBody.userId,
          guardianEmail: invitationPayload.guardianEmail,
          consentLevel: 'full_access',
          deliveryQueued: true,
        },
      })
      const invitationBody = guardianInvitationResponseSchema.parse(
        invitationResponse.body
      )

      const acceptPayload: GuardianAcceptPayload = {
        token: extractInvitationToken(invitationBody.invitationLink),
      }

      await log.step('Act: accept the guardian invitation from the generated token.')
      const acceptResponse = await apiRequest({
        method: 'POST',
        path: '/api/v1/guardian/accept',
        baseUrl,
        body: acceptPayload,
      })

      expect(acceptResponse.status).toBe(200)
      await validateSchema(guardianInvitationAcceptResponseSchema, acceptResponse.body, {
        shape: {
          teenId: signupBody.userId,
          guardianEmail: invitationPayload.guardianEmail,
          consentLevel: 'full_access',
        },
      })
      const acceptBody = guardianInvitationAcceptResponseSchema.parse(acceptResponse.body)
      cleanupTargets.push({ guardianId: acceptBody.guardianId })

      await log.step(
        'Assert: teen profile access is restored once guardian consent has been granted.'
      )
      const grantedTeenProfileResponse = await apiRequest({
        method: 'GET',
        path: '/api/v1/user/profile',
        baseUrl,
        headers: authHeaders(signupBody.userId, 'teen'),
      })

      expect(grantedTeenProfileResponse.status).toBe(200)
      await validateSchema(userProfileResponseSchema, grantedTeenProfileResponse.body, {
        shape: {
          user: {
            id: signupBody.userId,
            email: teenSignupPayload.email,
            role: 'teen',
          },
        },
      })
      const grantedTeenProfile = userProfileResponseSchema.parse(
        grantedTeenProfileResponse.body
      )
      expect(grantedTeenProfile.linkedGuardians).toContainEqual(
        expect.objectContaining({
          guardianId: acceptBody.guardianId,
          status: 'granted',
        })
      )

      const revokePayload: GuardianRevokePayload = {
        guardianId: acceptBody.guardianId,
        teenId: signupBody.userId,
      }

      await log.step('Act: revoke guardian consent as the linked guardian.')
      const revokeResponse = await apiRequest({
        method: 'POST',
        path: '/api/v1/guardian/revoke',
        baseUrl,
        body: revokePayload,
        headers: authHeaders(acceptBody.guardianId, 'guardian'),
      })

      expect(revokeResponse.status).toBe(200)
      await validateSchema(guardianConsentRevokeResponseSchema, revokeResponse.body, {
        shape: {
          guardianId: acceptBody.guardianId,
          teenId: signupBody.userId,
          remainingActiveGuardians: 0,
          sessionInvalidated: true,
          notificationQueued: true,
        },
      })
      const revokeBody = guardianConsentRevokeResponseSchema.parse(revokeResponse.body)
      expect(revokeBody.guardianId).toBe(acceptBody.guardianId)

      await log.step(
        'Assert: teen profile access is blocked again after the last guardian revokes.'
      )
      const revokedTeenProfileResponse = await apiRequest({
        method: 'GET',
        path: '/api/v1/user/profile',
        baseUrl,
        headers: authHeaders(signupBody.userId, 'teen'),
      })

      expect(revokedTeenProfileResponse.status).toBe(403)
      await validateSchema(forbiddenHttpErrorSchema, revokedTeenProfileResponse.body, {
        shape: {
          statusCode: 403,
          error: 'Forbidden',
        },
      })
      expect(extractErrorMessage(revokedTeenProfileResponse.body)).toContain(
        'Guardian consent required before continuing'
      )
    })
  }
)

// Owner ruling 2026-11-16: with guardian consent off a teen is active at signup, reads their own
// profile, and the invitation endpoint refuses with 409 before writing anything.
test.describe('Guardian consent off: a teen needs no guardian', () => {
  let cleanupTargets: GuardianConsentCleanupTarget[] = []

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isProdEnvironment(testInfo),
      'Skipping signup write-path tests in production.'
    )
    test.skip(e2eConsentPolicy() === 'required_13_15', CONSENT_OFF_ONLY)
  })

  test.afterEach(async () => {
    await cleanupGuardianConsentTestData(cleanupTargets)
    cleanupTargets = []
  })

  test('[P0] a 14-year-old is active, reads their profile, and no invitation is minted', async ({
    apiRequest,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const payload = createTeenSignupPayload(testInfo, 'guardian-off-teen', 14)
    const signup = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: payload,
    })
    expect(signup.status).toBe(201)
    const teen = signupResponseSchema.parse(signup.body)
    cleanupTargets.push({ teenEmail: payload.email, teenId: teen.userId })
    expect(teen).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
    })

    const profile = await apiRequest({
      method: 'GET',
      path: '/api/v1/user/profile',
      baseUrl,
      headers: authHeaders(teen.userId, 'teen'),
    })
    expect(profile.status).toBe(200)
    expect(userProfileResponseSchema.parse(profile.body).user.id).toBe(teen.userId)

    const invitation = await apiRequest({
      method: 'POST',
      path: '/api/v1/guardian/invitations',
      baseUrl,
      body: {
        teenId: teen.userId,
        guardianEmail: createGuardianEmail(testInfo, 'guardian-off'),
        consentLevel: 'read_only',
      } satisfies GuardianInvitationPayload,
    })
    expect(invitation.status).toBe(409)
    expect(invitation.body).toEqual({
      statusCode: 409,
      code: 'guardian_consent_off',
      message: 'Guardian consent is not used.',
    })
  })
})
