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
import { AuthModule } from './modules/auth/auth.module'
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module'
import { ModerationModule } from './modules/moderation/moderation.module'
import { PostHogService } from './posthog/posthog.service'

// Disable websockets by setting DISABLE_WEBSOCKETS=true (e.g., in specific tests)
const websocketModules = process.env.DISABLE_WEBSOCKETS === 'true' ? [] : [GatewayModule]

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ...websocketModules,
    NotificationsModule,
    EventsModule,
    AuthModule,
    FeatureFlagsModule,
    ModerationModule,
  ],
  controllers: [AppController, HealthController, AdminController],
  providers: [AppService, AdminService, AdminCron, PostHogService],
})
export class AppModule {}
