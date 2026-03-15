import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common'
import { AdminService } from './admin.service'

/** Story 0.4 support file: minimal operator surface for DLQ workflows.
 * Flow refs:
 * - S0.4/T3: expose read + replay endpoints for the durable dead-letter workflow.
 */
// Touch the import to avoid it being treated as type-only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __adminServiceRef = AdminService

@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Flow ref S0.4/T3: read recent failed jobs for operator triage.
  @Get('failed-jobs')
  async getFailedJobs(@Query('queue') queue?: string) {
    return this.adminService.listFailedJobs(queue)
  }

  // Flow ref S0.4/T3: request replay by failure id.
  @Get('failed-jobs/retry')
  retryFailedJob(@Query('id') id?: string) {
    if (!id) {
      throw new HttpException('id is required', HttpStatus.BAD_REQUEST)
    }
    return this.adminService.retryFailedJob(id)
  }
}
