import type { Queue, Worker } from 'bullmq'
import { createQueues, queueConfigs } from '../config/queues'
import { createWorker, defaultWorkerOptions } from './base.worker'

/** Story 0.4 owner file: worker process bootstrap and concurrency policy.
 * Dedicated worker process group:
 * - Why this process group exists: separate background throughput from API request handling.
 * - Problems it solves: protects API latency, supports independent scaling/restarts, and keeps
 *   graceful shutdown for workers explicit.
 * - Why concurrency controls exist: each queue has different workload cost and external dependency
 *   constraints, so we tune per queue instead of one global value.
 * - Alternatives: run workers inside the API process, split one process per queue, or use
 *   serverless/event-driven consumers.
 * Ownership anchors:
 * - Story 0.4 Task 4 owner: apply per-queue concurrency and rate-limit policy during worker startup.
 * - Story 0.4 Task 5 owner: bootstrap and shut down the dedicated worker process group cleanly.
 *
 * Flow refs:
 * - S0.4/T2: queue definitions come from the shared BullMQ config module.
 * - S0.4/T3: failed jobs emitted by these workers are persisted as DLQ records by the worker base layer.
 */
// Flow ref S0.4/T5: track worker/queue instances for coordinated shutdown.
const workers: Worker[] = []
const queues: Queue[] = []

function startWorkers() {
  try {
    // Flow ref S0.4/T5: create queue clients for the known queues before any
    // workers start consuming jobs.
    const startedQueues = createQueues()
    queues.push(...startedQueues)

    // Flow ref S0.4/T4: start one worker per queue with the queue-specific
    // concurrency and optional rate limiter policy.
    workers.push(
      // Moderate parallelism with a minute-level limiter for ingest burst control.
      createWorker('weather-ingestion', async () => Promise.resolve(), {
        ...defaultWorkerOptions(10),
        limiter: { max: 60, duration: 60_000 },
      })
    )

    workers.push(
      // Fanout is lightweight enough for higher parallelism and no extra rate limiter.
      createWorker('alert-fanout', async () => Promise.resolve(), {
        ...defaultWorkerOptions(20),
      })
    )

    workers.push(
      // Expensive extraction workload gets stricter queue-level throttling.
      createWorker('color-extraction', async () => Promise.resolve(), {
        ...defaultWorkerOptions(5),
        limiter: { max: 5, duration: 1000 },
      })
    )

    workers.push(
      // Moderation pipeline also uses explicit throttling to protect downstream systems.
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

// Flow ref S0.4/T5: handle SIGTERM/SIGINT and close resources cleanly.
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

startWorkers()
