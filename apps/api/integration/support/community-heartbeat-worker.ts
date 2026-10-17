// Story 6.2b review (RF15): a community worker process with its presence
// heartbeat, wired the way `createCommunityWorkerRuntime` wires it, for the
// heartbeat integration spec to stop gracefully or kill with SIGKILL. It
// consumes a namespaced queue, never `community-moderation`.
import { Worker } from 'bullmq'
import {
  closeWithHeartbeat,
  CommunityWorkerHeartbeat,
  type HeartbeatRedis,
} from '../../src/modules/community/community-worker-heartbeat.js'

const [queueName, workerName, ttlSeconds, intervalMs, connectionJson] =
  process.argv.slice(2)
if (!queueName || !workerName || !ttlSeconds || !intervalMs || !connectionJson) {
  throw new Error(
    'usage: community-heartbeat-worker.ts <queue> <worker name> <ttl s> <interval ms> <connection json>'
  )
}
const worker = new Worker(queueName, () => Promise.resolve(), {
  connection: JSON.parse(connectionJson) as Record<string, unknown>,
  name: workerName,
})
worker.on('error', () => undefined)
const quiet = { info: () => undefined, warn: () => undefined }
const heartbeat = new CommunityWorkerHeartbeat({
  redis: () => worker.client as Promise<HeartbeatRedis>,
  workerName,
  commitSha: null,
  ttlSeconds: Number(ttlSeconds),
  intervalMs: Number(intervalMs),
  logger: quiet,
})
closeWithHeartbeat(worker, heartbeat)

process.on('SIGTERM', () => {
  void worker.close().then(() => {
    process.stdout.write('closed\n')
    process.exit(0)
  })
})

// The API workspace compiles to CommonJS, so no top-level await.
void (async () => {
  await worker.waitUntilReady()
  if (!(await heartbeat.start())) {
    process.stdout.write('heartbeat failed\n')
    process.exit(1)
  }
  process.stdout.write(`ready ${heartbeat.key}\n`)
})()
