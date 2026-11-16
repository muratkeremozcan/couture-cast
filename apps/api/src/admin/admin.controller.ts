import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common'
import { AdminService } from './admin.service'
import { Roles } from '../modules/auth/security.decorators'
import { RequestAuthGuard, RolesGuard } from '../modules/auth/security.guards'

/** Story 0.4 support file: minimal operator surface for DLQ workflows.
 * Flow refs:
 * - S0.4/T3: expose read + replay endpoints for the durable dead-letter workflow.
 */
// The dead-letter queue holds job payloads and the retry replays them: admins only (teen-path
// review finding B-8, 2026-11-15; the routes had no guard).
@Controller('api/v1/admin')
@UseGuards(RequestAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

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
