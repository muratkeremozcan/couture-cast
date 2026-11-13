import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'

// The production-latency append proof runs alone: its proxy adds each round trip inside this
// process, so other test files competing for the CPU lengthen the round trips it measures.
const latencyFile = 'integration/community-append-latency.integration.spec.ts'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [latencyFile],
    exclude: base.test?.exclude?.filter(
      (pattern) => pattern !== '**/community-append-latency.integration.spec.ts'
    ),
    fileParallelism: false,
    maxWorkers: 1,
  },
})
