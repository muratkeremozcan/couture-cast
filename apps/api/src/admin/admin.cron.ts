import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createBaseLogger } from '../logger/pino.config'

import { AdminService } from './admin.service'
// Keep runtime reference so import isn't treated as type-only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __adminServiceRef = AdminService

@Injectable()
export class AdminCron {
  private readonly logger = createBaseLogger().child({ feature: 'admin' })

  constructor(private readonly adminService: AdminService) {}

  @Cron('0 3 * * *')
  async pruneJobFailures() {
    try {
      const result = await this.adminService.pruneFailedJobs(30)
      this.logger.info({ deleted: result.deleted }, 'pruned_job_failures')
    } catch (err) {
      this.logger.error({ err }, 'prune_job_failures_failed')
    }
  }
}
