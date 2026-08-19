// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import {
  Module,
  UnauthorizedException,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREMIUM_REQUIRED_MESSAGE,
  PREMIUM_THEMES_DISABLED_MESSAGE,
} from '../../contracts/http.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { CommerceModule } from './commerce.module.js'
import { PremiumEntitlementGuard } from './premium-entitlement.guard.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'
import { PremiumThemeController } from './premium-theme.controller.js'
import { PremiumThemeService } from './premium-theme.service.js'

/**
 * Story 5.3: the theme routes over real HTTP through a Nest `TestingModule`.
 *
 * These go over HTTP rather than through a hand-built response double for the
 * reason `commerce-preferences.controller.spec.ts` records: Story 4.4 shipped a
 * status-code fix whose unit test spied on a mock `res` and stayed green when
 * the controller was reverted. Guard ordering, status precedence, and a
 * middleware-applied header are all lifecycle facts that only a real request
 * can observe.
 *
 * TWO THINGS ARE DELIBERATELY REAL HERE, because the story's claims rest on
 * them and a stub would make the claims vacuous:
 *
 *  * `PremiumEntitlementGuard` is the production guard, wired to a stubbed
 *    entitlement service. The 403 and the 403-outranks-503 precedence are
 *    therefore produced by the same code path production uses.
 *  * The cache-header binding comes from `CommerceModule.configure` itself,
 *    invoked below rather than copied. If that `forRoutes` path ever stops
 *    covering `/api/v1/commerce/premium/theme` — or the controller's prefix
 *    moves out of it — the header assertion fails here instead of a per-user
 *    response quietly shipping shared-cacheable in production.
 *
 * `RequestAuthGuard` is stubbed, as in the sibling spec: real Supabase token
 * validation is proven in the auth module's own specs, and what these cases
 * need from it is only the authenticated/anonymous distinction.
 */

const AUTHENTICATED_USER_ID = 'user-1'
const TOKEN = 'premium-theme-token'
const ROUTE = '/api/v1/commerce/premium/theme'

type StoredRow = { theme: unknown }

type UpsertArgs = {
  where: { user_id: string }
  create: { user_id: string; theme: unknown }
  update: { theme: unknown }
}

/**
 * Same in-memory Prisma double as `premium-theme.service.spec.ts`: a write and
 * the read that follows it have to agree for the persistence cases to mean
 * anything.
 */
function createThemeStore(seed?: StoredRow) {
  const rows = new Map<string, StoredRow>()
  if (seed) {
    rows.set(AUTHENTICATED_USER_ID, seed)
  }

  const premiumThemePreference = {
    findUnique: vi.fn(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(rows.get(where.user_id) ?? null)
    ),
    upsert: vi.fn(({ where, create, update }: UpsertArgs) => {
      const existing = rows.get(where.user_id)
      const next: StoredRow = existing
        ? { ...existing, ...update }
        : { theme: create.theme }
      rows.set(where.user_id, next)
      return Promise.resolve(next)
    }),
    delete: vi.fn(({ where }: { where: { user_id: string } }) => {
      rows.delete(where.user_id)
      return Promise.resolve({})
    }),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  }

  return { rows, premiumThemePreference }
}

/**
 * The test module carries the REAL commerce middleware binding. `Module(...)`
 * is applied as a plain function rather than as decorator syntax so this file
 * needs no decorator transform of its own.
 */
function createHttpTestModule(providers: Provider[]) {
  class PremiumThemeHttpTestModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      new CommerceModule().configure(consumer)
    }
  }

  Module({ controllers: [PremiumThemeController], providers })(PremiumThemeHttpTestModule)
  return PremiumThemeHttpTestModule
}

describe('PremiumThemeController', () => {
  let app: INestApplication | undefined
  let store: ReturnType<typeof createThemeStore>
  let entitlements: { hasPremiumAccess: ReturnType<typeof vi.fn> }
  let featureFlags: { getFeatureFlag: ReturnType<typeof vi.fn> }
  let telemetry: { captureEvent: ReturnType<typeof vi.fn> }

  async function boot(
    options: { entitled?: boolean; flag?: boolean; stored?: StoredRow } = {}
  ): Promise<void> {
    store = createThemeStore(options.stored)
    entitlements = {
      hasPremiumAccess: vi.fn().mockResolvedValue(options.entitled ?? true),
    }
    featureFlags = { getFeatureFlag: vi.fn().mockResolvedValue(options.flag ?? true) }
    telemetry = { captureEvent: vi.fn().mockResolvedValue(undefined) }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        createHttpTestModule([
          PremiumThemeService,
          PremiumEntitlementGuard,
          {
            provide: PrismaClient,
            useValue: { premiumThemePreference: store.premiumThemePreference },
          },
          { provide: PremiumEntitlementService, useValue: entitlements },
          { provide: FeatureFlagsService, useValue: featureFlags },
          { provide: TelemetryService, useValue: telemetry },
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
          req.auth = { token: TOKEN, userId: AUTHENTICATED_USER_ID, role: 'teen' }
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

  const authorizedGet = (path = ROUTE) =>
    request(server())
      .get(path)
      .set({ authorization: `Bearer ${TOKEN}` })

  const authorizedPut = (body: unknown, path = ROUTE) =>
    request(server())
      .put(path)
      .set({ authorization: `Bearer ${TOKEN}` })
      .send(body as object)

  describe('authentication', () => {
    beforeEach(async () => {
      await boot()
    })

    it.each([
      { name: 'read', send: () => request(server()).get(ROUTE) },
      { name: 'write', send: () => request(server()).put(ROUTE).send({ theme: null }) },
    ])('rejects an unauthenticated $name with 401', async ({ send }) => {
      const response = await send()

      expect(response.status).toBe(401)
      expect(store.premiumThemePreference.upsert).not.toHaveBeenCalled()
    })
  })

  describe('GET: every signed-in caller gets an answer', () => {
    it('returns the stored palette for an entitled caller', async () => {
      await boot({ stored: { theme: 'jewel_radiance' } })

      const response = await authorizedGet()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        data: { theme: 'jewel_radiance', isEntitled: true, themesEnabled: true },
      })
    })

    it('answers 200 with the locked shape for a non-entitled caller', async () => {
      // Not entitlement-gated on purpose: this response is what drives the
      // locked upsell panel, so a 403 here would leave clients nothing to render.
      await boot({ entitled: false, stored: { theme: 'autumn_umber' } })

      const response = await authorizedGet()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        data: { theme: null, isEntitled: false, themesEnabled: true },
      })
    })

    it('5.3-API-011 answers 200 with Default for a stored key that is no longer shipped', async () => {
      await boot({ stored: { theme: 'spring_bloom' } })

      const response = await authorizedGet()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        data: { theme: null, isEntitled: true, themesEnabled: true },
      })
    })
  })

  describe('PUT: entitlement guard, kill switch, and schema', () => {
    it('5.3-API-010 answers 403 with the guard message for a non-entitled caller', async () => {
      await boot({ entitled: false })

      const response = await authorizedPut({ theme: 'jewel_radiance' })

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject({ message: PREMIUM_REQUIRED_MESSAGE })
      expect(store.premiumThemePreference.upsert).not.toHaveBeenCalled()
    })

    it('5.3-API-015 answers 403 rather than 503 when a non-entitled caller writes with the flag off', async () => {
      await boot({ entitled: false, flag: false })

      const response = await authorizedPut({ theme: 'jewel_radiance' })

      expect(response.status).toBe(403)
      expect(response.body).toMatchObject({ message: PREMIUM_REQUIRED_MESSAGE })
      // Structural, not incidental: the guard runs pre-handler and the flag
      // check lives in the service body, so a non-entitled caller cannot learn
      // the kill switch's state FROM THE WRITE PATH (Decision 9). Scoped to the
      // write on purpose — Decision 9's response table puts `themesEnabled` on
      // every GET, and the read-path case above asserts a non-entitled caller
      // receives it. The claim is about which status a refused write reports,
      // not about hiding the flag.
      expect(featureFlags.getFeatureFlag).not.toHaveBeenCalled()
    })

    it('answers 503 with the kill-switch message for an entitled caller while the flag is off', async () => {
      await boot({ flag: false })

      const response = await authorizedPut({ theme: 'jewel_radiance' })

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({ message: PREMIUM_THEMES_DISABLED_MESSAGE })
      expect(store.premiumThemePreference.upsert).not.toHaveBeenCalled()
    })

    it('answers 503 rather than 400 for a malformed body while the flag is off', async () => {
      // A disabled feature answers the same way to every write attempt rather
      // than leaking which payloads it would have accepted.
      await boot({ flag: false })

      const response = await authorizedPut({ theme: 'midnight_noir' })

      expect(response.status).toBe(503)
    })

    it('stores a selection and answers 200 with the freshly resolved state', async () => {
      await boot()

      const response = await authorizedPut({ theme: 'winter_metallic' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        data: { theme: 'winter_metallic', isEntitled: true, themesEnabled: true },
      })
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        'premium_theme_selected',
        { theme: 'winter_metallic' }
      )
    })

    // `5.3-API-013` is the service spec's, matching Task 4's "assert reset semantics at
    // the repository level"; this is the HTTP-level sibling and carries its own id.
    it('5.3-API-019 resets with { theme: null }, keeps the row, and reads back Default', async () => {
      await boot({ stored: { theme: 'jewel_radiance' } })

      const reset = await authorizedPut({ theme: null })

      expect(reset.status).toBe(200)
      expect(reset.body).toEqual({
        data: { theme: null, isEntitled: true, themesEnabled: true },
      })
      expect(store.rows.size).toBe(1)
      expect(store.rows.get(AUTHENTICATED_USER_ID)).toEqual({ theme: null })
      expect(store.premiumThemePreference.delete).not.toHaveBeenCalled()
      expect(store.premiumThemePreference.deleteMany).not.toHaveBeenCalled()

      const readBack = await authorizedGet()

      expect(readBack.status).toBe(200)
      expect(readBack.body).toEqual({
        data: { theme: null, isEntitled: true, themesEnabled: true },
      })
    })

    it.each([
      { name: 'an unknown palette key', body: { theme: 'midnight_noir' } },
      { name: 'a missing theme key', body: {} },
      { name: 'a non-string theme', body: { theme: 3 } },
      {
        name: 'an unknown extra key',
        body: { theme: 'jewel_radiance', userId: 'user-2' },
      },
    ])('rejects $name with 400 before touching the database', async ({ body }) => {
      await boot()

      const response = await authorizedPut(body)

      expect(response.status).toBe(400)
      expect(store.premiumThemePreference.upsert).not.toHaveBeenCalled()
    })
  })

  describe('cross-user authorization is structural, not checked', () => {
    it('5.3-API-016 exposes no id path parameter on either method', async () => {
      // The acting user from RequestAuthGuard is the only subject these routes
      // can answer about. Adding `@Get(':userId')` turns this red.
      await boot()

      const read = await authorizedGet(`${ROUTE}/user-2`)
      const write = await authorizedPut({ theme: null }, `${ROUTE}/user-2`)

      expect(read.status).toBe(404)
      expect(write.status).toBe(404)
    })

    it('writes for the authenticated user even when the request names another', async () => {
      await boot()

      const response = await authorizedPut(
        { theme: 'autumn_umber' },
        `${ROUTE}?userId=user-2`
      )

      expect(response.status).toBe(200)
      expect(store.premiumThemePreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: AUTHENTICATED_USER_ID } })
      )
      expect(store.rows.has('user-2')).toBe(false)
    })
  })

  describe('cache headers inherited from the commerce prefix (Decision 9)', () => {
    it('5.3-API-014 carries Cache-Control: private, no-store on a successful read', async () => {
      await boot({ stored: { theme: 'jewel_radiance' } })

      const response = await authorizedGet()

      expect(response.status).toBe(200)
      expect(response.headers['cache-control']).toBe('private, no-store')
    })

    it('carries the header on the error paths too, which is why it is middleware', async () => {
      // A 503 a proxy is free to cache would keep the kill switch stuck on long
      // after an operator turned the feature back on.
      await boot({ flag: false })

      const response = await authorizedPut({ theme: 'jewel_radiance' })

      expect(response.status).toBe(503)
      expect(response.headers['cache-control']).toBe('private, no-store')
    })
  })

  /**
   * Everything above runs against the hand-assembled module at the top of this
   * file, which proves the controller's own behaviour and proves nothing about
   * whether production ever mounts it. Reading `CommerceModule`'s own metadata
   * closes that gap without a database: the integration tier compiles the real
   * module, but it skips itself when no database is reachable, so registration
   * would otherwise be unverified on exactly the runs that gate a pull request.
   * Same `Reflect.getMetadata` technique story 5.2 used to keep its fixture
   * controller OUT of the production module (5.2-API-015), inverted.
   */
  describe('registration in the production module', () => {
    it('5.3-API-017 mounts the controller and the service on CommerceModule', () => {
      const controllers = (Reflect.getMetadata('controllers', CommerceModule) ??
        []) as unknown[]
      const providers = (Reflect.getMetadata('providers', CommerceModule) ??
        []) as unknown[]

      expect(controllers).toContain(PremiumThemeController)
      expect(providers).toContain(PremiumThemeService)
      // The guard the PUT mounts has to be resolvable from this module too; it
      // is injected per-route rather than globally, so an unregistered provider
      // fails at request time in production rather than at boot.
      expect(providers).toContain(PremiumEntitlementGuard)
    })
  })
})
