import { Module } from '@nestjs/common'
import { TelemetryService } from './telemetry.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { AnalyticsModule } from '../../analytics/analytics.module'

@Module({
  imports: [PrismaModule, AnalyticsModule],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
