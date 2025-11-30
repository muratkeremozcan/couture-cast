import type { Queue, Worker } from 'bullmq'
import { createQueues, queueConfigs } from '../config/queues'
import { createWorker, defaultWorkerOptions } from './base.worker'

const workers: Worker[] = []
const queues: Queue[] = []

function startWorkers() {
  try {
    const startedQueues = createQueues()
    queues.push(...startedQueues)

    workers.push(
      createWorker('weather-ingestion', async () => Promise.resolve(), {
        ...defaultWorkerOptions(10),
        limiter: { max: 60, duration: 60_000 },
      })
    )

    workers.push(
      createWorker('alert-fanout', async () => Promise.resolve(), {
        ...defaultWorkerOptions(20),
      })
    )

    workers.push(
      createWorker('color-extraction', async () => Promise.resolve(), {
        ...defaultWorkerOptions(5),
        limiter: { max: 5, duration: 1000 },
      })
    )

    workers.push(
      createWorker('moderation-review', async () => Promise.resolve(), {
        ...defaultWorkerOptions(10),
        limiter: { max: 10, duration: 1000 },
      })
    )

    console.log('Workers started for queues:', queueConfigs.map((q) => q.name).join(', '))
  } catch (err) {
    console.error('Failed to start workers:', err)
    process.exit(1)
  }
}

async function shutdown() {
  console.log('Shutting down workers and queues...')
  try {
    await Promise.all([
      Promise.all(workers.map((w) => w.close())),
      Promise.all(queues.map((q) => q.close())),
    ])
  } catch (err) {
    console.error('Error closing workers or queues', err)
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

startWorkers()
