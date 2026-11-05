// Learning path Step 12: Cross-surface E2E confidence.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-12-cross-surface-e2e-confidence
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test'
import {
  forbiddenHttpErrorSchema,
  moderationCaseDetailResponseSchema,
  moderationDecisionErrorSchema,
  moderationQueueErrorSchema,
  moderationSlaErrorSchema,
  moderationSlaResponseSchema,
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
import {
  newRunId,
  SEED_DAY_MS,
  seedMember,
  seedPost,
  seedPostReport,
} from '../../../apps/api/integration/helpers/moderation-queue-seed'

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
    // One invalid value per request, each beside a valid limit, so a 400 names the value that caused it.
    // The control proves that limit alone is valid.
    if (on) {
      const control = await request.get(`${baseUrl}${QUEUE_PATH}?limit=10`, { headers })
      expect(control.status(), 'a valid limit alone is accepted').toBe(200)
    }
    for (const query of ['risk=critical&limit=10', 'limit=500']) {
      const bad = await request.get(`${baseUrl}${QUEUE_PATH}?${query}`, { headers })
      if (on) {
        expect(bad.status(), query).toBe(400)
        expect(await bad.json(), query).toMatchObject({
          statusCode: 400,
          code: 'invalid_filter',
        })
      } else {
        // The flag is read before the query, so a closed console answers the same for any input.
        await expectClosedConsole(bad)
      }
    }
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](`${baseUrl}${QUEUE_PATH}`, { headers })
      expect([404, 405], method).toContain(response.status())
    }
  })
})

// Story 6.11 test owner: P-D-ROLES, the role matrix of the two decision routes against the running API.
// The order is bearer, role, flags, input, so a non-moderator learns nothing about flags or cases.
// A preview may have either flag off. A moderator then gets the closed contract in place of the input check.
test.describe('P-D-ROLES moderation decision write routes (Story 6.11)', () => {
  const decisionPath = (caseId: string) => `/api/v1/moderation/cases/${caseId}/decisions`
  const appealPath = (sanctionId: string) =>
    `/api/v1/moderation/sanctions/${sanctionId}/appeal`
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const NIL_REVISION = '0000000000000000'

  const decisionBody = () => ({
    action: 'resolve',
    reason: 'Role matrix probe.',
    mutationId: randomUUID(),
    expectedRevision: NIL_REVISION,
  })
  const appealBody = () => ({
    status: 'requested',
    reason: 'Role matrix probe.',
    mutationId: randomUUID(),
  })
  const routes = (caseId: string, sanctionId: string) => [
    { path: decisionPath(caseId), body: decisionBody },
    { path: appealPath(sanctionId), body: appealBody },
  ]

  /** Every status from these routes carries the same header, so a proxy can never store a decision. */
  async function postDecisionRoute(
    request: APIRequestContext,
    testInfo: TestInfo,
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ) {
    const response = await request.post(`${resolveApiBaseUrl(testInfo)}${path}`, {
      data: body as object,
      headers,
    })
    expect(response.headers()['cache-control'], path).toBe('private, no-store')
    return response
  }

  /**
   * Whether both flags are open for this identity, since a flag can target one person and not another.
   * A valid body on an unknown case answers 404 when open.
   * A closed route answers 503 with one of the two closed codes, and a local stack must be open.
   */
  async function routeIsOpen(
    request: APIRequestContext,
    testInfo: TestInfo,
    headers: Record<string, string>
  ) {
    const response = await postDecisionRoute(
      request,
      testInfo,
      decisionPath('post.never-existed-probe'),
      decisionBody(),
      headers
    )
    const body = moderationDecisionErrorSchema.parse(await response.json())
    if (response.status() === 404) {
      expect(body.code).toBe('case_not_found')
      return true
    }
    expect(response.status(), JSON.stringify(body)).toBe(503)
    expect(['moderation_decisions_disabled', 'moderation_console_disabled']).toContain(
      body.code
    )
    expect(isNonLocalEnvironment(testInfo), 'a local stack seeds the flags on').toBe(true)
    return false
  }

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isProdEnvironment(testInfo),
      'Synthetic moderator identities are not provisioned in production.'
    )
  })

  test('[P0] P-D-ROLES returns 401 with no bearer token on both routes', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    for (const { path, body } of routes('post.anything', 'anything')) {
      const result = await apiRequest({
        method: 'POST',
        path,
        baseUrl: resolveApiBaseUrl(testInfo),
        body: body(),
        retryConfig: { maxRetries: 0 },
      })
      expect(result.status, path).toBe(401)
      await validateSchema(unauthorizedHttpErrorSchema, result.body, {
        shape: { statusCode: 401, error: 'Unauthorized' },
      })
    }
  })

  test('[P0] P-D-ROLES gives a guardian and a teen one 403 body for unknown and malformed ids on both routes', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const expectedMessage = {
      guardian: 'Insufficient role',
      teen: 'Guardian consent required',
    }
    for (const role of ['guardian', 'teen'] as const) {
      const headers = authHeaders(buildUniqueId(`${role}-writer`, testInfo), role)
      const bodies = new Set<string>()
      for (const [caseId, sanctionId] of [
        ['post.cmreal0000000000000000000', 'cmreal0000000000000000000'],
        ['post.does-not-exist', 'does-not-exist'],
        ['not-a-case', '%20'],
        ['orphan-comment.x', 'x'],
      ] as const) {
        for (const { path, body } of routes(caseId, sanctionId)) {
          const result = await apiRequest({
            method: 'POST',
            path,
            baseUrl: resolveApiBaseUrl(testInfo),
            body: body(),
            headers,
            retryConfig: { maxRetries: 0 },
          })
          expect(result.status, `${role} ${path}`).toBe(403)
          await validateSchema(forbiddenHttpErrorSchema, result.body, {
            shape: { statusCode: 403, error: 'Forbidden' },
          })
          expect(extractErrorMessage(result.body)).toContain(expectedMessage[role])
          bodies.add(JSON.stringify(result.body))
        }
      }
      expect(bodies.size, `${role} bodies`).toBe(1)
    }
  })

  test('[P0] P-D-ROLES an invalid body changes nothing about the 403 a non-moderator sees', async ({
    request,
  }, testInfo) => {
    // Role comes before input: a body the schema refuses must not reveal that the schema ran.
    const headers = authHeaders(buildUniqueId('guardian-writer', testInfo), 'guardian')
    const bodies = new Set<string>()
    for (const body of [
      decisionBody(),
      {},
      { ...decisionBody(), moderatorId: buildUniqueId('forged', testInfo) },
    ]) {
      const response = await postDecisionRoute(
        request,
        testInfo,
        decisionPath('post.anything'),
        body,
        headers
      )
      expect(response.status()).toBe(403)
      bodies.add(await response.text())
    }
    expect(bodies.size).toBe(1)
  })

  test('[P0] P-D-ROLES refuses a forged moderatorId and an unknown key on both routes', async ({
    request,
  }, testInfo) => {
    const moderatorId = buildUniqueId('moderator-writer', testInfo)
    const forgedId = buildUniqueId('forged-moderator', testInfo)
    const headers = authHeaders(moderatorId, 'moderator')
    const open = await routeIsOpen(request, testInfo, headers)
    for (const { path, body } of routes('post.anything', 'anything')) {
      for (const extra of [
        { moderatorId: forgedId },
        { userId: forgedId },
        { role: 'admin' },
      ]) {
        const response = await postDecisionRoute(
          request,
          testInfo,
          path,
          { ...body(), ...extra },
          headers
        )
        const parsed = moderationDecisionErrorSchema.parse(await response.json())
        if (open) {
          expect(response.status(), path).toBe(400)
          expect(parsed.code).toBe('invalid_decision')
        } else {
          // Flags come before input, so a closed route answers the same for any body.
          expect(response.status(), path).toBe(503)
        }
        // Nothing the request sent is echoed back.
        expect(JSON.stringify(parsed)).not.toContain(forgedId)
      }
    }
  })

  // A real case needs a seeded row, so a preview run skips this one.
  test('[P0] P-D-ROLES gives one 403 body for a real case and sanction, and a forged moderator writes nothing', async ({
    apiRequest,
    request,
  }, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Seeding needs direct database access, which a preview run does not have.'
    )
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      const runId = newRunId()
      const author = await seedMember(prisma, runId, 'author')
      const reporter = await seedMember(prisma, runId, 'reporter')
      const moderator = await seedMember(prisma, runId, 'moderator', { alias: false })
      const now = new Date()
      // Flagged, so this row stays off the public feed: seven spotlight and five lookbook rows fill its first page.
      const post = await seedPost(prisma, {
        runId,
        label: 'roles',
        authorId: author.id,
        status: 'flagged',
        moderationReason: 'unsafe_class',
        now,
      })
      await seedPostReport(prisma, {
        runId,
        label: 'roles',
        postId: post.id,
        reporterId: reporter.id,
        reason: 'spam',
        createdAt: now,
        dueAt: new Date(now.getTime() + SEED_DAY_MS),
      })
      const caseId = `post.${post.id}`
      const decision = await prisma.moderationDecision.create({
        data: {
          case_key: `${caseId}-seeded`,
          sequence: 1,
          source: 'post',
          report_ids: [],
          action: 'ban',
          reason: 'Seeded ban.',
          moderator_role: 'admin',
          subject_user_id: author.id,
          mutation_id: randomUUID(),
          payload_hash: 'seeded',
          response: {},
          is_terminal: true,
          decided_at: now,
        },
      })
      const sanction = await prisma.communitySanction.create({
        data: {
          user_id: author.id,
          decision_id: decision.id,
          case_key: `${caseId}-seeded`,
          kind: 'temporary',
          expires_at: new Date(now.getTime() + 7 * SEED_DAY_MS),
          created_at: now,
        },
      })
      const counts = async () => ({
        decisions: await prisma.moderationDecision.count({
          where: { case_key: caseId },
        }),
        audit: await prisma.auditLog.count({
          where: {
            user_id: { in: [moderator.id, reporter.id] },
            event_type: 'moderation_decision_applied',
          },
        }),
        open: await prisma.communityPostReport.count({
          where: { post_id: post.id, resolved_at: null },
        }),
        status: (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } }))
          .status,
        appeal: (
          await prisma.communitySanction.findUniqueOrThrow({
            where: { id: sanction.id },
          })
        ).appeal_status,
      })
      const before = await counts()
      expect(before).toEqual({
        decisions: 0,
        audit: 0,
        open: 1,
        status: 'flagged',
        appeal: 'not_requested',
      })

      for (const role of ['guardian', 'teen'] as const) {
        const headers = authHeaders(buildUniqueId(`${role}-writer`, testInfo), role)
        const bodies = new Set<string>()
        for (const [realCase, realSanction] of [
          [caseId, sanction.id],
          ['post.does-not-exist', 'does-not-exist'],
        ] as const) {
          for (const { path, body } of routes(realCase, realSanction)) {
            const result = await apiRequest({
              method: 'POST',
              path,
              baseUrl: resolveApiBaseUrl(testInfo),
              body: body(),
              headers,
              retryConfig: { maxRetries: 0 },
            })
            expect(result.status, `${role} ${path}`).toBe(403)
            bodies.add(JSON.stringify(result.body))
          }
        }
        expect(bodies.size, `${role} bodies`).toBe(1)
      }

      // A forged id on a real case: 400, and no row names anyone.
      const detail = await request.get(
        `${resolveApiBaseUrl(testInfo)}/api/v1/moderation/cases/${caseId}`,
        { headers: authHeaders(moderator.id, 'moderator') }
      )
      expect(detail.status()).toBe(200)
      const { revision } = moderationCaseDetailResponseSchema.parse(
        await detail.json()
      ).data
      const forged = await postDecisionRoute(
        request,
        testInfo,
        decisionPath(caseId),
        { ...decisionBody(), expectedRevision: revision, moderatorId: reporter.id },
        authHeaders(moderator.id, 'moderator')
      )
      expect(forged.status()).toBe(400)
      expect(moderationDecisionErrorSchema.parse(await forged.json()).code).toBe(
        'invalid_decision'
      )
      const forgedAppeal = await postDecisionRoute(
        request,
        testInfo,
        appealPath(sanction.id),
        { ...appealBody(), moderatorId: reporter.id },
        authHeaders(moderator.id, 'moderator')
      )
      expect(forgedAppeal.status()).toBe(400)
      expect(moderationDecisionErrorSchema.parse(await forgedAppeal.json()).code).toBe(
        'invalid_decision'
      )
      expect(await counts()).toEqual(before)
    } finally {
      await prisma.$disconnect()
    }
  })

  test('[P1] P-D-ROLES lets a moderator and an admin past the guards, and exposes no other write method', async ({
    request,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    for (const role of ['moderator', 'admin'] as const) {
      const headers = authHeaders(buildUniqueId(`${role}-writer`, testInfo), role)
      const open = await routeIsOpen(request, testInfo, headers)
      for (const { path, body } of routes('post.never-existed', 'never-existed')) {
        const response = await postDecisionRoute(request, testInfo, path, body(), headers)
        // A role the guards let through reaches the service, which knows no such id.
        expect(response.status(), `${role} ${path}`).toBe(open ? 404 : 503)
      }
    }
    const headers = authHeaders(buildUniqueId('moderator-writer', testInfo), 'moderator')
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      for (const { path } of routes('post.never-existed', 'never-existed')) {
        const response = await request[method](`${baseUrl}${path}`, { headers })
        expect([404, 405], `${method} ${path}`).toContain(response.status())
      }
    }
  })
})

test.describe('Moderation SLA read route (Story 6.12)', () => {
  const SLA_PATH = '/api/v1/moderation/sla'

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isProdEnvironment(testInfo),
      'Synthetic moderator identities are not provisioned in production.'
    )
  })

  test('[P0] P-SLA-ROLES refuses anonymous, guardian and teen with one body each, in private', async ({
    request,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const anonymous = await request.get(`${baseUrl}${SLA_PATH}`)
    expect(anonymous.status()).toBe(401)
    unauthorizedHttpErrorSchema.parse(await anonymous.json())
    expect(anonymous.headers()['cache-control']).toBe('private, no-store')

    for (const role of ['guardian', 'teen'] as const) {
      const headers = authHeaders(buildUniqueId(`${role}-sla`, testInfo), role)
      const sla = await request.get(`${baseUrl}${SLA_PATH}`, { headers })
      const queue = await request.get(`${baseUrl}/api/v1/moderation/cases`, { headers })
      expect(sla.status(), role).toBe(403)
      expect(sla.headers()['cache-control']).toBe('private, no-store')
      // Identical to the 6.10 refusal, so the body reveals neither the flag nor the route.
      expect(await sla.json()).toEqual(await queue.json())
    }
  })

  test('[P0] P-SLA-ROLES lets a moderator and an admin read a strict body, or a closed 503', async ({
    request,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    for (const role of ['moderator', 'admin'] as const) {
      const response = await request.get(`${baseUrl}${SLA_PATH}`, {
        headers: authHeaders(buildUniqueId(`${role}-sla`, testInfo), role),
      })
      expect(response.headers()['cache-control']).toBe('private, no-store')
      if (response.status() === 503) {
        expect(moderationSlaErrorSchema.parse(await response.json()).code).toBe(
          'moderation_sla_disabled'
        )
        continue
      }
      expect(response.status(), role).toBe(200)
      moderationSlaResponseSchema.parse(await response.json())
    }
  })
})

test.describe('Moderation history routes (Story 6.13)', () => {
  const ERASURE_PATH = '/api/v1/moderation/erasure-requests'
  const EXPORT_PATH = '/api/v1/moderation/evidence-exports'
  const AVAILABILITY_PATH = '/api/v1/moderation/evidence-exports/availability'
  const CASE_BODY = { scope: 'case', caseId: 'post.never-existed' }

  test.beforeEach(({}, testInfo) => {
    test.skip(
      isProdEnvironment(testInfo),
      'Synthetic moderator identities are not provisioned in production.'
    )
  })

  test('[P0] P-SECURITY-LIST refuses anonymous, a tampered token, guardian and teen, in private', async ({
    request,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const calls = [
      { path: ERASURE_PATH, data: { memberId: 'never-existed' } },
      { path: EXPORT_PATH, data: CASE_BODY },
    ]
    for (const { path, data } of calls) {
      const anonymous = await request.post(`${baseUrl}${path}`, { data })
      expect(anonymous.status(), path).toBe(401)
      unauthorizedHttpErrorSchema.parse(await anonymous.json())
      expect(anonymous.headers()['cache-control']).toBe('private, no-store')

      const tampered = await request.post(`${baseUrl}${path}`, {
        data,
        headers: { Authorization: 'Bearer not-a-real-token' },
      })
      expect(tampered.status(), path).toBe(401)

      for (const role of ['guardian', 'teen'] as const) {
        const headers = authHeaders(buildUniqueId(`${role}-history`, testInfo), role)
        const refused = await request.post(`${baseUrl}${path}`, { data, headers })
        const queue = await request.get(`${baseUrl}/api/v1/moderation/cases`, { headers })
        expect(refused.status(), `${path} ${role}`).toBe(403)
        expect(refused.headers()['cache-control']).toBe('private, no-store')
        // Identical to the 6.10 refusal, so the body reveals neither the flag nor the route.
        expect(await refused.json()).toEqual(await queue.json())
      }
    }
    const anonymous = await request.get(`${baseUrl}${AVAILABILITY_PATH}`)
    expect(anonymous.status()).toBe(401)
    const guardian = await request.get(`${baseUrl}${AVAILABILITY_PATH}`, {
      headers: authHeaders(buildUniqueId('guardian-history', testInfo), 'guardian'),
    })
    expect(guardian.status()).toBe(403)
  })

  test('[P0] P-SECURITY-LIST refuses a moderator on erasure and on a period', async ({
    request,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const headers = authHeaders(buildUniqueId('moderator-history', testInfo), 'moderator')
    const erasure = await request.post(`${baseUrl}${ERASURE_PATH}`, {
      data: { memberId: 'never-existed' },
      headers,
    })
    const period = await request.post(`${baseUrl}${EXPORT_PATH}`, {
      data: {
        scope: 'range',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      },
      headers,
    })
    for (const response of [erasure, period]) {
      expect(response.status()).toBe(403)
      expect(((await response.json()) as { code?: string }).code).toBe('admin_required')
      expect(response.headers()['cache-control']).toBe('private, no-store')
    }
  })
})
