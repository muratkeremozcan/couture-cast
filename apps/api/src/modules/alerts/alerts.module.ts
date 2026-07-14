import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { AlertsController } from './alerts.controller'
import { PrismaAlertsRepository } from './alerts.repository'
import { AlertsService } from './alerts.service'
import { PrismaWeatherAlertProcessingRepository } from './weather-alert-processing.repository'
import { WeatherAlertProcessingService } from './weather-alert-processing.service'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [AlertsController],
  providers: [
    PrismaAlertsRepository,
    AlertsService,
    PrismaWeatherAlertProcessingRepository,
    WeatherAlertProcessingService,
    RequestAuthGuard,
  ],
  exports: [
    PrismaAlertsRepository,
    AlertsService,
    PrismaWeatherAlertProcessingRepository,
    WeatherAlertProcessingService,
  ],
})
export class AlertsModule {}
