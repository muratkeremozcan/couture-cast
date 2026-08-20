import { Module } from '@nestjs/common'
import { AnalyticsModule } from './analytics/analytics.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ApiHealthController } from './controllers/api-health.controller'
import { HealthController } from './controllers/health.controller'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'
import { AlertsModule } from './modules/alerts/alerts.module'
import { GatewayModule } from './modules/gateway/gateway.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { EventsModule } from './modules/events/events.module'
import { AuthModule } from './modules/auth/auth.module'
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module'
import { GuardianModule } from './modules/guardian/guardian.module'
import { ModerationModule } from './modules/moderation/moderation.module'
import { UserModule } from './modules/user/user.module'
import { WeatherModule } from './modules/weather/weather.module'
import { LocationPreferencesModule } from './modules/location-preferences/location-preferences.module'
import { TelemetryModule } from './modules/telemetry/telemetry.module'
import { PersonalizationModule } from './modules/personalization/personalization.module.js'
import { WardrobeModule } from './modules/wardrobe/wardrobe.module'
import { CommerceModule } from './modules/commerce/commerce.module.js'

// `ScheduleModule` is deliberately absent. Every periodic sweep this app used
// to declare with `@Cron` now runs as a BullMQ Job Scheduler in the worker
// runtime (`workers/maintenance.scheduler.ts`). This app is deployed as a
// Vercel serverless function, which has no process alive between requests to
// hold a timer, so a `@Cron` here has never provably fired in production.

// Disable websockets by setting DISABLE_WEBSOCKETS=true (e.g., in specific tests)
const websocketModules = process.env.DISABLE_WEBSOCKETS === 'true' ? [] : [GatewayModule]

@Module({
  imports: [
    AnalyticsModule,
    AlertsModule,
    ...websocketModules,
    NotificationsModule,
    EventsModule,
    AuthModule,
    GuardianModule,
    FeatureFlagsModule,
    ModerationModule,
    UserModule,
    LocationPreferencesModule,
    WeatherModule,
    TelemetryModule,
    PersonalizationModule,
    WardrobeModule,
    CommerceModule,
  ],
  controllers: [AppController, ApiHealthController, HealthController, AdminController],
  providers: [AppService, AdminService],
})
export class AppModule {}
