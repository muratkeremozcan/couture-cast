// Step 22 step 6 owner: mock localized database state response in Pact provider tests in pact/http/provider/provider-helper.ts

import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Prisma } from '@prisma/client'
import { existsSync, mkdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { NextFunction, Request, Response } from 'express'
import { ApiHealthController } from '../../../apps/api/src/controllers/api-health.controller'
import { HealthController } from '../../../apps/api/src/controllers/health.controller'
import { AccessTokenIdentityService } from '../../../apps/api/src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../../../apps/api/src/modules/auth/guardian-consent-state.service'
import { GuardianService } from '../../../apps/api/src/modules/guardian/guardian.service'
import { RequestAuthGuard } from '../../../apps/api/src/modules/auth/security.guards'
import { EventsController } from '../../../apps/api/src/modules/events/events.controller'
import { EventsRepository } from '../../../apps/api/src/modules/events/events.repository'
import { EventsService } from '../../../apps/api/src/modules/events/events.service'
import { RitualController } from '../../../apps/api/src/modules/personalization/ritual.controller'
import { RitualService } from '../../../apps/api/src/modules/personalization/ritual.service'
import { PlannerController } from '../../../apps/api/src/modules/personalization/planner.controller'
import { PlannerService } from '../../../apps/api/src/modules/personalization/planner.service'
import { CommunityController } from '../../../apps/api/src/modules/community/community.controller'
import { CommunityService } from '../../../apps/api/src/modules/community/community.service'
import { ComfortController } from '../../../apps/api/src/modules/personalization/comfort.controller'
import { ComfortService } from '../../../apps/api/src/modules/personalization/comfort.service'
import { UserController } from '../../../apps/api/src/modules/user/user.controller'
import { UserService } from '../../../apps/api/src/modules/user/user.service'
import { WardrobeController } from '../../../apps/api/src/modules/wardrobe/wardrobe.controller'
import { WardrobeService } from '../../../apps/api/src/modules/wardrobe/wardrobe.service'
import { WardrobeRetentionService } from '../../../apps/api/src/modules/wardrobe/wardrobe-retention.service'
import { WardrobeUploadGuard } from '../../../apps/api/src/modules/wardrobe/wardrobe.guard'
import { WardrobeCapsuleController } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.controller'
// The `.js` specifier must match how wardrobe-capsule.controller.ts imports this
// module. Resolving it both ways yields two distinct class objects, and the
// controller's injection token then never matches this provider.
import { WardrobeCapsuleService } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.service.js'
import { CapsuleCacheHeadersMiddleware } from '../../../apps/api/src/modules/wardrobe/wardrobe-capsule.cache-headers.middleware'
import { WardrobeOnboardingController } from '../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.controller'
import { WardrobeOnboardingService } from '../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.service'
import { WardrobeSilhouetteController } from '../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.controller'
import { AffiliateClickController } from '../../../apps/api/src/modules/commerce/affiliate-click.controller'
import { AffiliateClickService } from '../../../apps/api/src/modules/commerce/affiliate-click.service'
import { AffiliateOfferService } from '../../../apps/api/src/modules/commerce/affiliate-offer.service'
import { AffiliateWebhookController } from '../../../apps/api/src/modules/commerce/affiliate-webhook.controller'
import { AffiliateWebhookService } from '../../../apps/api/src/modules/commerce/affiliate-webhook.service'
import { CommerceCacheHeadersMiddleware } from '../../../apps/api/src/modules/commerce/commerce-cache-headers.middleware'
import { CommercePreferencesController } from '../../../apps/api/src/modules/commerce/commerce-preferences.controller'
import { CommercePreferencesService } from '../../../apps/api/src/modules/commerce/commerce-preferences.service'
import { SubscriptionController } from '../../../apps/api/src/modules/commerce/subscription.controller'
import { SubscriptionService } from '../../../apps/api/src/modules/commerce/subscription.service'
import { StripeBillingService } from '../../../apps/api/src/modules/commerce/stripe-billing.service'
import { PremiumThemeController } from '../../../apps/api/src/modules/commerce/premium-theme.controller'
import { PremiumThemeService } from '../../../apps/api/src/modules/commerce/premium-theme.service'
import { PaletteAdvisorController } from '../../../apps/api/src/modules/commerce/palette-advisor.controller'
import { PaletteAdvisorService } from '../../../apps/api/src/modules/commerce/palette-advisor.service'
import { PremiumEntitlementGuard } from '../../../apps/api/src/modules/commerce/premium-entitlement.guard'
import { PremiumEntitlementService } from '../../../apps/api/src/modules/commerce/premium-entitlement.service'
import { WardrobeSilhouetteService } from '../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.service'
// `SilhouettePhotoFailureReason` is not part of the curated top-level
// @couture/api-client barrel (packages/api-client/src/index.ts); the
// contracts/http subpath re-exports everything from wardrobe.ts instead.

import { createIdentityDoubles } from './doubles/identity'
import { createRitualDoubles } from './doubles/ritual'
import { createWardrobeDoubles } from './doubles/wardrobe'
import { createCapsulesDoubles } from './doubles/capsules'
import { createOnboardingDoubles } from './doubles/onboarding'
import { createSilhouetteDoubles } from './doubles/silhouette'
import { createGuardianDoubles } from './doubles/guardian'
import { createCommerceAffiliateDoubles } from './doubles/commerce-affiliate'
import { createSubscriptionDoubles } from './doubles/subscription'
import { createPremiumThemeDoubles } from './doubles/premium-theme'
import { createPremiumEntitlementDouble } from './doubles/premium-entitlement'
import { createPaletteAdvisorDoubles } from './doubles/palette-advisor'
import { createPlannerDoubles } from './doubles/planner'
import { createCommunityDoubles } from './doubles/community'
import {
  resetProviderCapsuleState,
  resetProviderCommerceState,
  resetProviderOnboardingState,
  resetProviderPaletteAdvisorState,
  resetProviderPlannerState,
  resetProviderCommunityState,
  resetProviderPremiumThemeState,
  resetProviderSilhouetteState,
  resetProviderSubscriptionState,
  resetProviderWardrobeState,
} from './state'

/**
 * Re-exported so `state-handlers.ts` and every other caller keeps importing
 * scenario state from this module exactly as before.
 */
export * from './state'

export type PactEvent = {
  id: string
  channel: string
  payload: Prisma.JsonValue
  userId: string | null
  createdAt: string
}

type ProviderEventEnvelope = {
  id: string
  channel: string
  payload: Prisma.JsonValue
  user_id: string | null
  created_at: Date
  updated_at: Date
}

type StartedPactProvider = {
  app: INestApplication
  providerBaseUrl: string
}

let providerEvents: ProviderEventEnvelope[] = []

export function resetProviderState() {
  providerEvents = []
  resetProviderWardrobeState()
  resetProviderOnboardingState()
  resetProviderSilhouetteState()
  resetProviderCapsuleState()
  resetProviderCommerceState()
  resetProviderSubscriptionState()
  resetProviderPremiumThemeState()
  resetProviderPaletteAdvisorState()
  resetProviderPlannerState()
  resetProviderCommunityState()
}

export function parsePactEvent(event: PactEvent | string) {
  if (typeof event === 'string') {
    return JSON.parse(event) as PactEvent
  }

  return event
}

export function configureProviderEvent(event: PactEvent) {
  providerEvents = [
    {
      id: event.id,
      channel: event.channel,
      payload: event.payload,
      user_id: event.userId,
      created_at: new Date(event.createdAt),
      updated_at: new Date(event.createdAt),
    },
  ]
}

const eventsRepository = {
  findSince(userId: string, since?: Date) {
    return Promise.resolve(
      providerEvents.filter(
        (event) =>
          (event.user_id === userId || event.user_id === null) &&
          (!since || event.created_at > since)
      )
    )
  },
  create() {
    return Promise.reject(
      new Error('Pact provider verification does not seed events through create()')
    )
  },
} satisfies Pick<EventsRepository, 'findSince' | 'create'>

function assertPactFilesExist(pactFiles: string[]) {
  const missing = pactFiles.filter((pactFile) => !existsSync(pactFile))

  if (missing.length > 0) {
    throw new Error(
      `Missing local pact file(s):\n${missing.join('\n')}\nRun npm run test:pact:consumer first.`
    )
  }
}

function resolveProviderBaseUrl(app: INestApplication) {
  const server = app.getHttpServer() as { address(): AddressInfo | string | null }
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Pact provider did not start on a TCP port')
  }

  return `http://127.0.0.1:${address.port}`
}

export async function startLocalPactProvider({
  artifactsDir,
  pactFiles,
}: {
  artifactsDir: string
  pactFiles: string[]
}): Promise<StartedPactProvider> {
  assertPactFilesExist(pactFiles)
  mkdirSync(artifactsDir, { recursive: true })
  resetProviderState()
  // Every double the fixture registers, composed from `doubles/`.
  const { guardianConsentStateService, accessTokenIdentityService } =
    createIdentityDoubles()
  const { mockRitualService, mockComfortService, mockUserService } = createRitualDoubles()
  const { mockWardrobeService, mockWardrobeRetentionService } = createWardrobeDoubles()
  const { mockWardrobeCapsuleService } = createCapsulesDoubles()
  const { mockWardrobeOnboardingService } = createOnboardingDoubles()
  const { mockWardrobeSilhouetteService } = createSilhouetteDoubles()
  const { mockGuardianService } = createGuardianDoubles()
  const {
    mockAffiliateOfferService,
    mockCommercePreferencesService,
    mockAffiliateClickService,
    mockAffiliateWebhookService,
  } = createCommerceAffiliateDoubles()
  const { mockSubscriptionService, mockStripeBillingService } =
    createSubscriptionDoubles()
  const { mockPremiumThemeService } = createPremiumThemeDoubles()
  const { mockPremiumEntitlementService } = createPremiumEntitlementDouble()
  const { mockPaletteAdvisorService } = createPaletteAdvisorDoubles()
  const { mockPlannerService } = createPlannerDoubles()
  const { mockCommunityService } = createCommunityDoubles()
  const moduleFixture = await Test.createTestingModule({
    controllers: [
      ApiHealthController,
      HealthController,
      EventsController,
      RitualController,
      ComfortController,
      UserController,
      WardrobeController,
      WardrobeCapsuleController,
      WardrobeOnboardingController,
      WardrobeSilhouetteController,
      CommercePreferencesController,
      AffiliateClickController,
      AffiliateWebhookController,
      SubscriptionController,
      PremiumThemeController,
      PaletteAdvisorController,
      PlannerController,
      CommunityController,
    ],
    providers: [
      EventsService,
      {
        provide: EventsRepository,
        useValue: eventsRepository,
      },
      {
        provide: GuardianConsentStateService,
        useValue: guardianConsentStateService,
      },
      {
        provide: GuardianService,
        useValue: mockGuardianService,
      },
      {
        provide: AccessTokenIdentityService,
        useValue: accessTokenIdentityService,
      },
      {
        provide: RitualService,
        useValue: mockRitualService,
      },
      {
        provide: ComfortService,
        useValue: mockComfortService,
      },
      {
        provide: UserService,
        useValue: mockUserService,
      },
      {
        provide: WardrobeService,
        useValue: mockWardrobeService,
      },
      {
        provide: WardrobeRetentionService,
        useValue: mockWardrobeRetentionService,
      },
      {
        provide: WardrobeUploadGuard,
        useFactory: () => new WardrobeUploadGuard(mockGuardianService),
      },
      {
        provide: WardrobeCapsuleService,
        useValue: mockWardrobeCapsuleService,
      },
      {
        provide: WardrobeOnboardingService,
        useValue: mockWardrobeOnboardingService,
      },
      {
        provide: WardrobeSilhouetteService,
        useValue: mockWardrobeSilhouetteService,
      },
      {
        provide: AffiliateOfferService,
        useValue: mockAffiliateOfferService,
      },
      {
        provide: CommercePreferencesService,
        useValue: mockCommercePreferencesService,
      },
      {
        provide: AffiliateClickService,
        useValue: mockAffiliateClickService,
      },
      {
        provide: AffiliateWebhookService,
        useValue: mockAffiliateWebhookService,
      },
      {
        provide: SubscriptionService,
        useValue: mockSubscriptionService,
      },
      {
        provide: StripeBillingService,
        useValue: mockStripeBillingService,
      },
      {
        provide: PremiumThemeService,
        useValue: mockPremiumThemeService,
      },
      {
        provide: PaletteAdvisorService,
        useValue: mockPaletteAdvisorService,
      },
      {
        provide: PlannerService,
        useValue: mockPlannerService,
      },
      {
        provide: CommunityService,
        useValue: mockCommunityService,
      },
      {
        provide: PremiumEntitlementService,
        useValue: mockPremiumEntitlementService,
      },
      // Deliberately NOT overridden with a mock/useValue, unlike every
      // service above: the guard's own `canActivate` logic must actually run
      // in this fixture, exercised against the mocked
      // `PremiumEntitlementService` above -- same real-instance stance as
      // `RequestAuthGuard`, which is likewise never given a fake
      // implementation (it is overridden below only to hand it its real
      // constructor args explicitly; here plain Nest DI already has
      // `PremiumEntitlementService` in this module's providers, so
      // registering the bare class is enough for DI to construct a real
      // instance with it wired in).
      PremiumEntitlementGuard,
    ],
  })
    .overrideGuard(RequestAuthGuard)
    .useValue(
      new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
    )
    .compile()

  /**
   * `rawBody: true` matches all three real bootstraps (`src/main.ts`,
   * `api/index.ts`, and the webhook integration spec). Without it
   * `request.rawBody` is undefined here, the webhook double would read an empty
   * body, and the 400 interaction would pass for the wrong reason.
   */
  const localApp = moduleFixture.createNestApplication({ rawBody: true })

  // WardrobeModule applies this through `configure`, which a bare testing module
  // never calls. Without it every capsule response, including errors, would be
  // missing the `Cache-Control: private, no-store` the contract pins.
  // Story 4.4: `wardrobe.module.ts`'s real `configure()` applies this same
  // middleware to `/api/v1/wardrobe/onboarding{/*path}` and
  // `/api/v1/wardrobe/silhouette{/*path}` too (not just capsules), for the
  // identical reason -- reused as-is here rather than reimplemented.
  const capsuleCacheHeaders = new CapsuleCacheHeadersMiddleware()
  localApp.use('/api/v1/wardrobe', (req: Request, res: Response, next: NextFunction) => {
    if (
      /^\/[^/]+\/capsules(\/|$|\?)/.test(req.url) ||
      /^\/onboarding(\/|$|\?)/.test(req.url) ||
      /^\/silhouette(\/|$|\?)/.test(req.url)
    ) {
      capsuleCacheHeaders.use(req, res, next)
      return
    }
    next()
  })

  /**
   * `commerce.module.ts` applies this through `configure`, which a bare testing
   * module never calls. Without it every commerce response, including the 403,
   * 404, and 503 the contract records, would be missing the
   * `Cache-Control: private, no-store` those interactions pin.
   */
  const commerceCacheHeaders = new CommerceCacheHeadersMiddleware()
  localApp.use('/api/v1/commerce', (req: Request, res: Response, next: NextFunction) => {
    commerceCacheHeaders.use(req, res, next)
  })

  await localApp.init()
  await localApp.listen(0, '127.0.0.1')

  return {
    app: localApp,
    providerBaseUrl: resolveProviderBaseUrl(localApp),
  }
}
