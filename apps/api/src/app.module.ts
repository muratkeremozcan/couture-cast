import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AnalyticsModule } from './analytics/analytics.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ApiHealthController } from './controllers/api-health.controller'
import { HealthController } from './controllers/health.controller'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'
import { AdminCron } from './admin/admin.cron'
import { GatewayModule } from './modules/gateway/gateway.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { EventsModule } from './modules/events/events.module'
import { AuthModule } from './modules/auth/auth.module'
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module'
import { GuardianModule } from './modules/guardian/guardian.module'
import { ModerationModule } from './modules/moderation/moderation.module'
import { UserModule } from './modules/user/user.module'

// Disable websockets by setting DISABLE_WEBSOCKETS=true (e.g., in specific tests)
const websocketModules = process.env.DISABLE_WEBSOCKETS === 'true' ? [] : [GatewayModule]

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AnalyticsModule,
    ...websocketModules,
    NotificationsModule,
    EventsModule,
    AuthModule,
    GuardianModule,
    FeatureFlagsModule,
    ModerationModule,
    UserModule,
  ],
  controllers: [AppController, ApiHealthController, HealthController, AdminController],
  providers: [AppService, AdminService, AdminCron],
})
export class AppModule {}
