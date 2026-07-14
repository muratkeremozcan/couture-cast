import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { EventsController } from './events.controller'
import { EventsRepository } from './events.repository'
import { EventsService } from './events.service'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [EventsController],
  providers: [EventsRepository, EventsService, RequestAuthGuard],
})
export class EventsModule {}
