import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common'
import { AdminService } from './admin.service'

// Touch the import to avoid it being treated as type-only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __adminServiceRef = AdminService

@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('failed-jobs')
  async getFailedJobs(@Query('queue') queue?: string) {
    return this.adminService.listFailedJobs(queue)
  }

  @Get('failed-jobs/retry')
  retryFailedJob(@Query('id') id?: string) {
    if (!id) {
      throw new HttpException('id is required', HttpStatus.BAD_REQUEST)
    }
    return this.adminService.retryFailedJob(id)
  }
}
