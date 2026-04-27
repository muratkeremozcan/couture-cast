import type { TestInfo } from '@playwright/test'
import {
  forbiddenHttpErrorSchema,
  trackedResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'
import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  extractErrorMessage,
  isProdEnvironment,
  resolveApiBaseUrl,
} from '../../support/helpers/api-test'

type GuardianConsentPayload = {
  guardianId: string
  teenId: string
  consentLevel: string
  timestamp: string
}

type ModerationActionPayload = {
  moderatorId: string
  targetId: string
  action: string
  reason: string
  contentType: string
  timestamp: string
}

type ContractPayload = GuardianConsentPayload | ModerationActionPayload

type EndpointScenario = {
  path: string
  actorRole: 'guardian' | 'moderator'
  wrongRole: 'guardian' | 'moderator'
  buildPayload: (args: { actorId: string; targetId: string }) => ContractPayload
  getActorId: (payload: ContractPayload) => string
  withMismatchedActorId: (payload: ContractPayload, actorId: string) => ContractPayload
  mismatchMessage: string
}

function createScenarioPayload(
  scenario: EndpointScenario,
  testInfo: TestInfo
): ContractPayload {
  const actorId = buildUniqueId(`${scenario.actorRole}-actor`, testInfo)
  const targetId = buildUniqueId('target', testInfo)
  return scenario.buildPayload({ actorId, targetId })
}

const scenarios: EndpointScenario[] = [
  {
    path: '/api/v1/auth/guardian-consent',
    actorRole: 'guardian',
    wrongRole: 'moderator',
    buildPayload: ({ actorId, targetId }) => ({
      guardianId: actorId,
      teenId: targetId,
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    }),
    getActorId: (payload) => (payload as GuardianConsentPayload).guardianId,
    withMismatchedActorId: (payload, actorId) => ({
      ...(payload as GuardianConsentPayload),
      guardianId: actorId,
    }),
    mismatchMessage: 'Authenticated guardian does not match guardianId',
  },
  {
    path: '/api/v1/moderation/actions',
    actorRole: 'moderator',
    wrongRole: 'guardian',
    buildPayload: ({ actorId, targetId }) => ({
      moderatorId: actorId,
      targetId,
      action: 'hide',
      reason: 'policy_violation',
      contentType: 'post',
      timestamp: '2026-03-04T10:00:00.000Z',
    }),
    getActorId: (payload) => (payload as ModerationActionPayload).moderatorId,
    withMismatchedActorId: (payload, actorId) => ({
      ...(payload as ModerationActionPayload),
      moderatorId: actorId,
    }),
    mismatchMessage: 'Authenticated moderator does not match moderatorId',
  },
]

test.describe('Auth and moderation endpoint security contracts', () => {
  test.beforeEach(({}, testInfo) => {
    // These checks include successful write-path requests. Keep them out of prod
    // to avoid mutating live data and analytics without dedicated cleanup isolation.
    test.skip(
      isProdEnvironment(testInfo),
      'Skipping write-path contract tests in production.'
    )
  })

  for (const scenario of scenarios) {
    test.describe(scenario.path, () => {
      test('[P0] returns 401 when auth headers are missing', async ({
        apiRequest,
        validateSchema,
      }, testInfo) => {
        const payload = createScenarioPayload(scenario, testInfo)
        const { status, body } = await apiRequest({
          method: 'POST',
          path: scenario.path,
          baseUrl: resolveApiBaseUrl(testInfo),
          body: payload,
        })

        expect(status).toBe(401)
        await validateSchema(unauthorizedHttpErrorSchema, body, {
          shape: { statusCode: 401, error: 'Unauthorized' },
        })
        expect(extractErrorMessage(body)).toContain(
          'Missing or invalid authentication headers'
        )
      })

      test('[P0] returns 403 for wrong role', async ({
        apiRequest,
        validateSchema,
      }, testInfo) => {
        const payload = createScenarioPayload(scenario, testInfo)
        const actorId = scenario.getActorId(payload)
        const { status, body } = await apiRequest({
          method: 'POST',
          path: scenario.path,
          baseUrl: resolveApiBaseUrl(testInfo),
          body: payload,
          headers: authHeaders(actorId, scenario.wrongRole),
        })

        expect(status).toBe(403)
        await validateSchema(forbiddenHttpErrorSchema, body, {
          shape: { statusCode: 403, error: 'Forbidden' },
        })
        expect(extractErrorMessage(body)).toContain('Insufficient role')
      })

      test('[P0] returns 403 for mismatched actor identity', async ({
        apiRequest,
        validateSchema,
      }, testInfo) => {
        const payload = createScenarioPayload(scenario, testInfo)
        const actorId = scenario.getActorId(payload)
        const mismatchedPayload = scenario.withMismatchedActorId(
          payload,
          buildUniqueId(`${scenario.actorRole}-mismatch`, testInfo)
        )

        const { status, body } = await apiRequest({
          method: 'POST',
          path: scenario.path,
          baseUrl: resolveApiBaseUrl(testInfo),
          body: mismatchedPayload,
          headers: authHeaders(actorId, scenario.actorRole),
        })

        expect(status).toBe(403)
        await validateSchema(forbiddenHttpErrorSchema, body, {
          shape: { statusCode: 403, error: 'Forbidden' },
        })
        expect(extractErrorMessage(body)).toContain(scenario.mismatchMessage)
      })

      test('[P0] returns 200 for authorized request', async ({
        apiRequest,
        validateSchema,
      }, testInfo) => {
        const payload = createScenarioPayload(scenario, testInfo)
        const actorId = scenario.getActorId(payload)
        const { status, body } = await apiRequest({
          method: 'POST',
          path: scenario.path,
          baseUrl: resolveApiBaseUrl(testInfo),
          body: payload,
          headers: authHeaders(actorId, scenario.actorRole),
        })

        expect(status).toBe(200)
        await validateSchema(trackedResponseSchema, body, {
          shape: { tracked: true },
        })
      })
    })
  }
})
