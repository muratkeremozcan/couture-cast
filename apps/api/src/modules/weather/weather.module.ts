import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { systemWeatherClock, WeatherQueryService } from './weather-query.service'
import { WeatherRepository } from './weather.repository'
import { WeatherController } from './weather.controller'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [WeatherController],
  providers: [
    WeatherRepository,
    RequestAuthGuard,
    {
      provide: WeatherQueryService,
      useFactory: (repository: WeatherRepository) =>
        new WeatherQueryService(repository, systemWeatherClock),
      inject: [WeatherRepository],
    },
  ],
})
export class WeatherModule {}
