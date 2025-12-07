import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HealthController } from './controllers/health.controller'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'
import { AdminCron } from './admin/admin.cron'
import { GatewayModule } from './modules/gateway/gateway.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { EventsModule } from './modules/events/events.module'

// Disable websockets by setting DISABLE_WEBSOCKETS=true (e.g., in specific tests)
const websocketModules = process.env.DISABLE_WEBSOCKETS === 'true' ? [] : [GatewayModule]

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ...websocketModules,
    NotificationsModule,
    EventsModule,
  ],
  controllers: [AppController, HealthController, AdminController],
  providers: [AppService, AdminService, AdminCron],
})
export class AppModule {}
