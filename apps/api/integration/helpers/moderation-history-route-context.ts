// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: both moderation history routes through the real module, on real Postgres.
import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import {
  moderationEvidenceBundleSchema,
  type ModerationEvidenceBundle,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service.js'
import { SupabaseCommunityStorageAdapter } from '../../src/modules/community/community-storage.adapter.js'
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js'
import { MODERATION_QUEUE_CLOCK } from '../../src/modules/moderation/moderation-decision-rules.js'
import { ModerationModule } from '../../src/modules/moderation/moderation.module.js'
import { listenHttpApp } from '../../src/testing/loopback-http-app.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
} from './moderation-decisions-seed.js'

export const NOW = new Date('2026-11-05T12:00:00.000Z')
export const ERASURE = '/api/v1/moderation/erasure-requests'
export const EXPORT = '/api/v1/moderation/evidence-exports'
export const DAY = 86_400_000
/** The digest as a compliance reviewer would recompute it from a kept file. */
export function recomputeDigest(bundle: ModerationEvidenceBundle): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonical(source[key])])
    )
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          decisions: bundle.decisions,
          reports: bundle.reports,
          auditEvents: bundle.auditEvents,
          alerts: bundle.alerts,
        })
      )
    )
    .digest('hex')
}

/** Call at the top of a spec file: it boots the module for that file and closes it afterwards. */
export function useModerationHistoryRoutes() {
  const ctx = moderationDecisionsTestContext()
  const { prisma, clock, flagValues, flags, failFlag } = ctx
  const fx = decisionFixtures(prisma, clock.now)
  let server: string
  let closeApp: () => Promise<void>

  const auth = (role: string, id: string) => `Bearer test-token:${role}:${id}`
  const postAs = (path: string, role: string, id: string) =>
    request(server)
      .post(path)
      .set('Authorization', auth(role, id))
      .set('x-couture-platform', 'web')
  const operator = (role: string) => fx.operator().then(({ id }) => ({ id, role }))
  const exportAs = (who: { id: string; role: string }, body: object) =>
    postAs(EXPORT, who.role, who.id).send(body)
  const codeOf = (response: { body: unknown }) =>
    (response.body as { code?: string }).code
  const parsed = (response: { body: unknown }): ModerationEvidenceBundle =>
    moderationEvidenceBundleSchema.parse(response.body)

  const auditCount = (eventType: string, userId?: string) =>
    prisma.auditLog.count({
      where: { event_type: eventType, ...(userId ? { user_id: userId } : {}) },
    })

  beforeAll(async () => {
    clock.at(NOW)
    const module = await Test.createTestingModule({ imports: [ModerationModule] })
      .overrideProvider(PrismaClient)
      .useValue(prisma)
      .overrideProvider(FeatureFlagsService)
      .useValue(flags)
      .overrideProvider(SupabaseCommunityStorageAdapter)
      .useValue({ signReadUrl: vi.fn() })
      .overrideProvider(MODERATION_QUEUE_CLOCK)
      .useValue(clock.now)
      .overrideProvider(AccessTokenIdentityService)
      .useValue({
        resolveIdentity: vi.fn((token: string) => {
          const match = /^test-token:([a-z]+):(.+)$/.exec(token)
          if (!match)
            return Promise.reject(new UnauthorizedException('Invalid access token'))
          return Promise.resolve({ userId: match[2]!, role: match[1]! })
        }),
      })
      .overrideProvider(GuardianConsentStateService)
      .useValue({ canTeenAccess: vi.fn().mockResolvedValue(true) })
      .compile()
    const app = module.createNestApplication()
    app.useLogger(false)
    server = await listenHttpApp(app)
    closeApp = () => app.close()
  }, 120_000)

  afterAll(async () => {
    await closeApp?.()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clock.at(NOW)
    flagValues.clear()
  })

  return {
    ctx,
    prisma,
    clock,
    flagValues,
    flags,
    failFlag,
    fx,
    auth,
    serverUrl: () => server,
    operator,
    postAs,
    exportAs,
    codeOf,
    parsed,
    auditCount,
  }
}
