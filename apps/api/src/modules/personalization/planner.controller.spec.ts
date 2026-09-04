// Story 5.5: premium 7-day outfit planner.
//
// PlannerService's own generation/reshuffle logic is unit-tested directly in
// planner.service.spec.ts. This file exercises what is unique to the HTTP
// boundary: guard order (401 -> 403 -> the service's own 503), header/query/
// body validation, and routing -- so PlannerService is mocked rather than
// exercised for real.
import 'reflect-metadata'
import {
  type INestApplication,
  Module,
  type Provider,
  UnauthorizedException,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { PremiumEntitlementGuard } from '../commerce/premium-entitlement.guard.js'
import { PremiumEntitlementService } from '../commerce/premium-entitlement.service.js'
import { PlannerController } from './planner.controller.js'
import { PlannerService } from './planner.service.js'
import {
  plannerResponseSchema,
  plannerReshuffleResponseSchema,
} from '../../contracts/http.js'

const TOKEN = 'planner-token'
const AUTHENTICATED_USER_ID = 'user-1'
const ROUTE = '/api/v1/commerce/premium/planner'

function createHttpTestModule(providers: Provider[]) {
  class PlannerHttpTestModule {}
  Module({ controllers: [PlannerController], providers })(PlannerHttpTestModule)
  return PlannerHttpTestModule
}

const emptyPlannerResponse = {
  data: {
    locationId: 'loc-1',
    timezone: 'America/Chicago',
    anchorDate: '2026-07-16',
    daysReady: 0,
    days: Array.from({ length: 7 }, (_, i) => ({
      status: 'error' as const,
      planDate: `2026-07-${String(16 + i).padStart(2, '0')}`,
      errorCode: 'generation_failed' as const,
      retryable: true as const,
    })),
  },
}

const readyDay = {
  status: 'ready' as const,
  planDate: '2026-07-16',
  version: 2,
  weather: {
    confidence: 'hourly' as const,
    freshness: 'fresh' as const,
    condition: 'clear' as const,
    temperatureLow: 15,
    temperatureHigh: 22,
  },
  isStarterWardrobe: false,
  outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
    id: `2026-07-16-${scenario}`,
    scenario,
    garmentIds: ['top-1'],
    reasoningBadges: [],
    comfortNotes: 'notes',
    capsuleId: null,
    capsuleName: null,
    autoFilledGarmentIds: [],
    displayGarments: [],
    shopThisLook: null,
  })),
}

describe('PlannerController', () => {
  let app: INestApplication | undefined
  let entitlements: { hasPremiumAccess: ReturnType<typeof vi.fn> }
  let planner: {
    getPlannerWindow: ReturnType<typeof vi.fn>
    reshuffleDay: ReturnType<typeof vi.fn>
  }

  async function boot(options: { entitled?: boolean } = {}): Promise<void> {
    entitlements = {
      hasPremiumAccess: vi.fn().mockResolvedValue(options.entitled ?? true),
    }
    planner = {
      getPlannerWindow: vi.fn().mockResolvedValue(emptyPlannerResponse),
      reshuffleDay: vi
        .fn()
        .mockResolvedValue({ data: { day: readyDay, unchanged: false } }),
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        createHttpTestModule([
          PremiumEntitlementGuard,
          { provide: PremiumEntitlementService, useValue: entitlements },
          { provide: PlannerService, useValue: planner },
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

  const authedGet = (query: Record<string, string> = {}, platform = 'web') =>
    request(server())
      .get(ROUTE)
      .query(query)
      .set({ authorization: `Bearer ${TOKEN}`, 'x-couture-platform': platform })

  const authedPost = (
    planDate: string,
    body: unknown,
    query: Record<string, string> = {},
    platform = 'web'
  ) =>
    request(server())
      .post(`${ROUTE}/${planDate}/reshuffle`)
      .query(query)
      .set({ authorization: `Bearer ${TOKEN}`, 'x-couture-platform': platform })
      .send(body as object)

  describe('gate order', () => {
    it('401s an unauthenticated GET before touching the service', async () => {
      await boot()
      const response = await request(server())
        .get(ROUTE)
        .set({ 'x-couture-platform': 'web' })

      expect(response.status).toBe(401)
      expect(planner.getPlannerWindow).not.toHaveBeenCalled()
    })

    it('403s a non-entitled caller before touching the service', async () => {
      await boot({ entitled: false })
      const response = await authedGet()

      expect(response.status).toBe(403)
      expect(planner.getPlannerWindow).not.toHaveBeenCalled()
    })

    it('401s an unauthenticated reshuffle before touching the service', async () => {
      await boot()
      const response = await request(server())
        .post(`${ROUTE}/2026-07-16/reshuffle`)
        .set({ 'x-couture-platform': 'web' })
        .send({ expectedVersion: 1 })

      expect(response.status).toBe(401)
      expect(planner.reshuffleDay).not.toHaveBeenCalled()
    })

    it('403s a non-entitled reshuffle before touching the service', async () => {
      await boot({ entitled: false })
      const response = await authedPost('2026-07-16', { expectedVersion: 1 })

      expect(response.status).toBe(403)
      expect(planner.reshuffleDay).not.toHaveBeenCalled()
    })
  })

  describe('x-couture-platform header', () => {
    it('rejects GET with a missing platform header', async () => {
      await boot()
      const response = await request(server())
        .get(ROUTE)
        .set({ authorization: `Bearer ${TOKEN}` })

      expect(response.status).toBe(400)
      expect(planner.getPlannerWindow).not.toHaveBeenCalled()
    })

    it('rejects GET with an undeclared platform value', async () => {
      await boot()
      const response = await authedGet({}, 'desktop')

      expect(response.status).toBe(400)
    })

    it('passes the validated platform through to the service', async () => {
      await boot()
      await authedGet({}, 'mobile')

      expect(planner.getPlannerWindow).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        undefined,
        undefined,
        undefined,
        'mobile'
      )
    })
  })

  describe('GET query validation', () => {
    it('rejects an unknown query parameter', async () => {
      await boot()
      const response = await authedGet({ bogus: 'x' })

      expect(response.status).toBe(400)
      expect(planner.getPlannerWindow).not.toHaveBeenCalled()
    })

    it('passes locationId and locale through to the service', async () => {
      await boot()
      await authedGet({ locationId: 'loc-2', locale: 'fr-FR' })

      expect(planner.getPlannerWindow).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        'loc-2',
        undefined,
        'fr-FR',
        'web'
      )
    })

    it('returns the service response parsed through the published contract', async () => {
      await boot()
      const response = await authedGet()

      expect(response.status).toBe(200)
      const parsed = plannerResponseSchema.parse(response.body)
      expect(parsed.data.days).toHaveLength(7)
    })
  })

  describe('reshuffle body and path validation', () => {
    it('rejects a missing expectedVersion', async () => {
      await boot()
      const response = await authedPost('2026-07-16', {})

      expect(response.status).toBe(400)
      expect(planner.reshuffleDay).not.toHaveBeenCalled()
    })

    it('rejects a non-positive expectedVersion', async () => {
      await boot()
      const response = await authedPost('2026-07-16', { expectedVersion: 0 })

      expect(response.status).toBe(400)
    })

    it('passes the path param and body through to the service', async () => {
      await boot()
      await authedPost('2026-07-16', { expectedVersion: 3 }, { locationId: 'loc-2' })

      expect(planner.reshuffleDay).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        '2026-07-16',
        'loc-2',
        undefined,
        undefined,
        3,
        'web'
      )
    })

    it('returns the service response parsed through the published contract', async () => {
      await boot()
      const response = await authedPost('2026-07-16', { expectedVersion: 1 })

      expect(response.status).toBe(200)
      const parsed = plannerReshuffleResponseSchema.parse(response.body)
      expect(parsed.data.day.status).toBe('ready')
      expect(parsed.data.unchanged).toBe(false)
    })
  })
})
