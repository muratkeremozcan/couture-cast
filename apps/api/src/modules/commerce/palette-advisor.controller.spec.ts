// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4 Task 5/6: the palette advisor routes over real HTTP through a
// Nest `TestingModule`, mirroring premium-theme.controller.spec.ts's shape.
// RequestAuthGuard is stubbed (real Supabase token validation is proven in
// the auth module's own specs); PremiumEntitlementGuard and WardrobeUploadGuard
// are the REAL production guards wired to stubbed collaborators, so the 403s
// and guard-ordering claims below come from the same code path production
// uses.
import {
  ForbiddenException,
  Module,
  UnauthorizedException,
  type INestApplication,
  type Provider,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PALETTE_CONSENT_REQUIRED_MESSAGE } from '../../contracts/http.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { GuardianService } from '../guardian/guardian.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import { WardrobeUploadGuard } from '../wardrobe/wardrobe.guard.js'
import { AffiliateOfferService } from './affiliate-offer.service.js'
import { CommerceModule } from './commerce.module.js'
import { PaletteAdvisorController } from './palette-advisor.controller.js'
import { PaletteAdvisorService } from './palette-advisor.service.js'
import { PaletteAnalysisProcessingQueue } from './palette-analysis-processing.queue.js'
import { PremiumEntitlementGuard } from './premium-entitlement.guard.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'

const AUTHENTICATED_USER_ID = 'user-1'
const TOKEN = 'palette-advisor-token'
const ROUTE = '/api/v1/commerce/premium/palette'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'

function createPrismaStub() {
  return {
    paletteProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    advisorRecommendationState: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn(),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(undefined)
    ),
  }
}

/**
 * No middleware binding needed here: CommerceModule's cache-headers claim is
 * proven once, on PremiumThemeController's own spec.
 */
function createHttpTestModule(providers: Provider[]) {
  class PaletteAdvisorHttpTestModule {}
  Module({ controllers: [PaletteAdvisorController], providers })(
    PaletteAdvisorHttpTestModule
  )
  return PaletteAdvisorHttpTestModule
}

describe('PaletteAdvisorController', () => {
  let app: INestApplication | undefined
  let prisma: ReturnType<typeof createPrismaStub>
  let entitlements: { hasPremiumAccess: ReturnType<typeof vi.fn> }
  let featureFlags: { getFeatureFlag: ReturnType<typeof vi.fn> }
  let guardian: { assertWardrobeUploadAllowed: ReturnType<typeof vi.fn> }
  let telemetry: { captureEvent: ReturnType<typeof vi.fn> }
  let affiliateOffers: { resolveAdvisorOffers: ReturnType<typeof vi.fn> }
  let queue: { enqueue: ReturnType<typeof vi.fn> }
  let storage: { upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }

  async function boot(
    options: { entitled?: boolean; flag?: boolean; guardianAllowed?: boolean } = {}
  ): Promise<void> {
    prisma = createPrismaStub()
    entitlements = {
      hasPremiumAccess: vi.fn().mockResolvedValue(options.entitled ?? true),
    }
    featureFlags = { getFeatureFlag: vi.fn().mockResolvedValue(options.flag ?? true) }
    guardian = {
      assertWardrobeUploadAllowed:
        options.guardianAllowed === false
          ? vi.fn().mockRejectedValue(new ForbiddenException('GUARDIAN_CONSENT_REQUIRED'))
          : vi.fn().mockResolvedValue(undefined),
    }
    telemetry = { captureEvent: vi.fn().mockResolvedValue(undefined) }
    affiliateOffers = { resolveAdvisorOffers: vi.fn().mockResolvedValue(new Map()) }
    queue = { enqueue: vi.fn().mockResolvedValue(undefined) }
    storage = {
      upload: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        createHttpTestModule([
          PaletteAdvisorService,
          PremiumEntitlementGuard,
          WardrobeUploadGuard,
          { provide: PrismaClient, useValue: prisma },
          { provide: PremiumEntitlementService, useValue: entitlements },
          { provide: FeatureFlagsService, useValue: featureFlags },
          { provide: GuardianService, useValue: guardian },
          { provide: TelemetryService, useValue: telemetry },
          { provide: AffiliateOfferService, useValue: affiliateOffers },
          { provide: PaletteAnalysisProcessingQueue, useValue: queue },
          { provide: SupabaseWardrobeStorageAdapter, useValue: storage },
        ]),
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => AuthenticatedRequest }
        }) => {
          const req = context.switchToHttp().getRequest()
          if (req.headers.authorization !== `Bearer ${TOKEN}`) {
            throw new UnauthorizedException('Missing or invalid bearer token')
          }
          req.auth = { token: TOKEN, userId: AUTHENTICATED_USER_ID, role: 'guardian' }
          return true
        },
      })
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  }

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  const server = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  const authed = {
    get: (path = ROUTE) =>
      request(server())
        .get(path)
        .set({ authorization: `Bearer ${TOKEN}` }),
    post: (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(server())
        .post(path)
        .set({ authorization: `Bearer ${TOKEN}`, ...headers })
        .send(body as object),
    put: (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(server())
        .put(path)
        .set({ authorization: `Bearer ${TOKEN}`, ...headers })
        .send(body as object),
    delete: (path = ROUTE) =>
      request(server())
        .delete(path)
        .set({ authorization: `Bearer ${TOKEN}` }),
  }

  describe('authentication', () => {
    it('rejects an unauthenticated read with 401', async () => {
      await boot()

      const response = await request(server()).get(ROUTE)

      expect(response.status).toBe(401)
    })

    it('rejects an unauthenticated erase with 401', async () => {
      await boot()

      const response = await request(server()).delete(ROUTE)

      expect(response.status).toBe(401)
    })
  })

  describe('GET: every signed-in caller gets an answer', () => {
    it('answers 200 for a non-entitled caller (the locked shape)', async () => {
      await boot({ entitled: false })

      const response = await authed.get()

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        data: { isEntitled: false, analysis: null },
      })
    })

    it('answers 200 for an entitled caller with no analysis yet', async () => {
      await boot()

      const response = await authed.get()

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        data: {
          isEntitled: true,
          hasConsent: false,
          analysis: null,
          recommendations: [],
        },
      })
    })
  })

  describe('POST /consent: PremiumEntitlementGuard is mounted', () => {
    it('5.4-API-060 answers 403 for a non-entitled caller before touching consent', async () => {
      await boot({ entitled: false })

      const response = await authed.post(`${ROUTE}/consent`, { granted: true })

      expect(response.status).toBe(403)
      expect(prisma.paletteProfile.upsert).not.toHaveBeenCalled()
    })

    it('grants consent for an entitled caller', async () => {
      await boot()

      const response = await authed.post(`${ROUTE}/consent`, { granted: true })

      // 200, not Nest's POST default of 201: this route creates nothing a
      // client can address, and the published contract says 200. Pact caught
      // the mismatch when the handler carried no `@HttpCode`.
      expect(response.status).toBe(200)
      expect(prisma.paletteProfile.upsert).toHaveBeenCalled()
    })

    it('rejects a malformed body with 400', async () => {
      await boot()

      const response = await authed.post(`${ROUTE}/consent`, { granted: 'yes' })

      expect(response.status).toBe(400)
    })
  })

  describe('POST /analyze: entitlement AND consent are both required', () => {
    it('5.4-API-012 answers 403 for an entitled caller with no consent', async () => {
      await boot()

      const response = await authed.post(`${ROUTE}/analyze`, { source: 'wardrobe' })

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject({ message: PALETTE_CONSENT_REQUIRED_MESSAGE })
    })
  })

  describe('POST /selfie/upload-url: WardrobeUploadGuard is mounted after entitlement', () => {
    const uploadDeclaration = {
      fileSizeBytes: 1024,
      mimeType: 'image/png',
      sha256: '0'.repeat(64),
      widthPx: 300,
      heightPx: 300,
    }

    it('5.4-API-062 answers 403 for a non-entitled caller before reaching the guardian check', async () => {
      await boot({ entitled: false, guardianAllowed: false })

      const response = await authed.post(
        `${ROUTE}/selfie/upload-url`,
        uploadDeclaration,
        { 'idempotency-key': IDEMPOTENCY_KEY }
      )

      expect(response.status).toBe(403)
      expect(guardian.assertWardrobeUploadAllowed).not.toHaveBeenCalled()
    })

    it('answers 403 when the guardian check refuses an entitled, consented caller', async () => {
      await boot({ guardianAllowed: false })
      prisma.paletteProfile.findUnique.mockResolvedValue({
        id: 'profile-1',
        user_id: AUTHENTICATED_USER_ID,
        consent_granted_at: new Date('2026-08-01T00:00:00Z'),
        consent_revoked_at: null,
      })

      const response = await authed.post(
        `${ROUTE}/selfie/upload-url`,
        uploadDeclaration,
        { 'idempotency-key': IDEMPOTENCY_KEY }
      )

      expect(response.status).toBe(403)
      expect(guardian.assertWardrobeUploadAllowed).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        'guardian'
      )
    })

    it('rejects a missing or malformed Idempotency-Key with 400', async () => {
      await boot()
      prisma.paletteProfile.findUnique.mockResolvedValue({
        id: 'profile-1',
        user_id: AUTHENTICATED_USER_ID,
        consent_granted_at: new Date('2026-08-01T00:00:00Z'),
        consent_revoked_at: null,
      })

      const response = await authed.post(`${ROUTE}/selfie/upload-url`, uploadDeclaration)

      expect(response.status).toBe(400)
    })
  })

  describe('PUT /selfie/uploads/:uploadSessionId: RequestAuthGuard only', () => {
    it('rejects an unauthenticated request with 401', async () => {
      await boot()

      const response = await request(server()).put(`${ROUTE}/selfie/uploads/session-1`)

      expect(response.status).toBe(401)
    })

    it('rejects a request with no upload token header with 400', async () => {
      await boot()

      const response = await authed.put(
        `${ROUTE}/selfie/uploads/session-1`,
        Buffer.from('bytes'),
        { 'content-type': 'image/png' }
      )

      expect(response.status).toBe(400)
    })
  })

  describe('PUT /recommendations: entitlement-gated, not flag-gated', () => {
    const body = { itemKey: 'advisor:jewelry:warm', slot: 'jewelry', action: 'saved' }

    it('answers 403 for a non-entitled caller', async () => {
      await boot({ entitled: false })

      const response = await authed.put(`${ROUTE}/recommendations`, body)

      expect(response.status).toBe(403)
    })

    it('saves a recommendation for an entitled caller even with the flag off', async () => {
      await boot({ flag: false })

      const response = await authed.put(`${ROUTE}/recommendations`, body)

      expect(response.status).toBe(200)
    })
  })

  describe('DELETE: deliberately NOT entitlement-gated (Decision 9)', () => {
    it('erases for a non-entitled, lapsed-subscriber caller', async () => {
      await boot({ entitled: false })

      const response = await authed.delete()

      expect(response.status).toBe(200)
      expect(prisma.advisorRecommendationState.deleteMany).toHaveBeenCalledWith({
        where: { user_id: AUTHENTICATED_USER_ID },
      })
    })
  })

  describe('cross-user authorization is structural, not checked', () => {
    it('exposes no id path parameter on any route', async () => {
      await boot()

      const read = await authed.get(`${ROUTE}/user-2`)
      const write = await authed.put(`${ROUTE}/recommendations/user-2`, {
        itemKey: 'x',
        slot: 'jewelry',
        action: 'saved',
      })

      expect(read.status).toBe(404)
      expect(write.status).toBe(404)
    })
  })

  describe('registration in the production module', () => {
    it('mounts the controller, service, and both guards on CommerceModule', () => {
      const controllers = (Reflect.getMetadata('controllers', CommerceModule) ??
        []) as unknown[]
      const providers = (Reflect.getMetadata('providers', CommerceModule) ??
        []) as unknown[]

      expect(controllers).toContain(PaletteAdvisorController)
      expect(providers).toContain(PaletteAdvisorService)
      expect(providers).toContain(PaletteAnalysisProcessingQueue)
      expect(providers).toContain(WardrobeUploadGuard)
      expect(providers).toContain(SupabaseWardrobeStorageAdapter)
    })
  })
})
