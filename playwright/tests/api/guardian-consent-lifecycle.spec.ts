import type { TestInfo } from '@playwright/test'
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
  buildUniqueId,
  resolveApiBaseUrl,
} from '../../support/helpers/api-test'

type SignupPayload = {
  email: string
  birthdate: string
}

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

type ApiResponsePayload = {
  status: number
  body: unknown
}

type ApiRequestFixture = (params: {
  method: 'GET' | 'POST'
  path: string
  baseUrl: string
  body?: unknown
  headers?: Record<string, string>
  retryConfig: { maxRetries: number }
}) => Promise<ApiResponsePayload>

type RequestJsonParams = {
  method: 'GET' | 'POST'
  path: string
  baseUrl: string
  body?: unknown
  headers?: Record<string, string>
}

function isProdEnvironment(testInfo: TestInfo): boolean {
  const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
  return metadata.environment === 'prod'
}

function isLocalEnvironment(testInfo: TestInfo): boolean {
  const metadata = (testInfo.project.metadata ?? {}) as Record<string, string>
  return metadata.environment === 'local'
}

function allowRemoteGuardianWritePaths(): boolean {
  return process.env.PW_ALLOW_REMOTE_GUARDIAN_WRITE_PATHS === 'true'
}

function createBirthdate(yearsAgo: number): string {
  const today = new Date()
  const birthdate = new Date(
    Date.UTC(
      today.getUTCFullYear() - yearsAgo,
      today.getUTCMonth(),
      today.getUTCDate(),
      12
    )
  )

  return birthdate.toISOString().slice(0, 10)
}

function createTeenSignupPayload(testInfo: TestInfo): SignupPayload {
  return {
    email: `${buildUniqueId('guardian-lifecycle-teen', testInfo)}@example.com`,
    birthdate: createBirthdate(15),
  }
}

function createGuardianEmail(testInfo: TestInfo): string {
  return `${buildUniqueId('guardian-lifecycle-guardian', testInfo)}@example.com`
}

function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return ''
  }

  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

function extractInvitationToken(invitationLink: string): string {
  const token = new URL(invitationLink).searchParams.get('token')
  if (!token) {
    throw new Error('Guardian invitation link did not contain a token')
  }

  return token
}

async function requestJson(
  apiRequest: unknown,
  params: RequestJsonParams
): Promise<ApiResponsePayload> {
  const request = apiRequest as ApiRequestFixture
  return request({
    ...params,
    retryConfig: { maxRetries: 0 },
  })
}

test.describe('Guardian consent lifecycle API contracts', () => {
  test.beforeEach(({}, testInfo) => {
    // This journey creates users, invitations, consent links, queue records,
    // and audit rows. Keep it local by default until remote preview environments
    // guarantee isolated, fully migrated databases for write-path E2E coverage.
    test.skip(
      (!isLocalEnvironment(testInfo) && !allowRemoteGuardianWritePaths()) ||
        isProdEnvironment(testInfo),
      'Skipping guardian consent lifecycle write-path contract tests outside local unless PW_ALLOW_REMOTE_GUARDIAN_WRITE_PATHS=true.'
    )
  })

  test('[P0] grants consent, restores teen access, and blocks the teen again after revoke', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const teenSignupPayload = createTeenSignupPayload(testInfo)

    await log.step('Arrange: create a teen account that requires guardian consent.')
    const signupResponse = await requestJson(apiRequest, {
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
      guardianEmail: createGuardianEmail(testInfo),
      consentLevel: 'full_access',
    }

    await log.step('Act: create a guardian invitation for the teen account.')
    const invitationResponse = await requestJson(apiRequest, {
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
    const acceptResponse = await requestJson(apiRequest, {
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
    const grantedTeenProfileResponse = await requestJson(apiRequest, {
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
    const revokeResponse = await requestJson(apiRequest, {
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
    const revokedTeenProfileResponse = await requestJson(apiRequest, {
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
