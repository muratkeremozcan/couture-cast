// Learning path Step 12: Cross-surface E2E confidence.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-12-cross-surface-e2e-confidence
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test'
import {
  forbiddenHttpErrorSchema,
  moderationQueueErrorSchema,
  trackedResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'
import { test, expect } from '../../support/fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  extractErrorMessage,
  isNonLocalEnvironment,
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
        const errMsg = extractErrorMessage(body)
        expect(
          errMsg.includes('Missing or invalid') || errMsg.includes('Invalid access token')
        ).toBe(true)
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

// Story 6.10: the two read-only moderation routes. The role matrix runs the real guards against
// the running API: bearer first, role second, the flag after the role.
test.describe('Moderator queue read routes (Story 6.10)', () => {
  const QUEUE_PATH = '/api/v1/moderation/cases'
  const detailPath = (caseId: string) => `${QUEUE_PATH}/${caseId}`

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isProdEnvironment(testInfo),
      'Synthetic moderator identities are not provisioned in production.'
    )
  })

  test('[P0] P-Q-ROLES returns 401 without a bearer token on both routes', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    for (const path of [QUEUE_PATH, detailPath('post.anything')]) {
      const { status, body } = await apiRequest({
        method: 'GET',
        path,
        baseUrl: resolveApiBaseUrl(testInfo),
      })
      expect(status).toBe(401)
      await validateSchema(unauthorizedHttpErrorSchema, body, {
        shape: { statusCode: 401, error: 'Unauthorized' },
      })
    }
  })

  test('[P0] P-Q-ROLES gives each non-moderator role one 403 body for real, unknown and malformed ids', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    // The teen consent gate runs before the role check, so a teen sees a different message than a guardian.
    // Each role still sees exactly one body, whatever the id.
    const expectedMessage = {
      guardian: 'Insufficient role',
      teen: 'Guardian consent required',
    }
    for (const role of ['guardian', 'teen'] as const) {
      const headers = authHeaders(buildUniqueId(`${role}-reader`, testInfo), role)
      const bodies = new Set<string>()
      for (const path of [
        QUEUE_PATH,
        detailPath('post.cmreal0000000000000000000'),
        detailPath('post.does-not-exist'),
        detailPath('not-a-case'),
        detailPath('orphan-comment.x'),
      ]) {
        const { status, body } = await apiRequest({
          method: 'GET',
          path,
          baseUrl: resolveApiBaseUrl(testInfo),
          headers,
        })
        expect(status, `${role} ${path}`).toBe(403)
        await validateSchema(forbiddenHttpErrorSchema, body, {
          shape: { statusCode: 403, error: 'Forbidden' },
        })
        expect(extractErrorMessage(body)).toContain(expectedMessage[role])
        bodies.add(JSON.stringify(body))
      }
      expect(bodies.size, `${role} bodies`).toBe(1)
    }
  })

  // The flag is environment configuration: a local stack seeds it on and a preview may have it off.
  // A moderator passes the role check either way, so the queue answers 200 when the console is on and
  // 503 `moderation_console_disabled` when it is off. Each test asserts the state it finds, and a local
  // stack must be on, so neither state hides a defect.
  async function consoleIsOn(request: APIRequestContext, testInfo: TestInfo) {
    const probe = await request.get(
      `${resolveApiBaseUrl(testInfo)}${QUEUE_PATH}?limit=1`,
      { headers: authHeaders(buildUniqueId('moderator-probe', testInfo), 'moderator') }
    )
    if (probe.status() === 200) return true
    await expectClosedConsole(probe)
    expect(isNonLocalEnvironment(testInfo), 'a local stack seeds the console on').toBe(
      true
    )
    return false
  }

  /** The closed console is a typed 503 that is never cached and carries no queue data. */
  async function expectClosedConsole(response: APIResponse) {
    expect(response.status(), await response.text()).toBe(503)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    const body = moderationQueueErrorSchema.parse(await response.json())
    expect(body.code).toBe('moderation_console_disabled')
    expect(JSON.stringify(body)).not.toContain('items')
    return JSON.stringify(body)
  }

  test('[P0] P-Q-ROLES lets a moderator and an admin read the queue with private, no-store headers', async ({
    request,
  }, testInfo) => {
    const on = await consoleIsOn(request, testInfo)
    const baseUrl = resolveApiBaseUrl(testInfo)
    for (const role of ['moderator', 'admin'] as const) {
      const response = await request.get(`${baseUrl}${QUEUE_PATH}?limit=5`, {
        headers: authHeaders(buildUniqueId(`${role}-reader`, testInfo), role),
      })
      if (!on) {
        await expectClosedConsole(response)
        continue
      }
      expect(response.status(), role).toBe(200)
      expect(response.headers()['cache-control']).toBe('private, no-store')
      const body = (await response.json()) as {
        data: { items: unknown[]; nextCursor: string | null; serverNow: string }
      }
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(Date.parse(body.data.serverNow)).not.toBeNaN()
      // The page never carries a forbidden key.
      expect(JSON.stringify(body)).not.toMatch(
        /"(user_id|userId|email|reporterId|reportId|objectPath|bucket|ip)"/
      )
    }
  })

  test('[P0] P-Q-ROLES answers 404 case_not_found with one body for unknown and malformed ids', async ({
    request,
  }, testInfo) => {
    const on = await consoleIsOn(request, testInfo)
    const baseUrl = resolveApiBaseUrl(testInfo)
    const headers = authHeaders(buildUniqueId('moderator-reader', testInfo), 'moderator')
    const bodies = new Set<string>()
    for (const id of [
      'post.never-existed-1',
      'not-a-case',
      'post.',
      'orphan-post.never',
    ]) {
      const response = await request.get(`${baseUrl}${detailPath(id)}`, { headers })
      if (!on) {
        // The flag is read before the id, so a closed console cannot reveal which ids exist.
        bodies.add(await expectClosedConsole(response))
        continue
      }
      expect(response.status(), id).toBe(404)
      expect(response.headers()['cache-control']).toBe('private, no-store')
      bodies.add(JSON.stringify(await response.json()))
    }
    expect(bodies.size).toBe(1)
    expect([...bodies][0]).toContain(
      on ? 'case_not_found' : 'moderation_console_disabled'
    )
  })

  test('[P1] P-Q-ROLES refuses a bad filter with a closed code and exposes no write method', async ({
    request,
  }, testInfo) => {
    const on = await consoleIsOn(request, testInfo)
    const baseUrl = resolveApiBaseUrl(testInfo)
    const headers = authHeaders(buildUniqueId('moderator-reader', testInfo), 'moderator')
    const bad = await request.get(`${baseUrl}${QUEUE_PATH}?risk=critical&limit=500`, {
      headers,
    })
    if (on) {
      expect(bad.status()).toBe(400)
      expect(await bad.json()).toMatchObject({ statusCode: 400, code: 'invalid_filter' })
    } else {
      // The flag is read before the query, so a closed console answers the same for any input.
      await expectClosedConsole(bad)
    }
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](`${baseUrl}${QUEUE_PATH}`, { headers })
      expect([404, 405], method).toContain(response.status())
    }
  })
})
