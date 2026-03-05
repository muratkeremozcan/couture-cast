import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common'
import { AdminService } from './admin.service'

/** Story 0.4 Task 5 context
 * Minimal operator surface for DLQ workflows:
 * 1) read recent failed jobs,
 * 2) request replay by failure id.
 */
// Touch the import to avoid it being treated as type-only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __adminServiceRef = AdminService

@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // 1) read recent failed jobs,
  @Get('failed-jobs')
  async getFailedJobs(@Query('queue') queue?: string) {
    return this.adminService.listFailedJobs(queue)
  }

  // 2) request replay by failure id.
  @Get('failed-jobs/retry')
  retryFailedJob(@Query('id') id?: string) {
    if (!id) {
      throw new HttpException('id is required', HttpStatus.BAD_REQUEST)
    }
    return this.adminService.retryFailedJob(id)
  }
}
