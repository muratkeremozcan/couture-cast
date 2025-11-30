import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { AdminService } from './admin.service'
// Keep runtime reference so import isn't treated as type-only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __adminServiceRef = AdminService

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
