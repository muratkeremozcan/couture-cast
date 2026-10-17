// Story 6.2b review (RF13): a community moderation worker that the
// crash-recovery test kills with SIGKILL while it is screening a job. It runs
// with the options the test passes, which are the production worker's options
// with shortened timings, and its screening never finishes, so the job is still
// active, holding a lock, when the process dies.
import { Worker } from 'bullmq'

const [queueName, optionsJson] = process.argv.slice(2)
const worker = new Worker(
  queueName,
  async (job) => {
    process.stdout.write(`screening ${job.id}\n`)
    await new Promise(() => undefined)
  },
  JSON.parse(optionsJson)
)
worker.on('error', () => undefined)
await worker.waitUntilReady()
process.stdout.write('ready\n')
