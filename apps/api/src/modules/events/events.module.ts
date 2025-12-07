import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { EventsController } from './events.controller'
import { EventsRepository } from './events.repository'
import { EventsService } from './events.service'

@Module({
  imports: [PrismaModule],
  controllers: [EventsController],
  providers: [EventsRepository, EventsService],
})
export class EventsModule {}
