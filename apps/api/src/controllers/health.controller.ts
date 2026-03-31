import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { queueConfigs } from '../config/queues'

// NOTE: This is a placeholder health endpoint. In a full implementation,
// we'd reuse the existing queues/workers and expose real metrics. For now,
// we report that queues are configured and return their names.
@Controller('api/v1/health')
// Story 0.9 Task 1 step 4 owner:
// attach Swagger metadata to this second health endpoint so the generated doc includes both paths.
//
@ApiTags('health')
export class HealthController {
  @Get('queues')
  @ApiOperation({ summary: 'Queue health snapshot' })
  @ApiOkResponse({ description: 'Configured queue names returned successfully' })
  queues() {
    const queues = queueConfigs.map((q) => q.name)
    return {
      status: 'ok',
      queues,
      metrics: {
        // TODO: wire real metrics (queue depth, failed count, latency) using Queue.getJobCounts()
        // and/or QueueEvents. Stubbed for now.
      },
    }
  }
}
