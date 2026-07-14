import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { LocationPreferencesController } from './location-preferences.controller'
import { PrismaLocationPreferencesRepository } from './location-preferences.repository'
import { LocationPreferencesService } from './location-preferences.service'
import { TelemetryModule } from '../telemetry/telemetry.module'

@Module({
  imports: [PrismaModule, AuthStateModule, TelemetryModule],
  controllers: [LocationPreferencesController],
  providers: [
    PrismaLocationPreferencesRepository,
    LocationPreferencesService,
    RequestAuthGuard,
  ],
  exports: [LocationPreferencesService, PrismaLocationPreferencesRepository],
})
export class LocationPreferencesModule {}
