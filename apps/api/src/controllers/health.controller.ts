// Step 10 step 2 owner: searchable owner anchor
import { Controller, Get } from '@nestjs/common'
import { queueHealthResponseSchema } from '../contracts/http'
import { queueConfigs } from '../config/queues'

// NOTE: This is a placeholder health endpoint. In a full implementation,
// we'd reuse the existing queues/workers and expose real metrics. For now,
// we report that queues are configured and return their names.
@Controller('api/v1/health')
export class HealthController {
  @Get('queues')
  queues() {
    const queues = queueConfigs.map((q) => q.name)
    return queueHealthResponseSchema.parse({
      status: 'ok',
      queues,
      metrics: {
        // TODO: wire real metrics (queue depth, failed count, latency) using Queue.getJobCounts()
        // and/or QueueEvents. Stubbed for now.
      },
    })
  }
}
