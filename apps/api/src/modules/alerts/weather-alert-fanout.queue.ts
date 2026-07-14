import type { Queue } from 'bullmq'
import { z } from 'zod'

import type { WeatherAlertEventInput } from './weather-alert-processing.repository.js'

export const ALERT_FANOUT_JOB_NAME = 'weather-alert'
const ALERT_FANOUT_COMPLETED_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const alertFanoutJobDataSchema = z
  .object({ eventId: z.string().trim().min(1).max(128) })
  .strict()

export type AlertFanoutJobData = z.infer<typeof alertFanoutJobDataSchema>

type AlertFanoutQueueClient = Pick<Queue<AlertFanoutJobData>, 'addBulk'>

export interface WeatherAlertFanoutPublisher {
  enqueue(events: WeatherAlertEventInput[]): Promise<void>
}

export class WeatherAlertFanoutQueue implements WeatherAlertFanoutPublisher {
  constructor(private readonly queue: AlertFanoutQueueClient) {}

  async enqueue(events: WeatherAlertEventInput[]): Promise<void> {
    if (events.length === 0) {
      return
    }

    await this.queue.addBulk(
      events.map((event) => ({
        name: ALERT_FANOUT_JOB_NAME,
        data: { eventId: event.id },
        opts: {
          jobId: event.id,
          removeOnComplete: { age: ALERT_FANOUT_COMPLETED_RETENTION_SECONDS },
          removeOnFail: { age: ALERT_FANOUT_COMPLETED_RETENTION_SECONDS },
        },
      }))
    )
  }
}
