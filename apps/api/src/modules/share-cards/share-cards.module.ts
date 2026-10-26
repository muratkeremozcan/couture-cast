import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { CommunityModule } from '../community/community.module.js'
import { ShareCardsController } from './share-cards.controller.js'
import { ShareCardsService } from './share-cards.service.js'
import { ShareCardSourceRepository } from './share-card-source.repository.js'
import { ShareCardRenderer } from './share-card-renderer.js'

@Module({
  imports: [PrismaModule, AuthStateModule, CommunityModule],
  controllers: [ShareCardsController],
  providers: [
    RequestAuthGuard,
    ShareCardsService,
    ShareCardSourceRepository,
    ShareCardRenderer,
  ],
})
export class ShareCardsModule {}
