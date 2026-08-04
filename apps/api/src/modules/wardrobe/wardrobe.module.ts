import { Module } from '@nestjs/common'
import { GuardianModule } from '../guardian/guardian.module'
import { TelemetryModule } from '../telemetry/telemetry.module'
import { WardrobeController } from './wardrobe.controller'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'

@Module({
  imports: [GuardianModule, TelemetryModule],
  controllers: [WardrobeController],
  providers: [WardrobeService, WardrobeUploadGuard],
  exports: [WardrobeService],
})
export class WardrobeModule {}
