import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { AdminService } from './admin.service'

@Injectable()
export class AdminCron {
  private readonly logger = new Logger(AdminCron.name)

  constructor(private readonly adminService: AdminService) {}

  @Cron('0 3 * * *')
  async pruneJobFailures() {
    try {
      const result = await this.adminService.pruneFailedJobs(30)
      this.logger.log(`Pruned ${result.deleted} job failures older than 30 days`)
    } catch (err) {
      this.logger.error('Failed to prune job failures', err)
    }
  }
}
