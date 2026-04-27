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
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from '../../support/helpers/api-test'

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

test.describe('Guardian consent lifecycle API contracts', () => {
  test.beforeEach(({}, testInfo) => {
    // This journey creates users, invitations, consent links, queue records,
    // and audit rows. Keep it local-only until preview deploy-path parity is
    // proven for write-path schema/env behavior.
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Skipping guardian consent lifecycle write-path contract tests outside local runs.'
    )
  })

  test('[P0] grants consent, restores teen access, and blocks the teen again after revoke', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const teenSignupPayload = createTeenSignupPayload(testInfo, 'guardian-lifecycle-teen')

    await log.step('Arrange: create a teen account that requires guardian consent.')
    const signupResponse = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl,
      body: teenSignupPayload,
    })

    expect(signupResponse.status).toBe(201)
    await validateSchema(signupResponseSchema, signupResponse.body, {
      shape: {
        age: 15,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
    const signupBody = signupResponseSchema.parse(signupResponse.body)

    const invitationPayload: GuardianInvitationPayload = {
      teenId: signupBody.userId,
      guardianEmail: createGuardianEmail(testInfo, 'guardian-lifecycle-guardian'),
      consentLevel: 'full_access',
    }

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
    const invitationBody = guardianInvitationResponseSchema.parse(invitationResponse.body)

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
})
