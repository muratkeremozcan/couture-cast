import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'

const budgetFile = 'integration/community-realtime-revalidation.integration.spec.ts'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [budgetFile],
    exclude: base.test?.exclude?.filter(
      (pattern) => pattern !== '**/community-realtime-revalidation.integration.spec.ts'
    ),
    fileParallelism: false,
    maxWorkers: 1,
  },
})
