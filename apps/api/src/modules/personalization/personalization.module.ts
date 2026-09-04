import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module.js'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { WeatherModule } from '../weather/weather.module.js'
import { LocationPreferencesModule } from '../location-preferences/location-preferences.module.js'
import { CommerceModule } from '../commerce/commerce.module.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { TelemetryModule } from '../telemetry/telemetry.module.js'
import { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import { RitualController } from './ritual.controller.js'
import { RitualService, RITUAL_REDIS_CLIENT } from './ritual.service.js'
import { RITUAL_CACHE_INVALIDATOR } from './ritual-cache.js'
import { ComfortController } from './comfort.controller.js'
import { ComfortService } from './comfort.service.js'
import { PlannerController } from './planner.controller.js'
import { PlannerService } from './planner.service.js'
import Redis from 'ioredis'
import { getRedisConfig, redisOptionsFromConfig } from '../../config/redis.js'

@Module({
  imports: [
    AnalyticsModule,
    PrismaModule,
    AuthStateModule,
    WeatherModule,
    LocationPreferencesModule,
    // Story 5.1: one-way. CommerceModule must never import this module back.
    CommerceModule,
    // Story 5.5 Decision 6: CommerceModule exports PremiumEntitlementService/
    // Guard but not FeatureFlagsService/TelemetryService, so the planner
    // imports both directly rather than reaching through CommerceModule.
    FeatureFlagsModule,
    TelemetryModule,
  ],
  controllers: [RitualController, ComfortController, PlannerController],
  providers: [
    RitualService,
    ComfortService,
    PlannerService,
    // Story 5.5: also provided directly by CommerceModule and WardrobeModule,
    // which each register their own instance of this stateless, self-
    // configuring (env-var-only constructor) adapter rather than exporting
    // one across modules.
    SupabaseWardrobeStorageAdapter,
    RequestAuthGuard,
    // The wardrobe retention purge only ever clears a user's ritual cache, so
    // it depends on this narrow token instead of the whole `RitualService`.
    // That is what lets the purge run in the worker runtime, where the full
    // ritual graph (weather, locations, commerce) has no reason to exist.
    {
      provide: RITUAL_CACHE_INVALIDATOR,
      useExisting: RitualService,
    },
    {
      provide: RITUAL_REDIS_CLIENT,
      useFactory: () => {
        const config = getRedisConfig()
        const baseOptions = redisOptionsFromConfig(config)
        return new Redis(config.url, {
          ...baseOptions,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 1000,
        })
      },
    },
  ],
  exports: [RitualService, ComfortService, RITUAL_CACHE_INVALIDATOR],
})
export class PersonalizationModule {}
