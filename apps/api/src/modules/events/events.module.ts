import { Module } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { EventsController } from './events.controller'
import { EventsRepository } from './events.repository'
import { EventsService } from './events.service'

@Module({
  controllers: [EventsController],
  providers: [
    EventsRepository,
    EventsService,
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
  ],
})
export class EventsModule {}
