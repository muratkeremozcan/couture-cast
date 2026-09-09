import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { TelemetryModule } from '../telemetry/telemetry.module.js'
import { GuardianModule } from '../guardian/guardian.module.js'
import { WeatherModule } from '../weather/weather.module.js'
import { CommunityController } from './community.controller.js'
import { CommunityRepository } from './community.repository.js'
import { CommunityService } from './community.service.js'
import { CommunityMaintenanceService } from './community-maintenance.service.js'
import { SupabaseCommunityStorageAdapter } from './community-storage.adapter.js'
import { CommunityModerationQueue } from './community-moderation.queue.js'
import { CommunityModerationOutboxDispatcher } from './community-moderation.outbox.js'
import { CommunityModerationActionsService } from './community-moderation.actions.js'

/**
 * `CommunityModerationProcessor` IS DELIBERATELY ABSENT from this module.
 *
 * It is worker-only code. `community-moderation.worker.ts` constructs it by
 * hand, the worker bootstraps hand-wire everything because Nest DI does not run
 * under `tsx` here, and nothing in the request path ever injected it. Listing it
 * as a provider therefore bought no wiring and cost the deployed API the whole
 * screening stack, because Nest instantiates every provider during
 * `NestFactory.create` and, more importantly, the module has to IMPORT the file
 * for the decorator to name it.
 *
 * That import is what took the API preview down. The chain is
 * `app.module` to this module to the processor to
 * `community-moderation.engine` to `community-text-screener` to `bad-words`,
 * and `bad-words@4.1.5` ships CommonJS that `require()`s `badwords-list`, which
 * is ESM-only. Vercel bundles the function with its own CommonJS loader, which
 * refuses that, so the function died on load with `ERR_REQUIRE_ESM` and every
 * route, `/api/health` included, returned `FUNCTION_INVOCATION_FAILED`. Node 24
 * allows `require()` of ESM, which is why every local gate stayed green and why
 * raising the runtime is not available as a fix: the project is already on 24.x.
 *
 * Keeping the screening stack out of the request app is the invariant, not a
 * workaround for one dependency. `community.module.spec.ts` walks the import
 * graph from `app.module.ts` and fails if it reaches the text screener again.
 */
@Module({
  imports: [
    PrismaModule,
    AuthStateModule,
    FeatureFlagsModule,
    WeatherModule,
    TelemetryModule,
    GuardianModule,
  ],
  controllers: [CommunityController],
  providers: [
    CommunityRepository,
    CommunityService,
    CommunityMaintenanceService,
    SupabaseCommunityStorageAdapter,
    CommunityModerationQueue,
    CommunityModerationOutboxDispatcher,
    CommunityModerationActionsService,
    RequestAuthGuard,
    RolesGuard,
  ],
  exports: [
    CommunityService,
    CommunityRepository,
    CommunityMaintenanceService,
    SupabaseCommunityStorageAdapter,
    CommunityModerationQueue,
    CommunityModerationOutboxDispatcher,
    CommunityModerationActionsService,
  ],
})
export class CommunityModule {}
