import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HealthController } from './controllers/health.controller'
import { AdminController } from './admin/admin.controller'
import { AdminService } from './admin/admin.service'
import { AdminCron } from './admin/admin.cron'

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, AdminController],
  providers: [AppService, AdminService, AdminCron],
})
export class AppModule {}
