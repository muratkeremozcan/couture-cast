import { Module } from '@nestjs/common'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { CommunityModule } from '../community/community.module.js'
import { WardrobeModule } from '../wardrobe/wardrobe.module.js'
import { PhotoAiConsentController } from './photo-ai-consent.controller.js'
import { PhotoAiExecutionService } from './photo-ai-execution.service.js'
import { PhotoAiGrantGate } from './photo-ai-grant-gate.js'
import { PHOTO_AI_POLICY, PRODUCTION_PHOTO_AI_POLICY } from './photo-ai-policy.js'
import { PhotoAiSourceService } from './photo-ai-source.service.js'

@Module({
  imports: [CommunityModule, WardrobeModule],
  controllers: [PhotoAiConsentController],
  providers: [
    RequestAuthGuard,
    PhotoAiExecutionService,
    PhotoAiGrantGate,
    PhotoAiSourceService,
    { provide: PHOTO_AI_POLICY, useValue: PRODUCTION_PHOTO_AI_POLICY },
  ],
  exports: [PhotoAiExecutionService],
})
export class PhotoAiModule {}
