import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { WeatherModule } from '../weather/weather.module.js'
import { LocationPreferencesModule } from '../location-preferences/location-preferences.module.js'
import { RitualController } from './ritual.controller.js'
import { RitualService, RITUAL_REDIS_CLIENT } from './ritual.service.js'
import Redis from 'ioredis'
import { getRedisConfig, redisOptionsFromConfig } from '../../config/redis.js'

@Module({
  imports: [PrismaModule, AuthStateModule, WeatherModule, LocationPreferencesModule],
  controllers: [RitualController],
  providers: [
    RitualService,
    RequestAuthGuard,
    {
      provide: RITUAL_REDIS_CLIENT,
      useFactory: () => {
        const config = getRedisConfig()
        return new Redis(config.url, redisOptionsFromConfig(config))
      },
    },
  ],
  exports: [RitualService],
})
export class PersonalizationModule {}
